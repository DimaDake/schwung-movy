/* New with SP-15 — the page contract's LIFECYCLE on hardware.
 *
 * WHAT ONLY THE DEVICE CAN SAY. `browser-test/logic/page-contract.mjs` drives
 * both halves against a param store the suite writes, and a store the suite
 * writes is the one thing under suspicion: "resolved and empty" is a claim about
 * what the ENGINE answers for a slot that has just gone None, and the logic
 * suite can only model that. Here the module is really loaded, really cleared
 * through the same param the chain UI writes (`ch0:synth:module`), and what movy
 * draws afterwards is read back from movy.
 *
 * THE PAGE GATES; THE LOG ONLY CORROBORATES.
 *
 *   `probe.page()`  is movy's last rendered view model: the module the page
 *                   belongs to and the cells on it. A transition in it is the
 *                   direct answer to "did the frame change hands", so every
 *                   check below waits on it.
 *   `schwung-body`  (app/tick.ts) is the reason the body was drawn or handed
 *                   back — the only statement of whether Schwung or movy is
 *                   drawing. It is written ONCE PER DISTINCT REASON, so a
 *                   claim whose reason has not changed writes nothing at all,
 *                   and the pattern that deduplicated it away is
 *                   indistinguishable from the pattern that never ran. It is
 *                   recorded, never waited on.
 *
 * WHAT THIS DOES NOT DO: prove the retry latch is what changed. THE TEETH ARE
 * IN `browser-test/logic/page-contract.mjs`, which goes red with the latch
 * taken out. This suite is the same story on hardware, and on hardware it
 * passes either way — MEASURED, with the latch reverted, the renderer pinned to
 * `page`, and the empty window at `PAST_OLD_BUDGET`: 29 s of device work, ~1840
 * ticks at the slowest rate the board is known to tick against a 720-tick
 * budget, and the module's page still comes back. So the device does not reach
 * the latch by this route at all — something re-makes the contract when the
 * module lands — and which path that is has not been established here.
 *
 * The first version of L3 could not have shown teeth whatever the latch did:
 * it waited `OLD_BUDGET` FRAMES (2.4 s) against a budget denominated in TICKS,
 * so it finished inside the urgent window, where even the reverted rule reloads
 * on the ordinary retry. It also graded movy's own renderer — see the renderer
 * note above L1. What is left is worth keeping and is the reason the check
 * stays: the end-to-end outcome on hardware, which the logic suite can only
 * model — the engine's own answer for a slot that has just gone None, and a
 * frame that comes back without a gesture.
 *
 * Covers:
 *   L1  page mode draws the loaded module's page
 *   L2  the slot set to None hands the frame back, with no navigation
 *   L3  movy opened on an empty slot draws the module that lands in it later,
 *       with no navigation. That is the shape the item is about: after a cold
 *       boot no chain slot is active at all.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scenario } from '../runner.js';
import { Device } from '../device.js';
import { Probe } from '../probe.js';
import * as fixture from '../fixture.js';
import { until } from '../wait.js';

const run = promisify(execFile);
/* test-device/dist/scenarios/page-lifecycle.js at run time. */
const MOVY = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/* Frames of device work, never a wall clock. ACT is the settle the other
 * scenarios use for one gesture. */
const ACT = 90;

/* movy's own lines reach debug.log twice — once per sink. Narrowed to one here
 * so "the last line" is unambiguous rather than index-parity. */
const SHADOW = '[shadow]';
const BODY   = 'schwung-body';

