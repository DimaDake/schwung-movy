import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { Bus } from './bus.js';
import { grepDebugLog } from './device-log.js';
import { repoRoot, type EngineDeploy } from './engine.js';
import type { Packet } from './midi.js';
import { SSH_OPTS } from './ssh.js';
import type { HostBus, Need, Transport } from './transport.js';

const run = promisify(execFile);

const SA_DIR = '/data/UserData/schwung/modules/tools/movy-sa';
const MOVY_DIR = '/data/UserData/schwung/modules/tools/movy';
const LAUNCH = '/data/UserData/schwung/launch-standalone.sh';
/* standalone/launch.sh's harness-mode hold (WP7 T1): after a clean close it
 * keeps Move down and waits for a command, so a close/open pair costs a
 * process start instead of a Move restart. */
/* schwung's boot watchdog (host/boot_target_lib.sh): the stamp is
 * "<target id> <strikes>", and <id>/healthy clears it at the next start. */
const BOOT_TARGETS = '/data/UserData/boot-targets';
const moveAge = `P=$(pidof MoveOriginal | cut -d' ' -f1); [ -n "$P" ] `
    + `&& awk -v u=$(cut -d' ' -f1 /proc/uptime) '{print int(u - $22/100)}' /proc/$P/stat || echo 0`;
const markHealthy = `read -r id _ < ${BOOT_TARGETS}/.boot-attempt 2>/dev/null `
    + `&& [ -d "${BOOT_TARGETS}/$id" ] && touch "${BOOT_TARGETS}/$id/healthy"; true`;
const HOLD_PIDF = '/dev/shm/.movy-sa-launcher';
const HOLD = '/dev/shm/.movy-sa-hold';
const HOLD_CMD = '/dev/shm/.movy-sa-cmd';
/* One ssh round trip: `up` (movy-host runs), `sent` (the launcher was holding
 * and has the command), `wait` (the launcher lives but has not reached its
 * hold yet) or `none` (no launcher: Move's side). Written as ableton, so a
 * later launcher of either uid can remove it from the sticky /dev/shm. */
const holdSend = (cmd: 'go' | 'quit') =>
    `if pidof movy-host >/dev/null; then echo up; `
    + `elif [ -e ${HOLD} ]; then echo ${cmd} > ${HOLD_CMD}; echo sent; `
    + `else P=$(cat ${HOLD_PIDF} 2>/dev/null); `
    + `if [ -n "$P" ] && grep -q movy-sa /proc/$P/cmdline 2>/dev/null; then echo wait; else echo none; fi; fi`;
/* A device frame. Used ONLY while movy-host is down, when there is no frame
 * clock on the box to wait on (the shim's went with Move). */
const FRAME_MS = 128 / 44.1;

/* The standalone flavour: movy-host, reached through its own test bus
 * (docs/standalone/testbus.md). It replaces testd + ui-agent + scp with one
 * socket — but that socket lives only while movy-host does, so the Bus is
 * (re)connected on demand and a down host reads as "not running", never as an
 * infra error.
 *
 * WP6 minimal: launch/restart go through schwung's launch-standalone.sh (open_tool_cmd
 * cannot open a standalone tool until upstream U6), as the uid that owns the
 * stack (WP0 findings §3.2: a lower uid cannot kill it and fails safe). */
export class StandaloneTransport implements Transport {
    readonly flavour = 'standalone' as const;
    readonly move = null;
    private bus: Bus | null = null;

    constructor(readonly host: string) {}

    has(need: Need): boolean { return need !== 'move'; }

    readonly hostBus: HostBus = {
        logSeq: () => this.call((bus) => bus.logSeq()),
        logTail: (from, pattern) => this.call((bus) => bus.logTail(from, pattern)),
        subscribeMidiOut: () => this.call((bus) => bus.subscribe('midi_out')),
        dumpMidiOut: () => this.call((bus) => bus.dump('midi_out')),
        uiEval: (js) => this.call((bus) => bus.uiEval(js)),
        state: () => this.call((bus) => bus.state()),
        /* No reply comes: the link closing IS the answer. */
        crash: () => this.call((bus) => bus.send('CRASH')).then(() => {}, () => {}),
    };

