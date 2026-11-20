/* What a sound_generator can say back to movy: pad colours and a line of text.
 *
 * A module opts in by naming the params in its ui_hierarchy root (the same
 * place `focus_press_param` lives):
 *
 *   "pad_leds_param":    "pad_leds"      read-only string, 64 hex digits
 *   "status_text_param": "status_text"   read-only string, "<seq>:<text>"
 *   "display_param":     "display"       read-only string, "<seq>|<pos>|<peaks>|<header>"
 *   "delete_pad_param":  "delete_pad"    write-only: Delete + pad -> the rack pad index
 *   "step_buttons_param": "step"         write-only: step button press -> 0..15
 *   "step_leds_param":    "step_leds"    read-only string, 32 hex digits (16 bytes)
 *   "loop_knob_param":    "loop_knob"    write-only: Loop held + knob -> "N:delta[:1]"
 *   "knob_capture_param": "knob_capture" read-only "0"/"1": 1 = the module owns the knobs
 *   "knob_delta_param":   "knob_delta"   write-only: a captured knob turn -> "N:delta[:1]"
 *   "undo_param":         "undo_cmd"     write-only: Undo / Shift+Undo -> "undo" / "redo"
 *
 * pad_leds: one byte (two hex digits) per RACK pad, pad 1 first — the same
 * numbering as the module's declared voices, so the module never needs to know
 * how movy lays a rack onto the 8x4 grid. Bits 0-6 are a Move LED palette
 * index; bit 7 (0x80) makes the pad blink between that colour and off.
 *
 * status_text: a sequence number and the text. movy shows the text as a toast
 * when the sequence number differs from the last one it saw. The first value
 * seen for a track is only remembered, never shown, so loading a Set or
 * switching to a track does not replay an old message.
 *
 * display: a waveform overview for the main screen. seq bumps when the peaks
 * change (movy parses them only then); pos is the playhead 0..127; peaks are
 * 128 values of two hex digits (0..255), empty when there is nothing to draw;
 * header is free text and comes last so it may hold anything, even '|'.
 * movy draws it in place of the knob page while no knob or the jog is being
 * used (see renderer/module-display.ts and DISPLAY_IDLE_MS).
 *
 * delete_pad: while Delete is held, a pad press on this track is NOT movy's
 * "erase this voice's steps"; movy writes the 0-based rack pad index (0..31,
 * same numbering as pad_leds) to this param and swallows the press.
 *
 * step_buttons_param: on a track whose module declares it, a press on one of
 * the 16 step buttons (no Shift, Mute not held, not Session view) is NOT a
 * sequencer step: movy writes the 0-based button index 0..15 and swallows the
 * press and its release. step_leds_param paints the 16 step LEDs the same way
 * pad_leds paints the pads (one palette byte each, bit 7 = blink). A module that
 * declares step_buttons_param also owns the Loop button on its track: Loop is a
 * pure modifier there (no Loop mode, no bar selector), see seq/loop-mode.ts.
 *
 * loop_knob_param: while Move's Loop button is held on such a track, a turn of
 * knob N (1..8) is NOT the knob's parameter: movy writes "N:delta" (delta is the
 * signed relative turn; ":1" is appended while Shift is held, "fine") and
 * swallows the turn. The display view stays up instead of the knob page.
 *
 * knob_capture_param: while the module answers "1" for the ACTIVE track, every knob
 * turn (Move's knobs) is NOT the knob's hierarchy parameter: movy
 * writes "N:delta" to knob_delta_param (same form as loop_knob_param: N = knob 1..8,
 * signed relative turn, ":1" appended while Shift is held) and swallows the turn,
 * touch included; the display view stays up. The module decides what each knob
 * means (a "mode" button on its pads). Read on the same poll as the other keys, so
 * it takes effect within ~40 ms.
 *
 * undo_param: on a track whose module declares it, Move's Undo button writes "undo"
 * (Shift+Undo: "redo") to the module instead of running movy's own undo; other
 * tracks keep movy's undo. The button's LED is lit while such a track is active.
 *
 * display pos field: "<pos>", "<pos>,<mark>" or "<pos>,<mark>,<end>"; mark and end
 * 0..127 are a start / end marker column, absent (or negative) for none. An older
 * movy reads only the pos.
 *
 * Cost: up to four get_param reads, only for the ACTIVE track, only every
 * POLL_EVERY ticks (~25 Hz at the device's ~196 ticks/s). A module that
 * declares nothing costs nothing.
 *
 * Pure: no platform globals, so the logic suite drives it directly. */

