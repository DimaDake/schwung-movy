/* The flags the Global Params page lists.
 *
 * One table, so adding a flag is one entry and needs no page code. Everything
 * downstream — persistence, the engine write, the row, the knob range, the LED
 * brightness — is derived from these fields.
 *
 * The page is built to grow into public params, which is why a value is a
 * NUMBER with an optional bool presentation rather than a checkbox: a range
 * that happens to be 0..1 renders as OFF/ON and needs no separate kind. */

export type FlagDef = {
    /** Engine param key — also the prefs.json key, so the two cannot drift. */
    key: string;
    /** What the user reads. Kept short enough to leave room for the value. */
    name: string;
    min: number;
    max: number;
    def: number;
    /** Render as OFF/ON rather than as a number. */
    bool?: boolean;
};

export const FLAGS: FlagDef[] = [
    {
        key: 'chparallel', name: 'Parallel Render',
        min: 0, max: 1, def: 0, bool: true,
    },
    {
        key: 'chlanes', name: 'Render Lanes',
        // 1 is a real setting, not an alias for serial: it is the parallel path
        // with no helpers. 4 is MAX_LANES in chain_slots.rs.
        min: 1, max: 4, def: 3,
    },
    {
        key: 'chpin', name: 'Pin Duplicates',
        // Off by default: modules are assumed thread-safe and the ones proven
        // otherwise go on chain_pin's blacklist. This is the blunt containment
        // for a set that misbehaves before the culprit is known.
        min: 0, max: 1, def: 0, bool: true,
    },
];

export function flagDef(key: string): FlagDef | null {
    for (const f of FLAGS) if (f.key === key) return f;
    return null;
}

export function clampFlag(def: FlagDef, v: number): number {
    if (typeof v !== 'number' || !isFinite(v)) return def.def;
    return Math.max(def.min, Math.min(def.max, Math.round(v)));
}

/** What the value column shows. */
export function flagValueLabel(def: FlagDef, v: number): string {
    if (def.bool) return v > 0 ? 'ON' : 'OFF';
    return String(v);
}

/** 0..1 for the knob LED. A one-value range would divide by zero; it reads as
 *  fully lit, which is honest — the knob is active and cannot move. */
export function flagNormalized(def: FlagDef, v: number): number {
    const span = def.max - def.min;
    if (span <= 0) return 1;
    return (clampFlag(def, v) - def.min) / span;
}
