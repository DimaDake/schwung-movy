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

for (const preset of ['test8', 'test16', 'plaits']) {
    if (!MOCK_SYNTHS[preset]) continue;
    for (const delta of [1, 3, 6]) {
        env.setParams(MOCK_SYNTHS[preset]);
        const port = portFor(0);

        const m = createModel(port, 'synth');
        m.reset(); m.reload();
        step(() => m.tick(), 60);
        const info = m.getKnobParamInfo(0);
        if (!info || !info.automatable) continue;      /* not a turnable cell */
        const mBefore = parseFloat(port.getParam('synth:' + info.ioKey));
        step(() => { m.handleKnobDelta(0, delta); m.tick(); }, TURNS);
        step(() => m.tick(), 40);
        const movyTravel = parseFloat(port.getParam('synth:' + info.ioKey)) - mBefore;

        env.setParams(MOCK_SYNTHS[preset]);
        const sp = createSchwungPage(port, 'synth');
        for (let i = 0; i < 60 && !sp.ready; i++) { clock += 16; sp.tick(); }
        if (!sp.ready) continue;
        const k = sp.keyAt(0);
        if (!k) continue;
        const sBefore = parseFloat(port.getParam('synth:' + k));
        step(() => { sp.knobTurn(0, delta); sp.tick(); }, TURNS);
        step(() => sp.tick(), 40);
        const schwungTravel = parseFloat(port.getParam('synth:' + k)) - sBefore;

        /* Only comparable when both engines have the same param under knob 0 —
         * otherwise the ranges differ and the numbers mean nothing. */
        if (info.ioKey !== k) continue;
        compared++;

        if (!movyTravel) fail(`${preset} delta=${delta}: movy itself moved nothing`);
        const ratio = schwungTravel / movyTravel;
        if (ratio < 0.9 || ratio > 1.1) {
            fail(`${preset} delta=${delta}: movy travelled ${movyTravel.toFixed(4)}, `
               + `schwung ${schwungTravel.toFixed(4)} (${ratio.toFixed(2)}x). A knob `
               + `must not change speed just because Schwung is drawing it.`);
        }
        _log(`  ${preset} delta=${delta}: movy ${movyTravel.toFixed(4)}, `
           + `schwung ${schwungTravel.toFixed(4)}`);
    }
}

Date.now = REAL_NOW;

/* A delta of 1 alone would pass even with the magnitude discarded — that is
 * exactly the case that hid this. Require the accelerating ones. */
if (compared < 3) {
    fail(`only ${compared} comparable cases — this check needs deltas above 1 to see `
       + `the magnitude bug at all`);
}

_log('');
_log(`PASS: ${compared} gestures — a knob travels the same distance whoever draws it.`);
