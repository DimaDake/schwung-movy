import { portFor } from '../track/registry.js';
import { engineOwnsPads } from '../track/pad-route.js';
import { drainAll, drainTrack } from './held-notes.js';
import { seqState } from '../seq/state.js';

/* The single exit point for live-note note-offs. Every 0x8n movy sends for a
 * pad note goes through here, on the track recorded at note-on — keeping it in
 * one place is what makes "no note-off can pick the wrong channel" checkable
 * rather than a convention. */
export function emitNoteOff(track: number, pitch: number): void {
    /* The engine closes what it opened, from its own ledger. Sending again from
     * here is harmless but pointless; skipping keeps the release path as cheap
     * as the press. */
    if (!engineOwnsPads(track)) portFor(track).sendMidi(MidiNoteOff, pitch, 0);
}

/* Release every sounding live note. Pad LEDs need no explicit repaint: the tick
 * loop paints them from isSounding() on the next pass. */
export function releaseAllLive(): void {
    for (const n of drainAll()) emitNoteOff(n.track, n.pitch);
}

/* Release one track's live notes, leaving other tracks sounding. Used by mute,
 * which is per-track. */
export function releaseLiveOnTrack(track: number): void {
    for (const n of drainTrack(track)) emitNoteOff(n.track, n.pitch);
}

/* Close the engine's open SEQUENCER gates — the notes it opened itself, which
 * the ledger above knows nothing about. `seqState.activeNotes` mirrors them
 * from the `act=` status field, so this works even when the engine has stopped
 * answering.
 *
 * Bounded by track, because teardown wants all of them and a track changing
 * HOST wants only its own: `chtracks` has to release tracks 0-3 while their
 * ports still resolve to the host they were played on, without silencing the
 * twelve that are not moving.
 *
 * Returns how many were closed — a count of zero is what "nothing was
 * sounding" and "the mirror was never populated" both look like, so callers
 * that care log it. */
export function releaseSequencerGates(from: number, to: number): number {
    let gates = 0;
    for (let t = from; t < to; t++) {
        const base = t * 128;
        for (let p = 0; p < 128; p++) {
            if (seqState.activeNotes[base + p] === 1) {
                emitNoteOff(t, p);
                gates++;
            }
        }
    }
    return gates;
}
