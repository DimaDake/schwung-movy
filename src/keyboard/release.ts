import { portFor } from '../track/registry.js';
import { drainAll, drainTrack } from './held-notes.js';

/* The single exit point for live-note note-offs. Every 0x8n movy sends for a
 * pad note goes through here, on the track recorded at note-on — keeping it in
 * one place is what makes "no note-off can pick the wrong channel" checkable
 * rather than a convention. */
export function emitNoteOff(track: number, pitch: number): void {
    portFor(track).sendMidi(MidiNoteOff, pitch, 0);
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
