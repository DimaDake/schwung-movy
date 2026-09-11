/* Device selftest for fixture.ts. Needs a real Move. */
import { Bus } from '../dist/bus.js';
import { Agent } from '../dist/agent.js';
import { Probe } from '../dist/probe.js';
import { Device } from '../dist/device.js';
import { ensureServers, stopServers } from '../dist/daemon.js';
import * as fixture from '../dist/fixture.js';

const HOST = process.env.HOST || 'move.local';
let fails = 0;
const ok = (l, c, d = '') => { if (c) console.log('✓ ' + l);
    else { console.log('✗ ' + l + (d ? '  ' + d : '')); fails++; } };

const started = await ensureServers(HOST);
const bus = new Bus(HOST); await bus.connect();
const agent = new Agent(HOST); await agent.connect();
fixture.setHost(HOST);

const dev = new Device(bus, agent, HOST);
const probe = new Probe(bus);
const open  = () => dev.open();
const close = () => dev.close(probe);

/* The parsers first: cheap, and a rename in the fixture files should fail here
 * rather than halfway through a device run. */
const slots = fixture.fixtureEntries();
ok('slots.txt parses to entries', slots.length > 0, JSON.stringify(slots));
const chains = fixture.chainEntries();
ok('ui-state.json parses to chain entries', chains.length > 0, JSON.stringify(chains.slice(0, 3)));
const synth0 = fixture.fixtureSynth(0);
ok('track 0 names its instrument', synth0.length > 0, synth0);
ok('fixtureSynth reads the same source as chainEntries',
    chains.some((c) => c.track === '0' && c.comp === 'synth' && c.mod === synth0));

const t0 = Date.now();
let established = true;
try { await fixture.ensure(bus, open, close); }
catch (e) { established = false; console.log('   ' + String(e)); }
const secs = (Date.now() - t0) / 1000;
ok('fixture.ensure establishes the state', established, `${secs.toFixed(1)}s`);

ok('verify agrees afterwards', await fixture.verify());

/* The fast path is the whole reason a sweep is affordable: a second ensure on
 * an already-correct chain must not pay for a reload. */
const t1 = Date.now();
let again = true;
try { await fixture.ensure(bus, open, close); } catch { again = false; }
const secs2 = (Date.now() - t1) / 1000;
ok('a second ensure takes the fast path', again && secs2 < secs + 5,
    `first ${secs.toFixed(1)}s, second ${secs2.toFixed(1)}s`);

/* Everything above took the FAST path (the chain was already correct), which
 * never exercises apply/retry. Break the state on purpose and prove the fixture
 * both NOTICES and REPAIRS it — a fixture that quietly did nothing would make
 * every suite look clean while running on whatever the device happened to hold. */
const { execFile } = await import('node:child_process');
const { promisify } = await import('node:util');
const run = promisify(execFile);
await run('node', ['scripts/slot-state.mjs', 'clear', '1'], { env: { ...process.env, HOST } })
    .catch(() => {});
await bus.frames(600);

const noticed = !(await fixture.verify(true));
ok('verify NOTICES a perturbed slot', noticed);

let repaired = true;
try { await fixture.ensure(bus, open, close); } catch (e) { repaired = false; console.log('   ' + String(e)); }
ok('ensure REPAIRS a perturbed slot', repaired);
ok('verify agrees after the repair', await fixture.verify());

bus.close(); agent.close();
await stopServers(HOST, started);
console.log(fails === 0 ? 'DEVICE FIXTURE SELFTEST PASSED' : `${fails} FIXTURE CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
