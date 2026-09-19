/* schwung-page-chrome.ts — the two bands movy keeps for itself under Schwung's
 * page, and what goes in them.
 *
 * THE HEADER IS SCHWUNG'S ANSWER, DRAWN BY MOVY. `bands.header` stays false in
 * schwung-page-render.ts, and that is a LAYOUT decision rather than a claim
 * that movy has nothing to say: Schwung's own chrome needs 47 + 2 + 7 = 56
 * rows below the header and movy leaves 54. So movy draws it, but it does not
 * GET to decide what it says — `describePage().header` is built by Schwung's
 * `movyHeaderFor`, the same function `renderPageMovy` draws its own header
 * with, so the readout cannot drift from the one Schwung's host shows.
 *
 * ONLY WHILE A KNOB IS HELD. Nothing held, and movy's own header — track,
 * module, pad grid icon — says more than Schwung's title branch does, and says
 * it in movy's grammar. `inverted` is exactly the question "is a param under
 * the hand": movyHeaderFor sets it on that branch and no other, so the flag is
 * the gate rather than a re-derivation of it. (A knob held over an UNBOUND cell
 * takes the other branch, whose left side is the empty title — drawing that
 * would blank movy's header, so it is treated as no answer at all.)
 *
 * THE FOOTER'S WORDS ARE MOVY'S, ITS CONDITIONS ARE NOT. Schwung's own
 * vocabulary lives in `footerHints()` in shadow_ui_param_pages.mjs — the
 * shadow-side HOST, which movy may not import — so the verbs below are a second
 * copy, and the project's rule about second copies ("ask the controller; do not
 * restate") is answered by taking every CONDITION from the controller: which
 * page kind, whether it is entered, whether the picker is over it, and whether
 * the cell under the hand is a trigger, a two-way or a door. Only the words are
 * restated, and the verbs chosen are the ladder `onClick` actually walks.
 *
 * IT IS ONLY THE KNOBS VIEW'S. On the chain view the jog moves CHAIN SLOTS, not
 * pages (`chain-view.ts` argues this at length), so a `JOG PAGE` pill there
 * would promise a thing the button does not do — the exact class of bug the
 * upstream footer's own comments record three times. movy keeps the chain
 * view's footer, so the caller passes `paging: false`.
 *
 * THE PAGE LABEL IS THE THIRD THING, AND IT IS NOT A BAND. movy's header names
 * the page on its right — and under `page` the bank BAR is already Schwung's
 * (`schwungBankFor`, over `pageIndex`/`pageCount`) while that name was still
 * movy's bank, so the bar paginated one set and the label named the other. On a
 * module whose movy config opens with a preset bank the label is a constant.
 * `pageLabel` rides here because this is the one place that composes what movy
 * says while a delegated page is the body, and because the whole object is
 * withheld where the delegated page is not what is drawn (`schwungChromeFor`
 * returns undefined), which is what keeps `off` byte-identical.
 */
import type { SchwungLib } from './schwung-lib.js';

export interface PageHeader {
    left: string;
    right: string | null;
    inverted: boolean;
}

/** What movy draws in the rows Schwung is not asked for. `header` null means
 *  movy's own header stands; `footer` null means movy's own footer does.
 *  `pageLabel` is not a band: it is the page's own name, for the right-hand end
 *  of a header movy is already drawing. */
export interface PageChrome {
    header: PageHeader | null;
    footer: [string, string][] | null;
    pageLabel: string | null;
}

/** Everything movy draws around Schwung's body, in one answer.
 *  `paging` is false wherever the jog moves something that is not Schwung's
 *  page set — the chain view, where it moves chain slots. */
export function chromeFor(ctl: any, lib: SchwungLib, paging: boolean): PageChrome {
    const held = !!(ctl && ctl.state && ctl.state.touched >= 0);
    return {
        header: heldHeaderFor(ctl),
        pageLabel: pageLabelFor(ctl),
        /* A HAND ON A KNOB TAKES THE BOTTOM ROWS, AND THAT IS THE WHOLE RULE.
         *
         * The hint band and the Loop strip occupy overlapping rows — the
         * footer's 57..63 against the strip's 60..63, which it clears on EVERY
         * tick, outside the dirty-frame block, so anything drawn there without
         * the claim below keeps only its top three rows. They cannot both have
         * it, and the persistent readout is not the one that should lose: the
         * strip is live musical feedback.
         *
         * So the footer is a TRANSIENT occupant, on exactly the terms movy's
         * own bottom-row toasts already take the row (`jogHintVisible()` —
         * the jog under a finger). It is also when the hints are worth the
         * room: a knob under the hand is what changes what the click means
         * (OPEN, FLIP, FIRE), while with nothing held the click is MENU and
         * saying so is the least useful line on the screen. */
        footer: held && paging ? pageFooterFor(ctl, lib) : null,
    };
}

