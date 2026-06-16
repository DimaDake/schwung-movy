import type { ViewModel } from '../types/viewmodel.js';
import { fontPrint, fontWidth } from '../font/index.js';
import { drawHeader, drawBankBar, drawPadGridIcon } from './header.js';
import { drawKnobParams } from './label.js';
import { drawEnumOverlay, drawJogToast } from './overlay.js';
import { W } from './layout.js';

export function renderKnobsView(vm: ViewModel, jogTouched = false, activeSlot = 0): void {
    clear_screen();

    if (vm.toast) {
        drawHeader(vm.toast.fullName, vm.overlay ? null : vm.toast.value, true);
    } else {
        const showIcon = vm.isPadSpecific && vm.drumPadCount > 0;
        const iconW    = showIcon ? 7 : 0;   // 6px icon + 1px gap
        const rightW   = vm.bankName ? fontWidth(vm.bankName) + iconW + 4 : 0;
        const maxLeftW = W - rightW - 4;
        const trackLabel = 'T' + (activeSlot + 1);
        let dispName     = trackLabel + ' > ' + vm.moduleName;
        while (dispName.length > 1 && fontWidth(dispName) > maxLeftW) {
            dispName = dispName.slice(0, -1);
        }
        if (showIcon && vm.bankName) {
            // Draw header without bank name, then overlay icon + bank name text
            drawHeader(dispName, null, false);
            const bankNameW = fontWidth(vm.bankName);
            const iconX     = W - 2 - bankNameW - iconW;
            drawPadGridIcon(iconX, 0, vm.drumPadCount, vm.drumCurrentPad);
            fontPrint(W - 2 - bankNameW, 1, vm.bankName, 1);
        } else {
            drawHeader(dispName, vm.bankName || null, false);
        }
    }

    drawBankBar(vm.bankIndex, vm.bankCount);
    drawKnobParams(vm);

    if (vm.overlay) drawEnumOverlay(vm);
    // Limit reached + a step held: tell the user only the 8 lanes are editable.
    if (vm.automationHeld && vm.automationPoolFull) drawJogToast('8 AUTOMATION LANES — FULL');
    else if (vm.toast?.browseHint) drawJogToast('JOG: BROWSE');
    else if (jogTouched)      drawJogToast('CLICK JOG: SWAP MODULE');
}
