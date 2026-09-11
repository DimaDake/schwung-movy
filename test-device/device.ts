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

/* Frames of silence after the host's gates, while movy restores the set.
 * ~900 frames is ~2.6 s. See open(). */
const RESTORE_QUIET = 900;

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

    /* Opening has two host gates and then SILENCE.
     *
     * The host's gates say the module is loaded. Movy then restores the set by
     * ferrying it through the overtake_dsp param SHM, which is a SINGLE SLOT —
     * and touching that SHM while the restore runs does not merely slow it, it
     * STARVES it, the same way a poll loop starved the probe's own replies.
     *
     * Measured: an automation registry that came back EMPTY on about half of
     * reopens, from a blob that demonstrably held both lanes (au=2 on disk).
     * A probe-driven "session ready" gate here made it worse, because the gate
     * is itself param traffic — the very thing the restore cannot share. It was
     * added on a hypothesis that proved wrong (the track was right all along)
     * and is gone rather than worked around.
     *
     * So: wait, silently. WAIT_FRAME touches no param. The probe argument is
     * accepted and unused, so callers need not care which gates exist. */
    async open(_probe?: Probe): Promise<void> {
        const before = await this.readyLineCount();
        await this.bus.openTool('movy');
        await this.overtakeReady();
        /* Wait for movy's own "set ready" line, read over SSH — deliberately
         * OUT OF BAND. Every param read would compete with the restore it is
         * waiting for; the log does not. Falls back to the quiet window if the
         * device log is off, so this degrades rather than breaks. */
        try {
            await until(this.bus, 'movy to report the set ready',
                () => this.readyLineCount(), (n) => n > before,
                { within: 5000, every: 150 });
        } catch {
            await this.bus.frames(RESTORE_QUIET);
        }
    }

    /* How many times movy has logged `seq: set ready` (set-session.ts). */
    private async readyLineCount(): Promise<number> {
        return (await this.logLines('seq: set ready')).length;
    }

    /* Lines matching `pattern` in the device's unified log, read out of band
     * over SSH — for signals with no ViewModel to read: a restore in
     * progress, or what fires during unload as the DSP tears down and no
     * probe answers on the way out. */
    async logLines(pattern: string): Promise<string[]> {
        try {
            const { stdout } = await run('ssh', ['-o', 'ConnectTimeout=5', '-o', 'BatchMode=yes',
                `ableton@${this.host}`,
                `grep '${pattern}' /data/UserData/schwung/debug.log 2>/dev/null || true`]);
            return stdout.split('\n').filter(Boolean);
        } catch { return []; }
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
