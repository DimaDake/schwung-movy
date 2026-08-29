/* Sequencer UI state: the UI-side mirror of engine status plus UI-only
 * interaction state (held steps, modes). The engine (dsp.so) owns the
 * musical truth; this mirror is refreshed by status polls in engine.ts and
 * updated optimistically when the UI issues commands so LEDs react within
 * one tick instead of one poll interval. */

import { TRACK_COUNT } from '../track/ref.js';
import { readPrefFullVelocity, writePrefFullVelocity } from './prefs.js';

export interface SeqUiState {
    /* engine link */
    engineOk: boolean;       // a status poll has succeeded this session
    playing: boolean;        // transport running
    engineTick: number;      // engine master tick (96 PPQN) at last poll
    bpmX100: number;         // engine tempo, hundredths of BPM
    extSync: boolean;        // following Move's external transport (from `ext=`)
    linkEnabled: boolean;    // bidirectional Move transport link on (from `link=`)
    swingPct: number;        // engine swing %, 50..80 (from `swing=`)
    activeNotes: Uint8Array; // track*128 + pitch, 1 = sounding (from `act=`)

    /* watched clip (active track's selected clip) */
    watchTrack: number;      // track whose clip the step LEDs show
    curStep: number;         // playhead step within the watched clip
    lenSteps: number;        // watched clip loop length in steps (0 = empty)
    loopStart: number;       // watched clip loop-window start step
    clipScaleIdx: number;    // active clip playback-scale enum index (from `csc=`)
    clipTranspose: number;   // active clip transpose in semitones (from `ctr=`)
    clipQuant: number;       // active clip quantization strength % (from `quant=`)
    defaultQuant: number;    // set-level quantization default % (from `dquant=`)
    occ: Uint8Array;         // 256-bit step occupancy bitmap

    /* loop mode */
    loopMode: boolean;       // step buttons show bars instead of steps

    /* Session button held, and a step has already committed a track switch:
     * the pads/screen/knobs are back on the Track view but the step row stays
     * the 16-track selector, so you can keep switching until you let go.
     * sessionMode owns "the pads are the clip grid"; this owns "the step row is
     * the selector" — the two used to be the same flag. */
    trackSelectHold: boolean;

    /* recording (engine-driven, mirrored from status) */
    recording: boolean;
    countingIn: boolean;
    /* Retroactive capture: notes buffered for the watched track (drives the
     * Capture LED), and the engine's overlay generation (a change means the
     * capture detail is worth re-reading). */
    capPending: number;
    capGen: number;
    metro: boolean;
    dirty: boolean;          // engine has unsaved state changes
    /* Chain-module loads the engine has accepted but not yet released — it
     * releases at most one per audio callback, so a restored Set's modules
     * arrive over seconds. Nonzero means the Set is named but not yet playable. */
    chainPending: number;

    /* note entry */
    lastPitch: number[];     // per-track: last played pitch (step-entry value)
    lastVel: number[];       // per-track: last played velocity

    /* view */
    barOffset: number;       // which bar's 16 steps the step buttons show
    watchLane: number;       // drum-lane pitch shown on steps, or -1 = melodic
    fullVelocity: boolean;   // Shift+Step 10: force all pad notes to 127

    posTick: number;         // watched track playhead tick (from `pos=`)
    holdStep: number;        // step whose length is being shown, or -1
    holdLen: number;         // held note length in steps (from `hlen=`), 0 = none
    holdNotes: number[];     // pitches in the held step (from `hnotes=`), empty when none

    /* held-step trig properties (step parameter page), mirrored from status */
    holdVel: number;         // avg velocity at held step (from `hvel`)
    holdGate: number;        // gate ticks of first held note (from `hgate`)
    holdGateMixed: boolean;  // held notes differ in length (from `hgmix`)
    holdProb: number;        // probability % (from `hprob`)
    holdCondA: number;       // condition A (from `hcond`)
    holdCondB: number;       // condition B (from `hcond`)
    holdInvert: boolean;     // invert condition (from `hinv`)
    holdMaxGate: number;     // max gate ticks the held note can grow to (from `hlmax`); 0 = none

    /* per-track mute, from `mute=` engine status field */
    muted: boolean[];

    /* session mode */
    sessionMode: boolean;        // pads show the clip grid
    session: SessionTrack[];     // one entry per track, clip-slot state (from status)

