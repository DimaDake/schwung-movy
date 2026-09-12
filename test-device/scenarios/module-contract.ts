/* Migrated from scripts/test-module-contract.sh — the generic module-interaction
 * contract: idle/trigger one-shot knobs, and `knob_acceleration: "wide"`.
 *
 * Neither behaviour is visible as pixels, so the bash suite read movy's debug
 * log: `trigger slot=<s> key=<comp>:<key> val=<idle|trigger>` for the one-shot,
 * and the ordinary `set slot=<s> gi=<n> key=<comp>:<key> val=<n>` for a knob
 * write. Both are still the signal here — they are the only read-back either
 * behaviour has — but they are read as DELTAS off the device log rather than
 * parsed out of a flattened, de-duplicated dump.
 *
 * THE MODULE IS THE SUBJECT, NOT A FIXTURE ID. MIGRATION.md rule 8 asks the
 * fixture for its synth; the fixture's synth is plaits, whose knobs are neither
 * a trigger nor `wide`, so asking for it would leave nothing to test. Smack is
 * the reference implementation of both halves of this contract — its root page
 * carries `reroll` (an idle/trigger enum) and `seed` (1..9999, wide) on the
 * same page — and it is borrowed into the track's FX 1 and handed back. Which
 * knob is which is not written down either: the page is asked, by cell name,
 * once it is up.
 *
 * WHERE THE TIME WENT. The bash suite spent ~7 s of `sleep`, one in front of
 * nearly every read, because a trigger's only answer is a log line. Each is now
 * a wait on the thing it stood for: the burst being CONSUMED (a knobCC count),
 * the trigger writes appearing, the seed writes landing. Two fixed sleeps also
 * had to be re-sized rather than removed — both were covering a real interval
 * and a frames budget states it as device work instead of a wall clock.
 *
 * WHAT CHANGED BEYOND THE MECHANICS:
 *   - `smack loaded into FX 1` was `pass "$MODULE loaded into FX 1"`, a bare
 *     unconditional pass sitting right after the load. It now asserts what its
 *     label claims: the chain host ran its load path for the slot AND movy's
 *     page for the slot is the borrowed module's (a failed load leaves a STALE
 *     page — see the check).
 *   - `Hierarchy loaded (chain chainIndex=2)` printed the chain selection but
 *     asserted only that SOME hierarchy line had appeared. Both halves are now
 *     asserted, because a build summary alone does not say whose chain built.
 *   - every `movylog | grep` is scoped to ONE sink. Movy's own lines reach
 *     debug.log twice (shadow_ui's writer and the unified-log pipe), which is
 *     exactly what the bash awk's millisecond de-duplication window was working
 *     around; reading the shadow sink is exact and asserts nothing about timing.
 *   - the page is read through the probe, not reconstructed from the render
 *     dump (`RE-RO:a1t0=-`). The dump is throttled to changes; the probe reads
 *     the live view model.
 *   - `no automation lane bound to the trigger` grepped for a log line movy
 *     never writes. It now reads the lane registry. See the check.
 *
 * Covers:
 *   C1  smack is loaded into the track's FX 1
 *   C2  a hierarchy was loaded after navigating to FX 1
 *   C3  one clockwise gesture fires exactly once
 *   C4  CW fires, CCW sends idle, CW re-fires (re-armed)
 *   C5  a pause past the reset window re-arms without a CCW turn
 *   C6  no automation lane is bound to the trigger
 *   C7  no automation dot is drawn on the trigger knob
 *   C8  deliberate turns move exactly one step
 *   C9  a fast sweep travels far
 *   C10 the same burst on a non-wide param is unaffected
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
/* test-device/dist/scenarios/module-contract.js at run time. */
const MOVY = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/* The borrowed module and the slot it goes in. Tracks 1-16 are all movy chains,
 * so component operations go through `ch<track>:<comp>:module` — writing a
 * schwung slot, or writing at all with movy closed, loads a module the track
 * does not read. */
const MODULE = 'smack';
const SLOT   = 'fx1';

/* Frames of device work, never a wall clock. A frame is the shim's SPI period
 * (~2.9 ms). */
