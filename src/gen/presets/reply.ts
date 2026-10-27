/* REPLY: a model's option as a preset (design §5.2). The reply is a finished
 * clip, so its knobs are the stages that work on any notes; their defaults
 * leave the reply as it came. Never in the catalog: the preview wraps each
 * reply in one. */

import type { GenCtx } from '../analysis/context.js';
import { fromEvents, toEvents } from '../analysis/events.js';
import { K, swingOfKnob } from '../knobs.js';
import type { Preset } from '../preset.js';
import { rng } from '../rng.js';
import { dynamics } from '../shape/dynamics.js';
import { densityStage } from '../shape/density.js';
import { lengthStage, timing } from '../shape/time.js';
import { pitchFix } from '../shape/pitch.js';
import type { Note, Task } from '../types.js';

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 60; };

/* RANGE on a finished part: intervals around its middle scaled, then pulled
 * back onto the scene's chords so a wider line still fits. */
function range(ctx: GenCtx, notes: Note[], v: number): Note[] {
    if (v === 5 || ctx.drum) return notes;
    const mid = median(notes.map((n) => n.pitch));
    const k = 0.5 + v * 0.1;
    const scaled = notes.map((n) => ({ ...n, pitch: Math.round(mid + (n.pitch - mid) * k) }));
    return pitchFix(ctx, scaled, 5, ctx.plans[0]?.chords ?? ctx.srcChords);
}

export function replyPreset(task: Task, drum: boolean, base: Note[]): Preset {
    if (task === 'quantize') {
        return {
            id: 'reply', name: 'REPLY', task, drum, cls: 'close',
            knobs: [K.timing(0), K.swing(), K.dynamics(0), K.length(5)],
            generate: (ctx, v) => {
                const t = timing(ctx, base, v[0] / 10, ctx.groove.grid, swingOfKnob(v[1]));
                return fromEvents(lengthStage(toEvents(dynamics(t, v[2])), v[3], ctx.end), ctx.end);
            },
        };
    }
    return {
        id: 'reply', name: 'REPLY', task, drum, cls: 'close',
        knobs: [K.density(5), K.length(5), K.range(5), K.dynamics(0)],
        generate: (ctx, v, seed) => {
            const evs = densityStage(ctx, toEvents(range(ctx, base, v[2])), v[0], rng(seed), ctx.plans[0]?.chords ?? []);
            return dynamics(fromEvents(lengthStage(evs, v[1], ctx.end), ctx.end), v[3]);
        },
    };
}
