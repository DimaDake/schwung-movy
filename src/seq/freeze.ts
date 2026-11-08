/* Freeze — the UI half (plans/2026-10-23-stems-freeze-export-wifi.md, F3).
 *
 * The engine does the work (movy-dsp freeze_bank.rs): it records two passes of
 * every clip of a track, then plays those loops in place of the chain and
 * unloads the chain. This file holds what the status line says about it, the
 * messages, and the guard every editing path asks before it touches a frozen
 * track: a frozen track has to be unfrozen before its notes, clips or sound
 * can change. The menu that freezes is seq/track-menu.ts (Shift + track).
 *
 * Status fields (lib.rs): `frz=<hex mask>` frozen-or-thawing tracks,
 * `frzc=<track>:<done>/<total>:<pct>` the freeze in progress (or `-`),
 * `frzp=<seq>` bumped when a waveform is ready (seq/freeze-wave.ts), and
 * `frze=<seq>:<track>:<code>` the last event, and — while any track is frozen —
 * `frzm=<track>:<module>,...` the module each was frozen from. And from the
 * sequencer, `frzr=<count>:<track>`: an edit the engine refused because the
 * track is frozen (seq-core engine/freeze_lock.rs). The engine enforces the
 * rule whatever door an edit came through; `freezeGuard` only says so first.
 *
 * From the confirm until the capture ends, input and LEDs belong to the
 * capture (seq/freeze-busy.ts). */

import { paramSet } from '../host/param.js';
import { seqToast } from './render.js';
import { showFreezeToast } from './freeze-toast.js';

let frozenMask = 0;
let capture: { track: number; done: number; total: number; pct: number; slot: number; at: number } | null = null;
let peaksSeq = '';
let lastSeq = -1;
let lastRefused = '';
/* A freeze confirmed whose capture the status has not shown yet. */
let pending = -1;
let pendingAt = 0;
const PENDING_MS = 3000;
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
    muted:      (t) => `UNMUTE ${t} TO FREEZE IT`,
    rec:        (t) => `${t} IS RECORDING`,
    speed:      (t) => `${t}: SPEED CANNOT FREEZE`,
    long:       (t) => `${t}: LOOP OVER 60 S`,
    mem:        () => 'FREEZE: MEMORY FULL',
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
        const [tS, dn, pS, sS, aS] = val.split(':');
        const [d, n] = (dn ?? '').split('/').map(Number);
        const t = Number(tS);
        /* In steps of 10: the engine's whole percent moves every ~40 ms, and each
         * new toast text is a full repaint (tick.ts, seqToastVersion). Ten per
         * clip show it moving; a hundred would only cost UI time. */
        const step = Math.floor((Number(pS) || 0) / 10) * 10;
        const next = val === '-' || !Number.isFinite(t) || !Number.isFinite(n)
            ? null : { track: t, done: d || 0, total: n || 1, pct: step, slot: Number(sS) || 0, at: (Number(aS) || 0) / 1000 };
        if (next) pending = -1;
        capture = next;
        if (next) freezeBusyToast();
    } else if (key === 'frzp') {
        peaksSeq = val;
    } else if (key === 'frzr') {
        /* Same first-sight rule as `frze`. */
        if (lastRefused !== '' && val !== lastRefused) showFreezeToast(Number(val.split(':')[1]));
        lastRefused = val;
    } else if (key === 'frze') {
        const [seqS, tS, code] = val.split(':');
        const seq = Number(seqS);
        if (seq !== lastSeq && Number(tS) === pending) pending = -1;
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

/** A freeze is being recorded, or was just confirmed and has not shown up on
 *  the status yet: input and LEDs belong to it (seq/freeze-busy.ts). */
export function freezeBusy(nowMs: number): boolean {
    if (pending >= 0 && nowMs - pendingAt > PENDING_MS) pending = -1;   // no engine answered
    return capture !== null || pending >= 0;
}

/** The freeze's toast, kept up for as long as it runs: which clip of how many,
 *  and how far into it. Same text, no repaint. */
export function freezeBusyToast(): void {
    const t = capture ? capture.track : pending;
    if (t < 0) return;
    const c = capture ?? { done: 0, total: 1, pct: 0, slot: 0, at: 0 };
    seqToast(`FREEZING ${label(t)} ${Math.min(c.done + 1, c.total)}/${c.total} ${c.pct}%`);
}

/** The clip a freeze is recording and where in it (0..1), or null. */
export function freezeCaptureAt(): { track: number; slot: number; at: number } | null {
    return capture ? { track: capture.track, slot: capture.slot, at: capture.at } : null;
}

/** Bumped by the engine whenever a frozen clip's waveform is ready. */
export function freezePeaksSeq(): string {
    return peaksSeq;
}

/**
 * Every path that would change a track's notes, clips or sound asks first.
 * `true` = refused (and the user told why); the caller drops the input.
 */
export function freezeGuard(track: number): boolean {
    if (!isFrozen(track)) return false;
    showFreezeToast(track);
    return true;
}

/** The dialog was confirmed. `name` is the track's synth, while it is still loaded. */
export function freezeConfirm(track: number, unfreeze: boolean, name = '', nowMs = Date.now()): void {
    if (!unfreeze) {
        names[track] = name;
        pending = track;
        pendingAt = nowMs;
        freezeBusyToast();
    }
    paramSet(unfreeze ? 'unfrz' : 'frz', String(track));
}

/** What a frozen track's screen calls it ('' when unknown, e.g. after a reboot). */
export function frozenName(track: number): string {
    return names[track] || (moduleIds[track] ?? '').toUpperCase();
}

/** Back while a capture runs. `true` if it cancelled one. */
export function freezeCancelCapture(): boolean {
    const t = capture ? capture.track : pending;
    if (t < 0) return false;
    paramSet('frzx', String(t));
    pending = -1;
    return true;
}

/** The suites; a fresh boot. */
export function resetFreeze(): void {
    frozenMask = 0;
    capture = null;
    lastSeq = -1;
    lastRefused = '';
    pending = -1;
    peaksSeq = '';
    names.length = 0;
    moduleIds = [];
}
