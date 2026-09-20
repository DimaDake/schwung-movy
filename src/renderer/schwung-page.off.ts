/* The stand-in for schwung-page.ts in a build with the grid switched off.
 * See build/device.mjs's gridOffStubs comment ("THE OFF SWITCH HAS TO BE
 * FREE") for why the module has to leave the graph rather than merely be
 * unreachable.
 *
 * The SchwungPage type comes from the real module by a TYPE-ONLY import, which
 * esbuild erases — so this carries the shape without putting the module (and
 * its param_pages import) back into the bundle. */
import type { SchwungPage } from './schwung-page.js';
import type { PageParamSource } from './schwung-page-source.js';
import type { PageAutomation } from '../types/page-automation.js';

export type { SchwungPage };

export function createSchwungPage(
    _port: PageParamSource, _componentKey = 'synth',
    _modulatedOf?: ((track: number, componentKey: string) => ReadonlySet<string> | null) | null,
    _automationOf?: ((track: number) => PageAutomation) | null,
    _trackIndex?: number,
): SchwungPage {
    throw new Error(
        'movy: a Schwung page was requested in a build that excluded it '
        + '(MOVY_SCHWUNG_GRID=off). Rebuild with MOVY_SCHWUNG_GRID=page.');
}
