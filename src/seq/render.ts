/* Minimal sequencer screen overlay: short toasts and the header announcement
 * band drawn over the param view, plus the Loop Overview strip.
 *
 * Ownership: app/tick.ts decides redraws. seqToastActive/seqHeaderActive let
 * it keep the frame alive while content is showing; *Tick() ages them. */

import { drawJogToast } from '../renderer/overlay.js';
import { W } from '../renderer/layout.js';
import { fontPrint, fontWidth } from '../font/index.js';
import { songBandTokens, songBandVisible } from './song.js';
import { loopBarCount, loopEndBar, loopStartBar, seqState } from './state.js';
import { NUM_STEP_BUTTONS } from './constants.js';

const TICKS_PER_STEP = 24; // mirror of seq-core

/* Continuous playhead x within the active window: fraction of the LOOP elapsed.
 * `loopStartTick` is required, not optional — posTick is absolute (seq-core seeds
 * it from loop_start_ticks), and the caller that forgot to subtract the window
 * origin pinned the sweep to the right edge for a whole mid-clip loop. */
export function playheadX(posTick: number, loopStartTick: number, lenSteps: number, stripW: number): number {
    const lenTicks = Math.max(lenSteps, 16) * TICKS_PER_STEP;
    if (lenTicks <= 0) return 0;
    const x = Math.round(((posTick - loopStartTick) / lenTicks) * stripW);
    return Math.max(0, Math.min(x, stripW - 1));
}

const DEFAULT_TTL = 60; // ticks (~0.3s at the ~196 Hz device rate)

/* Header announcement: a short inverted band at the top of the screen for
 * view-switch notifications (Note/Session/Loop). Placed at the top so it
 * never covers the bottom loop/bar strip. */
let headerText = '';
let headerTtl = 0;

export function seqHeaderAnnounce(msg: string, ttlTicks: number = DEFAULT_TTL): void {
    headerText = msg;
    headerTtl = ttlTicks;
}

export function seqHeaderActive(): boolean { return headerTtl > 0; }

export function seqHeaderTick(): void {
    if (headerTtl > 0) headerTtl--;
}

export function drawSeqHeader(): void {
    if (headerTtl <= 0) return;
    fill_rect(0, 0, W, 9, 1);              // inverted header band
    fontPrint(2, 1, headerText, 0);
}

export function resetSeqHeader(): void { headerText = ''; headerTtl = 0; }

/* Loop-mode readout. The timed announcement flashed for ~0.3 s and then left the
 * screen with nothing saying which window you were editing; while Loop mode is on
 * this band stays up and tracks navigation. Bars are 1-based here so the numbers
 * match the step buttons the user is looking at. */
export function loopHeaderText(): string {
    const first = loopStartBar() + 1;
    const last = loopEndBar() + 1;
    const window = first === last ? `${first}` : `${first}-${last}`;
    return `LOOP ${window}  BAR ${seqState.barOffset + 1}`;
}

export function drawLoopHeader(): void {
    fill_rect(0, 0, W, 9, 1);              // inverted band, as the announcement uses
    fontPrint(2, 1, loopHeaderText(), 0);
}

/* Loop Overview strip: one segment per bar at the very bottom of the display —
 * thick = selected bar (thin if the loop is a single bar), thin = in-loop bar, a
 * small "+" = a bar outside the loop (the navigable empty bar), and a vertical
 * line sweeps across at the play position. Drawn over the param view; a toast
 * temporarily covers it. */
const STRIP_Y = 62; // baseline row (display is 64 tall)

