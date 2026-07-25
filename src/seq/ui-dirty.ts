/* The per-set UI blob's dirty flag, in its own module so writers can mark it
 * without importing persist.ts.
 *
 * mixer/track-mutes.ts is both a writer (it marks dirty) and part of the blob
 * (persist.ts imports its snapshot/restore). Routing the flag through persist
 * closed an import cycle, and in the single-file device bundle that left the
 * binding undefined at call time — the throw landed in applyUiState's catch, so
 * solo state silently failed to restore on device while every browser test
 * passed. Keep this module dependency-free. */

let uiDirty = false;

export function markUiStateDirty(): void { uiDirty = true; }
export function takeUiDirty(): boolean { const d = uiDirty; uiDirty = false; return d; }
export function clearUiDirty(): void { uiDirty = false; }
