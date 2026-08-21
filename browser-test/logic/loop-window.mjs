/* browser-test/logic/loop-window.mjs — the loop window: coordinates, the step row inside it, gestures, adoption
 *
 * Run by browser-test/logic.mjs. The suite body is deliberately left at its
 * original indentation inside run() so blame survives the split.
 */

import {
    installMockEngine, uninstallMockEngine, eq, _log,
} from './harness.mjs';

export async function run() {
/* ── seq loop window coordinates ─────────────────────────────────────────── */
{
    _log('\nseq loop window coords:');
    const { seqState, resetSeqState, stepInLoop, minBarOffset, maxBarOffset, loopBarCount } =
        await import('../../dist/esm/seq/state.js');

    // Loop = bars 3-4 (0-based 2-3): absolute steps 32..63.
    resetSeqState(); seqState.loopStart = 32; seqState.lenSteps = 32;
    eq('loop start bar navigable', minBarOffset(), 2);
    eq('one bar past the loop navigable', maxBarOffset(), 4);
    eq('loop spans 2 bars', loopBarCount(), 2);
    eq('step before the loop is out', stepInLoop(31), false);
    eq('first loop step is in', stepInLoop(32), true);
    eq('last loop step is in', stepInLoop(63), true);
    eq('step past the loop is out', stepInLoop(64), false);

    // loopStart 0 → unchanged from the old formulas (regression guard).
    resetSeqState(); seqState.lenSteps = 32;
    eq('bar 0 loop starts at 0', minBarOffset(), 0);
    eq('bar 0 loop max offset unchanged', maxBarOffset(), 2);

    // Empty slot: nowhere to navigate.
    resetSeqState();
    eq('empty clip max offset is 0', maxBarOffset(), 0);
    eq('empty clip min offset is 0', minBarOffset(), 0);

    // 16-bar cap holds even at the last bar.
    resetSeqState(); seqState.loopStart = 240; seqState.lenSteps = 16;
    eq('last bar caps at 15', maxBarOffset(), 15);
    resetSeqState();
}

/* ── seq step row inside a mid-clip loop ─────────────────────────────────── */
{
    _log('\nseq step row in a mid-clip loop:');
    const sent = new Map();
    const savedLed = globalThis.setLED, savedBtn = globalThis.setButtonLED;
    globalThis.setLED = (n, c) => sent.set(n, c);
    globalThis.setButtonLED = () => {};

    const leds = await import('../../dist/esm/seq/leds.js');
    const { seqState, resetSeqState, occToggleStep } = await import('../../dist/esm/seq/state.js');
    const { trackColorDim } = await import('../../dist/esm/seq/colors.js');

    // Loop = bars 3-4 (steps 32..63), viewing bar 3, notes on steps 32 and 36.
    resetSeqState();
    seqState.loopStart = 32; seqState.lenSteps = 32; seqState.barOffset = 2;
    occToggleStep(32); occToggleStep(36);
    leds.seqLedsInvalidate();
    // Two ticks: the first frame's 40-send budget also pays for buttons/icons.
    leds.seqLedsTick(false, 0, 2, 4);
    leds.seqLedsTick(false, 0, 2, 4);
    eq('occupied step 32 is white', sent.get(16), 120);
    eq('occupied step 36 is white', sent.get(20), 120);
    eq('empty in-loop step is track-dim', sent.get(17), trackColorDim(0));
    eq('mid-loop row is not blacked out',
        [...Array(16).keys()].every((i) => sent.get(16 + i) === 0), false);

    // The bar past the loop end stays dark (unchanged affordance).
    sent.clear(); seqState.barOffset = 4;
    leds.seqLedsInvalidate();
    leds.seqLedsTick(false, 0, 4, 4);
    leds.seqLedsTick(false, 0, 4, 4);
    eq('bar past the loop is dark', sent.get(16), 0);

    globalThis.setLED = savedLed; globalThis.setButtonLED = savedBtn;
    resetSeqState(); leds.seqLedsInvalidate();
}

/* ── loop mode header readout ────────────────────────────────────────────── */
{
    _log('\nloop header readout:');
    const { loopHeaderText } = await import('../../dist/esm/seq/render.js');
    const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');

    // Loop = bars 3-4, viewing bar 3. Bars read 1-based, as printed on the unit.
    resetSeqState(); seqState.loopStart = 32; seqState.lenSteps = 32; seqState.barOffset = 2;
    eq('multi-bar window', loopHeaderText(), 'LOOP 3-4  BAR 3');
    // A single-bar loop reads as one number, not "3-3".
    resetSeqState(); seqState.loopStart = 32; seqState.lenSteps = 16; seqState.barOffset = 2;
    eq('single-bar window', loopHeaderText(), 'LOOP 3  BAR 3');
    // Navigated outside the loop: BAR still reports where you actually are.
    resetSeqState(); seqState.loopStart = 32; seqState.lenSteps = 16; seqState.barOffset = 3;
    eq('outside the window', loopHeaderText(), 'LOOP 3  BAR 4');
    resetSeqState();
}

/* ── loop mode gestures ──────────────────────────────────────────────────── */
{
    _log('\nloop mode gestures:');
    const { installMockEngine, uninstallMockEngine } = await import('../mock-engine.mjs');
    const { loopStepOnAt, loopStepOff, loopButton, loopWheel, resetLoopMode } =
        await import('../../dist/esm/seq/loop-mode.js');
    const { navigateBar } = await import('../../dist/esm/seq/router-steps.js');
    const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');
    installMockEngine();

    // Double-tap is wall-clock, so the window does not shrink 3x when the device
    // tick rate rises under load (63-205 Hz observed across schwung builds).
    resetSeqState(); resetLoopMode();
    seqState.lenSteps = 64;                 // 4-bar clip from bar 1
    loopStepOnAt(2, 1000); loopStepOff(2);
    loopStepOnAt(2, 1449); loopStepOff(2);  // inside 450 ms → 1-bar loop at bar 3
    eq('double-tap sets a 1-bar loop', seqState.lenSteps, 16);
    eq('double-tap loop starts at bar 3', seqState.loopStart, 32);

    resetSeqState(); resetLoopMode();
    seqState.lenSteps = 64;
    loopStepOnAt(2, 1000); loopStepOff(2);
    loopStepOnAt(2, 1451); loopStepOff(2);  // past 450 ms → just a selection
    eq('slow re-tap does not resize', seqState.lenSteps, 64);

    // Two bars pressed → window, and the view follows into it.
    resetSeqState(); resetLoopMode();
    seqState.lenSteps = 64; seqState.barOffset = 0;
    loopStepOnAt(2, 2000);
    loopStepOnAt(4, 2050);
    eq('two-bar press sets the window', seqState.loopStart, 32);
    eq('two-bar press sets the length', seqState.lenSteps, 48);
    eq('view follows into the window', seqState.barOffset, 2);

    /* Shrinking with Loop+wheel is the other way the view got stranded: nothing
     * moves barOffset, so a view above the new end kept editing a bar that had
     * just left the loop. It clamps down to the window's last bar. */
    resetSeqState(); resetLoopMode();
    seqState.lenSteps = 64; seqState.barOffset = 3;   // 4-bar loop, viewing bar 4
    loopButton(true);
    loopWheel(-1);                                   // shrink to 3 bars
    eq('wheel shrink resizes the loop', seqState.lenSteps, 48);
    eq('view clamps down to the window end', seqState.barOffset, 2);
    loopButton(false);

    // Arrows cannot wander below a mid-clip loop's first bar, and DO reach its last.
    resetSeqState(); resetLoopMode();
    seqState.loopStart = 32; seqState.lenSteps = 32; seqState.barOffset = 2;
    navigateBar(-1);
    eq('left arrow stops at the loop start', seqState.barOffset, 2);
    navigateBar(1);
    eq('right arrow reaches the loop end', seqState.barOffset, 3);
    navigateBar(1);
    eq('right arrow reaches one bar past the loop', seqState.barOffset, 4);
    navigateBar(1);
    eq('right arrow stops there', seqState.barOffset, 4);

    uninstallMockEngine();
    resetSeqState(); resetLoopMode();
}

/* ── first status adopts the clip's loop window ───────────────────────────── */
{
    _log('\nfirst status adopts the loop window:');
    const { parseStatusForTest } = await import('../../dist/esm/seq/engine.js');
    const { seqState, resetSeqState, minBarOffset, maxBarOffset } =
        await import('../../dist/esm/seq/state.js');
    const { drawLoopStrip } = await import('../../dist/esm/seq/render.js');

    const rects = [];
    const origFill = globalThis.fill_rect;
    globalThis.fill_rect = (x, y, w, h, v) => rects.push({ x, y, w, h, v });

    /* Cold start: barOffset defaults to 0 while the engine has not been heard
     * from yet. The first poll reports a clip whose loop starts at bar 3 — the
     * view has to adopt it, or the strip leads with inactive bars nobody
     * navigated to. */
    resetSeqState();
    parseStatusForTest('play=0 trk=0 step=0 pos=768 len=32 lstart=32');
    eq('window was learned', seqState.loopStart, 32);
    eq('view adopted the loop start', seqState.barOffset, 2);
    eq('view is inside the navigable range',
        seqState.barOffset >= minBarOffset() && seqState.barOffset <= maxBarOffset(), true);

    rects.length = 0;
    drawLoopStrip();
    const lit = rects.slice(1).filter((r) => r.v === 1);
    eq('strip draws only the active bars', lit.length, 2);
    eq('no plus marker on a fresh start', lit.every((r) => r.h !== 3), true);

    /* A deliberate out-of-window selection (pressing an inactive bar in Loop
     * mode) must survive polls that report the SAME window — the "+" navigable
     * bar is a designed state, not drift. */
    seqState.barOffset = 6;
    parseStatusForTest('play=0 trk=0 step=0 pos=768 len=32 lstart=32');
    eq('an unchanged window leaves the selection alone', seqState.barOffset, 6);

    /* …but a window that moves out from under the view pulls it back in. Bar 6 is
     * still legal while the loop ends at bar 6 (it is the navigable bar past the
     * end), so move the loop somewhere that genuinely strands it: bars 2-3, whose
     * navigable range tops out at bar 4. */
    parseStatusForTest('play=0 trk=0 step=0 pos=768 len=32 lstart=16');
    eq('a moved window pulls the view in', seqState.barOffset, 3);

    /* Switching tracks resets the view to bar 0 as a placeholder, so it must adopt
     * the new track's window too — including when that window happens to be
     * identical to the outgoing one, where change detection alone sees nothing. */
    const { seqHandleMidi } = await import('../../dist/esm/seq/router.js');
    const { installMockEngine, uninstallMockEngine } = await import('../mock-engine.mjs');
    installMockEngine();
    resetSeqState();
    parseStatusForTest('play=0 trk=0 step=0 pos=768 len=32 lstart=32');
    eq('track 0 view adopted its window', seqState.barOffset, 2);
    seqHandleMidi([0xB0, 42, 127], false);        // CC 42 = track 1
    eq('track switched', seqState.watchTrack, 1);
    parseStatusForTest('play=0 trk=1 step=0 pos=768 len=32 lstart=32');
    eq('the new track re-adopts an identical window', seqState.barOffset, 2);
    uninstallMockEngine();

    globalThis.fill_rect = origFill;
    resetSeqState();
}

}
