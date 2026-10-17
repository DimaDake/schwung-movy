import type { ViewModel } from '../types/viewmodel.js';
import { fontPrint, fontWidth } from '../font/index.js';
import { drawHeader, drawBankBar, drawHeaderWithPadIcon, PAD_ICON_W, padIconShown } from './header.js';
import { drawJogToast } from './overlay.js';
import { W } from './layout.js';
import { CHAIN_SLOTS, isVirtualSlot, type ChainSlot } from '../chain/config.js';
import type { PageChrome } from './schwung-page-chrome.js';
import { drawPageFooter } from './schwung-footer.js';

/* `slots` is the chain being drawn — a track's or the master's. It used to be
 * CHAIN_SLOTS unconditionally, which drew the track chain's five dots over the
 * master's four slots. */
export function renderChainView(vm: ViewModel, chainIndex: number, jogTouched: boolean, trackLabel: string,
                                slotLabel?: string, slots: ChainSlot[] = CHAIN_SLOTS,
                                body: () => void = () => {}, chrome?: PageChrome): void {
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

    /* Same precedence as the module page: the held param's readout is the
     * page's own. */
    if (chrome?.header) {
        drawHeader(chrome.header.left, chrome.header.right, chrome.header.inverted);
    } else {
        /* A voice page carries the same pad-grid icon it does on the module
         * page: this view shows that page's knobs, so which voice they belong
         * to is the same question here. */
        const showIcon = padIconShown(vm, chrome);
        const leftW    = fontWidth(trackLabel) + 4 + (showIcon ? PAD_ICON_W : 0);
        const maxRight = W - leftW - 4;
        /* A DECLARED RACK NAMES THE PAD, not the module. The module's name is
         * already the one thing this view's bank bar and slot dots are about,
         * while WHICH DRUM the knobs below belong to is otherwise unsayable —
         * reported from the device as a header that just read "T4 Voice-POC"
         * however many pads you moved through. Falls back to the module name
         * the moment the module has not declared one. */
        /* A virtual slot (the LFO) has no module to name — this end names the
         * PAGE, Schwung's own label (LFO 1 / LFO 2, SP-60). */
        let right = (virtual && chrome?.pageLabel) || vm.drumPadName || vm.moduleName;
        while (right.length > 1 && fontWidth(right) > maxRight) right = right.slice(0, -1);
        if (showIcon) drawHeaderWithPadIcon(trackLabel, right, vm.drumPadCount, vm.drumCurrentPad);
        else          drawHeader(trackLabel, right, false);
    }

    /* THIS BAR STAYS, GRID OR NOT. It counts CHAIN SLOTS, and on this view the
     * jog moves chain slots — `setChainIndex`, never a page owner — so it
     * is live and it is the only thing saying which fx slot you are on.
     * Schwung is asked not to draw a bank bar (see schwung-page.ts) precisely
     * so this one is the only one. */
    if (vm.stepPagePresent) {
        const sel = vm.stepPageSelected ? 0 : chainIndex + 1;
        drawBankBar(sel, slots.length + 1, true);
    } else {
        drawBankBar(chainIndex, slots.length);
    }
    /* THE CHAIN VIEW DRAWS THE KNOB BODY TOO — movy opens on this view. */
    body();

    if (jogTouched) drawJogToast(virtual ? 'CLICK JOG: EDIT LFOS' : 'SHIFT+CLICK SWAP  CLICK OPEN');
    /* Only ever the click pair here — the jog moves chain slots, not Schwung's
     * pages, so no jog verb is offered (`clickOnlyFooter`). */
    else if (chrome?.footer?.length) drawPageFooter(chrome.footer);
}
