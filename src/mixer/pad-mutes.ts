/* Per-voice drum-pad mute and solo — movy's own control over one drum voice of
 * one track, held by the same gesture the track mute uses: Mute (+Shift) and a
 * pad. Unlike the track mute there is no host-level gate to mirror it onto, so
 * it silences the SEQUENCER and leaves live pad playing audible. That is the
 * same trade `track-mutes.ts` makes, for the same reason: playing over a
 * silenced track stays possible.
 *
 * **Sibling of `track-mutes.ts`, and deliberately not merged with it.** A track
 * mute derives its state (one bool per track cannot hold both the user's mute
 * and a solo's imposition, so the UI keeps a `base` and restores it). A pad
 * mute does not have to: the engine holds the mute SET and the solo BESIDE each
 * other, so un-soloing needs no bookkeeping and the user's own mutes are never
 * overwritten. What is left here is the gesture and the read-back mirror.
 *
 * The engine is the truth, and the mirror is `wpad=` in the status — one track's
 * worth, bound to the track it describes (see `seq/state.ts`). Everything the UI
 * asks goes through this file, so "silent" cannot mean one thing to the LED and
 * another to the gesture. */

import { appState } from '../app/state.js';
import { mlog } from '../log.js';
import { drumPadOfNote } from '../keyboard/drum-grid.js';
import { seqCmd } from '../seq/engine.js';
import { watchedTrack } from '../seq/watch.js';
import { seqToast } from '../seq/render.js';
import { seqState } from '../seq/state.js';
import { TRACK_COUNT } from '../track/ref.js';
import { beginEdit, endEdit, CLOSE } from '../undo/group.js';

/* The mirror as it applies to one track, or null when the payload on hand
 * describes a different one — `wpad=` answers for a single track, and it can
 * land after the UI has switched away from it. */
function mirror(track: number): { solo: number; mutes: ReadonlySet<number> } | null {
    return seqState.padMuteTrack === track
        ? { solo: seqState.padSolo, mutes: seqState.padMutes }
        : null;
}

/** Is this voice silenced by the watched track's pad mute or solo? The ONE
 *  definition of it — the drum grid's LED and the gesture both ask here.
 *
 *  Solo is checked first and stands alone: while a solo is up the mute set is
 *  not consulted, so the soloed voice sounds even if it was muted. The engine's
 *  gate and this agree by construction (`Track::pad_voice_silent`). */
export function padVoiceSilent(note: number): boolean {
    const m = mirror(watchedTrack());
    if (!m) return false;
    return m.solo >= 0 ? m.solo !== note : m.mutes.has(note);
}

/** The voice's name for the toast — the rack's own where it declared one, else
 *  its pad number, else the note (a rack that has since changed under a held
 *  button). */
function padLabel(track: number, note: number): string {
    const model = appState.trackModels[track]?.[1];
    const cfg = model ? model.getDrumConfig() : null;
    if (!cfg || !model) return 'NOTE ' + note;
    const pad = drumPadOfNote(note, cfg);
    if (pad < 0) return 'NOTE ' + note;
    return model.getDrumPadNames()[pad - 1] || 'PAD ' + pad;
}

/** Mute (or, with Shift, solo) one drum voice. `solo` follows the track rule:
 *  exclusive and moving, and pressing the soloed voice again clears it. */
export function padMuteGesture(track: number, note: number, solo: boolean): void {
    if (track < 0 || track >= TRACK_COUNT || note < 0 || note > 127) return;
    const before = mirror(track);
    const wasSolo = before ? before.solo === note : false;
    const wasMuted = before ? before.mutes.has(note) : false;
    const label = padLabel(track, note);

    beginEdit({
        key: 'pvoice:' + track + ':' + note,
        verb: solo ? (wasSolo ? 'SOLO OFF' : 'SOLO') : (wasMuted ? 'UNMUTE' : 'MUTE'),
        target: label,
        close: CLOSE.IMMEDIATE, seq: true,
    });
    if (solo) seqCmd('psolo ' + track + ' ' + (wasSolo ? -1 : note));
    else seqCmd('pmute ' + track + ' ' + note + ' ' + (wasMuted ? 0 : 1));
    endEdit();
    /* Reported the way the track mute reports itself (`mute t=… -> …`): one
     * line per press is what lets a device suite read the gesture back without
     * a screen. */
    mlog(solo
        ? 'psolo t=' + track + ' n=' + (wasSolo ? -1 : note)
        : 'pmute t=' + track + ' n=' + note + ' -> ' + (wasMuted ? 0 : 1));

    /* Optimistic mirror, so the pad greys this tick rather than at the next
     * status poll (~40 ms). A payload for another track is replaced outright:
     * what is known about THIS track is nothing, and nothing is exactly what
     * its grid is showing. */
    if (seqState.padMuteTrack !== track) {
        seqState.padMutes.clear();
        seqState.padSolo = -1;
        seqState.padMuteTrack = track;
    }
    if (solo) seqState.padSolo = wasSolo ? -1 : note;
    else if (wasMuted) seqState.padMutes.delete(note);
    else seqState.padMutes.add(note);

    seqToast(solo
        ? (wasSolo ? 'SOLO OFF' : label + ' SOLO')
        : label + (wasMuted ? ' UNMUTED' : ' MUTED'));
}
