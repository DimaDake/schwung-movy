/* Freeze — the UI half (plans/2026-10-23-stems-freeze-export-wifi.md, F3).
 *
 * The engine does the work (movy-dsp freeze_bank.rs): it records two passes of
 * a track's active clip, then plays that loop in place of the chain and
 * unloads the chain. This file holds what the status line says about it, the
 * gesture (Shift + double tap on a track button), the messages, and the guard
 * every editing path asks before it touches a frozen track: a frozen track has
 * to be unfrozen before its notes, clips or sound can change.
 *
 * Status fields (lib.rs): `frz=<hex mask>` frozen-or-thawing tracks,
 * `frzc=<track>:<pct>` the capture in progress (or `-`), and
 * `frze=<seq>:<track>:<code>` the last event, and — while any track is frozen —
 * `frzm=<track>:<module>,...` the module each was frozen from. */

import { paramSet } from '../host/param.js';
import { seqToast } from './render.js';
import { C_WHITE, TRACK_COLOR } from './colors.js';

/* The same window Loop mode's double tap on a bar uses (loop-mode.ts). */
const DOUBLE_TAP_MS = 450;

let frozenMask = 0;
let capture: { track: number; pct: number } | null = null;
let lastSeq = -1;
let lastTap = { track: -1, ms: -DOUBLE_TAP_MS };
/* The synth each frozen track was, taken when the freeze was confirmed — the
 * chain is unloaded afterwards, so it cannot be asked any more. */
const names: string[] = [];
/* The engine's module id per frozen track (`frzm`): the name after a reboot,
 * when the display name taken at the freeze is gone. */
let moduleIds: string[] = [];

const MESSAGES: Record<string, (t: string) => string> = {
    frozen:     (t) => `${t} FROZEN`,
    thawed:     (t) => `${t} UNFROZEN`,
    stopped:    () => 'FREEZE CANCELLED',
    asked:      () => 'FREEZE CANCELLED',
    noclip:     (t) => `${t}: NO CLIP TO FREEZE`,
    notplaying: (t) => `LAUNCH ${t}'S CLIP FIRST`,
    nochain:    (t) => `${t}: NOTHING TO FREEZE`,
    busy:       (t) => `${t} IS BUSY`,
    /* `set`: a Set change took the capture with it; the new Set is the news. */
};

function label(track: number): string { return 'T' + (track + 1); }

/** One status field (engine-status.ts hands over `frz`, `frzc`, `frze`). */
export function freezeStatusField(key: string, val: string): void {
    if (key === 'frz') {
        frozenMask = parseInt(val, 16) || 0;
        /* `frzm` only rides while something is frozen. */
        if (frozenMask === 0) moduleIds = [];
    } else if (key === 'frzm') {
        moduleIds = [];
        for (const pair of val.split(',')) {
            const i = pair.indexOf(':');
            if (i > 0) moduleIds[Number(pair.slice(0, i))] = pair.slice(i + 1);
        }
    } else if (key === 'frzc') {
        const [t, p] = val.split(':').map(Number);
        /* In steps of 10: the engine's whole percent moves every ~40 ms, and each
         * new toast text is a full repaint (tick.ts, seqToastVersion). Ten per
         * capture show it moving; a hundred would only cost UI time. */
        const step = Math.floor((p || 0) / 10) * 10;
        const next = val === '-' || !Number.isFinite(t) ? null : { track: t, pct: step };
        if (next && (!capture || next.pct !== capture.pct)) seqToast(`FREEZING ${label(next.track)} ${next.pct}%`);
        capture = next;
    } else if (key === 'frze') {
        const [seqS, tS, code] = val.split(':');
        const seq = Number(seqS);
        /* The first status after a boot reports an old event: remember it, say
         * nothing. Only an event that happens while we watch is news. */
        if (lastSeq >= 0 && seq !== lastSeq) {
            const msg = MESSAGES[code];
            if (msg) seqToast(msg(label(Number(tS))));
        }
        lastSeq = seq;
    }
}

