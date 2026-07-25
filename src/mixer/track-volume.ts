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

const VOL_MIN  = 0;
const VOL_MAX  = 4;
const VOL_STEP = 0.05;

/* Track button CCs are reversed on the hardware: CC43 = track 1 → slot 0. */
function trackCc(track: number): number { return 43 - track; }

let heldTrack = -1;      /* track button physically held (-1 = none) */
let touched   = false;   /* master knob capacitive touch */
let diverted  = -1;      /* track whose hold we injected into Move (-1 = none) */
let value     = 1;       /* live slot:volume for the gesture in progress */

function injectHold(track: number, pressed: boolean): void {
    if (typeof move_midi_inject_to_move !== 'function') return;
    move_midi_inject_to_move([0x0B, 0xB0, trackCc(track), pressed ? 127 : 0]);
}

function readVolume(track: number): number {
    const raw = shadow_get_param(track, 'slot:volume');
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
    injectHold(heldTrack, true);
    mlog('trackvol arm t=' + heldTrack + ' read=' + value.toFixed(2));
}

function endDivert(): void {
    if (diverted < 0) return;
    injectHold(diverted, false);
    diverted = -1;
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
    value = Math.min(VOL_MAX, Math.max(VOL_MIN, value + delta * VOL_STEP));
    shadow_set_param(heldTrack, 'slot:volume', value.toFixed(2));
    mlog('trackvol t=' + heldTrack + ' d=' + delta + ' v=' + value.toFixed(2));
    return true;
}

/* The slider to draw, or null when no gesture is live. */
export function volumeOverlay(): { track: number; value: number } | null {
    if (heldTrack < 0 || !touched) return null;
    return { track: heldTrack, value };
}

export function resetTrackVolume(): void {
    heldTrack = -1;
    touched   = false;
    diverted  = -1;
    value     = 1;
}
