/* Per-track "last held" pad set: the MIDI pitches that were held together at
 * the most recent chord entry. Persists after release so the chromatic view
 * can light those pads white (selection memory) and a step press can write the
 * whole set. Kept tiny and allocation-light: one Set per track, reused. */

const lastHeld: Set<number>[] = [new Set(), new Set(), new Set(), new Set()];

export function setHeldSet(track: number, pitches: number[]): void {
    if (track < 0 || track > 3) return;
    const s = lastHeld[track];
    s.clear();
    for (const p of pitches) s.add(p);
}

export function noteHeld(track: number, pitch: number): boolean {
    return track >= 0 && track <= 3 && lastHeld[track].has(pitch);
}

export function clearHeldSet(track: number): void {
    if (track >= 0 && track <= 3) lastHeld[track].clear();
}
