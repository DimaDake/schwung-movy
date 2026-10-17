/* A view model with a title and nothing under the knobs, for movy's own pages
 * that Schwung draws from a virtual contract (Set and Clip Params, SP-53): the
 * body is the page's, so all movy still contributes is the header. */

import type { ViewModel } from '../types/viewmodel.js';

export function headerOnlyVM(title: string): ViewModel {
    return {
        moduleName: title, headerOverride: title, isEmpty: false,
        drumPadCount: 0, drumCurrentPad: 0, drumCurrentPhysPad: 0, drumPadName: '',
        automationHeld: false, automationPoolFull: false,
        stepPagePresent: false, stepPageSelected: false,
    };
}
