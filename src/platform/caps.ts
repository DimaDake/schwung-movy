/* What the host can do, asked by feature instead of by host.
 *
 * A call site that needs Move beside it asks `coexistsWithMove`, not "am I the
 * overtake build" — so when the standalone flavour arrives, the features that
 * cannot exist without Move (plan, *Retired by design*) switch off in one
 * place, and nothing else learns there are two hosts. */

export interface Caps {
    /** Move runs beside movy: background mode, LINK, the Move volume divert,
     *  overtake suppression, injecting into Move, set-commit's surface lend. */
    readonly coexistsWithMove: boolean;
    /** Movy can park and keep running under another UI. */
    readonly canSuspend: boolean;
    /** The volume knob is movy's (a master chain), not Move's. */
    readonly ownsMasterVolume: boolean;
}
