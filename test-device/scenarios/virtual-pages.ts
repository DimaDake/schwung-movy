/* New with SP-57 — what movy's OWN pages draw, on hardware.
 *
 * Set Params, Clip Params and the step page have no module behind them: movy
 * writes their contract itself (`createVirtualSource`, the SP-53/SP-54 seam)
 * and Schwung plans and draws from it. Everything about that seam is covered
 * locally — `browser-test/logic/*-params-source.mjs` drives the real
 * controller through the real contract — with ONE exception, and it is the one
 * this file exists for.
 *
 * WHAT ONLY THE DEVICE CAN SAY: whether the enum option list actually appears.
 *
 * Turning a divable enum raises a panel over the grid (`enum_list.mjs`'s PEEK
 * — "the detent ALREADY WROTE. The list is an ANSWER"). It was reported
 * missing on these pages, and reading the source gave TWO candidate causes that
 * no local suite can separate, because both are about real gesture timing:
 *
 *   1. movy's repaint gate never asked for the frame. `pollDrawnPage` compares
 *      page identity, knob levels and animation; the peek is none of those.
 *      FIXED locally in SP-57 H5 and pinned by `page-freshness.mjs`.
 *   2. `onKnobTouch` nulls `s.peek` (`page_controller.mjs:3623`) on press AND
 *      release — and movy must keep forwarding touch, since the header claim,
 *      the card warm and the picker dismissal all hang off it.
 *
 * If this check passes, (1) was the whole of it and there is nothing to ask
 * upstream. If it fails with the arm green and the gesture delivered, (2) is
 * real and SU-19 opens with this scenario as its evidence.
 *
 * THE GRAB HAPPENS INSIDE THE HOLD, and that is the crux rather than a detail.
 * The peek dies on the knob's RELEASE, so a screenshot taken after the gesture
 * would find the grid whether the feature works or not — the test would be
 * measuring its own teardown. It is also how a person uses it: you read the
 * list while your fingers are still on the knob.
 *
 * ONE INJECT PER EDGE, for the same reason `Device.hold` exists: a press and a
 * turn sent as two ssh round trips are ~0.5 s apart, which movy reads as a
 * different gesture entirely.
 *
 * A FILL FRACTION, NOT A PIXEL MATCH (`jog-hint.ts`'s own reasoning): the panel
 * clears the screen and draws five rows of list against a grid of cells and
 * labels, so the lit fraction of that band moves a long way without this test
 * re-encoding the font.
 *
 * Covers:
 *   V1  the step page comes up under delegation while a step is held
 *   V2  turning an enum on it raises the option list
 */
import { scenario } from '../runner.js';
import { Device } from '../device.js';
import { Probe } from '../probe.js';
import { Display } from '../display.js';
import * as fixture from '../fixture.js';
import { STEP_NOTE_BASE } from '../midi.js';
import { until } from '../wait.js';

/* The arm every check here has to run in: Schwung plans AND draws, which is
 * the only arm in which the virtual contract is on screen at all. Under `off`
 * movy's own renderer draws the step page and there is no peek to look for. */
const PAGE_MODE = 'page';

/* The list's own rect, from `enum_list.mjs`: ENUM_LIST_TOP_Y is 9 and the
 * bottom is RULE_Y - 1 = 54 (`shared/list_geometry.mjs`), so 46 rows. Read as
 * a band because that is where the two pictures differ most. */
const PEEK_Y = 9, PEEK_H = 46;

/* `ENUM_PEEK_MS`. A grab is an scp whose latency is not ours to control, so a
 * sample that lands outside the window saw the grid LEGITIMATELY and is not
 * judged — the same rule `jog-hint.ts` had to adopt after failing on one host
 * and passing on another minutes apart. */
const PEEK_WINDOW_MS = 1500;

/* Knob 3 on the step page is PROB, a ten-option enum (`step-params-contract.ts`
 * declares vel, len, prob, cond, invert in that order). Zero-based here. */
const PROB_KNOB = 2;
const HELD_STEP = 0;

