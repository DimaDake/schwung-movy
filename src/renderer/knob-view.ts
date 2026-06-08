import type { ViewModel } from '../types/viewmodel.js';
import { fontPrint, fontWidth } from '../font/index.js';
import { drawHeader, drawBankBar } from './header.js';
import { drawKnobRow } from './label.js';
import { drawEnumOverlay } from './overlay.js';
import { W, ROW0_Y, LBL0_Y, ROW1_Y, LBL1_Y, TOAST_Y, TOAST_H } from './layout.js';

function drawJogToast(text: string): void {
    fill_rect(0, TOAST_Y, W, TOAST_H, 1);
    const tw = fontWidth(text);
    const tx = Math.max(1, Math.floor((W - tw) / 2));
    fontPrint(tx, TOAST_Y + 1, text, 0);
}

export function renderKnobsView(vm: ViewModel, jogTouched = false, activeSlot = 0): void {
    clear_screen();

    if (vm.toast) {
        drawHeader(vm.toast.fullName, vm.toast.value, true);
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

    const hasParams = vm.rows[0].some(Boolean) || vm.rows[1].some(Boolean);
    if (!hasParams) {
        fontPrint(2, ROW0_Y + 4, 'No params', 1);
    } else {
        drawKnobRow(vm.rows[0], ROW0_Y, LBL0_Y);
        drawKnobRow(vm.rows[1], ROW1_Y, LBL1_Y);
    }

    if (vm.overlay) drawEnumOverlay(vm);
    if (jogTouched) drawJogToast('CLICK JOG: SWAP MODULE');
}
