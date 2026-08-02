/* Back-step preview: stepping back onto a step plays what is already there, so
 * you hear the note you are about to overwrite (OP-XY's "it will play and its
 * key will light up, ready for you to edit it").
 *
 * The pitches come from the engine's status reply for the new head, so the
 * request made by the arrow is fired here, one poll later. These notes are
 * deliberately NOT in the pad ledger (keyboard/held-notes.ts): no pad is
 * involved, so a preview can never be mistaken for a real pad release and
 * misdirect its note-off. */

import { emitNoteOff } from '../keyboard/release.js';
import { seqState } from './state.js';
import { headStep, previewWanted, takePreview } from './step-rec-head.js';

const PREVIEW_MS = 150;
const GIVE_UP_MS = 500;   // no reply for the new head → drop the request

const sounding: { track: number; pitch: number }[] = [];
let untilMs = 0;
/* When the pending request was first seen, so a step with nothing on it does
 * not leave it armed to fire against some later step's notes. */
let watchingSince = -1;

export function flushPreview(): void {
    for (const n of sounding) emitNoteOff(n.track, n.pitch);
    sounding.length = 0;
    untilMs = 0;
    watchingSince = -1;
}

export function previewTickAt(nowMs: number): void {
    if (sounding.length > 0 && nowMs >= untilMs) flushPreview();
    if (!previewWanted()) { watchingSince = -1; return; }
    if (watchingSince < 0) watchingSince = nowMs;
    if (seqState.holdStep !== headStep() || seqState.holdNotes.length === 0) {
        if (nowMs - watchingSince > GIVE_UP_MS) { takePreview(); watchingSince = -1; }
        return;
    }
    takePreview();
    watchingSince = -1;
    const t = seqState.watchTrack;
    const vel = seqState.holdVel > 0 ? seqState.holdVel : 100;
    for (const p of seqState.holdNotes) {
        const pitch = Math.max(0, Math.min(127, p + seqState.clipTranspose));
        shadow_send_midi_to_dsp([MidiNoteOn | t, pitch, vel]);
        sounding.push({ track: t, pitch });
    }
    untilMs = nowMs + PREVIEW_MS;
}
