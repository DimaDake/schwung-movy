/* Guide tones (plans/2026-10-29-generator-follow-ups.md #6): the 3rd and
 * 7th are what tell one chord from the next, and a line that moves between
 * them by the smallest step (the 7th of one chord falling to the 3rd of the
 * next, as in a ii-V-I) is heard to follow the harmony, the way jazz players
 * and counter-melodies do. A line over the harmony takes the guide tone
 * where each chord starts, and the note just before a change steps into the
 * next one. Between them it keeps its own contour. */

import type { GenCtx, Prog } from '../analysis/context.js';
import { planAt } from '../plan.js';
import { seventhOf } from '../realise/common.js';
import { nearestPitch, pc, sameChord, stepScale } from '../theory/pc.js';
import { type Chord, HALF, type Note, TPS } from '../types.js';
import { chordUnder } from './common.js';

/** How close before a change a note leads into it. */
const LEAD = 4 * TPS;

/** A chord's guide tones: its 3rd and 7th. A major 7th the chord does not
 *  itself hold would rub a semitone under its root; there the 5th. */
export function guidePcs(c: Chord, ctx: GenCtx): number[] {
    const s = seventhOf(c, ctx.key);
    return [c.pcs[1] ?? c.pcs[0], c.pcs.length < 4 && pc(c.root - s) === 1 ? c.pcs[2] ?? c.root : s];
}

/** Where each chord starts in the clip, and its guide tone: the 3rd or 7th
 *  nearest the last one, so the guide line moves by step. */
export function guideLine(ctx: GenCtx, h: number, lo: number, hi: number, from: number): [number, number][] {
    const unit = ((planAt(ctx, h).chords as Prog).unit ?? HALF) / ctx.k;
    const out: [number, number][] = [];
    let prev = from, last: Chord | null = null;
    for (let t = 0; t < ctx.end; t += unit) {
        const c = chordUnder(ctx, h, t);
        if (last && sameChord(c, last)) continue;
        prev = nearestPitch(prev, guidePcs(c, ctx), lo, hi);
        out.push([t, prev]);
        last = c;
    }
    return out;
}

/** A line laid over its guide tones: the first note of each chord takes the
 *  chord's guide tone, the last note before a change a scale step from the
 *  next one (from the side it comes from). `keep` notes are left alone (a
 *  phrase's landing on the tonic). */
export function onGuides(ctx: GenCtx, h: number, notes: Note[], lo: number, hi: number, keep = new Set<Note>()): Note[] {
    if (!notes.length) return notes;
    const ns = [...notes].sort((a, b) => a.tick - b.tick);
    const g = guideLine(ctx, h, lo, hi, ns[0].pitch);
    if (g.length < 2) return ns;
    g.forEach(([start, pitch], i) => {
        const end = g[i + 1]?.[0] ?? ctx.end;
        const inside = ns.filter((n) => n.tick >= start && n.tick < end);
        if (!inside.length) return;
        const first = inside[0];
        if (!keep.has(first)) first.pitch = pitch;
        const next = g[(i + 1) % g.length][1];
        const lead = inside[inside.length - 1];
        if (lead !== first && !keep.has(lead) && end - lead.tick <= LEAD) {
            lead.pitch = Math.max(lo, Math.min(hi, stepScale(next, lead.pitch > next ? 1 : -1, ctx.key)));
        }
    });
    return ns;
}
