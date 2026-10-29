/* A part laid into its phrase plan (create/phrase.ts): what falls inside a
 * span plays, a pickup up to an 8th before it included; what falls between
 * spans rests; and each span LANDS on a beat, held to its end. A line
 * lands on a stable tone: an open one (3rd, 5th) on a call, the root on an
 * answer, the tonic where the clip ends on a chord that holds it (call and
 * answer, antecedent and consequent). A chord part lands on its strike there,
 * or holds its last one (a held arrival). A bass never vanishes: between
 * its phrases it holds the root of each chord that starts there, the way
 * a player anchors the change and moves only in between. */

import type { GenCtx } from '../analysis/context.js';
import { nearestPitch, sameChord } from '../theory/pc.js';
import { type Ev, HALF, TPS } from '../types.js';
import { chordUnder } from './common.js';
import { type Span, T, type Tpl } from './phrase.js';

export type PhraseKind = 'chord' | 'pad' | 'line' | 'bass' | 'counter' | 'melody';

const PICK = 2 * TPS;
const near = (a: number, b: number) => Math.abs(a - b) < TPS / 2;

export interface Laid { evs: Ev[]; hold: Map<Ev, number>; lands: Set<Ev> }

function landPitch(ctx: GenCtx, h: number, kind: PhraseKind, s: Span, tick: number, prev: number, lo: number, hi: number): number {
    const c = chordUnder(ctx, h, tick);
    if (kind === 'bass') return nearestPitch(prev, [c.bass ?? c.root], lo, hi);
    if (s.last && c.pcs.includes(ctx.key.tonic)) return nearestPitch(prev, [ctx.key.tonic], lo, hi);
    if (s.answer) return nearestPitch(prev, [c.root], lo, hi);
    return nearestPitch(prev, [c.pcs[1] ?? c.root, c.pcs[2] ?? c.root, c.root], lo, hi);
}

/** Where `tick` falls in span `s` (the clip loops, so a span may run past
 *  its end): the tick in the span's frame, or null. */
function inSpan(s: Span, tick: number, end: number): number | null {
    for (const t of [tick, tick + end]) if (t >= s.start - PICK && t < s.land - TPS / 2) return t;
    return null;
}

/* The bass's anchors: a held root at each chord change no phrase covers. */
function anchors(ctx: GenCtx, h: number, spans: Span[], laid: Laid, lo: number, hi: number, centre: number): void {
    const covered = (t: number) => spans.some((s) => [t, t + ctx.end].some((x) => x >= s.start - PICK && x < s.end));
    const at: number[] = [];
    for (let x = 0; x < ctx.end; x += HALF) if (!at.length || !sameChord(chordUnder(ctx, h, x), chordUnder(ctx, h, at[at.length - 1]))) at.push(x);
    at.forEach((x, i) => {
        if (covered(x)) return;
        const next = Math.min(at[i + 1] ?? ctx.end, ...spans.map((s) => s.start - PICK).filter((t) => t > x), ctx.end);
        const c = chordUnder(ctx, h, x);
        const e: Ev = { tick: x, voices: [{ pitch: nearestPitch(centre, [c.bass ?? c.root], lo, hi), dt: 0, gate: TPS, vel: 96 }] };
        laid.evs.push(e);
        laid.hold.set(e, next - x);
        laid.lands.add(e);
    });
}

export function layInto(ctx: GenCtx, evs: Ev[], spans: Span[], kind: PhraseKind, h: number, tpl: Tpl): Laid {
    const laid: Laid = { evs: [], hold: new Map(), lands: new Set() };
    if (!evs.length) return laid;
    const poly = kind === 'chord' || kind === 'pad';
    const ps = evs.flatMap((e) => e.voices.map((v) => v.pitch)).sort((a, b) => a - b);
    const lo = ps[0] - 2, hi = ps[ps.length - 1] + 2, centre = ps[ps.length >> 1];
    let prev = centre;
    for (const s of spans) {
        const landTick = s.land % ctx.end;
        const inside = tpl.bare ? [] : evs.map((e) => ({ e, t: inSpan(s, e.tick, ctx.end) })).filter((x) => x.t !== null && !laid.hold.has(x.e));
        for (const { e, t } of inside) { laid.evs.push(e); laid.hold.set(e, s.end - t!); }
        if (inside.length) prev = inside[inside.length - 1].e.voices[0].pitch;
        let land = evs.find((e) => near(e.tick, landTick) && !laid.hold.has(e)) ?? null;
        if (poly && !land && inside.length) land = inside[inside.length - 1].e;
        if (poly && !land) {
            /* No strike to land on: the nearest one on the same chord, struck here. */
            const c = chordUnder(ctx, h, landTick);
            const src = [...evs].filter((e) => sameChord(chordUnder(ctx, h, e.tick), c))
                .sort((a, b) => Math.abs(a.tick - landTick) - Math.abs(b.tick - landTick))[0] ?? evs[0];
            land = { tick: landTick, voices: src.voices.map((v) => ({ ...v })) };
        }
        if (!land) land = { tick: landTick, voices: [{ pitch: prev, dt: 0, gate: TPS, vel: inside[inside.length - 1]?.e.voices[0].vel ?? 92 }] };
        if (!poly) {
            const p = landPitch(ctx, h, kind, s, landTick, prev, lo, hi);
            land = { tick: land.tick, voices: [{ ...land.voices[0], pitch: p }] };
            prev = p;
        }
        if (!laid.hold.has(land)) laid.evs.push(land);
        const from = inside.find((x) => x.e === land)?.t ?? s.land;
        laid.hold.set(land, s.end - from);
        laid.lands.add(land);
    }
    if (kind === 'bass' && tpl !== T.DUB) anchors(ctx, h, spans, laid, lo, hi, centre);
    laid.evs.sort((a, b) => a.tick - b.tick);
    return laid;
}
