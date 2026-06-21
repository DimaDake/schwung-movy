import type { ViewModel } from '../types/viewmodel.js';
import { fontPrint, fontWidth } from '../font/index.js';
import { drawHeader, drawBankBar } from './header.js';
import { drawKnobParams } from './label.js';
import { drawEnumOverlay, drawJogToast } from './overlay.js';
import { W, ROW0_Y } from './layout.js';
import { CHAIN_SLOTS } from '../chain/config.js';

export function renderChainView(vm: ViewModel, chainIndex: number, jogTouched: boolean, trackLabel: string, slotLabel?: string): void {
    clear_screen();

    const slot = CHAIN_SLOTS[chainIndex] ?? CHAIN_SLOTS[1];
    const effectiveSlotLabel = slotLabel ?? slot.label;

    if (vm.isEmpty) {
        drawHeader(trackLabel, effectiveSlotLabel, false);
        drawBankBar(chainIndex, 4);
        const msg = 'CLICK JOG: ADD MODULE';
        fontPrint(Math.max(0, Math.floor((W - fontWidth(msg)) / 2)), 28, msg, 1);
        if (jogTouched) drawJogToast('CLICK: ADD MODULE');
        return;
    }

    if (vm.toast) {
        drawHeader(vm.toast.fullName, vm.overlay ? null : vm.toast.value, true);
    } else {
        const leftW    = fontWidth(trackLabel) + 4;
        const maxRight = W - leftW - 4;
        let right = vm.moduleName;
        while (right.length > 1 && fontWidth(right) > maxRight) right = right.slice(0, -1);
        drawHeader(trackLabel, right, false);
    }

    if (vm.stepPagePresent) {
        const sel = vm.stepPageSelected ? 0 : chainIndex + 1;
        drawBankBar(sel, 5, true);
    } else {
        drawBankBar(chainIndex, 4);
    }
    drawKnobParams(vm);

    if (vm.overlay) drawEnumOverlay(vm);
    if (jogTouched) drawJogToast('SHIFT+CLICK SWAP  CLICK OPEN');
}
