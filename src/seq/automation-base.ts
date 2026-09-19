/* automation-base.ts — what an automated parameter goes back to.
 *
 * SP-36. A lane DRIVES its parameter: the engine emits a CC on every step that
 * carries a lock, the chain applies it inside the DSP, and a read of that param
 * answers the lane's value — there is no other copy of it anywhere. So "what
 * the user dialled in" is not a thing that can be read back from the module; it
 * is a thing movy has to remember, and it already does, once per edit, in the
 * `abase`/`abaseq` it sends the engine (`automation.ts`).
 *
 * THIS IS A MIRROR, NOT A SECOND SOURCE OF TRUTH. The engine's `lane_base` is
 * the base — it is what playback reverts to — and every write here sits beside
 * the command that sets it. The one case a mirror cannot cover is a Set the
 * engine restored, whose lanes the UI rebuilds from `alabels` without ever
 * having emitted their bases; `seedFromEngine` fills those from the engine's
 * own `abases` read-back, which is why that key exists.
 *
 * RAW UNITS, NOT THE WIRE'S 7 BITS, wherever movy knows them. The wire is
 * `norm7` (0..127) because that is what a chain CC carries, and coming back the
 * other way it costs precision the display can see: on a 3-option enum the
 * round trip lands between options. So a base movy itself recorded is kept in
 * the parameter's own units, and the 7-bit form is used only for the seed,
 * where it is the only number there is.
 */

/* track:lane → the parameter's own value. Not a nested array: the map is
 * empty on most tracks and is read once per drawn cell. */
const bases = new Map<string, number>();

const id = (track: number, lane: number): string => track + ':' + lane;

/** Record the base movy just told the engine about. */
export function noteLaneBase(track: number, lane: number, raw: number): void {
    if (lane < 0 || lane >= 8 || !isFinite(raw)) return;
    bases.set(id(track, lane), raw);
}

/** The base for a lane, in the parameter's own units, or null if unknown. */
export function laneBase(track: number, lane: number): number | null {
    const v = bases.get(id(track, lane));
    return v === undefined ? null : v;
}

export function clearLaneBase(track: number, lane: number): void {
    bases.delete(id(track, lane));
}

export function resetLaneBases(): void { bases.clear(); }

/**
 * Fill in the bases movy never sent — the engine's own `abases`, in `alabels`'
 * shape (tracks `,`, lanes `.`, an unassigned lane `-`).
 *
 * ONLY WHERE MOVY HAS NOTHING, deliberately. A base movy recorded this session
 * is in the parameter's units and is exact; the engine's is the same number
 * after a 7-bit round trip, so overwriting would blur a value for no gain — and
 * the two cannot disagree about anything else, because the UI is what set it.
 *
 * `rangeOf` is the lane's registry entry, which is what turns 0..127 back into
 * the parameter's units. A lane with no entry is skipped rather than guessed:
 * the registry is rebuilt from `alabels` immediately before this runs, so a
 * missing one means the lane was dropped, and inventing a range for it would
 * put a pointer on a parameter that has no page.
 */
export function seedFromEngine(
    abases: string,
    rangeOf: (track: number, lane: number) => { min: number, max: number } | null,
): void {
    const tracks = abases.split(',');
    for (let t = 0; t < tracks.length; t++) {
        const lanes = tracks[t].split('.');
        for (let l = 0; l < 8 && l < lanes.length; l++) {
            const s = lanes[l];
            if (!s || s === '-') continue;
            if (bases.has(id(t, l))) continue;
            const v7 = parseInt(s, 10);
            if (!isFinite(v7)) continue;
            const r = rangeOf(t, l);
            if (!r) continue;
            bases.set(id(t, l), r.min + (Math.max(0, Math.min(127, v7)) / 127) * (r.max - r.min));
        }
    }
}