/* After a gesture, for movy to have noticed it and rendered. */
const ACT    = 90;
/* The ~60 ms detent spacing the bash suite's `burst` used, and what makes a
 * rapid run of turns ONE hand movement rather than several. */
const DETENT = 20;
/* The fast sweep's spacing. The bash suite's `burst` delivered its detents
 * 25 ms apart INSIDE one ssh call; here each is its own round trip, so the same
 * 25 ms would arrive tens of ms later than the tier it was aimed at. Tuned down
 * to land in the accelerated part of the wide curve with margin: measured at
 * 10 frames (+50 a turn, the <= 90 ms tier), which the >200 gate below clears
 * either way — the tier above it (<= 35 ms) is worth 250 a turn, and the one
 * below (<= 180 ms) still 10. A device slower than all three would be a device
 * whose knobs are broken. */
const SWEEP  = 6;
/* Past TRIGGER_REARM_MS (700 ms), which is what re-arms a latched trigger on a
 * pause — and past the wide curve's slowest accelerated tier (180 ms), which is
 * what makes two deliberate turns two SINGLE steps. The bash suite spelled both
 * as `sleep 1.2`; one budget covers both because one interval is what it is. */
const PAUSE  = 300;

/* MOVY'S OWN LINES, narrowed to ONE sink.
 *
 * Every one of them reaches debug.log TWICE — once from the shadow context
 * (`[DEBUG] [shadow] [movy]`) and once from the move-shim
 * (`[INFO ] [move-shim] [movy]`). The bash suite counted EVENTS and had to
 * de-duplicate by message within 5 ms, because the two sinks can land a
 * millisecond apart; reading one sink is exact and needs no window at all.
 *
 * The filter is applied on this side of the ssh call and not inside the grep
 * pattern: a commit line reads `… [shadow] [movy] set slot=0 gi=7 key=fx1:seed
 * val=1`, so a pattern of "the sink, then the payload" never matches — the
 * payload is not what follows the prefix. */
const SHADOW = '[shadow]';

/* The engine's chain-load trace — written by the SHIM sink, so unlike movy's
 * own lines it is not doubled. */
const CHAIN_LOADED = `chain 0: ${SLOT} = ${MODULE}`;

const HIER = 'loadHierarchy:';
/* The page-build summary movy logs for a hierarchy that has params in it, e.g.
 * `loadHierarchy: 30 params, 6 banks`. A track with no module never reaches it
 * (`loadHierarchy: ui_hierarchy null — no params`), so the wait is on a page
 * that DESCRIBES something rather than on the arrival of any line. */
const REAL_HIER = /loadHierarchy: [1-9]\d* params,/;

/* A knob turn movy consumed, and the three write paths under test. */
const KNOB_CC  = 'knobCC k=';
const TRIGGER  = 'trigger slot=';
const SEED_SET = `key=${SLOT}:seed val=`;
const LOOP_SET = `key=${SLOT}:loop_len val=`;
/* The chain selection movy logs after a jog turn at the chain view. FX 1 is
 * index 2 in movy's chain model — [midi_fx1, synth, fx1, fx2, lfo, mix], with a
 * track's index starting on its synth — which is where the borrowed module
 * went, so it is where the navigation has to land. */
const CHAIN_IDX = 'chain chainIndex=';
const FX1_CHAIN_INDEX = 2;

/* HOW LONG A LOG WAIT MAY RUN. A frame budget like every other wait, sized so a
 * device that never answers costs bounded wall time instead of a stall. The ssh
 * grep behind each poll is out of band and costs ~350 ms of real time, so this
 * is ~8 polls — the bash suite spent a flat 1.0-1.5 s sleep on the same fact. */
const LOG_WAIT = { within: 240, every: 30 };

/* THE TRIGGER'S WRITES, IN ORDER: `trigger slot=0 key=fx1:reroll val=1`.
 * Smack reports enums in INDEX form, so a fire writes val=1 and the
 * counter-clockwise re-arm writes val=0 (enum-value.ts picks the format the
 * module itself uses). */
const rerollSeq = (lines: string[]): string[] =>
    lines.map((l) => (l.match(/:reroll val=(\S+)/) ?? [])[1])
         .filter((v): v is string => v !== undefined);

