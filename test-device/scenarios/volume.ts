/* Migrated from scripts/test-volume.sh — the hold-a-track + turn-the-master-knob
 * gesture that fades one track.
 *
 * Hold a track button and turn the master volume knob (CC 79, raw: 1-63
 * clockwise, 65-127 counter-clockwise) → that track's level moves along a dB
 * ladder, one dB per detent, multiplicatively. The bash suite spent ~4.7 s of
 * `sleep` on the gesture alone; every one of those is now a wait on the thing it
 * stood in for.
 *
 * WHERE THE VALUE LANDS has changed since the bash script was written and its
 * header is now wrong about it. It says "that track's schwung slot volume"; every
 * track is a movy-hosted chain, so the destination is movy's own summing mixer at
 * `ch<N>:mix` (mix-io.ts, track-volume.ts's `mixerKeyFor`). The ARM line the
 * check reads is the value off that same param, so the suite was always pinning
 * the movy mixer — only the prose moved.
 *
 * The gesture also reaches Move, which is what the fourth check is about. Two
 * shim generations, keyed off `path=` in the arm line rather than inferred:
 * "suppress" excludes Move from the gesture entirely
 * (shadow_set_overtake_suppress_master_volume, 2026-08-24); "inject" is the older
 * fallback, which pushes a track-hold into Move's MIDI_IN so Move routes the
 * turn to its own track volume and leaves master alone.
 *
 * Covers:
 *   V1  CC 79 reached the handler with a track held — without this the rest is
 *       a comparison of two absent numbers
 *   V2  the turn arrived as ONE packet of 5. CC 79 is outside the 71-78 range
 *       shadow_ui accumulates, so it is not re-encoded or split; a handler that
 *       only ever saw single detents would move the level by one detent and no
 *       assertion below could tell that from a broken ladder
 *   V3  the level landed: movy's arithmetic is the ladder's (arm-time read ×
 *       10^(d/20)) AND the track's mixer param really holds it. The bash suite
 *       asserted only the first half — its "slot read-back" compared two numbers
 *       movy itself had logged, so a write the engine silently dropped would
 *       have passed it. Strengthened to the destination itself.
 *   V4  whichever mechanism armed the divert did what its path claims
 *
 * What this CANNOT prove, unchanged from bash: that Move's *master* volume stays
 * put during a real gesture on the "inject" path. Move ignores injected knob
 * events (measured: 120 synthetic detents moved nothing) and the only live
 * master-volume readout schwung has is a pixel scan of Move's overlay, gated on a
 * hardware touch. That needs a physical turn of the knob. On the "suppress" path
 * it is moot — Move never sees the event.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { scenario } from '../runner.js';
import { Device } from '../device.js';
import { Probe } from '../probe.js';
import * as fixture from '../fixture.js';
import { cc, noteOn, noteOff } from '../midi.js';
import { until } from '../wait.js';

const run = promisify(execFile);

/* Track 1. The buttons are CC 40-43 and reversed on the hardware (CC 43 is the
 * focused group's FIRST track), which is why the button is derived from the
 * track rather than written down beside it: the bash script spelled both out and
 * nothing kept them agreeing. */
const TRACK    = 1;
const TRACK_CC = 43 - TRACK;

const MASTER_CC    = 79;   /* MoveMaster — the volume encoder */
const MASTER_TOUCH = 8;    /* MoveKnob8Touch + 1 — the volume knob's capacitive touch */
const DETENTS      = 5;    /* one injected packet, +5 dB */

/* Frames to let movy act on a gesture before reading — a quantity of device
 * work, never a wall clock. */
const ACT = 90;

/* Movy's own lines, TWICE-written (shadow + move-shim) — so every read is a
 * DELTA against a count taken before the gesture, never an absolute. debug.log
 * persists across runs, and the bash suite's `tail -80 | grep` would happily
 * have passed on a `trackvol` line the PREVIOUS run left behind.
 *
 * The trailing space matters: without it `t=1` also matches `t=15`. */
const APPLIED = `trackvol t=${TRACK} d=`;
const ARMED   = `trackvol arm t=${TRACK} `;

const last = (ls: string[]): string => (ls.length ? ls[ls.length - 1] : '');
/* A field out of one of those lines. The leading separator keeps `d=` from
 * matching inside `read=`. */
const field = (line: string, name: string): string =>
    (line.match(new RegExp('(?:^| )' + name + '=(-?[0-9.]+)')) ?? [])[1] ?? '';
const word = (line: string, name: string): string =>
    (line.match(new RegExp('(?:^| )' + name + '=(\\S+)')) ?? [])[1] ?? '';

