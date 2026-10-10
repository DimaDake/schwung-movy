/* Migrated from scripts/test-mutes.sh — the Mute / Solo gesture matrix.
 *
 *   Mute                → mute the current track (any press length)
 *   Shift + Mute        → solo the current track
 *   Shift + Mute + track→ solo that track
 *
 * The Session-view and Mute+step forms are asserted locally
 * (logic/mute-solo.mjs, logic/seq-router.mjs) — see the note at the end.
 *
 * The bash suite slept ~55 s of the 85 s it took, ran every gesture as
 * `inject … sleep:N` in a device-side script, and read its answers back with
 * `tail -1 | grep` on a log that PERSISTS across runs — so a line the previous
 * run left behind could satisfy a check. Every read here is a DELTA against a
 * count taken before the gesture, and every wait is on the thing it stands in
 * for.
 *
 * Two things the bash suite could not assert, strengthened here rather than
 * translated:
 *
 *  - The ENGINE's own mute mask (`mute=` on `status`, one character per track,
 *    track 0 first). The bash had no way to reach the engine, so its baseline
 *    was a solo-probe that read movy's UI mirror. The mirror is written
 *    optimistically; the engine's mask is what actually goes silent, and it is
 *    what a solo derives. Both halves are asserted together — the UI toggled it
 *    AND the engine holds it — because either alone passes on a state the other
 *    contradicts.
 *
 *  - A REAL reopen. The bash's `open_movy` re-issued the open command without
 *    ever closing movy (Back x3 does not close it — test-device/MIGRATION.md),
 *    so its "solo survives a reopen" test only ever lost the JS context: the
 *    engine never unloaded, so its derived mutes could not have been lost. This
 *    closes and reopens for real, which is the failure mode the suite exists for
 *    ("a regression there strands the other tracks muted").
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { scenario } from '../runner.js';
import { Device } from '../device.js';
import { Probe } from '../probe.js';
import * as fixture from '../fixture.js';
import { until } from '../wait.js';
import { SSH_OPTS } from '../ssh.js';

const run = promisify(execFile);

const MUTE_CC    = 88;
const SHIFT_CC   = 49;
const STEP_BASE  = 16;   // step buttons are notes 16..31
const NTRACKS    = 16;

/* ~930 ms. The point of the long press is that the old 500 ms "it was a hold"
 * rule swallowed it, so this is deliberately far past a tap — and the bash's
 * `sleep:900` is now frames. */
const LONG_PRESS_FRAMES = 320;

/* Frames to let movy act on a gesture before reading — a quantity of device
 * work, never a wall clock. */
const ACT = 90;

/* Track index → its button in the focused group (CC 43 is the group's first).
 * The bash spelled `solo t=1` out because the group is wherever the user last
 * left it; here it is derived, and the assumption is stated rather than implied:
 * focusGroup is NOT persisted (seq/serializeUiState), so a fresh open has group
 * 0, and this suite never moves it. */
const tapButtonFor = (n: number): number => 43 - (n % 4);

/* The report's `actual` is what a reader uses to tell a pass from a near miss,
 * so on a PASS it says what was measured; the diagnostic chain only ever runs on
 * the failing side. */
const said = (ok: boolean, evidence: string, why: string): string => (ok ? evidence : why);

/* ── Reading state ────────────────────────────────────────────────────────────
 *
 * movy's own log lines, read in ONE ssh per poll. Every line is written TWICE —
 * `[shadow]` and the move shim — so the read is filtered to the shadow copy: an
 * event then counts once, which is what makes "exactly one mute line" a
 * meaningful assertion rather than a constant 2. debug.log persists across runs,
 * so every window is a delta against a count taken before the gesture. */
const LOG_RE = '\\[shadow\\].*(mute t=|solo t=|track: active=)';

type Ev = { mute: string[]; solo: string[]; track: string[] };
const bucket = (ls: string[]): Ev => ({
    mute:  ls.filter((l) => l.includes('mute t=')),
    solo:  ls.filter((l) => l.includes('solo t=')),
    track: ls.filter((l) => l.includes('track: active=')),
});

const last = (ls: string[]): string => (ls.length ? ls[ls.length - 1] : '');

/* A field out of one of those lines. The leading separator keeps `t=` from
 * matching inside `set=`, and `n=` from matching inside a longer token. */
