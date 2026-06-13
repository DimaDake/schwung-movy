/* Sequencer UI state: the UI-side mirror of engine status plus UI-only
 * interaction state (held steps, modes). The engine (dsp.so) owns the
 * musical truth; this mirror is refreshed by status polls in engine.ts and
 * updated optimistically when the UI issues commands so LEDs react within
 * one tick instead of one poll interval. */

export interface SeqUiState {
    /* engine link */
    engineOk: boolean;       // a status poll has succeeded this session
    playing: boolean;        // transport running
    engineTick: number;      // engine master tick (96 PPQN) at last poll
    bpmX100: number;         // engine tempo, hundredths of BPM
    activeNotes: Uint8Array; // track*128 + pitch, 1 = sounding (from `act=`)

    /* watched clip (active track's selected clip) */
    watchTrack: number;      // track whose clip the step LEDs show
    curStep: number;         // playhead step within the watched clip
    lenSteps: number;        // watched clip loop length in steps (0 = empty)
    loopStart: number;       // watched clip loop-window start step
    occ: Uint8Array;         // 256-bit step occupancy bitmap

    /* loop mode */
    loopMode: boolean;       // step buttons show bars instead of steps

    /* recording (engine-driven, mirrored from status) */
    recording: boolean;
    countingIn: boolean;
    metro: boolean;
    dirty: boolean;          // engine has unsaved state changes

    /* note entry */
    lastPitch: number[];     // per-track: last played pitch (step-entry value)
    lastVel: number[];       // per-track: last played velocity

    /* view */
    barOffset: number;       // which bar's 16 steps the step buttons show
    watchLane: number;       // drum-lane pitch shown on steps, or -1 = melodic
    fullVelocity: boolean;   // Shift+Step 10: force all pad notes to 127

    /* per-track mute, from `mute=` engine status field */
    muted: boolean[];

    /* session mode */
    sessionMode: boolean;        // pads show the clip grid
    session: SessionTrack[];     // 4 tracks of clip-slot state (from status)
}

export interface SessionTrack {
    exist: number;    // bitmap: bit s set = slot s has a clip
    playing: number;  // playing slot, or -1
    queued: number;   // queued slot, or -1
    selected: number; // selected slot
}

function emptySession(): SessionTrack[] {
    return [0, 1, 2, 3].map(() => ({ exist: 0, playing: -1, queued: -1, selected: 0 }));
}

function defaults(): SeqUiState {
    return {
        engineOk: false,
        playing: false,
        engineTick: 0,
        bpmX100: 12000,
        activeNotes: new Uint8Array(512),
        watchTrack: 0,
        curStep: 0,
        lenSteps: 0,
        loopStart: 0,
        occ: new Uint8Array(32),
        loopMode: false,
        recording: false,
        countingIn: false,
        metro: false,
        dirty: false,
        lastPitch: [60, 60, 60, 60],
        lastVel: [100, 100, 100, 100],
        barOffset: 0,
        watchLane: -1,
        fullVelocity: false,
        muted: [false, false, false, false],
        sessionMode: false,
        session: emptySession(),
    };
}

/* Parse the engine's `mute=` value (one '0'/'1' per track). */
export function muteFromStr(s: string): void {
    for (let t = 0; t < 4; t++) seqState.muted[t] = s[t] === '1';
}

/* Parse the engine's `sess=` value: tracks joined by ',', each `EE.P.Q.S`
 * (exist hex, playing/queued/selected slot or '-'). */
export function sessionFromStr(s: string): void {
    const groups = s.split(',');
    for (let t = 0; t < 4; t++) {
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

/* Number of bars in the watched clip, with one extra empty bar available to
 * navigate into (native: stepping past the loop shows an empty bar that
 * becomes part of the loop once a note is added). Capped at 16 bars. */
export function clipBars(): number {
    return Math.max(1, Math.ceil(seqState.lenSteps / 16));
}

export function maxBarOffset(): number {
    if (seqState.lenSteps === 0) return 0;
    return Math.min(clipBars(), 15);
}

/* First and last (inclusive) loop bar indices for the watched clip. */
export function loopStartBar(): number {
    return Math.floor(seqState.loopStart / 16);
}

export function loopEndBar(): number {
    return Math.floor((seqState.loopStart + Math.max(16, seqState.lenSteps) - 1) / 16);
}

export const seqState: SeqUiState = defaults();

export function resetSeqState(): void {
    Object.assign(seqState, defaults());
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
    for (let t = 0; t < 4; t++) {
        const g = tracks[t];
        if (!g) continue;
        for (const ps of g.split('.')) {
            const p = Number(ps);
            if (p >= 0 && p < 128) seqState.activeNotes[t * 128 + p] = 1;
        }
    }
}

export function activeHasNote(track: number, pitch: number): boolean {
    if (track < 0 || track > 3 || pitch < 0 || pitch > 127) return false;
    return seqState.activeNotes[track * 128 + pitch] === 1;
}
