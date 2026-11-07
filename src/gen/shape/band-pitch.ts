/* What the band already sounds, by pitch, for a New Clip or Variation part
 * (bench 2026-10-29, plans/2026-10-29-generator-quality-metrics.md): a chord
 * part in the LOW register landed on top of the bass, a part written around a
 * motif struck a semitone against the motif's notes, and a B section built
 * track by track rubbed against the tracks varied before it. Real parts in
 * the bench corpus never rub on a strong beat. */

import { type GenCtx, strikesChords } from '../analysis/context.js';
import { isStrong } from '../analysis/events.js';
import { pc } from '../theory/pc.js';
import { type Note, TPS } from '../types.js';
import { chordUnder } from '../create/common.js';

const BASS_TOP = 55;    // ai/role.ts: a part whose median sits below this is a bass

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
interface Part { mid: number; on: Set<number>; chords: boolean }
interface Band { held: Note[]; bass: number; mid: number; mids: number[]; parts: Part[] }
const cache = new WeakMap<GenCtx, Band>();

function band(ctx: GenCtx): Band {
    const hit = cache.get(ctx);
    if (hit) return hit;
    const { tracks, target } = ctx.input;
    const held: Note[] = [];
    let bass = -1, mid = -1;
    const mids: number[] = [];
    const parts: Part[] = [];
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
        else { mid = Math.max(mid, m); mids.push(m); parts.push({ mid: m, on: new Set(), chords: strikesChords(heard) }); }
        for (let off = 0; off < scene; off += span) {
            for (const n of heard) {
                if (n.tick - from + off >= scene) continue;
                const t = (n.tick - from + off) % ctx.end;
                held.push({ ...n, tick: t });
                if (m >= BASS_TOP) parts[parts.length - 1].on.add(Math.round(t / TPS));
                /* Held across the clip's loop point: it sounds at the start too. */
                if (t + n.gate > ctx.end) held.push({ ...n, tick: t - ctx.end });
            }
        }
    }
    const out = { held, bass, mid, mids, parts };
    cache.set(ctx, out);
    return out;
}

/** The lowest a chord part's voices go: a fifth over the band's bass line,
 *  so the chords and the bass are two parts, not one muddy one (0: no bass). */
export function chordFloor(ctx: GenCtx): number {
    const b = band(ctx).bass;
    return b < 0 ? 0 : b + 7;
}

/** The lowest middle a line over the band's chords may have: a fifth over
 *  the highest of their middles, so the lead is heard over them, not inside
 *  them (bench: paths, an ARP or RIFF in a pad's octave flagged 'mud' in 36%
 *  of scenes, real ones 9-21%). 0: no chords, or a track that already plays
 *  in other scenes: its register is the user's (a Variation's New Clip
 *  options, design §2.3, stay where the part was). */
export function lineFloor(ctx: GenCtx): number {
    const m = band(ctx).mid;
    return m < 0 || ownMiddle(ctx) !== null ? 0 : m + 7;
}

/** The middles of the band's parts over the bass: the registers a line or a
 *  chord part should keep clear of. */
export const middles = (ctx: GenCtx): number[] => band(ctx).mids;

/** The middle of what the target track plays in its other scenes: the
 *  register the user gave it (null: a new part). */
export function ownMiddle(ctx: GenCtx): number | null {
    const me = ctx.input.tracks.find((t) => t.index === ctx.input.target.track);
    const ps = (me?.clips ?? []).filter((c) => c.slot !== ctx.input.target.slot).flatMap((c) => c.notes.map((n) => n.pitch));
    return ps.length ? median(ps) : null;
}

/** A Variation line in a chord part's octave that hits with it (half its
 *  onsets or more), or a chord part on a line so, the bench's mud: moved an
 *  octave away from that part, the side its source sat on, while it stays
 *  between the bass's fifth and C7 and clear of every part (paths bench scene
 *  B: lc.mud the top miss of chords and lead varied after each other). Two
 *  chord parts doubling, a drone and a bass are left; New Clip places its own
 *  register (lineFloor). */
export function clearMud(ctx: GenCtx, notes: Note[]): Note[] {
    const kind = ctx.role?.kind;
    if (ctx.task !== 'variation' || !notes.length || kind === 'bass' || kind === 'drone') return notes;
    const mine = strikesChords(notes);
    const parts = band(ctx).parts.filter((p) => p.chords !== mine);
    const on = new Set(notes.map((n) => Math.round(n.tick / TPS)));
    const mud = (m: number) => parts.find((p) => Math.abs(p.mid - m) < 7
        && [...on].filter((s) => p.on.has(s)).length >= 0.5 * Math.min(on.size, p.on.size));
    const m = median(notes.map((n) => n.pitch));
    const hit = mud(m);
    if (!hit) return notes;
    const up = ctx.mid !== hit.mid ? ctx.mid > hit.mid : ctx.role?.kind === 'lead' || ctx.role?.kind === 'arpeggio';
    const d = up ? 12 : -12;
    const lo = Math.max(chordFloor(ctx), 36), top = Math.max(...notes.map((n) => n.pitch)) + d, low = Math.min(...notes.map((n) => n.pitch)) + d;
    /* Never into the bass's register (ai/role.ts: a median under BASS_TOP is a bass). */
    if (top > 96 || low < lo || m + d < BASS_TOP || mud(m + d)) return notes;
    return notes.map((n) => ({ ...n, pitch: n.pitch + d }));
}

/** A new line within a fourth of another line's middle (not chords, not the
 *  bass): two lines in one register cross and blur (layers bench: a second
 *  MELODY beside a lead crossed it in 4 scenes of 6; real lines cross on at
 *  most 15-30% of their shared onsets). Moved an octave away: up while it
 *  stays under C7, else down, never into the bass's register or onto a
 *  chord part's octave (clearMud's rule). The second lines (HARMONIZE,
 *  FOLLOW) sit a third from their melody on purpose: the caller leaves them.
 *  New Clip only, on a track with no register of its own yet (lineFloor's
 *  rule): a Variation keeps its source's. */
export function clearLines(ctx: GenCtx, notes: Note[]): Note[] {
    const kind = ctx.role?.kind;
    if (ctx.task !== 'create' || ownMiddle(ctx) !== null) return notes;
    if (ctx.drum || !notes.length || kind === 'bass' || kind === 'drone' || kind === 'pad' || kind === 'stabs' || strikesChords(notes)) return notes;
    const lines = band(ctx).parts.filter((p) => !p.chords);
    const m = median(notes.map((n) => n.pitch));
    const hit = lines.find((p) => Math.abs(p.mid - m) < 5);
    if (!hit) return notes;
    const chords = band(ctx).parts.filter((p) => p.chords);
    const fits = (d: number) => Math.max(...notes.map((n) => n.pitch)) + d <= 96 && m + d >= BASS_TOP
        && !lines.some((p) => Math.abs(p.mid - (m + d)) < 5) && !chords.some((p) => Math.abs(p.mid - (m + d)) < 7);
    const d = [12, -12].find(fits);
    return d === undefined ? notes : notes.map((n) => ({ ...n, pitch: n.pitch + d }));
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