const raw = (line: string, name: string): string =>
    (line.match(new RegExp('(?:^| )' + name + '=(-?[0-9]+)')) ?? [])[1] ?? '';
/* NaN for a missing field, never 0: a line that never arrived must not read as
 * "track 0", which on this suite's default track is a plausible answer. */
const at = (line: string, name: string): number => {
    const v = raw(line, name);
    return v === '' ? NaN : Number(v);
};
const maskOf = (line: string, name: string): string =>
    (line.match(new RegExp('(?:^| )' + name + '=([01]+)')) ?? [])[1] ?? '';
const arrow = (line: string): string => (line.match(/ -> ([01])(?: |$)/) ?? [])[1] ?? '';

/* One flag per track, derived from NTRACKS rather than pasted, so a pattern and
 * the fleet it describes cannot drift. */
const oneHot = (t: number): string =>
    Array.from({ length: NTRACKS }, (_, i) => (i === t ? '1' : '0')).join('');
const invert = (m: string): string => m.replace(/[01]/g, (c) => (c === '1' ? '0' : '1'));
const none = (): string => '0'.repeat(NTRACKS);

/* The track the group's second button addresses. Named so the group assumption
 * above is visible at the point that depends on it. */
const TAP_TRACK = 1;

scenario('mutes', async (t) => {
    fixture.setHost(t.host);
    const dev   = new Device(t.tx);
    const probe = new Probe(t.tx);
    const open  = () => dev.open(probe);
    const close = () => dev.close(probe);

    /* Every line in the log right now, and the count that says where a window
     * starts. */
    const logEvents = async (): Promise<string[]> => {
        try {
            const { stdout } = await run('ssh', [...SSH_OPTS, `ableton@${t.host}`,
                `grep -E '${LOG_RE}' /data/UserData/schwung/debug.log 2>/dev/null || true`],
                { maxBuffer: 8 * 1024 * 1024 });
            return stdout.split('\n').filter(Boolean);
        } catch { return []; }
    };
    const mark = async (): Promise<number> => (await logEvents()).length;
    const window = async (before: number): Promise<Ev> =>
        bucket((await logEvents()).slice(before));

    /* Let movy act, bounded by frames, then read. A log write happens on the
     * gesture's own tick, so the first read usually already has it — this is not
     * a delay, it is a wait for the thing read. */
    const settle = async (before: number, pred: (e: Ev) => boolean, what: string): Promise<Ev> => {
        try {
            const all = await until(t.tx, what, logEvents,
                (ls) => pred(bucket(ls.slice(before))), { within: 1500, every: 150 });
            return bucket(all.slice(before));
        } catch { return window(before); }
    };

    /* The engine's own read of the state — no probe, no log, and none of the
     * probe's 435 ms spacing. `mute=` is one character per track, track 0 first,
     * and it is the DERIVED mute: the thing a solo actually does. `trk=` is the
     * track the engine is watching, which the UI pushes by comparison every tick
     * (seq/watch.ts), so it is the current track's ack. */
    const status = async (): Promise<string> => {
        try { return await dev.param.get('status'); } catch { return ''; }
    };
    const engineMutes = async (want: string, what: string): Promise<string> => {
        try {
            const s = await until(t.tx, what, status,
                (x) => maskOf(x, 'mute') === want, { within: 700, every: 60 });
            return maskOf(s, 'mute');
        } catch { return maskOf(await status(), 'mute'); }
    };
    const activeTrack = async (): Promise<number> => at(await status(), 'trk');

    /* The per-set UI blob, for the solo's bookkeeping — the half that lives only
     * in movy's memory and therefore has to be persisted to survive a teardown.
     * Read out of band, as the bash did: no param or ViewModel exposes the file. */
    const soloOnDisk = async (): Promise<string> => {
        let out = '';
        try {
            const uuid = await fixture.activeUuid().catch(() => '');
            const p = `/data/UserData/schwung/modules/tools/movy/sets/${uuid || '_default'}/ui-state.json`;
            const { stdout } = await run('ssh', [...SSH_OPTS, `ableton@${t.host}`, `cat '${p}' 2>/dev/null || true`],
                { maxBuffer: 4 * 1024 * 1024 });
            out = stdout;
        } catch { return ''; }
        const m = out.match(/"solo"\s*:\s*\[([0-9,\s]*)\]/);
        return m ? m[1].split(',').map((s) => s.trim()).filter((s) => s !== '').join('') : '';
    };

    /* ── Gestures ─────────────────────────────────────────────────────────────
     *
     * Mute is a HOLD in every combined form: the map press is what suppresses
     * Mute's own release (router-steps.ts muteMarkGestured), and Shift selects
     * solo for the whole gesture. A press and a release delivered as two separate
     * injects is a different gesture to movy (see MIGRATION.md), so these are
     * real press/body/release — with the body measured in device frames. */
    const longMutePress = () => dev.holdCc(MUTE_CC, () => t.tx.frames(LONG_PRESS_FRAMES));
    const shiftMute     = () => dev.holdCc(SHIFT_CC, () => dev.tap.cc(MUTE_CC));
    const shiftMuteTrack = (n: number) =>
        dev.holdCc(SHIFT_CC, () => dev.holdCc(MUTE_CC, () => dev.tap.cc(tapButtonFor(n))));
    /* Only the baseline clean-up uses the 16-wide map now: it reaches every
     * track from any view, which the track buttons do not. */
    const muteStep      = (n: number) => dev.holdCc(MUTE_CC, () => dev.tap.note(STEP_BASE + n, 127));

    await fixture.ensure(t.tx, open, close);
    await dev.deployUi();
    await dev.open(probe);

    /* Pin the track AND the view. The fixture persists no activeTrack and no
     * focusGroup, so both start where a fresh open leaves them (track 0, group
     * 0, Track view) — but a track button is also how Session view is left
     * (switchToTrack sets sessionMode false), and two checks below have teeth
     * only in Track view. Making that explicit costs one gesture. */
    await dev.selectTrack(0);
    await t.tx.frames(ACT);
    const active = await activeTrack();
    t.note('activeTrack', active);

    // ── 1. The baseline every gesture below is measured against ──────────────
    /* The bash learned this by soloing and reading `base=`, because it could not
     * read the engine; the engine reports the same thing directly, and the
     * engine's copy is the one that silences a track. The remediation is the
     * bash's intent — reach an unmuted baseline rather than fail on a device
     * someone left dirty — but through the 16-wide map, which is view- and
     * group-independent, instead of the track buttons, which only reach the
     * focused group's four. */
    let startMask = await engineMutes(none(), 'the engine to report every track unmuted');
    if (startMask !== none()) {
        t.note('mutesAtStart', startMask);
        for (let i = 0; i < NTRACKS; i++) {
            if (startMask[i] === '1') { await muteStep(i); await t.tx.frames(ACT); }
        }
        startMask = await engineMutes(none(), 'the un-muting to take');
    }
    const ok1 = startMask === none();
    t.check('baseline-all-unmuted', 'baseline: all tracks unmuted',
        ok1,
        { expected: none(),
          actual: said(ok1, `the engine's mask is ${startMask}`,
              startMask === '' ? 'the engine did not answer — there is no baseline at all'
                               : `the device started at mute=${startMask} and the map could not clear it`) });

    // ── 2. Mute — any press length ───────────────────────────────────────────
    /* The bash asserted "a mute line exists". This says WHICH track, in which
     * direction, and that the engine holds it. */
    const b2 = await mark();
    await longMutePress();
    const ev2 = await settle(b2, (e) => e.mute.length > 0, 'the long Mute press to land');
    const line2 = last(ev2.mute);
    const mutes2 = await engineMutes(oneHot(active), 'the engine to hold the current track muted');
    const ok2 = at(line2, 't') === active && arrow(line2) === '1' && mutes2 === oneHot(active);
    t.note('longPressLine', line2);
    t.check('mute-long-press', `a long Mute press (~${Math.round(LONG_PRESS_FRAMES * 2.9 / 100) * 100} ms) mutes the current track`,
        ok2,
        { expected: `mute t=${active} -> 1 and mute=${oneHot(active)}`,
          actual: said(ok2, `${line2} and the engine holds mute=${mutes2}`,
              line2 === '' ? 'no mute line at all — the press did nothing'
              : at(line2, 't') !== active
                  ? `${line2} — muted the wrong track (the current one is ${active})`
              : arrow(line2) !== '1' ? `${line2} — the press toggled the wrong way`
              : `${line2} but the engine holds mute=${mutes2 || '<no status>'} — the write did not land`) });

    /* Back to unmuted before the solo checks. A WAIT, not a check: they all read
     * `base=`, which is "the user's own mutes" at the moment the solo engages. */
    const b2b = await mark();
    await dev.tap.cc(MUTE_CC);
    await settle(b2b, (e) => e.mute.length > 0, 'the un-mute to land');
    await engineMutes(none(), 'the un-mute to reach the engine');

    // ── 3. Shift+Mute — solo the current track ───────────────────────────────
    /* The bash derived the soloed track from the line too, so this is not new
     * strictness; what IS new is that the line is held against the engine's own
     * `trk=` for the current track, and its masks against the engine's mute
     * mask. */
    const b3 = await mark();
    await shiftMute();
    const ev3 = await settle(b3, (e) => e.solo.length > 0, 'Shift+Mute to solo');
    const line3 = last(ev3.solo);
    const N     = at(line3, 't');
    const soloSet = oneHot(N);
    const soloMut = invert(soloSet);
    const mutes3  = await engineMutes(soloMut, 'the derived mutes to land');
    const ok3 = N === active && arrow(line3) === '1'
        && maskOf(line3, 'set') === soloSet && maskOf(line3, 'mutes') === soloMut
        && mutes3 === soloMut;
    t.note('soloLine', line3);
    t.note('soloedTrack', N);
    t.check('shift-mute-solo', `Shift+Mute solos the current track (${active}), muting the other 15`,
        ok3,
        { expected: `solo t=${active} -> 1 set=${soloSet} mutes=${soloMut} and mute=${soloMut}`,
          actual: said(ok3, `${line3} and the engine holds mute=${mutes3}`,
              line3 === '' ? 'no solo line at all'
              : N !== active ? `${line3} — soloed track ${N}, the current one is ${active}`
              : arrow(line3) !== '1' ? `${line3} — the press un-soloed instead`
              : maskOf(line3, 'set') !== soloSet || maskOf(line3, 'mutes') !== soloMut
                  ? `${line3} — expected set=${soloSet} mutes=${soloMut}`
              : `${line3} but the engine holds mute=${mutes3 || '<no status>'}, expected ${soloMut}`) });

    // ── 4. The solo's bookkeeping has to REACH DISK ──────────────────────────
    /* The autosave is tick-based — at this device's load, ~8 s of device time
     * (SAVE_TICKS=600, project_movy-device-tick-rate) — not wall-clock, so this
     * waits on the file. The bash's comment records exactly why: reopening early
     * reloaded the PREVIOUS blob, cleared the solo, and looked exactly like a
     * persistence bug.
     *
     * Solo lives only in movy's memory while its EFFECT — the derived mutes —
     * lives in the engine, so losing this bookkeeping across a reopen strands
     * those mutes as if the user had asked for them. */
    let onDisk = '';
    try {
        onDisk = await until(t.tx, 'the solo to reach ui-state.json',
            soloOnDisk, (v) => v === soloSet, { within: 3000, every: 200 });
    } catch { onDisk = await soloOnDisk(); }
    const ok4 = onDisk === soloSet;
    t.note('soloOnDisk', onDisk);
    t.check('solo-reached-disk', 'the solo reached disk before the reopen — nothing to restore otherwise',
        ok4,
        { expected: `"solo":[${soloSet.split('').join(',')}] in ui-state.json`,
          actual: said(ok4, `ui-state.json carries solo ${onDisk}`,
              onDisk === '' ? 'ui-state.json carries no solo array'
                            : `the blob still holds ${onDisk}`) });

    // ── 5. The regression: the solo survives a REAL reopen ───────────────────
    /* Both halves are one fact. If the mutes came back but the bookkeeping did
     * not, the un-solo SOLOS instead and the masks show it. If the bookkeeping
     * came back but the mutes did not, the un-solo produces an identical-looking
     * `-> 0 … mutes=000…` over a state that was already silent — so the derived
     * mutes are asserted BEFORE the gesture as well. The bash could not make that
     * distinction: its reopen never unloaded the engine. */
    await close();
    await open();
    await t.tx.frames(ACT);
    const afterReopen   = await activeTrack();
    const restoredMutes = await engineMutes(soloMut, 'the reopened engine to still hold the derived mutes');
    t.note('activeAfterReopen', afterReopen);
    t.note('mutesAfterReopen', restoredMutes);

    const b5 = await mark();
    await shiftMute();                                     // un-solo
    const ev5 = await settle(b5, (e) => e.solo.length > 0, 'the un-solo to land');
    const line5 = last(ev5.solo);
    const mutes5 = await engineMutes(none(), 'the release to unmute everything');
    const ok5 = restoredMutes === soloMut && at(line5, 't') === N && arrow(line5) === '0'
        && maskOf(line5, 'set') === none() && maskOf(line5, 'mutes') === none()
        && mutes5 === none();
    t.note('unsoloLine', line5);
    t.check('solo-survives-reopen', 'solo survives a reopen — un-soloing restores every track',
        ok5,
        { expected: `mute=${soloMut} with the solo up, then solo t=${N} -> 0 set=${none()} mutes=${none()} and mute=${none()}`,
          actual: said(ok5, `mute=${restoredMutes} came back, then ${line5}`,
              restoredMutes !== soloMut
              ? `the reopen lost the derived mutes (the engine holds ${restoredMutes || '<no status>'}, `
                + `expected ${soloMut}) — the other tracks were stranded or never silenced`
              : line5 === ''
                ? `the reopen kept the mutes but nothing un-soloed — the un-solo gesture targets the `
                  + `current track, which came back as ${afterReopen} instead of ${N}`
              : at(line5, 't') !== N || arrow(line5) !== '0'
                  ? `${line5} — expected solo t=${N} -> 0 (the current track came back as ${afterReopen})`
              : maskOf(line5, 'set') !== none() || maskOf(line5, 'mutes') !== none()
                  ? `${line5} — un-soloing left state behind, expected set=${none()} mutes=${none()}`
              : `${line5} but the engine still holds mute=${mutes5 || '<no status>'}`) });

    // ── 6. Shift+Mute+track solos THAT track only ────────────────────────────
    /* The bash asserted `solo t=1` plus the absence of a mute line, from a log it
     * had just cleared. Here the line, its masks and the engine's mask are one
     * assertion, and the "no stray mute" half counts lines rather than taking the
     * last one. */
    const b6 = await mark();
    await shiftMuteTrack(TAP_TRACK);
    const ev6 = await settle(b6, (e) => e.solo.length > 0, 'Shift+Mute+track to solo');
    const line6 = last(ev6.solo);
    const want6 = invert(oneHot(TAP_TRACK));
    const mutes6 = await engineMutes(want6, 'the engine to hold the other 15 muted');
    const ok6 = at(line6, 't') === TAP_TRACK && arrow(line6) === '1'
        && maskOf(line6, 'set') === oneHot(TAP_TRACK) && maskOf(line6, 'mutes') === want6
        && mutes6 === want6 && ev6.mute.length === 0;
    t.note('soloTrackLine', line6);
    t.check('shift-mute-track', `Shift+Mute+track solos that track only (track ${TAP_TRACK + 1}, no stray mute)`,
        ok6,
        { expected: `solo t=${TAP_TRACK} -> 1 set=${oneHot(TAP_TRACK)} mutes=${want6}, mute=${want6}, no mute line`,
          actual: said(ok6, `${line6} and the engine holds mute=${mutes6}`,
              line6 === '' ? 'no solo line at all'
              : ev6.mute.length > 0 ? `the gesture also muted: ${ev6.mute.join(' / ')}`
              : at(line6, 't') !== TAP_TRACK || arrow(line6) !== '1'
                  ? `${line6} — expected track ${TAP_TRACK} soloed`
              : maskOf(line6, 'set') !== oneHot(TAP_TRACK) || maskOf(line6, 'mutes') !== want6
                  ? `${line6} — expected set=${oneHot(TAP_TRACK)} mutes=${want6}`
              : `${line6} but the engine holds mute=${mutes6 || '<no status>'}`) });

    const b6b = await mark();
    await shiftMuteTrack(TAP_TRACK);                       // un-solo
    await settle(b6b, (e) => e.solo.length > 0, 'the un-solo to land');
    await engineMutes(none(), 'the release to unmute everything');

    /* Sections 7-15 (Session view inert, Mute+step in both views, step-row
     * solo) were cut 2026-10-09 to shorten the tier: the gesture logic is the
     * local suites' — logic/mute-solo.mjs and logic/seq-router.mjs ("session
     * mute by step", the Track-view map, the step-row un-solo). What only the
     * device can show stays above: the real Mute CC, the engine's mask, and the
     * solo surviving a real close and reopen.
     *
     * No teardown: the fixture reseeds both halves from disk (seq-state.json
     * carries no `tk` mute lines, ui-state.json an all-zero solo), and the
     * check above already left every track unmuted in Track view. */
});
