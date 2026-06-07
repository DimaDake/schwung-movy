import type { ViewModel } from '../types/viewmodel.js';
import { fontPrint, fontWidth } from '../font/index.js';
import { drawInvertedHeader, drawBankBar } from './header.js';
import { drawKnobRow } from './label.js';
import { drawEnumOverlay } from './overlay.js';
import { W, ROW0_Y, LBL0_Y, ROW1_Y, LBL1_Y } from './layout.js';

export function renderKnobsView(vm: ViewModel): void {
    if (vm.overlay) { drawEnumOverlay(vm); return; }
    clear_screen();

    if (vm.toast) {
        drawInvertedHeader(vm.toast.fullName, vm.toast.value);
    } else {
        const rightW   = vm.bankName ? fontWidth(vm.bankName) + 4 : 0;
        const maxNameW = W - rightW - 4;
        let dispName   = vm.moduleName;
        while (dispName.length > 1 && fontWidth(dispName) > maxNameW) {
            dispName = dispName.slice(0, -1);
        }
        drawInvertedHeader(dispName, vm.bankName || null);
    }

    drawBankBar(vm.bankIndex, vm.bankCount);

    const hasParams = vm.rows[0].some(Boolean) || vm.rows[1].some(Boolean);
    if (!hasParams) {
        fontPrint(2, ROW0_Y + 4, 'No params', 1);
        return;
    }

    drawKnobRow(vm.rows[0], ROW0_Y, LBL0_Y);
    drawKnobRow(vm.rows[1], ROW1_Y, LBL1_Y);
}
