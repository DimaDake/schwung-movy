/* New with SP-28 — a module's own widget (`custom:` viz kinds) on hardware.
 *
 * WHAT ONLY THE DEVICE CAN SAY. `scripts/schwung-widgets-check.mjs` proves the
 * registry accepts the kinds movy decided on, and `browser-test/logic/schwung-
 * widgets.mjs` proves the decisions with no Schwung checkout at all. Neither can
 * prove the thing the defect was reported as, because it is not a property of
 * movy's code: a module SWAPPED INTO a slot while movy is already on the grid
 * registers its art, and a module swapped out takes it away. Registration used
 * to happen only inside `reload()` — construction and the retry — and a swap
 * goes through the controller's own cheap re-plan (`reloadIfChanged`, on a
 * divider), so the incoming module's canvas.js was never read: its cell went on
 * drawing the departed module's art, or a built-in.
 *
 * THE SWAP IS THE WHOLE SCENARIO, and it is done the user's way: the module is
 * written to the chain slot's OWN param (`ch0:synth:module`), the same key the
 * chain UI writes, and movy is never closed, reopened or navigated away from
 * for any of it. The knobs page stays up from before the first swap to after
 * the last — which is what "without leaving the grid" means, and it is the
 * difference between this and the path that always worked: a reopen rebuilds
 * the contract and registers through `reload()`.
 *
 * THREE READS, AND NONE OF THEM IS ENOUGH ALONE:
 *   the log line   (`widgets: hank registered custom:hank_wave`) says movy
 *                  decided to register. Written once per registration, so it is
 *                  read as a DELTA — debug.log persists across runs.
 *   the registry   (`probe.widget(kind)`) is the library's own answer through
 *                  movy's binding, which is the half a log line cannot make: a
 *                  registration that reached a second copy of a process-global
 *                  map logs identically and draws nothing.
 *   the frame      (`Display`) is the half neither can make — what is actually
 *                  on the screen.
 *
 * THE PAGE IS FOUND FROM THE SCREEN, NOT FROM THE VIEW MODEL, and that is a
 * correction this scenario paid for. Under `page` the plan AND THE PAGING are
 * Schwung's: a jog turn goes to the delegated controller (`app/page-owner.ts`
 * hands it to `page.changePage` whenever the page is ready), not to movy's
 * model, so the view model keeps reporting the bank it was built with while the
 * screen moves. MEASURED: four jog turns left `probe.page()` on
 * `page=0 of 3 cells=[PRESET]` — hank's Preset bank, which has no widget on it.
 * A frame comparison taken there compares a page the widget is not on, and the
 * first version of this failed exactly that way ("0 px changed"). So the walk
 * below is: read every page, clear the widget, read every page again, and the
 * page whose PIXELS moved is the page the widget is on.
 *
 * THE CLEAR COMES FROM MOVY, and that is the point of the probe verb: it wipes
 * the registry through the same door movy registers through, which is the state
 * a module with NO widget leaves behind. What is on screen then is the
 * FALL-THROUGH — an unclaimed `custom:` kind leaves its key to the built-in, so
 * the cell still draws. A cell that went blank instead would be a regression,
 * and this is the only place it can be seen.
 *
 * Covers:
 *   W1  the page is up before the swap, and nothing is registered
 *   W2  hank swapped in, in place: registered, and the registry serves the kind
 *   W3  the walk pages and repeats; hank's own art is what changes the screen
 *       when the widget goes; the cell is not a hole once it has (fall-through)
 *   W4  swapped away: the departed module's kind is out of the registry
 *   W5  swapped back: registered again, and its art is back on the same page
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scenario } from '../runner.js';
import { Device } from '../device.js';
import { Display, W, H } from '../display.js';
import { Probe } from '../probe.js';
import * as fixture from '../fixture.js';
import { until } from '../wait.js';

const run = promisify(execFile);
/* test-device/dist/scenarios/widgets.js at run time. */
const MOVY = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/* Frames of device work, never a wall clock — the same settle the other
 * scenarios give one gesture. A frame is ~2.9 ms of SPI work whatever the load;
 * the tick rate swings 63-205 Hz, so a sleep would assert a different thing on
 * a busy board. */
const ACT = 90;

/* The renderer every check here has to run under. Under `off` Schwung neither
 * plans nor draws, so there is no delegated page for a widget to be drawn into
 * and the scenario would be grading movy's own renderer instead. */
const PAGE_MODE = 'page';

