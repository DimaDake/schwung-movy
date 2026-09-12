/* Migrated from scripts/test-items.sh — item selectors: a ui_hierarchy level
 * carrying `items_param` + `select_param` instead of knobs, rendered as one
 * cell beside the preset cell, and driven here end to end through dexed's .syx
 * banks.
 *
 * WHY A DEVICE IS THE ONLY PLACE THIS CAN BE ANSWERED. Neither `syx_bank_list`
 * nor `syx_bank_index` appears in chain_params, so no module dump records them
 * — and a SYNTH slot's ui_hierarchy comes from the PLUGIN, not from
 * module.json (the movy-config contract learned the same split for hiermeta),
 * so even dexed's own module.json on the device declares nothing but `root`.
 * The local suites run against a hand-written fixture; only hardware says
 * whether a real module serves the contract in the shape movy assumes.
 *
 * DEXED IS THE SUBJECT, NOT A FIXTURE ID. MIGRATION.md rule 8 asks the fixture
 * for its synth, and the fixture's synth is plaits — which has no selector at
 * all, so asking for it would leave nothing to test. Dexed's `banks` level is
 * the reference implementation of the contract and its dsp.so carries the
 * items_param/select_param pair its module.json does not. What the fixture does
 * own here — the synth in the borrowed slot — is asked for, and restored.
 *
 * Covers:
 *   I1  dexed is loaded into the track's synth slot — the borrow the rest of
 *       the suite runs on, and the one failure that would make everything below
 *       prove nothing. Not the chain host's load trace alone: that says the
 *       request was delivered, not that a module came up (see the check)
 *   I2  a hierarchy was loaded after entering the knob page — and it describes
 *       something, because the empty one is logged for a track with no module
 *   I3  the module served a list movy could build a selector cell from
 *   I4  scrolling the picker writes NOTHING
 *   I5  the release commits exactly ONCE
 *   I6  the commit is followed by a re-read of the module
 *   I7  the chosen item STUCK
 *
 * What the bash suite spent on `sleep`: 4 s waiting for dexed's .syx scan to
 * settle, 1.5 s for the knob page, 0.3/0.6/1.5 s around the touch-scroll-release
 * and another 1.5 s for the re-read. Every one is now a wait on the thing it
 * stood in for.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scenario } from '../runner.js';
import { Device } from '../device.js';
import { Probe } from '../probe.js';
import * as fixture from '../fixture.js';
import { until } from '../wait.js';

const run = promisify(execFile);
/* test-device/dist/scenarios/items.js at run time. */
const MOVY = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const MODULE     = 'dexed';           // see the header: the contract's reference
const SELECT_KEY = 'syx_bank_index';  // dexed's `banks` level (items_param syx_bank_list)
/* Knob 1 / note 0. A selector has no chain_params entry and its level declares
 * no knobs, so it is spliced in immediately LEFT of the preset cell — index 0
 * of dexed's Main page. The reference run's own commit line confirms the cell
 * (`set slot=0 gi=0 key=synth:syx_bank_index …`). */
const KNOB       = 0;

/* Frames of device work, never a wall clock. DETENT is the ~60 ms spacing the
 * bash suite's inject-burst used between detents. */
const ACT    = 90;
const DETENT = 20;
const DETENTS = 4;

/* The engine's chain-load trace — one line per load, written by the SHIM sink,
 * so unlike movy's own lines it is NOT doubled and takes no sink filter. */
const CHAIN_LOADED = `chain 0: synth = ${MODULE}`;

/* MOVY'S OWN LINES, narrowed to ONE sink — and narrowed on this side of the
 * ssh call, not inside the grep pattern.
 *
 * Every one of them reaches debug.log TWICE — once from the shadow context
 * (`[DEBUG] [shadow] [movy]`) and once from the move-shim
 * (`[INFO ] [move-shim] [movy]`). reselect.ts only ever asks whether a count
 * GREW, which the doubling cannot disturb; this suite COUNTS COMMITS, where it
 * decides between "one write" and "two". Reading one sink is exact, and unlike
 * the bash suite's awk pass it needs no de-duplication window to stay honest.
 *
 * The filter cannot live in the pattern: a commit line is
 * `… [shadow] [movy] set slot=0 gi=0 key=synth:syx_bank_index val=1`, so a
 * pattern of "the sink, then the payload" never matches — the payload is not
 * what follows the prefix. Matching the payload alone and keeping the lines the
 * shadow wrote is the same discrimination without that assumption, and it drops
 * the BRE bracket escaping (the pattern goes into a single-quoted shell string)
 * that got this wrong twice. */
