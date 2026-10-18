/* Loop-mode note view: while Loop mode is on in a Track view, the screen above
 * the Loop strip shows the watched clip's notes (layout: note-layout.ts) and the
 * knobs do nothing.
 *
 * Cost: the note list is fetched only when the engine's digest (`nh=`) moves,
 * at most every FETCH_MS, and only while the view is up. The view is painted
 * whole only when its layout changes or the frame under it was repainted;
 * otherwise a tick touches just the playhead's old and new columns. */

import { W } from '../renderer/layout.js';
import { appState, VIEW_CHAIN, VIEW_KEYS, VIEW_KNOBS } from '../app/state.js';
import { paramGet } from '../host/param.js';
import { columnSpans, hatchRows, layoutNotes, NV_BOT, NV_TOP, type NoteEv, type NoteRun } from './note-layout.js';
import { drawSeqHeader, seqHeaderActive, stripPlayheadX, stripWindow } from './render.js';
import { seqState } from './state.js';

/* Recording turns every pad hit into a digest change; a get blocks a few ms
 * on device, so a busy take is sampled rather than chased. */
const FETCH_MS = 100;
const HEADER_H = 9;

let notes: NoteEv[] = [];
let fetchedHash = '';
let lastFetchMs = -FETCH_MS;
let runs: NoteRun[] = [];
let drawnKey = '';
let playX = -1;

/** Loop mode owns the screen and the knobs in the Track views. */
export function noteViewActive(): boolean {
    if (!seqState.loopMode || seqState.sessionMode) return false;
    const v = appState.currentView;
    return v === VIEW_KNOBS || v === VIEW_CHAIN || v === VIEW_KEYS;
}

export function parseNoteList(s: string): NoteEv[] {
    const out: NoteEv[] = [];
    if (!s) return out;
    for (const item of s.split(',')) {
        const [tick, gate, pitch] = item.split('.').map(Number);
        if (tick >= 0 && gate >= 0 && pitch >= 0 && pitch <= 127) out.push({ tick, gate, pitch });
    }
    return out;
}

function refresh(nowMs: number): void {
    if (seqState.noteHash === fetchedHash || nowMs - lastFetchMs < FETCH_MS) return;
    lastFetchMs = nowMs;
    const s = paramGet('notes');
    if (s === null) return;          // no engine: keep what is shown, ask again
    fetchedHash = seqState.noteHash;
    notes = parseNoteList(s);
}

/* A held (still-recording) note has gate 0: it ends at the playhead, or at the
 * loop end once the playhead has wrapped past its start. */
function liveNotes(): { list: NoteEv[]; heldEnd: number } {
    let heldEnd = -1;
    const list = notes.map((n) => {
        if (n.gate > 0) return n;
        const end = seqState.posTick >= n.tick ? seqState.posTick
            : (seqState.loopStart + seqState.lenSteps) * 24;
        heldEnd = Math.max(heldEnd, end);
        return { tick: n.tick, gate: Math.max(1, end - n.tick), pitch: n.pitch };
    });
    return { list, heldEnd };
}

function paintColumn(x: number, top: number, inverted: boolean): void {
    fill_rect(x, top, 1, NV_BOT - top + 1, inverted ? 1 : 0);
    for (const [y, h] of columnSpans(runs, x)) {
        const y0 = Math.max(y, top);
        if (y + h > y0) fill_rect(x, y0, 1, y + h - y0, inverted ? 0 : 1);
    }
}

function paintAll(top: number): void {
    fill_rect(0, NV_TOP, W, NV_BOT - NV_TOP + 1, 0);
    for (const r of runs) {
        if (!r.hatched) fill_rect(r.x, r.y0, r.w, r.h, 1);
        else for (const y of hatchRows(r)) fill_rect(r.x, y, r.w, 1, 1);
    }
    if (top > NV_TOP) drawSeqHeader();   // the announcement sits over the notes
}

/* Per tick while the view is up. `repainted` = the frame under it was redrawn
 * this tick (the view branch cleared the screen). */
export function noteViewTick(repainted: boolean, nowMs: number = Date.now()): void {
    refresh(nowMs);
    const win = stripWindow();
    const { list, heldEnd } = liveNotes();
    const top = seqHeaderActive() ? HEADER_H : NV_TOP;
    /* A held note grows a column at a time: key on the column it reaches, not
     * the tick, or a hold would repaint the whole view every tick. */
    const heldCol = heldEnd < 0 ? -1
        : Math.floor(((heldEnd - win.fromBar * 384) * win.segW) / 384);
    const key = `${fetchedHash}|${notes.length}|${win.fromBar}|${win.bars}|${win.segW}|${heldCol}`;
    if (repainted || key !== drawnKey) {
        if (key !== drawnKey) runs = layoutNotes(list, win).runs;
        drawnKey = key;
        paintAll(top);
        playX = -1;
    }
    const px = stripPlayheadX();
    if (px === playX) return;
    if (playX >= 0) paintColumn(playX, top, false);
    if (px >= 0) paintColumn(px, top, true);
    playX = px;
}

/** Test hook: the list as if just fetched for the current digest. */
export function seedNoteViewForTest(list: NoteEv[]): void {
    notes = list;
    fetchedHash = seqState.noteHash;
}

/** A fresh session (or a test): nothing fetched, nothing on screen. */
export function resetNoteView(): void {
    notes = [];
    fetchedHash = '';
    lastFetchMs = -FETCH_MS;
    runs = [];
    drawnKey = '';
    playX = -1;
}
