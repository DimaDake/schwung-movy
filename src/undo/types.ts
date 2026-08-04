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
    oldModuleId: string;
    newModuleId: string;
    oldParams: [string, string][];
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
