/* Pre-load guard for instrument presets. A module's file param may declare a
 * required token (e.g. mrdrums needs a `"drumRack"` .ablpreset); a preset built
 * for a different instrument lacks it and can't be loaded. We detect that here
 * — by mirroring the module's own internal check — so the UI can reject it with
 * a toast instead of committing a path the engine will choke on.
 *
 * Unreadable files pass: on device host_read_file should always succeed, and
 * failing open means a transient read error never blocks a legitimate preset. */
export function fileContentAllows(path: string, requireContains?: string): boolean {
    if (!requireContains) return true;
    if (typeof host_read_file !== 'function') return true;
    const content = host_read_file(path);
    if (content === null) return true;
    return content.indexOf(requireContains) >= 0;
}
