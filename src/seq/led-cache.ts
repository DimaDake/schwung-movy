/* Cached LED diff layer for the sequencer. Only changed colors are sent — so
 * unchanged frames cost nothing on the wire (davebox pattern).
 *
 * Per-tick send budget: the MIDI output buffer holds ~64 USB-MIDI packets;
 * sending more than ~60 LED commands in one frame overflows it and silently
 * drops packets (schwung API.md). A cold frame (after seqLedsInvalidate) wants
 * to repaint every seq LED at once — ~80 in Session mode (32 pads + 16 steps +
 * ~32 buttons). We cap sends per tick and skip the cache update for anything
 * over budget so it retries next tick (instead of being dropped yet recorded as
 * sent — the bug behind intermittent Session LEDs). Budget leaves headroom for
 * the knob LEDs painted later in the same app tick. */

import { ANIM_NONE } from './colors.js';

const lastNoteLed = new Map<number, number>();
const lastButtonLed = new Map<number, number>();

const FRAME_BUDGET = 40;
let sentThisFrame = 0;

/* Reset the per-tick send budget. Call once at the top of each LED frame. */
export function ledFrameReset(): void { sentThisFrame = 0; }

export function cachedSetLED(note: number, color: number): void {
    if (lastNoteLed.get(note) === color) return;
    if (sentThisFrame >= FRAME_BUDGET) return; // over budget: retry next tick
    lastNoteLed.set(note, color);
    setLED(note, color, true);
    sentThisFrame++;
}

export function cachedSetButtonLED(cc: number, color: number): void {
    if (lastButtonLed.get(cc) === color) return;
    if (sentThisFrame >= FRAME_BUDGET) return; // over budget: retry next tick
    lastButtonLed.set(cc, color);
    setButtonLED(cc, color, true);
    sentThisFrame++;
}

/* Native-animation pad state: the last base color sent on channel 0, and the
 * last animation (channel + color) sent, per note. `anim === ANIM_NONE` means
 * the pad is currently solid. See colors.ts ANIM_* and the design doc. */
interface AnimState { base: number; anim: number; animColor: number; }
const lastAnimLed = new Map<number, AnimState>();

function emitLed(note: number, color: number, channel: number): void {
    // move_midi_internal_send is a shadow_ui global; absent in browser tests of
    // the device build and in DSP-less installs. Fall back to channel-0 setLED.
    if (typeof move_midi_internal_send === 'function') {
        move_midi_internal_send([0x09, 0x90 | channel, note, color]);
    } else {
        setLED(note, color, true);
    }
}

/* Paint a pad with an optional native animation. `base` is the channel-0 color
 * the hardware pulses FROM; `animColor`/`channel` is the animation target (use
 * channel ANIM_NONE for a solid `base`). When the base changes we send it first
 * (this tick) and defer the animation to the next tick — the overtake LED queue
 * keeps only one (channel,color) per note per tick, so base + anim cannot share
 * a tick. */
export function cachedSetAnimLED(note: number, base: number, animColor: number, channel: number): void {
    const prev = lastAnimLed.get(note);
    if (channel === ANIM_NONE) {
        if (prev && prev.base === base && prev.anim === ANIM_NONE) return;
        if (sentThisFrame >= FRAME_BUDGET) return;
        emitLed(note, base, ANIM_NONE);
        lastAnimLed.set(note, { base, anim: ANIM_NONE, animColor: base });
        sentThisFrame++;
        return;
    }
    // Animated: ensure the base is established first (handshake).
    if (!prev || prev.base !== base) {
        if (sentThisFrame >= FRAME_BUDGET) return;
        emitLed(note, base, ANIM_NONE);
        lastAnimLed.set(note, { base, anim: ANIM_NONE, animColor: base });
        sentThisFrame++;
        return; // animation goes out next tick
    }
    if (prev.anim === channel && prev.animColor === animColor) return;
    if (sentThisFrame >= FRAME_BUDGET) return;
    emitLed(note, animColor, channel);
    lastAnimLed.set(note, { base, anim: channel, animColor });
    sentThisFrame++;
}

/* Forget everything sent — next tick repaints all sequencer LEDs. Use after
 * anything that may have clobbered LED hardware state. */
export function seqLedsInvalidate(): void { lastNoteLed.clear(); lastButtonLed.clear(); lastAnimLed.clear(); }
