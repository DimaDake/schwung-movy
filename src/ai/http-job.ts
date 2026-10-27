/* One background request at a time (design §6.2). curl runs in a child and
 * reports by writing a status file, which `tick` polls; nothing blocks. A
 * cancelled job is simply forgotten: its curl may still finish, but into a
 * job id nobody polls, and the next start removes its directory. */

import { platform } from '../platform/index.js';
import { LIBRARY_ROOT } from '../seq/set-source.js';
import type { AiHttpRequest } from './provider.js';

/* Under /data/UserData: Schwung's HTTP call refuses any other path. */
export const AI_DIR = LIBRARY_ROOT + '/.ai';
/* Dev seam for vdev/device scenarios: a canned reply instead of the network.
 * Never shipped (build-module.sh copies an explicit file list). */
export const FAKE_RESPONSE = 'ai-fake-response.json';

export const HTTP_TIMEOUT_S = 60;
/* A status file read while curl is still writing it parses as garbage; it is
 * read again on the next ticks before it counts as a failed request. */
const TORN_RETRIES = 3;
let torn = 0;
let nextId = 1;
let liveId = -1;

/** The canned reply, or '' when there is none (an emptied file is none, so a
 *  scenario cleans up with a write — the host API has no file delete). */
export function fakeResponse(moduleDir: string): string {
    return platform.readFile(moduleDir + '/' + FAKE_RESPONSE) ?? '';
}

export interface HttpReply { http: number; curlExit: number; body: string }

function paths(id: number): { dir: string; body: string; resp: string; status: string } {
    const dir = `${AI_DIR}/${id}`;
    return { dir, body: dir + '/body.json', resp: dir + '/response.json', status: dir + '/status.json' };
}

/** Job id, or -1 when the request could not be started. */
export function startHttp(req: AiHttpRequest, moduleDir: string): number {
    const id = nextId++;
    const p = paths(id);
    platform.removeDir(AI_DIR);
    if (!platform.ensureDir(AI_DIR) || !platform.ensureDir(p.dir) || !platform.writeFile(p.body, req.body)) return -1;
    const fake = fakeResponse(moduleDir);
    if (fake) {
        platform.writeFile(p.resp, fake);
        platform.writeFile(p.status, '{"http_status":200,"curl_exit":0}');
    } else if (!platform.httpStart({ url: req.url, method: 'POST', headers: req.headers, bodyPath: p.body,
        responsePath: p.resp, statusPath: p.status, timeoutS: HTTP_TIMEOUT_S })) {
        return -1;
    }
    liveId = id;
    return id;
}

/** null while the request is in flight, or for a job that was cancelled. */
export function pollHttp(id: number): HttpReply | null {
    if (id !== liveId) return null;
    const p = paths(id);
    const st = platform.readFile(p.status);
    if (!st) return null;
    let http = 0;
    let curlExit = -1;
    try {
        const v = JSON.parse(st);
        http = Number(v.http_status) || 0;
        curlExit = Number(v.curl_exit);
    } catch {
        if (++torn <= TORN_RETRIES) return null;
    }
    torn = 0;
    liveId = -1;
    return { http, curlExit: Number.isFinite(curlExit) ? curlExit : -1, body: platform.readFile(p.resp) ?? '' };
}

export function cancelHttp(id: number): void {
    if (id === liveId) liveId = -1;
}