export const PAD_LED_COUNT = 32;
export const POLL_EVERY    = 8;
export const DISPLAY_BINS  = 128;
/* Blink half-period in ticks: ~0.5 s at ~196 ticks/s. */
export const BLINK_TICKS   = 98;

export interface FeedbackKeys {
    ledsKey: string | null;
    textKey: string | null;
    displayKey: string | null;
    deleteKey: string | null;
    stepKey: string | null;
    stepLedsKey: string | null;
    loopKnobKey: string | null;
    captureKey: string | null;
    knobDeltaKey: string | null;
    undoKey: string | null;
}

/** What the module said about the selected clip, as last read. */
export interface DisplayState {
    seq: number;
    pos: number;                 // 0..127
    mark: number;                // 0..127 start marker column, -1 = none
    end: number;                 // 0..127 end marker column, -1 = none
    peaks: Uint8Array | null;    // 128 entries, or null when empty
    header: string;
}

/** Idle time after the last knob/jog touch before the display view returns. */
export const DISPLAY_IDLE_MS = 1500;

function keyOf(v: unknown): string | null { return typeof v === 'string' && v ? v : null; }

/** The declared keys out of a ui_hierarchy root, or null when it declares none. */
export function feedbackKeysOf(hierarchy: any): FeedbackKeys | null {
    if (!hierarchy || typeof hierarchy !== 'object') return null;
    const k: FeedbackKeys = {
        ledsKey: keyOf(hierarchy.pad_leds_param),
        textKey: keyOf(hierarchy.status_text_param),
        displayKey: keyOf(hierarchy.display_param),
        deleteKey: keyOf(hierarchy.delete_pad_param),
        stepKey: keyOf(hierarchy.step_buttons_param),
        stepLedsKey: keyOf(hierarchy.step_leds_param),
        loopKnobKey: keyOf(hierarchy.loop_knob_param),
        captureKey: keyOf(hierarchy.knob_capture_param),
        knobDeltaKey: keyOf(hierarchy.knob_delta_param),
        undoKey: keyOf(hierarchy.undo_param),
    };
    return k.ledsKey || k.textKey || k.displayKey || k.deleteKey
        || k.stepKey || k.stepLedsKey || k.loopKnobKey
        || k.captureKey || k.knobDeltaKey || k.undoKey ? k : null;
}

/** "<seq>|<pos>|<peaks>|<header>" -> state. `prev` lets an unchanged seq keep
 *  its already-parsed peaks (the hex is not parsed again). Null on garbage. */
export function parseDisplay(raw: string | null | undefined, prev?: DisplayState | null): DisplayState | null {
    if (!raw) return null;
    const i1 = raw.indexOf('|');
    const i2 = i1 < 0 ? -1 : raw.indexOf('|', i1 + 1);
    const i3 = i2 < 0 ? -1 : raw.indexOf('|', i2 + 1);
    if (i3 < 0) return null;
    const seq = parseInt(raw.slice(0, i1), 10);
    const posField = raw.slice(i1 + 1, i2);
    const pos = parseInt(posField, 10);
    if (!(seq >= 0) || !(pos >= 0)) return null;
    const ci = posField.indexOf(',');
    const ci2 = ci < 0 ? -1 : posField.indexOf(',', ci + 1);
    const markRaw = ci < 0 ? -1 : parseInt(posField.slice(ci + 1), 10);
    const mark = markRaw >= 0 ? Math.min(DISPLAY_BINS - 1, markRaw) : -1;
    const endRaw = ci2 < 0 ? -1 : parseInt(posField.slice(ci2 + 1), 10);
    const end = endRaw >= 0 ? Math.min(DISPLAY_BINS - 1, endRaw) : -1;
    const header = raw.slice(i3 + 1);
    let peaks: Uint8Array | null;
    if (prev && prev.seq === seq) peaks = prev.peaks;
    else {
        const hex = raw.slice(i2 + 1, i3);
        peaks = null;
        if (hex.length >= DISPLAY_BINS * 2) {
            const a = new Uint8Array(DISPLAY_BINS);
            let ok = true;
            for (let i = 0; i < DISPLAY_BINS; i++) {
                const v = parseInt(hex.substr(i * 2, 2), 16);
                if (!(v >= 0)) { ok = false; break; }
                a[i] = v;
            }
            if (ok) peaks = a;
        }
    }
    return { seq, pos: Math.min(DISPLAY_BINS - 1, pos), mark, end, peaks, header };
}

