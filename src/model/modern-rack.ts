/* modern-rack.ts — does a module's contract declare its drum rack itself?
 *
 * The test that decides whether movy's config or the module's own contract
 * plans a rack's Schwung pages (renderer/schwung-page-hierarchy). PURE and free
 * of Schwung, like the rest of `model/`.
 */

/**
 * Does the module declare its drum rack the modern way?
 *
 * Modern is `pad_layout: "drums"`, or a child level whose keys address a
 * CONCRETE instance — `child_prefix` (simian, dr32: `pad3_tune`) or a
 * `child_key_template` carrying `{index}` (sophie: `p{index}_{key}`). forge's
 * voice levels declare `child_key_template: "{key}"`: a passthrough onto the
 * module's own focused voice, which says nothing per pad, so forge is not.
 */
export function declaresModernRack(h: any): boolean {
    if (!h || typeof h !== 'object') return false;
    if (h.pad_layout === 'drums') return true;
    for (const lvl of Object.values(h.levels || {}) as any[]) {
        if (!lvl || typeof lvl !== 'object') continue;
        if (lvl.child_prefix) return true;
        if (typeof lvl.child_key_template === 'string'
            && lvl.child_key_template.indexOf('{index}') >= 0) return true;
    }
    return false;
}
