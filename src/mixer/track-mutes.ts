import { undoableEdit } from '../undo/edit.js';
import { trackLabel } from '../undo/label.js';
import { seqCmd } from '../seq/engine.js';
import { releaseLiveOnTrack } from '../keyboard/release.js';
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
 * Solo is exclusive: soloing another track moves the solo rather than adding to
 * it, and pressing the soloed track again clears it.
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

/* The mirror flips optimistically so the track button dims this tick. Muting
 * also cuts any live pad note currently held on that track — mute means silence
 * now, not at pad release. Notes pressed *after* the mute still sound: playing
 * over a silenced track stays possible (see the module comment above); this only
 * stops a note that was already ringing from outliving the mute. */
function setEngineMute(track: number, want: boolean): void {
    if (seqState.muted[track] === want) return;
    seqState.muted[track] = want;
    if (want) releaseLiveOnTrack(track);
    undoableEdit(want ? 'MUTE' : 'UNMUTE', trackLabel(track),
        () => seqCmd('mute ' + track + ' ' + (want ? 1 : 0)));
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
    const was = solo[track];
    for (let t = 0; t < 4; t++) solo[t] = false;   // exclusive — one solo at a time
    solo[track] = !was;
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

function soloToast(): string {
    for (let t = 0; t < 4; t++) if (solo[t]) return 'T' + (t + 1) + ' SOLO';
    return 'SOLO OFF';
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
    /* Keeps the first soloed track only: blobs written before solo became
     * exclusive can name several. */
    if (Array.isArray(o?.solo)) {
        let seen = false;
        for (let t = 0; t < 4; t++) {
            solo[t] = !seen && o.solo[t] === 1;
            if (solo[t]) seen = true;
        }
    }
    base = Array.isArray(o?.base) ? [0, 1, 2, 3].map((t) => (o.base as unknown[])[t] === 1) : null;
}
