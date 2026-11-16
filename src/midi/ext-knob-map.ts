/* ext-knob-map.ts — what a CC from an external knob controller on USB-A
 * (cable 2) means to movy. Pure: state in, actions out, nothing sent. The
 * dispatch is midi/ext-knobs.ts.
 *
 * Every action is a MOVE CONTROL the controller stands for, replayed through
 * the internal router, so each page, lock, peek and modal treats it exactly as
 * it treats the hardware — there is no second write path to keep in step.
 *
 * Two conventions are understood:
 *
 *  - Schwung's own (any channel): CC 71-78 relative, in the Move encoders'
 *    two's complement (1..63 up, 65..127 down — a Twister in "ENC 7FH/01H"),
 *    and CC 102-109 absolute. Both are knobs 1-8. One controller setup then
 *    works in movy and in Schwung's slot editor alike.
 *
 *  - A factory-default Midi Fighter Twister, so it works out of the box:
 *    rotation is absolute CC 0-15 on channel 1, a push is CC 0-15 on channel 2
 *    (127 down, 0 up).
 *        encoder 1      turn = jog (geared down), push = jog click
 *        encoder 3      turn = previous / next preset of the knobs' module
 *        encoder 4      push = Back
 *        encoders 9-16  knobs 1-8
 *    Encoder 2 is left alone: it sends CC 1, which the engine plays as the
 *    mod wheel (ext_route.rs) before this side sees it, so mapping it here
 *    would turn a knob AND modulate the synth. The rest are free.
 */

export const EXT_REL_BASE = 71;
export const EXT_ABS_BASE = 102;
export const EXT_KNOBS = 8;

export const TW_KNOB_BASE = 8;     /* Twister CC 8-15 -> knobs 1-8 */
export const TW_JOG = 0;
export const TW_PRESET = 2;
export const TW_BACK = 3;
/* The Twister sends a value per small step, the Move jog one per detent; one
 * page per TW_JOG_STEPS of them was what felt like the hardware on device. */
export const TW_JOG_STEPS = 10;

/** Twister encoders that do something — the ones whose rings are lit. */
export const TW_ASSIGNED: readonly number[] = [TW_JOG, TW_PRESET, TW_BACK,
    8, 9, 10, 11, 12, 13, 14, 15];

export type ExtAction =
    | { kind: 'cc'; cc: number; value: number }   /* replay as a Move control */
    | { kind: 'preset'; delta: number };          /* step the preset list */

export interface ExtKnobState {
    abs: Map<string, number>;
    jog: number;
}

export function createExtKnobState(): ExtKnobState {
    return { abs: new Map(), jog: 0 };
}

/* Absolute 0-127 -> signed steps since the last value on that control. The
 * first value seen only sets the origin: there is no "since" yet, and jumping
 * a parameter to where the controller happens to sit is the bug to avoid. */
function absDelta(st: ExtKnobState, id: string, v: number): number {
    const last = st.abs.get(id);
    st.abs.set(id, v);
    if (last === undefined) return 0;
    return Math.max(-63, Math.min(63, v - last));
}

const toRel = (d: number): number => (d >= 0 ? d : 128 + d);
const cc = (n: number, value: number): ExtAction => ({ kind: 'cc', cc: n, value });

/** The Move controls one external CC stands for. `ch` is 1-based. */
export function extKnobActions(st: ExtKnobState, ch: number, d1: number, d2: number): ExtAction[] {
    if (d1 >= EXT_REL_BASE && d1 < EXT_REL_BASE + EXT_KNOBS) {
        return d2 === 0 || d2 === 64 ? [] : [cc(MoveKnob1 + d1 - EXT_REL_BASE, d2)];
    }
    if (d1 >= EXT_ABS_BASE && d1 < EXT_ABS_BASE + EXT_KNOBS) {
        const d = absDelta(st, 'abs' + d1, d2);
        return d ? [cc(MoveKnob1 + d1 - EXT_ABS_BASE, toRel(d))] : [];
    }
    if (ch === 2) {
        const v = d2 > 0 ? 127 : 0;
        if (d1 === TW_JOG) return [cc(MoveMainButton, v)];
        if (d1 === TW_BACK) return [cc(MoveBack, v)];
        return [];
    }
    if (ch !== 1) return [];
    if (d1 === TW_JOG) {
        st.jog += absDelta(st, 'tw' + d1, d2);
        const out: ExtAction[] = [];
        while (st.jog >= TW_JOG_STEPS)  { st.jog -= TW_JOG_STEPS; out.push(cc(MoveMainKnob, 1)); }
        while (st.jog <= -TW_JOG_STEPS) { st.jog += TW_JOG_STEPS; out.push(cc(MoveMainKnob, 127)); }
        return out;
    }
    if (d1 === TW_PRESET) {
        const d = absDelta(st, 'tw' + d1, d2);
        return d ? [{ kind: 'preset', delta: d }] : [];
    }
    if (d1 >= TW_KNOB_BASE && d1 < TW_KNOB_BASE + EXT_KNOBS) {
        const d = absDelta(st, 'tw' + d1, d2);
        return d ? [cc(MoveKnob1 + d1 - TW_KNOB_BASE, toRel(d))] : [];
    }
    return [];
}
