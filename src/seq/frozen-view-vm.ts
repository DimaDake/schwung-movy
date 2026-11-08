/* What a frozen track's screen draws, as data (renderer/frozen-view.ts).
 *
 * The waveform shows ONLY the playable part: the clip's current loop window
 * inside the stretch its loop was recorded over (a Loop-mode cut narrows it).
 * The playhead comes from the engine's position of the watched clip. */

import { seqState } from './state.js';
import { frozenName, freezePeaksSeq } from './freeze.js';
import { frozenWave } from './freeze-wave.js';

const TICKS_PER_STEP = 24;   // 96 PPQN / 4 (mirror of seq-core)
export const WAVE_COLS = 128;

export type FrozenViewVM = {
    label: string;
    name: string;
    slot: number;
    slotCount: number;
    /** 0..255 per screen column; empty when the slot has no loop (yet). */
    cols: number[];
    /** Playhead column, or -1 (stopped, or another clip than the one shown). */
    playX: number;
    empty: boolean;
};

/** What the frozen screen depends on, cheaply: which clip, which window, the
 *  playhead column, and whether its waveform changed (freeze-screen.ts). */
export function frozenViewSig(track: number): string {
    const st = seqState.session[track];
    const slot = st ? (st.playing >= 0 ? st.playing : st.selected) : 0;
    const len = seqState.lenSteps;
    const x = len > 0 && seqState.playing
        ? Math.floor(((seqState.posTick / TICKS_PER_STEP - seqState.loopStart) / len) * WAVE_COLS) : -1;
    return slot + ':' + seqState.loopStart + ':' + len + ':' + x + ':' + freezePeaksSeq();
}

export function buildFrozenViewVM(track: number, chainIdx: number, slotCount: number): FrozenViewVM {
    const st = seqState.session[track];
    const playing = st && st.playing >= 0 ? st.playing : -1;
    const slot = playing >= 0 ? playing : (st ? st.selected : 0);
    const exists = !!st && (st.exist & (1 << slot)) !== 0;
    const wave = exists ? frozenWave(track, slot) : null;
    /* The watched clip is the selected one: its window is known only then. */
    const watched = !!st && st.selected === slot && seqState.lenSteps > 0;
    const winStart = watched ? seqState.loopStart : wave?.recStart ?? 0;
    const winLen = watched ? seqState.lenSteps : wave?.recLen ?? 0;
    const cols: number[] = [];
    if (wave && winLen > 0) {
        const n = wave.peaks.length;
        const a = ((winStart - wave.recStart) / wave.recLen) * n;
        const span = (winLen / wave.recLen) * n;
        for (let x = 0; x < WAVE_COLS; x++) {
            const i0 = Math.floor(a + (x * span) / WAVE_COLS);
            const i1 = Math.max(i0 + 1, Math.floor(a + ((x + 1) * span) / WAVE_COLS));
            let m = 0;
            for (let i = Math.max(0, i0); i < Math.min(n, i1); i++) m = Math.max(m, wave.peaks[i]);
            cols.push(m);
        }
    }
    let playX = -1;
    if (watched && seqState.playing && playing === slot && winLen > 0) {
        const rel = seqState.posTick / TICKS_PER_STEP - winStart;
        if (rel >= 0 && rel < winLen) playX = Math.floor((rel / winLen) * WAVE_COLS);
    }
    return { label: 'T' + (track + 1), name: frozenName(track), slot: chainIdx, slotCount,
             cols, playX, empty: !exists };
}