/** 64 hex digits -> 32 bytes. Null for anything else (a half-written or
 *  unrelated string must never paint the grid). */
export function parsePadLeds(raw: string | null | undefined): Uint8Array | null {
    if (!raw || raw.length < PAD_LED_COUNT * 2) return null;
    const out = new Uint8Array(PAD_LED_COUNT);
    for (let i = 0; i < PAD_LED_COUNT; i++) {
        const v = parseInt(raw.substr(i * 2, 2), 16);
        if (!(v >= 0)) return null;
        out[i] = v;
    }
    return out;
}

export const STEP_LED_COUNT = 16;

/** 32 hex digits -> 16 bytes. Null for anything else. */
export function parseStepLeds(raw: string | null | undefined): Uint8Array | null {
    if (!raw || raw.length < STEP_LED_COUNT * 2) return null;
    const out = new Uint8Array(STEP_LED_COUNT);
    for (let i = 0; i < STEP_LED_COUNT; i++) {
        const v = parseInt(raw.substr(i * 2, 2), 16);
        if (!(v >= 0)) return null;
        out[i] = v;
    }
    return out;
}

/** The palette colour a pad shows this tick (blink resolved). */
export function padLedColor(entry: number, tickNo: number): number {
    const color = entry & 0x7F;
    if (!(entry & 0x80)) return color;
    return Math.floor(tickNo / BLINK_TICKS) % 2 === 0 ? color : 0;
}

/** "<seq>:<text>" -> parts. Null when it does not parse. */
export function parseStatus(raw: string | null | undefined): { seq: number; text: string } | null {
    if (!raw) return null;
    const i = raw.indexOf(':');
    if (i < 1) return null;
    const seq = parseInt(raw.slice(0, i), 10);
    if (!(seq >= 0)) return null;
    return { seq, text: raw.slice(i + 1) };
}

interface TrackFeedback {
    leds: Uint8Array | null;
    stepLeds: Uint8Array | null;
    capture: boolean;       // the module owns the knobs (knob_capture_param)
    seq: number;            // -1 = nothing seen yet
    display: DisplayState | null;
}

const tracks = new Map<number, TrackFeedback>();
let pollTick = 0;
let displayDirty = false;
let lastActivity = -1e12;

function stateOf(track: number): TrackFeedback {
    let st = tracks.get(track);
    if (!st) { st = { leds: null, stepLeds: null, capture: false, seq: -1, display: null }; tracks.set(track, st); }
    return st;
}

/** Call once per UI tick for the active track. `read` fetches a param of the
 *  track's synth by key. Returns text to toast, or null. */
export function feedbackPoll(
    track: number, keys: FeedbackKeys, read: (key: string) => string | null,
): string | null {
    pollTick++;
    if (pollTick % POLL_EVERY !== 0) return null;
    const st = stateOf(track);
    if (keys.ledsKey) st.leds = parsePadLeds(read(keys.ledsKey));
    if (keys.stepLedsKey) st.stepLeds = parseStepLeds(read(keys.stepLedsKey));
    if (keys.captureKey) st.capture = parseInt(read(keys.captureKey) ?? '', 10) === 1;
    if (keys.displayKey) {
        const d = parseDisplay(read(keys.displayKey), st.display);
        if (d && (!st.display || d.seq !== st.display.seq || d.pos !== st.display.pos || d.mark !== st.display.mark || d.end !== st.display.end
                  || d.header !== st.display.header)) displayDirty = true;
        st.display = d;
    }
    if (!keys.textKey) return null;
    const s = parseStatus(read(keys.textKey));
    if (!s) return null;
    const first = st.seq < 0;
    const changed = s.seq !== st.seq;
    st.seq = s.seq;
    return !first && changed && s.text ? s.text : null;
}

