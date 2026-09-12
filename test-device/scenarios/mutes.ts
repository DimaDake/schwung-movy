/* Migrated from scripts/test-mutes.sh — the Mute / Solo gesture matrix.
 *
 *   Mute                → mute the current track (any press length)
 *   Shift + Mute        → solo the current track
 *   Shift + Mute + track→ solo that track
 *   Session view        → both standalone forms are modifiers only
 *   Mute + step         → mute any of the 16 tracks, no group scrolling
 *   Shift + Mute + step → solo that track instead
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

const run = promisify(execFile);

const MUTE_CC    = 88;
const SHIFT_CC   = 49;
const SESSION_CC = 50;
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

/* Track 10 (index 9) is two groups past the track buttons: the step row is the
 * only surface that reaches it, and it is where the old `track > 3` ceiling bit. */
const FAR = 9;
/* The track the group's second button addresses. Named so the group assumption
 * above is visible at the point that depends on it. */
const TAP_TRACK = 1;

scenario('mutes', async (t) => {
    fixture.setHost(t.host);
    const dev   = new Device(t.bus, t.agent, t.host);
    const probe = new Probe(t.bus);
    const open  = () => dev.open(probe);
    const close = () => dev.close(probe);

    /* Every line in the log right now, and the count that says where a window
     * starts. */
    const logEvents = async (): Promise<string[]> => {
        try {
            const { stdout } = await run('ssh', ['-o', 'ConnectTimeout=5', '-o', 'BatchMode=yes',
                `ableton@${t.host}`,
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
            const all = await until(t.bus, what, logEvents,
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
        try { return await dev.param.get('overtake_dsp:status'); } catch { return ''; }
    };
    const engineMutes = async (want: string, what: string): Promise<string> => {
        try {
            const s = await until(t.bus, what, status,
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
            const { stdout } = await run('ssh', ['-o', 'ConnectTimeout=5', '-o', 'BatchMode=yes',
                `ableton@${t.host}`, `cat '${p}' 2>/dev/null || true`],
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
    const longMutePress = () => dev.holdCc(MUTE_CC, () => t.bus.frames(LONG_PRESS_FRAMES));
    const shiftMute     = () => dev.holdCc(SHIFT_CC, () => dev.tap.cc(MUTE_CC));
    const shiftMuteTrack = (n: number) =>
        dev.holdCc(SHIFT_CC, () => dev.holdCc(MUTE_CC, () => dev.tap.cc(tapButtonFor(n))));
    const muteStep      = (n: number) => dev.holdCc(MUTE_CC, () => dev.tap.note(STEP_BASE + n, 127));
    const shiftMuteStep = (n: number) =>
        dev.holdCc(SHIFT_CC, () => dev.holdCc(MUTE_CC, () => dev.tap.note(STEP_BASE + n, 127)));

    await fixture.ensure(t.bus, open, close);
    await dev.deployUi();
    await dev.open(probe);

    /* Pin the track AND the view. The fixture persists no activeTrack and no
     * focusGroup, so both start where a fresh open leaves them (track 0, group
     * 0, Track view) — but a track button is also how Session view is left
     * (switchToTrack sets sessionMode false), and two checks below have teeth
     * only in Track view. Making that explicit costs one gesture. */
    await dev.selectTrack(0);
    await t.bus.frames(ACT);
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
            if (startMask[i] === '1') { await muteStep(i); await t.bus.frames(ACT); }
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
        onDisk = await until(t.bus, 'the solo to reach ui-state.json',
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
    await t.bus.frames(ACT);
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

    // ── 7. Session view: the standalone forms are modifiers only ─────────────
    /* One tap to latch Session, and it only LATCHES from Track view (a tap
     * toggles), which is where the check above left us — if the view did not
     * change, the Mute tap below mutes the current track and this fails loudly
     * rather than passing on a state it never reached. */
    await dev.tap.cc(SESSION_CC);
    await t.bus.frames(ACT);
    const b7 = await mark();
    await dev.tap.cc(MUTE_CC);
    await t.bus.frames(ACT);
    await shiftMute();
    await t.bus.frames(400);   // both gestures are non-events; let movy get through them
    const ev7 = await window(b7);
    const mutes7 = await engineMutes(none(), 'the engine to still report every track unmuted');
    const ok7 = ev7.mute.length === 0 && ev7.solo.length === 0 && mutes7 === none();
    t.note('sessionViewWindow', [...ev7.mute, ...ev7.solo]);
    t.check('session-view-inert', 'Session view: Mute and Shift+Mute are modifiers only',
        ok7,
        { expected: 'no mute and no solo line, and the engine’s mask unchanged',
          actual: said(ok7, `both gestures produced nothing and the mask is still ${none()}`,
              ev7.mute.length || ev7.solo.length
              ? `fired while in Session view: ${[...ev7.mute, ...ev7.solo].join(' / ')}`
              : `no line, but the engine holds mute=${mutes7 || '<no status>'} — the release `
                + 'muted the current track silently') });

    await dev.tap.cc(SESSION_CC);   // back to Track view
    await t.bus.frames(ACT);

    // ── 8-10. Mute + step in TRACK view — the same map, without leaving the pads
    /* The map used to be gated on the row already being the track selector, so in
     * Track view the press fell through to the step path: it entered a NOTE and
     * muted nothing. Track view is where you play, so this is the form that gets
     * used, and the gate it removed sat in the router above every other row
     * owner. */
    const b8 = await mark();
    await muteStep(FAR);
    const ev8 = await settle(b8, (e) => e.mute.length > 0, 'Mute+step to mute the track');
    const line8 = last(ev8.mute);
    const mutes8 = await engineMutes(oneHot(FAR), 'the engine to hold that track muted');
    const ok8 = at(line8, 't') === FAR && arrow(line8) === '1' && mutes8 === oneHot(FAR);
    t.note('trackViewLines', ev8.mute);
    t.check('track-view-mute-step', `Track view: Mute + step mutes track ${FAR + 1} without going to Session`,
        ok8,
        { expected: `mute t=${FAR} -> 1 and mute=${oneHot(FAR)}`,
          actual: said(ok8, `${line8} and the engine holds mute=${mutes8}`,
              line8 === '' ? 'the Mute+step press muted nothing'
              : at(line8, 't') !== FAR ? `${line8} — muted the wrong track`
              : arrow(line8) !== '1' ? `${line8} — toggled the wrong way`
              : `${line8} but the engine holds mute=${mutes8 || '<no status>'}`) });

    /* Mute's own release must not mute the active track on top of it: the map
     * press is the gesture that suppresses it (router-steps.ts muteMarkGestured).
     * The bash took the LAST mute line and asked whether it named track 0, which a
     * second line erases. Exactly one line arrived, and it is the map's — so this
     * fails both when the release adds a toggle AND when the map press is dropped
     * and the release is all that is left. */
    const one8 = ev8.mute.length === 1 ? ev8.mute[0] : '';
    const ok9 = ev8.mute.length === 1 && at(one8, 't') === FAR;
    t.check('no-stray-active-mute', 'and the Mute release did not also mute the active track',
        ok9,
        { expected: `exactly one mute line, and it is the map's (t=${FAR})`,
          actual: said(ok9, `one mute line, t=${FAR} — the release added nothing`,
              ev8.mute.length === 0 ? 'no mute line at all — nothing carried the gesture'
              : `${ev8.mute.length} mute lines: ${ev8.mute.join(' / ')} — the release toggled `
                + `track ${active} as well as the map`) });

    const b10 = await mark();
    await muteStep(FAR);
    const ev10 = await settle(b10, (e) => e.mute.length > 0, 'the second map press to land');
    const line10 = last(ev10.mute);
    const mutes10 = await engineMutes(none(), 'the second press to unmute it');
    const ok10 = at(line10, 't') === FAR && arrow(line10) === '0' && mutes10 === none();
    t.note('trackViewLatchLine', line10);
    t.check('track-view-latch', 'Track-view map is a latch too',
        ok10,
        { expected: `mute t=${FAR} -> 0 and mute=${none()}`,
          actual: said(ok10, `${line10} and the engine holds mute=${mutes10}`,
              line10 === '' ? 'the second press did nothing'
              : at(line10, 't') !== FAR || arrow(line10) !== '0'
                  ? `${line10} — expected track ${FAR} toggled off`
              : `${line10} but the engine holds mute=${mutes10 || '<no status>'}`) });

    // ── 11-13. Mute + step in Session view — the 16-track mute map ───────────
    /* This is the only surface that reaches tracks 5-16 without scrolling the
     * focus group, and it is where the old `track > 3` ceiling's teeth live: with
     * the guard back in place the gesture is silently dropped and no line appears.
     * The single-file bundle is exercised here too — router-steps.ts reaches
     * mixer/track-mutes.ts, and an import cycle there breaks only the device
     * build. */
    await dev.tap.cc(SESSION_CC);
    await t.bus.frames(ACT);
    /* Read WHILE Mute is still down, so the line this finds is the map's own — and
     * it has to be. With the map refused, the press falls through to the step
     * path, which in Session view SELECTS this track; the Mute release then
     * toggles the newly-current track and writes a mute line naming exactly this
     * track. A whole-gesture window is satisfied by that impostor. The
     * fall-through is what the next check catches; this one must see only what
     * the map itself wrote. */
    const b11 = await mark();
    let ev11: Ev = { mute: [], solo: [], track: [] };
    await dev.holdCc(MUTE_CC, async () => {
        await dev.tap.note(STEP_BASE + FAR, 127);
        ev11 = await settle(b11, (e) => e.mute.length > 0, 'Mute+step to mute the high track');
    });
    /* The whole gesture, release included, for the no-switch half below. */
    const whole11 = await window(b11);
    const line11 = last(ev11.mute);
    const mutes11 = await engineMutes(oneHot(FAR), 'the engine to hold that track muted');
    const ok11 = at(line11, 't') === FAR && arrow(line11) === '1' && mutes11 === oneHot(FAR);
    t.note('sessionMapLines', ev11.mute);
    t.check('mute-step-past-4', `Mute + step mutes track ${FAR + 1} — past the old 4-track ceiling`,
        ok11,
        { expected: `mute t=${FAR} -> 1 and mute=${oneHot(FAR)}`,
          actual: said(ok11, `${line11} and the engine holds mute=${mutes11}`,
              line11 === '' ? `Mute + step on track ${FAR + 1} did nothing — no mute line `
                  + 'while Mute was held'
              : at(line11, 't') !== FAR ? `${line11} — muted the wrong track`
              : arrow(line11) !== '1' ? `${line11} — toggled the wrong way`
              : `${line11} but the engine holds mute=${mutes11 || '<no status>'}`) });

    /* The same press must not ALSO switch tracks: with Mute held the row is a mute
     * map, not the track selector. A switch logs its own line, whichever track it
     * went to — the bash asked only about track 10. */
    const ok12 = whole11.track.length === 0;
    t.check('mute-step-no-switch', 'and it did not switch to that track',
        ok12,
        { expected: 'no "track: active=" line',
          actual: said(ok12, 'the row stayed on the track it was on',
              `the row also selected a track: ${whole11.track.join(' / ')}`) });

    const b13 = await mark();
    await muteStep(FAR);
    const ev13 = await settle(b13, (e) => e.mute.length > 0, 'the second map press to land');
    const line13 = last(ev13.mute);
    const mutes13 = await engineMutes(none(), 'the second press to unmute it');
    const ok13 = at(line13, 't') === FAR && arrow(line13) === '0' && mutes13 === none();
    t.note('sessionLatchLine', line13);
    t.check('session-map-latch', 'pressing it again unmutes — every form of the gesture is a latch',
        ok13,
        { expected: `mute t=${FAR} -> 0 and mute=${none()}`,
          actual: said(ok13, `${line13} and the engine holds mute=${mutes13}`,
              line13 === '' ? 'the second press did nothing'
              : at(line13, 't') !== FAR || arrow(line13) !== '0'
                  ? `${line13} — expected track ${FAR} toggled off`
              : `${line13} but the engine holds mute=${mutes13 || '<no status>'}`) });

    // ── 14-15. Shift+Mute+step solos that track, on the same 16-wide surface ──
    const b14 = await mark();
    await shiftMuteStep(FAR);
    const ev14 = await settle(b14, (e) => e.solo.length > 0, 'Shift+Mute+step to solo');
    const line14 = last(ev14.solo);
    const want14 = invert(oneHot(FAR));
    const mutes14 = await engineMutes(want14, 'the engine to hold the other 15 muted');
    const ok14 = at(line14, 't') === FAR && arrow(line14) === '1'
        && maskOf(line14, 'set') === oneHot(FAR) && maskOf(line14, 'mutes') === want14
        && mutes14 === want14;
    t.note('soloStepLine', line14);
    t.check('shift-mute-step-solo', `Shift + Mute + step solos track ${FAR + 1}, muting the other 15`,
        ok14,
        { expected: `solo t=${FAR} -> 1 set=${oneHot(FAR)} mutes=${want14} and mute=${want14}`,
          actual: said(ok14, `${line14} and the engine holds mute=${mutes14}`,
              line14 === '' ? 'no solo line at all'
              : at(line14, 't') !== FAR || arrow(line14) !== '1' ? `${line14} — expected track ${FAR} soloed`
              : maskOf(line14, 'set') !== oneHot(FAR) || maskOf(line14, 'mutes') !== want14
                  ? `${line14} — expected set=${oneHot(FAR)} mutes=${want14}`
              : `${line14} but the engine holds mute=${mutes14 || '<no status>'}`) });

    const b15 = await mark();
    await shiftMuteStep(FAR);                              // un-solo
    const ev15 = await settle(b15, (e) => e.solo.length > 0, 'the un-solo to land');
    const line15 = last(ev15.solo);
    const mutes15 = await engineMutes(none(), 'the release to unmute all 16');
    const ok15 = at(line15, 't') === FAR && arrow(line15) === '0'
        && maskOf(line15, 'set') === none() && maskOf(line15, 'mutes') === none()
        && mutes15 === none();
    t.note('unsoloStepLine', line15);
    t.check('un-solo-releases-16', 'un-solo from the step row releases all 16',
        ok15,
        { expected: `solo t=${FAR} -> 0 set=${none()} mutes=${none()} and mute=${none()}`,
          actual: said(ok15, `${line15} and the engine holds mute=${mutes15}`,
              line15 === '' ? 'the second Shift+Mute+step did nothing — the mutes are stranded'
              : at(line15, 't') !== FAR || arrow(line15) !== '0' ? `${line15} — expected track ${FAR} un-soloed`
              : maskOf(line15, 'set') !== none() || maskOf(line15, 'mutes') !== none()
                  ? `${line15} — expected set=${none()} mutes=${none()}`
              : `${line15} but the engine still holds mute=${mutes15 || '<no status>'}`) });

    /* Leave the surface in Track view, where a user would find it. The mute/solo
     * state itself needs no teardown: the fixture reseeds both halves from disk
     * (seq-state.json carries no `tk` mute lines, ui-state.json carries an
     * all-zero solo), so a run that dies mid-gesture cannot poison the next
     * suite — which is the point of fixture.ensure() running last. */
    await dev.tap.cc(SESSION_CC);
    await t.bus.frames(ACT);
});
