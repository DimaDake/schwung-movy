import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SSH_OPTS } from './ssh.js';

const run = promisify(execFile);

/* Lines of the device's debug.log matching a fixed grep pattern, read out of
 * band over ssh — so it competes with no param traffic, which is why waits on a
 * restore read the log rather than the engine. Both flavours write the same
 * file (movy-host keeps unified_log's format and shadow_ui's source names).
 *
 * No match is an empty list; a failed ssh THROWS, because a delta whose
 * baseline read silently came back empty is satisfied by any old line. */
export async function grepDebugLog(host: string, pattern: string): Promise<string[]> {
    const { stdout } = await run('ssh', [...SSH_OPTS, `ableton@${host}`,
        `grep '${pattern}' /data/UserData/schwung/debug.log 2>/dev/null || true`],
        { maxBuffer: 8 * 1024 * 1024 });
    return stdout.split('\n').filter(Boolean);
}
