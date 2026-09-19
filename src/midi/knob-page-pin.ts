/* Ownership ledger for a knob that is under a finger — the page that heard the
 * PRESS, so the release can be given back to it.
 *
 * A knob release is otherwise routed by asking who owns the page NOW, and the
 * answer can have changed while the knob was down: a chain switch, a module
 * swap, or Session taking the knobs to the master bus all resolve
 * `knobOwner()` to a different page on the way up. The pressed page then never
 * hears the release and keeps the slot in the controller's `touchOrder` — and
 * `touched` is recomputed from `touchOrder` alone (`page_controller.mjs`), so
 * it stays >= 0 for the life of that controller. That is not a stale highlight:
 * movy's jog-click guard reads `ctl.state.touched >= 0` as "a knob is under the
 * hand" and hands every later click to the page instead of movy, and the
 * controller has no staleness expiry for a held knob on purpose (it refuses to
 * re-plan under a hand), so nothing ages the latch out.
 *
 * The rule is the one `keyboard/held-notes.ts` states for note-offs, and for
 * the same reason: the release must come from what the PRESS recorded, never
 * from current state. Nothing outside this module may re-derive it.
 *
 * Keyed by knob index (0..7) rather than by page, because that is what a
 * release carries — the capacitive note is the only identifier the two halves
 * share. A `null` page is legal and means "nothing owed": a movy-owned page and
 * a claimed page whose contract has not resolved both answer `null`, and
 * recording that as a PIN rather than an absence is what would route a later
 * release onto a page that never heard a press. */

export interface TouchablePage {
    knobTouch(slot: number, down: boolean): void;
}

const pinned = new Map<number, TouchablePage>();   /* knobIndex → the page that heard the press */

/* Record what the press landed on. `null` clears any entry for that knob, so a
 * fresh press can never inherit a pin from an earlier gesture. */
export function pinPage(knob: number, page: TouchablePage | null): void {
    if (page) pinned.set(knob, page);
    else pinned.delete(knob);
}

/* Remove and return the page owed this release, or undefined if the press
 * recorded none (a movy-owned page, or a release with no press). */
export function unpinPage(knob: number): TouchablePage | undefined {
    const p = pinned.get(knob);
    if (p !== undefined) pinned.delete(knob);
    return p;
}

export function pinnedCount(): number { return pinned.size; }

/* Forget every pin. Callers are the ones that know the releases cannot come
 * back — movy handing the foreground away, or a fresh open. A pin left across
 * that boundary would deliver a release to the page of a previous session. */
export function clearPins(): void { pinned.clear(); }