/* The OLD retry budget — RETRY_TICKS x RETRY_LIMIT = 720 TICKS — which is what
 * has to be spent with the slot empty before the latch closes. L3 waits that
 * out before the module arrives, because a budget already spent when the user
 * loads is what made the bug permanent.
 *
 * THE WAIT IS IN FRAMES AND THE BUDGET IS IN TICKS, AND THEY ARE NOT ON A
 * RATIO. A frame is ~2.9 ms of SPI work whatever the load; the tick rate swings
 * 63-205 Hz. So the frames have to be sized for the SLOWEST tick — 720 ticks at
 * 63 Hz is 11.4 s, ~3940 frames. The first version of this check waited 810
 * FRAMES (2.4 s) and so finished deep inside the urgent window, where even the
 * reverted rule reloads on the ordinary retry: it could not have shown teeth
 * whatever the latch did. The window below is sized PAST the budget so that the
 * premise is true — and the reverted rule passes it anyway, which is a fact
 * about the device and not about the arithmetic (see the header). */
const OLD_BUDGET_TICKS = 12 * 60;
const PAST_OLD_BUDGET  = 10000;   /* the shim caps one WAIT_FRAME at 10000 */

/* What movy names a slot that has nothing in it (`loadHierarchy: slot=N
 * module=—` in the same log). A page for it is movy's own, not a module's. */
const EMPTY_NAME = '—';

/* The renderer every check here has to be run against. Schwung plans AND draws
 * under it, which is the only arm in which the delegated page's contract — the
 * thing SP-15 is about — exists at all. */
const PAGE_MODE = 'page';

type Page = { module?: string; pageCount?: number; pageIndex?: number;
              renderer?: string; cells?: ({ name?: string } | null)[] };

