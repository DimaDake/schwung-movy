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

/* Forget everything sent — next tick repaints all sequencer LEDs. Use after
 * anything that may have clobbered LED hardware state. */
export function seqLedsInvalidate(): void { lastNoteLed.clear(); lastButtonLed.clear(); }
