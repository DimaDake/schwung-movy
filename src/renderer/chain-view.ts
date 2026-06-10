import type { ViewModel } from '../types/viewmodel.js';
import { fontPrint, fontWidth } from '../font/index.js';
import { drawHeader, drawBankBar } from './header.js';
import { drawKnobRow } from './label.js';
import { drawEnumOverlay } from './overlay.js';
import { W, ROW0_Y, LBL0_Y, ROW1_Y, LBL1_Y, TOAST_Y, TOAST_H } from './layout.js';
import { CHAIN_SLOTS } from '../chain/config.js';

function drawJogToast(text: string): void {
    fill_rect(0, TOAST_Y, W, TOAST_H, 1);
    const tw = fontWidth(text);
    const tx = Math.max(1, Math.floor((W - tw) / 2));
    fontPrint(tx, TOAST_Y + 1, text, 0);
}

export function renderChainView(vm: ViewModel, chainIndex: number, jogTouched: boolean, activeSlot = 0): void {
    clear_screen();

    const slot       = CHAIN_SLOTS[chainIndex] ?? CHAIN_SLOTS[1];
    const trackLabel = 'T' + (activeSlot + 1);

    if (vm.isEmpty) {
        drawHeader(trackLabel, slot.label, false);
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

    drawBankBar(chainIndex, 4);

    const hasParams = vm.rows[0].some(Boolean) || vm.rows[1].some(Boolean);
    if (!hasParams) {
        fontPrint(2, ROW0_Y + 4, 'No params', 1);
    } else {
        drawKnobRow(vm.rows[0], ROW0_Y, LBL0_Y);
        drawKnobRow(vm.rows[1], ROW1_Y, LBL1_Y);
    }

    if (vm.overlay) drawEnumOverlay(vm);
    if (jogTouched) drawJogToast('SHIFT+CLICK SWAP  CLICK OPEN');
}