/** Latest pad colours for a track, or null (not declared / not read yet). */
export function feedbackLeds(track: number): Uint8Array | null {
    return tracks.get(track)?.leds ?? null;
}

/** Latest step-row colours for a track, or null (not declared / not read yet). */
export function feedbackStepLeds(track: number): Uint8Array | null {
    return tracks.get(track)?.stepLeds ?? null;
}

/** The module on this track asked to own the knobs (last poll). */
export function feedbackCapture(track: number): boolean {
    return tracks.get(track)?.capture ?? false;
}

/** Forget a track (its module changed) so stale colours/seq never leak. */
export function feedbackForget(track: number): void { tracks.delete(track); }

export function feedbackReset(): void { tracks.clear(); pollTick = 0; displayDirty = false; lastActivity = -1e12; }
export function feedbackTickNo(): number { return pollTick; }

/** Latest display state for a track, or null. */
export function feedbackDisplay(track: number): DisplayState | null {
    return tracks.get(track)?.display ?? null;
}

/** True once after the display changed (playhead, peaks or header): the
 *  caller repaints the frame. */
export function displayTakeDirty(): boolean {
    const d = displayDirty;
    displayDirty = false;
    return d;
}

/** A knob or the jog was touched/turned: the knob page owns the screen for
 *  DISPLAY_IDLE_MS. */
export function displayActivity(nowMs: number): void { lastActivity = nowMs; }

/** Whether the display view (rather than the knob page) should be on screen. */
export function displayShowing(nowMs: number, keys: FeedbackKeys | null, track: number): boolean {
    if (!keys || !keys.displayKey) return false;
    if (nowMs - lastActivity < DISPLAY_IDLE_MS) return false;
    return !!tracks.get(track)?.display;
}

/** The write that Delete + pad turns into: [key, value], or null when the
 *  module does not declare delete_pad_param or the pad is not in the rack. */
export function deletePadWrite(keys: FeedbackKeys | null, rackPad1: number): [string, string] | null {
    if (!keys || !keys.deleteKey || !(rackPad1 >= 1)) return null;
    return [keys.deleteKey, String(rackPad1 - 1)];
}

/** The write a step button press turns into: [key, value], or null when the
 *  module does not declare step_buttons_param or the button is not 0..15. */
export function stepPressWrite(keys: FeedbackKeys | null, button: number): [string, string] | null {
    if (!keys || !keys.stepKey || !(button >= 0 && button < STEP_LED_COUNT)) return null;
    return [keys.stepKey, String(button)];
}

/** The write a knob turn under a held Loop button turns into: [key, "N:delta"
 *  (+ ":1" with Shift)], or null when the module does not declare
 *  loop_knob_param. `knob` is 0-based, N is 1-based. */
export function loopKnobWrite(
    keys: FeedbackKeys | null, knob: number, delta: number, fine: boolean,
): [string, string] | null {
    if (!keys || !keys.loopKnobKey || !(knob >= 0 && knob < 8) || !delta) return null;
    return [keys.loopKnobKey, (knob + 1) + ':' + delta + (fine ? ':1' : '')];
}

/** The write a captured knob turn becomes: [key, "N:delta[:1]"], or null when the
 *  module declares no knob_delta_param. `knob` is 0-based. */
export function knobDeltaWrite(
    keys: FeedbackKeys | null, knob: number, delta: number, fine: boolean,
): [string, string] | null {
    if (!keys || !keys.knobDeltaKey || !(knob >= 0 && knob < 8) || !delta) return null;
    return [keys.knobDeltaKey, (knob + 1) + ':' + delta + (fine ? ':1' : '')];
}

/** The write Move's Undo (Shift = redo) becomes: [key, "undo" | "redo"], or null. */
export function undoWrite(keys: FeedbackKeys | null, redo: boolean): [string, string] | null {
    if (!keys || !keys.undoKey) return null;
    return [keys.undoKey, redo ? 'redo' : 'undo'];
}
