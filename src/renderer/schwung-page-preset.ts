/* schwung-page-preset.ts — what a preset step changes that movy cannot see.
 *
 * Loading a preset is ONE write (the door's `list_param`) that changes another
 * key (its `name_param`) inside the module. Two movy layers keyed on the written
 * key alone, and each one lost the new name:
 *
 *   1. THE READ CACHE invalidates only what was written, so `stepPreset`'s
 *      re-read of the name, issued right after the index write, was answered
 *      from this epoch's batch: the name of the preset just left.
 *   2. THE REPAINT DECISION (`app/page-poll.ts`) compares knob levels, marks,
 *      the peek and animation. A name arriving on a later fill moves none of
 *      them, so the frame drawn with the stale name stayed on screen until
 *      something else redrew. Reported from the device on amino: "it never
 *      recovers just after waiting".
 */

/** The current page if it is a preset door, else null. Takes `ctl` loosely
 *  because the cache asks before the controller exists. */
function presetPage(ctl: any, lib: any): any | null {
    const p = ctl && ctl.page;
    return p && p.kind === lib.PAGE_PRESET ? p : null;
}

/**
 * The key a write to `key` also makes stale, or null.
 *
 * Only the door on screen: a list write from anywhere else (movy's knob-1
 * preset step writes the same door through the port) is the same load.
 */
export function presetNameCoupled(ctl: any, lib: any, qualify: (k: string) => string,
                                  key: string): string | null {
    const p = presetPage(ctl, lib);
    if (!p || !p.listParam || !p.nameParam) return null;
    return key === qualify(p.listParam) ? qualify(p.nameParam) : null;
}

/** Everything a preset door draws that values cannot show: the header's name,
 *  and the door's own name, position and count. */
export function presetSignature(ctl: any, lib: any): string {
    const p = presetPage(ctl, lib);
    const st = p && ctl.state && ctl.state.preset ? ctl.state.preset[p.name] : null;
    const door = st ? `${st.name}|${st.index}|${st.count}` : '';
    return `${ctl.presetName}|${door}`;
}
