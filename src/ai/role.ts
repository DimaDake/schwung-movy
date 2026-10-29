/* What part a clip plays (plans/2026-10-27-variation-eight-options.md). A
 * Variation keeps it: a drone never comes back as a melody, chords never as an
 * arpeggio. Measured on the source and checked on every option (gen/guard.ts). */

import { type AiNote, TICKS_PER_STEP, STEPS_PER_BAR } from './clip-dump.js';

export type RoleKind = 'drone' | 'pad' | 'stabs' | 'bass' | 'arpeggio' | 'lead' | 'drums';

export interface Role {
    kind: RoleKind;
    onsets: number;
    perBar: number;
    voices: number;      // notes per onset
    lenSteps: number;    // median note length
    lo: number;
    hi: number;
    mid: number;         // median pitch
}

/* A played chord is rarely struck at one tick (the device Set's dexed pad
 * spread its notes over 8 ticks): notes within half a step are one onset. */
const SPREAD = TICKS_PER_STEP / 2;
const POLY = 1.7;
const MONO = 1.4;
const LONG = 8;          // steps: a note this long is held, not played
const BASS_TOP = 55;     // median pitch below G2 (60 = C3) reads as bass

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

function onsetCount(notes: AiNote[]): number {
    let n = 0;
    let start = -Infinity;
    for (const x of [...notes].sort((a, b) => a.tick - b.tick)) {
        if (x.tick - start > SPREAD) { n++; start = x.tick; }
    }
    return n;
}

function kindOf(r: Omit<Role, 'kind'>): RoleKind {
    if (r.voices >= POLY) return r.lenSteps >= LONG ? 'pad' : 'stabs';
    if (r.mid < BASS_TOP) return 'bass';
    if (r.lenSteps >= LONG && r.perBar <= 1.5) return 'drone';
    if (r.perBar >= 8 && r.lenSteps <= 2) return 'arpeggio';
    return 'lead';
}

export function roleOf(notes: AiNote[], lenSteps: number, drum: boolean): Role | null {
    if (!notes.length) return null;
    const onsets = onsetCount(notes);
    const pitches = notes.map((n) => n.pitch);
    const r = { onsets, perBar: onsets / Math.max(1, lenSteps / STEPS_PER_BAR), voices: notes.length / onsets,
        lenSteps: median(notes.map((n) => n.gate)) / TICKS_PER_STEP,
        lo: Math.min(...pitches), hi: Math.max(...pitches), mid: median(pitches) };
    return { kind: drum ? 'drums' : kindOf(r), ...r };
}

/** How many onsets an option may have: half to double the source's, and a
 *  held part (a drone or pad) up to one per bar, since one note held across
 *  four bars moving once a bar is still a drone. */
export function onsetRange(src: Role, lenSteps: number, slack = 1): [number, number] {
    const held = src.kind !== 'drums' && src.lenSteps >= LONG ? Math.ceil(lenSteps / STEPS_PER_BAR) : 0;
    return [Math.max(1, Math.floor(src.onsets / (2 * slack))), Math.max(2, Math.ceil(src.onsets * 2 * slack), held)];
}

/** Why an option is no longer the source's part, or null when it still is. */
export function roleBreak(notes: AiNote[], src: Role, lenSteps: number, slack = 1): string | null {
    const r = roleOf(notes, lenSteps, src.kind === 'drums');
    if (!r) return 'empty';
    const [lo, hi] = onsetRange(src, lenSteps, slack);
    if (r.onsets < lo || r.onsets > hi) return 'onsets';
    if (src.kind === 'drums') return null;
    if (src.voices >= POLY ? r.voices < MONO : src.voices < MONO && r.voices >= POLY) return 'voices';
    if (src.lenSteps >= LONG ? r.lenSteps < src.lenSteps * 0.4 : r.lenSteps > Math.max(LONG, src.lenSteps * 3)) return 'lengths';
    if (Math.abs(r.mid - src.mid) > 12) return 'register';
    return null;
}
