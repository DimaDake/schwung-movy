#!/usr/bin/env node
/* schwung-knob-feel-check.mjs — a knob must travel as far as movy's does.
 *
 * Reported from the device as "knobs move very very slowly like shift is held".
 * It was not shift — `fine` is never set on this path — it was MAGNITUDE.
 * Move's encoders accumulate, so a quick flick arrives as one CC carrying 3, 6
 * or more. movy scales by that; `onKnobTurn` takes a DIRECTION and moves one
 * detent, so collapsing to +-1 discarded the rest and every gesture moved at
 * the speed of the slowest possible turn. Measured before the fix: movy
 * travelled 0.30 where Schwung travelled 0.005 for the same input.
 *
 * TWO THINGS THIS CHECK HAD TO GET RIGHT, both learned by getting them wrong:
 *
 *   - THE CLOCK MUST ADVANCE. Schwung throttles writes by TIME. A loop that
 *     runs in zero wall-clock lets one write through and holds the rest, which
 *     reads as "the value is stuck" and sent me hunting a write bug that did
 *     not exist. Date.now is stubbed and stepped a frame at a time.
 *   - THE COMPARISON IS AGAINST MOVY, not against a constant. The point is
 *     parity of feel, and a hardcoded expected step would pass while both
 *     engines drifted.
 *
 *   SCHWUNG=/path/to/schwung node scripts/schwung-knob-feel-check.mjs
 */
import { installEnv } from '../browser-test/env.mjs';

globalThis.fill_rect = () => {};
globalThis.clear_screen = () => {};
const env = installEnv();

const { portFor } = await import('../dist/esm/track/registry.js');
const { createSchwungPage } = await import('../dist/esm/renderer/schwung-page.js');
const { createModel } = await import('../dist/esm/model/index.js');
const { MOCK_SYNTHS } = await import('../browser-test/mock-synth.mjs');

const _log = console.log.bind(console);
console.log = (...a) => { if (typeof a[0] === 'string' && a[0].startsWith('[movy]')) return; _log(...a); };
const fail = (m) => { _log('FAIL: ' + m); process.exit(1); };

const REAL_NOW = Date.now;
let clock = REAL_NOW();
Date.now = () => clock;
const step = (fn, n) => { for (let i = 0; i < n; i++) { clock += 16; fn(); } };

const TURNS = 10;
let compared = 0;

let bigCompared = 0;
for (const preset of ['test8', 'test16', 'plaits']) {
    if (!MOCK_SYNTHS[preset]) continue;
    for (const delta of [1, 3, 6, 24, 40, 63]) {
      /* Several slots, because the interesting deltas need HEADROOM. Knob 0 on
       * test16 steps 0.05, so 24 detents run past the top of the range and both
       * engines read `max` — a comparison where the two agree because the clamp
       * agrees, which is precisely the "compare on a case where both answers
       * agree" trap this project's own notes warn about. A saturated case is
       * skipped below rather than counted. */
      for (const slot of [0, 1, 2]) {
        env.setParams(MOCK_SYNTHS[preset]);
        const port = portFor(0);

        const m = createModel(port, 'synth');
        m.reset(); m.reload();
        step(() => m.tick(), 60);
        const info = m.getKnobParamInfo(slot);
        if (!info || !info.automatable) continue;      /* not a turnable cell */
        /* Ten repeats give delta=1 something measurable; at delta 24 they mean
         * 240 detents, which runs off the end of every mock range and makes the
         * CLAMP the thing being compared. One gesture is plenty that big. */
        const turns = delta >= 24 ? 1 : TURNS;
        const mBefore = parseFloat(port.getParam('synth:' + info.ioKey));
        step(() => { m.handleKnobDelta(slot, delta); m.tick(); }, turns);
        step(() => m.tick(), 40);
        const mAfter = parseFloat(port.getParam('synth:' + info.ioKey));
        const movyTravel = mAfter - mBefore;
        /* Saturated: the clamp, not the engine, decided where it stopped. */
        if (Math.abs(mAfter - info.max) < 1e-9) continue;

        env.setParams(MOCK_SYNTHS[preset]);
        const sp = createSchwungPage(port, 'synth');
        for (let i = 0; i < 60 && !sp.ready; i++) { clock += 16; sp.tick(); }
        if (!sp.ready) continue;
        const k = sp.keyAt(slot);
        if (!k) continue;
        const sBefore = parseFloat(port.getParam('synth:' + k));
        step(() => { sp.knobTurn(slot, delta); sp.tick(); }, turns);
        step(() => sp.tick(), 40);
        const schwungTravel = parseFloat(port.getParam('synth:' + k)) - sBefore;

        /* Only comparable when both engines have the same param under knob 0 —
         * otherwise the ranges differ and the numbers mean nothing. */
        if (info.ioKey !== k) continue;
        compared++;
        if (delta >= 24) bigCompared++;

        if (!movyTravel) fail(`${preset} delta=${delta}: movy itself moved nothing`);
        const ratio = schwungTravel / movyTravel;
        if (ratio < 0.9 || ratio > 1.1) {
            fail(`${preset} delta=${delta}: movy travelled ${movyTravel.toFixed(4)}, `
               + `schwung ${schwungTravel.toFixed(4)} (${ratio.toFixed(2)}x). A knob `
               + `must not change speed just because Schwung is drawing it.`);
        }
        _log(`  ${preset} k${slot} delta=${delta}: movy ${movyTravel.toFixed(4)}, `
           + `schwung ${schwungTravel.toFixed(4)}`);
      }
    }
}

Date.now = REAL_NOW;

/* A delta of 1 alone would pass even with the magnitude discarded — that is
 * exactly the case that hid this. Require the accelerating ones.
 *
 * THE BIG ONES ARE NOT DECORATION. The first version of this check stopped at
 * 6 and passed while `knobTurn` still clamped the detent count to 32, so a
 * genuine flick — the shadow UI accumulates and re-encodes up to 63 — lost
 * half its travel and nothing failed. Move's encoder produces those values in
 * ordinary use, so the check has to. */
if (compared < 3) {
    fail(`only ${compared} comparable cases — this check needs deltas above 1 to see `
       + `the magnitude bug at all`);
}
if (bigCompared < 1) {
    fail('no UNSATURATED case above delta 24 was compared, so the detent clamp in knobTurn '
       + 'is invisible to this check. A flick arrives as one CC carrying up to 63.');
}

_log('');
_log(`PASS: ${compared} gestures — a knob travels the same distance whoever draws it.`);
