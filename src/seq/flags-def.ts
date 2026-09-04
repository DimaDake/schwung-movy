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
    /** Listed on the page in a RELEASE build, not only in a debug one. Two
     *  settings are a user's business — how much CPU movy takes, and which host
     *  owns tracks 1-4. The rest are measurement instruments. */
    release?: boolean;
    /** Never pushed to the engine under ITS OWN key, because the engine has no
     *  such param. Writing one would cost a blocking round trip on the audio
     *  thread to be told nothing, and would read in the log exactly like a flag
     *  that took.
     *
     *  It does NOT mean the engine is unaffected. Both flags marked `uiOnly`
     *  reach it folded into another key (flags.ts `engineValue`), and that fold
     *  is the load-bearing part: `chtracks` was once `uiOnly` with no fold, so
     *  `drain_out` never heard it and every sequenced note kept going to schwung
     *  while the UI had fully switched over. Mark a flag `uiOnly` only after
     *  answering "and what does the engine do about it?". */
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
 *  happen on any device that has ever opened the page. That is exactly what
 *  happened to `chparallel`: prefs.json held a 0 written during a measurement
 *  session, and the new default reached nobody who had run one. */
export const FLAGS_REV = 2;

/** `chtracks` is an ordinal, not a bool — the third value is what makes the
 *  faster arrangement the default for new work without touching old work. */
export const HOST_SCHWUNG = 0;
export const HOST_MOVY = 1;
export const HOST_NEW_SETS = 2;

/* Release rows first: a release build lists only these, and a debug build reads
 * top-down the same way. */
export const FLAGS: FlagDef[] = [
    {
        key: 'cpuopt', name: 'CPU Optimize',
        hint: 'Speeds up Movy tracks only. Off if it glitches.',
        // The one CPU switch a user gets. Everything under it — lanes, idle
        // skip, pinning — stays hidden at its measured default.
        //
        // uiOnly because the engine has no such param: it is pushed as its
        // EFFECT on `chparallel` and `chidle` (flags.ts `engineValue`). Off is a
        // full serial fallback rather than half of one, because the module that
        // makes someone reach for this is not helped by keeping idle skip.
        min: 0, max: 1, def: 1, bool: true, release: true, uiOnly: true,
    },
    {
        key: 'chtracks', name: 'Tracks 1-4 Host',
        hint: 'MOVY gets the CPU boost. SCHWUNG is stock Schwung.',
        // Tracks 1-4 are schwung's four shadow slots, which render serially on
        // the audio thread. On movy chains 0-3 instead they join the parallel
        // lanes — worth ~20-25% of the chain render, not four tracks' worth: a
        // host track already ran on the same thread as lane 0.
        //
        // NEW SETS by default, and that is the whole feature: it is not free
        // (those tracks give up Move's own mixer fader, per-slot Link Audio and
        // schwung's cached param reads), so a set built expecting schwung keeps
        // it while anything new gets the faster arrangement. The per-set half
        // is `chtrackset`.
        //
        // The value is SCHWUNG, the host those four tracks actually belong to —
        // a movy user meets the name everywhere else (it is the framework movy
        // is a tool for), and a SCHWUNG track behaves exactly as it does without
        // movy: outside the parallel render, on Move's mixer, with per-slot Link
        // Audio. The hints are what carry that, since no row name can.
        //
        // The ENGINE needs the RESOLVED value, not this one: `drain_out` is what
        // decides whether a sequenced note goes out as MIDI or into a chain. It
        // was briefly UI-only, and every sequenced note kept going to schwung
        // while the UI looked entirely switched over.
        // See plans/2026-08-24-movy-hosted-first-tracks.md.
        min: HOST_SCHWUNG, max: HOST_NEW_SETS, def: HOST_NEW_SETS,
        labels: ['SCHWUNG', 'MOVY', 'NEW SETS'], release: true, revisedAt: 2,
    },
    {
        key: 'chtrackset', name: 'This Set',
        hint: 'What this set uses. Saved with it.',
        // The half of `chtracks` the SET carries. Listed only while the mode
        // defers to it (flags-visible.ts) — under an explicit mode it would
        // show a value the knob cannot change, which reads as a broken row.
        //
        // def 1 / legacy 0 is the compatibility rule in two numbers: a set movy
        // has never seen is new work and gets movy chains; a set whose blob was
        // written before this field keeps the schwung slots it was built on.
        //
        // uiOnly for the same reason as `cpuopt`: it reaches the engine folded
        // into `chtracks`.
        min: 0, max: 1, def: 1, legacy: 0, labels: ['SCHWUNG', 'MOVY'],
        release: true, perSet: true, uiOnly: true,
    },
    {
        key: 'chparallel', name: 'Parallel Render',
        hint: 'Renders chains on several threads.',
        // On: measured 2.15x on the twelve-chain obxd ramp and 2.0-2.2x across
        // the mid-weight fleet (docs/track-performance.md §1, §2), which is what
        // takes hera and nusaw from over the frame budget to under it. The
        // engine's own default stays serial — the UI pushes this on every engine
        // boot, and keeping the two apart is what lets a device script detect
        // the flag by writing a value the engine will actually log.
        min: 0, max: 1, def: 1, bool: true, revisedAt: 1,
    },
    {
        key: 'chlanes', name: 'Render Lanes',
        hint: 'How many threads chains render on.',
        // 1 is a real setting, not an alias for serial: it is the parallel path
        // with no helpers. 4 is MAX_LANES in chain_slots.rs.
        min: 1, max: 4, def: 3,
    },
    {
        key: 'chidle', name: 'Idle Skip',
        hint: 'Skips chains that are silent.',
        // An ordinal, not a bool: the FX gate depends on the synth gate.
        // 0 one render_block call (today) · 1 split, never sleeps (the arm
        // chdigest compares against 0) · 2 sleep a silent synth · 3 also sleep
        // a silent FX tail.
        min: 0, max: 3, def: 3,
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
        key: 'chpin', name: 'Pin Duplicates',
        hint: 'Keeps module copies on one thread.',
        // Off by default: modules are assumed thread-safe and the ones proven
        // otherwise go on chain_pin's blacklist. This is the blunt containment
        // for a set that misbehaves before the culprit is known.
        min: 0, max: 1, def: 0, bool: true,
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
        // `cpuopt` and `chtracks` there is no second key carrying its effect.
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

/** Which host owns tracks 1-4, from the global mode and the current set's own
 *  value. Pure and here rather than in `track/`, because both the value store
 *  (which folds it into the engine's `chtracks`) and `track/ref.ts` need the
 *  answer, and neither may import the other. */
export function resolveHost(mode: number, setChoice: number): boolean {
    return mode === HOST_MOVY || (mode === HOST_NEW_SETS && setChoice > 0);
}