/* THE STEP PAGE IS ENTERED, NOT AUTOMATIC — and assuming otherwise is what made
 * the first run of this scenario grade the wrong page.
 *
 * Holding a step makes the step page AVAILABLE; what SELECTS it is Left while
 * the module is on its page 0 (`src/midi/router.ts`'s MoveLeft branch:
 * `stepPageAvailable() && !stepPageState.selected && o.pageIndex === 0`). Until
 * then the module's own page is still drawn — the first run held a step,
 * reported `module=plaits`, turned what it thought was PROB and concluded the
 * overlay was missing. It was grading a plaits knob.
 *
 * Left is CC 62 (`shared/constants.mjs`'s MoveLeft). Pressed until the probe
 * says `step`, because the module may not be on page 0 to begin with and each
 * press walks one page down before the step page is reachable. */
/* A JOG COUNTER-CLOCKWISE, not the Left button.
 *
 * Both gestures reach the same rule — `stepPageAvailable() && !selected &&
 * pageOwnerOf(m).pageIndex === 0` selects the step page (`src/midi/router.ts`,
 * the jog branch and the MoveLeft branch state it separately) — but the jog is
 * a first-class harness gesture (`dev.tap.jogTurn`), while Left had to be
 * hand-rolled as a raw CC from a constant read out of schwung's source. Six
 * such presses moved nothing at all, not even the page index, which is equally
 * consistent with "the CC never arrived" — so the gesture the harness already
 * knows how to deliver is the one to use. */
const STEP_PAGE_MODULE = 'step';
const MAX_LEFT_PRESSES = 6;

/* A HELD STEP IS PROMOTED ON A CLOCK, not on the press. `stepAutoTick` enters
 * step-automation mode once a single step has been held for STEP_AUTO_MS
 * (300 ms, `seq/step-edit.ts`), and until it does `stepPageAvailable()` is
 * false and Left only pages the module. The first run of this scenario waited
 * six frames — 30..95 ms at the device's 63..205 Hz — and concluded the step
 * page was unreachable.
 *
 * So it waits on the PROMOTION rather than on a frame count: `automationHeld`
 * is what the module page reports while a step session is live (the probe's
 * `held`), which is the state the step page becomes reachable from. */
const PROMOTE_FRAMES = 120;

/* Enough of a change in the lit fraction that no amount of arc/label redraw
 * accounts for it. The panel replaces the whole band, so a real peek moves this
 * far and then some; a grid that merely re-rendered a cell does not. */
const FILL_DELTA = 0.05;

type HeldPage = { module?: string; renderer?: string; held?: boolean; view?: string; pageIndex?: number };