/* THE PAGE'S OWN NAME, from the controller — never `page.name`. A page belonging
 * to a CHILD level is named after WHICH CHILD it is showing, which the planned
 * name cannot know: minijv plans "Edit Parts - 2" where the 2 is the second page
 * OF THE LEVEL, so a user who has just chosen Part 2 reads the wrong number
 * (`page_controller.mjs` says so at `pageLabel`, and Schwung's own host header
 * takes the same answer — movy's header must not call the page something the
 * host would not).
 *
 * GUARDED, like every optional read across the movy↔Schwung seam: a Schwung that
 * cannot answer is the same as a page with no name, which is the header movy
 * drew before this existed. `''` collapses to null for the same reason — an
 * empty name must not win the `||` chain and blank the label movy would have
 * shown. */
export function pageLabelFor(ctl: any): string | null {
    if (!ctl || typeof ctl.pageLabel !== 'function') return null;
    const name = ctl.pageLabel();
    return (name === undefined || name === null || name === '') ? null : String(name);
}

export function heldHeaderFor(ctl: any): PageHeader | null {
    if (!ctl || !ctl.state || ctl.state.touched < 0) return null;
    const h = ctl.describePage({}).header;
    return h && h.inverted ? h : null;
}

/* A door is inert until entered, so outside it the jog still pages and the
 * click is what goes in; inside, the jog drives the list and Back comes out.
 * Same shape for all three kinds — only the noun and the click verb change,
 * and those are the words the shadow footer uses for the same three. The KINDS
 * come from the controller's own constants rather than their string values, so
 * a rename upstream cannot quietly turn a door into a plain knob page here. */
function doorVerbs(lib: SchwungLib, kind: string): [[string, string], [string, string], [string, string]] | null {
    switch (kind) {
        case lib.PAGE_MENU:   return [['JOG', 'SEL'],  ['CLK', 'OPEN'], ['BACK', 'OUT']];
        case lib.PAGE_PRESET: return [['JOG', 'PRST'], ['CLK', 'EDIT'], ['BACK', 'OUT']];
        case lib.PAGE_ITEMS:  return [['JOG', 'SEL'],  ['CLK', 'LOAD'], ['BACK', 'OUT']];
    }
    return null;
}

export function pageFooterFor(ctl: any, lib: SchwungLib): [string, string][] | null {
    if (!ctl) return null;

    /* The picker is OVER the page, so nothing below it is what a click does. */
    if (ctl.pickerOpen) return [['JOG', 'SECT'], ['CLK', 'GO'], ['BACK', 'EXIT']];

    const p = ctl.page;
    const entered = !!(ctl.menuEntered && ctl.menuEntered());
    const verbs = p ? doorVerbs(lib, p.kind) : null;
    if (verbs) {
        return entered ? verbs : [['JOG', 'PAGE'], ['CLK', 'ENTER']];
    }

    const held = ctl.state ? ctl.state.touched : -1;
    if (held >= 0) {
        const meta = ctl.metaAt ? ctl.metaAt(held) : null;
        /* A trigger is a BUTTON: the click does the thing and returns no
         * intent at all, so the footer has to name the consequence. */
        if (meta && meta.writeOnly) {
            return [['JOG', 'PAGE'], ['CLK', 'FIRE'], ['KNB', 'FIRE']];
        }
        /* A two-option divable enum FLIPS in the controller and returns no
         * intent either — and worse, it never reaches `openSchwungEditor`, so
         * a footer promising OPEN here would be the one pair of the three this
         * file cannot be told apart from by what it does. `flipsOnClick` is
         * Schwung's own predicate, so the two cannot disagree about WHICH
         * params those are. */
        if (lib.flipsOnClick && lib.flipsOnClick(meta)) {
            return [['JOG', 'PAGE'], ['CLK', 'FLIP']];
        }
        /* ...or divable through the picture it is drawn in, which is what a
         * viz dive target is. Same accessor the click uses. */
        if ((meta && meta.divable) || (ctl.diveTargetAt && ctl.diveTargetAt(held))) {
            return [['JOG', 'PAGE'], ['CLK', 'OPEN']];
        }
    }

    return [['JOG', 'PAGE'], ['CLK', 'MENU']];
}
