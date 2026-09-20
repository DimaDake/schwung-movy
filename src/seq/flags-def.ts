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
    /** How a value stored under an OLD numbering survives a renumbered range,
     *  applied once on the same `revisedAt` trigger — for a flag whose VALUES
     *  were renumbered, not only its default. Absent means "no stored value
     *  survives the revision, take `def`" (the ordinary `revisedAt` shape,
     *  unchanged). A plain clamp to the new range is not the same thing: it
     *  gets a shrunk top value right only by coincidence and can land an old
     *  middle value on a new one that means something else entirely. */
    remapAt?: (old: number) => number;
};

/** Bumped whenever a shipped default changes; see `revisedAt`.
 *
 *  A flag is persisted the moment it is edited, and a stored value beats a
 *  changed default forever — so "we turned it on by default" silently does not
 *  happen on any device that has ever opened the page. It has already bitten
 *  once: a flag left off during a measurement session kept its stored 0, and
 *  the new default reached nobody who had run one. */
export const FLAGS_REV = 5;

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
        hint: 'Who draws module knobs. SCHWUNG re-paginates.',
        // WHICH RENDERER DRAWS A MODULE'S PARAMETER PAGE.
        //
        //   MOVY     movy plans the pages and draws them (what always shipped)
        //   SCHWUNG  Schwung plans AND draws; movy targets the parameters
        //
        // Used to be three values: DRAW (movy plans, Schwung only draws the
        // widgets — a restyle) sat between these two, and it is gone (SP-40)
        // — it never earned a release opinion of its own, and carrying a
        // third mode that only ever differed from SCHWUNG by which side drew
        // the pixels was cost with no decision riding on it. What is left is
        // one real decision: re-paginate or don't. The sequencer targets
        // parameters, never page/slot, so lanes follow either way — but what
        // is on which page visibly moves under SCHWUNG.
        //
        // uiOnly with NOTHING FOLDED, which is the rare honest case for that
        // field: the engine has no parameter-page concept at all, so unlike
        // `chtrackset` there is no second key carrying its effect.
        // Pushing it under its own name would cost a blocking round trip on the
        // audio thread to be told the key does not exist.
        //
        // Debug-only for now (no `release`): it is an experiment against movy's
        // own renderer, and the Schwung side still has open gaps — see
        // docs/plans/ and browser-test/app-loop.mjs, which fails on SCHWUNG.
        //
        // revisedAt/remapAt: the VALUES were renumbered, not only the default
        // — DRAW's deletion means old 1 must land on new MOVY (0), not on new
        // SCHWUNG (1) where a plain range clamp would put it (see flags.ts's
        // `ensure()`). Old 0 (MOVY) stays 0; old 2 (PAGE) becomes new 1
        // (SCHWUNG). Do not reuse FLAGS_REV 4 — `engpersist` already adopted
        // against it, and a device past rev 4 must not re-trigger that a
        // second time.
        min: 0, max: 1, def: 0, labels: ['MOVY', 'SCHWUNG'], uiOnly: true,
        revisedAt: 5,
        remapAt: (old) => (old >= 2 ? 1 : 0),
    },
    {
        key: 'engpersist', name: 'Engine Saves',
        hint: 'The engine owns the set file. OFF is the old path.',
        // WHO WRITES THE SET FILES.
        //
        // Off, the UI ferries the whole Set through the overtake_dsp param slot
        // and writes it — the shape every hazard in docs/persistence-hazards.md
        // is about. On, the engine reads and writes its own files and the wire
        // carries only commands, which are idempotent: a lost one costs a retry
        // where a lost payload cost the Set.
        //
        // A runtime switch, so "on, then off again" is an ordinary afternoon
        // during rollout. What makes going back free is the chains mirror in
        // ui-state.json (ui-state.ts) — without it, the old path finds no
        // chains and the flag is not an escape hatch at all.
        //
        // ON since rev 4: every device suite passes with it, including the
        // three arms that only a device could have failed — file permissions
        // (the engine writes as root from Move's audio process, the UI as
        // ableton from the manager's), the fixture seeding the chains mirror
        // instead of the authority, and an autosave that skipped the UI half
        // because the engine had already cleared the dirty flag it asked about.
        //
        // `revisedAt` is what makes the flip arrive: a stored 0 beats a changed
        // default forever, and during rollout everyone who tested this had one.
        min: 0, max: 1, def: 1, revisedAt: 4,
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

