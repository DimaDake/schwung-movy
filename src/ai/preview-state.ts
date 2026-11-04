/* The open generator session (preview.ts) and what writes its clip, shared
 * with its undo (preview-undo.ts). */

import { appState } from '../app/state.js';
import { seqCmd } from '../seq/engine.js';
import type { UndoEntry } from '../undo/types.js';
import { type AiNote, formatNotes } from './clip-dump.js';
import type { AiPreviewInput } from './job-types.js';
import { type KnobsSnap, knobsShown } from './preview-knobs.js';
import { clipKey } from './sessions.js';
import type { SessionUndo, StepMark } from './session-undo.js';

export interface Open {
    p: AiPreviewInput;
    index: number;          // 0 = ORIG
    visited: boolean[];
    knobs: KnobsSnap | null; // while parked
    id: number;             // this session, among the clip's (only the latest reopens)
    steps: SessionUndo;
    editDue: number;        // ticks until a hand edit is read back as a step
    /** Reopened by an undo: the session's entry, pushed back on keeping. */
    entry?: UndoEntry;
    mark?: StepMark;        // where it stood when reopened
}

export const S: { cur: Open | null } = { cur: null };

export const keyOf = (o: Open): string => clipKey(o.p.track, o.p.slot);

export function writeNotes(o: Open, i: number): void {
    seqCmd(`aiclip ${o.p.track} ${o.p.slot} ${o.p.len} ${o.p.scaleNum} ${o.p.scaleDen} 0 ${formatNotes(o.p.options[i - 1])}`);
    o.visited[i] = true;
}

export function write(o: Open, i: number): void {
    if (o.visited[i]) { seqCmd(`aiload ${o.p.track} ${o.p.slot} ${i}`); return; }
    writeNotes(o, i);
}

export function go(o: Open, j: number): void {
    if (j === o.index) return;
    seqCmd(`aistash ${o.p.track} ${o.p.slot} ${o.index}`);
    write(o, j);
    o.index = j;
    knobsShown(j);
    appState.dirty = true;
}

/* A knob turn's new take on the option showing: written over it, edits and
 * all (design §5: a turn discards hand edits), and kept as that option. */
export function replaceCurrent(notes: AiNote[]): void {
    const o = S.cur;
    if (!o || o.index === 0) return;
    o.p.options = [...o.p.options];
    o.p.options[o.index - 1] = notes;
    writeNotes(o, o.index);
}
