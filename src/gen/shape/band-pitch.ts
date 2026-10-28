/* What the band already sounds, by pitch, for a New Clip or Variation part
 * (bench 2026-10-29, plans/2026-10-29-generator-quality-metrics.md): a chord
 * part in the LOW register landed on top of the bass, a part written around a
 * motif struck a semitone against the motif's notes, and a B section built
 * track by track rubbed against the tracks varied before it. Real parts in
 * the bench corpus never rub on a strong beat. */

import type { GenCtx } from '../analysis/context.js';
import { isStrong } from '../analysis/events.js';
import { pc } from '../theory/pc.js';
import { type Note, TPS } from '../types.js';
import { chordUnder } from '../create/common.js';

const BASS_TOP = 55;    // ai/role.ts: a part whose median sits below this is a bass

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const cache = new WeakMap<GenCtx, { held: Note[]; bass: number }>();

function band(ctx: GenCtx): { held: Note[]; bass: number } {
    const hit = cache.get(ctx);
    if (hit) return hit;
    const { tracks, target } = ctx.input;
    const held: Note[] = [];
    let bass = -1;
    const clips = tracks.filter((t) => t.index !== target.track && !t.drum)
        .flatMap((t) => t.clips.filter((c) => c.slot === target.slot && c.notes.length));
    /* A clip shorter than its scene loops under all of it: a one-bar motif
     * over a four-bar progression sounds against every bar. The scene is
     * folded onto the clip's own length, so a note is judged on each repeat. */
    const scene = Math.max(ctx.end, ...clips.map((c) => c.len * TPS));
    for (const c of clips) {
        const span = Math.max(TPS, c.len * TPS), from = c.loopStart * TPS;
        const heard = c.notes.filter((n) => n.tick >= from && n.tick < from + span);
        if (!heard.length) continue;
        const m = median(heard.map((n) => n.pitch));
        if (m < BASS_TOP) bass = Math.max(bass, m);
        for (let off = 0; off < scene; off += span) {
            for (const n of heard) {
                if (n.tick - from + off >= scene) continue;
                const t = (n.tick - from + off) % ctx.end;
                held.push({ ...n, tick: t });
                /* Held across the clip's loop point: it sounds at the start too. */
                if (t + n.gate > ctx.end) held.push({ ...n, tick: t - ctx.end });
            }
        }
    }
    const out = { held, bass };
    cache.set(ctx, out);
    return out;
}

/** The lowest a chord part's voices go: a fifth over the band's bass line,
 *  so the chords and the bass are two parts, not one muddy one (0: no bass). */
export function chordFloor(ctx: GenCtx): number {
    const b = band(ctx).bass;
    return b < 0 ? 0 : b + 7;
}

/** A minor second or ninth: the rub the corpus's real parts avoid. */
const rubs = (a: number, b: number) => { const d = Math.abs(a - b); return d % 12 === 1 && d <= 25; };

/** Moves notes off a semitone against the band: a chord voice by an octave
 *  (or out, while the chord keeps two), a line's note to the nearest chord
 *  tone that does not rub. A note rubs with what the band holds as it starts,
 *  if it starts on a strong beat (a weak one is a passing note), and with
 *  what the band strikes on a strong beat while it still sounds — a pad held
 *  from the bar line rubs with the motif note that comes in on beat two. */
export function clearRubs(ctx: GenCtx, notes: Note[], h: number): Note[] {
    const { held } = band(ctx);
    if (!held.length || !notes.length) return notes;
    const chordal = (t: number) => (at.get(t) ?? 0) > 1;
    const under = (n: Note) => held.filter((b) => b.tick < n.tick + n.gate && b.tick + b.gate > n.tick
        && (b.tick <= n.tick ? isStrong(n.tick) || chordal(n.tick) : isStrong(b.tick))).map((b) => b.pitch);
    const free = (p: number, u: number[]) => !u.some((b) => rubs(p, b));
    const at = new Map<number, number>();
    for (const n of notes) at.set(n.tick, (at.get(n.tick) ?? 0) + 1);
    const floor = chordFloor(ctx);
    const out: Note[] = [];
    for (const n of notes) {
        const u = under(n);
        if (!u.length || free(n.pitch, u)) { out.push(n); continue; }
        if (chordal(n.tick)) {
            const q = [n.pitch + 12, n.pitch - 12].find((x) => x >= floor && x <= 100 && free(x, u));
            if (q !== undefined) out.push({ ...n, pitch: q });
            else if ((at.get(n.tick) ?? 0) > 2) at.set(n.tick, (at.get(n.tick) ?? 0) - 1);
            else out.push(n);
            continue;
        }
        const tones = chordUnder(ctx, h, n.tick).pcs;
        let best = n.pitch, d = 99;
        for (let x = n.pitch - 7; x <= n.pitch + 7; x++) {
            if (tones.includes(pc(x)) && free(x, u) && Math.abs(x - n.pitch) < d) { best = x; d = Math.abs(x - n.pitch); }
        }
        out.push({ ...n, pitch: best });
    }
    return out;
}
