/* grid-tick-cpu.mjs — how much CPU a delegated page's tick costs, per arm,
 * and WHICH FUNCTION SPENDS IT.
 *
 * WHY A SECOND INSTRUMENT RATHER THAN A COLUMN ON grid-call-cost.mjs. That one
 * counts host calls, and its header explains at length why calls and not
 * milliseconds: on device every shadow_*_param is a blocking round trip, so the
 * tick period is set by the NUMBER of calls and a laptop can count them
 * exactly. That reasoning is sound and it is why SP-13 and SP-26 were both
 * closed on it. It also has an end, and SP-26 is where it was reached: with the
 * read premium down to +0.4 ms the delegated page's tick is STILL 2 ms longer
 * than `off`'s, and a call counter reports that as zero. SP-27 is the part of
 * the cost that is not IPC, so it needs the unit the other instrument
 * deliberately does not measure.
 *
 * WHY A LAPTOP CAN TIME THIS WHEN IT CANNOT TIME THE DEVICE. What makes a
 * device timing unrepeatable is the 63-205 Hz tick rate swinging with load and
 * every blocking read costing an audio block. Neither applies here: the mock
 * answers reads from a Map in-process, so what is left in the tick IS the
 * JavaScript, and the same JavaScript runs on both. The absolute milliseconds
 * are a laptop's and mean nothing on device; the RATIO between two fixtures and
 * two arms is the finding, and the profile attributing it is the point.
 *
 *   SCHWUNG=../schwung node build/browser.mjs
 *   node scripts/grid-tick-cpu.mjs page minijv --prof
 *   node scripts/grid-tick-cpu.mjs off  minijv
 *   node scripts/grid-tick-cpu.mjs page plaits           # the small case, for the ratio
 *
 * The module argument is a device-dump id (browser-test/dump-fixture.mjs), so
 * `minijv` here is minijv's own 433 params and 57 levels, not a mock shaped
 * like it.
 */
import { installEnv } from '../browser-test/env.mjs';
import { installMockEngine } from '../browser-test/mock-engine.mjs';
import { dumpFixture, dumpShape } from '../browser-test/dump-fixture.mjs';

const ARM = process.argv[2];
const MODULE = process.argv[3] ?? 'minijv';
const PROF = process.argv.includes('--prof');
const TICKS = Number(process.env.CPU_TICKS ?? 4000);
if (ARM !== 'off' && ARM !== 'page') {
    console.error('usage: grid-tick-cpu.mjs off|page [moduleId] [--prof]');
    process.exit(2);
}

const env = installEnv();
const engine = installMockEngine();

/* CONTRACT RE-DERIVATIONS, COUNTED, BECAUSE MILLISECONDS CANNOT BE A GATE.
 *
 * The cost this instrument found is a periodic one: the delegated page re-reads
 * `ui_hierarchy` and `chain_params` on a divider and rebuilds the whole plan
 * from them, then throws the result away when the fingerprint matches. The
 * milliseconds that costs are a laptop's and would make a flaky gate; the
 * number of times the contract is re-parsed in a steady state is exact, is the
 * defect itself, and its correct value is ZERO — nothing about the module is
 * moving, so nothing about it needs re-deriving.
 *
 * Counted at JSON.parse and filtered to the two contract strings, so an
 * ordinary parse elsewhere in the tick is not mistaken for one of these. */
