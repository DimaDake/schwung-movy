import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createReadStream, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';

const run = promisify(execFile);

const REMOTE = '/data/UserData/schwung/modules/tools/movy';
const SSH_OPTS = ['-o', 'ConnectTimeout=5', '-o', 'BatchMode=yes'];

/* Walk up to the directory holding package.json. This module is imported from
 * test-device/dist/ at runtime but lives in test-device/ as source, so a fixed
 * number of '..' segments is right in exactly one of those two places. */
function repoRoot(): string {
    let d = dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 5; i++) {
        if (existsSync(join(d, 'package.json'))) return d;
        d = dirname(d);
    }
    throw new Error('repo root not found above ' + fileURLToPath(import.meta.url));
}

async function ssh(host: string, user: string, cmd: string): Promise<string> {
    const { stdout } = await run('ssh', [...SSH_OPTS, `${user}@${host}`, cmd]);
    return stdout.trim();
}

/* The restart body is scripts/lib/restart-stack.py, shared with the bash tier
 * so the two cannot drift, and piped in over stdin rather than copied to the
 * device — there is nothing to clean up afterwards and no stale copy to run.
 *
 * `root` is not a preference. MoveOriginal runs as root, so restart-move.sh's
 * kill is EPERM for the `ableton` user and `|| true` swallows it: the script
 * exits 0 and the OLD engine keeps running. Measured 2026-09-12 — MoveOriginal
 * held pid 7515 across a "successful" ableton-user restart. The python exits
 * non-zero unless the process actually went away and a new one came back, so a
 * restart that did nothing is a failure here rather than a silent pass. */
export async function restartStack(host: string, whileDown = ''): Promise<string> {
    const script = join(repoRoot(), 'scripts', 'lib', 'restart-stack.py');
    return await new Promise((resolve, reject) => {
        const p = spawn('ssh', [...SSH_OPTS, `root@${host}`, 'python3', '-', whileDown],
                        { stdio: ['pipe', 'pipe', 'pipe'] });
        let out = '', err = '';
        p.stdout.on('data', (d) => { out += d; });
        p.stderr.on('data', (d) => { err += d; });
        p.on('error', reject);
        p.on('close', (code) => {
            if (code === 0) resolve(out.trim());
            else reject(new Error(`restart failed (exit ${code}): ${out.trim()} ${err.trim()}`.trim()));
        });
        createReadStream(script).pipe(p.stdin);
    });
}

export type EngineDeploy =
    | { built: true; changed: boolean; restarted: boolean; detail: string }
    | { built: false; detail: string };

/* Build the Rust engine and put it on the device, restarting only when the
 * bytes actually changed.
 *
 * Why the TS tier has to do this at all: no scenario ships an engine, so
 * before this existed `npm run test:device` graded a Rust change against
 * whatever dsp.so the device happened to hold — silently, and with every check
 * green. scripts/test-seq.sh was the only thing that built and deployed one,
 * which is why it could not be retired.
 *
 * The build is scripts/build-dsp.sh rather than a cargo invocation here: it
 * owns the toolchain preflight, the ENGINE_VERSION match against
 * src/seq/constants.ts, and the device's glibc 2.35 ceiling. Duplicating any
 * of that is how the two would disagree. */
export async function deployEngine(host: string): Promise<EngineDeploy> {
    try {
        await run('bash', [join(repoRoot(), 'scripts', 'build-dsp.sh')], { cwd: repoRoot() });
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { built: false, detail: msg.split('\n').slice(0, 6).join('\n') };
    }

    const md5 = (u: string) => ssh(host, u, `md5sum ${REMOTE}/dsp.so 2>/dev/null | cut -d' ' -f1`);
    const before = await md5('ableton').catch(() => '');

    /* Never scp over a dlopen'd .so in place — overwriting a mapped .so's inode
     * corrupts its pages and crashes MoveOriginal. A temp name plus mv gives
     * the new file a fresh inode while the old mapping stays intact. */
    await run('scp', ['-q', ...SSH_OPTS,
                      join(repoRoot(), 'dist', 'dsp.so'), `ableton@${host}:${REMOTE}/dsp.so.new`]);
    await ssh(host, 'ableton', `mv ${REMOTE}/dsp.so.new ${REMOTE}/dsp.so`);
    const after = await md5('ableton');

    if (before === after) return { built: true, changed: false, restarted: false, detail: after };

    /* A fresh inode protects the RUNNING engine; it does not deliver the new
     * one. The shim dlopens this path and glibc keeps handing back the library
     * already loaded under it for the life of MoveOriginal. */
    const detail = await restartStack(host);
    return { built: true, changed: true, restarted: true, detail };
}

/* Build ui.js and put it on the device.
 *
 * Called once per sweep from run.mjs, BEFORE any scenario runs, for the same
 * reason deployEngine is: a scenario's `fixture.ensure()` opens movy, and until
 * this existed the only deploy was `dev.deployUi()` — which every scenario
 * calls AFTER that ensure. So the fixture phase always ran the PREVIOUS ui.js,
 * and a change that the UI and the engine have to agree on deadlocked the tier:
 * measured 2026-09-13, an ENGINE_VERSION bump left ui.js asking for 0.75.0
 * while the freshly deployed engine answered 0.76.0, and `fixture.ensure` sat
 * in its retry loop until it gave up.
 *
 * Idempotent per process: `Device.deployUi()` still exists and still works, and
 * after this has run it is a no-op rather than a rebuild and scp per scenario. */
let uiDeployed = false;

export async function deployUi(host: string, force = false): Promise<boolean> {
    if (uiDeployed && !force) return false;
    await run('node', [join(repoRoot(), 'build', 'device.mjs')], { cwd: repoRoot() });
    await run('scp', ['-q', ...SSH_OPTS, join(repoRoot(), 'ui.js'), `ableton@${host}:${REMOTE}/`]);
    uiDeployed = true;
    return true;
}

/* The engine's test-only silence, and WHEN it can be applied.
 *
 * `mute` is a process static inside dsp.so, so one write holds for the rest of
 * that dlopen — across the instance churn a scenario's close-and-reopen causes.
 * But it can only be written once the .so is actually loaded, and at the top of
 * a sweep nothing is: the stack has just been restarted and movy has not been
 * opened yet. Setting it there reported COULD NOT MUTE and the sweep played out
 * loud, which is how this ended up here instead.
 *
 * So the intent is recorded once and applied by `Device.open()` — after its
 * ready wait, never during the restore, because a param write in that window is
 * the documented way to starve the restore itself. Re-applied on every open
 * rather than once: `restartStack` re-dlopens, which resets the static. */
let wantMute = false;

export function setRunMute(on: boolean): void { wantMute = on; }

export async function applyRunMute(bus: { setParam(k: string, v: string): Promise<void> }): Promise<void> {
    if (!wantMute) return;
    try { await bus.setParam('overtake_dsp:mute', '1'); } catch { /* audible, not fatal */ }
}
