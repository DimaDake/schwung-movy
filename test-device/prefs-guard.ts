/* movy's machine-level prefs.json, snapshotted for a scenario and put back.
 *
 * Shared by every scenario that writes prefs — directly (a flag pinned for the
 * run) or as a side effect (a file commit remembering its directory). Movy must
 * be CLOSED when a scenario writes it: prefs are read at open.
 *
 * SHIPPED OVER `scp` TO A TEMP NAME AND `mv`, the way `device.ts` ships the
 * engine — not a shell redirect, and NOT a base64 round trip. The box is
 * BusyBox and has no `base64` at all, so an encoded trip fails there SILENTLY.
 * `mv` also replaces the inode, so movy cannot read a half-written file. */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeFileSync, rmSync } from 'node:fs';
import { SSH_OPTS } from './ssh.js';

const run = promisify(execFile);
export const PREFS = '/data/UserData/schwung/modules/tools/movy/prefs.json';

async function sshBox(host: string, cmd: string): Promise<string> {
    const { stdout } = await run('ssh', [...SSH_OPTS, `ableton@${host}`, cmd], { maxBuffer: 8 * 1024 * 1024 });
    return stdout;
}

/** Replace prefs.json whole, atomically. */
export async function writePrefs(host: string, text: string): Promise<void> {
    const snap = join(tmpdir(), `movy-prefs-${process.pid}-${Date.now()}.json`);
    writeFileSync(snap, text);
    try {
        await run('scp', ['-q', ...SSH_OPTS, snap, `ableton@${host}:${PREFS}.new`]);
        await sshBox(host, `mv '${PREFS}.new' '${PREFS}'`);
    } finally { rmSync(snap, { force: true }); }
}

/** Snapshot prefs.json and register its restore; returns what it held ('' when
 *  absent). `who` names the scenario in the errors.
 *
 *  ABSENCE IS ESTABLISHED, NEVER INFERRED. The delete in the restore is the one
 *  branch that can DAMAGE the box, so it is reachable only from a confirmed
 *  `no`. `cat … 2>/dev/null || true` would fold "the read failed" into "there
 *  was no file" and delete the machine-level prefs rather than restore them. */
export async function guardPrefs(t: { host: string; need: { register(u: () => Promise<void>): void } },
                                 who: string): Promise<string> {
    const present = (await sshBox(t.host, `if [ -f '${PREFS}' ]; then echo yes; else echo no; fi`)).trim();
    if (present !== 'yes' && present !== 'no') {
        throw new Error(`${who}: cannot tell whether ${PREFS} exists `
            + `(got ${JSON.stringify(present)}) — refusing to arm a teardown that could delete it`);
    }
    const before = present === 'yes' ? await sshBox(t.host, `cat '${PREFS}'`) : '';
    if (present === 'yes' && !before.trim()) {
        throw new Error(`${who}: ${PREFS} exists but read back empty — refusing to arm a `
            + `teardown that would overwrite it with nothing`);
    }
    t.need.register(async () => {
        if (present === 'no') { await sshBox(t.host, `rm -f '${PREFS}'`); return; }
        await writePrefs(t.host, before);
        /* READ BACK: a restore that silently did nothing is the defect this
         * exists for. */
        const after = await sshBox(t.host, `cat '${PREFS}'`);
        if (after !== before) {
            throw new Error(`${who}: prefs restore did not take — read back `
                + `${after.length} bytes, expected ${before.length}`);
        }
    });
    return before;
}
