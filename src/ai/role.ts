/* What part a clip plays (plans/2026-10-27-variation-eight-options.md). A
 * Variation keeps it: a drone never comes back as a melody, chords never as an
 * arpeggio. Measured here, stated in the prompt, and checked on every reply
 * (validate.ts), because the model ignored the prompt's note-count rule. */

import { type AiNote, TICKS_PER_STEP, STEPS_PER_BAR } from './clip-dump.js';
import { pcName } from './harmony.js';

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

const NAMES: Record<RoleKind, string> = {
    drone: 'a drone (long held notes)', pad: 'sustained chords (a pad)', stabs: 'chord stabs', bass: 'a bass line',
    arpeggio: 'an arpeggio (a fast single-note line)', lead: 'a melody line', drums: 'a drum pattern',
};

const f1 = (v: number) => String(Math.round(v * 10) / 10);
const note = (p: number) => `${p}:${pcName(p)}${Math.floor(p / 12) - 2}`;

/** How many onsets an option may have: half to double the source's, and a
 *  held part (a drone or pad) up to one per bar, since one note held across
 *  four bars moving once a bar is still a drone (live reply 2026-10-27). */
export function onsetRange(src: Role, lenSteps: number): [number, number] {
    const held = src.kind !== 'drums' && src.lenSteps >= LONG ? Math.ceil(lenSteps / STEPS_PER_BAR) : 0;
    return [Math.max(1, Math.floor(src.onsets / 2)), Math.max(2, Math.ceil(src.onsets * 2), held)];
}

export function roleText(r: Role, lenSteps: number): string {
    const [lo, hi] = onsetRange(r, lenSteps);
    if (r.kind === 'drums') {
        return `ROLE: the [SOURCE] clip is a drum pattern with ${r.onsets} hits. Every option keeps this role: `
            + `${lo} to ${hi} hits, the same kit.`;
    }
    return `ROLE: the [SOURCE] clip is ${NAMES[r.kind]}: ${r.onsets} onsets, ${f1(r.voices)} notes at once, `
        + `notes held about ${f1(r.lenSteps)} steps, register ${note(r.lo)} to ${note(r.hi)}. Every option keeps this role: `
        + `the same kind of part, ${lo} to ${hi} onsets, about as many notes at once, similar note lengths, the same `
        + 'register. Never turn chords into single notes or an arpeggio, a held note into a melody, or a line into chords.';
}

/** Why an option is no longer the source's part, or null when it still is. */
export function roleBreak(notes: AiNote[], src: Role, lenSteps: number): string | null {
    const r = roleOf(notes, lenSteps, src.kind === 'drums');
    if (!r) return 'empty';
    const [lo, hi] = onsetRange(src, lenSteps);
    if (r.onsets < lo || r.onsets > hi) return 'onsets';
    if (src.kind === 'drums') return null;
    if (src.voices >= POLY ? r.voices < MONO : src.voices < MONO && r.voices >= POLY) return 'voices';
    if (src.lenSteps >= LONG ? r.lenSteps < src.lenSteps * 0.4 : r.lenSteps > Math.max(LONG, src.lenSteps * 3)) return 'lengths';
    if (Math.abs(r.mid - src.mid) > 12) return 'register';
    return null;
}

/** A note the model plainly garbled (a pitch copied into the length, a
 *  velocity into the pitch: live reply 2026-10-27 held a bass note for 52
 *  steps): far outside the source's register is dropped (null), far longer
 *  than its longest note is cut back. Drums keep their pads (validate.ts). */
export function saneNote(n: AiNote, src: AiNote[], drum: boolean): AiNote | null {
    if (!src.length) return n;
    const longest = Math.max(...src.map((x) => x.gate));
    const gate = Math.min(n.gate, Math.max(4 * longest, 4 * TICKS_PER_STEP));
    if (drum) return { ...n, gate };
    const lo = Math.min(...src.map((x) => x.pitch));
    const hi = Math.max(...src.map((x) => x.pitch));
    return n.pitch < lo - 24 || n.pitch > hi + 24 ? null : { ...n, gate };
}
