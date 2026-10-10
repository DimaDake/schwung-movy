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
export const FLAGS_REV = 6;

/* Release rows first: a release build lists only these, and a debug build reads
 * top-down the same way. */
export const FLAGS: FlagDef[] = [
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
        // `release`: a user-facing choice, not a measurement instrument, so a
        // shipped build lists it — and MOVY stays selectable for anyone who
        // hits a gap on the Schwung side.
        //
        // Default SCHWUNG since FLAGS_REV 6 (2026-10-08). revisedAt 6 is what
        // makes that arrive: the rev-5 adoption (SP-40's renumbering) wrote a
        // stored 0 to every device that booted it, and a stored value beats a
        // changed default forever. Any value stored before rev 6 — including
        // the pre-SP-40 three-value numbering — is superseded by the new
        // default once, so no remap is needed any more.
        min: 0, max: 1, def: 1, labels: ['MOVY', 'SCHWUNG'], uiOnly: true,
        release: true, revisedAt: 6,
    },
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
    {
        key: 'mstown', name: 'Movy Master Chain',
        hint: 'MASTER page runs movy\'s own master. Next open.',
        // Overtake only: on, the MASTER page drives movy's own master (`mfx:`),
        // as standalone always does — the device test of the standalone
        // master. Schwung's stays behind it (design §5.4). `uiOnly`: it
        // reaches the engine folded into `mfx:own` (chain/master-binding.ts).
        min: 0, max: 1, def: 0, bool: true, uiOnly: true,
    },
    {
        key: 'chpinhost', name: 'Pinned Chain Host',
        hint: 'Tracks run the chain host movy ships. Next open.',
        // WHICH CHAIN HOST MOVY'S TRACKS RUN THROUGH.
        //
        // On, the one movy ships, built from the schwung tag it pins
        // (scripts/build-chain-host.sh). Off, the one schwung installed — which
        // a schwung update can change under movy with no movy change at all,
        // as it did to dbxhost overnight. Upstream chain fixes arrive by
        // bumping the pin instead.
        //
        // The engine reads it when the chain host loads, once per engine boot,
        // so a change applies the next time movy opens. Kept as an escape
        // hatch while the pin is new; deleted with the coexistence code (WP9).
        min: 0, max: 1, def: 1, bool: true,
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

