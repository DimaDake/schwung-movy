/* Ownership ledger for live pad notes — the notes movy sounds directly from the
 * UI, as opposed to the sequencer's gates, which the engine owns and closes
 * itself. Each entry records the track the note was sounded on so a release
 * always reaches the channel that started it, even after the active track, the
 * loaded module, or the current view has changed underneath it. Recomputing
 * either the channel or the pitch at release time is what stranded notes
 * before, so nothing outside this module may do so. */

export interface LiveNote {
    padNote: number;
    track:   number;
    pitch:   number;
}

const live = new Map<number, LiveNote>();   /* padNote → owner */

export function noteSounded(padNote: number, track: number, pitch: number): void {
    live.set(padNote, { padNote, track, pitch });
}

/* Remove and return the pad's note, or undefined if it was never sounding
 * (a shift-select drum pad, or an already-drained release). */
export function noteReleased(padNote: number): LiveNote | undefined {
    const n = live.get(padNote);
    if (n !== undefined) live.delete(padNote);
    return n;
}

export function soundingTrack(padNote: number): number | undefined {
    return live.get(padNote)?.track;
}

export function isSounding(padNote: number): boolean { return live.has(padNote); }

/* Remove and return every entry. Callers emit the note-offs; keeping this
 * module free of MIDI globals is what lets it be tested on its own. */
export function drainAll(): LiveNote[] {
    const out = [...live.values()];
    live.clear();
    return out;
}

/* Remove and return one track's entries, leaving other tracks sounding. */
export function drainTrack(track: number): LiveNote[] {
    const out: LiveNote[] = [];
    for (const [padNote, n] of live) {
        if (n.track === track) {
            out.push(n);
            live.delete(padNote);
        }
    }
    return out;
}

export function soundingCount(): number { return live.size; }