/* The values a knob's writes carried, in order. */
const valuesOf = (lines: string[], key: string): number[] =>
    lines.map((l) => Number((l.match(new RegExp(`key=${key} val=(\\d+)`)) ?? [])[1]))
         .filter((n) => Number.isFinite(n));

const last = <T>(xs: T[]): T | null => (xs.length ? xs[xs.length - 1] : null);

/* A page cell, as the probe reports it. `name` is the SHORT label movy renders,
 * which is NOT the label a module dump records: shorten.ts fits it to a pixel
 * budget, and smack's Re-Roll comes out "RE-ROL" on the device where
 * docs/module-dump has "RE-RO". So cells are matched on the letters of the
 * label with the truncation and the hyphen folded out — the stem is what
 * survives a budget change, and the exact string is not. */
type Cell = { name?: string; value?: string; automated?: boolean; touched?: boolean } | null;
const stem = (s: string | undefined): string => (s ?? '').toLowerCase().replace(/[^a-z]/g, '');
const cellNamed = (cs: Cell[], s: string): Cell =>
    cs.find((c) => stem(c?.name).startsWith(s)) ?? null;
const hasCells = (cs: Cell[], names: string[]) => names.every((n) => cellNamed(cs, n) !== null);

scenario('module-contract', async (t) => {
    fixture.setHost(t.host);
    const dev   = new Device(t.bus, t.agent, t.host);
    const probe = new Probe(t.bus);
    const open  = () => dev.open(probe);
    const close = () => dev.close(probe);

    /* A movy ENGINE param write, over the WebSocket the remote UI exposes. NOT
     * the test bus: real traffic for the thing under test. */
    const ep = async (key: string, value: string): Promise<void> => {
        await run('node', [join(MOVY, 'scripts', 'engine-param.mjs'),
                           'set', key, value, t.host], { maxBuffer: 8 * 1024 * 1024 });
    };

    const shadow = async (pat: string): Promise<string[]> =>
        (await dev.logLines(pat)).filter((l) => l.includes(SHADOW));
    const count  = async (pat: string): Promise<number> => (await shadow(pat)).length;

    /* Wait for `pat`'s line count to grow by `n` past `before`, and RETURN THE
     * NEW LINES — the count is already in hand, so a second read would be a
     * second ssh for a fact this one has.
     *
     * It reports what arrived and nothing else; the checks say what is missing.
     * A read that comes back SHORTER than `before` is a dropped connection, not
     * a log that shrank, and is ignored rather than believed. */
    const newLines = async (pat: string, before: number, n: number, what: string): Promise<string[]> => {
        let seen: string[] = [];
        const read = async () => {
            const ls = await shadow(pat);
            if (ls.length >= before) seen = ls;
            return seen;
        };
        try {
            await until(t.bus, what, read, (v) => v.length - before >= n, LOG_WAIT);
        } catch { /* the check that wanted these lines reports what is missing */ }
        return seen.slice(before);
    };

    await fixture.ensure(t.bus, open, close);
    await dev.deployUi();
    await dev.open(probe);
    await dev.selectTrack(0);

    /* What the borrowed slot goes back to. Asked of the fixture, never written
     * down: track 0's chain declares a synth and nothing else, so FX 1 is empty
     * and that is what it is handed back as. */
    const FX1_PREV = fixture.chainEntries()
        .find((e) => e.track === '0' && e.comp === SLOT)?.mod ?? '';
    t.note('fx1Before', FX1_PREV || '<empty>');
    t.need.register(async () => { await ep(`ch0:${SLOT}:module`, FX1_PREV); });

    /* Baselines, taken before the module is borrowed. debug.log PERSISTS across
     * runs — the bash suite cleared it, this reads the same file the last run
     * wrote to — so every count below is a DELTA, never an absolute. */
    const hierBefore = await count(HIER);

    // ── C1: the module the rest of the suite runs on ─────────────────────────
    const loadBefore = (await dev.logLines(CHAIN_LOADED)).length;
    await ep(`ch0:${SLOT}:module`, MODULE);
    let loaded = true;
    try {
        await until(t.bus, `chain 0 ${SLOT} to load ${MODULE}`,
            () => dev.logLines(CHAIN_LOADED), (ls) => ls.length > loadBefore,
            { within: 4000, every: 120 });
    } catch { loaded = false; }
    t.note('chainLoadLines', (await dev.logLines(CHAIN_LOADED)).length);

    // ── Navigate chain → FX 1 → knobs ────────────────────────────────────────
    /* One jog detent moves the chain selection from the synth to FX 1; the jog
     * click enters that module's knob page. */
    const chainBefore = await count(CHAIN_IDX);
    await dev.tap.jogTurn(1);
    await t.bus.frames(ACT);
    await dev.tap.jog();
    await t.bus.frames(ACT);

    /* THE TRACE IS NOT PROOF THE MODULE LOADED. chain_slots.rs logs
     * `chain {slot}: {component} = {module}` from the requested id at the END of
     * the load path, whatever the dlopen did — an id that is not installed logs
     * the identical line. So the trace gates on the write having been delivered
     * and the load path having run, and the EFFECT is asked of movy's page for
     * the slot.
     *
     * The effect is the page's own module name, which catches the failure the
     * trace cannot: a load that did not come up leaves movy showing the
     * PREVIOUS module's page rather than an empty one, so "the page is not
     * empty" would pass on it — and `page.module` names that previous module.
     * The three cells this suite drives are required with it: they are what
     * makes the rest of the run mean anything, and they are located by label
     * stem rather than by index, so a knob re-ordered in the module's own
     * metadata moves them instead of silently driving another parameter. */
    const CELLS_FOR = ['rer', 'loop', 'seed'];
    type Page = { cells?: Cell[]; module?: string; pageIndex?: number };
    let pg: Page = {};
    try {
        pg = await until(t.bus, `the page for ${MODULE}`,
            async () => (await probe.page()) as Page,
            (p) => p.module === MODULE && hasCells((p.cells ?? []) as Cell[], CELLS_FOR),
            { within: 4000, every: 150 });
    } catch { pg = (await probe.page()) as Page; }
    const cells: Cell[] = (pg.cells ?? []) as Cell[];
    const realPage = pg.module === MODULE && hasCells(cells, CELLS_FOR);
    t.note('pageModule', pg.module);
    t.note('pageCells', (pg.cells ?? []).map((c) => c?.name));
    t.check('module-loaded', `${MODULE} is loaded into the track's ${SLOT}`,
        loaded && realPage,
        { expected: `a "${CHAIN_LOADED}" line in the device log AND movy's page for the `
                  + `track naming ${MODULE} with the knobs this suite drives on it`,
          actual: !loaded ? 'the chain host never ran its load path'
                : !realPage ? `the load path ran but movy is showing `
                           + `"${pg.module ?? 'nothing'}" `
                           + `(${(pg.cells ?? []).map((c) => c?.name).filter(Boolean).join(' ') || 'an empty page'})`
                           + ' — a failed load leaves the PREVIOUS module\'s page up'
                : 'the chain reported the load and the module\'s page came up' });

    /* The knobs the rest of the suite drives, read off the page that came up. */
    const REROLL = cells.indexOf(cellNamed(cells, 'rer'));
    const SEED   = cells.indexOf(cellNamed(cells, 'seed'));
    const LOOP   = cells.indexOf(cellNamed(cells, 'loop'));
    t.note('knobs', { reroll: REROLL, seed: SEED, loop: LOOP });

    // ── C2: entering the knob page loads the module's hierarchy ──────────────
    /* TWO HALVES OF ONE FACT — "navigating to FX 1 loaded its hierarchy": the
     * navigation, and the build. Neither alone is the fact. The build summary
     * appears for a chain refresh too, so on its own it does not say WHICH
     * chain built; and landing on the synth would load the fixture's plaits
     * just as happily. C1 ties the pair to the borrowed module. */
    const chainIdx = last(await newLines(CHAIN_IDX, chainBefore, 1, 'the chain selection to move'))
        ?.match(/chainIndex=(-?\d+)/)?.[1];
    const onFx1 = Number(chainIdx) === FX1_CHAIN_INDEX;
    t.note('chainIndex', chainIdx);

    const realHier = async () =>
        (await shadow(HIER)).slice(hierBefore).filter((l) => REAL_HIER.test(l));
    let hierLine = '';
    try {
        const ls = await until(t.bus, 'the hierarchy to be loaded',
            realHier, (v) => v.length > 0, LOG_WAIT);
        hierLine = last(ls) ?? '';
    } catch { /* the check below reports what is missing */ }
    t.note('hierarchyLine', hierLine);
    t.check('hierarchy-loaded', `a hierarchy was loaded after navigating to ${SLOT.toUpperCase()}`,
        onFx1 && hierLine !== '',
        { expected: `the chain selection to reach index ${FX1_CHAIN_INDEX} (${SLOT}) and a new `
                  + '"loadHierarchy:" line describing a module',
          actual: !onFx1 ? `the chain selection was index ${chainIdx ?? 'unreported'}, not `
                        + `${FX1_CHAIN_INDEX} — the jog turn did not reach ${SLOT}`
                : hierLine || `no new "loadHierarchy:" line describing a module `
                + `(${await count(HIER)} in the log, ${hierBefore} before the load)` });

    // ── C3: one fire per clockwise gesture ───────────────────────────────────
    const ccPat = KNOB_CC + REROLL;
    const ccBefore   = await count(ccPat);
    const trigBefore = await count(TRIGGER);

    for (let i = 0; i < 4; i++) {
        await dev.tap.knob(REROLL, 1);
        await t.bus.frames(DETENT);
    }
    /* Wait for the BURST TO BE CONSUMED. The four detents are one gesture, and
     * the whole claim is about what one gesture does — so the wait is on the
     * turns arriving, not on the fire, which would let a device that processed
     * one detent report "one fire" about the other three. */
    /* Waited for the guard's floor, not for all four: a device that merges two
     * detents into one tick is still a device where the gesture was consumed,
     * and the check reports the count it actually saw either way. */
    const ncc  = (await newLines(ccPat, ccBefore, 3, 'the burst to be consumed')).length;
    const seq1 = rerollSeq(await newLines(TRIGGER, trigBefore, 1, 'the fire'));

    t.note('burstDetents', ncc);
    t.note('burstTriggers', seq1);
    /* `ncc >= 3` is the vacuity guard the bash suite also carried: one detent
     * would fire once trivially, and the claim is that a RAPID run of turns
     * still fires once. */
    t.check('gesture-fires-once', 'one clockwise gesture fires exactly once',
        ncc >= 3 && seq1.filter((v) => v === '1').length === 1,
        { expected: '>=3 detents and exactly 1 fire',
          actual: `${ncc} detent(s) → ${seq1.filter((v) => v === '1').length} fire(s)`
                + (ncc < 3 ? ' — fewer than 3 detents arrived as separate turns, so this proved nothing'
                           : ` (writes: ${seq1.join(',') || 'none'})`) });

    // ── C4: a counter-clockwise turn re-arms ─────────────────────────────────
    /* The latch holds the rest of the same hand movement, so the second CW
     * detent of the first run must NOT fire; the counter-clockwise turn is what
     * releases it. The CCW has to arrive before the 700 ms debounce expires on
     * its own (or it would log nothing, and the sequence would read 1,1) — ACT
     * is ~260 ms, comfortably inside it. */
    const seqBefore = await count(TRIGGER);
    for (let i = 0; i < 2; i++) { await dev.tap.knob(REROLL, 1);  await t.bus.frames(DETENT); }
    await t.bus.frames(ACT);
    await dev.tap.knob(REROLL, -1);
    await t.bus.frames(ACT);
    for (let i = 0; i < 2; i++) { await dev.tap.knob(REROLL, 1);  await t.bus.frames(DETENT); }

    const seq2 = rerollSeq(await newLines(TRIGGER, seqBefore, 3, 'the three trigger writes')).join(',');
    t.note('rearmSequence', seq2);
    t.check('rearm-sequence', 'CW fires, CCW sends idle, CW re-fires (re-armed)',
        seq2 === '1,0,1',
        { expected: '1,0,1', actual: seq2 || 'no trigger writes at all' });

    // ── C5: a pause past the reset window re-arms with no CCW turn ───────────
    const pauseBefore = await count(TRIGGER);
    await dev.tap.knob(REROLL, 1);
    await t.bus.frames(PAUSE);
    await dev.tap.knob(REROLL, 1);

    const seq3 = rerollSeq(await newLines(TRIGGER, pauseBefore, 2, 'two fires across the pause'));
    const fires = seq3.filter((v) => v === '1').length;
    t.note('pauseWrites', seq3);
    t.check('pause-rearms', 'a pause past the reset window re-arms (no CCW turn needed)',
        fires === 2,
        { expected: 'exactly 2 fires across the pause', actual: `${fires} (writes: ${seq3.join(',') || 'none'})` });

    // ── C6 / C7: a trigger offers no automation lane and draws no dot ────────
    await dev.tap.knob(REROLL, 1);
    await t.bus.frames(ACT);

    /* THE REGISTRY, not a log grep.
     *
     * The bash condition was `qgrep -E "knob_[0-9]+_set .*reroll"` over movy's
     * own lines — and movy emits no such line: `applyLaneMapping` writes
     * `knob_<N>_set` straight to the chain port with no mlog
     * (src/seq/lane-mapping.ts), so that arm could never match and this check
     * passed whatever the code did. What a bound lane IS is an entry in the UI's
     * automation registry, so that is what is read — `probe.auto()` returns each
     * lane's param key, which for a chain param is its io key.
     *
     * The registry is also the reason a bound lane is the failure this catches:
     * `reroll` is declared `automatable: false`, and `handleAutomationKnob`
     * refuses to bind a lane for a param that is not automatable. */
    const lanes = ((await probe.auto()).lanes ?? []) as string[];
    t.note('lanes', lanes);
    t.check('no-lane-bound', 'no automation lane is bound to the trigger',
        !lanes.some((l) => stem(l).startsWith('rer')),
        { expected: 'a lane registry with no reroll lane',
          actual: `registry holds [${lanes.join(' ') || 'nothing'}]` });

    /* The dot, read off the page rather than out of the render dump. The bash
     * grepped `RE-RO:a[1-9]` from a line movy flattens its view model into; the
     * probe carries the same per-cell flag, live. The CELL IS REQUIRED: a dot
     * check that passes because the cell is not there is not a check. */
    const page = (await probe.page()) as Page;
    const cell = cellNamed((page.cells ?? []) as Cell[], 'rer');
    t.note('triggerCell', cell);
    t.check('no-automation-dot', 'no automation dot is drawn on the trigger knob',
        !!cell && !cell.automated,
        { expected: 'the trigger cell, reporting automated=false',
          actual: !cell ? `no trigger cell on the page (cells: `
                        + `${(page.cells ?? []).map((c) => c?.name).filter(Boolean).join(' ')}) `
                        + '— nothing was checked'
                        : `${cell.name} reports automated=${cell.automated}` });

    // ── C8: wide acceleration — slow is one step ─────────────────────────────
    const seedBefore = await count(SEED_SET);
    await dev.tap.knob(SEED, 1);
    const A = last(valuesOf(await newLines(SEED_SET, seedBefore, 1, 'the first deliberate turn'),
                            `${SLOT}:seed`));
    /* The gap is the point of this check: the wide curve accelerates on turns
     * closer than 180 ms, so two deliberate ones have to be further apart than
     * that or the second is a jump rather than a step. */
    await t.bus.frames(PAUSE);
    await dev.tap.knob(SEED, 1);
    const B = last(valuesOf(await newLines(SEED_SET, seedBefore, 2, 'the second deliberate turn'),
                            `${SLOT}:seed`));

    t.note('seedSlow', { A, B });
    t.check('slow-turn-one-step', 'deliberate turns move exactly one step',
        A !== null && B !== null && B - A === 1,
        { expected: 'the second turn moves exactly +1',
          actual: A === null || B === null ? 'no seed write to read a value from'
                                           : `${A} → ${B} (${B - A >= 0 ? '+' : ''}${B - A})` });

    // ── C9: wide acceleration — a fast sweep travels far ─────────────────────
    /* THE WHOLE BURST IS INJECTED BEFORE THE WAIT, so waiting for the writes to
     * appear here is a flush and not a race: every detent below has already
     * been sent by the time the count moves. */
    const sweepBefore = await count(SEED_SET);
    for (let i = 0; i < 8; i++) {
        await dev.tap.knob(SEED, 1);
        await t.bus.frames(SWEEP);
    }
    const swept = valuesOf(await newLines(SEED_SET, sweepBefore, 1, 'the sweep to land'),
                           `${SLOT}:seed`);
    const first = swept[0] ?? null, lastS = last(swept);
    t.note('seedSweep', swept);
    /* > 200 over eight detents: unaccelerated this is +8, and even the slowest
     * accelerated tier (10x) gives 70 — so the threshold separates "the curve
     * ran" from "the knob moved normally", not one tier from another. */
    t.check('fast-sweep-accelerates', 'a fast sweep travels far',
        first !== null && lastS !== null && lastS - first > 200,
        { expected: '>200 units across the sweep',
          actual: first === null || lastS === null ? 'no seed write to read a value from'
                : `${first} → ${lastS} (+${lastS - first}) over ${swept.length} write(s)` });

    // ── C10: the contrast arm — a non-wide param is untouched ────────────────
    /* The same burst, same spacing, on `loop_len`: an enum with no acceleration
     * (enums are exempt from the wide curve and step by ENUM_DELTA_DIV), so
     * eight detents move it two values. Without this arm C9 would pass for a
     * build that simply sped every knob up.
     *
     * IT IS WOUND TO THE BOTTOM FIRST, and that is load-bearing — the bash form
     * of this check could not fail for the behaviour it names. loop_len is nine
     * options wide with a default of index 4, four short of its ceiling, and the
     * threshold is 4: measured, cutting the enum step rate to ONE detent per
     * value — four times too fast, the exact regression this arm exists for —
     * moved it 5,6,7,8,8,8,8,8, a spread of 3 against a threshold of 4. The
     * enum's ceiling absorbed the evidence. From the bottom the same break reads
     * 0,1,2,3,4,5,6,7 and fails loudly.
     *
     * Measured from the FLOOR, not from the burst's first write: at the correct
     * rate the first detent moves a quarter of a value and the rounded write is
     * still 0, while at four times the rate it is already 1 — so "the first
     * write is 0" would fail on the very mutation this is measuring, for the
     * wrong reason. The floor is therefore read as a PRECONDITION and asserted
     * with the claim, so a wind-down that did not reach it is reported rather
     * than quietly restoring the vacuity. */
    const windBefore = await count(LOOP_SET);
    for (let i = 0; i < 20; i++) {
        await dev.tap.knob(LOOP, -1);
        await t.bus.frames(SWEEP);
    }
    let wound: number[] = [];
    try {
        const readWind = async () =>
            valuesOf((await shadow(LOOP_SET)).slice(windBefore), `${SLOT}:loop_len`);
        wound = await until(t.bus, 'loop_len to wind to the bottom',
            readWind, (v) => v.length > 0 && last(v) === 0, LOG_WAIT);
    } catch { /* the check reports the precondition */ }
    const floor = last(wound);
    t.note('loopWindDown', { writes: wound.length, floor });

    const loopBefore = await count(LOOP_SET);
    for (let i = 0; i < 8; i++) {
        await dev.tap.knob(LOOP, 1);
        await t.bus.frames(SWEEP);
    }
    const looped = valuesOf(await newLines(LOOP_SET, loopBefore, 1, 'the contrast sweep to land'),
                            `${SLOT}:loop_len`);
    const loopLast = last(looped);
    t.note('loopSweep', looped);
    t.check('non-wide-unaffected', 'the same burst on a non-wide param is unaffected',
        floor === 0 && loopLast !== null && loopLast - floor <= 4,
        { expected: 'loop_len wound to 0, then <=4 values across the same burst',
          actual: floor !== 0 ? `loop_len did not wind to the bottom (floor ${floor ?? 'no write'}) `
                             + '— the burst had no headroom, so nothing was checked here'
                : loopLast === null ? 'no loop_len write to read a value from'
                : `0 → ${loopLast} (+${loopLast}) — the param accelerated when it should not have` });
});