/* Hank, verified on the device: `capabilities.canvas_script` = "canvas.js", the
 * `ratio` cell declares `viz.kind` = "custom:hank_wave", and its canvas.js
 * publishes BOTH spellings — `widgetKind` for hosts that only read the singular,
 * `widgetKinds` for the rest. That both-spellings shape is hank's own and is why
 * this suite runs against the shipped module rather than a fixture built to
 * suit it. `ratio` is on hank's Main bank, behind a Preset bank of its own, so
 * the sweep below is not decoration: the module does not open on the widget. */
const MODULE = 'hank';
const WIDGET = 'custom:hank_wave';
const REGISTERED = `widgets: ${MODULE} registered ${WIDGET}`;

/* Pages read per walk: the anchor plus this many more forward turns. hank's
 * page set is smaller than this, so a walk ends up reading the last page more
 * than once — which is right, because the controller clamps (or wraps) the same
 * way on every walk, so two walks line up page for page either way. */
const PAGES = 4;

/* Backward turns the anchor phase may spend before it gives up on finding a
 * turn that moves nothing. Every page of every module on the box is inside it
 * with room to spare; a walk that exhausts it is reported (see the sweep check)
 * rather than silently starting somewhere the other walk did not. */
const TURNS_MAX = 12;

/* A drawn mark, in pixels. The lit count of the region that changed is compared
 * against this: the claim is "something was drawn there", not a pixel-exact
 * picture, so the built-in's own art is not re-encoded here. Stray single pixels
 * do not reach it. */
const MIN_MARK = 8;

/* 128x64 1bpp, 8 pages of 128 bytes, bit 0 topmost — display.ts's layout, read
 * the same way Display.bandFill reads it. */
const lit = (buf: Buffer, x: number, y: number): number =>
    (buf[(y >> 3) * W + x] >> (y & 7)) & 1;

/* Which pixels these two frames disagree on, and the box they disagree in. THE
 * BOX IS THE POINT: it is where the widget draws, taken from the frames
 * themselves rather than from a layout constant this suite would then be
 * re-encoding — the cell's rect is a fact about the renderer, not about the
 * claim being made. */
function differing(a: Buffer, b: Buffer): { n: number; box: Box | null } {
    let n = 0, x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            if (lit(a, x, y) === lit(b, x, y)) continue;
            n++;
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
        }
    }
    return { n, box: n ? { x0, y0, x1, y1 } : null };
}
type Box = { x0: number; y0: number; x1: number; y1: number };

function inkIn(buf: Buffer, box: Box): number {
    let n = 0;
    for (let y = box.y0; y <= box.y1; y++) {
        for (let x = box.x0; x <= box.x1; x++) if (lit(buf, x, y)) n++;
    }
    return n;
}

const highest = (xs: number[]): { at: number; n: number } =>
    xs.reduce((best, n, at) => (n > best.n ? { at, n } : best), { at: 0, n: -1 });

type Page = { module?: string; pageIndex?: number; pageCount?: number;
              renderer?: string; view?: string; cells?: ({ name?: string } | null)[] };