    private async ssh(user: 'ableton' | 'root', cmd: string): Promise<string> {
        const { stdout } = await run('ssh', [...SSH_OPTS, `${user}@${this.host}`, cmd],
                                     { maxBuffer: 8 * 1024 * 1024 });
        return stdout;
    }

    /* schwung-testd binds the same port; the bus file tells movy-host to
     * listen on every interface (launch-standalone.sh drops the env form). */
    async connect(): Promise<void> {
        await this.ssh('root', `kill $(pidof schwung-testd) 2>/dev/null; touch ${SA_DIR}/testbus; `
                             + `chown ableton:users ${SA_DIR}/testbus; true`);
    }

    /* Leave the device as the run found it — Move up, movy-host gone. A
     * movy-sa left running holds SPI and port 47777, and the next overtake
     * run then talked to ITS bus as though it were testd (measured: the tier
     * hung 20 min). */
    async close(): Promise<void> {
        if (await this.running()) {
            await this.call((bus) => bus.send('EXIT')).catch(() => {});
            await this.waitFor('movy-host to exit',
                async () => (await this.ssh('ableton', 'pidof movy-host || true')).trim() === '', 5000)
                .catch(() => {});
        }
        this.bus?.close();
        this.bus = null;
        /* A holding launcher would keep Move down for its whole timeout. */
        await this.holdCommand('quit').catch(() => 'none');
    }

    /* Open from the launcher's hold. `up` is not "running": a movy-host whose
     * UI has stopped is still tearing down for ~150 ms, and taking that for
     * the new one left the launcher holding until the run gave up (seq's
     * close-then-open, 2026-10-10). So keep offering `go` until a movy-host
     * that RUNS answers. false = no launcher: open the Move way. */
    private async fromHold(): Promise<boolean> {
        const end = Date.now() + 15000;
        let sent = false;
        while (Date.now() < end) {
            const st = await this.state();
            if (st.running === 1 && st.engine_ready === 1) return true;
            if (!sent) {
                const r = (await this.ssh('ableton', holdSend('go'))).trim();
                if (r === 'none') return false;
                sent = r === 'sent';
            }
            await new Promise((res) => setTimeout(res, 150));
        }
        throw new Error('standalone: timed out waiting for movy-host to run with its engine (from the hold) (15000 ms)');
    }

    /* Hand a held launcher its command; see holdSend. `wait` is the gap
     * between movy-host's exit and the launcher entering its hold. */
    private async holdCommand(cmd: 'go' | 'quit'): Promise<'up' | 'sent' | 'none'> {
        const end = Date.now() + 5000;
        for (;;) {
            const r = (await this.ssh('ableton', holdSend(cmd))).trim();
            if (r === 'up' || r === 'sent' || r === 'none') return r;
            if (Date.now() > end) throw new Error(`standalone: launcher never reached its hold (${r})`);
            await new Promise((res) => setTimeout(res, 100));
        }
    }

    private async b(): Promise<Bus> {
        if (this.bus) return this.bus;
        const bus = new Bus(this.host);
        await bus.connect();
        this.bus = bus;
        return bus;
    }

    /* A dropped link means movy-host went away; forget it so the next call
     * reconnects to whichever process is there now. */
    private async call<T>(f: (bus: Bus) => Promise<T>): Promise<T> {
        const bus = await this.b();
        try { return await f(bus); } catch (e) {
            if (e instanceof Error && /connection closed|not connected/.test(e.message)) { bus.close(); this.bus = null; }
            throw e;
        }
    }

    ping(): Promise<string> { return this.call((bus) => bus.ping()); }

    /* A host that exits DURING the wait (a close, a hard exit) takes its
     * frame clock with it: that is the down case below, not an infra error
     * (power's wedged exit threw out of an until() exactly so). */
    async frames(n: number): Promise<number> {
        if (await this.running()) {
            try { return await this.call((bus) => bus.frames(n)); } catch (e) {
                if (await this.running()) throw e;
            }
        }
        await new Promise((r) => setTimeout(r, Math.ceil(n * FRAME_MS)));
        return 0;
    }

