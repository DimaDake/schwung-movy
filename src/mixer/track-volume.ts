import { setChainParam } from '../chain/set-param.js';
import { portFor } from '../track/registry.js';
import { beginGesture } from '../undo/edit.js';
import { endEdit } from '../undo/group.js';
/* Hold a track button + turn the master volume knob → that track's schwung
 * chain-slot volume (`slot:volume`, 0–4 where 1.0 = unity).
 *
 * Two shim behaviours shape this module (both in schwung/src/schwung_shim.c):
 *
 * 1. The overtake input filter (:5696) hard-codes a passthrough for CC 79 and
 *    the master touch note, so Move firmware always sees the knob and would
 *    move *master* volume under us. `button_passthrough` can only un-block, so
 *    there is no way to hide it. Instead we change what Move does with the CC:
 *    injecting the track-hold Move never saw (movy owns CC 40-43 in overtake)
 *    makes Move route the turn to its own track volume, leaving master alone.
 *
 * 2. `shadow_swap_display()` (:3262) hands the OLED to Move for the duration of
 *    a volume-knob touch unless Shift is held, so the slider we draw is only
 *    visible in the Shift variant. Drawing is unconditional — without Shift the
 *    frame simply is not pushed to the panel.
 *
 * The injection fires on track-button **down**, not on knob touch. Move decides
 * what the volume knob targets at touch time, so a hold injected in response to
 * the touch arrives too late and the gesture moves the slot *and* master volume
 * together (observed on device). Pressing first also matches Move's own
 * ordering. The cost is that an ordinary track switch in movy now also moves
 * Move's selected track, which is invisible under overtake.
 */

import { mlog } from '../log.js';

export const MASTER_CC         = 79;   /* MoveMaster — raw relative encoder */
export const MASTER_TOUCH_NOTE = 8;    /* MoveMasterTouch (note 9 is the jog) */

/* schwung stores slot:volume as a linear amplitude, 0-4 with 1.0 = unity. A
 * fixed linear step is unusable as a fader: 0.05 is 0.1 dB near the top of the
 * range and 6 dB from 0.10 to 0.05, so the quiet half of the travel — the half
 * a mixer is actually used in — is five detents wide and the last one drops
 * straight to silence. Reported from the field as "it's adjustable down to
 * about -8.5 dB, then completely cuts off the sound".
 *
 * So the gesture walks a dB ladder instead and converts on write: one detent is
 * one dB anywhere in the range. Index 0 is true silence, index 1 is DB_MIN, and
 * unity lands exactly on index 49 — the same value the encoder can always
 * return to. */
const VOL_MIN  = 0;
const VOL_MAX  = 4;
const DB_MIN   = -48;   // quietest audible position; one step below it is silence
const DB_STEP  = 1;
const DB_MAX   = 20 * Math.log10(VOL_MAX);
const VOL_STEPS = Math.ceil((DB_MAX - DB_MIN) / DB_STEP) + 1;

function idxToAmp(i: number): number {
    if (i <= 0) return VOL_MIN;
    const db = DB_MIN + (Math.min(i, VOL_STEPS) - 1) * DB_STEP;
    return Math.min(VOL_MAX, Math.pow(10, db / 20));
}

function ampToIdx(a: number): number {
    if (a <= VOL_MIN) return 0;
    const db = 20 * Math.log10(a);
    if (db <= DB_MIN) return 1;
    return Math.min(VOL_STEPS, Math.round((db - DB_MIN) / DB_STEP) + 1);
}

/* Position on the ladder, 0..1 — the slider fill and its unity mark, so the
 * drawn travel matches what the knob does. */
function idxToFrac(i: number): number { return Math.min(1, Math.max(0, i / VOL_STEPS)); }
export function volumeFrac(amp: number): number { return idxToFrac(ampToIdx(amp)); }
const UNITY_FRAC = volumeFrac(1);

/* Track button CCs are reversed on the hardware: CC43 = track 1 → slot 0. */
function trackCc(track: number): number { return 43 - track; }

