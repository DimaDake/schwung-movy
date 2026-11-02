/* Where each knob sits on Move's eight (plans/2026-11-01-generator-ux-design.md
 * §2.1, §4): slots have roles — 1 WHAT, 2 HOW MUCH, 3 HARMONY (drums: the
 * second idea), 4 WHERE, 5 LENGTH, 6 EXTRA, 7 FLAVOUR, 8 OVER TIME — so a
 * hand learns slots, not lists. A preset's own knob order is its generate()
 * contract and stays as it is; this table is the view of it. `null` is a
 * dark slot. Copied from the design's §4 "After" lines. */

import type { Preset } from './preset.js';

type Row = (string | null)[];
const _ = null;

export const LAYOUTS: Record<string, Row> = {
    // Variation, melodic
    'v-next': ['RHYTHM', 'DENSITY', 'HARMONY', 'RANGE', 'LENGTH', 'VOICES', 'COLOUR', 'CHORD RATE'],
    'v-follow': ['DIRECTION', 'DENSITY', 'HARMONY', 'VOICES', 'LENGTH', 'RHYTHM', 'COLOUR', 'CHORD RATE'],
    'v-pulse': ['NOTE', 'DENSITY', 'HARMONY', 'OCTAVE', 'LENGTH', 'DYNAMICS', 'RHYTHM', 'CHORD RATE'],
    'v-harmonize': ['INTERVAL', 'AMOUNT', 'HARMONY', _, _, _, 'COLOUR', 'DRIFT'],
    'v-revoice': ['SPREAD', 'AMOUNT', 'HARMONY', 'SPLIT', 'TOP', 'RANGE', 'COLOUR', 'SEED'],
    'v-newline': ['STEP', 'DENSITY', 'HARMONY', 'CHORD RATE', 'LENGTH', 'RHYTHM', 'COLOUR', 'SEED'],
    'v-answer': ['SPLIT', 'DENSITY', 'HARMONY', 'STEP', 'LENGTH', 'RHYTHM', 'COLOUR', 'CHORD RATE'],
    'v-arp': ['PATTERN', 'RATE', 'HARMONY', 'OCTAVES', _, _, _, 'DRIFT'],
    'v-hold': ['NOTE', 'AMOUNT', 'HARMONY', 'RANGE', 'LENGTH', 'DRIFT', 'SHARED', 'SEED'],
    'v-bassline': ['PATTERN', 'NOTES', 'HARMONY', 'OCTAVE', 'LENGTH', 'DYNAMICS', 'SHIFT', 'CHORD RATE'],
    'v-displace': ['MODE', 'AMOUNT', 'HARMONY', 'SHIFT', 'LENGTH', 'DRIFT', 'COLOUR', 'SEED'],
    'v-connect': [_, 'AMOUNT', 'HARMONY', _, 'LENGTH', 'DRIFT', 'COLOUR', 'SEED'],
    'v-recombine': ['DIM', 'AMOUNT', 'HARMONY', 'ROTATE', _, 'DRIFT', _, 'SEED'],
    'v-euclid': ['PULSES', _, 'HARMONY', 'ROTATE', 'LENGTH', _, _, 'DRIFT'],
    'v-comp': ['PATTERN', 'VOICES', 'HARMONY', 'RANGE', 'LENGTH', 'DYNAMICS', 'COLOUR', 'CHORD RATE'],
    'v-walk': [_, 'DENSITY', 'HARMONY', 'AMOUNT', _, 'DRIFT', 'COLOUR', 'SEED'],
    'v-thin': [_, 'AMOUNT', 'HARMONY', 'RANGE', 'LENGTH', 'DRIFT', _, 'SEED'],
    'v-motif': ['CELL', _, 'HARMONY', 'STEP', _, _, 'COLOUR', 'DRIFT'],
    'v-retro': ['SPAN', 'AMOUNT', 'HARMONY', 'RANGE', _, 'DRIFT', _, 'SEED'],
    'v-halftime': ['SPEED', _, 'HARMONY', 'FROM', 'LENGTH', _, _, 'DRIFT'],
    'v-ornament': ['KIND', 'AMOUNT', 'HARMONY', _, _, 'DRIFT', 'COLOUR', 'SEED'],
    'v-develop': ['RHYTHM', 'AMOUNT', 'HARMONY', 'RANGE', 'DENSITY', 'CHORD RATE', 'COLOUR', 'SEED'],
    'v-style': ['PHRASE', 'LIKENESS', 'HARMONY', 'RANGE', 'DENSITY', 'CHORD RATE', 'COLOUR', 'SEED'],
    'v-looper': ['LOOP', 'LOCK', 'HARMONY', 'SPREAD', 'CLOCK', 'DENSITY', 'COLOUR', 'SEED'],
    'v-form': ['FORM', 'UNIT', 'HARMONY', 'RANGE', 'LENGTH', 'STEP', 'COLOUR', 'ANSWER'],
    // Variation, drums
    'd-kick': ['STYLE', 'AMOUNT', _, 'BARS', _, 'DRIFT', _, 'SEED'],
    'd-hats': ['RATE', 'OPEN', _, _, _, _, 'DYNAMICS', 'DRIFT'],
    'd-ghosts': ['LEVEL', 'COUNT', _, 'PAD', _, 'DRIFT', _, 'SEED'],
    'd-fill': ['SIZE', 'DENSITY', 'PADS', 'WHERE', _, 'DRIFT', 'DYNAMICS', 'SEED'],
    'd-shift': ['STEPS', 'AMOUNT', _, 'PAD', _, 'DRIFT', _, 'SEED'],
    'd-feel': ['MODE', 'AMOUNT', _, _, _, 'DRIFT', 'DYNAMICS', 'SEED'],
    'd-grids': ['X', 'Y', 'SNARE', 'KICK', 'HATS', 'CHAOS', 'DYNAMICS', 'SEED'],
    'd-develop': ['FILL', 'AMOUNT', 'SHIFT', 'GHOSTS', 'DENSITY', 'ACCENT', 'HATS', 'SEED'],
    'd-style': ['PHRASE', 'LIKENESS', 'DENSITY', _, _, 'DRIFT', _, 'SEED'],
    'd-form': ['FORM', 'UNIT', 'ANSWER', _, _, _, 'DYNAMICS', 'DRIFT'],
    // Smart Quantize
    'q-tight': ['TIMING', 'DENSITY', 'FIX NOTES', 'GRID', 'LENGTH', 'VELOCITY', 'CLEAN', 'FEEL'],
    'q-shaped': ['TIMING', 'DENSITY', 'FIX NOTES', 'VOICING', 'LENGTH', _, _, _],
    'q-embellish': ['TIMING', 'AMOUNT', 'FIX NOTES', 'KIND', _, _, _, 'SEED'],
    'q-answer': ['TIMING', 'DENSITY', 'FIX NOTES', 'SPLIT', 'LENGTH', 'DYNAMICS', 'RHYTHM', 'STEP'],
    'q-mutate': ['TIMING', 'AMOUNT', _, 'STEPS', _, _, _, 'SEED'],
    'q-mode': ['TIMING', _, 'MODE', 'WHERE', _, 'DYNAMICS', 'PIVOT', _],
    'q-octaves': ['TIMING', 'AMOUNT', _, 'DIRECTION', _, _, _, 'SEED'],
    'q-ratchet': ['TIMING', 'AMOUNT', _, 'RATE', 'DECAY', _, _, _],
    'q-shift': ['TIMING', 'DENSITY', _, 'STEPS', 'LENGTH', _, 'KEEP', _],
    'q-humanize': ['LOOSE', _, _, _, 'LENGTH', _, 'VELOCITY', 'SEED'],
    'qd-tight': ['TIMING', 'DENSITY', 'CLEAN', 'GRID', _, 'VELOCITY', _, 'FEEL'],
    'qd-ghosts': ['TIMING', 'COUNT', 'LEVEL', _, _, _, _, 'SEED'],
    'qd-fill': ['TIMING', 'DENSITY', _, 'SIZE', _, _, _, 'SEED'],
    'qd-mutate': ['TIMING', 'AMOUNT', 'MOVE', _, _, _, _, 'SEED'],
    'qd-ratchet': ['TIMING', 'AMOUNT', 'RATE', 'PAD', _, _, _, _],
    'qd-humanize': ['LOOSE', _, _, _, 'LENGTH', _, 'VELOCITY', 'SEED'],
    // Smart Double
    'x-turnaround': ['MOVE', _, _, _, 'ENDING', 'SEAMS', 'COLOUR', 'DRIFT'],
    'x-cadence': ['LAND', _, _, _, 'ENDING', 'SEAMS', 'HOLD', 'DRIFT'],
    'x-push': ['PUSH', _, _, _, 'ENDING', 'SEAMS', 'ACCENT', 'DRIFT'],
    'x-run': ['RATE', 'NOTES', _, 'DIRECTION', 'ENDING', _, _, 'DRIFT'],
    'x-echo': ['STEP', _, _, 'FROM', 'ENDING', 'SEAMS', _, 'DRIFT'],
    'x-style': [_, 'LIKENESS', _, _, 'ENDING', 'DRIFT', 'DENSITY', 'SEED'],
    'x-stop': ['KIND', _, _, _, 'ENDING', 'SEAMS', 'PICKUP', 'DRIFT'],
    'x-evolve': ['MOVE', 'RHYTHM', 'PHRASES', 'RANGE', _, _, 'COLOUR', 'DRIFT'],
    'xd-fill': ['HITS', 'DENSITY', 'PADS', 'PUSH', 'ENDING', 'SEAMS', 'DRIFT', 'SEED'],
    'xd-roll': ['RATE', _, _, _, 'ENDING', 'SEAMS', 'CRESC', 'DRIFT'],
    'xd-repeat': ['GRAIN', _, _, _, 'ENDING', 'SEAMS', 'DECAY', 'DRIFT'],
    'xd-break': ['KEEP', _, _, _, 'ENDING', 'SEAMS', 'PICKUP', 'DRIFT'],
    'xd-style': [_, 'LIKENESS', 'DENSITY', _, 'ENDING', 'DRIFT', _, 'SEED'],
    // New Clip
    'n-chords': ['PATTERN', 'DENSITY', 'HARMONY', 'REGISTER', 'GATE', 'SPACE', 'VOICING', 'DRIFT'],
    'n-pad': ['PATTERN', 'VOICING', 'HARMONY', 'REGISTER', 'GATE', 'SPACE', 'STRUM', 'DRIFT'],
    'n-stabs': ['PATTERN', 'DENSITY', 'HARMONY', 'REGISTER', 'GATE', 'SPACE', 'VOICING', 'DRIFT'],
    'n-bass': ['PATTERN', 'NOTES', 'HARMONY', 'OCTAVE', 'GATE', 'SPACE', 'DYNAMICS', 'DRIFT'],
    'n-arp': ['STYLE', 'RATE', 'HARMONY', 'OCTAVES', 'GATE', 'SPACE', 'DYNAMICS', 'DRIFT'],
    'n-melody': ['CONTOUR', 'DENSITY', 'HARMONY', 'RANGE', 'GATE', 'SPACE', 'DRIFT', 'SEED'],
    'n-riff': ['CELL', 'NOTES', 'HARMONY', 'REGISTER', 'GATE', 'SPACE', 'DRIFT', 'SEED'],
    'n-counter': ['RATE', 'DENSITY', 'HARMONY', 'REGISTER', 'GATE', 'SPACE', 'DRIFT', 'SEED'],
    'n-pad-euclid': ['DENSITY', 'ROTATE', 'ACCENT', 'RATE', 'HUMAN', _, 'DYNAMICS', 'DRIFT'],
    'n-pad-pattern': ['DENSITY', 'STYLE', 'FILL', _, 'HUMAN', 'DRIFT', 'DYNAMICS', 'SEED'],
    'n-drum-map': ['GROOVE', 'KICK', 'SNARE', 'HATS', 'HUMAN', 'FILL', 'DYNAMICS', 'SEED'],
    'n-euclid-kit': ['KICK', 'SNARE', 'SHIFT', 'HATS', 'HUMAN', _, 'DYNAMICS', 'DRIFT'],
    'n-broken': ['SYNC', 'DENSITY', 'GHOSTS', _, 'HUMAN', 'DRIFT', 'DYNAMICS', 'SEED'],
    'n-perc': [_, 'DENSITY', 'ACCENT', 'PADS', 'HUMAN', 'DRIFT', 'DYNAMICS', 'SEED'],
};

/** Knobs a preset has that sit in no slot, played at their default (§4 ⚑). */
export const DROPPED: Record<string, string[]> = {};

/** The roles a knob name always takes (§2.1); names not here sit by the table. */
export const ROLE: Record<string, number> = { TIMING: 1, HARMONY: 3, GATE: 5, ENDING: 5, HUMAN: 5, SPACE: 6, SEAMS: 6, COLOUR: 7, SEED: 8 };

/** Knob names a preset places off their role (each a §4 call). */
export const EXCEPT: Record<string, string[]> = {};

/** The index into `p.knobs` of the knob in hardware slot `slot` (0-based), or null. */
export function slotKnob(p: Preset, slot: number): number | null {
    const name = LAYOUTS[p.id]?.[slot];
    if (name === undefined) return slot < p.knobs.length ? slot : null;
    if (name === null) return null;
    const i = p.knobs.findIndex((k) => k.name === name);
    return i >= 0 ? i : null;
}

/** The hardware slot (0-based) a preset knob sits in, or null when it sits in none. */
export function knobSlot(p: Preset, i: number): number | null {
    for (let s = 0; s < 8; s++) if (slotKnob(p, s) === i) return s;
    return null;
}
