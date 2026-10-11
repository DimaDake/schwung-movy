/* Per-set state paths: everything movy keeps for a Set lives under
 * `<library>/Sets/<uuid>/` (set-source.ts). */

import { platform } from '../platform/index.js';
import { setsDir } from './set-source.js';

/* Move stores each set's folder under its UUID. Read only by the library's
 * copy-import (sets-lib.ts), to skip Sets Move has deleted. */
export const MOVE_SETS_DIR = '/data/UserData/UserLibrary/Sets';

/* Loading this blank (tag-only) blob makes the engine clear all clips/tracks:
 * seq-core persist::load() resets everything before applying, and a payload
 * with only the FORMAT_TAG ("movy1") applies nothing → clean slate. */
export const BLANK_STATE = 'movy1\n';

export function fileExists(path: string): boolean {
    return platform.fileExists(path);
}
/* Per-set writes go under sets/<uuid>/, which host_write_file will NOT create
 * on the device — ensure the directory first (davebox does the same). The
 * `_default` fallback has to be spelled the same way the path helpers spell it,
 * or the directory made here is not the one written into. */
export function ensureDir(uuid: string): void {
    platform.ensureDir(setsDir() + '/' + (uuid || '_default'));
}

export function uuidToStatePath(uuid: string): string {
    return setsDir() + '/' + (uuid || '_default') + '/seq-state.json';
}
/* The engine's own chain document. Written only by the engine (see
 * chain_state.rs); the UI reads it to mirror into ui-state.json. */
export function uuidToChainsPath(uuid: string): string {
    return setsDir() + '/' + (uuid || '_default') + '/chains.json';
}
export function uuidToUiStatePath(uuid: string): string {
    return setsDir() + '/' + (uuid || '_default') + '/ui-state.json';
}
/* Rotating shadow copies of the state file. The canonical seq-state.json is
 * what older builds read; these two exist only so a torn canonical write never
 * costs more than the generation being written. */
export function shadowPath(uuid: string, slot: number): string {
    return setsDir() + '/' + (uuid || '_default') + '/seq-state.' + slot + '.json';
}

/* Version history lives under the set's own directory so a dead Set takes its
 * history with it.
 *
 * One directory PER VERSION, which looks extravagant until you notice that
 * `host_remove_dir` is the only removal the host offers: a version that cannot
 * be deleted on its own cannot be thinned, and thinning is the whole point. */
export function versionsIndexPath(uuid: string): string {
    return setsDir() + '/' + (uuid || '_default') + '/versions.json';
}
export function versionDir(uuid: string, n: number): string {
    return setsDir() + '/' + (uuid || '_default') + '/v/' + n;
}
export function versionStatePath(uuid: string, n: number): string {
    return versionDir(uuid, n) + '/seq-state.json';
}
export function versionUiPath(uuid: string, n: number): string {
    return versionDir(uuid, n) + '/ui-state.json';
}
