#!/usr/bin/env node
/* Device scenario entry point.  npm run test:device [-- --scenario <name>] */
import { Bus } from './dist/bus.js';
import { Agent } from './dist/agent.js';
import { ensureServers, stopServers } from './dist/daemon.js';
import { deployEngine, deployUi, setRunMute } from './dist/engine.js';
import { runAll } from './dist/runner.js';
import { printFlakes } from './dist/flake-log.js';
import './dist/scenarios/automation.js';
import './dist/scenarios/unload.js';
import './dist/scenarios/reselect.js';
import './dist/scenarios/lfo.js';
import './dist/scenarios/items.js';
import './dist/scenarios/volume.js';
import './dist/scenarios/sends.js';
import './dist/scenarios/module-contract.js';
import './dist/scenarios/page-lifecycle.js';
import './dist/scenarios/virtual-pages.js';
import './dist/scenarios/page-dive.js';
import './dist/scenarios/master-fx.js';
import './dist/scenarios/mutes.js';
import './dist/scenarios/smoke.js';
import './dist/scenarios/versions.js';
import './dist/scenarios/migrate.js';
import './dist/scenarios/jog-hint.js';
import './dist/scenarios/seq.js';
import './dist/scenarios/widgets.js';

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
// A flag's own value (e.g. "smoke" in "--scenario smoke") is not a positional
// host — without this, "--scenario smoke" left "smoke" as the only bare argv
// entry and HOST became "smoke", so the run tried `ssh ableton@smoke`.
const consumedByFlag = new Set();
for (const name of ['--host', '--scenario']) {
    const i = argv.indexOf(name);
    if (i >= 0) consumedByFlag.add(i + 1);
}
const HOST = process.env.HOST || flag('--host')
    || argv.find((a, i) => !a.startsWith('--') && !consumedByFlag.has(i))
    || 'move.local';
const only = flag('--scenario');
const noEngine = argv.includes('--no-engine');

/* Read-only, and before anything touches the device: what has needed a second
 * attempt lately, and how often. A rate is the thing that turns "flaky" from a
 * reason to stop reading the tier into a named race worth fixing. */
if (argv.includes('--flakes')) { printFlakes(); process.exit(0); }

/* Retries make the tier a gate; switching them off is for debugging one
 * scenario, so it says so rather than quietly halving the run's meaning. */
const noRetry = argv.includes('--no-retry');
if (noRetry) console.log('--no-retry: one attempt per scenario; a race will read as a failure');

/* Ship the engine BEFORE anything measures it. No scenario builds or deploys
 * dsp.so, so without this the whole tier grades a Rust change against whatever
 * the device happened to hold — green, and meaningless. Once per sweep, not
 * per scenario: the restart it may trigger costs ~10 s and only happens when
 * the bytes actually changed.
 *
 * --no-engine skips it for UI-only iteration. It prints what it skipped,
 * because "I forgot the flag was on" must not look like a clean run. */
if (noEngine) {
    console.log('--no-engine: dsp.so NOT built or deployed; results reflect the engine already on the device');
} else {
    const r = await deployEngine(HOST);
    if (!r.built) {
        console.error(`\nengine build FAILED — not running the tier against a stale dsp.so:\n${r.detail}`);
        process.exit(1);
    }
    console.log(r.changed
        ? `engine: deployed and restarted (${r.detail})`
        : `engine: unchanged, no restart (md5 ${r.detail})`);
}

/* ui.js too, and for the same reason as the engine above: every scenario's
 * `fixture.ensure()` OPENS movy, and the per-scenario `dev.deployUi()` runs
 * after it — so the fixture phase always ran the previous build. With the UI and
 * the engine having to agree on a version, that is not merely stale: an
 * ENGINE_VERSION bump left the fixture opening a 0.75.0 ui.js against a 0.76.0
 * engine and the tier hung there. */
await deployUi(HOST);
console.log('ui.js: deployed');

const started = await ensureServers(HOST);
const bus = new Bus(HOST);   await bus.connect();
const agent = new Agent(HOST); await agent.connect();

/* Silence the engine for the run. The scenarios press pads and run the
 * transport for real, so a sweep otherwise plays the fixture set out loud for
 * ten minutes. The engine still RENDERS everything — `mute` zeroes the block
 * after render_block, never instead of it, so chain costs and the CPU meter
 * stay honest and no check moves.
 *
 * A process static in the DSP, so it survives the instance churn that a
 * scenario's close-and-reopen causes; cleared below, and cleared for free by
 * any later engine deploy or stack restart if this process dies first. Read
 * back rather than assumed: a mute that did not take is a sweep that is about
 * to be loud, and the reason should be on screen, not a mystery.
 *
 * MOVY_TEST_AUDIO=1 keeps the sound, for when the thing you are debugging is
 * the sound. */
const MUTE = process.env.MOVY_TEST_AUDIO !== '1';
setRunMute(MUTE);
console.log(MUTE
    ? 'audio: muted from the first open (MOVY_TEST_AUDIO=1 to hear it)'
    : 'audio: MOVY_TEST_AUDIO=1 — the run will be audible');

let failures;
try {
    failures = await runAll({ host: HOST, only, bus, agent,
                              retries: noRetry ? { assert: 0, infra: 0 } : undefined });
} finally {
    /* In `finally`: a scenario that threw is exactly when the device is most
     * likely to be left in a state nobody asked for. */
    setRunMute(false);
    try { await bus.setParam('overtake_dsp:mute', '0'); }
    catch { console.log('audio: could not un-mute — a redeploy or restart clears it'); }
}

bus.close(); agent.close();
await stopServers(HOST, started);
process.exit(failures === 0 ? 0 : 1);
