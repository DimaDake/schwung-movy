/* The phrase plan (plans/2026-10-29-phrase-space-design.md §3.1): where a
 * part plays and where it rests, laid out the way players phrase — over a
 * 2-bar unit, each span a phrase that starts on a downbeat (or a pickup
 * before it) and LANDS on a beat, held, before the rest. A mask cuts a line
 * wherever its window ends (Microgroove's parts, SPARSE v1), and the silence
 * after a weak short note sounds like a dropout; a landed, held note before
 * the same silence sounds like a breath.
 *
 * Templates are in beats of a 2-bar unit: [start, land, end]. A 1-bar clip's
 * unit is its bar, and only the templates that still make sense there (they
 * have no minBars) are scaled to it. No dice: a template is a fixed rule. */

import type { GenCtx } from '../analysis/context.js';
import { sameChord } from '../theory/pc.js';
import { BAR, BEAT, HALF } from '../types.js';
import { chordUnder } from './common.js';

export interface Span { start: number; land: number; end: number; answer: boolean; last: boolean }

export interface Tpl {
    name: string;
    spans?: [number, number, number][];
    /** Which units play: 'even' leaves every other unit to the band (srdc's
     *  sr played, dc not), 'odd' plays only the turnaround. */
    units?: 'even' | 'odd';
    minBars?: number;
    /** ANSWER: the entry waits for the "and" when the band hits the downbeat. */
    late?: boolean;
    /** One span per chord change, `hold` of the way to the next. */
    change?: number;
    /** Its notes are only its landings: no pickup is drawn in (DUB). */
    bare?: boolean;
}

export const T: Record<string, Tpl> = {
    BREATH: { name: 'BREATH', spans: [[0, 6, 7]] },
    CALLANS: { name: 'CALL+ANSWER', spans: [[0, 2, 3.5], [4, 6, 7]], minBars: 2 },
    AA: { name: 'A_A_', spans: [[0, 1, 2], [4, 5, 6]], minBars: 2 },
    CALL: { name: 'CALL', spans: [[0, 2, 4]], minBars: 2 },
    ONOFF: { name: 'ON/OFF', spans: [[0, 6, 7]], units: 'even', minBars: 4 },
    ANSWER: { name: 'ANSWER', spans: [[4, 8, 9]], minBars: 2, late: true },
    HOOK: { name: 'HOOK', spans: [[0, 1, 2]], minBars: 2 },
    END: { name: 'SECTION END', spans: [[0, 6, 7]], units: 'odd', minBars: 4 },
    LEADIN: { name: 'LEAD-IN', spans: [[6, 8, 9]] },
    ONE: { name: 'ONE', spans: [[0, 0, 7]] },
    CHANGES: { name: 'CHANGES', change: 1 },
    /* Dub: the one left empty, the notes on the "and"s, most of the bar silent. */
    DUB: { name: 'DUB', spans: [[0.5, 0.5, 1.75], [2.75, 2.75, 3.5], [4.5, 4.5, 5.75], [6.75, 6.75, 7.5]], minBars: 2, bare: true },
};

export const fits = (t: Tpl, bars: number): boolean => bars >= (t.minBars ?? 1);

/** The bars of the clip where the band is busier: a counter line answers
 *  in the other one. */
function busier(ctx: GenCtx, a: number, b: number): boolean {
    const w = (lo: number) => ctx.band.filter((h) => h.tick >= lo && h.tick < lo + BAR).reduce((s, h) => s + h.w, 0);
    return w(a) > w(b);
}

/** The template's spans over the clip, in ticks. `quiet` moves a one-bar
 *  phrase to the unit's quieter bar (COUNTER). */
export function planSpans(ctx: GenCtx, t: Tpl, h: number, quiet = false): Span[] {
    const bars = Math.ceil(ctx.len / 16);
    const out: Span[] = [];
    if (t.change) {
        const at: number[] = [];
        for (let x = 0; x < ctx.end; x += HALF) if (!at.length || !sameChord(chordUnder(ctx, h, x), chordUnder(ctx, h, at[at.length - 1]))) at.push(x);
        if (at.length > 1 && sameChord(chordUnder(ctx, h, at[0]), chordUnder(ctx, h, at[at.length - 1]))) at.pop();
        at.forEach((x, i) => {
            const next = at[i + 1] ?? ctx.end + at[0];
            out.push({ start: x, land: x, end: x + Math.max(BEAT, Math.round(((next - x) * t.change!) / BEAT) * BEAT), answer: false, last: false });
        });
        return out;
    }
    const unitBars = bars >= 2 ? 2 : 1;
    const beat = (BEAT * unitBars) / 2;
    const units = Math.ceil(bars / unitBars);
    for (let u = 0; u < units; u++) {
        if ((t.units === 'even' && u % 2) || (t.units === 'odd' && u % 2 === 0)) continue;
        const t0 = u * unitBars * BAR;
        const shift = quiet && unitBars === 2 && (t === T.CALL || t === T.HOOK) && busier(ctx, t0, t0 + BAR) ? 4 : 0;
        t.spans!.forEach(([a, l, e], i) => {
            let start = t0 + (a + shift) * beat;
            if (t.late && ctx.band.some((x) => x.tick === start && x.w >= 0.9)) start += beat / 2;
            const land = t0 + (l + shift) * beat;
            /* A partial last unit (an odd bar count) keeps only what lands in the clip. */
            if (start >= ctx.end || land > ctx.end) return;
            out.push({ start, land, end: t0 + (e + shift) * beat,
                answer: i % 2 === 1 || (t.spans!.length === 1 && u % 2 === 1), last: false });
        });
    }
    if (out.length) out[out.length - 1].last = true;
    return out;
}