    /* parameter automation (mirrored from status, watched track / active clip) */
    autoAssigned: number;            // bitmask of assigned lanes (from `alanes`)
    autoActive: number;              // bitmask of lanes with locks (from `aauto`)
    heldLocks: Map<number, number>;  // lane -> value at the held step (from `hauto`)
    stepAutoMode: boolean;           // a step held long enough → record knob turns as automation
}

export interface SessionTrack {
    exist: number;    // bitmap: bit s set = slot s has a clip
    playing: number;  // playing slot, or -1
    queued: number;   // queued slot, or -1
    selected: number; // selected slot
}

function emptySession(): SessionTrack[] {
    return Array.from({ length: TRACK_COUNT },
        () => ({ exist: 0, playing: -1, queued: -1, selected: 0 }));
}

function defaults(): SeqUiState {
    return {
        engineOk: false,
        playing: false,
        engineTick: 0,
        bpmX100: 12000,
        extSync: false,
        linkEnabled: false,
        swingPct: 50,
        activeNotes: new Uint8Array(TRACK_COUNT * 128),
        watchTrack: 0,
        curStep: 0,
        lenSteps: 0,
        loopStart: 0,
        clipScaleIdx: 4,         // SCALE_DEFAULT_IDX (1X)
        clipTranspose: 0,
        clipQuant: 0,
        defaultQuant: 0,
        occ: new Uint8Array(32),
        loopMode: false,
        trackSelectHold: false,
        recording: false,
        countingIn: false,
        capPending: 0,
        capGen: -1,
        metro: false,
        dirty: false,
        chainPending: 0,
        lastPitch: new Array(TRACK_COUNT).fill(60) as number[],
        lastVel: new Array(TRACK_COUNT).fill(100) as number[],
        barOffset: 0,
        watchLane: -1,
        fullVelocity: false,
        posTick: 0,
        holdStep: -1,
        holdLen: 0,
        holdNotes: [],
        holdVel: 0,
        holdGate: 0,
        holdGateMixed: false,
        holdProb: 100,
        holdCondA: 1,
        holdCondB: 1,
        holdInvert: false,
        holdMaxGate: 0,
        muted: new Array(TRACK_COUNT).fill(false) as boolean[],
        sessionMode: false,
        session: emptySession(),
        autoAssigned: 0,
        autoActive: 0,
        heldLocks: new Map(),
        stepAutoMode: false,
    };
}

/* Parse the engine's `mute=` value (one '0'/'1' per track). */
export function muteFromStr(s: string): void {
    for (let t = 0; t < TRACK_COUNT; t++) seqState.muted[t] = s[t] === '1';
}

/* Parse the engine's `sess=` value: tracks joined by ',', each `EE.P.Q.S`
 * (exist hex, playing/queued/selected slot or '-'). */
export function sessionFromStr(s: string): void {
    const groups = s.split(',');
    for (let t = 0; t < TRACK_COUNT; t++) {
        const g = (groups[t] ?? '').split('.');
        const slot = (v: string) => (v === '-' || v === undefined ? -1 : Number(v));
        seqState.session[t] = {
            exist: parseInt(g[0] ?? '0', 16) || 0,
            playing: slot(g[1]),
            queued: slot(g[2]),
            selected: g[3] === undefined ? 0 : Number(g[3]) || 0,
        };
    }
}

/* Number of bars the watched clip's loop spans (its length, bar-rounded), capped
 * at 16. NOT an absolute bar index — the loop can start anywhere; ask
 * loopStartBar() for where it begins. */
export function clipBars(): number {
    return Math.max(1, Math.ceil(seqState.lenSteps / 16));
}

export function loopBarCount(): number {
    return loopEndBar() - loopStartBar() + 1;
}

/* Navigable bar range: the loop's own bars plus ONE empty bar past its end
 * (native: stepping past the loop shows an empty bar that becomes part of the
 * loop once a note is added). Absolute bar indices — a loop that starts at bar 3
 * must not let the arrows wander back to bar 1, and must be able to reach its
 * own last bar. */
export function minBarOffset(): number {
    if (seqState.lenSteps === 0) return 0;
    return loopStartBar();
}

export function maxBarOffset(): number {
    if (seqState.lenSteps === 0) return 0;
    return Math.min(loopEndBar() + 1, 15);
}

