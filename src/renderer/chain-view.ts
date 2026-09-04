import type { ViewModel } from '../types/viewmodel.js';
import { fontPrint, fontWidth } from '../font/index.js';
import { drawHeader, drawBankBar, drawHeaderWithPadIcon, PAD_ICON_W } from './header.js';
import { drawKnobParams } from './label.js';
import { drawEnumOverlay, drawJogToast } from './overlay.js';
import { W } from './layout.js';
import { CHAIN_SLOTS, isVirtualSlot, type ChainSlot } from '../chain/config.js';

/* `slots` is the chain being drawn — a track's or the master's. It used to be
 * CHAIN_SLOTS unconditionally, which drew the track chain's five dots over the
 * master's four slots. */
export function renderChainView(vm: ViewModel, chainIndex: number, jogTouched: boolean, trackLabel: string,
                                slotLabel?: string, slots: ChainSlot[] = CHAIN_SLOTS,
                                bodyOverride?: () => void): void {
    clear_screen();

    const slot = slots[chainIndex] ?? slots[1];
    const effectiveSlotLabel = slotLabel ?? slot.label;
    const virtual = isVirtualSlot(slots[chainIndex]);

    if (vm.isEmpty) {
        drawHeader(trackLabel, effectiveSlotLabel, false);
        if (vm.stepPagePresent) {
            const sel = vm.stepPageSelected ? 0 : chainIndex + 1;
            drawBankBar(sel, slots.length + 1, true);
        } else {
            drawBankBar(chainIndex, slots.length);
        }
        const msg = 'CLICK JOG: ADD MODULE';
        fontPrint(Math.max(0, Math.floor((W - fontWidth(msg)) / 2)), 28, msg, 1);
        if (jogTouched) drawJogToast('CLICK: ADD MODULE');
        return;
    }

    if (vm.toast) {
        drawHeader(vm.toast.fullName, vm.overlay ? null : vm.toast.value, true);
    } else {
        /* A voice page carries the same pad-grid icon it does on the module
         * page: this view shows that page's knobs, so which voice they belong
         * to is the same question here. */
        const showIcon = vm.isPadScoped && vm.drumPadCount > 0;
        const leftW    = fontWidth(trackLabel) + 4 + (showIcon ? PAD_ICON_W : 0);
        const maxRight = W - leftW - 4;
        let right = vm.moduleName;
        while (right.length > 1 && fontWidth(right) > maxRight) right = right.slice(0, -1);
        if (showIcon) drawHeaderWithPadIcon(trackLabel, right, vm.drumPadCount, vm.drumCurrentPad);
        else          drawHeader(trackLabel, right, false);
    }

    if (vm.stepPagePresent) {
        const sel = vm.stepPageSelected ? 0 : chainIndex + 1;
        drawBankBar(sel, slots.length + 1, true);
    } else {
        drawBankBar(chainIndex, slots.length);
    }
    /* THE CHAIN VIEW DRAWS THE KNOB BODY TOO. It was the site the Schwung
     * delegation missed: renderKnobsView was routed, this was not, and movy
     * opens on this view — so on device the grid stayed movy's while every
     * local check passed. */
    if (bodyOverride) bodyOverride();
    else drawKnobParams(vm);

    if (vm.overlay) drawEnumOverlay(vm);
    /* The file-browse gesture works here too — the touched param lives on the
     * model, not the view (see midi/router.ts) — and this view already draws
     * the file overlay. Without the hint the same touch showed the list on the
     * chain page but not how to open the full browser, which reads as the toast
     * appearing only sometimes. */
    if (vm.toast?.browseHint) drawJogToast('JOG: BROWSE');
    else if (jogTouched) drawJogToast(virtual ? 'CLICK JOG: EDIT LFOS' : 'SHIFT+CLICK SWAP  CLICK OPEN');
}
