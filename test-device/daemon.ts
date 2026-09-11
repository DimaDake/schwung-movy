import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import net from 'node:net';

const run = promisify(execFile);

const TESTD = '/data/UserData/schwung/bin/schwung-testd';
const AGENT_REMOTE = '/tmp/movy-ui-agent.py';

export const TESTD_PORT = 47777;
export const AGENT_PORT = 47778;

const SSH_OPTS = ['-o', 'ConnectTimeout=5', '-o', 'BatchMode=yes'];

async function ssh(host: string, cmd: string): Promise<string> {
    const { stdout } = await run('ssh', [...SSH_OPTS, `ableton@${host}`, cmd]);
    return stdout;
}

/* Reachability is probed with ssh, never ping: ICMP is blocked here, so a ping
 * ALWAYS fails and says nothing about the device. */
export async function reachable(host: string): Promise<boolean> {
    try { await ssh(host, 'echo ok'); return true; } catch { return false; }
}

/* Does the port accept a connection?
 *
 * This replaced a `pgrep -f` liveness check, which was wrong twice over. The
 * naive form matched OUR OWN ssh command line. The bracket trick (`[s]chwung`)
 * did not fix it either, because the same command line also carries the
 * BINARY PATH — `/data/.../bin/schwung-testd` — which the pattern matches
 * happily. It reported "running" against a device where `ps` showed nothing.
 *
 * A connect is not a proxy for what we need; it IS what we need. */
function portOpen(host: string, port: number, ms = 1500): Promise<boolean> {
    return new Promise((resolve) => {
        const s = net.createConnection({ host, port });
        const done = (v: boolean) => { s.destroy(); resolve(v); };
        s.setTimeout(ms, () => done(false));
        s.once('connect', () => done(true));
        s.once('error', () => done(false));
    });
}

/* A server that has just been spawned has not bound its socket yet, so the
 * first connect races it. Retry until it answers.
 *
 * This is the one place test-device/ waits on wall-clock rather than frames,
 * and it has to be: there is no frame clock to wait on until schwung-testd is
 * up, since WAIT_FRAME is the very thing we are waiting for. Bounded, and it
 * fails with a real message rather than hanging. */
async function waitForPort(host: string, port: number, what: string, tries = 40): Promise<void> {
    for (let i = 0; i < tries; i++) {
        if (await portOpen(host, port, 500)) return;
        await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`${what}: port ${port} never opened on ${host}`);
}

/* `nohup cmd &` over ssh did not survive the session here — the log file was
 * never even created. setsid with stdin closed does.
 *
 * `env` is load-bearing: setsid execs its FIRST argument as the program, so a
 * bare `setsid VAR=val cmd` tries to run a program literally named "VAR=val"
 * and dies with "No such file or directory". A shell assignment prefix only
 * works when a shell is the one parsing it. */
const detach = (cmd: string, log: string) => `setsid env ${cmd} >${log} 2>&1 </dev/null &`;

export type Started = { testd: boolean; agent: boolean };

/* Both servers are opt-in. Returns what WE started, so teardown never kills a
 * daemon someone left running by hand. */
export async function ensureServers(host: string): Promise<Started> {
    const started: Started = { testd: false, agent: false };

    if (!(await portOpen(host, TESTD_PORT))) {
        await ssh(host, detach(`SCHWUNG_TEST_BIND=0.0.0.0 ${TESTD}`, '/tmp/testd.log'));
        await waitForPort(host, TESTD_PORT, 'schwung-testd');
        started.testd = true;
    }

    if (!(await portOpen(host, AGENT_PORT))) {
        const here = dirname(fileURLToPath(import.meta.url));
        const agentSrc = join(here, '..', 'device-agent', 'ui-agent.py');
        /* scp needs the timeout spelled out too: without it an unreachable
         * device blocks here forever instead of failing. Cost a hung run. */
        await run('scp', ['-q', ...SSH_OPTS, agentSrc, `ableton@${host}:${AGENT_REMOTE}`]);
        await ssh(host, detach(`python3 ${AGENT_REMOTE}`, '/tmp/movy-ui-agent.log'));
        await waitForPort(host, AGENT_PORT, 'movy-ui-agent');
        started.agent = true;
    }

    return started;
}

/* The bracket keeps the pattern from matching the pkill command line itself —
 * safe here, unlike in the start path, because this command carries no binary
 * path for the pattern to catch. */
const notSelf = (s: string) => `[${s[0]}]${s.slice(1)}`;

export async function stopServers(host: string, started: Started): Promise<void> {
    const kills: string[] = [];
    if (started.testd) kills.push(`pkill -f '${notSelf('schwung-testd')}' || true`);
    if (started.agent) kills.push(`pkill -f '${notSelf('movy-ui-agent')}' || true`);
    if (kills.length) await ssh(host, kills.join('; '));
}
