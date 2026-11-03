/* The AI preview (design §5.2): ORIG + the options for one clip, the picks
 * first and the rest past them (plans/2026-11-01-generator-ux-design.md
 * §2.2). The engine stashes a full copy of the clip
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
import { beginEdit, CLOSE, holdGroup, onAbsorbedGesture, releaseHold, tagAiSession } from '../undo/group.js';
import { pushEntry } from '../undo/state.js';
import { trackLabel } from '../undo/label.js';
import { type AiNote, formatNotes } from './clip-dump.js';
import { go, keyOf, type Open, replaceCurrent, S, write } from './preview-state.js';
import { EDIT_READ_TICKS, sessionFlush, sessionStart, sessionStep, sessionTick } from './preview-undo.js';
import { SessionUndo } from './session-undo.js';
import { endAiPreview, type AiPreviewInput } from './job.js';
import { entryStep } from './job-types.js';
import { knobsName, knobsOnStep, knobsOpen, knobsReset, knobsRestore, knobsSave, knobsShown, knobsTick } from './preview-knobs.js';
import { clearParked, clipKey, forgetLatest, hasParked, keepLatest, latestOn, parkSession, takeSession } from './sessions.js';
import { refreshStart, refreshStop, refreshTick } from './preview-refresh.js';
import './preview-relength.js';

export const VERBS = { quantize: 'SMART QUANT', variation: 'VARIATION', double: 'SMART DOUBLE', create: 'NEW CLIP' } as const;

export function aiSessionOpen(): boolean { return S.cur !== null; }   // on the clip on screen, shown or not
/** The preview owns the screen and the jog: open, and no track button held. */
export function aiPreviewActive(): boolean { return S.cur !== null && !trackButtonHeld(); }
/** The step whose icon names the open session's generator; -1 none. */
export function aiSessionStep(): number { return S.cur ? entryStep(S.cur.p.task) : -1; }
export function previewIndex(): number { return S.cur ? S.cur.index : -1; }
export function previewCount(): number { return S.cur ? S.cur.p.options.length : 0; }
/** Cells the strip shows at once: the picks, at most eight (design §2.2). */
export function previewVisible(): number { return S.cur ? Math.min(8, S.cur.p.picks ?? S.cur.p.options.length) : 0; }
export function previewLabels(): string[] { return S.cur ? S.cur.p.options.map((_, i) => String(i + 1)) : []; }
/* Seen for about a second after the jog is let go (render.ts toasts). */
const JOG_NAME_TTL = 196;

/** The generator behind the option showing, for the jog-hold toast. */
export function previewName(): string {
    if (!S.cur) return '';
    return S.cur.index === 0 ? 'ORIG' : knobsName() || String(S.cur.index);
}

/* The clip a session may show on: the watched one, in a Track view. Song mode
 * moving the PLAYING clip does not move it: that is not the user leaving. */
function here(): string | null {
    const v = appState.currentView;
    if (seqState.sessionMode || (v !== VIEW_KNOBS && v !== VIEW_CHAIN && v !== VIEW_KEYS)) return null;
    const t = watchedTrack();
    return clipKey(t, seqState.session[t]?.selected ?? 0);
}

/* One undo per visit to the clip, the AI change itself on the first; a
 * reopened session (preview-undo.ts) holds its gestures without a snapshot,
 * its entry already holds the clip as it was before the generator ran. */
export function activate(o: Open, reopened = false): void {
    S.cur = o;
    const key = 'ai:' + keyOf(o);
    beginEdit({ key, verb: VERBS[o.p.task], target: trackLabel(o.p.track), close: CLOSE.IMMEDIATE, seq: !reopened });
    if (!reopened) tagAiSession({ key: keyOf(o), id: o.id });
    holdGroup(key);
    /* The session's steps (preview-undo.ts): a hand edit read back, a knob
     * gesture's end. Set here, not at load: an import cycle can run this file
     * before group.ts's own state is initialised. */
    onAbsorbedGesture(() => { if (S.cur) S.cur.editDue = EDIT_READ_TICKS; });
    knobsOnStep(() => { if (S.cur) sessionStep(S.cur); });
}
let sessions = 0;

