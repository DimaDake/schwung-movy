/* VOICES: more (or fewer) harmony notes (user, 2026-10-27: "chords should
 * ... add additional harmony notes ... this may not apply only to chords").
 * A chord gains the next chord tone above its top (the seventh, the ninth
 * where the tension allows), or loses an inner voice; a line gains a chord
 * tone under its strongest notes. */

import type { GenCtx, Prog } from '../analysis/context.js';
import { chordAt } from '../analysis/context.js';
import { strength } from '../analysis/events.js';
import { colourPcs } from '../theory/category.js';
import { pc } from '../theory/pc.js';
import type { Ev } from '../types.js';
import { seventhOf } from '../realise/common.js';

export const VOICE_STEPS = ['-1', 'AS IS', '+1', '+2', '+3'] as const;

export function thicken(ctx: GenCtx, evs: Ev[], delta: number, plan: Prog, tension: number): Ev[] {
    if (!delta || !evs.length) return evs;
    const chordPart = evs.filter((e) => e.voices.length > 1).length * 2 >= evs.length;
    if (!chordPart && delta < 0) return evs;
    /* A line takes a second voice on its strongest notes only: as many as
     * keep it a line (the role rule), a fifth of them per step. */
    const share = chordPart ? 1 : Math.min(0.6, delta * 0.2);
    const order = evs.map((e, i) => ({ i, w: strength(e.tick) })).sort((a, b) => b.w - a.w);
    const pick = new Set(order.slice(0, Math.round(evs.length * share)).map((x) => x.i));
    return evs.map((e, i) => {
        if (!pick.has(i)) return e;
        const T = chordAt(plan, e.tick, ctx.k) ?? chordAt(ctx.srcChords, e.tick, ctx.k);
        if (!T) return e;
        const vs = [...e.voices].sort((a, b) => a.pitch - b.pitch);
        if (delta < 0) {
            if (vs.length < 3) return e;
            const inner = vs.slice(1, -1);
            const drop = new Set(inner.slice(0, Math.min(-delta, inner.length)));
            return { tick: e.tick, voices: vs.filter((v) => !drop.has(v)) };
        }
        const tones = [...T.pcs, seventhOf(T, ctx.key), ...(tension >= 0.6 ? colourPcs(T, ctx.key) : [])];
        const out = [...vs];
        if (!chordPart) {
            /* Under the line: the nearest chord tone a third to a sixth below. */
            const top = vs[vs.length - 1];
            for (let d = 3; d <= 9; d++) {
                if (T.pcs.includes(pc(top.pitch - d))) { out.unshift({ ...top, pitch: top.pitch - d, vel: Math.round(top.vel * 0.85) }); break; }
            }
            return { tick: e.tick, voices: out.sort((a, b) => a.pitch - b.pitch) };
        }
        const have = new Set(out.map((v) => pc(v.pitch)));
        let p = out[out.length - 1].pitch;
        for (let k = 0; k < delta; k++) {
            /* Prefer a tone the voicing lacks; above the top, within an octave. */
            let next = -1;
            for (let q = p + 1; q <= p + 12 && next < 0; q++) if (tones.includes(pc(q)) && !have.has(pc(q))) next = q;
            for (let q = p + 1; q <= p + 12 && next < 0; q++) if (tones.includes(pc(q))) next = q;
            if (next < 0 || next > 127) break;
            out.push({ ...out[out.length - 1], pitch: next, vel: Math.round(out[out.length - 1].vel * 0.9) });
            have.add(pc(next));
            p = next;
        }
        return { tick: e.tick, voices: out };
    });
}