    /* One input path: INJECT_MIDI reaches the UI and, for notes, the engine. */
    /* While movy-host is down (starting, or held between a close and an
     * open) there is no input path at all: Move is down too, so a physical
     * press would go nowhere, and so does this one. seq's boot gate pumps
     * presses across exactly that window. A press while it RUNS that fails
     * is a real link loss and still throws. */
    async uiMidi(p: Packet): Promise<void> {
        try { await this.call((bus) => bus.injectShim(p)); } catch (e) {
            if (await this.running()) throw e;
        }
    }
    dspMidi(p: Packet): Promise<void> { return this.uiMidi(p); }

    engineGet(key: string): Promise<string> { return this.call((bus) => bus.getParam(key)); }
    engineSet(key: string, v: string): Promise<void> { return this.call((bus) => bus.setParam(key, v)); }
    /* movy-host's SET_PARAM is already queued (no single slot to lose it in). */
    engineSetQueued(key: string, v: string): Promise<void> { return this.engineSet(key, v); }

    padLeds(): Promise<Uint8Array> { return this.call((bus) => bus.padLeds()); }

    async framebuffer(): Promise<Buffer> {
        const r = await this.call((bus) => bus.send('FB'));
        return Buffer.from(r.slice(3).trim(), 'hex');
    }

    logGrep(pattern: string): Promise<string[]> { return grepDebugLog(this.host, pattern); }

    async running(): Promise<boolean> {
        try {
            const st = await this.call((bus) => bus.state());
            return st.running === 1;
        } catch { this.bus?.close(); this.bus = null; return false; }
    }

    private async state(): Promise<Record<string, number>> {
        try { return await this.call((bus) => bus.state()); } catch { return {}; }
    }

    private async waitFor(what: string, pred: () => Promise<boolean>, within: number): Promise<void> {
        const end = Date.now() + within;
        while (Date.now() < end) {
            if (await pred()) return;
            await new Promise((r) => setTimeout(r, 200));
        }
        throw new Error(`standalone: timed out waiting for ${what} (${within} ms)`);
    }

    /* As the stack's uid (WP0 findings §3.2). Without Move (a previous run
     * left none) root launches, since only root can then free the device. */
    /* Single-flight: two launches in the same instant (a retry overlapping an
     * open) both ran launch-standalone.sh. The lock kept the second movy-host
     * out, but ITS launch-standalone.sh then restarted Move underneath the
     * first one, and the tier hung for 20 min (2026-10-10). Callers share one
     * launch instead. */
    private launching: Promise<void> | null = null;
    launch(): Promise<void> {
        if (!this.launching) this.launching = this.launchOnce().finally(() => { this.launching = null; });
        return this.launching;
    }

    private async launchOnce(): Promise<void> {
        if (await this.running()) return;
        if (await this.fromHold()) return;
        /* From a SETTLED Move only, as a user opens it from Tools: a Move still
         * booting after the last exit re-grabs SPI behind the kill sweep
         * (measured: EBUSY 0.5 s after "Killing SPI holders"). Generous: after
         * an ableton-uid exit, launch-standalone.sh's bare Move restart once
         * took ~60 s to bring shadow_ui up (2026-10-10; usually ~3-4 s). */
        await this.waitFor('Move to be back (shadow_ui up)',
            async () => (await this.ssh('ableton', 'pidof shadow_ui || true')).trim() !== '', 90000);
        /* ...and past its boot watchdog's 15 s liveness window. /opt/move/Move
         * counts every start as a boot attempt and clears it only once Move
         * has lived 15 s; launch-standalone.sh killing it sooner leaves the
         * strike, and the THIRD strike puts boot-select's forced picker on the
         * screen with a 60 s backstop. That was the "Move took 60 s" case
         * (reproduced 2026-10-10: runs 1-2 at 3.6 s, run 3 at 61.5 s). A strike
         * can also outlive a healthy Move (a start that died without its
         * watcher), so once Move has proved the watcher's own 15 s, mark the
         * target healthy: the watchdog's documented "boot was good" file,
         * which clears the count at the next start. */
        await this.waitFor('Move to outlive its boot watchdog window (15 s)', async () =>
            Number((await this.ssh('ableton', moveAge)).trim()) >= 16, 30000);
        await this.ssh('ableton', markHealthy);
        await this.ssh('root',
            `P=$(pidof MoveOriginal | cut -d' ' -f1); U=$([ -n "$P" ] && stat -c %u /proc/$P || echo 0); `
            + `if [ "$U" = 0 ]; then ${LAUNCH} ${SA_DIR}/standalone; `
            + `else su ableton -s /bin/sh -c '${LAUNCH} ${SA_DIR}/standalone'; fi`);
        /* launch-standalone.sh sleeps ~1.8 s before it even kills Move. */
        await this.waitFor('movy-host to run with its engine', async () => {
            const st = await this.state();
            return st.running === 1 && st.engine_ready === 1;
        }, 15000);
    }