export function drawLoopStrip(): void {
    // Clear the strip band so the sweep doesn't leave trails.
    fill_rect(0, STRIP_Y - 2, W, 4, 0);
    // No clip in the current slot → no bar line at all (clipBars() floors to 1,
    // so guard on the real emptiness signal).
    if (seqState.lenSteps === 0) return;
    /* The strip spans the ACTIVE window, extended to reach the selected bar when
     * the user has navigated outside it. Absolute bar indices throughout — the
     * loop can start anywhere, and reading lenSteps as a bar count drew the
     * segments at bars 1..N while the loop played somewhere else entirely. */
    const first = loopStartBar();
    const last = loopEndBar();
    const from = Math.min(first, seqState.barOffset);
    const to = Math.max(last, seqState.barOffset);
    const view = to - from + 1;
    const segW = Math.max(3, Math.floor(W / view));
    const single = first === last;

    for (let bar = from; bar <= to; bar++) {
        const x0 = (bar - from) * segW;
        const cx = x0 + Math.floor(segW / 2);
        if (bar >= first && bar <= last) {
            const selected = bar === seqState.barOffset;
            const thick = selected && !single;
            fill_rect(x0 + 1, thick ? STRIP_Y - 1 : STRIP_Y, segW - 2, thick ? 2 : 1, 1);
        } else {
            // "+" marker for a bar outside the loop (navigated into).
            fill_rect(cx - 1, STRIP_Y, 3, 1, 1);
            fill_rect(cx, STRIP_Y - 1, 1, 3, 1);
        }
    }

    // Playhead sweep: continuous, confined to the active window's segments.
    if (seqState.playing) {
        const originX = (first - from) * segW;
        const windowW = loopBarCount() * segW;
        const px = playheadX(seqState.posTick, first * NUM_STEP_BUTTONS * TICKS_PER_STEP,
            seqState.lenSteps, windowW);
        fill_rect(originX + px, STRIP_Y - 2, 1, 4, 1);
    }
}

let text = '';
let ttl = 0;

/* Flat toast duration: ~1s at the device's ~196 ticks/s. Toasts were too
 * brief to read; every toast now shows for this fixed time regardless of any
 * value a caller passes. */
const TOAST_TTL = 196;

export function seqToast(msg: string): void {
    text = msg;
    ttl = TOAST_TTL;
}

export function seqToastActive(): boolean {
    return ttl > 0;
}

/* The toast currently showing ('' when none) — read by tests. */
export function seqToastText(): string {
    return ttl > 0 ? text : '';
}

/* Age the toast one tick. Returns true on the tick it expires, so the caller
 * can force one repaint of the underlying view to erase it. */
export function seqToastTick(): boolean {
    if (ttl > 0) {
        ttl--;
        return ttl === 0;
    }
    return false;
}

export function drawSeqToast(): void {
    if (ttl > 0) drawJogToast(text);
}

export function resetSeqToast(): void {
    text = '';
    ttl = 0;
}

/* Song band: the bottom row in Session view. Inverted, like the header
 * announcement — `SONG` then the scene numbers in the order they were pressed,
 * with the entry now playing boxed out of the band so you can see where in the
 * arrangement you are.
 *
 * Unlike the Loop strip this does NOT repaint every tick: nothing in it moves
 * between scene changes. songBandTick draws only when the content changed, or
 * when the view underneath was repainted over it. */
const SONG_Y = 55;      // band top; the display is 64 tall and the band is 9
const SONG_GAP = 2;

let lastSongSig = '';

function songBandSig(): string {
    return seqState.songScenes.join(',') + '@' + seqState.songPos;
}

export function drawSongBand(): void {
    fill_rect(0, SONG_Y, W, 9, 1);              // inverted band
    let x = 2;
    fontPrint(x, SONG_Y + 1, 'SONG', 0);
    x += fontWidth('SONG') + SONG_GAP * 2;
    const { tokens, leading } = songBandTokens(
        seqState.songScenes, seqState.songPos, W - x - 2, fontWidth);
    if (leading) {
        fontPrint(x, SONG_Y + 1, '.', 0);
        x += fontWidth('.') + SONG_GAP;
    }
    for (const t of tokens) {
        const w = fontWidth(t.label);
        if (x + w > W - 1) break;
        if (t.current) {
            /* Boxed rather than inverted again: the band is already inverted,
             * so the entry now playing is a hole punched back through it. */
            fill_rect(x - 1, SONG_Y, w + 2, 9, 0);
            fontPrint(x, SONG_Y + 1, t.label, 1);
        } else {
            fontPrint(x, SONG_Y + 1, t.label, 0);
        }
        x += w + SONG_GAP;
    }
}

/** Draw the band if it needs drawing. `viewRepainted` is true on a tick whose
 *  frame redrew the view underneath, which paints over the band. */
export function songBandTick(viewRepainted: boolean): void {
    if (!songBandVisible()) { lastSongSig = ''; return; }
    const sig = songBandSig();
    if (!viewRepainted && sig === lastSongSig) return;
    lastSongSig = sig;
    drawSongBand();
}

export function resetSongBand(): void { lastSongSig = ''; }
