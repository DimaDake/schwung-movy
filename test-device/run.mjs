#!/usr/bin/env node
/* Device scenario entry point.  npm run test:device [-- --scenario <name>] */
import { Bus } from './dist/bus.js';
import { Agent } from './dist/agent.js';
import { ensureServers, stopServers } from './dist/daemon.js';
import { runAll } from './dist/runner.js';
import './dist/scenarios/automation.js';
import './dist/scenarios/unload.js';
import './dist/scenarios/reselect.js';

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const HOST = process.env.HOST || flag('--host') || argv.find((a) => !a.startsWith('--')) || 'move.local';
const only = flag('--scenario');

const started = await ensureServers(HOST);
const bus = new Bus(HOST);   await bus.connect();
const agent = new Agent(HOST); await agent.connect();

const failures = await runAll({ host: HOST, only, bus, agent });

bus.close(); agent.close();
await stopServers(HOST, started);
process.exit(failures === 0 ? 0 : 1);
