/* Migrated from scripts/test.sh — the original smoke suite, and the broadest of
 * the twelve: one scenario touching the module load, the hierarchy read, the
 * knob path, the jog, a park/resume and movy's own perf instrumentation. Each
 * check's id names its own subject rather than the suite's, because "something
 * basic broke" is not a useful thing to read on a red line.
 *
 * The bash read all of it by grepping debug.log and cutting fields out with
 * grep -oE. Two properties of that log are kept and tightened here:
 *
 *  - It PERSISTS across runs. The bash cleared it as an infrastructure step and
 *    then still compared absolutely — its `claims >= 2` was satisfiable by a
 *    claim an earlier run had left behind. Nothing in the harness clears it, so
 *    every read below is a DELTA from a byte offset taken first, and a window is
 *    one slice of one read (never an accumulation across reads, which would
 *    double-count a line that appeared in both).
 *  - Every line is written TWICE, once `[DEBUG] [shadow] [movy] …` and once
 *    `[INFO ] [move-shim] [movy] …`, the shim copy a millisecond later. The
 *    filter below keeps only the shadow copy — which is not a tidiness
 *    preference: mixed copies interleave, and check 8's adjacency assertion only
 *    means anything once they are separated.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { scenario } from '../runner.js';
import { Device } from '../device.js';
import { Probe } from '../probe.js';
import * as fixture from '../fixture.js';
import { until } from '../wait.js';

const run = promisify(execFile);

/* Frames to let movy act on a gesture before reading. A quantity of device
 * work, never a wall clock. */
const ACT = 90;

/* Movy's tick counter emits perf_tick_rate/perf_refresh_ms every
 * NAME_POLL_TICKS (344) ticks, and the FIRST sample needs two windows — the
 * first has no predecessor to diff against. Measured on this device: the first
 * line lands ~6.9 s after open. So this is a `bus.frames` budget sized to that
 * measurement (2400 frames ≈ 7 s), and it is a LET-THE-DEVICE-WORK wait rather
 * than a sleep: the frame counter is the device's own SPI period. The `settled`
 * below still gates on the line actually appearing, so a slower device costs
 * device time, not a false pass. */
const PERF_SETTLE = 2400;

/* The knob turns the bash made: knob 1 up, knob 1 down, knob 2 up. Two knobs so
 * one stuck cache cannot satisfy the CC check, and bidirectional so a turn is
 * not simply clamped at a rail. */
const KNOB_TURNS: Array<[number, number]> = [[0, 1], [0, -1], [1, 1]];

/* Thresholds, unchanged from the bash. TICK_RATE_MIN only catches catastrophic
 * starvation — the overtake loop targets ~500 Hz but the schwung host caps it
 * far lower, and a heavy co-running synth drags the achievable rate to ~80 Hz
 * (verified identical on a pre-feature build). REFRESH_MS_MAX is the real
 * per-tick blocking detector: one shadow_get_param measures ~3 ms, so 10 ms
 * allows for shim jitter and any single sample over it fails. */
const TICK_RATE_MIN  = 60;
const REFRESH_MS_MAX = 10;

/* Everything this suite reads out of the log, in ONE grep. `leds: repaint` is
 * here only so check 8's adjacency is a real adjacency: without it the line
 * after `resume from background` would be shortened away, and a claim written
 * 200 ms later by the repaint watch would read as though it came from the
 * resume — which is exactly the false pass this check exists to avoid. */
const LOG_RE = '\\[shadow\\].*\\[movy\\] (' + [
    'init: activeTrack=',
    'loadHierarchy:',
    'knobCC k=',
    'set slot=',
    'set_param returned ',
    'chain chainIndex=',
    'changePage delta=',
    'LED ownership claimed',
    'resume from background',
    'leds: repaint',
    'knobLED k=',
    'perf_tick_rate=',
    'perf_refresh_ms=',
].join('|') + ')';

/* A numeric field out of one of those lines. The leading separator keeps `t=`
 * out of `set=`, `k=` out of `chainIndex=`, and so on. NaN for a field that is
 * not there — never 0, because a line that never arrived must not read as a
 * plausible value. */
const at = (line: string, name: string): number => {
    const m = line.match(new RegExp('(?:^| )' + name + '=(-?[0-9]+)'));
    return m ? Number(m[1]) : NaN;
};
const lastOf = (ls: string[]): string => (ls.length ? ls[ls.length - 1] : '');

/* On a PASS, `actual` says what was measured; the diagnostic chain is only ever
 * reached on the failing side. */
const said = (ok: boolean, evidence: string, why: string): string => (ok ? evidence : why);