    /* EXIT, then a fresh process — proved by a CHANGED pid, because a bus that
     * never went down must not read as one that came back. */
    async restart(): Promise<void> {
        const pidOf = (banner: string) => /pid=(\d+)/.exec(banner)?.[1] ?? '';
        const before = pidOf(await this.ping().catch(() => ''));
        if (before) {
            await this.call((bus) => bus.send('EXIT')).catch(() => {});
            this.bus?.close();
            this.bus = null;
            await this.waitFor('movy-host to exit',
                async () => (await this.ssh('ableton', 'pidof movy-host || true')).trim() === '', 5000);
        }
        await this.launch();
        const after = pidOf(await this.ping());
        if (!after || after === before) throw new Error(`standalone: restart did not change movy-host (pid ${before} → ${after})`);
    }

    /* dsp.so and movy-host ship to movy-sa (fresh inodes, deploy-sa.sh);
     * chain-host.so ships to tools/movy, because ui.js names that directory as
     * the engine's chain host source. Any change → a new process runs it. */
    async deployEngine(): Promise<EngineDeploy> {
        const md5 = () => this.ssh('ableton',
            `md5sum ${SA_DIR}/dsp.so ${SA_DIR}/movy-host ${MOVY_DIR}/chain-host.so 2>/dev/null | md5sum | cut -d' ' -f1`)
            .catch(() => '');
        try {
            await run('bash', [join(repoRoot(), 'scripts', 'build-dsp.sh')], { cwd: repoRoot() });
            await run('node', [join(repoRoot(), 'build', 'device.mjs')], { cwd: repoRoot() });
            const before = await md5();
            await run('scp', ['-q', ...SSH_OPTS, join(repoRoot(), 'dist', 'chain-host.so'),
                              `ableton@${this.host}:${MOVY_DIR}/chain-host.so.new`]);
            await this.ssh('ableton', `mv ${MOVY_DIR}/chain-host.so.new ${MOVY_DIR}/chain-host.so`);
            await run('bash', ['-c', `. scripts/lib/deploy-sa.sh && deploy_sa ${this.host}`],
                      { cwd: repoRoot(), maxBuffer: 8 * 1024 * 1024 });
            const after = await md5();
            if (before === after) return { built: true, changed: false, restarted: false, detail: after };
            const restarted = await this.running();
            if (restarted) await this.restart();
            return { built: true, changed: true, restarted, detail: after };
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return { built: false, detail: msg.split('\n').slice(0, 6).join('\n') };
        }
    }

    /* The same ui.js to both installs (byte-identical flavours). It is read at
     * launch, so a running movy-host keeps the old one until its next open. */
    private uiDeployed = false;
    async deployUi(force = false): Promise<boolean> {
        if (this.uiDeployed && !force) return false;
        await run('node', [join(repoRoot(), 'build', 'device.mjs')], { cwd: repoRoot() });
        for (const d of [MOVY_DIR, SA_DIR])
            await run('scp', ['-q', ...SSH_OPTS, join(repoRoot(), 'ui.js'), `ableton@${this.host}:${d}/`]);
        this.uiDeployed = true;
        return true;
    }
}
