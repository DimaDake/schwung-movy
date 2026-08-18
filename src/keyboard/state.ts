/* Melodic keyboard state. `rootPc` (the tonic) and the per-track `octave` are
 * deliberately separate: with the chromatic root on column 4 the bottom-left
 * pad is no longer the tonic, so a single absolute "root note" can no longer
 * mean both the musical root and the layout origin. */

import { TRACK_COUNT } from '../track/ref.js';
import { buildPadMap } from './layouts.js';

export const OCT_MIN = 0;
export const OCT_MAX = 8;   // base 96 + the tallest layout's reach stays < 127

export const keyboardState = {
    rootPc: 0,                /* 0..11 tonic pitch class          (global) */
    scale:  0,                /* index into SCALES                (global) */
    mode:   0,                /* MODE_CHROMATIC | MODE_IN_KEY     (global) */
    layout: 0,                /* index into layoutNames(mode)     (global) */
    octave: new Array(TRACK_COUNT).fill(4) as number[],  /* per-track; 4 → C3 */
    /* most recent pad-played MIDI note — the sequencer's step-entry value */
    lastPlayedNote: 60,
};

/* Every track back to the C3 default. It exists so no caller writes the array
 * out by hand: `baseNoteFor` indexes it directly, so one that is shorter than
 * TRACK_COUNT yields `undefined` -> a NaN base -> a NaN pitch, and NaN fails
 * both of buildPadMap's range tests, so Int16Array stores 0. That is silent:
 * the tracks past the end play MIDI note 0 and paint every pad the root colour
 * instead of failing. */
export function resetOctaves(): void {
    keyboardState.octave = new Array(TRACK_COUNT).fill(4) as number[];
}

export function baseNoteFor(track: number): number {
    return keyboardState.octave[track & (TRACK_COUNT - 1)] * 12 + keyboardState.rootPc;
}

/* One-entry cache keyed by everything buildPadMap reads. Only the active
 * track's pads are ever drawn or played, and the LED loop asks for the map on
 * every tick (~205 Hz) — rebuilding 32 entries each time would be waste. The
 * key is the base note rather than the track, so two tracks on the same octave
 * legitimately share one map. */
let cacheKey = '';
let cacheMap: Int16Array | null = null;
let builds = 0;

export function padMapFor(track: number): Int16Array {
    const base = baseNoteFor(track);
    const key = keyboardState.mode + ':' + keyboardState.layout + ':' +
                keyboardState.scale + ':' + base;
    if (cacheMap === null || key !== cacheKey) {
        cacheKey = key;
        cacheMap = buildPadMap(keyboardState.mode, keyboardState.layout, keyboardState.scale, base);
        builds++;
    }
    return cacheMap;
}

/** Test hook: how many times the map has actually been rebuilt. */
export function padMapBuildCount(): number { return builds; }

/** Test hook: drop the cache so a following build is guaranteed. */
export function resetPadMapCache(): void { cacheKey = ''; cacheMap = null; }
