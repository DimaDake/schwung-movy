/* browser-test/logic/ext-knobs.mjs — an external knob controller on USB-A
 * (midi/ext-knob-map.ts): which Move control each CC stands for.
 *
 * Run by browser-test/logic.mjs.
 */

import { eq, _log } from './harness.mjs';

export async function run() {
    _log('\nexternal knob controller:');
    const m = await import('../../dist/esm/midi/ext-knob-map.js');
    const { createExtKnobState, extKnobActions, TW_JOG_STEPS } = m;
    const K1 = globalThis.MoveKnob1, JOG = globalThis.MoveMainKnob;
    const show = (as) => as.map((a) => a.kind === 'cc' ? `cc${a.cc}:${a.value}` : `preset:${a.delta}`).join(' ');

    let st = createExtKnobState();
    const act = (ch, cc, v) => show(extKnobActions(st, ch, cc, v));

    /* Schwung's convention, any channel. */
    eq('CC 71 relative up turns knob 1', act(5, 71, 1), `cc${K1}:1`);
    eq('CC 78 relative down turns knob 8', act(1, 78, 127), `cc${K1 + 7}:127`);
    eq('a relative zero moves nothing', act(1, 72, 0), '');
    eq('CC 102 absolute: the first value only sets the origin', act(1, 102, 40), '');
    eq('CC 102 absolute: +3 from there', act(1, 102, 43), `cc${K1}:3`);
    eq('CC 102 absolute: -2 is two\'s complement', act(1, 102, 41), `cc${K1}:126`);

    /* A factory-default Twister: rows 3-4 are knobs 1-8. */
    st = createExtKnobState();
    act(1, 8, 64);
    eq('Twister CC 8 is knob 1', act(1, 8, 65), `cc${K1}:1`);
    act(1, 15, 10);
    eq('Twister CC 15 is knob 8', act(1, 15, 9), `cc${K1 + 7}:127`);

    /* Encoder 2 sends CC 1 — the engine's mod wheel. Never a knob. */
    act(1, 1, 10);
    eq('Twister CC 1 (mod wheel) maps to nothing', act(1, 1, 20), '');

    /* The jog is geared down. */
    act(1, 0, 0);
    eq('the jog holds a sub-step turn', act(1, 0, TW_JOG_STEPS - 1), '');
    eq('the jog steps once a full gear is reached', act(1, 0, TW_JOG_STEPS), `cc${JOG}:1`);
    eq('and back down', act(1, 0, 0), `cc${JOG}:127`);

    /* Pushes on channel 2. */
    eq('encoder 1 push is the jog click', act(2, 0, 127), `cc${globalThis.MoveMainButton}:127`);
    eq('encoder 1 release releases it', act(2, 0, 0), `cc${globalThis.MoveMainButton}:0`);
    eq('encoder 4 push is Back', act(2, 3, 127), `cc${globalThis.MoveBack}:127`);
    eq('an unassigned push does nothing', act(2, 6, 127), '');

    /* Encoder 3 steps presets. */
    act(1, 2, 50);
    eq('encoder 3 steps the preset list', act(1, 2, 49), 'preset:-1');
}