/* The inject ring's second cursor — the write side, and the only place either
 * test tier can see what movy pushed into Move's MIDI_IN. Read out of band over
 * SSH, as the bash suite did with an inline python3; neither a param nor a
 * ViewModel exposes it. It stands still when nothing is injected and advances by
 * two (the press and the release) when the inject path arms.
 *
 * NaN on any failure rather than a throw: a device that will not answer must be
 * reported by the check that wanted the number, not abort the run before it. */
async function ringCursor(host: string): Promise<number> {
    try {
        const { stdout } = await run('ssh', ['-o', 'ConnectTimeout=5', '-o', 'BatchMode=yes',
            `ableton@${host}`,
            `python3 -c 'import mmap,struct` +
            `;f=open("/dev/shm/schwung-midi-inject","r+b")` +
            `;print(struct.unpack_from("<II",mmap.mmap(f.fileno(),0),0)[1])'`]);
        return Number(stdout.trim());
    } catch { return NaN; }
}

scenario('volume', async (t) => {
    fixture.setHost(t.host);
    const dev   = new Device(t.bus, t.agent, t.host);
    const probe = new Probe(t.bus);
    const open  = () => dev.open(probe);
    const close = () => dev.close(probe);

    /* Every log read is one ssh round trip, so one call per poll and the slice
     * taken on this side — counting and then fetching the last line would double
     * the cost of every wait. */
    const since = async (pattern: string, before: number): Promise<string[]> =>
        (await dev.logLines(pattern)).slice(before);

    await fixture.ensure(t.bus, open, close);
    await dev.deployUi();
    await dev.open(probe);
    await t.bus.frames(ACT);

    /* A track button addresses whichever track the focused GROUP puts under it
     * (router.ts: `focusedTrack(43 - d1)`), so pin the group first. The bash
     * suite never did, and its CC 42 happened to be track 1 — a test of the
     * default, not of the button. */
    await dev.selectTrack(TRACK);
    /* Long enough for the arm line that select's own press writes to reach the
     * log, which the baseline counts below depend on. */
    await t.bus.frames(30);

    /* Baselines taken AFTER the track select: it arms and tears down a divert of
     * its own, which writes an arm line. */
    const armBefore     = (await dev.logLines(ARMED)).length;
    const appliedBefore = (await dev.logLines(APPLIED)).length;
    const ringBefore    = await ringCursor(t.host);
    t.note('ringBefore', ringBefore);

    // ── The gesture ─────────────────────────────────────────────────────────
    /* Held, not tapped. The divert is armed on the track-button PRESS and torn
     * down on its release, so a tap leaves `heldTrack` at -1 and the turn simply
     * falls through to Move's own master volume — no trackvol line at all. The
     * bash suite's ~1.2 s hold is now the body of this, bounded by frames.
     *
     * The turn is ONE injected packet of DETENTS. Touch first, matching the
     * hardware's order and the bash script's. */
    await dev.holdCc(TRACK_CC, async () => {
        await t.bus.frames(ACT);
        await t.agent.inject(noteOn(MASTER_TOUCH, 127));   // knob touch
        await t.bus.frames(ACT);
        await t.agent.inject(cc(MASTER_CC, DETENTS));      // the turn
        await t.bus.frames(ACT);
        await t.agent.inject(noteOff(MASTER_TOUCH));
    });
    await t.bus.frames(ACT);

    /* Read the ring here, at the far edge of the gesture: on the inject path both
     * halves of the hold have been pushed by now (the release fires on the
     * track-up), so a delivery that had not landed yet would read as a path that
     * delivered nothing. */
    const ringAfter = await ringCursor(t.host);
    t.note('ringAfter', ringAfter);

    let appliedLines: string[] = [];
    try {
        await until(t.bus, 'the volume gesture to reach the handler',
            () => since(APPLIED, appliedBefore),
            (ls) => ls.length > 0, { within: 1200, every: 150 });
    } catch { /* the check below reports what is missing */ }
    appliedLines = await since(APPLIED, appliedBefore);
    const applied = last(appliedLines);
    const armLine = last(await since(ARMED, armBefore));
    t.note('appliedLines', appliedLines);
    t.note('armLine', armLine);

    // ── V1: the gesture reached the handler ─────────────────────────────────
    t.check('gesture-reached-handler',
        `CC ${MASTER_CC} reached the track-volume handler with track ${TRACK} held`,
        applied !== '',
        { expected: `a new "trackvol t=${TRACK} d=… v=…" line`,
          actual: applied || `no new trackvol line — ${appliedLines.length} arrived, `
                + `${appliedBefore} already in the log before the gesture` });

    // ── V2: the turn was one packet ─────────────────────────────────────────
    /* CC 79 is outside the 71-78 range shadow_ui re-encodes and accumulates, so
     * it reaches movy raw and whole. The number that matters is `d=`, not the
     * level: five 1-detent packets and one 5-detent packet leave the fader in the
     * same place, and only this tells them apart. */
    const delta = field(applied, 'd');
    t.check('single-packet-delta',
        `the ${DETENTS} detents arrived as one packet`,
        delta === String(DETENTS),
        { expected: `d=${DETENTS}`, actual: applied || 'no applied line to read a delta from' });

    // ── V3: the level landed, on the ladder ─────────────────────────────────
    /* The arm-time read is what the fader started from, so the expectation is
     * derived from THIS run's gesture and not a fixed number. Printed to 2 dp by
     * the logger (`read=` uses toFixed(2), the write toFixed(4)), so the ladder
     * comparison is a tolerance, not an equality.
     *
     * The second half is the strengthening: the arm read and the applied value
     * are both movy's own numbers, and movy logs the value it COMPUTED. Reading
     * the destination back is what says the write reached it — a `setChainParam`
     * the engine refused would leave both of movy's numbers correct. */
    const newVal   = Number(field(applied, 'v'));
    const oldVal   = Number(field(armLine, 'read'));
    const expected = oldVal * Math.pow(10, DETENTS / 20);
    const onLadder = Number.isFinite(oldVal) && Number.isFinite(newVal)
        && (Math.abs(newVal - expected) < 0.01 || newVal === 0 || newVal === 4);

    let slotGain = NaN;
    try {
        /* The engine's own read of the track's mixer, gain first —
         * "gain,pan,muted[,send1,send2]". Same param the gesture wrote. */
        slotGain = parseFloat((await dev.param.get(`overtake_dsp:ch${TRACK}:mix`)).split(',')[0]);
    } catch { slotGain = NaN; }
    const slotOk = Number.isFinite(slotGain) && Math.abs(slotGain - newVal) < 0.001;
    t.note('armRead', oldVal);
    t.note('appliedValue', newVal);
    t.note('ladderExpected', expected);
    t.note('slotGain', slotGain);

    t.check('slot-readback',
        `the level landed on track ${TRACK}'s mixer, ${DETENTS} dB up the ladder`,
        onLadder && slotOk,
        { expected: `~${expected.toFixed(4)} (the arm-time read ${oldVal} x 10^(${DETENTS}/20))`,
          actual: applied === '' || armLine === ''
                ? 'no applied/arm value to compare — the gesture never reached the handler'
              : !onLadder
                ? `off the ladder: ${oldVal} -> ${newVal}, expected ~${expected.toFixed(4)}`
              : !Number.isFinite(slotGain)
                ? `the ladder arithmetic holds (${oldVal} -> ${newVal}) but ch${TRACK}:mix `
                  + 'could not be read back, so the write landing is unproven'
              : !slotOk
                ? `movy logged ${newVal} but ch${TRACK}:mix holds ${slotGain} — the write `
                  + 'did not reach the mixer'
              : `landed: ${oldVal} -> ${slotGain}` });

    // ── V4: the armed divert did what its path claims ───────────────────────
    /* Keyed off the `path=` tag the arm line carries, not inferred from whether
     * the ring moved: on the new path the ring legitimately does not move, so
     * inferring would read a working suppression as a failed injection.
     *
     * The "inject" arm needs an older shim (one without
     * shadow_set_overtake_suppress_master_volume) and so cannot be exercised
     * here; it is implemented anyway, because the fallback is what runs on every
     * device that has not taken the fork. */
    const path  = word(armLine, 'path');
    const moved = ringAfter - ringBefore;
    const suppressOk = path === 'suppress' && moved === 0;
    const injectOk   = path === 'inject' && moved >= 2;
    t.note('divertPath', path);
    t.note('ringDelta', moved);

    t.check('divert-path',
        'the armed divert did what its path claims',
        suppressOk || injectOk,
        { expected: 'path=suppress with the inject ring still, or path=inject with >= 2 packets delivered',
          actual: path === ''
                ? `no "trackvol arm t=${TRACK} … path=…" line — cannot tell which mechanism ran`
              : Number.isFinite(moved)
                ? suppressOk ? `Move excluded, no MIDI_IN injection (${armLine})`
                : injectOk   ? `divert delivered into Move's MIDI_IN (${moved} packets)`
                : path === 'suppress'
                    ? `path=suppress but the inject ring moved ${moved} packets`
                    : path === 'inject'
                        ? `path=inject but the ring advanced by ${moved}, expected >= 2`
                        : `unknown divert path "${path}"`
              : `the inject ring could not be read (before=${ringBefore} after=${ringAfter})` });
});
