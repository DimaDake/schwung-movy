/* Per-set state paths: everything movy keeps for a Set lives under
 * `<library>/Sets/<uuid>/` (set-source.ts). */

import { platform } from '../platform/index.js';
import { setsDir } from './set-source.js';

/* Move stores each set's folder under its UUID. Read only by the library's
 * copy-import (sets-lib.ts), to skip Sets Move has deleted. */
export const MOVE_SETS_DIR = '/data/UserData/UserLibrary/Sets';

/* Per-set writes go under sets/<uuid>/, which host_write_file will NOT create
 * on the device — ensure the directory first (davebox does the same). The
 * `_default` fallback has to be spelled the same way the path helpers spell it,
 * or the directory made here is not the one written into. */
export function ensureDir(uuid: string): void {
    platform.ensureDir(setsDir() + '/' + (uuid || '_default'));
}

/* The engine's state file. The UI never opens it; named here for the test
 * fixtures and the mock engine, which model the engine's files. */
export function uuidToStatePath(uuid: string): string {
    return setsDir() + '/' + (uuid || '_default') + '/seq-state.json';
}
/* The engine's own chain document. Written only by the engine (see
 * chain_state.rs); the UI reads it to restore a Set's chains. */
export function uuidToChainsPath(uuid: string): string {
    return setsDir() + '/' + (uuid || '_default') + '/chains.json';
}
export function uuidToUiStatePath(uuid: string): string {
    return setsDir() + '/' + (uuid || '_default') + '/ui-state.json';
}