export function park(why: string): void {
    const o = S.cur!;
    sessionFlush(o);   // a gesture or edit still open is this session's step
    o.knobs = knobsSave();
    S.cur = null;
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
    if (S.cur) park('another opens');
    /* A request finishing on a clip whose session is parked replaces it. */
    const key = clipKey(p.track, p.slot);
    if (takeSession(key) || latestOn(key)) { seqCmd(`aiclr ${p.track} ${p.slot}`); forgetLatest(key); }
    const o: Open = { p, index: 0, visited: [true, ...p.options.map(() => false)], knobs: null, id: ++sessions, steps: new SessionUndo(), editDue: 0 };
    activate(o);
    mlog(`ai: preview t${p.track} s${p.slot} ${p.options.length} options`);
    if (p.gen) knobsOpen(p.gen.ctx, p.gen.picks, p.options);
    go(o, 1);
    sessionStart(o);
}

export function previewSwitch(delta: number): void {
    const o = S.cur;
    if (!o) return;
    const was = o.index;
    go(o, Math.max(0, Math.min(o.p.options.length, o.index + delta)));
    if (o.index !== was) sessionStep(o);
}

/* The preview off the screen: what keeping and closing share. */
export function leave(o: Open, why: string): void {
    mlog(`ai: preview ${why} option ${o.index} t${o.p.track} s${o.p.slot}`);
    S.cur = null;
    refreshStop();
    /* The jog hold named an option; a finger still resting after the click
     * must not turn into the view's own CLICK JOG hint. */
    jogHintTouch(false);
    knobsReset();
    endAiPreview();
    appState.dirty = true;
}

/** Keep what is showing, edits and all. The clip's stash stays: an undo of
 *  this entry reopens the session (preview-undo.ts). */
export function commitPreview(why = 'commit'): void {
    const o = S.cur;
    if (!o) return;
    sessionFlush(o);
    leave(o, 'kept (' + why + ')');
    releaseHold(true);
    if (o.entry) { pushEntry(o.entry); o.entry = undefined; }
    keepLatest(keyOf(o), o);
}

/** Every session ends where it stands: a Set change. */
export function endAllPreviews(why: string): void {
    commitPreview(why);
    forgetLatest();
    if (clearParked().length) mlog(`ai: parked sessions ended (${why})`);
    seqCmd('aiclr');
}

/** A clip deleted or pasted over: its session is over. */
export function aiForgetClip(track: number, slot: number): void {
    const key = clipKey(track, slot);
    if (S.cur && keyOf(S.cur) === key) commitPreview('clip replaced');
    else takeSession(key);
    forgetLatest(key);
    seqCmd(`aiclr ${track} ${slot}`);
}

/** Per tick: parks and takes up sessions as the clip on screen changes. */
export function aiPreviewTick(): void {
    if (!S.cur && !hasParked()) return;
    const want = here();
    if (want !== (S.cur ? keyOf(S.cur) : null)) {
        if (S.cur) park(`left for ${want ?? 'another view'}`);
        const o = want === null ? undefined : takeSession<Open>(want);
        if (o) resume(o);
    }
    if (!S.cur) return;
    /* A finger on the jog names the generator in the top strip at once, kept
     * up while held the way a held knob's is; a held knob, announced after, wins. */
    if (jogTouched() && !trackButtonHeld()) seqHeaderAnnounce('GENERATOR: ' + previewName(), JOG_NAME_TTL);
    refreshTick();
    knobsTick(replaceCurrent);
    if (S.cur) sessionTick(S.cur);
}

export function resetPreview(): void { S.cur = null; clearParked(); forgetLatest(); refreshStop(); knobsReset(); }

/** New Clip remade at `len` (preview-relength.ts): the one showing written. */
export function previewRemade(len: number, options: AiNote[][]): void {
    const o = S.cur!;
    o.p.options = options;
    o.p.len = len;
    o.visited = o.visited.map((_, i) => i === 0);
    if (o.index > 0) write(o, o.index);
    sessionStart(o);   // steps at the old length would write old notes at the new one
    appState.dirty = true;
}
export function previewInputOpen(): AiPreviewInput | null { return S.cur ? S.cur.p : null; }
