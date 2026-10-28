/* New Clip's per-pad drum options (plans/2026-10-28-new-clip-design.md):
 * each writes only the selected pad (`ctx.pad`), so a kit is built a pad at
 * a time (ai/preview-pads.ts). Knob 1 is DENSITY everywhere, and 0 is
 * silence: that is how a pad's notes are taken out again. */

import type { GenCtx } from '../analysis/context.js';
import { strength } from '../analysis/events.js';
import type { PadRole } from '../analysis/kit.js';
import { amount, choice, place, SEED } from '../create/common.js';
import type { KnobDef } from '../knobs.js';
import type { Preset } from '../preset.js';
import { withFeel } from '../create/feel.js';
import { mix, type Rng, rng } from '../rng.js';
import { euclid } from '../theory/pc.js';
import { type Note, TPS } from '../types.js';

/** The pad a per-pad option writes: the selected one, else the kick. */
export function padOf(ctx: GenCtx): number {
    const k = ctx.kit;
    if (!k || !k.pads.length) return ctx.pad;
    return k.pads.includes(ctx.pad) ? ctx.pad : k.by.kick[0] ?? k.pads[0];
}

const roleOf = (ctx: GenCtx): PadRole => ctx.kit?.role[padOf(ctx)] ?? 'perc';

/* How busy a pad of each kind usually is, as DENSITY takes. */
const BUSY: Record<PadRole, [number, number]> = { kick: [3, 5], snare: [2, 3], hat: [5, 9], open: [1, 3], tom: [1, 3], cym: [1, 2], perc: [2, 5] };

export const DENSITY: KnobDef = { ...amount('DENSITY', 10, 0, 10), def: () => 4,
    roll: (c, r) => { const [lo, hi] = BUSY[roleOf(c)]; return lo + Math.floor(r() * (hi - lo + 1)); } };

function hit(ctx: GenCtx, out: Note[], step: number, vel: number): void {
    if (step < ctx.len) out.push({ tick: place(ctx, step), pitch: padOf(ctx), gate: TPS / 2, vel: Math.max(1, Math.min(127, Math.round(vel))) });
}

const ACCENTS = ['FLAT', 'DOWNBEAT', 'ROLLING', 'RANDOM'] as const;
function accent(kind: number, i: number, step: number, r: Rng): number {
    if (kind === 0) return 100;
    if (kind === 1) return 70 + 45 * strength(step * TPS);
    if (kind === 2) return 75 + 35 * ((i % 3) / 2);
    return 65 + 50 * r();
}

export const PAD_EUCLID: Preset = withFeel({
    id: 'n-pad-euclid', name: 'PAD EUCLID', task: 'create', drum: true, cls: 'close', perPad: true,
    knobs: [DENSITY, amount('ROTATE', 15, 0, 3), choice('ACCENT', ACCENTS, [0, 1, 1, 2, 3]), choice('RATE', ['1/16', '1/8', '1/8T'], [0, 0, 1])],
    generate: (ctx, v, seed) => {
        const r = rng(mix(seed, padOf(ctx)));
        const out: Note[] = [];
        if (v[0] === 0) return out;
        const steps = [16, 8, 12][v[3]];
        const each = (16 * TPS) / steps;
        const on = euclid(Math.max(1, Math.round((v[0] * steps) / 12)), steps, v[1] % steps);
        for (let bar = 0; bar * 16 < ctx.len; bar++) {
            on.forEach((x, i) => {
                if (!x) return;
                const tick = bar * 16 * TPS + i * each;
                if (tick % TPS === 0) hit(ctx, out, tick / TPS, accent(v[2], i, tick / TPS, r));
                else if (tick < ctx.end) out.push({ tick, pitch: padOf(ctx), gate: TPS / 2, vel: Math.round(accent(v[2], i, 1, r)) });
            });
        }
        return out;
    },
});

/* Where each style leans, per 16th of the bar. */
const STYLES: ((s: number, r: Rng) => number)[] = [
    (s) => strength(s * TPS),
    (s) => (s % 4 === 2 ? 1 : s % 2 ? 0.4 : 0.15),
    (s) => ([3, 6, 10, 11, 14].includes(s) ? 1 : 0.3 * (1 - strength(s * TPS))),
    (_s, r) => r(),
    (s) => ([0, 3, 4, 7, 8, 11, 12, 15].includes(s) ? 0.9 - (s % 4) * 0.1 : 0.1),
];

export const PAD_PATTERN: Preset = withFeel({
    id: 'n-pad-pattern', name: 'PAD PATTERN', task: 'create', drum: true, cls: 'rhythm', perPad: true,
    knobs: [DENSITY, choice('STYLE', ['STRAIGHT', 'OFFBEAT', 'SYNCOPATED', 'BROKEN', 'GALLOP'], [0, 1, 2, 3, 4]),
        choice('FILL', ['NONE', 'LAST BEAT', 'LAST BAR'], [0, 0, 1, 2]), SEED],
    generate: (ctx, v, seed) => {
        const r = rng(mix(seed, padOf(ctx), v[3]));
        const out: Note[] = [];
        if (v[0] === 0) return out;
        const n = Math.max(1, Math.round(v[0] * 1.6));
        const w = Array.from({ length: 16 }, (_, s) => STYLES[v[1]](s, r) + r() * 0.25);
        const steps = w.map((x, s) => [x, s]).sort((a, b) => b[0] - a[0]).slice(0, n).map((x) => x[1]).sort((a, b) => a - b);
        const bars = Math.ceil(ctx.len / 16);
        for (let bar = 0; bar < bars; bar++) {
            const fill = (v[2] === 1 && bar === bars - 1) || (v[2] === 2 && bar === bars - 1 && bars > 1);
            for (const s of steps) if (!(fill && s >= (v[2] === 1 ? 12 : 8))) hit(ctx, out, bar * 16 + s, 70 + 45 * strength(s * TPS));
            if (fill) for (let s = v[2] === 1 ? 12 : 8; s < 16; s += v[2] === 1 ? 1 : 2) hit(ctx, out, bar * 16 + s, 60 + 4 * (s - 8));
        }
        return out;
    },
});