scenario('virtual-pages', async (t) => {
    fixture.setHost(t.host);
    const dev   = new Device(t.bus, t.agent, t.host);
    const probe = new Probe(t.bus);
    const disp  = new Display(t.host);
    const open  = () => dev.open(probe);
    const close = () => dev.close(probe);

    await fixture.ensure(t.bus, open, close);
    await dev.deployUi();
    await dev.open(probe);
    await dev.selectTrack(0);

    /* By OVERRIDE, so the device's own prefs are never touched and there is
     * nothing to restore (`probe.setGridMode`, and see `arm.ts`). */
    const armed = await probe.setGridMode(PAGE_MODE) as { renderer?: string } | null;
    t.note('gridMode', armed?.renderer ?? '(none)');
    t.check('arm-page', 'the renderer reports the page arm',
        armed?.renderer === PAGE_MODE,
        { expected: `renderer=${PAGE_MODE}`, actual: `renderer=${armed?.renderer ?? '(none)'}` });

    /* A STEP PAGE NEEDS A TRIG — `stepPageAvailable()` is
     * `stepAutoMode && occHasStep(holdStep)` — and THE FIXTURE ALREADY SEEDS
     * ONE HERE.
     *
     * This scenario first tapped the step to create one, which did the
     * opposite: a tap TOGGLES, so it deleted the fixture's note and every run
     * held an empty step. The symptom was indirect and cost three device runs
     * — the step page simply never arrived, while `promoted: true` in the notes
     * showed step-automation mode was live, which is what finally separated
     * "not promoted" from "promoted with nothing to show".
     *
     * So nothing is tapped up front. If the step turns out to be empty anyway,
     * the fallback below adds a note and tries once more — safe now, because a
     * PROMOTED hold does not toggle on release (`markGestured`), so the state
     * cannot oscillate the way it did when the hold was still a tap. */
    /* WHICH STEP TO HOLD IS THE ENGINE'S ANSWER, not this file's.
     *
     * `stepPageAvailable()` is `stepAutoMode && occHasStep(holdStep)`, so the
     * held step must carry a note — and an earlier version of this scenario
     * TAPPED one in, which toggles: it deleted the fixture's note instead and
     * every run held an empty step. Both occupancy states were then tried
     * blind, which is two device runs spent on a question the engine answers
     * directly: `status` carries `occ=<hex>`, the watched track's own
     * occupancy bitmap (`occFromHex`, `seq/state.ts` — bit 0x80 >> (step & 7)
     * of byte step >> 3).
     *
     * So the step is CHOSEN from it. Nothing is tapped, nothing is restored,
     * and the scenario stops depending on what the fixture happens to seed. */
    const status = await t.bus.getParam('overtake_dsp:status');
    const occHex = /(?:^|\s)occ=([0-9a-fA-F]+)/.exec(status)?.[1] ?? '';
    const occupied: number[] = [];
    for (let i = 0; i * 2 + 1 < occHex.length; i++) {
        const byte = parseInt(occHex.slice(i * 2, i * 2 + 2), 16);
        for (let b = 0; b < 8; b++) if (byte & (0x80 >> b)) occupied.push(i * 8 + b);
    }
    /* The step ROW addresses 16 buttons from the current bar, so a step beyond
     * that is not one this gesture can hold. */
    const holdStep = occupied.find((n) => n < 16) ?? -1;
    t.note('occHex', occHex || '(none)');
    t.note('occupiedSteps', occupied.slice(0, 12).join(',') || '(none)');
    t.note('holdStep', holdStep);
    t.check('a-step-to-hold', 'the watched clip has a note on the first bar',
        holdStep >= 0,
        { expected: 'at least one occupied step in 0..15 (occ= from the engine status)',
          actual: occHex ? `occ=${occHex} → steps [${occupied.slice(0, 12).join(',')}]`
                         : 'the engine status carried no occ= field' });

    const stepNote = STEP_NOTE_BASE + Math.max(0, holdStep);

    /* THE STEP PAGE IS A KNOBS PAGE, so the knobs view is where it can be the
     * drawn one. `dev.open` lands in the CHAIN view, whose ViewModel names the
     * selected slot's module ("plaits") no matter what the knobs are doing —
     * so a run that stayed there could never read `module=step`, whatever the
     * step page was up to. Measured as `viewDuringHold: "chain"` in the notes,
     * after the occupancy theory had already been ruled out.
     *
     * A jog CLICK drills from the chain into that slot's knobs (`router.ts`);
     * it is waited on rather than assumed, since a click on an EMPTY slot opens
     * the module browser instead and the run would carry on in the wrong
     * screen. */
    const viewNow = async (): Promise<string> =>
        ((await probe.page()) as unknown as HeldPage | null)?.view ?? '(none)';
    if (await viewNow() !== 'knobs') {
        await dev.tap.jog();
        try {
            await until(t.bus, 'the knobs view', viewNow, (v) => v === 'knobs',
                        { within: 60, every: 4 });
        } catch { /* reported by the check below, with the view it stalled in */ }
    }
    const enteredView = await viewNow();
    t.note('viewBeforeHold', enteredView);
    t.check('knobs-view', 'the knobs view is where the step page can be drawn',
        enteredView === 'knobs',
        { expected: 'view=knobs before the step is held',
          actual: `view=${enteredView}` });

    /* Gathered onto an object rather than into `let`s: the assignments happen
     * inside the hold's callback, and TypeScript narrows a closure-assigned
     * `let` to its initial type at every read after it. */
    const got: { held: HeldPage | null; promoted: boolean; beforeLeft: HeldPage | null;
                 gridFill: number; peekFill: number; elapsed: number; trail: string[] } =
        { held: null, promoted: false, beforeLeft: null, gridFill: -1, peekFill: -1,
          elapsed: -1, trail: [] };

    /* ONE WHOLE ATTEMPT: hold, wait for the promotion, walk to the step page,
     * then read the screen either side of a turn — all inside the same hold,
     * because the peek dies on the knob's release. */
    const attempt = async (): Promise<void> => {
        await dev.hold(stepNote, async () => {
            try {
                await until(t.bus, 'step-automation mode',
                    async () => (await probe.page()) as unknown as HeldPage | null,
                    (p) => !!p?.held, { within: PROMOTE_FRAMES, every: 4 });
                got.promoted = true;
            } catch { /* not promoted; the notes below carry the state it stalled in */ }
            got.beforeLeft = (await probe.page()) as unknown as HeldPage | null;

            /* Left selects the step page once it is available, and only from
             * the module's page 0 (`src/midi/router.ts`'s MoveLeft branch), so
             * this walks rather than pressing once. */
            /* A TRAIL, because "nothing happened" has two very different
             * causes: the press not arriving at all, and it arriving and
             * paging the module instead of selecting the step page. The page
             * index after each press tells them apart. */
            for (let i = 0; i < MAX_LEFT_PRESSES; i++) {
                got.held = (await probe.page()) as unknown as HeldPage | null;
                got.trail.push(`${got.held?.module ?? '?'}@${got.held?.pageIndex ?? '?'}`);
                if (got.held?.module === STEP_PAGE_MODULE) break;
                await dev.tap.jogTurn(-1);
                await t.bus.frames(6);
            }
            got.held = (await probe.page()) as unknown as HeldPage | null;
            if (got.held?.module !== STEP_PAGE_MODULE) return;

            got.gridFill = await disp.bandFill(PEEK_Y, PEEK_H);
            const t0 = Date.now();
            /* `knobHold` is touch-on ... touch-off; the grab sits between them
             * because the RELEASE is what takes the peek down. */
            await dev.knobHold(PROB_KNOB, async () => {
                await dev.tap.knob(PROB_KNOB, 8);
                got.peekFill = await disp.bandFill(PEEK_Y, PEEK_H);
            });
            got.elapsed = Date.now() - t0;
        });
    };

    await attempt();

    /* THE THREE FACTS THAT SEPARATE THE CAUSES, noted on every run: whether the
     * hold was promoted at all (stepAutoMode), which screen movy was on (the
     * MoveLeft branch differs by view) and which page it sat on (the step page
     * is only selectable from index 0). */
    t.note('promoted', got.promoted);
    t.note('jogTrail', got.trail.join(' → '));
    t.note('viewDuringHold', got.beforeLeft?.view ?? '(none)');
    t.note('pageIndexDuringHold', got.beforeLeft?.pageIndex ?? -1);
    t.note('moduleBeforeLeft', got.beforeLeft?.module ?? '(none)');
    t.note('heldPageModule', got.held?.module ?? '(none)');
    t.note('heldPageRenderer', got.held?.renderer ?? '(none)');
    t.note('gridFill', got.gridFill);
    t.note('peekFill', got.peekFill);
    t.note('peekSampleMs', got.elapsed);

    /* BOTH halves, and the module name is the half that matters. `renderer=page`
     * alone is true of the MODULE's page too, so asserting only that is what let
     * the first run pass this check while grading plaits. */
    t.check('step-page-delegated', 'the step page is the drawn one, through Schwung',
        got.held?.module === STEP_PAGE_MODULE && got.held?.renderer === PAGE_MODE,
        { expected: `module=${STEP_PAGE_MODULE} renderer=${PAGE_MODE} while a step is held`,
          actual: `renderer=${got.held?.renderer ?? '(none)'} module=${got.held?.module ?? '(none)'}`
                  + (got.held?.module === STEP_PAGE_MODULE ? '' :
                     ' — the step page was never reached, so the peek check below graded nothing') });

    /* Judged only if the sample landed while the panel should still have been
     * up. Outside the window it proves nothing either way, and a check that
     * grades a late scp is a check that fails for the network. */
    if (got.held?.module === STEP_PAGE_MODULE && got.elapsed >= 0 && got.elapsed < PEEK_WINDOW_MS) {
        const moved = Math.abs(got.peekFill - got.gridFill) > FILL_DELTA;
        t.check('enum-peek-raised', 'turning an enum raises the option list',
            moved,
            { expected: `the list band to differ from the grid's ${got.gridFill.toFixed(3)} `
                        + `by more than ${FILL_DELTA}`,
              actual: `${got.peekFill.toFixed(3)} at ${got.elapsed}ms — `
                      + (moved ? 'the panel is up' : 'the band is unchanged, so no list was drawn') });
    } else {
        /* Not graded, and the reason is recorded: a peek check run on the wrong
         * page, or on a sample that landed after the panel was due down, says
         * nothing either way. */
        t.note('peekSkipped', got.held?.module !== STEP_PAGE_MODULE
            ? `not the step page (module=${got.held?.module ?? '(none)'})`
            : `sample landed at ${got.elapsed}ms, outside the ${PEEK_WINDOW_MS}ms window`);
    }

    await probe.setGridMode(null);
});
