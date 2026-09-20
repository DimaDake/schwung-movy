import type { ViewModel } from '../types/viewmodel.js';
import { fontPrint, fontWidth } from '../font/index.js';
import { drawHeader, drawBankBar, drawHeaderWithPadIcon, PAD_ICON_W } from './header.js';
import { drawKnobParams } from './label.js';
import { drawEnumOverlay, drawJogToast } from './overlay.js';
import { W } from './layout.js';
import type { PageChrome } from './schwung-page-chrome.js';
import { drawPageFooter } from './schwung-footer.js';

/** What the bank bar should index, when it is not movy's own banks. */
export interface BankOverride { index: number; count: number }

/* SP-37 — WHAT THE HEADER'S RIGHT-HAND END SAYS, AND IN WHAT ORDER.
 *
 * The page's own name leads. The page IS where you are, and under a delegated
 * page the bar above already counts Schwung's pages (`bank.index`/`count`),
 * whose set differs in length from movy's banks — so naming movy's bank here
 * printed one set's name under another set's bar, a constant on a module whose
 * config opens with a preset bank. That was the reported symptom.
 *
 * THE PAD NAME IS THE FALLBACK, NOT THE WINNER, and the difference is a whole
 * class of the same symptom. `vm.drumPadName` is the FOCUSED pad's — a
 * property of the module, not of the page — so letting it lead pins this text
 * to one word for the entire module: on a declared drum rack the jog moved the
 * bar and the body and left the one piece of text that says where you are
 * standing still. It still leads where it is the only name there is: no chrome
 * at all (`off`, or the delegated page is not the body), or a null label (no
 * page, or a controller that cannot name one) — which is movy's header before
 * this item, unchanged.
 *
 * ON THE PAGE THAT IS THAT PAD'S PAGE the two agree — the page is named after
 * the voice — so the pad name still names the header there, and nothing is
 * lost by having the label in front.
 *
 * Exported because this expression is the item: a renderer read only as pixels
 * cannot say "and it changes when the jog does". `logic/schwung-page.mjs`
 * asserts the rule; the screenshot scene asserts the frame draws it. */
export function headerRightText(vm: ViewModel, chrome?: PageChrome): string {
    return chrome?.pageLabel || vm.drumPadName || vm.bankName;
}

export function renderKnobsView(vm: ViewModel, jogTouched = false, activeSlot = 0,
                                bodyOverride?: () => void, bank?: BankOverride,
                                chrome?: PageChrome): void {
    clear_screen();

    /* THE HELD PARAM OUTRANKS MOVY'S TOAST, and under a delegated page it has
     * to: movy's model still records the touch (it is what the release, the
     * header readout and the file-browse gesture read) and raises its own toast
     * for it — but the param it names is movy's own bank's, which is not the
     * one on screen. Drawing Schwung's readout first is what makes the header
     * true. */
    if (chrome?.header) {
        drawHeader(chrome.header.left, chrome.header.right, chrome.header.inverted);
    } else if (vm.toast) {
        drawHeader(vm.toast.fullName, vm.overlay ? null : vm.toast.value, true);
    } else {
        const showIcon = vm.isPadScoped && vm.drumPadCount > 0;
        const iconW    = showIcon ? PAD_ICON_W : 0;
        /* The rule, and why the pad name is the fallback rather than the
         * winner, is on `headerRightText` above. The pad ICON below still
         * carries the focused pad, so the header names the page and the icon
         * names the voice — the two facts this band can hold at once. */
        const rightText = headerRightText(vm, chrome);
        const rightW   = rightText ? fontWidth(rightText) + iconW + 4 : 0;
        const maxLeftW = W - rightW - 4;
        const trackLabel = 'T' + (activeSlot + 1);
        let dispName     = vm.headerOverride ?? (trackLabel + ' > ' + vm.moduleName);
        while (dispName.length > 1 && fontWidth(dispName) > maxLeftW) {
            dispName = dispName.slice(0, -1);
        }
        if (showIcon && rightText) {
            drawHeaderWithPadIcon(dispName, rightText, vm.drumPadCount, vm.drumCurrentPad);
        } else {
            drawHeader(dispName, rightText || null, false);
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
    else drawKnobParams(vm);

    if (vm.overlay) drawEnumOverlay(vm);
    // Limit reached + a step held: tell the user only the 8 lanes are editable.
    if (vm.automationHeld && vm.automationPoolFull) drawJogToast('8 AUTOMATION LANES — FULL');
    else if (vm.toast?.browseHint) drawJogToast('JOG: BROWSE');
    else if (jogTouched)      drawJogToast('CLICK JOG: SWAP MODULE');
    /* THE FOOTER IS THE LAST RESORT FOR THOSE ROWS, not a layer over them. A
     * toast and a Schwung hint band occupy the same six rows (TOAST_Y 58 and
     * the footer's 57..63), so one has to lose: it is the footer, because a
     * toast is about THIS MOMENT and the hints are always true. Drawing it last
     * in the chain is what makes the yield complete — a footer drawn under a
     * toast would leave its pill tops on row 57, above a banner that has taken
     * the rest. */
    else if (chrome?.footer?.length) drawPageFooter(chrome.footer);
}
