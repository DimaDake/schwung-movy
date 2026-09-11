/* Device selftest for bus.ts + agent.ts. Needs a real Move. */
import { Bus } from '../dist/bus.js';
import { Agent, UI_FLAG_JUMP_TO_TOOLS } from '../dist/agent.js';
import { ensureServers, stopServers } from '../dist/daemon.js';
import { until } from '../dist/wait.js';
import { cc, CC_TRACK_BASE } from '../dist/midi.js';

const HOST = process.env.HOST || 'move.local';
let fails = 0;
const ok = (l, c, d = '') => { if (c) console.log('✓ ' + l);
    else { console.log('✗ ' + l + (d ? '  ' + d : '')); fails++; } };

const started = await ensureServers(HOST);
const bus = new Bus(HOST); await bus.connect();
const agent = new Agent(HOST); await agent.connect();

ok('testd answers PING', (await bus.ping()).startsWith('schwung-testd '));
ok('ui-agent answers PING', (await agent.ping()).startsWith('movy-ui-agent '));

const a = await bus.frames(1), b = await bus.frames(2);
ok('WAIT_FRAME advances the shim counter', ((b - a) & 0xFFFFFFFF) >= 2, `a=${a} b=${b}`);
ok('STATE parses to numbers', typeof (await bus.state()).shim_counter === 'number');
ok('SNAPSHOT_PAD_LEDS returns 32 bytes', (await bus.padLeds()).length === 32);

/* Open movy, then park it with the UI flag. This is the end-to-end proof that
 * the agent's control-flag write reaches shadow_ui: overtake_mode 2 -> 0. */
await bus.openTool('movy');
await until(bus, 'overtake_mode == 2', async () => (await bus.state()).overtake_mode,
    (m) => m === 2, { within: 2000 });
ok('SET_OPEN_TOOL brings movy up', true);

await agent.uiFlag(UI_FLAG_JUMP_TO_TOOLS);
let parked = true;
try {
    await until(bus, 'overtake_mode to leave 2', async () => (await bus.state()).overtake_mode,
        (m) => m !== 2, { within: 1400 });
} catch { parked = false; }
ok('agent FLAG parks movy (overtake_mode leaves 2)', parked);

/* Reopen so the injection check has a live UI to reach. */
await bus.openTool('movy');
await until(bus, 'overtake_mode == 2', async () => (await bus.state()).overtake_mode,
    (m) => m === 2, { within: 2000 });
let injected = true;
try { await agent.inject(cc(CC_TRACK_BASE, 127)); await agent.inject(cc(CC_TRACK_BASE, 0)); }
catch { injected = false; }
ok('agent accepts a UI injection', injected);

bus.close(); agent.close();
await stopServers(HOST, started);
console.log(fails === 0 ? 'DEVICE BUS SELFTEST PASSED' : `${fails} DEVICE BUS CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
