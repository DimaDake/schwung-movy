/* Automation label re-sync request: set on engine boot and whenever the engine
 * applies a Set; the app tick consumes it once to fetch `alabels` and rebuild
 * the lane registry. Its own file so the status parser can arm it without
 * importing the engine bridge that imports the parser. */

let labelSyncPending = false;

export function requestLabelSync(): void { labelSyncPending = true; }

export function takeLabelSync(): boolean {
    if (!labelSyncPending) return false;
    labelSyncPending = false;
    return true;
}
