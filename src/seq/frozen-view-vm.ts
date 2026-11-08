/* What a frozen (or freezing) track's screen draws, as data
 * (renderer/frozen-view.ts).
 *
 * Frozen: the selected clip's waveform laid out on the Loop strip's own bars
 * (`stripWindow`), so a bar of audio sits over its strip segment and the
 * playhead is the strip's, extended up through the wave (the note view's
 * inverted column, seq/frozen-playhead.ts). Only the playable part: a
 * Loop-mode cut narrows the window inside the stretch it was recorded over.
 *
 * Freezing: the clip being recorded, across the whole width, growing as the
 * engine draws it; the playhead is where the capture writes. */

import { seqState, loopBarCount, loopStartBar } from './state.js';
import { frozenName, freezePeaksSeq, freezeCaptureAt } from './freeze.js';
import { frozenWave, type FrozenWave } from './freeze-wave.js';
import { stripPlayheadX, stripWindow } from './loop-strip.js';

export const WAVE_COLS = 128;
export const WAVE_TOP = 11;      // under the header and the slot bar
export const WAVE_BOT = 57;      // over the toast / strip band
const MID = (WAVE_TOP + WAVE_BOT) >> 1;
const HALF = (WAVE_BOT - WAVE_TOP) >> 1;

export type FrozenViewVM = {
    label: string;
    name: string;
    slot: number;
    slotCount: number;
    /** 0..255 per screen column (0 = nothing drawn there). */
    cols: number[];
    empty: boolean;
    recording: boolean;
};

/** Peak of `wave` over steps [s0, s1) of the clip. */
function peakOver(wave: FrozenWave, s0: number, s1: number): number {
    const n = wave.peaks.length;
    const i0 = Math.floor(((s0 - wave.recStart) / wave.recLen) * n);
    const i1 = Math.max(i0 + 1, Math.floor(((s1 - wave.recStart) / wave.recLen) * n));
    let m = 0;
    for (let i = Math.max(0, i0); i < Math.min(n, i1); i++) m = Math.max(m, wave.peaks[i]);
    return m;
}

function selectedSlot(track: number): { slot: number; exists: boolean } {
    const st = seqState.session[track];
    const slot = st ? st.selected : 0;
    return { slot, exists: !!st && (st.exist & (1 << slot)) !== 0 };
}

export function buildFrozenViewVM(track: number, chainIdx: number, slotCount: number): FrozenViewVM {
    const { slot, exists } = selectedSlot(track);
    const wave = exists && seqState.lenSteps > 0 ? frozenWave(track, slot) : null;
    const cols = new Array(WAVE_COLS).fill(0);
    if (wave) {
        const { fromBar, segW } = stripWindow();
        const x0 = (loopStartBar() - fromBar) * segW;
        const width = loopBarCount() * segW;
        /* The strip's own mapping (loop-strip.ts `playheadX`): from the loop's
         * first bar, over at least one bar — so the playhead lands on the
         * audio it plays. Outside the playable window: nothing. */
        const len = seqState.lenSteps;
        const first = loopStartBar() * 16;
        const span = Math.max(len, 16);
        for (let x = Math.max(0, x0); x < Math.min(WAVE_COLS, x0 + width); x++) {
            const s0 = first + ((x - x0) / width) * span;
            if (s0 < seqState.loopStart || s0 >= seqState.loopStart + len) continue;
            cols[x] = peakOver(wave, s0, s0 + span / width);
        }
    }
    return { label: 'T' + (track + 1), name: frozenName(track), slot: chainIdx, slotCount,
             cols, empty: !exists, recording: false };
}

export function buildFreezingViewVM(track: number, chainIdx: number, slotCount: number): FrozenViewVM {
    const c = freezeCaptureAt();
    const wave = c && c.track === track ? frozenWave(track, c.slot) : null;
    const cols = new Array(WAVE_COLS).fill(0);
    if (wave) {
        for (let x = 0; x < WAVE_COLS; x++) {
            const s0 = wave.recStart + (x / WAVE_COLS) * wave.recLen;
            cols[x] = peakOver(wave, s0, s0 + wave.recLen / WAVE_COLS);
        }
    }
    return { label: 'T' + (track + 1), name: frozenName(track), slot: chainIdx, slotCount,
             cols, empty: false, recording: true };
}

/** The lit run of column `x`: the wave, centred. */
export function waveSpans(vm: FrozenViewVM, x: number): [number, number][] {
    const v = vm.cols[x] ?? 0;
    if (v <= 0) return [];
    const h = Math.max(1, Math.round((v / 255) * HALF));
    return [[MID - h, 2 * h]];
}

/** The frozen screen's playhead: the strip's, while the selected clip plays. */
export function frozenPlayX(track: number): number {
    const st = seqState.session[track];
    return st && st.playing >= 0 && st.playing === st.selected ? stripPlayheadX() : -1;
}

/** The freezing screen's playhead: where the capture writes. */
export function freezingPlayX(): number {
    const c = freezeCaptureAt();
    return c ? Math.min(WAVE_COLS - 1, Math.floor(c.at * WAVE_COLS)) : -1;
}

/** What the frozen screen depends on besides its playhead (freeze-screen.ts). */
export function frozenViewSig(track: number): string {
    const { slot } = selectedSlot(track);
    const w = stripWindow();
    return slot + ':' + seqState.loopStart + ':' + seqState.lenSteps + ':' + w.fromBar + ':' + w.bars
        + ':' + freezePeaksSeq();
}
