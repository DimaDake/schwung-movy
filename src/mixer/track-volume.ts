import { setChainParam } from '../chain/set-param.js';
import { portFor } from '../track/registry.js';
import { trackKind } from '../track/ref.js';
import { beginGesture } from '../undo/edit.js';
import { endEdit } from '../undo/group.js';
/* Hold a track button + turn the master volume knob → that track's schwung
 * chain-slot volume (`slot:volume`, 0–4 where 1.0 = unity).
 *
 * Two shim behaviours shape this module (both in schwung/src/schwung_shim.c).
 * Which one applies depends on whether the running schwung build has
 * `shadow_set_overtake_suppress_master_volume` (2026-08-24 fork PR — absent in
 * older shims, guard with `typeof`):
 *
 * - **New schwung (capability present)**: setting the flag for the duration of
 *   the gesture suppresses CC 79 and the master-touch note from Move firmware
 *   entirely (both the hardcoded passthrough and the plain-volume-touch OLED
 *   handoff in shadow_swap_display()), so Move is excluded and our own slider
 *   overlay always shows — Shift no longer matters.
 *
 * - **Old schwung (capability absent)**: the overtake input filter hard-codes
 *   a passthrough for CC 79 and the master touch note, so Move firmware always
 *   sees the knob and would move *master* volume under us; there is no way to
 *   hide it. Instead we change what Move does with the CC: injecting the
 *   track-hold Move never saw (movy owns CC 40-43 in overtake) makes Move
 *   route the turn to its own track volume, leaving master alone. And
 *   `shadow_swap_display()` hands the OLED to Move for the duration of a
 *   volume-knob touch unless Shift is held, so the slider we draw is only
 *   visible in the Shift variant — drawing is unconditional, but without Shift
 *   the frame simply is not pushed to the panel.
 *
 *   The injection fires on track-button **down**, not on knob touch. Move
 *   decides what the volume knob targets at touch time, so a hold injected in
 *   response to the touch arrives too late and the gesture moves the slot
 *   *and* master volume together (observed on device). Pressing first also
 *   matches Move's own ordering. The cost is that an ordinary track switch in
 *   movy now also moves Move's selected track, which is invisible under
 *   overtake.
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

/* New-schwung path: ask the shim to exclude Move from the gesture entirely
 * instead of fooling it with injectHold. Absent on a pre-merge shim — see the
 * module header. */
function setMoveExcluded(excluded: boolean): void {
    if (typeof shadow_set_overtake_suppress_master_volume !== 'function') return;
    shadow_set_overtake_suppress_master_volume(excluded ? 1 : 0);
}

/* Where a track's level lives.
 *
 * A host track's is schwung's `slot:volume` — a chain-host param Move's own
 * mixer also sees. A movy track has no schwung slot and no Move fader, so movy
 * keeps its level itself and applies it in the summing mixer (design §5.4).
 * Same gesture, same dB ladder, different destination. */
function volumeKey(track: number): string {
    return trackKind(track) === 'movy' ? 'mix' : 'slot:volume';
}

function readVolume(track: number): number {
    if (trackKind(track) === 'movy') {
        /* "gain,pan,muted" — only the gain is on the fader. */
        const raw = portFor(track).getParam('mix');
        const g = raw === null ? NaN : parseFloat(raw.split(',')[0]);
        return Number.isFinite(g) ? Math.min(VOL_MAX, Math.max(VOL_MIN, g)) : 1;
    }
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
    const moveExcluded = typeof shadow_set_overtake_suppress_master_volume === 'function';
    if (moveExcluded) {
        setMoveExcluded(true);
    } else {
        injectHold(heldTrack, true);
    }
    /* path= distinguishes the two schwung generations in the debug log —
     * device tests key on it rather than inferring the path from whether the
     * inject ring moved (it legitimately doesn't, on the new path). */
    mlog('trackvol arm t=' + heldTrack + ' read=' + value.toFixed(2) +
         ' path=' + (moveExcluded ? 'suppress' : 'inject'));
}

function endDivert(): void {
    if (diverted < 0) return;
    if (typeof shadow_set_overtake_suppress_master_volume === 'function') {
        setMoveExcluded(false);
    } else {
        injectHold(diverted, false);
    }
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
    /* Pan and mute are not part of this gesture: mute is the engine's own
     * per-track mute (so tails ring out, matching a host track), and pan has no
     * control surface yet. Both are written at their defaults rather than left
     * unset, because the engine parses the triple as a whole. */
    const write = trackKind(heldTrack) === 'movy'
        ? value.toFixed(4) + ',0,0'
        : value.toFixed(4);
    setChainParam(portFor(heldTrack), volumeKey(heldTrack), write, volumeBefore);
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
