/* Migrated from scripts/test-auto.sh — parameter automation display + registry.
 *
 * The bash suite read movy's view model by grepping a log line movy flattens it
 * into (`auto render held=1 | DCAY:a1t1=69% ...`) and parsing it back out with
 * grep -oE plus an awk timestamp-dedup hack. It asserted the same seven things
 * this does, in 61 s, with ~25 s of that being fixed sleeps.
 *
 * Covers:
 *   P1  the held-step value updates live while turning a knob
 *   P2  the automation dot shows on an automated param
 *   P3  on reopen, the registry repopulates from the restored engine state
 *       (an empty registry = no dot, no held value, knob jumps on playback)
 *   P4  a LIVE take (recording, no step held) repaints and ACCUMULATES —
 *       a different path from P1: it is driven by liveTurn, not heldLocks
 */
import { scenario } from '../runner.js';
import { Device } from '../device.js';
import { Probe } from '../probe.js';
import * as fixture from '../fixture.js';
import { CC_PLAY, CC_REC, CC_BACK } from '../midi.js';
import { until } from '../wait.js';

/* Knob index 4 = CC 75. On the fixture's synth this is an AUTOMATABLE param
 * (DCAY); the bash suite's comment records that knob 2 silently stopped working
 * when curation marked it automatable:false, and every dot assertion then failed
 * for the wrong reason. */
const KNOB = 4;
const STEP_FIRST = 16;   // step buttons are notes 16..31
const STEP_HELD  = 20;
const PAD = 68;          // pads are notes 68..99; 68 is the default focused pad

/* Frames to let movy act on a gesture before reading. A probe read already
 * carries its own quiet window, so this only has to cover movy noticing the
 * input — it is a quantity of device work, never a wall clock. */
const ACT = 90;

const touchedCell = (page: any) =>
    Array.isArray(page?.cells) ? page.cells.find((c: any) => c && c.touched) : undefined;

