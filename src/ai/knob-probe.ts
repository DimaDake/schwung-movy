/* The preview's per-tick knob probe (preview-knobs.ts) runs a roll a tick
 * (gen/live.ts), resumed while the option, its context and its knobs stay;
 * a touch still asks at once with knobLive. */

import type { GenCtx } from '../gen/analysis/context.js';
import { knobLiveSteps } from '../gen/live.js';
import type { Preset } from '../gen/preset.js';

let probe: { o: object; c: GenCtx; at: string; g: Generator<void, boolean, void> } | null = null;

/** Whether knob `i` of option `o` can change it; undefined until known. */
export function probeStep(o: object, c: GenCtx, p: Preset, knobs: number[], i: number): boolean | undefined {
    const at = `${i}|${knobs.join()}`;
    if (!probe || probe.o !== o || probe.c !== c || probe.at !== at) probe = { o, c, at, g: knobLiveSteps(c, p, [...knobs], i) };
    const r = probe.g.next();
    if (!r.done) return undefined;
    probe = null;
    return r.value;
}
