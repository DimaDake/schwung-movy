import type { ViewModel } from '../types/viewmodel.js';
import { fontPrint, fontWidth } from '../font/index.js';
import { drawHeader, drawBankBar } from './header.js';
import { drawKnobRow } from './label.js';
import { drawEnumOverlay } from './overlay.js';
import { W, ROW0_Y, LBL0_Y, ROW1_Y, LBL1_Y } from './layout.js';

export function renderKnobsView(vm: ViewModel): void {
    clear_screen();

    if (vm.toast) {
        drawHeader(vm.toast.fullName, vm.toast.value, true);
    } else {
        const rightW   = vm.bankName ? fontWidth(vm.bankName) + 4 : 0;
        const maxNameW = W - rightW - 4;
        let dispName   = vm.moduleName;
        while (dispName.length > 1 && fontWidth(dispName) > maxNameW) {
            dispName = dispName.slice(0, -1);
        }
        drawHeader(dispName, vm.bankName || null, false);
    }

    drawBankBar(vm.bankIndex, vm.bankCount);

    const hasParams = vm.rows[0].some(Boolean) || vm.rows[1].some(Boolean);
    if (!hasParams) {
        fontPrint(2, ROW0_Y + 4, 'No params', 1);
    } else {
        drawKnobRow(vm.rows[0], ROW0_Y, LBL0_Y, 0);
        drawKnobRow(vm.rows[1], ROW1_Y, LBL1_Y, 1);
    }

    if (vm.overlay) drawEnumOverlay(vm);
}
