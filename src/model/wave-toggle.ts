/* Binary "is this waveform sounding?" switches — OB-Xd's per-oscillator Saw and
 * Pulse, its three LFO shape toggles, hush1's White Noise, Surge's Noise Mute.
 * They render as the waveform's silhouette (solid on, dotted off) instead of an
 * on/off bar, which carries no shape information at all.
 *
 * The word → glyph mapping is shapeId()'s, not a second table: 'saw', 'pulse',
 * 'square', 'sin' and 'sh' already resolve there.
 * Pure: indices only, no rendering. */

import type { KnobParam } from '../types/param.js';
import { shapeId } from './lfo-shapes.js';

export interface WaveToggle {
    shape: number;
    invert: boolean;   // true when the ON value means SILENT (a Mute)
}

/* Words that state the param's ROLE, never its shape. Stripped before the
 * shape lookup because several of them are themselves glyph names — 'off' maps
 * to the flat line, so "saw_off" would resolve to flat instead of saw. */
const ROLE = new Set(['on', 'off', 'enable', 'enabled', 'en', 'active', 'use',
    'sw', 'switch', 'mute', 'muted', 'osc', 'osc1', 'osc2', 'osc3', 'lfo',
    'white', 'pink', 'brown', 'mode', 'type', 'select', 'toggle']);

/* A waveform toggle names a shape and nothing else that changes its meaning.
 * "Sub Octave Down" is an octave switch that happens to say Sub; a pitch or
 * range word means the toggle is about frequency, not about which shape sounds. */
const NOT_A_SHAPE_ROLE =
    /^(octave|oct|pitch|range|tune|detune|sync|quantize|trig|trigger|retrig|key|keytrack)$/;

/* Words that resolve to a glyph but never mean "this waveform sounds":
 *   rnd/random — a randomiser is an action, not the thing it names (the same
 *     rule step-labels.ts applies), and 'rnd' maps to the smooth-random glyph,
 *     so "Randomise Preset" would otherwise draw as a waveform switch.
 *   ring — names a modulator PAIR, not a shape. Surge mutes Ring 1x2 and
 *     Ring 2x3 separately, and both would draw the identical ring glyph. */
const NEVER_A_WAVEFORM = /^(rnd|random|randomize|randomise|ring)$/;

const words = (text: string): string[] =>
    text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);

/* Binary in the sense that matters here: exactly two states, so the cell can be
 * "sounding" or "not". Covers both spellings modules use. */
function isBinary(p: KnobParam): boolean {
    if (p.type === 'int') return p.min === 0 && p.max === 1;
    if (p.type === 'enum') {
        return (p.options?.length === 2)
            && /^(off|no|disabled)$/i.test(p.options[0] ?? '');
    }
    return false;
}

export function waveToggleOf(p: KnobParam): WaveToggle | null {
    if (!isBinary(p)) return null;
    const ws = [...words(p.key), ...words(p.label)];
    if (ws.some((w) => NOT_A_SHAPE_ROLE.test(w) || NEVER_A_WAVEFORM.test(w))) return null;

    /* Exactly one distinct shape must be named. Two would make the silhouette a
     * guess about which one the switch controls. */
    const shapes = new Set<number>();
    for (const w of ws) {
        if (ROLE.has(w)) continue;
        const id = shapeId(w);
        if (id !== null) shapes.add(id);
    }
    if (shapes.size !== 1) return null;

    /* A Mute reads the other way round: its ON value is the silent one. */
    const invert = ws.some((w) => w === 'mute' || w === 'muted');
    return { shape: [...shapes][0], invert };
}

/* Cells on a page that draw a waveform toggle, with the shape and sense each
 * one needs. Skips anything an envelope/LFO/filter graphic already draws. */
export function waveToggleCells(
    params: (KnobParam | null)[], claimed: Set<number>,
): Map<number, WaveToggle> {
    const out = new Map<number, WaveToggle>();
    params.forEach((p, i) => {
        if (!p || claimed.has(i)) return;
        const t = waveToggleOf(p);
        if (t) out.set(i, t);
    });
    return out;
}

