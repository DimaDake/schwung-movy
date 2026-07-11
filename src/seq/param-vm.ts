/* Shared ParamVM factory used by step-page-vm and main-page-vm.
 * Centralises the 13-field defaults so both pages stay in sync. */

import type { ParamVM } from '../types/viewmodel.js';

export function paramCell(p: Partial<ParamVM> = {}): ParamVM {
    return {
        shortName: '', fullName: '', type: 'float', normalizedValue: 0,
        displayValue: '', touched: false, isLongEnum: false, options: null,
        enumIndex: 0, renderStyle: 'arc', automated: false, automatable: false,
        assigned: false, modulated: false, ...p,
    };
}