/* The loop window is engine-owned and arrives asynchronously on a status poll;
 * barOffset is UI-owned and starts at 0. Those disagree on a cold start — and
 * after any switch that resets the view to bar 0 — whenever the clip's loop does
 * not begin at bar 1, and the strip then leads with inactive bars nobody
 * navigated to.
 *
 * Reconcile only when the window MOVES. Selecting a bar outside the loop (pressing
 * an inactive bar in Loop mode) is a designed state — the navigable "+" bar — so it
 * has to survive every poll that reports the same window. */
let lastLoopStart = -1;
let lastLenSteps = -1;

export function adoptLoopWindow(): void {
    if (seqState.loopStart === lastLoopStart && seqState.lenSteps === lastLenSteps) return;
    lastLoopStart = seqState.loopStart;
    lastLenSteps = seqState.lenSteps;
    if (seqState.lenSteps === 0) return;   // no clip in the slot → nothing to adopt
    seqState.barOffset = Math.max(minBarOffset(), Math.min(seqState.barOffset, maxBarOffset()));
}

/* Make the next poll re-adopt the window unconditionally. Used where the view is
 * reset for a track or lane switch: bar 0 is a placeholder there, not a choice,
 * and the incoming window may happen to match the outgoing one. */
export function requestLoopWindowAdopt(): void {
    lastLoopStart = -1;
    lastLenSteps = -1;
}

/* Is this absolute step inside the loop window the engine actually plays? The
 * engine loops [loop_start_steps, loop_start_steps + length_steps) (seq-core
 * clip.rs), so every consumer must ask through here rather than comparing
 * against lenSteps — that is a LENGTH, not an end index, and reading it as one
 * broke the strip, the sweep, the step row and bar navigation at once. */
export function stepInLoop(step: number): boolean {
    return step >= seqState.loopStart && step < seqState.loopStart + seqState.lenSteps;
}

/* First and last (inclusive) loop bar indices for the watched clip. */
export function loopStartBar(): number {
    return Math.floor(seqState.loopStart / 16);
}

export function loopEndBar(): number {
    return Math.floor((seqState.loopStart + Math.max(16, seqState.lenSteps) - 1) / 16);
}

export const seqState: SeqUiState = defaults();

/* Full velocity is durable, and prefs.json is where it lives (prefs.ts says
 * why). Both halves are here so the field cannot be written past its store:
 * the toggle goes through `setFullVelocity`, and a fresh open seeds the mirror
 * from the file before any pad can be hit. */
export function setFullVelocity(on: boolean): void {
    seqState.fullVelocity = on;
    writePrefFullVelocity(on);
}

export function loadFullVelocityPref(): void {
    seqState.fullVelocity = readPrefFullVelocity();
}

export function resetSeqState(): void {
    Object.assign(seqState, defaults());
    requestLoopWindowAdopt();   // a fresh mirror has learned no window yet
}

export function occHasStep(step: number): boolean {
    if (step < 0 || step > 255) return false;
    return (seqState.occ[step >> 3] & (0x80 >> (step & 7))) !== 0;
}

export function occToggleStep(step: number): void {
    if (step < 0 || step > 255) return;
    seqState.occ[step >> 3] ^= 0x80 >> (step & 7);
}

/* Parse the engine's 64-hex-char occupancy (step 0 = MSB of first byte). */
export function occFromHex(hex: string): void {
    for (let i = 0; i < 32; i++) {
        seqState.occ[i] = i * 2 + 2 <= hex.length
            ? parseInt(hex.slice(i * 2, i * 2 + 2), 16) || 0
            : 0;
    }
}

/* Parse the engine's `act=` value (4 comma-separated tracks, dot-separated
 * pitches) into the reused activeNotes buffer. Called once per status poll. */
export function activeFromStr(s: string): void {
    seqState.activeNotes.fill(0);
    const tracks = s.split(',');
    for (let t = 0; t < TRACK_COUNT; t++) {
        const g = tracks[t];
        if (!g) continue;
        for (const ps of g.split('.')) {
            const p = Number(ps);
            if (p >= 0 && p < 128) seqState.activeNotes[t * 128 + p] = 1;
        }
    }
}

export function activeHasNote(track: number, pitch: number): boolean {
    if (track < 0 || track >= TRACK_COUNT || pitch < 0 || pitch > 127) return false;
    return seqState.activeNotes[track * 128 + pitch] === 1;
}
