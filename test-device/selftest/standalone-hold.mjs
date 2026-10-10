/* Host-only: standalone/launch.sh's harness-mode hold (WP7 T1).
 *
 * Runs the REAL launcher against a fake movy-host. A clean close must hold
 * with Move still down until the harness says go (relaunch) or quit (back to
 * Move); a lock loser must never hold, or its Move restart is merely delayed;
 * and with no test bus file (a shipped install) the launcher must exec
 * movy-host exactly as it always did.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, chmodSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
let fails = 0;
const ok = (l, c, d = '') => { if (c) console.log('✓ ' + l);
    else { console.log('✗ ' + l + (d ? '  ' + d : '')); fails++; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(pred, ms = 3000) {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (pred()) return true; await sleep(20); }
    return false;
}

/* A module dir whose movy-host exits with the next code in `codes` and
 * counts its runs. */
function rig(codes, { testbus = true } = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'movy-sa-hold-'));
    const shm = join(dir, 'shm');
    writeFileSync(join(dir, 'codes'), codes.join('\n') + '\n');
    writeFileSync(join(dir, 'movy-host'),
        '#!/bin/sh\nD=$(dirname "$0"); n=$(cat "$D/runs" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "$D/runs"\n'
        + 'exit $(sed -n "${n}p" "$D/codes")\n');
    chmodSync(join(dir, 'movy-host'), 0o755);
    copyFileSync(join(ROOT, 'standalone', 'launch.sh'), join(dir, 'standalone'));
    if (testbus) writeFileSync(join(dir, 'testbus'), '');
    spawn('mkdir', ['-p', shm]);
    return { dir, shm, runs: () => +(existsSync(join(dir, 'runs')) ? readFileSync(join(dir, 'runs'), 'utf8') : 0) };
}

function launch(r) {
    const p = spawn('sh', [join(r.dir, 'standalone')], { env: { ...process.env, MOVY_SA_SHM: r.shm, MOVY_SA_HOLD_S: '2' } });
    const done = new Promise((res) => p.on('exit', (code) => res(code)));
    return { done };
}
const exited = (l) => Promise.race([l.done.then(() => true), sleep(4000).then(() => false)]);
/* Whether `file` ever existed while the launcher ran: a hold that times out
 * cleans up after itself, so a check after exit proves nothing. */
async function everSeen(l, file) {
    let seen = false, done = false;
    l.done.then(() => { done = true; });
    while (!done) { seen ||= existsSync(file); await sleep(10); }
    return seen;
}

{   /* close → hold → go → close → hold → quit */
    const r = rig([0, 0]);
    await sleep(50);
    const l = launch(r);
    ok('a clean close holds instead of returning to Move',
        await until(() => existsSync(join(r.shm, '.movy-sa-hold'))) && r.runs() === 1);
    writeFileSync(join(r.shm, '.movy-sa-cmd'), 'go\n');
    ok('"go" relaunches movy-host from the hold',
        await until(() => r.runs() === 2) && await until(() => existsSync(join(r.shm, '.movy-sa-hold'))));
    writeFileSync(join(r.shm, '.movy-sa-cmd'), 'quit\n');
    ok('"quit" ends the launcher (Move comes back)', await exited(l) && r.runs() === 2);
    ok('the launcher cleans its shm files up',
        !existsSync(join(r.shm, '.movy-sa-hold')) && !existsSync(join(r.shm, '.movy-sa-launcher'))
        && !existsSync(join(r.shm, '.movy-sa-cmd')));
}
{   /* a lock loser exits 1 */
    const r = rig([1]);
    await sleep(50);
    const l = launch(r);
    ok('a lock loser (rc 1) never holds, and gives Move back at once',
        !await everSeen(l, join(r.shm, '.movy-sa-hold')) && await exited(l));
}
{   /* an unattended hold times out */
    const r = rig([0]);
    await sleep(50);
    const l = launch(r);
    ok('an unanswered hold gives the device back on its timeout', await exited(l) && r.runs() === 1);
}
{   /* no test bus file: plain exec */
    const r = rig([0], { testbus: false });
    await sleep(50);
    const l = launch(r);
    ok('without the test bus file a close returns to Move at once',
        !await everSeen(l, join(r.shm, '.movy-sa-launcher')) && r.runs() === 1);
}

process.exit(fails ? 1 : 0);
