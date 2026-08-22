/* Where each file param last picked a file FROM.
 *
 * A module's `fileStartPath` is a factory default, not a preference: once the
 * user has browsed somewhere of their own, that folder is where the knob should
 * open next time — including in a set where the module has never been loaded,
 * which is why this lives in prefs.json (machine-level) rather than set state.
 *
 * Keyed by module + param, so a kit browser and a sample browser remember
 * different folders. Every pad shares one entry because they share one param:
 * keys here are the config's alias form (`pad_sample_path`), never the
 * per-pad concrete key — see model/pad-scope.ts. */

import { dirname } from './path.js';
import { readPrefFileDir, writePrefFileDir } from '../seq/prefs.js';

type FileParam = { key: string; fileStartPath?: string };

const FALLBACK_DIR = '/data/UserData';

function prefKey(moduleId: string, paramKey: string): string {
    return (moduleId || '?') + ':' + paramKey;
}

/* Where to open when the param holds no file yet. */
export function defaultDirFor(moduleId: string, p: FileParam): string {
    return readPrefFileDir(prefKey(moduleId, p.key)) ?? p.fileStartPath ?? FALLBACK_DIR;
}

/* A loaded file still wins: its own folder is the one the user is working in,
 * and it is the more specific answer to "where am I". */
export function startDirFor(moduleId: string, p: FileParam, currentPath: string): string {
    return currentPath ? dirname(currentPath) : defaultDirFor(moduleId, p);
}

export function rememberFileDir(moduleId: string, paramKey: string, path: string): void {
    if (path) writePrefFileDir(prefKey(moduleId, paramKey), dirname(path));
}
