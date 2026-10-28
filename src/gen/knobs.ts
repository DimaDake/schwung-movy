/* The knob vocabulary (design §5.1). A preset builds its four or eight knobs
 * from these, so a name means one thing on every preset; its own knobs use
 * `custom`. Positions are integers 0..steps-1. */

import type { GenCtx } from './analysis/context.js';
import { GRIDS } from './analysis/groove.js';
import { defaultHarmony, planAt } from './plan.js';
import { CHANGES } from './theory/changes.js';
import { RHYTHMS } from './shape/rhythm.js';
import { VOICE_STEPS } from './shape/thicken.js';

export interface KnobDef {
    name: string;
    steps: (ctx: GenCtx) => number;
    def: (ctx: GenCtx) => number;
    label: (v: number, ctx: GenCtx) => string;
}

const fixed = (n: number) => () => n;
const pct = (v: number, steps: number) => Math.round((v / (steps - 1)) * 100) + '%';
const centred = (v: number) => (v === 5 ? 'AS IS' : (v > 5 ? '+' : '-') + Math.abs(v - 5) * 20 + '%');

export function custom(name: string, labels: readonly string[], def = 0): KnobDef {
    return { name, steps: fixed(labels.length), def: fixed(Math.min(def, labels.length - 1)), label: (v) => labels[v] ?? '' };
}

export function count(name: string, max: number, def: number): KnobDef {
    return { name, steps: fixed(max + 1), def: fixed(def), label: (v) => String(v) };
}

export const K = {
    amount: (def = 5): KnobDef => ({ name: 'AMOUNT', steps: fixed(11), def: fixed(def), label: (v) => pct(v, 11) }),
    harmony: (far = 1): KnobDef => ({ name: 'HARMONY', steps: (c) => Math.max(1, c.plans.length),
        def: (c) => defaultHarmony(c, far), label: (v, c) => planAt(c, v).label }),
    tension: (def = 5): KnobDef => ({ name: 'TENSION', steps: fixed(11), def: fixed(def),
        label: (v) => (v <= 3 ? 'CHORD TONES' : v <= 6 ? 'COLOUR' : v <= 8 ? 'APPROACH' : 'CHROMATIC') + ' ' + v }),
    density: (def = 5): KnobDef => ({ name: 'DENSITY', steps: fixed(11), def: fixed(def), label: centred }),
    length: (def = 5): KnobDef => ({ name: 'LENGTH', steps: fixed(11), def: fixed(def), label: centred }),
    range: (def = 5): KnobDef => ({ name: 'RANGE', steps: fixed(11), def: fixed(def),
        label: (v) => (v === 5 ? 'AS IS' : 'X' + rangeOfKnob(v).toFixed(1)) }),
    timing: (def = 10): KnobDef => ({ name: 'TIMING', steps: fixed(11), def: fixed(def), label: (v) => pct(v, 11) }),
    swing: (): KnobDef => ({ name: 'SWING', steps: fixed(11), def: (c) => Math.min(10, Math.round(c.groove.swing / 0.05)),
        label: (v) => (50 + v * 2.5).toFixed(1).replace('.0', '') + '%' }),
    grid: (): KnobDef => ({ name: 'GRID', steps: fixed(GRIDS.length), def: (c) => GRIDS.indexOf(c.groove.grid),
        label: (v) => GRIDS[v] }),
    dynamics: (def = 0): KnobDef => ({ name: 'DYNAMICS', steps: fixed(11), def: fixed(def), label: (v) => pct(v, 11) }),
    pitchFix: (def = 4): KnobDef => ({ name: 'PITCH FIX', steps: fixed(11), def: fixed(def), label: (v) => pct(v, 11) }),
    clean: (def = 3): KnobDef => ({ name: 'CLEAN', steps: fixed(11), def: fixed(def), label: (v) => pct(v, 11) }),
    seed: (): KnobDef => ({ name: 'SEED', steps: fixed(100), def: fixed(0), label: (v) => '#' + (v + 1) }),
    changes: (def = 0): KnobDef => custom('CHANGES', CHANGES, def),
    rhythm: (def = 0): KnobDef => custom('RHYTHM', RHYTHMS, def),
    voices: (def = 1): KnobDef => custom('VOICES', VOICE_STEPS, def),
};

/** Swing knob position → fraction of a 16th. */
export const swingOfKnob = (v: number): number => v * 0.05;
/** RANGE → interval scale: 0.5 at the left, 1 (as played) in the middle, 2
 *  at the right — the right half reaches further, for the creative end. */
export const rangeOfKnob = (v: number): number => (v <= 5 ? 0.5 + v * 0.1 : 1 + (v - 5) * 0.2);
export const tensionOfKnob = (v: number): number => v / 10;
