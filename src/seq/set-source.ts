/* Where movy's Sets come from: Move's active Set, or movy's own library.
 *
 * Latched on first use — once per open, since ui.js is re-evaluated on every
 * open — rather than read live: every Set path hangs off this answer, and a mid-session flip
 * would point the next autosave at a different tree from the one the open Set
 * was loaded from. The flag says "Next open" for exactly that reason.
 *
 * In library mode the Set that is open is the one the UI WANTS — seeded from
 * the engine's last-open record at boot, changed by the Sets page — and the
 * session's identity poll reads it here instead of active_set.txt. */

import { flagValue } from './flags.js';

export const LEGACY_SETS_DIR = '/data/UserData/schwung/modules/tools/movy/sets';
/* Outside the module directory on purpose: a reinstall must not take the
 * user's Sets with it (Dronage keeps its projects beside this for the same
 * reason). */
export const LIBRARY_ROOT = '/data/UserData/UserLibrary/Movy';
export const LIBRARY_SETS_DIR = LIBRARY_ROOT + '/Sets';

let movy: boolean | null = null;
let wanted = '';

/** Re-read the flag now (a session reset; the suites). */
export function latchSetSource(): void {
    movy = flagValue('setsrc') === 1;
    wanted = '';
}

/** True when movy keeps its own Sets (`setsrc` = MOVY at session start). */
export function setSourceMovy(): boolean {
    if (movy === null) movy = flagValue('setsrc') === 1;
    return movy;
}

export function setsDir(): string { return setSourceMovy() ? LIBRARY_SETS_DIR : LEGACY_SETS_DIR; }

/** The library Set the UI wants open; '' until the library has answered. */
export function wantedSet(): string { return wanted; }
export function wantSet(id: string): void { wanted = id; }
