/* The AI preview (design §5.2): ORIG + up to three options for one clip.
 * The engine stashes a full copy of the clip per option (aistash/aiload), so
 * moving away from an option and back finds it exactly as edited; an option
 * never visited is written fresh (aiclip, quantize 0 so the model's timing
 * plays as written). Everything from open to commit is ONE undo entry. */

import { appState } from '../app/state.js';
import { mlog } from '../log.js';
import { seqCmd } from '../seq/engine.js';
import { seqState } from '../seq/state.js';
import { watchedTrack } from '../seq/watch.js';
import { beginEdit, CLOSE, holdGroup, releaseHold } from '../undo/group.js';
import { trackLabel } from '../undo/label.js';
import { formatNotes } from './clip-dump.js';
import { endAiPreview, type AiPreviewInput } from './job.js';

interface Open {
    p: AiPreviewInput;
    index: number;          // 0 = ORIG
    visited: boolean[];
    sig: string;            // what must not change under the preview
}

let cur: Open | null = null;

export function aiPreviewActive(): boolean { return cur !== null; }
export function previewIndex(): number { return cur ? cur.index : -1; }
export function previewCount(): number { return cur ? cur.p.options.length : 0; }

/* Switching track or clip, the view, or Session commits (design §5.2). Song
 * mode moving the PLAYING clip does not: that is not the user leaving. */
function sig(track: number): string {
    return [watchedTrack(), seqState.session[track]?.selected, appState.currentView, seqState.sessionMode].join('|');
}

function write(o: Open, i: number): void {
    const { track: t, slot: s } = o.p;
    if (o.visited[i]) { seqCmd(`aiload ${t} ${s} ${i}`); return; }
    seqCmd(`aiclip ${t} ${s} ${o.p.len} ${o.p.scaleNum} ${o.p.scaleDen} 0 ${formatNotes(o.p.options[i - 1])}`);
    o.visited[i] = true;
}

function go(o: Open, j: number): void {
    if (j === o.index) return;
    seqCmd(`aistash ${o.p.track} ${o.p.slot} ${o.index}`);
    write(o, j);
    o.index = j;
    appState.dirty = true;
}

export function openPreview(p: AiPreviewInput): void {
    const key = 'ai:' + p.track;
    beginEdit({ key, verb: p.task === 'quantize' ? 'AI QUANT' : 'AI VARIATION', target: trackLabel(p.track),
        close: CLOSE.IMMEDIATE, seq: true });
    holdGroup(key);
    cur = { p, index: 0, visited: [true, false, false, false], sig: sig(p.track) };
    mlog(`ai: preview t${p.track} s${p.slot} ${p.options.length} options`);
    go(cur, 1);
}

export function previewSwitch(delta: number): void {
    if (!cur) return;
    go(cur, Math.max(0, Math.min(cur.p.options.length, cur.index + delta)));
}

/** Keep what is showing, edits and all. */
export function commitPreview(why = 'commit'): void {
    if (!cur) return;
    mlog(`ai: preview kept option ${cur.index} (${why})`);
    cur = null;
    seqCmd('aiclr');
    releaseHold(true);
    endAiPreview();
    appState.dirty = true;
}

/** Per tick; one string compare while previewing, nothing otherwise. */
export function aiPreviewTick(): void {
    if (!cur) return;
    const now = sig(cur.p.track);
    if (now !== cur.sig) commitPreview(`left: ${cur.sig} -> ${now}`);
}

/** Jog turn switches, jog click and Back commit, the knobs are idle; every
 *  other control passes through, so the clip stays editable. */
export function previewInput(data: number[]): boolean {
    if (!cur || (data[0] & 0xF0) !== 0xB0) return false;
    const [, cc, v] = data;
    if (cc === MoveMainKnob) { previewSwitch(decodeDelta(v)); return true; }
    if (cc === MoveMainButton || cc === MoveBack) { if (v > 0) commitPreview(cc === MoveBack ? 'back' : 'jog click'); return true; }
    return cc >= 71 && cc <= 78;
}

export function resetPreview(): void { cur = null; }
