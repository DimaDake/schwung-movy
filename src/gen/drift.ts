/* DRIFT (user, 2026-10-28: "a knob that gradually changes the notes, so it
 * gradually evolves into something new … useful for live change but also to
 * find a particular variation across similar ones without drastic change").
 * One fixed list of small moves per take — a note a scale step up or down,
 * onto a chord tone where the beat is strong; a chord voice to the next
 * chord tone; a drum hit a 16th along, or a ghost beside it — and DRIFT n
 * plays the first n·E/10 of them (E: the part's onsets), n at least. Position n+1 is
 * position n with one more move, so turning it walks the part away step by
 * step, and turning back walks it home. SEED jumps; DRIFT walks. */

import type { GenCtx } from './analysis/context.js';
import { chordAt } from './analysis/context.js';
import { fromEvents, isStrong, toEvents } from './analysis/events.js';
import type { KnobDef } from './knobs.js';
import type { Preset } from './preset.js';
import { planAt } from './plan.js';
import { hash, mix, type Rng, rng, shuffled } from './rng.js';
import { nearestPitch, pc, stepScale } from './theory/pc.js';
import { type Chord, type Ev, type Note, TPS } from './types.js';

export const DRIFT: KnobDef = { name: 'DRIFT', steps: () => 21, def: () => 0, label: (v) => (v ? '+' + v : 'OFF') };

/** The chord tone next to `p` in direction `dir` that the event does not already hold. */
function nextTone(p: number, dir: number, pcs: number[], taken: number[]): number {
    for (let q = p + dir; Math.abs(q - p) <= 12; q += dir) if (pcs.includes(pc(q)) && !taken.includes(q)) return q;
    return p;
}

function moveVoice(ctx: GenCtx, e: Ev, chord: Chord | null, r: Rng, lo: number, hi: number): void {
    const i = Math.floor(r() * e.voices.length);
    const x = e.voices[i];
    let dir = r() < 0.5 ? -1 : 1;
    if (x.pitch + dir * 2 > hi || x.pitch + dir * 2 < lo) dir = -dir;
    if (e.voices.length > 1 && chord) {
        x.pitch = nextTone(x.pitch, dir, chord.pcs, e.voices.map((y) => y.pitch));
        return;
    }
    const step = stepScale(x.pitch, dir * (r() < 0.25 ? 2 : 1), ctx.key);
    x.pitch = chord && isStrong(e.tick) ? nearestPitch(step, chord.pcs, Math.min(step, x.pitch + dir), Math.max(step, x.pitch + dir)) : step;
}

function moveHit(ctx: GenCtx, evs: Ev[], i: number, r: Rng): void {
    const e = evs[i];
    const step = Math.round(e.tick / TPS);
    if (step % 16 === 0) return;                                   // the downbeat stays
    const to = step + (r() < 0.5 ? -1 : 1);
    const free = to > 0 && to * TPS < ctx.end && !evs.some((x) => Math.round(x.tick / TPS) === to);
    /* Nowhere to go (a full row of 16ths): the accent drifts instead. */
    if (!free) { for (const v of e.voices) v.vel = Math.max(20, Math.min(127, Math.round(v.vel * (r() < 0.5 ? 0.7 : 1.3)))); return; }
    if (r() < 0.6) e.tick += (to - step) * TPS;
    else evs.push({ tick: to * TPS, voices: e.voices.map((v) => ({ ...v, vel: Math.max(1, Math.round(v.vel * 0.45)) })) });
}

function drift(ctx: GenCtx, notes: Note[], d: number, seed: number, chords: (Chord | null)[]): Note[] {
    /* Smart Double drifts its answer only: the first half stays as played. */
    const from = ctx.task === 'double' ? ctx.end / 2 : 0;
    const evs = toEvents(notes);
    const idx = evs.map((e, i) => i).filter((i) => evs[i].tick >= from);
    if (!idx.length || d <= 0) return notes;
    const r = rng(mix(seed, 0xD21F7));
    const order = shuffled(r, idx);
    /* At least one more move per click: on a part of a few notes n·E/10
     * rounded to the same count on most clicks (bench 2026-10-29). */
    const moves = Math.max(d, Math.round((d * order.length) / 10));
    const ps = notes.map((n) => n.pitch);
    const lo = Math.min(...ps) - 5, hi = Math.max(...ps) + 5;
    for (let j = 0; j < moves; j++) {
        const i = order[j % order.length];
        if (ctx.drum) moveHit(ctx, evs, i, r);
        else moveVoice(ctx, evs[i], chordAt(chords, evs[i].tick, ctx.k) ?? chordAt(ctx.srcChords, evs[i].tick, ctx.k), r, lo, hi);
    }
    return fromEvents(evs.sort((a, b) => a.tick - b.tick), ctx.end);
}

/** A generator with DRIFT after its own knobs. */
export function withDrift(p: Preset): Preset {
    const n = p.knobs.length;
    const h = p.knobs.findIndex((k) => k.name === 'HARMONY');
    return { ...p, knobs: [...p.knobs, DRIFT],
        generate: (ctx, v, seed) => {
            const out = p.generate(ctx, v.slice(0, n), seed);
            if (!v[n]) return out;
            const chords = (h >= 0 ? planAt(ctx, v[h]) : ctx.plans[0])?.chords ?? [];
            return drift(ctx, out, v[n], mix(seed, hash(p.id)), chords);
        } };
}
