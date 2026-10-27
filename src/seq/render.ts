/* Minimal sequencer screen overlay: short toasts and the header announcement
 * band drawn over the param view, plus the Loop Overview strip.
 *
 * Ownership: app/tick.ts decides redraws. seqToastActive/seqHeaderActive let
 * it keep the frame alive while content is showing; *Tick() ages them. */

import { drawJogToast } from '../renderer/overlay.js';
import { W, TOAST_Y, TOAST_H } from '../renderer/layout.js';
import { fontPrint, fontWidth } from '../font/index.js';
import { songBandTokens, songBandVisible, songTerminal } from './song.js';
import { seqState } from './state.js';

export { drawLoopStrip, playheadX, stripPlayheadX, stripWindow } from './loop-strip.js';

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
/* The band occupies the BOTTOM TOAST's rows, and shares its geometry rather
 * than picking its own: the rows above are the param view's second label row
 * (LBL1_Y + LBL_H reaches row 57), so anything taller than the toast overlaps
 * live UI. Same constants drawJogToast uses. */
const SONG_GAP = 2;

let lastSongSig = '';

function songBandSig(): string {
    return seqState.songScenes.join(',') + '@' + seqState.songPos
        + (songTerminal() ? '!' : '');
}

/** The inverted bottom band with its leading word; returns where tokens start.
 *  Shared by the Song band and the AI preview selector (ai/preview-render.ts). */
export function drawBandLead(lead: string): number {
    fill_rect(0, TOAST_Y, W, TOAST_H, 1);       // inverted band, as the toast draws
    fontPrint(2, TOAST_Y + 1, lead, 0);
    return 2 + fontWidth(lead) + SONG_GAP * 2;
}

/** One band entry at x; `current` is boxed. Returns the x after it, or -1 when
 *  it would not fit (nothing drawn). */
export function drawBandToken(x: number, label: string, current: boolean, gap = SONG_GAP): number {
    const w = fontWidth(label);
    if (x + w > W - 1) return -1;
    if (current) {
        /* Boxed rather than inverted again: the band is already inverted,
         * so the current entry is a hole punched back through it. */
        fill_rect(x - 1, TOAST_Y, w + 2, TOAST_H, 0);
        fontPrint(x, TOAST_Y + 1, label, 1);
    } else {
        fontPrint(x, TOAST_Y + 1, label, 0);
    }
    return x + w + gap;
}

export function drawSongBand(): void {
    let x = drawBandLead('SONG');
    /* A song parked on an empty scene has ENDED. The width it needs comes off
     * the token budget first, so the marker can never be the thing that gets
     * clipped — an arrangement that has stopped must say so. */
    const end = songTerminal();
    const endW = end ? fontWidth('END') + SONG_GAP * 2 : 0;
    const { tokens, leading } = songBandTokens(
        seqState.songScenes, seqState.songPos, W - x - 2 - endW, fontWidth);
    if (leading) {
        fontPrint(x, TOAST_Y + 1, '.', 0);
        x += fontWidth('.') + SONG_GAP;
    }
    for (const t of tokens) {
        const next = drawBandToken(x, t.label, t.current);
        if (next < 0) break;
        x = next;
    }
    if (end) {
        fontPrint(x + SONG_GAP, TOAST_Y + 1, 'END', 0);
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
