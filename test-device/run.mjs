#!/usr/bin/env node
/* Device scenario entry point.  npm run test:device [-- --scenario <name>] */
import { Bus } from './dist/bus.js';
import { Agent } from './dist/agent.js';
import { ensureServers, stopServers } from './dist/daemon.js';
import { deployEngine } from './dist/engine.js';
import { runAll } from './dist/runner.js';
import './dist/scenarios/automation.js';
import './dist/scenarios/unload.js';
import './dist/scenarios/reselect.js';
import './dist/scenarios/lfo.js';
import './dist/scenarios/items.js';
import './dist/scenarios/volume.js';
import './dist/scenarios/sends.js';
import './dist/scenarios/module-contract.js';
import './dist/scenarios/master-fx.js';
import './dist/scenarios/mutes.js';
import './dist/scenarios/smoke.js';
import './dist/scenarios/versions.js';
import './dist/scenarios/migrate.js';
import './dist/scenarios/jog-hint.js';

/* The seq WIP is opt-in and never part of the sweep: it is not green, and a
 * never-green scenario in the default run is how a red gate stops being read.
 * `npm run test:device -- --wip` is how you work on it. Before this it could
 * not be run at all — it was moved up out of scenarios/ without its relative
 * imports being fixed, so importing it threw ERR_MODULE_NOT_FOUND. */
if (process.argv.includes('--wip')) await import('./dist/seq.wip.js');

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

const started = await ensureServers(HOST);
const bus = new Bus(HOST);   await bus.connect();
const agent = new Agent(HOST); await agent.connect();

const failures = await runAll({ host: HOST, only, bus, agent });

bus.close(); agent.close();
await stopServers(HOST, started);
process.exit(failures === 0 ? 0 : 1);