scenario('widgets', async (t) => {
    fixture.setHost(t.host);
    const dev   = new Device(t.bus, t.agent, t.host);
    const probe = new Probe(t.bus);
    const disp  = new Display(t.host);
    const open  = () => dev.open(probe);
    const close = () => dev.close(probe);

    /* A movy track's chain lives in movy's OWN engine: the param is written
     * through `ch0:` and only while movy is open, or the module lands somewhere
     * the track is not (scenarios/items.ts learned this the same way). */
    const ep = async (key: string, value: string): Promise<void> => {
        await run('node', [join(MOVY, 'scripts', 'engine-param.mjs'),
                           'set', key, value, t.host], { maxBuffer: 8 * 1024 * 1024 });
    };

    /* WHAT THE SLOT GOES BACK TO. Asked of the fixture, never written down: the
     * module this suite swaps away to and the one it restores are the same, and
     * a hard-coded id is how an assertion stops describing the fixture it runs
     * against. It also has to be a module that ships no `custom:` kind, or
     * "swapped away" would not clear anything. */
    const AWAY  = fixture.fixtureSynth(0);
    const lines = () => dev.logLines(REGISTERED);

    const pageNow = async (): Promise<Page | null> => {
        try { const p = (await probe.page()) as Page; return p?.module === undefined ? null : p; }
        catch { return null; }
    };
    const waitPage = async (pred: (p: Page) => boolean, what: string): Promise<Page | null> => {
        try {
            return await until(t.bus, what, async () => (await probe.page()) as Page,
                               (p) => !!p && pred(p), { within: 4000, every: 150 });
        } catch { return await pageNow(); }
    };
    /* The page belongs to the module when it NAMES it, has cells on it and is
     * drawn by Schwung. All three: an empty slot renders a page too, and under
     * `off` the delegated page does not exist at all. */
    const isPage = (p: Page | null, name: string): boolean =>
        !!p && p.module === name && p.renderer === PAGE_MODE
        && (p.cells ?? []).some((c) => !!c?.name);
    const describe = (p: Page | null): string => !p ? 'movy has not rendered'
        : `renderer=${p.renderer} module=${p.module || '(none)'} page=${p.pageIndex} `
        + `of ${p.pageCount} view=${p.view} `
        + `cells=[${(p.cells ?? []).map((c) => c?.name).filter(Boolean).join(' ')}]`;

    /*
     * ONE WALK OVER THE MODULE'S PAGES, AND IT BEGINS AT A FIXED POINT.
     *
     * A backward turn at the FIRST page is not a page move at all: with a step
     * page available it SELECTS the step page (`midi/router.ts`, VIEW_KNOBS),
     * and from there further backward turns do nothing, because the branch that
     * would enter it again is behind a `selected` check. So "turn back until
     * the screen stops changing" lands on a page no turn can leave — the step
     * page, or the first page on a module without one — and every walk starts
     * from the same place whatever the last gesture left on screen.
     *
     * THAT ANCHOR IS NOT A FLOURISH, IT IS THE FIX FOR A MEASURED DEFECT. The
     * first version walked forward N turns and backward N to return, which is
     * only symmetric if a backward turn is the mirror of a forward one. It is
     * not: the return trip fell into the step page, so the second walk began
     * one screen ahead of the first and every page after it was compared
     * against the wrong page. MEASURED, from the frame dumps: pass one was
     * [widget page, dial page, dial page, dial page] and pass two was [step
     * page, widget page, dial page, dial page] — off by one, with the "changed"
     * count for the first index being the distance between two unrelated
     * screens and the widget's own page scoring the smaller number. The anchor
     * makes both walks the same walk.
     *
     * `idle` is the frame difference that ENDED the anchor: a turn that moved
     * the screen by nothing at all. It is a free measurement of what an
     * unchanging screen does between two reads, and it is 0 on this device.
     */
    const walk = async (): Promise<{ frames: Buffer[]; idle: number }> => {
        let prev = await disp.grab();
        let idle = -1;
        for (let i = 0; i < TURNS_MAX; i++) {
            await dev.tap.jogTurn(-1);
            await t.bus.frames(ACT);
            const cur = await disp.grab();
            idle = differing(prev, cur).n;
            prev = cur;
            if (idle === 0) break;
        }
        const frames: Buffer[] = [prev];
        for (let i = 1; i < PAGES; i++) {
            await dev.tap.jogTurn(1);
            await t.bus.frames(ACT);
            frames.push(await disp.grab());
        }
        return { frames, idle };
    };

    await fixture.ensure(t.bus, open, close);
    await dev.deployUi();
    await dev.open(probe);
    await dev.selectTrack(0);
    /* The slot goes back to the fixture's own synth whatever happens below —
     * including on a thrown wait, where the module would otherwise be left on
     * whatever the run died holding. */
    t.need.register(async () => { await ep('ch0:synth:module', AWAY); });

    /* Page mode by OVERRIDE (`setGridMode` writes nothing), so the device's own
     * prefs are never touched — the flags `npm run test:device` is preceded by
     * are set outside this process and left alone here. */
    t.note('gridMode', await probe.setGridMode(PAGE_MODE));

    /* The click has a precondition: in the chain view a jog click on an EMPTY
     * slot opens the module browser instead of drilling into the knobs, and it
     * is a no-op in the views above the chain. So it is repeated against the
     * page it is supposed to produce — a blind click that lands in the browser
     * leaves movy there for the whole run and every check below fails with
     * nothing saying why. */
    let pg: Page | null = null;
    for (let i = 0; i < 4 && !isPage(pg, AWAY); i++) {
        await dev.tap.jog();
        await t.bus.frames(ACT);
        pg = await waitPage((p) => isPage(p, AWAY), `${AWAY}'s knobs page`);
    }
    t.note('pageAtW1', pg && { module: pg.module, renderer: pg.renderer, view: pg.view,
                               pageIndex: pg.pageIndex,
                               cells: (pg.cells ?? []).map((c) => c?.name) });

    // ── W1: the page is up, and nothing is registered ────────────────────────
    /* THE PRE-CONDITION, and it is not decoration: "the swap registered it" is
     * only worth saying if the kind was NOT in the registry before the swap. A
     * kind left behind by an earlier module (or by an earlier run in this
     * shadow_ui process) would satisfy W2 without movy having done anything. */
    const before = await probe.widget(WIDGET);
    t.note('widgetBeforeSwap', before);
    t.check('nothing-registered-before-the-swap',
        'the fixture module is on the page and serves no custom widget',
        isPage(pg, AWAY) && before.available === false,
        { expected: `a rendered page naming ${AWAY} under renderer=${PAGE_MODE}, and `
                  + `${WIDGET} unavailable`,
          actual: `${describe(pg)}; ${WIDGET} available=${before.available}` });

    // ── W2: hank swapped IN, in place, without leaving the grid ──────────────
    /* THE DEFECT ITSELF. The page is already up and settled; nothing below
     * closes movy, presses Back or leaves the module — the module is written to
     * the slot's own param and the page comes to it. With registration reachable
     * only from `reload()`, no line is written and the kind never lands. */
    const regBefore = (await lines()).length;
    await ep('ch0:synth:module', MODULE);
    let said = false;
    try {
        await until(t.bus, `movy to register ${WIDGET}`, lines,
                    (ls) => ls.length > regBefore, { within: 4000, every: 150 });
        said = true;
    } catch { /* the check below reports what is missing */ }
    const pgHank = await waitPage((p) => isPage(p, MODULE), `${MODULE}'s page`);
    const reg = await probe.widget(WIDGET);
    t.note('swapIn', { logLines: (await lines()).length - regBefore, widget: reg });
    t.note('pageAtW2', pgHank && { module: pgHank.module, renderer: pgHank.renderer,
                                   view: pgHank.view, pageIndex: pgHank.pageIndex,
                                   cells: (pgHank.cells ?? []).map((c) => c?.name) });
    t.check('swap-in-registers-the-widget',
        'a module swapped into the slot in place registers its widget, and the registry serves it',
        said && reg.available === true && isPage(pgHank, MODULE),
        { expected: `a new "${REGISTERED}" line in the device log, ${WIDGET} available, `
                  + `and the page naming ${MODULE} under renderer=${PAGE_MODE} — with no `
                  + `close, reopen or navigation anywhere in this scenario`,
          actual: `${said ? 'the line was written' : `no new "${REGISTERED}" line`}; `
                + `${WIDGET} available=${reg.available}; ${describe(pgHank)}` });

    // ── W3: what hank drew is on the screen, and the cell is not a hole ──────
    /* See the header and `walk`: the page is found from the SCREEN, because
     * under `page` the paging is Schwung's and movy's view model cannot be asked
     * which page is up. Two walks from the same anchor, one either side of the
     * clear; the page whose pixels moved is the one the widget is on. */
    const withArt = await walk();
    const pagesDiffer = highest(withArt.frames.flatMap((a, i) =>
        withArt.frames.slice(i + 1).map((b) => differing(a, b).n)));
    const cleared = await probe.widget(WIDGET, { clear: true });
    await t.bus.frames(ACT);
    const without = await walk();
    const moved = withArt.frames.map((b, i) => differing(b, without.frames[i]));
    const widgetPage = highest(moved.map((m) => m.n));
    const box = moved[widgetPage.at].box;
    const mark = box ? inkIn(without.frames[widgetPage.at], box) : 0;
    const rest = moved.filter((_m, i) => i !== widgetPage.at).map((m) => m.n);
    t.note('frames', { mostPagesDifferBy: pagesDiffer.n, anchorIdlePx: withArt.idle,
                       changedPxPerPage: moved.map((m) => m.n), widgetPage: widgetPage.at,
                       box, inkAfterClear: mark, cleared });

    /* The validity control, and it comes first on purpose. Two things have to
     * hold before "clearing the widget moved page N" means anything: a jog turn
     * has to move the page at all, and the two walks have to have started from
     * the same screen. The second is not free — it is what the anchor buys, and
     * it is the first thing this check ever caught. */
    t.check('the-sweep-is-a-repeatable-walk',
        'a jog turn pages, and both walks begin at the same screen',
        pagesDiffer.n >= MIN_MARK && withArt.idle === 0 && without.idle === 0,
        { expected: `at least ${MIN_MARK} pixels to separate two of the ${PAGES} screens a `
                  + `walk reads, and a backward turn that moves nothing at the end of each `
                  + `anchor phase (so both walks start from the same screen)`,
          actual: `the most any two screens of the walk differ by is ${pagesDiffer.n} px; `
                + `the anchor phases ended on ${withArt.idle} px and ${without.idle} px `
                + (withArt.idle === 0 && without.idle === 0
                   ? '— one screen, walked twice'
                   : `— ${TURNS_MAX} backward turns without reaching a screen a turn cannot `
                   + `leave, so the two walks may not be comparing the same pages`) });
    t.check('the-widget-is-what-is-on-the-screen',
        "hank's own drawing reaches the panel, and clearing it changes the frame",
        widgetPage.n >= MIN_MARK && rest.every((n) => n < MIN_MARK),
        { expected: `exactly one screen of the walk to change when the widget is cleared, `
                  + `and by at least ${MIN_MARK} px — the cell it draws in`,
          actual: `screen ${widgetPage.at} changed by ${widgetPage.n} px (box `
                + `${JSON.stringify(box)}), the others by `
                + `${rest.join(', ') || 'none'} — more than one screen moving means the `
                + `clear re-planned the pages and not just the cell` });
    t.check('fallthrough-still-draws',
        'with nothing claiming the cell, a built-in draws there instead of a hole',
        cleared.available === false && !!box && mark >= MIN_MARK,
        { expected: `${WIDGET} unavailable after the clear, and the region the widget had `
                  + `been drawing still inked`,
          actual: `${WIDGET} available=${cleared.available}; ${mark} lit pixels where the `
                + `widget had been drawing (box ${JSON.stringify(box)})` });

    // ── W4: swapped AWAY — the departed module's art does not survive ────────
    /* The registry is PROCESS-GLOBAL and shadow_ui is long-lived, so without the
     * clear a later module spelling `custom:hank_wave` would silently inherit
     * art belonging to a module no longer in the slot. */
    await ep('ch0:synth:module', AWAY);
    const pgAway = await waitPage((p) => isPage(p, AWAY), `${AWAY}'s page back`);
    const away = await probe.widget(WIDGET);
    t.note('swapAway', { widget: away, page: pgAway?.module });
    t.check('swap-away-leaves-nothing-behind',
        "the departed module's kind is out of the registry",
        isPage(pgAway, AWAY) && away.available === false,
        { expected: `${AWAY} back on the page with ${WIDGET} unavailable`,
          actual: `${describe(pgAway)}; ${WIDGET} available=${away.available}` });

    // ── W5: and back again, still on the same pages ──────────────────────────
    /* The second swap is the same claim as W2 with the clear in between, which
     * is what makes it worth doing: W2 could in principle be satisfied by a
     * registration that happened to still be there. Here the kind is known to be
     * gone first, so this one can only pass by registering — and the walk says
     * the art came back to the SAME page it had left. */
    const regBefore2 = (await lines()).length;
    await ep('ch0:synth:module', MODULE);
    let said2 = false;
    try {
        await until(t.bus, `movy to register ${WIDGET} again`, lines,
                    (ls) => ls.length > regBefore2, { within: 4000, every: 150 });
        said2 = true;
    } catch { /* reported below */ }
    const pgBack = await waitPage((p) => isPage(p, MODULE), `${MODULE}'s page back`);
    const back = await probe.widget(WIDGET);
    const backArt = await walk();
    const returned = differing(without.frames[widgetPage.at], backArt.frames[widgetPage.at]).n;
    const markBack = box ? inkIn(backArt.frames[widgetPage.at], box) : 0;
    t.note('swapBack', { logLines: (await lines()).length - regBefore2, widget: back,
                         changedOnTheWidgetPage: returned, inkWhereTheWidgetWas: markBack });
    t.check('swap-back-registers-again',
        'a second swap, still on the pages: registered again and drawn again',
        said2 && back.available === true && isPage(pgBack, MODULE)
        && returned >= MIN_MARK && markBack >= MIN_MARK,
        { expected: `a second "${REGISTERED}" line, ${WIDGET} available, the page still `
                  + `${MODULE}'s under renderer=${PAGE_MODE}, and page ${widgetPage.at} — the `
                  + `one the widget draws on — changed again`,
          actual: `${said2 ? 'the line was written' : `no new "${REGISTERED}" line`}; `
                + `${WIDGET} available=${back.available}; page ${widgetPage.at} changed by `
                + `${returned} px against the cleared pass, and `
                + (box ? `${markBack} lit pixels are in the box the widget had drawn in `
                            + `${JSON.stringify(box)}`
                       : 'no box was established by the first comparison, so there is nowhere '
                       + 'this could read the ink from')
                + `; ${describe(pgBack)}` });
});
