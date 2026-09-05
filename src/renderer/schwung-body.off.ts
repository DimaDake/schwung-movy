/* The stand-in for schwung-body.ts in a build with the grid switched off.
 *
 * Its whole job is to NOT import Schwung's param_pages. esbuild keeps an
 * external import even when every binding it provides is unreachable, so as
 * long as the real module is in the graph an ordinary movy carries the widget
 * library's import — and fails to load on a Schwung too old to answer it. The
 * define alone cannot fix that; the module has to leave the graph, which is
 * what build/device.mjs swaps this in to do.
 *
 * Surface-identical to the real module so the swap is invisible to importers.
 * Nothing here should ever run: `drawKnobParamsSchwung` is called only when
 * the mode is 'body', and this file is only ever built when the mode is 'off'.
 * It therefore throws rather than drawing nothing — a blank body band would
 * look like a rendering bug in a build that cannot draw a body band at all. */
import type { ViewModel } from '../types/viewmodel.js';

export const BODY_Y = 8;
export const BODY_H = 48;
export const BAND_H = null;

export function drawKnobParamsSchwung(_vm: ViewModel, _touched = -1): never {
    throw new Error(
        'movy: the Schwung grid was asked to draw in a build that excluded it '
        + '(MOVY_SCHWUNG_GRID=off). Rebuild with MOVY_SCHWUNG_GRID=page.');
}
