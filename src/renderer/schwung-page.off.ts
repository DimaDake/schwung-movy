/* The stand-in for schwung-page.ts in a build with the grid switched off.
 * See schwung-body.off.ts for why the module has to leave the graph rather
 * than merely be unreachable.
 *
 * The SchwungPage type comes from the real module by a TYPE-ONLY import, which
 * esbuild erases — so this carries the shape without putting the module (and
 * its param_pages import) back into the bundle. */
import type { SchwungPage } from './schwung-page.js';
import type { TrackPort } from '../track/port.js';

export type { SchwungPage };

export function createSchwungPage(_port: TrackPort, _componentKey = 'synth'): SchwungPage {
    throw new Error(
        'movy: a Schwung page was requested in a build that excluded it '
        + '(MOVY_SCHWUNG_GRID=off). Rebuild with MOVY_SCHWUNG_GRID=page.');
}
