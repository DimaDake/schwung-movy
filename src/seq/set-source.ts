/* Where movy's Sets live: its own library.
 *
 * The Set that is open is the one the UI WANTS — seeded from the engine's
 * last-open record at boot, changed by the Sets page — and the session's
 * identity poll reads it here. */

/* The tree the overtake build kept Sets in, keyed by Move's Set ids. Only ever
 * READ, by the library's copy-import (sets-lib.ts): a Set nobody has opened
 * since the switch still needs it. */
export const LEGACY_SETS_DIR = '/data/UserData/schwung/modules/tools/movy/sets';
/* Outside the module directory on purpose: a reinstall must not take the
 * user's Sets with it (Dronage keeps its projects beside this for the same
 * reason). */
export const LIBRARY_ROOT = '/data/UserData/UserLibrary/Movy';
export const LIBRARY_SETS_DIR = LIBRARY_ROOT + '/Sets';

let wanted = '';

/** A session reset; the suites. */
export function resetWantedSet(): void { wanted = ''; }

export function setsDir(): string { return LIBRARY_SETS_DIR; }

/** The library Set the UI wants open; '' until the library has answered. */
export function wantedSet(): string { return wanted; }
export function wantSet(id: string): void { wanted = id; }