/** The chain is unloaded behind a loop (frozen, or on its way back). */
export function isFrozen(track: number): boolean {
    return track >= 0 && (frozenMask & (1 << track)) !== 0;
}

/** The track being recorded for a freeze right now, or -1. */
export function freezeCapturing(): number {
    return capture ? capture.track : -1;
}

/**
 * Every path that would change a track's notes, clips or sound asks first.
 * `true` = refused (and the user told why); the caller drops the input.
 */
export function freezeGuard(track: number): boolean {
    if (!isFrozen(track)) return false;
    seqToast(`UNFREEZE ${label(track)} FIRST`);
    return true;
}

/**
 * A Shift + track-button press. `true` on the SECOND press of the same track
 * within the window — the caller opens the Freeze / Unfreeze dialog instead of
 * switching. The first press is an ordinary track press.
 */
export function freezeTrackTap(track: number, nowMs: number): boolean {
    const second = lastTap.track === track && nowMs - lastTap.ms <= DOUBLE_TAP_MS;
    lastTap = second ? { track: -1, ms: -DOUBLE_TAP_MS } : { track, ms: nowMs };
    return second;
}

/** The dialog was confirmed. `name` is the track's synth, while it is still loaded. */
export function freezeConfirm(track: number, unfreeze: boolean, name = ''): void {
    if (!unfreeze) names[track] = name;
    paramSet(unfreeze ? 'unfrz' : 'frz', String(track));
}

/** What a frozen track's screen calls it ('' when unknown, e.g. after a reboot). */
export function frozenName(track: number): string {
    return names[track] || (moduleIds[track] ?? '').toUpperCase();
}

/** Back while a capture runs. `true` if it cancelled one. */
export function freezeCancelCapture(): boolean {
    if (!capture) return false;
    paramSet('frzx', String(capture.track));
    return true;
}

/* ── The pads of a frozen track ─────────────────────────────────────────────
 * They play nothing (the chain is unloaded), so instead of a keyboard they say
 * so: "FROZEN" scrolling right to left, white on ice blue. 3x4 letters, a
 * blank column between them; one column every STEP_MS. The grid is diffed
 * against the LED cache and paced by the LED budget like any pad repaint, so
 * a scroll step costs at most the pads that actually change. */
const ICE = TRACK_COLOR[2];   // Azure Blue dim: the palette's one cool hue that reads as blue
const STEP_MS = 220;
const TEXT = 'FROZEN ';
/* Rows top to bottom; bit 2 = left column. */
const GLYPHS: Record<string, number[]> = {
    F: [0b111, 0b100, 0b110, 0b100],
    R: [0b110, 0b101, 0b110, 0b101],
    O: [0b111, 0b101, 0b101, 0b111],
    Z: [0b111, 0b001, 0b100, 0b111],
    E: [0b111, 0b110, 0b100, 0b111],
    N: [0b101, 0b111, 0b111, 0b101],
};
const SPAN = TEXT.length * 4;

/** Colour of pad `idx` (0 = bottom-left, 31 = top-right) at `nowMs`. */
export function frozenPadColor(idx: number, nowMs: number): number {
    const row = 3 - Math.floor(idx / 8);          // 0 = top row
    const col = idx % 8;
    const x = (col + Math.floor(nowMs / STEP_MS)) % SPAN;
    const glyph = GLYPHS[TEXT[Math.floor(x / 4)]];
    const cx = x % 4;
    if (!glyph || cx === 3) return ICE;
    return (glyph[row] >> (2 - cx)) & 1 ? C_WHITE : ICE;
}

/** The suites; a fresh boot. */
export function resetFreeze(): void {
    frozenMask = 0;
    capture = null;
    lastSeq = -1;
    lastTap = { track: -1, ms: -DOUBLE_TAP_MS };
    names.length = 0;
    moduleIds = [];
}
