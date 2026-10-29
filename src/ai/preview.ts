/* The AI preview (design §5.2): ORIG + up to three Smart Quantize or eight
 * Variation options for one clip.
 * The engine stashes a full copy of the clip per option (aistash/aiload), so
 * moving away from an option and back finds it exactly as edited; an option
 * never visited is written fresh (aiclip, quantize 0 so the option's timing
 * plays as written). Everything from open to commit is ONE undo entry. */

import { appState } from '../app/state.js';
import { jogHintTouch, jogHintVisible } from '../app/jog-hint.js';
import { mlog } from '../log.js';
import { seqCmd } from '../seq/engine.js';
import { seqHeaderAnnounce } from '../seq/render.js';
import { seqState } from '../seq/state.js';
import { watchedTrack } from '../seq/watch.js';
import { beginEdit, CLOSE, holdGroup, releaseHold } from '../undo/group.js';
import { trackLabel } from '../undo/label.js';
import { type AiNote, formatNotes } from './clip-dump.js';
import { endAiPreview, type AiPreviewInput } from './job.js';
import { knobsCtx, knobsName, knobsOpen, knobsRemake, knobsReset, knobsShown, knobsTick, knobTouch, knobTurn } from './preview-knobs.js';
import { prepare } from '../gen/engine.js';
import { setLoopLengthHook } from '../seq/loop-hook.js';

interface Open {
    p: AiPreviewInput;
    index: number;          // 0 = ORIG
    visited: boolean[];
    sig: string;            // what must not change under the preview
}

let cur: Open | null = null;
const VERBS = { quantize: 'SMART QUANT', variation: 'VARIATION', double: 'SMART DOUBLE', create: 'NEW CLIP' } as const;

export function aiPreviewActive(): boolean { return cur !== null; }
export function previewIndex(): number { return cur ? cur.index : -1; }
export function previewCount(): number { return cur ? cur.p.options.length : 0; }
export function previewLabels(): string[] {
    return cur ? cur.p.options.map((_, i) => String(i + 1)) : [];
}
/* Seen for about a second after the jog is let go (render.ts toasts). */
const JOG_NAME_TTL = 196;

/** The generator behind the option showing, for the jog-hold toast. */
export function previewName(): string {
    if (!cur) return '';
    return cur.index === 0 ? 'ORIG' : knobsName() || String(cur.index);
}

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
    knobsShown(j);
    appState.dirty = true;
}

/* A knob turn's new take on the option showing: written over it, edits and
 * all (design §5: a turn discards hand edits), and kept as that option. */
function replaceCurrent(notes: AiNote[]): void {
    const o = cur;
    if (!o || o.index === 0) return;
    o.p.options[o.index - 1] = notes;
    seqCmd(`aiclip ${o.p.track} ${o.p.slot} ${o.p.len} ${o.p.scaleNum} ${o.p.scaleDen} 0 ${formatNotes(notes)}`);
    o.visited[o.index] = true;
}

export function openPreview(p: AiPreviewInput): void {
    const key = 'ai:' + p.track;
    beginEdit({ key, verb: VERBS[p.task], target: trackLabel(p.track),
        close: CLOSE.IMMEDIATE, seq: true });
    holdGroup(key);
    cur = { p, index: 0, visited: [true, ...p.options.map(() => false)], sig: sig(p.track) };
    mlog(`ai: preview t${p.track} s${p.slot} ${p.options.length} options`);
    if (p.gen) knobsOpen(p.gen.ctx, p.gen.picks, p.options);
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
    /* The jog hold named an option; a finger still resting after the click
     * must not turn into the view's own CLICK JOG hint. */
    jogHintTouch(false);
    knobsReset();
    seqCmd('aiclr');
    releaseHold(true);
    endAiPreview();
    appState.dirty = true;
}

/** Per tick; one string compare while previewing, nothing otherwise. */
export function aiPreviewTick(): void {
    if (!cur) return;
    const now = sig(cur.p.track);
    if (now !== cur.sig) return commitPreview(`left: ${cur.sig} -> ${now}`);
    /* The jog held names the generator in the top strip, kept up while held
     * the way a held knob's is; a held knob, announced after, wins. */
    if (jogHintVisible()) seqHeaderAnnounce('GENERATOR: ' + previewName(), JOG_NAME_TTL);
    knobsTick(replaceCurrent);
}

/** Jog turn switches, jog click and Back commit, the knobs are the option's
 *  (preview-knobs.ts); every other control passes through, so the clip stays
 *  editable. Knob touches never reach the page underneath. */
export function previewInput(data: number[]): boolean {
    if (!cur) return false;
    const kind = data[0] & 0xF0;
    if ((kind === 0x90 || kind === 0x80) && data[1] < 8) { knobTouch(data[1], kind === 0x90 && data[2] > 0); return true; }
    if (kind !== 0xB0) return false;
    const [, cc, v] = data;
    if (cc === MoveMainKnob) { previewSwitch(decodeDelta(v)); return true; }
    if (cc === MoveMainButton || cc === MoveBack) { if (v > 0) commitPreview(cc === MoveBack ? 'back' : 'jog click'); return true; }
    if (cc >= 71 && cc <= 78) { knobTurn(cc - 71, decodeDelta(v)); return true; }
    return false;
}

export function resetPreview(): void { cur = null; knobsReset(); }

/** Loop Mode set a length while a New Clip preview is open: every option is
 *  made again at it from its own knobs and the preview stays open (the user
 *  sizes the clip without leaving the generator). true = taken here. */
export function previewRelength(len: number): boolean {
    const o = cur;
    const c = knobsCtx();
    if (!o || o.p.task !== 'create' || !c) return false;
    if (len === o.p.len) return true;
    const ctx = prepare({ ...c.input, len });
    o.p.options = knobsRemake(ctx);
    if (o.p.gen) o.p.gen.ctx = ctx;
    o.p.len = len;
    o.visited = o.visited.map((_, i) => i === 0);
    mlog(`ai: preview remade at ${len} steps`);
    if (o.index > 0) write(o, o.index);
    appState.dirty = true;
    return true;
}
setLoopLengthHook(previewRelength);
