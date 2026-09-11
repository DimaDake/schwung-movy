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
    /** Word labels, indexed from `min`, for a value OFF/ON cannot say. */
    labels?: string[];
    /** One sentence under the list, for whichever row is selected. Every flag
     *  has one: a name short enough for the row is never long enough to say
     *  what the setting DOES, and the page is the only place a user meets it.
     *
     *  Two lines is the whole band — `browser-test/logic/flags.mjs` wraps every
     *  hint at the real font and fails a third line, because the renderer would
     *  cut it mid-sentence and only the device would show it. */
    hint: string;
    /** Listed on the page in a RELEASE build, not only in a debug one. The rest
     *  are measurement instruments. */
    release?: boolean;
    /** Never pushed to the engine under ITS OWN key, because the engine has no
     *  such param. Writing one would cost a blocking round trip on the audio
     *  thread to be told nothing, and would read in the log exactly like a flag
     *  that took.
     *
     *  It does NOT always mean the engine is unaffected. A flag can reach the
     *  engine folded into another key. The deleted `chtracks` was once `uiOnly`
     *  with no fold, so `drain_out` never heard it and every sequenced note kept
     *  going to schwung while the UI had fully switched over. Mark a flag
     *  `uiOnly` only after answering "and what does the engine do about it?". */
    uiOnly?: boolean;
    /** The value lives in the SET's ui-state.json, not in prefs.json. */
    perSet?: boolean;
    /** What a `perSet` flag reads as in a set whose blob predates the field.
     *  Distinct from `def`, which is what a set movy has never seen gets: the
     *  two differ exactly when a new default must not reach an existing set. */
    legacy?: number;
    /** The `FLAGS_REV` at which this flag's DEFAULT changed. A prefs.json older
     *  than that has its stored value ignored once, so the new default actually
     *  reaches a device that already has an opinion. */
    revisedAt?: number;
};

/** Bumped whenever a shipped default changes; see `revisedAt`.
 *
 *  A flag is persisted the moment it is edited, and a stored value beats a
 *  changed default forever — so "we turned it on by default" silently does not
 *  happen on any device that has ever opened the page. It has already bitten
 *  once: a flag left off during a measurement session kept its stored 0, and
 *  the new default reached nobody who had run one. */
export const FLAGS_REV = 3;

/* Release rows first: a release build lists only these, and a debug build reads
 * top-down the same way. */
export const FLAGS: FlagDef[] = [
    {
        key: 'setcommit', name: 'Commit New Sets',
        hint: 'Asks Move to save a new set.',
        // Move writes a Set to disk only once MOVE itself has something to save
        // in it, so a pad played entirely through schwung is never a real Set
        // and BOTH stores lose it. On, movy sends the gesture that commits it.
        //
        // A flag because of how it has to be sent: schwung's inject drain
        // refuses to feed Move while a tool is overtaking, so movy lowers
        // overtake_mode for the length of one press. That is the transition
        // schwung carries a 3-frame hold for, and the surface belongs to Move
        // for ~1.5 s. Worth it against losing the Set, but worth an off switch.
        min: 0, max: 1, def: 1,
    },
    {
        key: 'schwunggrid', name: 'Param Pages',
        hint: 'Who draws module knobs. PAGE re-paginates.',
        // WHICH RENDERER DRAWS A MODULE'S PARAMETER PAGE.
        //
        //   MOVY    movy plans the pages and draws them (what always shipped)
        //   DRAW    movy plans, Schwung draws the widgets  (a restyle)
        //   PAGE    Schwung plans AND draws; movy targets the parameters
        //
        // Three values rather than a bool because DRAW and PAGE are separate
        // decisions and only one of them moves parameters between pages. PAGE
        // is the one that re-paginates, which is a data-shaped change (the
        // sequencer targets parameters, never page/slot, so lanes follow — but
        // what is on which page visibly moves).
        //
        // uiOnly with NOTHING FOLDED, which is the rare honest case for that
        // field: the engine has no parameter-page concept at all, so unlike
        // `chtrackset` there is no second key carrying its effect.
        // Pushing it under its own name would cost a blocking round trip on the
        // audio thread to be told the key does not exist.
        //
        // Debug-only for now (no `release`): it is an experiment against movy's
        // own renderer, and the Schwung side still has open gaps — see
        // docs/plans/ and browser-test/app-loop.mjs, which fails on PAGE.
        //
        // No `revisedAt`: a brand-new key has no stored value anywhere, so def 0
        // reaches every device without help.
        min: 0, max: 2, def: 0, labels: ['MOVY', 'DRAW', 'PAGE'], uiOnly: true,
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
    if (def.labels) return def.labels[clampFlag(def, v) - def.min] ?? String(v);
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

