import { seqCmd } from '../seq/engine.js';
import { seqState } from '../seq/state.js';
import { markUiStateDirty } from '../seq/ui-dirty.js';
import { seqToast } from '../seq/render.js';
import { mlog } from '../log.js';

/* Mute and solo, both expressed through the engine's per-track mute — the same
 * channel the Mute button already used. Nothing here touches schwung: solo is
 * movy's own control, so it gates *sequenced notes* (engine.rs:980 keeps the
 * track advancing but emits nothing). Live pad playing on a silenced track and
 * any audio tail still sound; that is the tradeoff against a host-level gate.
 *
 * Solo is derived state: while any track is soloed the engine's mutes no longer
 * represent what the user asked for, so the user's own mutes are captured in
 * `base` when the first solo engages and restored when the last one drops.
 * Muting while soloing edits `base`, so it survives un-solo.
 *
 * Solo overrides mute, as everywhere else (Live, and schwung's own host gate):
 * while a solo is up, what you hear is the soloed tracks — full stop. Deriving
 * the engine mute as `base[t] || !solo[t]` instead left a track you had muted
 * silent even once you soloed it, which made soloing look broken exactly when
 * some tracks were muted.
 *
 * Several tracks can be soloed at once — solo is a per-track toggle, like mute.
 */

const solo: boolean[] = [false, false, false, false];
let base: boolean[] | null = null;   /* user's own mutes, held while a solo is up */

function anySoloOn(): boolean { return solo[0] || solo[1] || solo[2] || solo[3]; }

export function isSoloed(track: number): boolean { return solo[track] === true; }
export function anySolo(): boolean { return anySoloOn(); }
/* What the user asked for, ignoring solo — the state a mute toggle flips. */
export function isMuted(track: number): boolean {
    return base ? base[track] : seqState.muted[track];
}

/* The mirror flips optimistically so the track button dims this tick. */
function setEngineMute(track: number, want: boolean): void {
    if (seqState.muted[track] === want) return;
    seqState.muted[track] = want;
    seqCmd('mute ' + track + ' ' + (want ? 1 : 0));
}

function apply(): void {
    if (anySoloOn()) {
        if (!base) base = [...seqState.muted];
        for (let t = 0; t < 4; t++) setEngineMute(t, !solo[t]);
    } else if (base) {
        for (let t = 0; t < 4; t++) setEngineMute(t, base[t]);
        base = null;
    }
}

export function toggleMute(track: number): void {
    if (track < 0 || track > 3) return;
    if (base) base[track] = !base[track];
    else setEngineMute(track, !seqState.muted[track]);
    mlog('mute t=' + track + ' -> ' + (isMuted(track) ? 1 : 0));
    apply();
    markUiStateDirty();
    seqToast('T' + (track + 1) + (isMuted(track) ? ' MUTED' : ' UNMUTED'));
}

export function toggleSolo(track: number): void {
    if (track < 0 || track > 3) return;
    solo[track] = !solo[track];
    apply();
    /* mutes= is the mirror, which the engine's status poll overwrites — so a
     * line logged after the fact shows what the engine actually holds. */
    mlog('solo t=' + track + ' -> ' + (solo[track] ? 1 : 0)
        + ' set=' + solo.map((s) => (s ? 1 : 0)).join('')
        + ' mutes=' + seqState.muted.map((m) => (m ? 1 : 0)).join('')
        + ' base=' + (base ? base.map((b) => (b ? 1 : 0)).join('') : '-'));
    markUiStateDirty();
    seqToast(soloToast());
}

/* "T2 SOLO" for one, "SOLO T1 T3" for several, "SOLO OFF" for none — the whole
 * solo set, not just the track that changed, since that is the state the user
 * needs to see. */
function soloToast(): string {
    const on: number[] = [];
    for (let t = 0; t < 4; t++) if (solo[t]) on.push(t + 1);
    if (on.length === 0) return 'SOLO OFF';
    if (on.length === 1) return 'T' + on[0] + ' SOLO';
    return 'SOLO ' + on.map((n) => 'T' + n).join(' ');
}

export function resetTrackMutes(): void {
    for (let t = 0; t < 4; t++) solo[t] = false;
    base = null;
}

/* Persisted per set (seq/persist.ts). Solo lives only in movy's memory while
 * its effect — the derived mutes — lives in the engine, so losing this
 * bookkeeping across a reopen would strand those mutes: they would look like
 * the user's own and never be restored. */
export function mutesSnapshot(): { solo: number[]; base: number[] | null } {
    return {
        solo: solo.map((s) => (s ? 1 : 0)),
        base: base ? base.map((b) => (b ? 1 : 0)) : null,
    };
}

/* Restores bookkeeping only — the engine already holds the derived mutes. */
export function restoreMutes(o: { solo?: unknown; base?: unknown }): void {
    if (Array.isArray(o?.solo)) for (let t = 0; t < 4; t++) solo[t] = o.solo[t] === 1;
    base = Array.isArray(o?.base) ? [0, 1, 2, 3].map((t) => (o.base as unknown[])[t] === 1) : null;
}
