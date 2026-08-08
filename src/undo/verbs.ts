/* Engine verb classification, mirroring is_undoable_edit / is_control_verb in
 * engine/crates/seq-core/src/command.rs.
 *
 * Two copies of one rule is a smell, but the engine cannot see the UI and the
 * UI cannot call into Rust, and BOTH need the answer: the engine to decide what
 * the dirty flag and ucommit mean, the UI to refuse a mutating command that no
 * group would record. The duplication is made safe by
 * `every_command_rs_verb_is_classified` in browser-test/logic.mjs, which reads
 * command.rs itself and fails when the two drift. */

/** User edits — the unit undo restores. */
export const UNDOABLE_VERBS: string[] = [
    // step entry and note editing
    'tog', 'addp', 'del', 'evel', 'elen', 'enudge', 'etrn', 'slen',
    'eprob', 'econd', 'einv',
    // clip shape and clip-level edits
    'clen', 'cscl', 'ctr', 'cq', 'dbl', 'loop', 'ltog',
    'pst',
    // whole-clip gestures
    'clipdel', 'clipdelat', 'clipdup', 'clippaste',
    // automation edits
    'aset', 'asetr', 'aclr', 'aclrs', 'aclrstep',
    // set-level settings
    'mute', 'bpm', 'swing',
    /* Retroactive capture writes the buffered phrase into the clip, and a
     * tempo re-selection rewrites it — both are edits. `capclr`/`capdone` only
     * touch the runtime input buffer and the overlay, so they stay control. */
    'cap', 'capsel',
];

/** Transport, view/selection, bookkeeping, live input, undo machinery. */
export const CONTROL_VERBS: string[] = [
    'play', 'stop', 'rec', 'metro', 'link', 'launch', 'stoptrk',
    'watch', 'wlane', 'clipsel', 'hold', 'tdrum',
    /* Clipboard fills: they change no musical state — only the paste does. */
    'cpy', 'cpyclr', 'clipcopy',
    'non', 'nof',
    'abase', 'abaseq', 'alabel',
    /* `dq` applies a setting the UI owns and persists (ui-state.ts + prefs),
     * so its undo entry is a UI-field op — an engine snapshot could not
     * restore it, because the default is not in the engine's own blob. */
    'dq',
    'capclr', 'capdone',
    'usnap', 'uswap', 'ucommit', 'udrop', 'uclr',
    'cmd',
];

const undoable = new Set(UNDOABLE_VERBS);
const control = new Set(CONTROL_VERBS);

export function verbOf(op: string): string {
    const sp = op.indexOf(' ');
    return sp < 0 ? op : op.slice(0, sp);
}

export function isUndoableVerb(verb: string): boolean { return undoable.has(verb); }
export function isControlVerb(verb: string): boolean { return control.has(verb); }
