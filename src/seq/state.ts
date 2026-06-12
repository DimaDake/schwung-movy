/* Sequencer UI state: the UI-side mirror of engine status plus UI-only
 * interaction state (held steps, modes). The engine (dsp.so) owns the
 * musical truth; this mirror is refreshed by status polls in engine.ts and
 * updated optimistically when the UI issues commands. */

export interface SeqUiState {
    /* engine link */
    engineOk: boolean;       // a status poll has succeeded this session
    playing: boolean;        // transport running
    engineTick: number;      // engine master tick (96 PPQN) at last poll
    bpmX100: number;         // engine tempo, hundredths of BPM
}

function defaults(): SeqUiState {
    return {
        engineOk: false,
        playing: false,
        engineTick: 0,
        bpmX100: 12000,
    };
}

export const seqState: SeqUiState = defaults();

export function resetSeqState(): void {
    Object.assign(seqState, defaults());
}