scenario('smoke', async (t) => {
    fixture.setHost(t.host);
    const dev   = new Device(t.bus, t.agent, t.host);
    const probe = new Probe(t.bus);
    const open  = () => dev.open(probe);
    const close = () => dev.close(probe);

    /* The whole log, filtered to movy's shadow copy, from a byte offset
     * forward. Bounded at the device end by `tail -c`, so a log that has been
     * growing for days costs no more than this run's own output.
     *
     * The offset is a POSITION, not a count of matching lines: a count would
     * silently shift if a read ever returned a different subset, and it cannot
     * survive the log being cleared mid-run at all. The `SZ < O` arm handles
     * exactly that case — someone clears the log, and the window reopens at 0
     * instead of coming back empty forever. */
    const logSince = async (from: number): Promise<string[]> => {
        try {
            const { stdout } = await run('ssh', ['-o', 'ConnectTimeout=5', '-o', 'BatchMode=yes',
                `ableton@${t.host}`,
                `F=/data/UserData/schwung/debug.log; SZ=$(stat -c %s "$F" 2>/dev/null || echo 0); `
                + `O=${from}; [ "$SZ" -lt "$O" ] && O=0; `
                + `tail -c +$((O+1)) "$F" 2>/dev/null | grep -E '${LOG_RE}' || true`],
                { maxBuffer: 8 * 1024 * 1024 });
            return stdout.split('\n').filter(Boolean);
        } catch { return []; }
    };
    const mark = async (): Promise<number> => {
        try {
            const { stdout } = await run('ssh', ['-o', 'ConnectTimeout=5', '-o', 'BatchMode=yes',
                `ableton@${t.host}`,
                'stat -c %s /data/UserData/schwung/debug.log 2>/dev/null || echo 0']);
            return Number(stdout.trim()) || 0;
        } catch { return 0; }
    };

    /* Wait for the window past `from` to satisfy `pred`, then hand back that
     * window. On a timeout the last read is returned rather than nothing, so a
     * red check still reports what it saw. */
    const settled = async (from: number, pred: (w: string[]) => boolean,
                           what: string, within: number): Promise<string[]> => {
        try { return await until(t.bus, what, () => logSince(from), pred, { within, every: 300 }); }
        catch { return logSince(from); }
    };

    /* Phase timings. This suite is partly judged on its runtime, and a wall
     * clock cannot say which of "the fixture", "the build", "the device acts" or
     * "the waits" owns the total — so the notes do. */
    const T0 = Date.now();
    const lap = (k: string): void => { t.note(k, `${((Date.now() - T0) / 1000).toFixed(1)}s`); };

    await fixture.ensure(t.bus, open, close);
    lap('t_1_fixture');
    await dev.deployUi();
    lap('t_2_deploy');

    const mark0 = await mark();
    await dev.open(probe);
    await t.bus.frames(ACT);
    /* Movy opens on schwung's focused slot, which is device state this suite
     * does not own. The fixture's synth is on track 0 and every check below
     * reads that track — on any other slot they read an empty chain and report
     * feature failures that are really state drift. */
    await dev.selectTrack(0);
    await t.bus.frames(ACT);
    lap('t_3_open');

    /* Rule: the instrument this suite judges is the one the fixture put there.
     * The bash had 'plaits' written down, and when plaits gained a movy config
     * the check's "no synth" branch stopped being reachable at all. */
    const synth = fixture.fixtureSynth(0);
    t.note('fixtureSynth', synth);

    // ── the knob path ────────────────────────────────────────────────────────
    for (const [k, d] of KNOB_TURNS) {
        await dev.tap.knob(k, d);
        await t.bus.frames(ACT);
    }

    // ── the jog ──────────────────────────────────────────────────────────────
    await dev.tap.jogTurn(1);
    await t.bus.frames(ACT);
    await dev.tap.jogTurn(1);
    await t.bus.frames(ACT);

    /* Let movy accumulate the two tick windows its perf sample needs, then read
     * the whole window ONCE and slice every check out of it. Waiting here rather
     * than after the first nine checks costs nothing — they read the same
     * window, and their lines are written long before this. */
    await t.bus.frames(PERF_SETTLE);
    const w0 = await settled(mark0, (w) => w.some((l) => l.includes('perf_tick_rate=')),
                             'the first tick-rate sample', 3000);
    t.note('windowLines', w0.length);
    lap('t_4_gesturesAndSample');

    // ── 1. the module loaded ─────────────────────────────────────────────────
    /* The bash printed the slot it opened on but asserted nothing about it. It
     * is asserted now: "init ran" with a garbage index is the same failure as
     * init not running, one branch later. */
    const initLine  = lastOf(w0.filter((l) => l.includes('init: activeTrack=')));
    const initTrack = at(initLine, 'activeTrack');
    const okInit = initLine !== '' && Number.isInteger(initTrack) && initTrack >= 0 && initTrack <= 15;
    t.note('initLine', initLine);
    t.check('module-loaded', 'movy loaded — init ran and opened on a real track', okInit, {
        expected: 'an "init: activeTrack=<0..15>" line',
        actual: said(okInit, `${initLine} — init ran`,
            initLine === '' ? 'init never ran (syntax error or path issue?)'
                            : `${initLine} — the track it opened on is not a valid index`),
    });

    // ── 2. the fixture's synth loaded a hierarchy ────────────────────────────
    /* The fixture guarantees a synth on track 0, so "no synth loaded" is a
     * FAILURE here rather than an outcome — it is precisely what a fixture that
     * never reached the track's host looks like. Two lines can say so, one per
     * hierarchy path: a module with a bundled movy config (src/modules/*.json)
     * reports `config for <id>,`, one without reports the generic
     * `<n> params, <n> banks`. */
    const hLines = w0.filter((l) => l.includes('loadHierarchy:'));
    const cfgHit = hLines.filter((l) => l.includes(`loadHierarchy: config for ${synth},`));
    const genHit = hLines.filter((l) => /loadHierarchy: [0-9]+ params,/.test(l));
    const okHier = hLines.length > 0 && (cfgHit.length > 0 || genHit.length > 0);
    t.note('hierarchyLines', hLines.slice(0, 6));
    t.check('hierarchy-loaded', `the fixture's synth ('${synth}') loaded a hierarchy`, okHier, {
        expected: `"loadHierarchy: config for ${synth}," or "loadHierarchy: <n> params,"`,
        actual: said(okHier, `${cfgHit.length + genHit.length} hierarchy line(s) for it`,
            hLines.length === 0
                ? 'loadHierarchy never called'
                : `${hLines[0]} … — the fixture's synth ('${synth}') never loaded a hierarchy: `
                  + "track 0's host has no instrument"),
    });

    // ── 3. the module's own metadata, off the live chain ─────────────────────
    /* Empty here is the failure mode behind "knobParams empty at knob turn
     * time". The bash proved only that the line was present; a count of zero is
     * the same failure with the same consequence. */
    const cpLines = w0.filter((l) => l.includes('loadHierarchy: chain_params '));
    const cpCount = Number((lastOf(cpLines).match(/chain_params (\d+) entries/) ?? [])[1]);
    const okCp = cpLines.length > 0 && Number.isFinite(cpCount) && cpCount > 0;
    t.check('chain-params-read', `chain_params read from the module — ${cpCount} entries`, okCp, {
        expected: 'a non-empty "loadHierarchy: chain_params <n> entries" line',
        actual: said(okCp, lastOf(cpLines),
            cpLines.length === 0 ? 'chain_params never read — the module served no metadata'
                                 : `${lastOf(cpLines)} — the module served no entries`),
    });

    // ── 4. the knob CCs reached the router ───────────────────────────────────
    const ccLines = w0.filter((l) => l.includes('knobCC k='));
    const turned  = KNOB_TURNS.map(([k]) => k);
    const ccSeen  = new Set(ccLines.map((l) => at(l, 'k')));
    const okCc = turned.every((k) => ccSeen.has(k));
    t.check('knob-ccs-received',
        `knob CCs received for every knob turned (${ccLines.length} events)`, okCc, {
            expected: `k=${turned.join(' and k=')} seen`,
            actual: said(okCc, `knob CCs arrived for k=[${[...ccSeen].join(', ')}]`,
                ccLines.length === 0
                    ? 'no knob CCs received'
                    : `knob CCs arrived for k=[${[...ccSeen].join(', ')}] — `
                      + `the turns on k=${turned.join(', k=')} never reached the router`),
        });

    // ── 5/6. the knob turn became a param write the IPC accepted ─────────────
    const setLines = w0.filter((l) => l.includes('set slot='));
    const slotHit  = setLines.filter((l) => at(l, 'slot') === 0);
    const okSet = slotHit.length > 0;
    t.note('setLines', setLines.slice(0, 4));
    t.check('set-param-attempted',
        'applyKnobDelta ran — the knob turn became a param write', okSet, {
            expected: "a \"set slot=0 …\" line (track 0 is the fixture's)",
            actual: said(okSet, lastOf(slotHit),
                setLines.length > 0
                    ? `${lastOf(setLines)} — the write went to slot ${at(lastOf(setLines), 'slot')}, `
                      + "not the fixture's track"
                    : 'applyKnobDelta never reached — the knob turn produced no write at all'),
        });

    /* Both halves of the bash's chain: a true and no false. The bash accepted a
     * rejected write as long as an accepted one was also in the log — and the
     * rejected write is exactly what this check exists to catch. */
    const ipcTrue  = w0.filter((l) => l.includes('set_param returned true'));
    const ipcFalse = w0.filter((l) => l.includes('set_param returned false'));
    const okIpc = ipcTrue.length > 0 && ipcFalse.length === 0;
    t.check('set-param-ipc', 'shadow_set_param returned true — the IPC accepted the write', okIpc, {
        expected: 'at least one "set_param returned true" and no "returned false"',
        actual: said(okIpc, `${ipcTrue.length} write(s) accepted, none rejected`,
            ipcTrue.length === 0
                ? 'no IPC for the knob turn — the write never reached the host'
                : `${ipcFalse.length} write(s) returned false — IPC timeout or key rejected`),
    });

    // ── 7. the jog wheel navigates ───────────────────────────────────────────
    /* Two views answer a jog and the bash accepted either. Both branches are
     * asserted a step further than it did: presence only proves CC14 arrived,
     * whereas a cursor that MOVED in the direction turned proves movy routed it
     * into something. The `changePage` half is live (src/model/index.ts logs the
     * decoded delta), so a counter-clockwise turn would read as -1.
     *
     * No mark is needed for this window: `chain chainIndex=` and
     * `changePage delta=` are only ever written by a jog, and nothing else in
     * this scenario turns one, so filtering the window by content IS the jog
     * window. */
    const chainIdx = w0.filter((l) => l.includes('chain chainIndex=')).map((l) => at(l, 'chainIndex'));
    const pageDeltas = w0.filter((l) => l.includes('changePage delta=')).map((l) => at(l, 'delta'));
    const chainMoved = chainIdx.length > 0 && chainIdx.every((v, i) => i === 0 || v > chainIdx[i - 1]);
    const pageMoved  = pageDeltas.length > 0 && pageDeltas.every((v) => v === 1);
    const okJog = chainMoved || pageMoved;
    t.note('chainIndex', chainIdx);
    t.note('pageDeltas', pageDeltas);
    t.check('jog-navigates', 'the jog wheel navigates the chain', okJog, {
        expected: 'the chain cursor to move on every turn, or a page change of +1 on every turn',
        actual: said(okJog,
            chainMoved ? `chainIndex went ${chainIdx.join(' -> ')}`
                       : `the page moved by ${pageDeltas.join(', ')}`,
            chainIdx.length === 0 && pageDeltas.length === 0
                ? 'jog wheel CC not received (CC14 not reaching onMidiMessageInternal)'
                : `the jog was decoded but nothing moved — chainIndex ${JSON.stringify(chainIdx)}, `
                  + `page deltas ${JSON.stringify(pageDeltas)}`),
    });

    // ── 9. the knob LEDs are driven from the view model ──────────────────────
    /* updateKnobLEDs logs all eight knobs at once, so the bash got the line for
     * free from its perf wait and never checked which knobs. The bar is the
     * invariant knob-leds.ts states: every knob is lit so the row is
     * identifiable — so an all-dark row is the failure, and a partially-driven
     * row is the failure too. */
    const klLines = w0.filter((l) => l.includes('knobLED k='));
    const klSeen  = new Set(klLines.map((l) => at(l, 'k')));
    const klLit   = klLines.filter((l) => at(l, 'color') > 0);
    const okKl = klLines.length > 0 && klSeen.size === 8 && klLit.length > 0;
    t.check('knob-leds-firing',
        `updateKnobLEDs ran — ${klSeen.size} knobs logged, ${klLit.length} lit`, okKl, {
            expected: 'all 8 knob LEDs logged, at least one lit',
            actual: said(okKl, lastOf(klLines),
                klLines.length === 0
                    ? 'updateKnobLEDs never ran (knobLED log line absent)'
                    : klSeen.size < 8
                        ? `only ${klSeen.size} of 8 knobs logged — the row is not fully driven`
                        : 'every knob logged dark — the row is not lit at all'),
        });

    // ── 10/11. movy's own timing instrumentation ─────────────────────────────
    /* The bash read the MAX tick-rate sample (best window) to shrug off
     * per-window scheduling noise, and required EVERY refresh sample under
     * threshold. Both unchanged; what changed is that they are read from THIS
     * run's window rather than from whatever the persistent log happened to
     * hold. */
    const rates   = w0.filter((l) => l.includes('perf_tick_rate=')).map((l) => at(l, 'perf_tick_rate'));
    const maxRate = rates.length ? Math.max(...rates) : NaN;
    const okRate  = rates.length > 0 && maxRate >= TICK_RATE_MIN;
    t.check('tick-rate', `tick rate ${maxRate} ticks/sec (max) >= ${TICK_RATE_MIN} (threshold)`, okRate, {
        expected: `a perf_tick_rate sample at or above ${TICK_RATE_MIN}`,
        actual: said(okRate, `${rates.length} sample(s), max ${maxRate}`,
            rates.length === 0
                ? 'perf_tick_rate not found — timing instrumentation missing or not reached'
                : `tick rate ${maxRate} ticks/sec is below threshold ${TICK_RATE_MIN} — possible blocking`),
    });

    const refs    = w0.filter((l) => l.includes('perf_refresh_ms=')).map((l) => at(l, 'perf_refresh_ms'));
    const maxRef  = refs.length ? Math.max(...refs) : NaN;
    const refOver = refs.filter((v) => v > REFRESH_MS_MAX);
    const okRef   = refs.length > 0 && refOver.length === 0;
    t.check('refresh-blocking', `refresh blocking ${maxRef} ms max <= ${REFRESH_MS_MAX} ms (threshold)`, okRef, {
        expected: `every perf_refresh_ms sample at or below ${REFRESH_MS_MAX}`,
        actual: said(okRef, `${refs.length} sample(s), max ${maxRef} ms`,
            refs.length === 0
                ? 'perf_refresh_ms not found — timing instrumentation missing or refresh not triggered'
                : `refresh blocking ${maxRef} ms max — ${refOver.length} sample(s) exceed ${REFRESH_MS_MAX} ms`),
    });

    // ── 8. LED ownership survives a park and resume ──────────────────────────
    /* The host zeroes overtake_suppress_sysex when movy parks, and
     * resumeOvertakeModule never re-applies it while init() is NOT re-run — so
     * LED ownership has to be re-claimed from onResume or Move's own RGB
     * repaints come back over movy's LEDs.
     *
     * The park is the user's own gesture, not a flag write: Back at the root
     * opens the Leave-Movy modal, whose DEFAULT selection is Background (only
     * offered when the host has host_suspend_overtake), and jog click confirms.
     * dev.park() writes the host's SHM flag directly, which is a different door
     * into the same state and would not exercise what the bash exercised.
     *
     * What is asserted is the ADJACENCY, not a count. The bash's `claims >= 2`
     * is satisfied by a claim from anywhere — and ledRepaintWatch claims again
     * ~200 ms after the resume, so a count is satisfied even with onResume's
     * claim removed entirely. `resume from background` followed IMMEDIATELY by
     * `LED ownership claimed` is the line onResume writes, in order; `leds:
     * repaint` is in the grep precisely so that "immediately" means immediately
     * and not "after the next line we happened to keep". */
    await dev.parkViaModal(probe);
    lap('t_5_park');
    const markResume = await mark();
    await t.bus.openTool('movy');
    let backUp = true;
    try { await dev.overtakeReady(); } catch { backUp = false; }
    t.note('resumeReady', backUp);

    await settled(markResume, (w) => w.some((l) => l.includes('resume from background')),
                  'movy to resume from the background', 3000);
    /* A second, short wait: the claim is written microseconds after the resume
     * line but the log read is a whole ssh away, so a read landing between the
     * two would fail a build that is fine. This waits for the pair. */
    const wr = await settled(markResume, (w) => {
        const i = w.findIndex((l) => l.includes('resume from background'));
        return i >= 0 && (w[i + 1] ?? '').includes('LED ownership claimed');
    }, 'LED ownership to be re-claimed', 600);
    const ri    = wr.findIndex((l) => l.includes('resume from background'));
    lap('t_6_resume');
    const after = ri >= 0 ? (wr[ri + 1] ?? '') : '';
    const okLed = ri >= 0 && after.includes('LED ownership claimed');
    t.note('resumeLine', ri >= 0 ? wr[ri] : '(none)');
    t.note('lineAfterResume', after);
    t.check('led-ownership-reclaimed', 'LED ownership is re-claimed on resume', okLed, {
        expected: '"resume from background" followed by "LED ownership claimed"',
        actual: said(okLed, `the resume re-claimed it — ${after}`,
            ri < 0
                ? 'movy never resumed — the park gesture did not land, so nothing was claimed'
                : `the resume ran, but the line after it is ${JSON.stringify(after)} — `
                  + 'LED ownership was not re-claimed, so Move repaints over our LEDs'),
    });
});
