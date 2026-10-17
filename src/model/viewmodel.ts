import type { ViewModel, AutomationView } from '../types/viewmodel.js';
import type { ModelState } from './state.js';

/* What movy draws around a module's page: the header names the module (or
 * the focused pad, for a declared rack) and says when a held step has filled
 * the lane pool. The page itself is Schwung's. */
export function buildViewModel(s: ModelState, auto?: AutomationView): ViewModel {
    return {
        moduleName:         s.activeModuleName,
        isEmpty:            s.moduleId === '' && s.activeModuleName === '—',
        drumPadCount:       s.drumPadCount,
        drumCurrentPad:     s.drumCurrentPad,
        drumCurrentPhysPad: s.drumCurrentPhysPad,
        drumPadName:        (s.drumPadNames || [])[s.drumCurrentPad - 1] || '',
        automationHeld:     !!auto?.held,
        automationPoolFull: !!auto?.poolFull,
        stepPagePresent:    false,
        stepPageSelected:   false,
    };
}