const SHADOW = '[shadow]';
const HIER   = 'loadHierarchy:';
/* The page-build summary movy logs for a hierarchy that has params in it, e.g.
 * `loadHierarchy: 173 params, 29 banks`. A track with no module on it never
 * reaches it — see I2. */
const REAL_HIER = /loadHierarchy: [1-9]\d* params,/;
/* The cell movy renders for a module that carries presets, and the one thing a
 * page read off a FAILED load cannot show — see I1. */
const PRESET_CELL = 'preset';
type KnobCell = { name?: string; value?: string; style?: string } | null;
const SEL    = `items selector ${SELECT_KEY}`;
const COMMIT = `key=synth:${SELECT_KEY} val=`;

const last = (ls: string[]): string => (ls.length ? ls[ls.length - 1] : '');
/* A field out of one of those lines. The leading separator keeps `n=` from
 * matching inside a longer token. */
const field = (line: string, name: string): string =>
    (line.match(new RegExp('(?:^| )' + name + '=(-?[0-9]+)')) ?? [])[1] ?? '';

scenario('items', async (t) => {
    fixture.setHost(t.host);
    const dev   = new Device(t.bus, t.agent, t.host);
    const probe = new Probe(t.bus);
    const open  = () => dev.open(probe);
    const close = () => dev.close(probe);

    /* A movy track's chain lives in movy's OWN engine and is unloaded with it,
     * which is why both the borrow and the restore are written through
     * `ch0:synth:module` and while movy is open: writing schwung's slot 0, or
     * writing at all with movy closed, loads the module somewhere the track is
     * not. */
    const ep = async (key: string, value: string): Promise<void> => {
        await run('node', [join(MOVY, 'scripts', 'engine-param.mjs'),
                           'set', key, value, t.host], { maxBuffer: 8 * 1024 * 1024 });
    };
    const log    = async (msg: string) => (await dev.logLines(msg)).filter((l) => l.includes(SHADOW));
    const count  = async (msg: string) => (await log(msg)).length;
    const lastOf = async (msg: string) => last(await log(msg));

    await fixture.ensure(t.bus, open, close);
    await dev.deployUi();
    await dev.open(probe);
    await dev.selectTrack(0);

    /* What the borrowed slot goes back to. Asked for, never written down. The
     * fixture has already confirmed it is what the chain holds (`verifyChains`),
     * so there is no read to race here. */
    const PREV = fixture.fixtureSynth(0);
    t.note('fixtureSynth', PREV);
    t.need.register(async () => { await ep('ch0:synth:module', PREV); });

    /* Baseline counts, taken before the module is borrowed. debug.log PERSISTS
     * across runs — the bash suite cleared it, this reads the same file the
     * last run wrote to — so every count below is a DELTA, never an absolute. */
    const hierBefore = await count(HIER);
    const selBefore  = await count(SEL);

    // ── I1: the module the rest of the suite runs on ─────────────────────────
    /* A load into a chain the host has not been configured for is DROPPED
     * rather than deferred, so this is the one setup step whose failure would
     * make everything below prove nothing.
     *
     * THE TRACE IS NOT PROOF THE MODULE LOADED. chain_slots.rs logs
     * `chain {slot}: {component} = {module}` from `req.module` at the END of the
     * load path, whatever the dlopen did — measured: a module id that is not
     * installed logs the identical line, and the engine has no other line to
     * offer (nothing is logged on a failed load). So the trace gates on the
     * write having been delivered and the load path having run, and the EFFECT
     * is asked of movy's page for the track. Both halves are one check because
     * both are one fact.
     *
     * The effect is read as a PRESET cell, which is the discriminator that
     * survives a failed load. Movy's page for a track whose module did not come
     * up is not empty — it is STALE, still describing whatever the fixture had
     * there (plaits: ENGI/HARM/TIMB/MRPH/…, measured), which is why an earlier
     * form of this check that asked only for a non-empty page passed on a load
     * of a module that is not installed. Dexed's page carries a preset cell and
     * plaits' does not, so a stale read cannot satisfy it and the wait runs
     * until the borrowed module's page is the one being shown. The chain's own
     * name was tried first and does not answer: `bus.getParam` reaches the
     * engine's namespace, not a chain port's. */
    const loadBefore = (await dev.logLines(CHAIN_LOADED)).length;
    await ep('ch0:synth:module', MODULE);
    let loaded = true;
    try {
        await until(t.bus, `chain 0 to load ${MODULE}`,
            () => dev.logLines(CHAIN_LOADED), (ls) => ls.length > loadBefore,
            { within: 4000, every: 120 });
    } catch { loaded = false; }
    t.note('chainLoadLines', (await dev.logLines(CHAIN_LOADED)).length);

    let pageCells: KnobCell[] = [];
    const hasPreset = (cs: KnobCell[]) => cs.some((c) => c?.style === PRESET_CELL);
    try {
        pageCells = await until(t.bus, 'the page for the borrowed module',
            async () => ((await probe.page()).cells ?? []) as KnobCell[],
            hasPreset, { within: 4000, every: 150 });
    } catch { /* the check below reports what is missing */ }
    const realPage = hasPreset(pageCells);
    t.note('pageCells', pageCells);
    t.check('module-loaded', `${MODULE} is loaded into the track's synth slot`,
        loaded && realPage,
        { expected: `a "${CHAIN_LOADED}" line in the device log AND a page for ${MODULE}`,
          actual: !loaded ? 'the chain host never ran its load path'
                : !realPage ? 'the load path ran but movy\'s page for the track is not the '
                           + `borrowed module's (cells: ${JSON.stringify(pageCells)})`
                : 'the chain reported the load and the page came up' });

    // ── I2: entering the knob page loads a hierarchy ─────────────────────────
    /* One jog click: chain → knobs. Load-bearing for everything below, because
     * the knob handlers only run on the knob page.
     *
     * The wait is on the BARE `loadHierarchy:` pattern, not on a module name.
     * Dexed reports the LOADED PATCH there rather than its id — the reference
     * run's own line is `loadHierarchy: slot=0 module=Say Again.` — so a
     * `module=dexed` predicate would never match.
     *
     * AN EMPTY HIERARCHY DOES NOT COUNT. movy rebuilds for a track with nothing
     * on it too, and logs `loadHierarchy: ui_hierarchy null — no params` or
     * `loadHierarchy: slot=0 module=—` — measured on the same failed load that
     * fooled I1, which is what "a loadHierarchy line appeared" was satisfied by.
     * The fact I2 wants is a hierarchy that DESCRIBES something, so the wait is
     * on the page-build summary (a parameter count) rather than on the arrival
     * of any line. */
    await dev.tap.jog();
    const realHier = async () =>
        (await log(HIER)).slice(hierBefore).filter((l) => REAL_HIER.test(l));
    let hierLine = '';
    try {
        const ls = await until(t.bus, 'the hierarchy to be loaded',
            realHier, (v) => v.length > 0, { within: 2500, every: 150 });
        hierLine = last(ls);
    } catch { /* the check below reports what is missing */ }
    t.note('hierarchyLine', hierLine);
    t.check('hierarchy-loaded', 'a hierarchy was loaded after entering the knob page',
        hierLine !== '',
        { expected: 'a new "loadHierarchy:" line after the module was borrowed, '
                  + 'describing something',
          actual: hierLine || `no new "loadHierarchy:" line describing a module `
                + `(${await count(HIER)} in the log, ${hierBefore} before the load; nothing `
                + `since has described one)` });

    // ── I3: the real module served a list movy could build a cell from ───────
    let selLine = '';
    try {
        selLine = await until(t.bus, 'the selector cell to be built',
            async () => (await count(SEL)) > selBefore ? await lastOf(SEL) : '',
            (l) => l !== '', { within: 2500, every: 150 });
    } catch { /* the check below reports what is missing */ }
    t.note('selectorLine', selLine);
    const n = Number(field(selLine, 'n'));
    t.check('selector-built', "the module served a list movy could build a cell from",
        n >= 1,
        { expected: `an "items selector ${SELECT_KEY} n=>=1" line`,
          actual: selLine || `no "items selector ${SELECT_KEY}" line at all — `
                           + 'dexed served no usable items list' });

    /* WHERE THE CELL THIS SUITE DRIVES IS, as a note rather than a check: it is
     * the evidence for `KNOB`. A selector has no chain_params entry and its
     * level declares no knobs, so it is spliced in immediately LEFT of the
     * preset cell — index 0, which is knob 1. Read HERE, immediately before the
     * touch, because the page the touch acts on is the one this has to describe;
     * a page read earlier would only be the same page by assumption. */
    const touchCells = ((await probe.page()).cells ?? []) as KnobCell[];
    t.note('selectorCell', touchCells[0] ?? null);

    // ── I4 / I5: touch opens the picker, detents scroll, release writes ──────
    /* Snapshot AFTER the page is up: these are the two counts the release is
     * measured against, and taking them earlier would count the page build. */
    const selCountBefore   = await count(SEL);
    const commitsBefore    = await count(COMMIT);
    const hierBeforeCommit = await count(HIER);
    /* Evidence the detents below MOVE the selection rather than leaving it where
     * it was — an `val=` that matches `cur=` proves nothing if neither changed. */
    t.note('selectorBeforeTouch', await lastOf(SEL));

    let duringScroll = -1;
    await dev.knobHold(KNOB, async () => {
        /* The overlay is opened by the TOUCH, so the detents have to arrive
         * after it. The ring preserves order and movy drains it in order. */
        await t.bus.frames(ACT);
        for (let i = 0; i < DETENTS; i++) {
            await dev.tap.knob(KNOB, 1);
            await t.bus.frames(DETENT);
        }
        /* Read INSIDE the hold: this is the count the release has not yet
         * contributed to, and the only moment the two facts are separable. The
         * ssh round trip it costs is the wait the bash suite spelled
         * `sleep 0.6`. Holding this knob long arms no hold-to-modulate — a
         * selector is `automatable: false` (items-param.ts), which is what
         * lfo/assign-mode.ts requires. */
        duringScroll = await count(COMMIT);
    });
    const scrolled = duringScroll - commitsBefore;
    t.note('commitsWhileScrolling', scrolled);
    t.check('scroll-writes-nothing', 'scrolling the picker writes nothing',
        scrolled === 0,
        { expected: '0 commits with the picker open and scrolling',
          actual: `${scrolled} commit(s) — without the overlay each detent would `
                + 'be its own set_param, and each one loads a whole bank' });

    /* Wait for the commit to LAND, then let device work pass before counting. A
     * release that wrote twice would write both in the same commit path, so
     * counting at the first sign of one would report "exactly once" about a
     * double write. */
    let commitLine = '';
    try {
        commitLine = await until(t.bus, 'the release to commit',
            async () => (await count(COMMIT)) > commitsBefore ? await lastOf(COMMIT) : '',
            (l) => l !== '', { within: 2000, every: 150 });
    } catch { /* the check below reports what landed */ }
    await t.bus.frames(ACT);
    const committed = (await count(COMMIT)) - commitsBefore;
    t.note('commitsOnRelease', committed);
    t.check('commit-once', 'the release commits exactly once',
        committed === 1,
        { expected: 'exactly 1 commit on release', actual: `${committed}` });

    // ── I6: the commit is followed by a re-read ──────────────────────────────
    /* Choosing a bank resets the preset to the first of the new bank, so movy's
     * cached preset count/names are stale until it re-reads the module. */
    let rereadLine = '';
    try {
        rereadLine = await until(t.bus, 'the module to be re-read after the commit',
            async () => (await count(HIER)) > hierBeforeCommit ? await lastOf(HIER) : '',
            (l) => l !== '', { within: 3000, every: 150 });
    } catch { /* the check below reports what is missing */ }
    t.note('rereadLine', rereadLine);
    t.check('reread-after-commit', 'the module is re-read after the commit',
        rereadLine !== '',
        { expected: 'a "loadHierarchy:" line after the commit',
          actual: rereadLine || 'no loadHierarchy after the commit — the preset list stays stale' });

    // ── I7: the chosen item STUCK ────────────────────────────────────────────
    /* Writing the index is not the same as the module accepting it. obxd refused
     * every bank whose .fxb carried no <?xml prolog: v2_load_bank returned -1,
     * v2_switch_bank left current_bank alone, and the cell snapped back to the
     * first item — which reads exactly like "movy reset my bank". I4 and I5 pass
     * throughout, because both only ever ask whether movy WROTE.
     *
     * `cur=` is the module's own read-back, taken on the re-read after the
     * commit — so this needs a THIRD count, of the selector line, and a wait on
     * it: reading before the re-read lands would compare a stale value. */
    let reopened = '';
    try {
        reopened = await until(t.bus, 'the re-read to report the selection',
            async () => (await count(SEL)) > selCountBefore ? await lastOf(SEL) : '',
            (l) => l !== '', { within: 3000, every: 150 });
    } catch { /* the check below reports what is missing */ }
    const wrote = field(commitLine, 'val');
    const back  = field(reopened, 'cur');
    t.note('writtenValue', wrote);
    t.note('readBackValue', back);
    t.check('selection-stuck', 'the item movy chose is the item the module reports',
        wrote !== '' && back !== '' && wrote === back,
        { expected: `the module's own read-back to equal the value movy wrote (val=${wrote || '?'})`,
          actual: wrote === ''
                ? `no commit line to read a value from (${commitLine || 'none'})`
              : back === ''
                ? `no re-read to read the selection back from (${reopened || 'none'})`
              : wrote === back
                ? `stuck at ${back}`
              : `reverted: wrote ${wrote}, module reports ${back} (item refused to load?)` });
});
