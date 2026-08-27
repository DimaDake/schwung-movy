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
export const FLAGS_REV = 1;

export const FLAGS: FlagDef[] = [
    {
        key: 'chparallel', name: 'Parallel Render',
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
        // 1 is a real setting, not an alias for serial: it is the parallel path
        // with no helpers. 4 is MAX_LANES in chain_slots.rs.
        min: 1, max: 4, def: 3,
    },
    {
        key: 'chidle', name: 'Idle Skip',
        // An ordinal, not a bool: the FX gate depends on the synth gate.
        // 0 one render_block call (today) · 1 split, never sleeps (the arm
        // chdigest compares against 0) · 2 sleep a silent synth · 3 also sleep
        // a silent FX tail.
        min: 0, max: 3, def: 3,
    },
    {
        key: 'setcommit', name: 'Commit New Sets',
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
        key: 'chtracks', name: 'Movy Tracks 1-4',
        // Tracks 1-4 are schwung's four shadow slots, which render serially on
        // the audio thread. On, they become movy chains 0-3 instead and join
        // the parallel lanes. Worth ~20-25% of the chain render, not four
        // tracks' worth — a host track already ran on the same thread as lane 0.
        //
        // Off by default because it is not free: those tracks give up Move's own
        // mixer fader, per-slot Link Audio, and schwung's cached param reads.
        //
        // The ENGINE needs this too, not just the UI: `drain_out` is what
        // decides whether a sequenced note goes out as MIDI or into a chain. It
        // was briefly UI-only, and every sequenced note kept going to schwung
        // while the UI looked entirely switched over.
        // See plans/2026-08-24-movy-hosted-first-tracks.md.
        min: 0, max: 1, def: 0, bool: true,
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
