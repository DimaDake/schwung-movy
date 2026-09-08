import { setChainParam } from '../chain/set-param.js';
import { MIX_KEY } from '../track/mix-persist.js';
import { markUiStateDirty } from '../seq/ui-dirty.js';
import { portFor } from '../track/registry.js';
import { trackKind } from '../track/ref.js';
import { beginGesture } from '../undo/edit.js';
import { endEdit } from '../undo/group.js';
import {
    ampToIdx, idxToAmp, idxToFrac, UNITY_FRAC, VOL_MAX, VOL_MIN, VOL_STEPS, volumeFrac,
} from './db-ladder.js';

/* Re-exported: the slider renderer has always read this from here, and the
 * ladder moving out is not a reason for a call site to change. */
export { volumeFrac };
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
    return trackKind(track) === 'movy' ? MIX_KEY : 'slot:volume';
}

/* Everything after the gain, carried unchanged across the write.
 *
 * Only the gain is on this fader, and the value is saved state, so writing the
 * other fields back at their defaults would quietly discard a pan the set file
 * had restored — or, once sends existed, silence both of them on the next
 * volume nudge. Deliberately kept as an opaque REMAINDER rather than a parsed
 * triple: this gesture must not need updating every time the mixer grows a
 * field. */
const MIX_TAIL_DEFAULT = ',0,0,0,0';
let mixTail = MIX_TAIL_DEFAULT;

/* One shape for the value, so the undo inverse is written in the same form as
 * the edit. A movy track's param is the whole triple: recording just the gain
 * meant `parse_mix` rejected the inverse and undoing a volume change on a movy
 * track silently did nothing. */
function writeValue(track: number, amp: number): string {
    return trackKind(track) === 'movy' ? amp.toFixed(4) + mixTail : amp.toFixed(4);
}

function readVolume(track: number): number {
    if (trackKind(track) === 'movy') {
        /* "gain,pan,muted[,send1,send2]" — only the gain is on the fader. */
        const raw = portFor(track).getParam(MIX_KEY);
        const parts = raw === null ? [] : raw.split(',');
        const comma = raw === null ? -1 : raw.indexOf(',');
        mixTail = comma >= 0 ? raw!.slice(comma) : MIX_TAIL_DEFAULT;
        const g = parts.length === 0 ? NaN : parseFloat(parts[0]);
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
    volumeBefore = writeValue(heldTrack, value);
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
     * control surface yet. They still travel on every write, because the engine
     * parses the triple as a whole — as read, not as defaults (see mixTail). */
    const movy = trackKind(heldTrack) === 'movy';
    setChainParam(portFor(heldTrack), volumeKey(heldTrack),
                  writeValue(heldTrack, value), volumeBefore);
    /* A movy track's level is in movy's own set blob; a host track's is
     * schwung's `slot:volume`, which Move saves for us. */
    if (movy) markUiStateDirty();
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
    mixTail   = MIX_TAIL_DEFAULT;
}
