import type { ViewModel } from '../types/viewmodel.js';
import { fontPrint, fontWidth } from '../font/index.js';
import { drawHeader, drawBankBar, drawHeaderWithPadIcon, PAD_ICON_W } from './header.js';
import { drawKnobParams } from './label.js';
import { drawEnumOverlay, drawJogToast } from './overlay.js';
import { W } from './layout.js';

export function renderKnobsView(vm: ViewModel, jogTouched = false, activeSlot = 0): void {
    clear_screen();

    if (vm.toast) {
        drawHeader(vm.toast.fullName, vm.overlay ? null : vm.toast.value, true);
    } else {
        const showIcon = vm.isPadScoped && vm.drumPadCount > 0;
        const iconW    = showIcon ? PAD_ICON_W : 0;
        const rightW   = vm.bankName ? fontWidth(vm.bankName) + iconW + 4 : 0;
        const maxLeftW = W - rightW - 4;
        const trackLabel = 'T' + (activeSlot + 1);
        let dispName     = vm.headerOverride ?? (trackLabel + ' > ' + vm.moduleName);
        while (dispName.length > 1 && fontWidth(dispName) > maxLeftW) {
            dispName = dispName.slice(0, -1);
        }
        if (showIcon && vm.bankName) {
            drawHeaderWithPadIcon(dispName, vm.bankName, vm.drumPadCount, vm.drumCurrentPad);
        } else {
            drawHeader(dispName, vm.bankName || null, false);
        }
    }

    if (vm.stepPagePresent) {
        const sel = vm.stepPageSelected ? 0 : vm.bankIndex + 1;
        // The step page is a bank of its own, ahead of the module's own banks.
        drawBankBar(sel, vm.bankCount + 1, true,
            vm.bankGroups ? [-1, ...vm.bankGroups] : undefined);
    } else {
        drawBankBar(vm.bankIndex, vm.bankCount, false, vm.bankGroups);
    }
    drawKnobParams(vm);

    if (vm.overlay) drawEnumOverlay(vm);
    // Limit reached + a step held: tell the user only the 8 lanes are editable.
    if (vm.automationHeld && vm.automationPoolFull) drawJogToast('8 AUTOMATION LANES — FULL');
    else if (vm.toast?.browseHint) drawJogToast('JOG: BROWSE');
    else if (jogTouched)      drawJogToast('CLICK JOG: SWAP MODULE');
}
