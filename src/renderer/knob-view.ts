import type { ViewModel } from '../types/viewmodel.js';
import { fontWidth } from '../font/index.js';
import { drawHeader, drawBankBar } from './header.js';
import { drawKnobParams } from './label.js';
import { drawEnumOverlay, drawJogToast } from './overlay.js';
import { W } from './layout.js';

export function renderKnobsView(vm: ViewModel, jogTouched = false, activeSlot = 0): void {
    clear_screen();

    if (vm.toast) {
        drawHeader(vm.toast.fullName, vm.overlay ? null : vm.toast.value, true);
    } else {
        const trackLabel = 'T' + (activeSlot + 1);
        const rightW     = vm.bankName ? fontWidth(vm.bankName) + 4 : 0;
        const maxLeftW   = W - rightW - 4;
        let dispName     = trackLabel + ' > ' + vm.moduleName;
        while (dispName.length > 1 && fontWidth(dispName) > maxLeftW) {
            dispName = dispName.slice(0, -1);
        }
        drawHeader(dispName, vm.bankName || null, false);
    }

    drawBankBar(vm.bankIndex, vm.bankCount);
    drawKnobParams(vm);

    if (vm.overlay) drawEnumOverlay(vm);
    if (vm.toast?.browseHint) drawJogToast('JOG: BROWSE');
    else if (jogTouched)      drawJogToast('CLICK JOG: SWAP MODULE');
}