scenario('automation', async (t) => {
    fixture.setHost(t.host);
    const dev = new Device(t.bus, t.agent, t.host);
    const probe = new Probe(t.bus);
    const open  = () => dev.open(probe);
    const close = () => dev.close(probe);

    await fixture.ensure(t.bus, open, close);
    t.note('blob_afterEnsure', await fixture.blobInfo());
    await dev.deployUi();
    await dev.open(probe);
    await t.bus.frames(300);
    t.note('blob_afterOpen', await fixture.blobInfo());
    t.note('registry_afterOpen', (await probe.auto()).lanes);

    t.note('fixtureSynth', fixture.fixtureSynth(0));
    await dev.selectTrack(0);

    /* A module whose root level fills all 8 encoders gets a dedicated Preset
     * page placed BEFORE Main, and the preset knob is deliberately
     * non-automatable. Movy lands there on open, so without paging past it this
     * scenario drives a knob that can never hold automation and every check
     * fails for the wrong reason. The bash version detected this by regex on a
     * log line; the page is readable directly now. */
    await dev.tap.jog();
    await t.bus.frames(ACT);
    for (let i = 0; i < 3; i++) {
        const p = await probe.page();
        const named = (p.cells ?? []).filter((c: any) => c);
        if (named.length !== 1 || !/^PRESE/.test(named[0].name)) break;
        await dev.tap.jogTurn(1);
        await t.bus.frames(ACT);
    }

    // ── P1 / P2: hold a step and turn an automatable knob ────────────────────
    await dev.tap.note(PAD, 100);          // set the step-entry pitch
    await dev.tap.note(STEP_FIRST, 127);   // place a note (auto-creates the clip)
    await dev.tap.cc(CC_PLAY);
    await t.bus.frames(ACT);

    const heldValues = new Set<string>();
    let heldTouched = false;
    let heldDot = false;

    await dev.hold(STEP_HELD, async () => {
        /* Up then down. Bidirectional so distinct values appear whatever the
         * base is, instead of clamping at a rail and yielding exactly one. */
        for (const d of [12, 12, 12, -12, -12, -12]) {
            await dev.tap.knob(KNOB, d);
            await t.bus.frames(ACT);
            const page = await probe.page();
            if (page.held) heldTouched = true;
            const cell = touchedCell(page);
            if (cell) {
                heldValues.add(String(cell.value));
                if (cell.automated) heldDot = true;
            }
        }
    });
    t.note('heldValues', [...heldValues]);

    t.check('p1-highlight', 'the held-step value is highlighted while holding', heldTouched);
    t.check('p1-live', 'the held value updates live while turning',
        heldValues.size >= 2, { expected: '>=2 distinct values', actual: String(heldValues.size) });
    t.check('p2-dot', 'the automation dot shows on the automated param', heldDot);

    // ── P4: a LIVE take (recording, no step held) repaints and accumulates ───
    await dev.tap.cc(CC_REC);              // arm; one-bar count-in
    let recording = true;
    try {
        await until(t.bus, 'the count-in to elapse',
            () => t.bus.getParam('overtake_dsp:status'),
            (s) => /(^| )rec=1( |$)/.test(s), { within: 3000, every: 60 });
    } catch { recording = false; }
    t.note('recordingArmed', recording);

    /* Drive to the floor first so the up-sweep has full headroom and a known
     * base. A take that fails to accumulate sticks at base+one-delta — the
     * reported "snaps back" bug — which a sweep from an unknown base can hide. */
    for (let i = 0; i < 4; i++) { await dev.tap.knob(KNOB, -12); await t.bus.frames(60); }

    const liveValues = new Set<string>();
    let liveTouched = false;
    for (let i = 0; i < 4; i++) {
        await dev.tap.knob(KNOB, 12);
        await t.bus.frames(ACT);
        const page = await probe.page();
        const cell = touchedCell(page);
        if (cell) { liveTouched = true; liveValues.add(String(cell.value)); }
    }
    await dev.tap.cc(CC_REC);              // stop recording
    t.note('liveValues', [...liveValues]);

    t.check('p4-repaint', 'the live-record value is highlighted while turning (no step held)',
        liveTouched);
    t.check('p4-accumulate', 'the live-record value accumulates across the take',
        liveValues.size >= 3, { expected: '>=3 distinct values', actual: String(liveValues.size) });

    // ── P3: the registry repopulates from restore on a REAL reopen ───────────
    /* The bash suite did `Back x3` here, which never closed movy (Back opens the
     * Leave modal at root and DISMISSES it while up), so its "reopen fresh"
     * re-opened an already-open movy and this check never exercised a cold
     * restore at all. close() drives the modal, so this is now the real thing. */
    t.note('blob_afterTakes', await fixture.blobInfo());
    const lanesBefore = (await probe.auto()).lanes ?? [];
    t.note('lanesBeforeReopen', lanesBefore);

    /* WAIT FOR THE SAVE before closing. Movy persists on its own schedule
     * (~8 s of device time), so closing straight after the take can leave
     * nothing on disk to restore — indistinguishable from a broken restore
     * unless we check. This is the difference between "the test closed too
     * early" and "the restore is broken", and P3 exists to tell us the latter. */
    const mtimeBefore = await fixture.seqStateMtime();
    let saved = true;
    try {
        await until(t.bus, 'movy to persist the take',
            () => fixture.seqStateMtime(), (m) => m !== mtimeBefore,
            { within: 6000, every: 200 });
    } catch { saved = false; }
    t.note('persistedBeforeClose', saved);

    await dev.close(probe);
    t.note('blob_afterClose', await fixture.blobInfo());
    await dev.open(probe);
    await dev.selectTrack(0);
    await dev.tap.jog();                   // show the params → forces a render
    await t.bus.frames(ACT);

    /* WAIT for the registry rather than reading it once. It repopulates from
     * the engine's labels after the restore lands, not at the moment the UI
     * comes up, so a single read here is a race — it passed on one run and
     * reported [] on the next. Waiting is the whole point of the harness. */
    let after: any = { lanes: [] };
    try {
        after = await until(t.bus, 'the lane registry to repopulate',
            () => probe.auto(),
            (v: any) => Array.isArray(v.lanes) && v.lanes.length > 0,
            { within: 4000, every: 150 });
    } catch { after = await probe.auto(); }
    t.note('lanesAfterReopen', after.lanes);
    t.note('trackAfterReopen', after.track);
    /* P3 is the check the bash suite could not make.
     *
     * Its `Back x3` never closed movy, so "reopen fresh" re-opened an
     * already-open instance and the registry it asserted on had simply never
     * left memory. close() drives the Leave modal, so this is a real close.
     *
     * Two real causes were found making it fail, BOTH in the harness:
     *
     *  1. fixture.ensure destroyed its own fixture. verifyChains has to open
     *     movy, and movy SAVES on close — writing an emptier blob over the one
     *     just installed (au=1 cl=2 size=670 became au=0 cl=0 size=209). The
     *     fixture now gets the last word. The bash version has the same
     *     ordering and never showed it, because its close did not close.
     *
     *  2. OBSERVING THE RESTORE BROKE IT. Movy ferries the set through the
     *     overtake_dsp param SHM, a SINGLE SLOT, so a probe read during the
     *     restore starves it rather than merely slowing it — the registry came
     *     back empty from a blob that demonstrably held both lanes. open() now
     *     waits on movy's own log line, out of band over ssh. A probe-driven
     *     readiness gate made it worse and was removed rather than patched.
     *
     * The dot lands a moment after the registry, so it is waited for too.
     */
    t.check('p3-registry', 'the lane registry repopulated from restore',
        Array.isArray(after.lanes) && after.lanes.length > 0,
        { expected: 'a non-empty registry', actual: JSON.stringify(after.lanes) });

    /* And the dot shows on reopen WITHOUT re-touching a knob: registry-driven,
     * not touch-driven. */
    for (let i = 0; i < 3; i++) {
        const p = await probe.page();
        const named = (p.cells ?? []).filter((c: any) => c);
        if (named.length !== 1 || !/^PRESE/.test(named[0].name)) break;
        await dev.tap.jogTurn(1);
        await t.bus.frames(ACT);
    }
    /* The dot is registry-DRIVEN, and the registry repopulates a moment after
     * the page first draws — so the cell's automated flag lands later than the
     * cells themselves. Wait for it rather than reading once; a single read
     * here saw a fully-populated registry and a page with no dot on it. */
    let page: any = await probe.page();
    try {
        page = await until(t.bus, 'the automation dot to appear',
            () => probe.page(),
            (p: any) => (p.cells ?? []).some((c: any) => c && c.automated),
            { within: 3000, every: 150 });
    } catch { page = await probe.page(); }
    t.note('pageAfterReopen', page.cells);
    t.check('p3-dot', 'the dot shows on reopen without re-touching a knob',
        (page.cells ?? []).some((c: any) => c && c.automated),
        { expected: 'a cell with automated=true', actual: JSON.stringify(page.cells) });

    /* Leave the transport as we found it. */
    await dev.tap.cc(CC_PLAY);
    void CC_BACK;
});
