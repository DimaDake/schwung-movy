/* schwung-page-sample.ts — advances a sample cell's peak envelope, per tick.
 *
 * `viz_draw.mjs`'s `drawSample` is explicit that it does no I/O of its own:
 * "wavPeaks never reads, and the job is advanced from the tick." Schwung's own
 * host (`shadow_ui_param_pages.mjs`'s `tickParamPages`) is the only caller of
 * `wavPeaksTick` anywhere in the tree — movy runs its own tick loop
 * (`schwung-page-contract.ts`) instead of that host, so without this file a
 * selected .wav never gets its envelope built: the cell draws the flat
 * "no envelope" fallback forever, however long the page stays open (SP-42,
 * defect B — the registration in schwung-lib.ts is defect A, fixed
 * separately, and each is independently load-bearing).
 *
 * Mirrors shadow_ui_param_pages.mjs's block exactly, including iterating past
 * a settled sample cell to find the next unfinished one: breakbeat's Main
 * page carries two file cells (A/B) side by side, and stopping at the first
 * GRAPHIC rather than the first UNFINISHED one would strand B forever once A
 * completes.
 */

export function advanceSample(ctl: any, lib: any): void {
    if (typeof ctl.vizGroups !== 'function' || !lib.wavPeaksTick || !lib.wavPeaksDone) return;
    const groups = ctl.vizGroups();
    if (!groups) return;
    for (const g of groups) {
        if (g.kind !== lib.VIZ_SAMPLE || !g.roles.value) continue;
        const path = ctl.state.values[g.roles.value];
        if (!path) continue;
        if (lib.wavPeaksDone(String(path))) continue;
        lib.wavPeaksTick(String(path));
        break;      /* one bounded batch per tick, same as upstream */
    }
}
