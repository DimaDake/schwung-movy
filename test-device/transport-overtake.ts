import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { Bus } from './bus.js';
import { Agent, UI_FLAG_JUMP_TO_TOOLS } from './agent.js';
import { ensureServers, stopServers, type Started } from './daemon.js';
import { scpFramebuffer } from './display.js';
import { deployEngine, deployUi, repoRoot, restartStack } from './engine.js';
import type { Packet } from './midi.js';
import { SSH_OPTS } from './ssh.js';
import type { MoveSide, Need, Transport } from './transport.js';
import { until } from './wait.js';

const run = promisify(execFile);

/* The engine's params live under this namespace while movy is the overtake
 * module. The prefix is the HOST's, so it is added here and nowhere else. */
const NS = 'overtake_dsp:';

/* Today's movy: an overtake tool under the shim and shadow_ui, reached through
 * schwung-testd (frame clock, engine params), movy's ui-agent (the UI MIDI
 * ring — testd's INJECT_MIDI never reaches an overtake module's UI), scp of the
 * framebuffer and ssh greps of debug.log. */
export class OvertakeTransport implements Transport {
    readonly flavour = 'overtake' as const;
    readonly move: MoveSide;
    private bus: Bus;
    private agent: Agent;
    private started: Started = { testd: false, agent: false };

    constructor(readonly host: string) {
        this.bus = new Bus(host);
        this.agent = new Agent(host);
        this.move = { park: () => this.agent.uiFlag(UI_FLAG_JUMP_TO_TOOLS) };
    }

    has(need: Need): boolean { return need === 'move'; }

    /* Both daemons are opt-in; `close` stops only the ones this started, so a
     * daemon someone left running by hand survives the run. */
    async connect(): Promise<void> {
        this.started = await ensureServers(this.host);
        await this.bus.connect();
        await this.agent.connect();
    }

    async close(): Promise<void> {
        this.bus.close(); this.agent.close();
        await stopServers(this.host, this.started);
    }

    ping(): Promise<string> { return this.bus.ping(); }
    frames(n: number): Promise<number> { return this.bus.frames(n); }
    uiMidi(p: Packet): Promise<void> { return this.agent.inject(p); }
    dspMidi(p: Packet): Promise<void> { return this.bus.injectShim(p); }

    engineGet(key: string): Promise<string> { return this.bus.getParam(NS + key); }
    engineSet(key: string, v: string): Promise<void> { return this.bus.setParam(NS + key, v); }

    /* schwung's remote-UI WebSocket, which routes `overtake_dsp:` keys through
     * the reliable shadow_param ring rather than testd's single slot. The
     * script adds the prefix itself. */
    async engineSetQueued(key: string, v: string): Promise<void> {
        await run('node', [join(repoRoot(), 'scripts', 'engine-param.mjs'), 'set', key, v, this.host],
                  { maxBuffer: 8 * 1024 * 1024 });
    }

    padLeds(): Promise<Uint8Array> { return this.bus.padLeds(); }
    framebuffer(): Promise<Buffer> { return scpFramebuffer(this.host); }

    /* Out of band over ssh, so it competes with no param traffic — which is
     * why waits on a restore read the log rather than the engine. No match is
     * an empty list; a failed ssh THROWS, because a delta whose baseline read
     * silently came back empty is satisfied by any old line. */
    async logGrep(pattern: string): Promise<string[]> {
        const { stdout } = await run('ssh', [...SSH_OPTS, `ableton@${this.host}`,
            `grep '${pattern}' /data/UserData/schwung/debug.log 2>/dev/null || true`]);
        return stdout.split('\n').filter(Boolean);
    }

    /* TWO gates, separate budgets.
     *
     * The overtake DSP load runs on the shim worker, so the mode flips when the
     * load is REQUESTED and the instance appears up to ~200 ms later; anything
     * sent in between is dropped against the shim's `overtake_dsp_gen &&
     * overtake_dsp_gen_inst` guards, and a param SET fails outright with
     * "param SET error from peer". Gating on the mode alone cost exactly that.
     *
     * A bare `__ready` poll is not sufficient either: it answers "1" whenever
     * NOTHING is loading, which includes the window before the load starts, so
     * it can pass against the previous module's state.
     *
     * Separate budgets rather than one shared deadline: with one, a slow mode
     * flip could eat the whole budget and report a DSP failure without a single
     * __ready read having happened. */
    async launch(): Promise<void> {
        await this.bus.openTool('movy');
        await until(this.bus, 'overtake_mode == 2',
            async () => (await this.bus.state()).overtake_mode, (m) => m === 2, { within: 2000 });
        await until(this.bus, 'overtake_dsp:__ready',
            () => this.engineGet('__ready').catch(() => '0'),
            (v) => v !== '0', { within: 2000 });
    }

    async running(): Promise<boolean> { return (await this.bus.state()).overtake_mode === 2; }

    /* Through the ROOT path in engine.ts, never testd's RESTART_MOVE.
     *
     * RESTART_MOVE runs restart-move.sh as whoever owns schwung-testd, and
     * daemon.ts starts testd as `ableton` whenever the port is closed — which
     * is the normal case. MoveOriginal is root, so that kill is EPERM, `|| true`
     * swallows it, and the script exits 0 with the old engine still running.
     * Worse, a "wait for the stack to come back" that pinged testd returned
     * green at once, since testd never went down. Measured 2026-09-12:
     * MoveOriginal held pid 7515 across such a restart.
     *
     * restartStack() is non-zero unless the process really went away and a new
     * one came back; the ping that follows only waits for testd to answer
     * again. */
    async restart(): Promise<void> {
        await restartStack(this.host);
        await until(this.bus, 'the stack to come back',
            () => this.bus.ping().catch(() => ''),
            (v) => v.startsWith('schwung-testd'), { within: 6000 });
    }

    deployEngine() { return deployEngine(this.host); }
    deployUi(force = false) { return deployUi(this.host, force); }
}
