/* Granular undo through a generator session (plans/2026-11-01-generator-ux-design.md
 * §2.4, worked example §3). A knob gesture, a hand edit and an option switch
 * are each a step (session-undo.ts); undo and redo swap the step's notes back
 * in place, no regeneration. Below the first step is ORIG, below that the
 * preview closes as if the generator never ran. Keeping the option tags the
 * session's one global entry; undoing that entry reopens the session, while
 * it is still the clip's latest, in the same Set and engine. */

import { appState } from '../app/state.js';
import { paramGet } from '../host/param.js';
import { engineGeneration, seqCmd } from '../seq/engine.js';
import { currentSetUuid } from '../seq/set-session.js';
import { releaseHold } from '../undo/group.js';
import { trackLabel } from '../undo/label.js';
import { peekUndo, popUndo, pushEntry, pushUndoBack } from '../undo/state.js';
import type { UndoEntry, UndoResult } from '../undo/types.js';
import { parseTrackDump } from './clip-dump.js';
import { activate, aiPreviewActive, commitPreview, leave, park, VERBS } from './preview.js';
import { knobsApply, knobsFlush, knobsOpen, knobsShown, knobsSnapshot } from './preview-knobs.js';
import { refreshStart } from './preview-refresh.js';
import { keyOf, type Open, replaceCurrent, S, writeNotes } from './preview-state.js';
import type { Snap } from './session-undo.js';
import { forgetLatest, latestOn, parkSession, takeSession } from './sessions.js';

/* A hand edit reaches the engine with the tick's batch: read it back after. */
export const EDIT_READ_TICKS = 2;

/* The options as shared arrays: a stored option's notes are replaced, never edited in place. */
const snapOf = (o: Open): Snap => ({ index: o.index, options: [...o.p.options], knobs: knobsSnapshot() });

export function sessionStart(o: Open): void { o.steps.start(snapOf(o)); }
export function sessionStep(o: Open): void { o.steps.push(snapOf(o)); }

/** A hand edit on the option showing becomes its notes, and a step. ORIG's
 *  edits stay in the session's one global entry. */
function readEdit(o: Open): void {
    o.editDue = 0;
    if (o.index === 0) { o.steps.touch(); return; }
    const c = parseTrackDump(o.p.track, paramGet('ait:' + o.p.track) ?? '').find((x) => x.slot === o.p.slot);
    if (!c) return;
    o.p.options = [...o.p.options];
    o.p.options[o.index - 1] = c.notes;
    sessionStep(o);
}

export function sessionTick(o: Open): void { if (o.editDue > 0 && --o.editDue === 0) readEdit(o); }

/** Before a step is taken back or the option kept: a turn still to land and
 *  an edit still to read become steps first. */
export function sessionFlush(o: Open): void {
    knobsFlush(replaceCurrent);
    if (o.editDue > 0) readEdit(o);
}

export function restore(o: Open, s: Snap | 'orig'): void {
    if (s === 'orig') {
        seqCmd(`aiload ${o.p.track} ${o.p.slot} 0`);
        o.index = 0;
    } else {
        knobsApply(s.knobs);
        o.p.options = [...s.options];
        o.visited = o.visited.map((_, i) => i === 0);
        o.index = s.index;
        if (s.index === 0) seqCmd(`aiload ${o.p.track} ${o.p.slot} 0`); else writeNotes(o, s.index);
    }
    knobsShown(o.index);
    appState.dirty = true;
}

const result = (o: Open): UndoResult => ({ ok: true, verb: VERBS[o.p.task], target: trackLabel(o.p.track), detail: o.index === 0 ? 'ORIG' : String(o.index) });

export type AiUndo = 'pass' | { result: UndoResult; close?: UndoEntry | null };

/** Undo while the preview is shown: one step back, ORIG, or the preview
 *  closed (`close`: the entry the caller applies, null when there is none). */
export function aiUndo(): AiUndo {
    const o = S.cur;
    if (!o || !aiPreviewActive()) return 'pass';
    sessionFlush(o);
    const s = o.steps.undo();
    if (s !== 'close') { restore(o, s); return { result: result(o) }; }
    const r = result(o);
    return { result: r, close: closeSession() };
}

/** Redo while the preview is shown: one step forward; at the end of a
 *  reopened session, keeping it again. */
