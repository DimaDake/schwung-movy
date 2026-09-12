#!/usr/bin/env node
/* Device scenario entry point.  npm run test:device [-- --scenario <name>] */
import { Bus } from './dist/bus.js';
import { Agent } from './dist/agent.js';
import { ensureServers, stopServers } from './dist/daemon.js';
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

const started = await ensureServers(HOST);
const bus = new Bus(HOST);   await bus.connect();
const agent = new Agent(HOST); await agent.connect();

const failures = await runAll({ host: HOST, only, bus, agent });

bus.close(); agent.close();
await stopServers(HOST, started);
process.exit(failures === 0 ? 0 : 1);