scenario('page-lifecycle', async (t) => {
    fixture.setHost(t.host);
    const dev   = new Device(t.bus, t.agent, t.host);
    const probe = new Probe(t.bus);
    const open  = () => dev.open(probe);
    const close = () => dev.close(probe);

    /* A movy track's chain lives in movy's OWN engine: the param is written
     * through `ch0:` and only while movy is open, or the module lands somewhere
     * the track is not (scenarios/items.ts learned this the same way). */
    const ep = async (key: string, value: string): Promise<void> => {
        await run('node', [join(MOVY, 'scripts', 'engine-param.mjs'),
                           'set', key, value, t.host], { maxBuffer: 8 * 1024 * 1024 });
    };

    const MODULE = fixture.fixtureSynth(0);
    t.note('fixtureSynth', MODULE);

    /* debug.log PERSISTS across runs and is grep'd whole over ssh, so a read is
     * slow enough to land either side of the change it is looking for. The
     * device's own clock is taken once and every line read after it is stamped
     * with it, which is immune to the two ways a count is not: a claim whose
     * reason is unchanged adds no line, and a rotated log takes lines away. */
    let watermark = '00:00:00';
    try {
        const { stdout } = await run('ssh', ['-o', 'ConnectTimeout=5', '-o', 'BatchMode=yes',
            `ableton@${t.host}`, 'date +%H:%M:%S']);
        watermark = stdout.trim();
    } catch { /* no watermark: the notes below fall back to the raw tail */ }
    const bodyLines = async (): Promise<string[]> =>
        (await dev.logLines(BODY)).filter((l) => l.includes(SHADOW));
    const bodySince = async (): Promise<string[]> =>
        (await bodyLines()).filter((l) => l.slice(0, 8) >= watermark);
    const lastBody = async (): Promise<string> => {
        const ls = await bodyLines();
        return ls.length ? ls[ls.length - 1] : '';
    };

    const pageNow = async (): Promise<Page | null> => {
        try { const p = (await probe.page()) as Page; return p?.module === undefined ? null : p; }
        catch { return null; }
    };
    const waitPage = async (pred: (p: Page) => boolean, what: string,
                            within: number): Promise<Page | null> => {
        try {
            return await until(t.bus, what, async () => (await probe.page()) as Page,
                               (p) => !!p && pred(p), { within, every: 150 });
        } catch { return await pageNow(); }
    };
    const dump = (p: Page | null) => p && { module: p.module, pageCount: p.pageCount,
                                            renderer: p.renderer,
                                            cells: (p.cells ?? []).map((c) => c?.name) };
    const describe = (p: Page | null): string => !p ? 'movy has not rendered'
        : `renderer=${p.renderer} module=${p.module || '(none)'} pages=${p.pageCount} `
        + `cells=[${(p.cells ?? []).map((c) => c?.name).filter(Boolean).join(' ')}]`;
    /* The page belongs to the module when it NAMES it and has cells on it. The
     * cell list is what makes this non-vacuous: an empty slot renders a page
     * too, so `pageCount > 0` alone is true for a slot with nothing in it. */
    const hasCells = (p: Page): boolean => (p.cells ?? []).some((c) => !!c?.name);
    const isModules = (p: Page): boolean => p.module === MODULE && hasCells(p);
    /* AND SCHWUNG IS THE ONE DRAWING IT (SP-15 review).
     *
     * `renderer` is `schwungGridMode()`'s own answer, so this reads the arm the
     * check actually ran in rather than trusting it — and the arm is not
     * decoration: under `off` the delegated contract is not in the picture at
     * all, so a check about ITS lifecycle would be grading movy's own renderer,
     * which no contract-lifecycle reason can fail. L3's reopen drops the
     * override and falls back to the device's `schwunggrid` flag, which is what
     * made the one check that carries the item run in `off` on the graded
     * sweep. Every check below is gated on this. */
    const delegated = (p: Page | null): boolean => !!p && p.renderer === PAGE_MODE;
    const isDelegatedModules = (p: Page): boolean => isModules(p) && delegated(p);

    await fixture.ensure(t.bus, open, close);
    await dev.deployUi();
    await dev.open(probe);
    await dev.selectTrack(0);
    /* The slot is put back whatever happens below — this suite empties it. */
    t.need.register(async () => { await ep('ch0:synth:module', MODULE); });

    /* Page mode by OVERRIDE (`setGridMode` writes nothing), so the device's own
     * prefs are never touched. IT ALSO SURVIVES NO REOPEN: `dev.reopen` is
     * close + `openTool`, and `openTool` re-evaluates `ui.js`, so the override —
     * a module-level `let` — is gone and the mode falls back to the device's
     * `schwunggrid` flag. L3 therefore RE-ARMS IT after its reopen; that is the
     * line that makes L3 a delegated check, and it is also what makes this
     * scenario independent of whatever the device happens to be set to. */
    const mode = await probe.setGridMode(PAGE_MODE);
    t.note('gridMode', mode);

    /* ── L1: the module's page comes up in page mode ──────────────────────────
     * THE CLICK HAS A PRECONDITION. In the chain view a jog click on an EMPTY
     * slot opens the module browser instead of drilling into the knobs
     * (src/midi/router.ts), and it is a no-op in the views above the chain. So
     * the click is repeated against the page it is supposed to produce rather
     * than fired blind: a blind click that lands in the browser leaves movy
     * there for the whole run, which is what the first version of this scenario
     * did — every check failed against a log line left by the fixture and
     * nothing said why.
     *
     * The gate for everything below. A page that does not come up here cannot be
     * watched leaving and coming back. */
    let pg: Page | null = null;
    for (let i = 0; i < 3 && !(pg && isDelegatedModules(pg)); i++) {
        await dev.tap.jog();
        await t.bus.frames(ACT);
        pg = await waitPage(isDelegatedModules, `${MODULE}'s page under page mode`, 1200);
    }
    t.note('pageAtL1', dump(pg));
    t.check('knobs-page-is-the-modules',
        'the knob view comes up on the loaded module, with cells to draw, delegated',
        !!pg && isDelegatedModules(pg),
        { expected: `a rendered page naming ${MODULE} with knobs on it, under renderer=${PAGE_MODE}`,
          actual: describe(pg) });

    /* ── L2: None hands the frame back ────────────────────────────────────────
     * The user's own write, not a gesture: `synth:module` = "" is schwung's
     * teardown value (chain_slots.rs logs it as `(cleared)`), and it is what the
     * chain UI sends when a slot is set to None. The module instance is KEPT —
     * the engine does not unload it — so what the contract reads afterwards is
     * the engine's real answer to "is there anything here", which is the fact
     * the logic suite can only model.
     *
     * WHAT THE USER SEES is the page ceasing to be the module's. Measured, it is
     * not a page count of zero: movy draws its own page for an empty slot, so
     * the count settles at one with no cells on it. The transition is not
     * instant either — the name clears one frame and the cells behind it a beat
     * later, so waiting on the name alone reads a stale screen as the answer. */
    await ep('ch0:synth:module', '');
    const emptied = await waitPage((p) => p.module !== MODULE && !hasCells(p) && delegated(p),
                                   'the page to let the module go', 4000);
    t.note('pageAfterClear', dump(emptied));
    t.note('emptiedPageIsMovysOwn', !!emptied && emptied.module === EMPTY_NAME);
    t.check('none-releases-the-frame',
        'the slot set to None hands the frame back, with no navigation, delegated',
        !!emptied && emptied.module !== MODULE && !hasCells(emptied) && delegated(emptied),
        { expected: `movy´s own page for the empty slot ("${EMPTY_NAME}", no cells), `
                  + `under renderer=${PAGE_MODE}`,
          actual: describe(emptied) });

    /* ── L3: a module that arrives after the old budget is spent ─────────────
     * THE SLOT IS EMPTY FOR THE WHOLE SESSION, and that is the point of the
     * reopen. The old rule re-arms the budget the moment a page goes empty, so
     * a slot cleared in place is a different situation from a slot that never
     * held anything — which is the cold start this item is about, and the one
     * case the retry latch is reachable from.
     *
     * Waited out in DEVICE FRAMES. `probe.tick().tickSeq` is structurally 0 by
     * construction — it has no writer at all any more, its only one (`noteTick`)
     * having been deleted — so the budget cannot be counted on this field and is
     * instead spent by waiting a quantity of device work sized for the slowest
     * tick rate (`PAST_OLD_BUDGET`). Frames cannot be talked out of advancing,
     * and the count is arithmetic rather than a guess. */
    await dev.reopen(probe);
    /* THE OVERRIDE DID NOT SURVIVE THAT REOPEN (see the top of L1), and the
     * reopen is the whole point of this check: it is the cold start an empty
     * slot arrives from. Re-armed here or the rest of L3 grades movy's own
     * renderer and asserts nothing about the contract this item is about. */
    t.note('gridModeAfterReopen', await probe.setGridMode(PAGE_MODE));
    await dev.selectTrack(0);
    t.note('pageAtColdStart', dump(await pageNow()));
    await t.bus.frames(PAST_OLD_BUDGET);
    /* A contract that is not being asked anything cannot latch, so the run has
     * to show it was live while the slot sat empty. */
    t.note('bodyWhileEmpty', await bodySince());

    await ep('ch0:synth:module', MODULE);
    const back = await waitPage(isDelegatedModules, `${MODULE}'s page to come back`, 6000);
    t.note('pageAfterReload', dump(back));
    t.note('bodyAfterReload', await lastBody());
    t.note('bodyLinesThisRun', (await bodySince()).length);
    t.check('late-load-is-claimed',
        `a module dropped in after the old ${OLD_BUDGET_TICKS}-tick budget is spent `
        + 'is drawn by Schwung, with no navigation',
        !!back && isDelegatedModules(back),
        { expected: `a rendered ${MODULE} page under renderer=${PAGE_MODE} after movy sat `
                  + `on the empty slot for ${OLD_BUDGET_TICKS} ticks (${PAST_OLD_BUDGET} frames)`,
          actual: describe(back) });

    t.note('bodyThisRun', await bodySince());
    await probe.setGridMode(null);
    await ep('ch0:synth:module', MODULE);
});
