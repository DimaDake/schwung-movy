/* Undo entry model — the shapes the three domains share.
 *
 * One entry is one user action, and an action routinely spans domains: loading
 * a module writes a schwung param AND frees the automation lanes bound to the
 * old module's params. So an entry carries whatever combination of domain work
 * it needs, and undo applies all of it as a unit. */

/** A chain-param write and its inverse. Params have no side effects, so the
 *  old value is the entire inverse — no snapshot needed. */
export interface ParamOp {
    slot: number;
    key: string;      // full param key, e.g. "synth:cutoff"
    old: string;
    new: string;
}

/** A module or preset swap. Destructive: the outgoing module is torn down, so
 *  restoring it needs its params dumped before the swap. */
export interface ModuleOp {
    slot: number;
    componentKey: string;
    /* What to WRITE to put each side back. Track chain slots load a module by
     * its id, master FX slots by its DSP path (schwung's asymmetric
     * convention) — so the value is not interchangeable with the identity. */
    oldWrite: string;
    newWrite: string;
    /* Every identifier the READ key may report for each side (id and DSP path).
     * Reads and writes do not agree on a single form — `moduleReadKey` picks
     * the key, and which identifier comes back depends on the slot kind — so
     * membership is the only comparison that holds for both. */
    oldIds: string[];
    newIds: string[];
    /* Ordered selector → preset → the rest; `leadCount` is how many leading
     * entries are selector+preset. module-apply writes those, waits for the DSP
     * to finish re-applying the preset, then writes the rest — see
     * module-dump.ts for why the order is load-bearing. */
    /* schwung's own whole-module save/restore blob, when the module supports
     * it (`<component>:state`). Present = the params below are unused: writing
     * the blob back restores everything at once. */
    oldState?: string;
    newState?: string;
    /* Fallback for modules that expose no state blob. */
    oldParams: [string, string][];
    leadCount: number;
    /* The incoming module's params, captured lazily on the first undo — at
     * record time it did not exist yet, so there was nothing to dump. Without
     * these, redo replayed the OLD module's values into the NEW module. */
    newParams?: [string, string][];
    newLeadCount?: number;
}

/** Set-level state that lives in the UI (root note, scale). See ui-fields.ts
 *  for why these cannot ride in the engine snapshot. */
export interface UiOp {
    field: string;
    old: string;
    new: string;
}

/**
 * A whole-module snapshot taken before a PRESET change.
 *
 * A preset param's inverse is lossy: writing the old index back makes the DSP
 * re-apply that preset's DEFAULTS, silently discarding whatever the user had
 * tweaked since loading it. schwung's `<component>:state` blob is the only
 * thing that carries those tweaks, so a preset change records one.
 *
 * Undo-only. Redo genuinely IS "pick preset N again", which the param op
 * already expresses — and re-applying the new preset's defaults is exactly
 * what the user did the first time.
 */
export interface StateOp {
    slot: number;
    componentKey: string;
    oldState: string;
    /* The state AFTER the change, captured lazily on the first undo. A preset
     * change does not need it — redo is "pick that preset again" and the param
     * op says so — but a RANDOMISER has no such op: re-firing it would roll a
     * different patch, so redo has to restore the exact one it produced. */
    newState?: string;
}

export interface UndoEntry {
    /* Label parts, composed at capture time — the engine state they describe
     * is gone by the time the toast is drawn. */
    verb: string;      // "CLEAR CLIP", "CUTOFF"
    target: string;    // "T2 · CLIP 3"
    detail: string;    // "12 NOTES", "0.42 > 0.31"
    /* Engine snapshot ids. `before` is the state to restore on undo; `after`
     * is filled by the uswap that undoes this entry, and is what redo returns
     * to. */
    seqSnap?: { before: number; after: number };
    paramOps: ParamOp[];
    uiOps: UiOp[];
    stateOp?: StateOp;
    moduleOp?: ModuleOp;
    /* Guards. The stack is cleared when either changes, because a snapshot id
     * means nothing in a different set or a reloaded (empty) engine. */
    setUuid: string;
    engineGen: number;
}

export interface UndoResult {
    ok: boolean;
    verb: string;
    target: string;
    detail: string;
    /* Why nothing happened: 'empty' | 'drift' | 'busy'. Drives the toast. */
    reason?: string;
}
