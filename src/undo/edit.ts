/* Convenience wrappers over group.ts for the two shapes that cover almost
 * every call site. Kept separate from group.ts so that file stays about the
 * open-group state machine and nothing else. */

import { CLOSE, beginEdit, endEdit, setDetail } from './group.js';

/** A one-shot edit: opens a group, runs the mutation, closes it. The engine
 *  decides whether anything actually changed (ucommit), so a delete on an
 *  already-empty clip costs no undo press. */
export function undoableEdit(verb: string, target: string, fn: () => void): void {
    beginEdit({ key: 'once:' + verb + ':' + target, verb, target, close: CLOSE.IMMEDIATE, seq: true });
    try {
        fn();
    } finally {
        /* finally: a throwing edit must not leave the group open, or every
         * later edit would be swallowed into it. */
        endEdit();
    }
}

/** A one-shot edit whose detail is only known after the mutation (a note
 *  count, a resulting length). */
export function undoableEditWith(verb: string, target: string,
                                 fn: () => string | void): void {
    beginEdit({ key: 'once:' + verb + ':' + target, verb, target, close: CLOSE.IMMEDIATE, seq: true });
    try {
        const detail = fn();
        if (typeof detail === 'string') setDetail(detail);
    } finally {
        endEdit();
    }
}

/** Open (or re-enter) a gesture group that closes on release or idle. Safe to
 *  call on every delta — re-entry with the same key is what coalesces them. */
export function beginGesture(key: string, verb: string, target: string, seq = true): void {
    beginEdit({ key, verb, target, close: CLOSE.TOUCH_RELEASE, seq });
}
