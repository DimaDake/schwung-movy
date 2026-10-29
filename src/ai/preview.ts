/* The AI preview (design §5.2): ORIG + up to three Smart Quantize or eight
 * Variation options for one clip. The engine stashes a full copy of the clip
 * per option (aistash/aiload), so an option left and come back to is exactly
 * as edited; one never visited is written fresh (aiclip, quantize 0).
 * A session belongs to its clip (user, 2026-10-29): leaving the clip parks it
 * (sessions.ts), coming back takes it up; only Back or a jog click keeps an
 * option. One undo per visit. A held track button shows the pages beneath. */

import { appState, VIEW_CHAIN, VIEW_KEYS, VIEW_KNOBS } from '../app/state.js';
import { jogHintTouch, jogTouched } from '../app/jog-hint.js';
import { mlog } from '../log.js';
import { trackButtonHeld } from '../mixer/track-volume.js';
import { seqCmd } from '../seq/engine.js';
import { seqHeaderAnnounce } from '../seq/render.js';
import { seqState } from '../seq/state.js';
import { watchedTrack } from '../seq/watch.js';
import { beginEdit, CLOSE, holdGroup, releaseHold } from '../undo/group.js';
import { trackLabel } from '../undo/label.js';
import { type AiNote, formatNotes } from './clip-dump.js';
import { endAiPreview, type AiPreviewInput } from './job.js';
import { entryStep } from './job-types.js';
import { type KnobsSnap, knobsName, knobsOpen, knobsReset, knobsRestore, knobsSave, knobsShown, knobsTick } from './preview-knobs.js';
import { clearParked, clipKey, hasParked, parkSession, takeSession } from './sessions.js';
import { refreshStart, refreshStop, refreshTick } from './preview-refresh.js';
import './preview-relength.js';

interface Open {
    p: AiPreviewInput;
    index: number;          // 0 = ORIG
    visited: boolean[];
    knobs: KnobsSnap | null; // while parked
}

let cur: Open | null = null;
const VERBS = { quantize: 'SMART QUANT', variation: 'VARIATION', double: 'SMART DOUBLE', create: 'NEW CLIP' } as const;

const keyOf = (o: Open): string => clipKey(o.p.track, o.p.slot);

/** A session is open on the clip on screen (shown or not). */
export function aiSessionOpen(): boolean { return cur !== null; }
/** The preview owns the screen and the jog: open, and no track button held. */
export function aiPreviewActive(): boolean { return cur !== null && !trackButtonHeld(); }
/** The step whose icon names the open session's generator; -1 none. */
export function aiSessionStep(): number { return cur ? entryStep(cur.p.task) : -1; }
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

/* The clip a session may show on: the watched one, in a Track view. Song mode
 * moving the PLAYING clip does not move it: that is not the user leaving. */
function here(): string | null {
    const v = appState.currentView;
    if (seqState.sessionMode || (v !== VIEW_KNOBS && v !== VIEW_CHAIN && v !== VIEW_KEYS)) return null;
    const t = watchedTrack();
    return clipKey(t, seqState.session[t]?.selected ?? 0);
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

/* One undo per visit to the clip, the AI change itself on the first. */
function activate(o: Open): void {
    cur = o;
    const key = 'ai:' + keyOf(o);
    beginEdit({ key, verb: VERBS[o.p.task], target: trackLabel(o.p.track),
        close: CLOSE.IMMEDIATE, seq: true });
    holdGroup(key);
}

function park(why: string): void {
    const o = cur!;
    o.knobs = knobsSave();
    cur = null;
    refreshStop();
    knobsReset();
    jogHintTouch(false);
    releaseHold(true);
    parkSession(keyOf(o), o);
    mlog(`ai: parked t${o.p.track} s${o.p.slot} (${why})`);
    appState.dirty = true;
}

function resume(o: Open): void {
    activate(o);
    if (o.knobs) knobsRestore(o.knobs);
    o.knobs = null;
    refreshStart(o.p.track, o.p.slot);
    knobsShown(o.index);
    mlog(`ai: resumed t${o.p.track} s${o.p.slot} option ${o.index}`);
    appState.dirty = true;
}

export function openPreview(p: AiPreviewInput): void {
    if (cur) park('another opens');
    /* A request finishing on a clip whose session is parked replaces it. */
    if (takeSession(clipKey(p.track, p.slot))) seqCmd(`aiclr ${p.track} ${p.slot}`);
    const o: Open = { p, index: 0, visited: [true, ...p.options.map(() => false)], knobs: null };
    activate(o);
    mlog(`ai: preview t${p.track} s${p.slot} ${p.options.length} options`);
    if (p.gen) knobsOpen(p.gen.ctx, p.gen.picks, p.options);
    go(o, 1);
}

export function previewSwitch(delta: number): void {
    if (!cur) return;
    go(cur, Math.max(0, Math.min(cur.p.options.length, cur.index + delta)));
}

/** Keep what is showing, edits and all. */
export function commitPreview(why = 'commit'): void {
    if (!cur) return;
    const { track: t, slot: s } = cur.p;
    mlog(`ai: preview kept option ${cur.index} t${t} s${s} (${why})`);
    cur = null;
    refreshStop();
    /* The jog hold named an option; a finger still resting after the click
     * must not turn into the view's own CLICK JOG hint. */
    jogHintTouch(false);
    knobsReset();
    seqCmd(`aiclr ${t} ${s}`);
    releaseHold(true);
    endAiPreview();
    appState.dirty = true;
}

/** Every session ends where it stands: a Set change, an undo or redo. */
export function endAllPreviews(why: string): void {
    commitPreview(why);
    if (clearParked().length) { seqCmd('aiclr'); mlog(`ai: parked sessions ended (${why})`); }
}

/** A clip deleted or pasted over: its session is over. */
export function aiForgetClip(track: number, slot: number): void {
    const key = clipKey(track, slot);
    if (cur && keyOf(cur) === key) commitPreview('clip replaced');
    else if (takeSession(key)) seqCmd(`aiclr ${track} ${slot}`);
}

/** Per tick: parks and takes up sessions as the clip on screen changes. */
export function aiPreviewTick(): void {
    if (!cur && !hasParked()) return;
    const want = here();
    if (want !== (cur ? keyOf(cur) : null)) {
        if (cur) park(`left for ${want ?? 'another view'}`);
        const o = want === null ? undefined : takeSession<Open>(want);
        if (o) resume(o);
    }
    if (!cur) return;
    /* A finger on the jog names the generator in the top strip at once, kept
     * up while held the way a held knob's is; a held knob, announced after, wins. */
    if (jogTouched() && !trackButtonHeld()) seqHeaderAnnounce('GENERATOR: ' + previewName(), JOG_NAME_TTL);
    refreshTick();
    knobsTick(replaceCurrent);
}

export function resetPreview(): void { cur = null; clearParked(); refreshStop(); knobsReset(); }

/** New Clip remade at `len` (preview-relength.ts): the one showing written. */
export function previewRemade(len: number, options: AiNote[][]): void {
    const o = cur!;
    o.p.options = options;
    o.p.len = len;
    o.visited = o.visited.map((_, i) => i === 0);
    if (o.index > 0) write(o, o.index);
    appState.dirty = true;
}
export function previewInputOpen(): AiPreviewInput | null { return cur ? cur.p : null; }
