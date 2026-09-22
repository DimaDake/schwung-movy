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

/* Enough of a change in the lit fraction that no amount of arc/label redraw
 * accounts for it. The panel replaces the whole band, so a real peek moves this
 * far and then some; a grid that merely re-rendered a cell does not. */
const FILL_DELTA = 0.05;

type HeldPage = { module?: string; renderer?: string };

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

    /* A STEP PAGE NEEDS A TRIG. The step page is the held step's properties, so
     * a held EMPTY step has nothing to show — the fixture's track-0 clip does
     * not guarantee one at this index (`seq.ts` taps the same step to create
     * one), so it is put there and toggled back off on the way out. */
    const stepNote = STEP_NOTE_BASE + HELD_STEP;
    await dev.tap.note(stepNote, 127);
    t.need.register(async () => { await dev.tap.note(stepNote, 127); });
    await t.bus.frames(4);

    /* Gathered onto an object rather than into `let`s: the assignments happen
     * inside the hold's callback, and TypeScript narrows a closure-assigned
     * `let` to its initial type at every read after it. */
    const got: { held: HeldPage | null; gridFill: number; peekFill: number; elapsed: number } =
        { held: null, gridFill: -1, peekFill: -1, elapsed: -1 };

    await dev.hold(stepNote, async () => {
        await t.bus.frames(6);
        got.held = (await probe.page()) as unknown as HeldPage | null;
        got.gridFill = await disp.bandFill(PEEK_Y, PEEK_H);

        const t0 = Date.now();
        /* THE WHOLE GESTURE, and the grab inside it. `knobHold` is touch-on ...
         * touch-off; the release is what takes the peek down, so the screen is
         * read while the knob is still under the finger. */
        await dev.knobHold(PROB_KNOB, async () => {
            await dev.tap.knob(PROB_KNOB, 8);
            got.peekFill = await disp.bandFill(PEEK_Y, PEEK_H);
        });
        got.elapsed = Date.now() - t0;
    });

    t.note('heldPageModule', got.held?.module ?? '(none)');
    t.note('heldPageRenderer', got.held?.renderer ?? '(none)');
    t.note('gridFill', got.gridFill);
    t.note('peekFill', got.peekFill);
    t.note('peekSampleMs', got.elapsed);

    t.check('step-page-delegated', 'a held step draws through Schwung, not movy',
        got.held?.renderer === PAGE_MODE,
        { expected: `renderer=${PAGE_MODE} while a step is held`,
          actual: `renderer=${got.held?.renderer ?? '(none)'} module=${got.held?.module ?? '(none)'}` });

    /* Judged only if the sample landed while the panel should still have been
     * up. Outside the window it proves nothing either way, and a check that
     * grades a late scp is a check that fails for the network. */
    if (got.elapsed >= 0 && got.elapsed < PEEK_WINDOW_MS) {
        const moved = Math.abs(got.peekFill - got.gridFill) > FILL_DELTA;
        t.check('enum-peek-raised', 'turning an enum raises the option list',
            moved,
            { expected: `the list band to differ from the grid's ${got.gridFill.toFixed(3)} `
                        + `by more than ${FILL_DELTA}`,
              actual: `${got.peekFill.toFixed(3)} at ${got.elapsed}ms — `
                      + (moved ? 'the panel is up' : 'the band is unchanged, so no list was drawn') });
    } else {
        t.note('peekSkipped', `sample landed at ${got.elapsed}ms, outside the ${PEEK_WINDOW_MS}ms window`);
    }

    await probe.setGridMode(null);
});
