import { setChainParam } from '../chain/set-param.js';
import { MIX_KEY } from '../track/mix-persist.js';
import { mixerKeyFor } from './mix-io.js';
import { markUiStateDirty } from '../seq/ui-dirty.js';
import { portFor } from '../track/registry.js';
import { beginGesture } from '../undo/edit.js';
import { endEdit } from '../undo/group.js';
import {
    ampToIdx, idxToAmp, idxToFrac, UNITY_FRAC, VOL_MAX, VOL_MIN, VOL_STEPS, volumeFrac,
} from './db-ladder.js';

/* Re-exported: the slider renderer has always read this from here, and the
 * ladder moving out is not a reason for a call site to change. */
export { volumeFrac };
/* Hold a track button + turn the master volume knob → that track's level in
 * movy's summing mixer, on the same dB ladder as the master. */

import { mlog } from '../log.js';

export const MASTER_CC         = 79;   /* MoveMaster — raw relative encoder */
export const MASTER_TOUCH_NOTE = 8;    /* MoveMasterTouch (note 9 is the jog) */

let heldTrack = -1;      /* track button physically held (-1 = none) */
let touched   = false;   /* master knob capacitive touch */
let volumeBefore: string | null = null;  /* volume at gesture start, for undo */
let diverted  = -1;      /* track the gesture is driving (-1 = none) */
let value     = 1;       /* live slot:volume for the gesture in progress */
let volIdx    = ampToIdx(1);  /* its position on the dB ladder */

/* Where a track's level lives: movy's summing mixer (design §5.4).
 *
 * Shared with mix-io rather than spelled out again here: undo has to recognise
 * both shapes to find the page that displays them, so a third copy of the rule
 * is a third place for them to disagree. */
const volumeKey = mixerKeyFor;

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
function writeValue(_track: number, amp: number): string {
    return amp.toFixed(4) + mixTail;
}

function readVolume(track: number): number {
    /* "gain,pan,muted[,send1,send2]" — only the gain is on the fader. */
    const raw = portFor(track).getParam(MIX_KEY);
    const parts = raw === null ? [] : raw.split(',');
    const comma = raw === null ? -1 : raw.indexOf(',');
    mixTail = comma >= 0 ? raw!.slice(comma) : MIX_TAIL_DEFAULT;
    const g = parts.length === 0 ? NaN : parseFloat(parts[0]);
    return Number.isFinite(g) ? Math.min(VOL_MAX, Math.max(VOL_MIN, g)) : 1;
}

/* Take the gesture: snapshot the value we are about to move. */
function beginDivert(): void {
    if (diverted >= 0 || heldTrack < 0) return;
    diverted = heldTrack;
    value    = readVolume(heldTrack);
    /* The gesture already has explicit start/end points, so they double as the
     * undo group's — no touch plumbing needed. */
    volumeBefore = writeValue(heldTrack, value);
    volIdx   = ampToIdx(value);
    mlog('trackvol arm t=' + heldTrack + ' read=' + value.toFixed(2));
}

function endDivert(): void {
    if (diverted < 0) return;
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

/* CC 79 arrives raw: 1-63 clockwise, 65-127 counter-clockwise. Returns true
 * when the turn was consumed as a track-volume edit (a track is held); false
 * leaves it to the master volume. */
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
    setChainParam(portFor(heldTrack), volumeKey(heldTrack),
                  writeValue(heldTrack, value), volumeBefore);
    /* A track's level is in movy's own set blob — nothing else saves it. */
    markUiStateDirty();
    mlog('trackvol t=' + heldTrack + ' d=' + delta + ' v=' + value.toFixed(4));
    return true;
}

/* The slider to draw, or null when no gesture is live. `frac`/`unityFrac` are
 * ladder positions so the renderer stays free of the dB mapping. */
export function volumeOverlay():
    { track: number; title: string; value: number; frac: number; unityFrac: number } | null {
    if (heldTrack < 0 || !touched) return null;
    return { track: heldTrack, title: 'T' + (heldTrack + 1) + ' VOLUME', value,
             frac: idxToFrac(volIdx), unityFrac: UNITY_FRAC };
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