const CONTRACT_RE = /"levels"|"chain_params"|^\[\{"key"/;
let contractParses = 0;
let counting = false;
const realParse = JSON.parse;
JSON.parse = function (text, ...rest) {
    if (counting && typeof text === 'string' && text.length > 512 && CONTRACT_RE.test(text)) {
        contractParses++;
    }
    return realParse.call(this, text, ...rest);
};

const { setSchwungGridMode, schwungGridMode } =
    await import('../dist/esm/renderer/schwung-grid.js');
setSchwungGridMode(ARM);

await import('../dist/esm/app/globals.js');
const { appState, VIEW_KNOBS } = await import('../dist/esm/app/state.js');
const { resetSeqState } = await import('../dist/esm/seq/state.js');
const { resetSeqEngine } = await import('../dist/esm/seq/engine.js');
const { sessionReady } = await import('../dist/esm/seq/set-session.js');
const { setFlag } = await import('../dist/esm/seq/flags.js');

engine.reset();
env.setParams(dumpFixture(MODULE));
resetSeqState();
resetSeqEngine();
setFlag('chtracks', 0);
/* Same reason as grid-call-cost.mjs: the Set-commit press is WALL-CLOCK timed,
 * so with it armed instant ticks never reach it, movy stays in `settling`, and
 * every arm measures an idle refresh with nothing on top — the one result an
 * A/B must not be able to fake. */
setFlag('setcommit', 0);
globalThis.init();
const m = appState.trackModels[0][1];
m.reload();
appState.currentView = VIEW_KNOBS;

for (let i = 0; i < 400 && !sessionReady(); i++) globalThis.tick();
if (!sessionReady()) {
    console.error('grid-tick-cpu: movy never went live — refusing to print a number');
    process.exit(3);
}

/* WARM BEFORE TIMING, and warm generously. Two different things are being
 * settled here and both would otherwise land inside the measured window as a
 * one-off that reads like a per-tick cost: V8's optimising tiers, and the
 * page's own arrival — the contract resolving, the first pagination, the read
 * cursor filling a page one key at a time. */
for (let i = 0; i < 2000; i++) globalThis.tick();

let session = null;
if (PROF) {
    const { Session } = await import('node:inspector');
    session = new Session();
    session.connect();
    const post = (m, p) => new Promise((res, rej) =>
        session.post(m, p, (e, r) => (e ? rej(e) : res(r))));
    await post('Profiler.enable');
    /* 100us: the whole tick is ~1ms here, so the default 1ms interval would
     * put single-digit samples in the entire run and attribute nothing. */
    await post('Profiler.setSamplingInterval', { interval: 100 });
    await post('Profiler.start');
    session.__post = post;
}

/* PER-TICK TIMES, KEPT INDIVIDUALLY, BECAUSE THE MEAN IS THE WRONG STATISTIC.
 * The costs this is hunting are periodic — a reload on a divider of 8, a cache
 * refill, a replan — so they live in a tail that a mean smears across every
 * tick and a median hides completely. Both are printed, and the gap between
 * them is itself a reading. */
const times = new Float64Array(TICKS);
counting = true;
for (let i = 0; i < TICKS; i++) {
    const t0 = process.hrtime.bigint();
    globalThis.tick();
    times[i] = Number(process.hrtime.bigint() - t0) / 1e6;
}
counting = false;

const sorted = Float64Array.from(times).sort();
const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
const mean = times.reduce((a, b) => a + b, 0) / times.length;
const shape = dumpShape(MODULE);

console.log(`arm=${ARM} mode=${schwungGridMode()} module=${shape.id} ` +
            `params=${shape.params} levels=${shape.levels} ticks=${TICKS}`);
console.log(`tick_ms mean=${mean.toFixed(4)} p50=${q(0.5).toFixed(4)} ` +
            `p90=${q(0.9).toFixed(4)} p99=${q(0.99).toFixed(4)} max=${q(1).toFixed(4)}`);
console.log(`contract_parses=${contractParses} over ${TICKS} steady-state ticks`);
/* The ONE line a suite reads, in grid-cost.mjs's convention and for its stated
 * reason: the human rows above are the part a later reader rewords, and a
 * parser pointed at those breaks on a column change. */
console.log(`grid-tick-cpu: arm=${ARM} mode=${schwungGridMode()} module=${shape.id} ` +
            `params=${shape.params} levels=${shape.levels} parses=${contractParses} ` +
            `ticks=${TICKS} meanus=${Math.round(mean * 1000)} p99us=${Math.round(q(0.99) * 1000)}`);

if (PROF) {
    const { profile } = await session.__post('Profiler.stop');
    /* SELF time, not total: the question is which function BURNS the tick, and
     * every frame on the stack shares the total. */
    const self = new Map();
    const byId = new Map(profile.nodes.map(n => [n.id, n]));
    for (const n of profile.nodes) {
        const cf = n.callFrame;
        const name = `${cf.functionName || '(anonymous)'} ${cf.url.replace(/.*\//, '')}:${cf.lineNumber + 1}`;
        self.set(name, (self.get(name) ?? 0) + (n.hitCount ?? 0));
    }
    const total = [...self.values()].reduce((a, b) => a + b, 0) || 1;
    console.log(`\n--- self time, top 25 of ${total} samples ---`);
    for (const [name, hits] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 25)) {
        console.log(`${(100 * hits / total).toFixed(1).padStart(5)}%  ${String(hits).padStart(6)}  ${name}`);
    }
    session.disconnect();
}
