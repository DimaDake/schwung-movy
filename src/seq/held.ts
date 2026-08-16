import { TRACK_COUNT } from '../track/ref.js';
/* Per-track "last held" pad set: the MIDI pitches that were held together at
 * the most recent chord entry. Persists after release so the chromatic view
 * can light those pads white (selection memory) and a step press can write the
 * whole set. Kept tiny and allocation-light: one Set per track, reused. */

const lastHeld: Set<number>[] = Array.from({ length: TRACK_COUNT }, () => new Set<number>());

export function setHeldSet(track: number, pitches: number[]): void {
    if (track < 0 || track >= TRACK_COUNT) return;
    const s = lastHeld[track];
    s.clear();
    for (const p of pitches) s.add(p);
}

export function noteHeld(track: number, pitch: number): boolean {
    return track >= 0 && track < TRACK_COUNT && lastHeld[track].has(pitch);
}

/* The track's selected (white) pitches, for placing the whole selection on a
 * step press. Empty when nothing is selected. */
export function heldSetList(track: number): number[] {
    if (track < 0 || track >= TRACK_COUNT) return [];
    return [...lastHeld[track]];
}

export function clearHeldSet(track: number): void {
    if (track >= 0 && track < TRACK_COUNT) lastHeld[track].clear();
}
