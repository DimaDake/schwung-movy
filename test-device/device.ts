import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Bus } from './bus.js';
import type { Agent } from './agent.js';
import { UI_FLAG_JUMP_TO_TOOLS } from './agent.js';
import type { Probe } from './probe.js';
import { until } from './wait.js';
import {
    cc, noteOn, noteOff, knobDelta,
    CC_JOG_CLICK, CC_JOG_TURN, CC_BACK, CC_KNOB_BASE, CC_TRACK_BASE,
} from './midi.js';

const run = promisify(execFile);
const REMOTE = '/data/UserData/schwung/modules/tools/movy';

export class Device {
    constructor(private bus: Bus, private agent: Agent, private host: string) {}

    readonly tap = {
        cc: async (n: number, v = 127) => {
            await this.agent.inject(cc(n, v));
            await this.bus.frames(2);
            await this.agent.inject(cc(n, 0));
        },
        note: async (n: number, v = 100) => {
            await this.agent.inject(noteOn(n, v));
            await this.bus.frames(2);
            await this.agent.inject(noteOff(n));
        },
        knob: async (k: number, delta: number) =>
            this.agent.inject(cc(CC_KNOB_BASE + k, knobDelta(delta))),
        jog: async () => this.tap.cc(CC_JOG_CLICK),
        jogTurn: async (dir: 1 | -1) => this.agent.inject(cc(CC_JOG_TURN, dir > 0 ? 1 : 127)),
    };

    /* note-on, body, note-off — a real hold, with the body free to inject other
     * events inside it. This is how "hold a step and turn a knob" is expressed.
     * Under the old harness each inject was its own ~500 ms ssh round trip, so a
     * press/release pair WAS a half-second hold and movy read it as a different
     * gesture entirely. */
    async hold(note: number, body: () => Promise<void>): Promise<void> {
        await this.agent.inject(noteOn(note, 127));
        try { await body(); } finally { await this.agent.inject(noteOff(note)); }
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
    async overtakeReady(): Promise<void> {
        await until(this.bus, 'overtake_mode == 2',
            async () => (await this.bus.state()).overtake_mode, (m) => m === 2, { within: 2000 });
        await until(this.bus, 'overtake_dsp:__ready',
            () => this.bus.getParam('overtake_dsp:__ready').catch(() => '0'),
            (v) => v !== '0', { within: 2000 });
    }

    /* Opening has THREE gates, not two.
     *
     * The host's gates (overtake_mode, then the DSP instance) say the module is
     * loaded. Movy's SESSION — the set restored, the UI live — comes later, and
     * a gesture sent in between lands on whatever movy was showing before the
     * restore finished. Measured: a selectTrack(0) issued after only the host
     * gates left the harness reading a DIFFERENT track's automation registry,
     * which reads exactly like a broken restore. Adding ssh round trips made it
     * pass, which is what gave the race away.
     *
     * The probe is optional so open() still works before one exists (the
     * fixture's own open, for instance). */
    async open(probe?: Probe): Promise<void> {
        await this.bus.openTool('movy');
        await this.overtakeReady();
        if (!probe) return;
        await until(this.bus, 'movy session to be ready',
            () => probe.tick().catch(() => ({ ready: false })),
            (t: any) => t.ready === true, { within: 4000, every: 120 });
    }

    /* One SHM write, no gesture. Verified on device: overtake_mode 2 -> 0,
     * logging "suspendOvertakeMode: suspend_keeps_js — parking movy in
     * background". The DSP stays loaded — this is a park, not a close. */
    async park(): Promise<void> {
        await this.agent.uiFlag(UI_FLAG_JUMP_TO_TOOLS);
        await until(this.bus, 'movy to park',
            async () => (await this.bus.state()).overtake_mode, (m) => m !== 2, { within: 1400 });
    }

    async unpark(probe?: Probe): Promise<void> { await this.open(probe); }

    /* A FULL close, which unloads the DSP — not the same thing as park().
     *
     * Back is not a close button: at the root it opens the Leave modal, while
     * the modal is up it DISMISSES it, and anywhere else it navigates up one
     * level — and before any of that it descends schwung's own layer ladder
     * (hint, enum peek, section picker, entered menu). There is no Shift+Back
     * variant. So a fixed number of Backs is ambiguous by parity: `Back x3`,
     * which every bash suite used, can open-dismiss-open the modal and never
     * exit. test-auto.sh's "reopen fresh" steps never actually closed movy.
     *
     * Closed-loop off the probe instead: press Back until the modal is up, jog
     * to "Close Movy", confirm. */
    async close(probe: Probe): Promise<void> {
        for (let i = 0; i < 6; i++) {
            const st = await probe.ask({ key: 'leave' });
            if (st.active) break;
            await this.tap.cc(CC_BACK);
            await this.bus.frames(20);
        }
        for (let i = 0; i < 4; i++) {
            const st = await probe.ask({ key: 'leave' });
            if (!st.active) break;
            if (st.label === 'Close Movy') { await this.tap.cc(CC_JOG_CLICK); break; }
            await this.tap.jogTurn(1);
            await this.bus.frames(20);
        }
        await until(this.bus, 'overtake_mode to leave 2',
            async () => (await this.bus.state()).overtake_mode, (m) => m !== 2, { within: 2000 });
    }

    async reopen(probe: Probe): Promise<void> { await this.close(probe); await this.open(probe); }

    async selectTrack(n: number): Promise<void> {
        await this.tap.cc(CC_TRACK_BASE + (3 - (n % 4)));
        await this.bus.frames(30);
    }

    async deployUi(): Promise<void> {
        await run('node', ['build/device.mjs']);
        await run('scp', ['-q', 'ui.js', `ableton@${this.host}:${REMOTE}/`]);
    }

    /* A redeployed dsp.so does NOT hot-reload, measured 2026-09-11: the module
     * is freed, a fresh inode is deployed, a fresh dlopen runs, and the OLD
     * build still executes. So this always restarts. */
    async swapEngine(localPath: string, probe: Probe): Promise<void> {
        await this.close(probe);
        /* Never scp over a dlopen'd .so in place — overwriting a mapped .so's
         * inode corrupts its pages and crashes MoveOriginal. */
        await run('scp', ['-q', localPath, `ableton@${this.host}:${REMOTE}/dsp.so.new`]);
        await run('ssh', [`ableton@${this.host}`, `mv ${REMOTE}/dsp.so.new ${REMOTE}/dsp.so`]);
        await this.restartStack();
        await this.open(probe);
    }

    async restartStack(): Promise<void> {
        await this.bus.restartMove();
        await until(this.bus, 'the stack to come back',
            () => this.bus.ping().catch(() => ''),
            (v) => v.startsWith('schwung-testd'), { within: 6000 });
    }

    readonly param = {
        get: (key: string) => this.bus.getParam(key),
        set: (key: string, v: string) => this.bus.setParam(key, v),
    };
}