let heldTrack = -1;      /* track button physically held (-1 = none) */
let touched   = false;   /* master knob capacitive touch */
let volumeBefore: string | null = null;  /* volume at gesture start, for undo */
let diverted  = -1;      /* track whose hold we injected into Move (-1 = none) */
let value     = 1;       /* live slot:volume for the gesture in progress */
let volIdx    = ampToIdx(1);  /* its position on the dB ladder */

function injectHold(track: number, pressed: boolean): void {
    if (typeof move_midi_inject_to_move !== 'function') return;
    move_midi_inject_to_move([0x0B, 0xB0, trackCc(track), pressed ? 127 : 0]);
}

function readVolume(track: number): number {
    const raw = portFor(track).getParam( 'slot:volume');
    const v   = raw === null ? NaN : parseFloat(raw);
    return Number.isFinite(v) ? Math.min(VOL_MAX, Math.max(VOL_MIN, v)) : 1;
}

/* Take the gesture: tell Move a track is held so its volume knob stops driving
 * master, and snapshot the value we are about to move.
 *
 * This MUST happen on track-button down, before the knob is touched. Move
 * decides what the volume knob targets when the touch arrives, so a track-hold
 * injected in response to the touch lands too late — Move has already entered
 * master-volume mode and the gesture moves both volumes at once. Injecting on
 * the press reproduces the native order: hold the track, then touch the knob. */
function beginDivert(): void {
    if (diverted >= 0 || heldTrack < 0) return;
    diverted = heldTrack;
    value    = readVolume(heldTrack);
    /* The gesture already has explicit start/end points, so they double as the
     * undo group's — no touch plumbing needed. */
    volumeBefore = value.toFixed(4);
    volIdx   = ampToIdx(value);
    injectHold(heldTrack, true);
    mlog('trackvol arm t=' + heldTrack + ' read=' + value.toFixed(2));
}

function endDivert(): void {
    if (diverted < 0) return;
    injectHold(diverted, false);
    endEdit('vol:' + diverted);
    diverted = -1;
    volumeBefore = null;
}

export function volumeTrackDown(track: number): void {
    heldTrack = track;
    beginDivert();
}

export function volumeTrackUp(track: number): void {
    if (heldTrack !== track) return;
    heldTrack = -1;
    endDivert();
}

export function volumeTouch(on: boolean): void {
    touched = on;
}

/* CC 79 is outside the 71-78 range shadow_ui re-encodes and accumulates, so it
 * arrives raw: 1-63 clockwise, 65-127 counter-clockwise. Returns true when the
 * turn was consumed as a track-volume edit (a track is held); false leaves the
 * knob to Move as ordinary master volume. */
export function volumeKnobDelta(d2: number): boolean {
    if (heldTrack < 0) return false;
    beginDivert();   /* touch note may be missed; the turn itself arms us */
    const delta = d2 >= 1 && d2 <= 63 ? d2 : d2 >= 65 ? d2 - 128 : 0;
    if (delta === 0) return true;
    volIdx = Math.min(VOL_STEPS, Math.max(0, volIdx + delta));
    value  = idxToAmp(volIdx);
    /* Four decimals, not two: the bottom of a dB fader lives below 0.01, and
     * rounding it to 2 dp would collapse the quietest ~20 dB back into silence. */
    beginGesture('vol:' + heldTrack, 'VOLUME', 'T' + (heldTrack + 1), false);
    setChainParam(portFor(heldTrack), 'slot:volume', value.toFixed(4), volumeBefore);
    mlog('trackvol t=' + heldTrack + ' d=' + delta + ' v=' + value.toFixed(4));
    return true;
}

/* The slider to draw, or null when no gesture is live. `frac`/`unityFrac` are
 * ladder positions so the renderer stays free of the dB mapping. */
export function volumeOverlay():
    { track: number; value: number; frac: number; unityFrac: number } | null {
    if (heldTrack < 0 || !touched) return null;
    return { track: heldTrack, value, frac: idxToFrac(volIdx), unityFrac: UNITY_FRAC };
}

export function resetTrackVolume(): void {
    heldTrack = -1;
    touched   = false;
    volumeBefore = null;
    diverted  = -1;
    value     = 1;
    volIdx    = ampToIdx(1);
}
