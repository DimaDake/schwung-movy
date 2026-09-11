import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const run = promisify(execFile);

const TESTD = '/data/UserData/schwung/bin/schwung-testd';
const AGENT_REMOTE = '/tmp/movy-ui-agent.py';

/* `pgrep -f movy-ui-agent` matches OUR OWN ssh command line, which contains the
 * string — it reports "running" when nothing is. The bracket makes the pattern
 * not match itself, the same trick as `ps | grep '[f]oo'`. This cost a
 * debugging cycle during the spike; do not simplify it away. */
const notSelf = (s: string) => `[${s[0]}]${s.slice(1)}`;

/* `nohup cmd &` over ssh did not survive the session here — the log file was
 * never even created. setsid with stdin closed does. */
const detach = (cmd: string, log: string) => `setsid ${cmd} >${log} 2>&1 </dev/null &`;

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

export type Started = { testd: boolean; agent: boolean };

/* Both servers are opt-in and idempotent to start. Returns what WE started, so
 * teardown never kills a daemon someone left running by hand. */
export async function ensureServers(host: string): Promise<Started> {
    const here = dirname(fileURLToPath(import.meta.url));
    const agentSrc = join(here, '..', '..', 'test-device', 'device-agent', 'ui-agent.py');
    /* scp needs the timeout spelled out too: without it an unreachable device
     * blocks here forever instead of failing. Cost a hung run to find. */
    await run('scp', ['-q', ...SSH_OPTS, agentSrc, `ableton@${host}:${AGENT_REMOTE}`]);

    const out = await ssh(host,
        `pgrep -f '${notSelf('schwung-testd')}' >/dev/null && echo testd-running || ` +
        `(${detach(`SCHWUNG_TEST_BIND=0.0.0.0 ${TESTD}`, '/tmp/testd.log')} echo testd-started); ` +
        `pgrep -f '${notSelf('movy-ui-agent')}' >/dev/null && echo agent-running || ` +
        `(${detach(`python3 ${AGENT_REMOTE}`, '/tmp/movy-ui-agent.log')} echo agent-started)`);

    return { testd: out.includes('testd-started'), agent: out.includes('agent-started') };
}

export async function stopServers(host: string, started: Started): Promise<void> {
    const kills: string[] = [];
    if (started.testd) kills.push(`pkill -f '${notSelf('schwung-testd')}' || true`);
    if (started.agent) kills.push(`pkill -f '${notSelf('movy-ui-agent')}' || true`);
    if (kills.length) await ssh(host, kills.join('; '));
}
