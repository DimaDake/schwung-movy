/* Device selftest for the probe transport: harness -> engine mailbox -> movy UI. */
import { Bus } from '../dist/bus.js';
import { Agent } from '../dist/agent.js';
import { Probe } from '../dist/probe.js';
import { ensureServers, stopServers } from '../dist/daemon.js';
import { until } from '../dist/wait.js';
import { Device } from '../dist/device.js';

const HOST = process.env.HOST || 'move.local';
let fails = 0;
const ok = (l, c, d = '') => { if (c) console.log('✓ ' + l);
    else { console.log('✗ ' + l + (d ? '  ' + d : '')); fails++; } };

const started = await ensureServers(HOST);
const bus = new Bus(HOST); await bus.connect();
const agent = new Agent(HOST); await agent.connect();

const dev = new Device(bus, agent, HOST);
/* open() gates on BOTH the mode and the DSP instance. Gating on the mode alone
 * made the first param SET fail with "param SET error from peer". */
await dev.open();

const probe = new Probe(bus);
ok('probe is available', await probe.available());

const t = await probe.tick();
ok('tick reports a numeric renderSeq', typeof t.renderSeq === 'number', JSON.stringify(t));
ok('tick reports parked=false while in the foreground', t.parked === false, JSON.stringify(t));

/* renderSeq advances when movy REPAINTS, which an idle movy does not do —
 * repaints are dirty-driven. So drive a gesture and then wait for it. */
/* Back, not jog: a jog click only repaints if the current view has somewhere to
 * drill into, which depends on what the device happens to hold. Back always
 * redraws — it either opens the Leave modal or navigates up a level. Until the
 * fixture lands, a state-independent gesture is the honest choice here. */
const before = (await probe.tick()).renderSeq;
await dev.tap.cc(51);
let advanced = true;
let after = before;
try { after = await probe.settled(before); } catch { advanced = false; }
ok('renderSeq advances after a gesture', advanced && after > before, `${before} -> ${after}`);

/* The reply must be OUR reply, not the previous one still in the mailbox. */
const a1 = await probe.ask({ key: 'tick' });
const a2 = await probe.ask({ key: 'auto' });
ok('replies are correlated, not stale', a2.lanes !== undefined && a1.lanes === undefined,
    `a1=${JSON.stringify(a1)} a2=${JSON.stringify(a2)}`);

const auto = await probe.auto();
ok('auto reports a track and a lane array', typeof auto.track === 'number' && Array.isArray(auto.lanes),
    JSON.stringify(auto));

/* Drive the UI into the knobs view so a page render exists to read. */
await dev.tap.jog();
await bus.frames(120);
const page = await probe.page();
ok('page answers with eight cells or a clear reason',
    (Array.isArray(page.cells) && page.cells.length === 8) || typeof page.error === 'string',
    JSON.stringify(page).slice(0, 200));
if (Array.isArray(page.cells)) {
    ok('page names the renderer', ['off', 'body', 'page'].includes(page.renderer), page.renderer);
}

/* A real close, driven off the modal rather than a fixed number of Backs. */
let closed = true;
try { await dev.close(probe); } catch { closed = false; }
ok('close() actually unloads movy (overtake_mode leaves 2)', closed &&
    (await bus.state()).overtake_mode !== 2);

bus.close(); agent.close();
await stopServers(HOST, started);
console.log(fails === 0 ? 'DEVICE PROBE SELFTEST PASSED' : `${fails} DEVICE PROBE CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
