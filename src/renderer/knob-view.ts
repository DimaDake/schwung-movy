import type { ViewModel } from '../types/viewmodel.js';
import { fontPrint, fontWidth } from '../font/index.js';
import { drawHeader, drawBankBar, drawHeaderWithPadIcon, PAD_ICON_W } from './header.js';
import { drawKnobParams } from './label.js';
import { drawEnumOverlay, drawJogToast } from './overlay.js';
import { W } from './layout.js';
import { drawKnobParamsSchwung } from './schwung-body.js';
import { schwungGridEnabled } from './schwung-flag.js';

/** What the bank bar should index, when it is not movy's own banks. */
export interface BankOverride { index: number; count: number }

export function renderKnobsView(vm: ViewModel, jogTouched = false, activeSlot = 0,
                                bodyOverride?: () => void, bank?: BankOverride): void {
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

    /* MOVY DRAWS THE BAR; SCHWUNG ONLY SAYS WHAT TO PUT IN IT.
     *
     * Under the grid the jog pages Schwung's page set, whose COUNT differs from
     * movy's banks, so movy's own index would sit still while the body paged.
     * `bank` carries Schwung's pageIndex/pageCount when it owns the paging.
     * Drawing it here rather than letting Schwung draw its own keeps one bar
     * (two were being stacked) and one visual language — and the groups go
     * with movy's banks, so they are dropped when the pages are not movy's. */
    const bankIndex = bank ? bank.index : vm.bankIndex;
    const bankCount = bank ? bank.count : vm.bankCount;
    const bankGroups = bank ? undefined : vm.bankGroups;
    if (vm.stepPagePresent) {
        const sel = vm.stepPageSelected ? 0 : bankIndex + 1;
        // The step page is a bank of its own, ahead of the module's own banks.
        drawBankBar(sel, bankCount + 1, true,
            bankGroups ? [-1, ...bankGroups] : undefined);
    } else {
        drawBankBar(bankIndex, bankCount, false, bankGroups);
    }
    /* The body band, drawn either by movy's own widgets or by Schwung's. Only
     * the WIDGETS move: the header is movy's in both cases, and so are the
     * overlays below. */
    if (bodyOverride) bodyOverride();
    else if (schwungGridEnabled()) drawKnobParamsSchwung(vm);
    else drawKnobParams(vm);

    if (vm.overlay) drawEnumOverlay(vm);
    // Limit reached + a step held: tell the user only the 8 lanes are editable.
    if (vm.automationHeld && vm.automationPoolFull) drawJogToast('8 AUTOMATION LANES — FULL');
    else if (vm.toast?.browseHint) drawJogToast('JOG: BROWSE');
    else if (jogTouched)      drawJogToast('CLICK JOG: SWAP MODULE');
}