export function aiRedo(): AiUndo {
    const o = S.cur;
    if (!o || !aiPreviewActive()) return 'pass';
    sessionFlush(o);
    const s = o.steps.redo();
    if (s) { restore(o, s); return { result: result(o) }; }
    const r = result(o);
    if (o.entry) commitPreview('redo');
    return { result: r };
}

/** Undo below ORIG: the preview closes, the clip as before the generator
 *  ran. A reopened session hands back its entry for the caller to apply. */
export function closeSession(): UndoEntry | null {
    const o = S.cur!;
    leave(o, 'closed by undo at');
    const e = o.entry ?? null;
    releaseHold(e !== null);
    seqCmd(`aiclr ${o.p.track} ${o.p.slot}`);
    forgetLatest(keyOf(o));
    return e;
}

/** An undo of a kept session's entry: the preview again, as it was kept. */
export function reopenSession(o: Open): void {
    if (S.cur) park('a session reopens');
    activate(o, true);
    if (o.p.gen) knobsOpen(o.p.gen.ctx, o.p.gen.picks, o.p.options);
    restore(o, o.steps.top() ?? 'orig');
    refreshStart(o.p.track, o.p.slot);
}

/** Whether undoing `e` reopens its session. */
export function aiReopenable(e: UndoEntry): boolean {
    const ref = e.aiSession;
    if (!ref || e.setUuid !== currentSetUuid() || e.engineGen !== engineGeneration()) return false;
    return latestOn<Open>(ref.key)?.id === ref.id;
}

export function aiReopen(e: UndoEntry): UndoResult {
    const o = latestOn<Open>(e.aiSession!.key)!;
    o.entry = e;
    reopenSession(o);
    o.mark = o.steps.mark();
    return result(o);
}

/** Keeping a reopened session pushes its entry back. Kept as it was reopened
 *  it changed nothing, so the redo past it still holds; changed, it is a new
 *  edit, and a redo recorded over the old take would restore that take. */
export function keepEntry(o: Open): void {
    if (!o.entry) return;
    if (o.mark && o.steps.same(o.mark)) pushUndoBack(o.entry); else pushEntry(o.entry);
    o.entry = o.mark = undefined;
}

/** A parked session whose visit entry is being undone ends where it stands. */
export function aiEndParkedFor(e: UndoEntry): void {
    const ref = e.aiSession;
    const o = ref ? takeSession<Open>(ref.key) : undefined;
    if (!o) return;
    if (o.id !== ref!.id) { parkSession(ref!.key, o); return; }   // another session on that clip
    seqCmd(`aiclr ${o.p.track} ${o.p.slot}`);
}

/** Undo, where a generator session takes it first (undo/apply.ts): a step of
 *  the preview on screen, or `apply` handed the entry a close takes back. A
 *  session open but not shown (a track button held) is kept. */
export function aiUndoFirst(apply: (e: UndoEntry) => void): UndoResult | null {
    const ai = aiUndo();
    if (ai !== 'pass') {
        if (ai.close) {
            /* A session parked and resumed left one entry per visit: closing takes them all back. */
            const ref = ai.close.aiSession;
            apply(ai.close);
            while (ref && sameSession(peekUndo(), ref)) apply(popUndo()!);
        }
        return ai.result;
    }
    /* Kept, then taken back below as plain history: reopening it now would undo nothing. */
    if (S.cur) { plain = { key: keyOf(S.cur), id: S.cur.id }; commitPreview('undo'); }
    return null;
}
let plain: { key: string; id: number } | null = null;
const sameSession = (e: UndoEntry | null, ref: { key: string; id: number }) => !!e?.aiSession && e.aiSession.key === ref.key && e.aiSession.id === ref.id;

/** Undo of the stack's top: a kept session's entry reopens it while it is
 *  the clip's latest; a parked session's visit entry ends that session. */
export function aiUndoTop(top: UndoEntry | null): UndoResult | null {
    if (!top?.aiSession) return null;
    if (plain && sameSession(top, plain)) { forgetLatest(plain.key); plain = null; return null; }
    plain = null;
    if (aiReopenable(top)) { popUndo(); return aiReopen(top); }
    aiEndParkedFor(top);
    return null;
}
