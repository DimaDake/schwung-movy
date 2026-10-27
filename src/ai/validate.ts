/* The model is never trusted (design §6.3): every option is clamped into the
 * clip, drum quantize option 1 keeps every pad, other drum options stay on
 * the kit, and empty or duplicate options, or a copy of ORIG (already the
 * strip's first entry), are dropped before the preview. A Variation option
 * that breaks the source's role or is a clip of the track again is dropped
 * too (plans/2026-10-27-variation-eight-options.md). */

import { type AiNote, TICKS_PER_STEP } from './clip-dump.js';
import { optionCount } from './ladders.js';
import type { AiTask } from './prompt.js';
import { roleBreak, roleOf, saneNote } from './role.js';
import { isSameLoop, loopMatch, NEAR_DUP } from './same-loop.js';

export interface ValidateCtx {
    task: AiTask;
    len: number;            // steps
    drum: boolean;
    original: AiNote[];
    kitPads: number[];      // empty = do not filter
    units?: 'steps' | 'ticks';   // what the prompt asked for (prompt.ts); default ticks
    source?: AiNote[];      // Variation: the clip it grows from (its role is kept)
    loops?: AiNote[][];     // Variation: the track's clips no option may repeat
}

/** The surviving options, the ladder slot (0-based) each answered, and why
 *  the others were dropped (`<slot+1>:<why>`). */
export interface Validated { options: AiNote[][]; slots: number[]; dropped: string[] }

export const MAX_NOTES = 512;   // the engine's own cap (clip.rs MAX_NOTES)

/* The context names notes as `60:C3`, and gemini-flash-lite-latest sometimes
 * copies that into its pitches, which is not JSON. The number is what the
 * prompt asks for, so the name is dropped. Only tried after a failed parse:
 * a label could legitimately contain such text. */
const PITCH_NAME = /(\d+):[A-G][#b]?-?\d+/g;

function parseOptions(json: string): unknown[] | null {
    try {
        const v = JSON.parse(json);
        return Array.isArray(v?.options) ? v.options : [];
    } catch {
        return null;
    }
}

function parseReply(raw: string): unknown[] {
    const a = raw.indexOf('{');
    const b = raw.lastIndexOf('}');
    if (a < 0 || b <= a) return [];
    const json = raw.slice(a, b + 1);
    return parseOptions(json) ?? parseOptions(json.replace(PITCH_NAME, '$1')) ?? [];
}

function toNote(x: unknown, scale: number): AiNote | null {
    const a = Array.isArray(x) ? x : x && typeof x === 'object'
        ? [(x as AiNote).tick, (x as AiNote).gate, (x as AiNote).pitch, (x as AiNote).vel] : null;
    if (!a || a.length < 4 || !a.slice(0, 4).every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
    return { tick: Math.round(a[0] * scale), gate: Math.round(a[1] * scale), pitch: Math.round(a[2]), vel: Math.round(a[3]) };
}

function clampNote(n: AiNote, end: number): AiNote | null {
    if (n.tick < 0 || n.tick >= end) return null;
    return {
        tick: n.tick,
        gate: Math.min(Math.max(1, n.gate), end - n.tick),
        pitch: Math.min(127, Math.max(0, n.pitch)),
        vel: Math.min(127, Math.max(1, n.vel)),
    };
}

/** Option 1 of a drum quantize: a hit that left its pad goes back to the
 *  pad of the original hit nearest in time. */
function keepPads(notes: AiNote[], original: AiNote[]): AiNote[] {
    const pads = new Set(original.map((n) => n.pitch));
    return notes.map((n) => {
        if (pads.has(n.pitch) || !original.length) return n;
        const near = original.reduce((a, b) => (Math.abs(b.tick - n.tick) < Math.abs(a.tick - n.tick) ? b : a));
        return { ...n, pitch: near.pitch };
    });
}

function key(notes: AiNote[]): string {
    return notes.map((n) => `${n.tick}.${n.gate}.${n.pitch}.${n.vel}`).join(',');
}

export function validateReply(raw: string, ctx: ValidateCtx): Validated {
    const end = ctx.len * TICKS_PER_STEP;
    const kit = new Set(ctx.kitPads);
    const seen = new Set<string>([key([...ctx.original].sort((a, b) => a.tick - b.tick || a.pitch - b.pitch))]);
    const variation = ctx.task === 'variation';
    const role = variation && ctx.source ? roleOf(ctx.source, ctx.len, ctx.drum) : null;
    const loops = variation ? ctx.loops ?? (ctx.source ? [ctx.source] : []) : [];
    const out: Validated = { options: [], slots: [], dropped: [] };
    parseReply(raw).slice(0, optionCount(ctx.task)).forEach((opt, i) => {
        const list = (opt as { notes?: unknown })?.notes;
        const drop = (why: string) => { out.dropped.push(`${i + 1}:${why}`); };
        if (!Array.isArray(list)) return drop('no notes');
        let notes = list.map((x) => toNote(x, ctx.units === 'steps' ? TICKS_PER_STEP : 1)).filter((n): n is AiNote => n !== null)
            .map((n) => clampNote(n, end)).filter((n): n is AiNote => n !== null);
        if (ctx.drum && ctx.task === 'quantize' && i === 0) notes = keepPads(notes, ctx.original);
        else if (ctx.drum && kit.size) notes = notes.filter((n) => kit.has(n.pitch));
        const ref = variation ? ctx.source ?? [] : ctx.original;
        notes = notes.map((n) => saneNote(n, ref, ctx.drum)).filter((n): n is AiNote => n !== null)
            .sort((a, b) => a.tick - b.tick || a.pitch - b.pitch).slice(0, MAX_NOTES);
        const k = key(notes);
        if (!notes.length) return drop('empty');
        if (seen.has(k)) return drop('copy');
        const broke = role ? roleBreak(notes, role, ctx.len) : null;
        if (broke) return drop('role ' + broke);
        if (isSameLoop(notes, loops, ctx.len, ctx.drum)) return drop('same loop');
        if (variation && out.options.some((o) => loopMatch(notes, o, ctx.len, 'still') >= NEAR_DUP)) return drop('near copy');
        seen.add(k);
        out.options.push(notes);
        out.slots.push(i);
    });
    return out;
}

export function validateOptions(raw: string, ctx: ValidateCtx): AiNote[][] {
    return validateReply(raw, ctx).options;
}
