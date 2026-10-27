/* The model is never trusted (design §6.3): every option is clamped into the
 * clip, drum quantize option 1 keeps every pad, other drum options stay on
 * the kit, and empty or duplicate options are dropped before the preview. */

import { type AiNote, TICKS_PER_STEP } from './clip-dump.js';
import type { AiTask } from './prompt.js';

export interface ValidateCtx {
    task: AiTask;
    len: number;            // steps
    drum: boolean;
    original: AiNote[];
    kitPads: number[];      // empty = do not filter
}

export const MAX_NOTES = 512;   // the engine's own cap (clip.rs MAX_NOTES)

function parseReply(raw: string): unknown[] {
    const a = raw.indexOf('{');
    const b = raw.lastIndexOf('}');
    if (a < 0 || b <= a) return [];
    try {
        const v = JSON.parse(raw.slice(a, b + 1));
        return Array.isArray(v?.options) ? v.options : [];
    } catch {
        return [];
    }
}

function toNote(x: unknown): AiNote | null {
    const a = Array.isArray(x) ? x : x && typeof x === 'object'
        ? [(x as AiNote).tick, (x as AiNote).gate, (x as AiNote).pitch, (x as AiNote).vel] : null;
    if (!a || a.length < 4 || !a.slice(0, 4).every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
    return { tick: Math.round(a[0]), gate: Math.round(a[1]), pitch: Math.round(a[2]), vel: Math.round(a[3]) };
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

export function validateOptions(raw: string, ctx: ValidateCtx): AiNote[][] {
    const end = ctx.len * TICKS_PER_STEP;
    const kit = new Set(ctx.kitPads);
    const seen = new Set<string>();
    const out: AiNote[][] = [];
    parseReply(raw).slice(0, 3).forEach((opt, i) => {
        const list = (opt as { notes?: unknown })?.notes;
        if (!Array.isArray(list)) return;
        let notes = list.map(toNote).filter((n): n is AiNote => n !== null)
            .map((n) => clampNote(n, end)).filter((n): n is AiNote => n !== null);
        if (ctx.drum && ctx.task === 'quantize' && i === 0) notes = keepPads(notes, ctx.original);
        else if (ctx.drum && kit.size) notes = notes.filter((n) => kit.has(n.pitch));
        notes = notes.sort((a, b) => a.tick - b.tick || a.pitch - b.pitch).slice(0, MAX_NOTES);
        const k = key(notes);
        if (!notes.length || seen.has(k)) return;
        seen.add(k);
        out.push(notes);
    });
    return out;
}
