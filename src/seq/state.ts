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

    /* watched clip (active track's selected clip) */
    watchTrack: number;      // track whose clip the step LEDs show
    curStep: number;         // playhead step within the watched clip
    lenSteps: number;        // watched clip loop length in steps (0 = empty)
    occ: Uint8Array;         // 256-bit step occupancy bitmap

    /* note entry */
    lastPitch: number[];     // per-track: last played pitch (step-entry value)
    lastVel: number[];       // per-track: last played velocity
}

function defaults(): SeqUiState {
    return {
        engineOk: false,
        playing: false,
        engineTick: 0,
        bpmX100: 12000,
        watchTrack: 0,
        curStep: 0,
        lenSteps: 0,
        occ: new Uint8Array(32),
        lastPitch: [60, 60, 60, 60],
        lastVel: [100, 100, 100, 100],
    };
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
