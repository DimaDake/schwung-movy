/* browser-test/logic/ai-session-undo.mjs — granular undo through a generator
 * session (plans/2026-11-01-generator-ux-design.md §2.4, the worked example
 * in §3): a knob gesture, a hand edit and an option switch are each a step;
 * undo after keeping reopens the preview; walking past ORIG closes it.
 *
 * Run by browser-test/logic.mjs.
 */

import { _log, eq, ok, installMockEngine, uninstallMockEngine, seqEngineTick, resetSeqEngine,
    selectTrack, resetUndoState, resetUndoGroups, undoOnce, redoOnce, beginEdit, endEdit, CLOSE, canRedo, undoTick } from './harness.mjs';
import { openPreview, previewIndex, previewSwitch, commitPreview, aiPreviewTick, previewInput, resetAiJob, knobsOf,
    aiSessionOpen, aiForgetClip, SessionUndo, SESSION_CAP } from '../../dist/esm/ai/index.js';
import { seqState } from '../../dist/esm/seq/state.js';
import * as G from '../../dist/esm/gen/index.js';
import { createInput } from '../gen-fixtures.mjs';
import { volumeTrackDown, volumeTrackUp } from '../../dist/esm/mixer/track-volume.js';
import { fontWidth } from '../../dist/esm/font/index.js';
import { previewRemade } from '../../dist/esm/ai/index.js';
import { handleStepButton } from '../../dist/esm/seq/router-steps.js';

let eng;
const KNOB = (k, d) => [0xB0, 71 + k, d * 8 > 0 ? d * 8 : 128 + d * 8];
const TOUCH = (k, on) => [on ? 0x90 : 0x80, k, on ? 127 : 0];
const fmt = (ns) => ns.map((n) => `${n.tick}.${n.gate}.${n.pitch}.${n.vel}`).join(',') || '-';
function ops() { seqEngineTick(); const o = eng.ops.slice(); eng.ops.length = 0; return o; }
function boot(inp) {
    resetUndoState(); resetUndoGroups(); resetAiJob();
    eng = installMockEngine();
    selectTrack(0);
    seqState.sessionMode = false;
    seqState.session[0].selected = 1;
    seqState.session[0].playing = -1;
    seqEngineTick();
    openPreview(inp);
    seqEngineTick();
    eng.ops.length = 0;
}
function done() { resetAiJob(); uninstallMockEngine(); resetSeqEngine(); }
const ticks = (n = 4) => { for (let i = 0; i < n; i++) aiPreviewTick(); };
/* The clip as the last write left it: the notes of the latest aiclip. */
let shown = '';
const track = () => { for (const o of ops()) if (o.startsWith('aiclip 0 1 ')) shown = o.split(' ').pop(); return shown; };

export async function run() {
_log('\nTest: generator session undo');

const r = G.generateAll(createInput(false, 'free', 5));
const inp = () => ({ task: 'create', track: 0, slot: 1, orig: null, options: r.picks.map((p) => p.notes.map((n) => ({ ...n }))), len: 32, scaleNum: 1, scaleDen: 1,
    gen: { ctx: r.ctx, picks: r.picks.map((p) => ({ preset: p.preset, knobs: [...p.knobs] })) } });
const p3 = r.picks[2].preset;
const dk = G.knobIndex(p3, 'DENSITY'), gk = G.knobIndex(p3, 'GATE');
const turn = (k, d) => { const s = G.knobSlot(p3, k); previewInput(TOUCH(s, true)); previewInput(KNOB(s, d)); ticks(); previewInput(TOUCH(s, false)); ticks(); };

/* §3: option 3 -> DENSITY -> edit step 5 -> GATE -> jog click. */
boot(inp());
previewSwitch(2);
ticks();
const opened = track();
const dens0 = knobsOf(3)[dk], gate0 = knobsOf(3)[gk];
turn(dk, dens0 < 10 ? 1 : -1);
const afterDensity = track();
const edited = (afterDensity === '-' ? '' : afterDensity + ',') + '120.24.40.99';
beginEdit({ key: 'step5', verb: 'EDIT', target: 'T1 STEP 5', close: CLOSE.IMMEDIATE, seq: true });
eng.params['ait:0'] = `1 32 0 1/1 0 0|${edited}`;
endEdit('step5');
ticks(6);
turn(gk, gate0 < 10 ? 1 : -1);
const afterGate = track();
const gate1 = knobsOf(3)[gk];
commitPreview('jog click');
ops();
ok('commit_closes', !aiSessionOpen());

undoOnce(); ticks();
ok('undo_reopens_on_committed', aiSessionOpen() && previewIndex() === 3 && knobsOf(3)[gk] === gate1 && track() === afterGate);
undoOnce(); ticks();
ok('undo_gate_back', knobsOf(3)[gk] === gate0 && track() === edited);
redoOnce(); ticks();
ok('redo_gate_again', knobsOf(3)[gk] === gate1 && track() === afterGate);
undoOnce(); ticks();
undoOnce(); ticks();
ok('undo_edit_gone', track() === afterDensity);
undoOnce(); ticks();
ok('undo_density_back', knobsOf(3)[dk] === dens0 && track() === opened);
undoOnce(); ticks();
eq('undo_option_switch_back', previewIndex(), 1);
undoOnce(); ticks();
ok('undo_to_orig_preview_open', previewIndex() === 0 && aiSessionOpen());
ops();
undoOnce();
const closing = ops();
ok('undo_closes_clip_as_before', !aiSessionOpen() && closing.some((o) => o.startsWith('uswap')) && !closing.some((o) => o.startsWith('aiclip')), closing.join(' '));
done();

/* Review focus 1: Undo during a turn still being regenerated restores the step exactly. */
boot(inp());
previewSwitch(2);
ticks();
const before = track();
const s = G.knobSlot(p3, dk);
previewInput(TOUCH(s, true)); previewInput(KNOB(s, dens0 < 10 ? 1 : -1));
undoOnce(); ticks(6);
ok('undo_during_pending_turn_restores_exact', knobsOf(3)[dk] === dens0 && track() === before && aiSessionOpen());
done();

/* Review focus 2: a deleted clip, or a newer session on it, is never reopened. */
boot(inp());
previewSwitch(1); ticks();
commitPreview('jog click');
aiForgetClip(0, 1);
undoOnce(); ticks();
ok('no_reopen_after_clip_deleted', !aiSessionOpen());
done();

boot(inp());
previewSwitch(1); ticks();
commitPreview('jog click');
openPreview(inp()); seqEngineTick();
previewSwitch(3); ticks();
commitPreview('jog click');
undoOnce(); ticks();
ok('newest_session_reopens', aiSessionOpen() && previewIndex() === 4);
undoOnce(); undoOnce(); undoOnce(); ticks();
ok('older_session_after_a_newer_never_reopens', !aiSessionOpen());
done();

/* Review focus 5: a parked session keeps its steps. */
boot(inp());
previewSwitch(1); ticks();
previewSwitch(1); ticks();
seqState.session[0].selected = 3; ticks();
ok('parked', !aiSessionOpen());
seqState.session[0].selected = 1; ticks();
undoOnce(); ticks();
ok('parked_session_keeps_undo_steps', aiSessionOpen() && previewIndex() === 2);
done();

/* Review fixes (final branch review, 2026-11-03). */
const seedOpt = r.picks.findIndex((p) => p.preset.knobs.some((k, i) => k.seed && G.knobLive(r.ctx, p.preset, p.knobs, i)));
if (seedOpt >= 0) {
    const sp = r.picks[seedOpt].preset;
    const sk = sp.knobs.findIndex((k) => k.seed);
    const ss = G.knobSlot(sp, sk);
    const order = G.drain(G.seedOrder(r.ctx, sp, r.picks[seedOpt].knobs.map((k, i) => (i === sk ? 0 : k)), sk));
    const r0 = order.indexOf(r.picks[seedOpt].knobs[sk]);
    const dir = r0 + 3 < order.length ? 1 : -1;
    /* 1: after Undo, SEED counts from where the notes are. */
    boot(inp());
    previewSwitch(seedOpt);
    ticks();
    /* Each turn its own gesture: the strip times out between them. */
    previewInput(KNOB(ss, dir)); ticks(220);
    previewInput(KNOB(ss, dir)); ticks(220);
    undoOnce(); ticks();
    previewInput(KNOB(ss, dir)); ticks(20);
    eq('seed_after_undo_counts_from_the_restored_take', knobsOf(seedOpt + 1)[sk], order[r0 + 2 * dir]);
    done();
    /* 2: a SEED turn still waiting for its order never lands after an Undo. */
    boot(inp());
    previewSwitch(seedOpt);
    ticks();
    track();
    previewInput(KNOB(ss, dir));
    undoOnce();
    ops();                       // the undo's own restore (the option switch taken back)
    ticks(24);
    eq('waiting_seed_turn_never_lands_after_undo', knobsOf(seedOpt + 1)[sk], r.picks[seedOpt].knobs[sk]);
    eq('waiting_seed_turn_writes_nothing_after_undo', ops().filter((o) => o.startsWith('aiclip')).length, 0);
    done();
}

/* 3: parked, resumed, kept, then Undo past ORIG takes back every visit. */
boot(inp());
previewSwitch(1); ticks();
seqState.session[0].selected = 3; ticks();
seqState.session[0].selected = 1; ticks();
previewSwitch(1); ticks();
commitPreview('jog click');
ops();
for (let i = 0; i < 6 && (i === 0 || aiSessionOpen()); i++) { undoOnce(); ticks(); }
const back = ops();
ok('resumed_session_close_takes_back_every_visit', !aiSessionOpen() && back.filter((o) => o.startsWith('uswap')).length === 2, back.filter((o) => o.startsWith('uswap')).join(' '));
done();

/* 4: HARMONY's value fits the strip and shows that more chords follow, in glyphs the font has. */
{
    const long = [G.chordOf(6, 'm7b5'), G.chordOf(11, '7'), G.chordOf(4, 'm7'), G.chordOf(9, '7'), G.chordOf(2, 'maj7'), G.chordOf(7, '7')];
    const L = G.chordsLabel(long);
    const room = 128 - 4 - fontWidth('HARMONY') - 4;
    ok('harmony_label_fits_measured', fontWidth(L) <= room && L.endsWith('...') && !L.startsWith(' '), L + ' ' + fontWidth(L) + '/' + room);
}

/* 5: a New Clip remade at another length starts its steps again. */
boot(inp());
previewSwitch(2); ticks();
previewRemade(64, r.picks.map((p) => p.notes));
ticks();
undoOnce(); ticks();
eq('remake_restarts_the_steps', previewIndex(), 0);
done();

/* 6: a gesture left open when the clip is left is that session's step, never
 * a step of the next session opened. */
boot(inp());
previewSwitch(2); ticks();
const s6 = G.knobSlot(p3, dk);
previewInput(KNOB(s6, dens0 < 10 ? 1 : -1)); ticks();
seqState.session[0].selected = 3; ticks();
openPreview({ ...inp(), slot: 3 }); seqEngineTick();
ticks(220);
undoOnce(); ticks();
eq('open_gesture_never_lands_on_the_next_session', previewIndex(), 0);
done();

/* 7: Undo with a track button held keeps the session and takes it back. */
boot(inp());
previewSwitch(1); ticks();
volumeTrackDown(0);
undoOnce();
const held = ops();
volumeTrackUp(0);
ticks();
ok('undo_with_track_held_takes_the_session_back', !aiSessionOpen() && held.some((o) => o.startsWith('uswap')));
done();

/* Deferred review 1: a hand edit still waiting to be read when the jog turns is
 * the step of the option it was made on, and survives undo and redo through it. */
const handEdit = (notes) => {
    beginEdit({ key: 'step5', verb: 'EDIT', target: 'T1 STEP 5', close: CLOSE.IMMEDIATE, seq: true });
    eng.params['ait:0'] = `1 32 0 1/1 0 0|${notes}`;
    endEdit('step5');
};
boot(inp());
previewSwitch(2); ticks();
const fresh3 = track();
const edited3 = (fresh3 === '-' ? '' : fresh3 + ',') + '120.24.40.99';
handEdit(edited3);
previewSwitch(1); ticks();
undoOnce(); ticks();
ok('jog_edit_undo_lands_on_the_edit', previewIndex() === 3 && track() === edited3, previewIndex() + ' ' + shown);
redoOnce(); ticks();
eq('jog_edit_redo_forward', previewIndex(), 4);
undoOnce(); ticks();
ok('jog_edit_survives_undo_and_redo', previewIndex() === 3 && track() === edited3, previewIndex() + ' ' + shown);
done();

/* Deferred review 2: a reopened session kept again unchanged leaves the redo
 * stack as it was; changed, it is a new edit and the redo goes. */
const keptThenUndoneTwice = () => {
    boot(inp());
    previewSwitch(1); ticks();
    commitPreview('jog click');
    beginEdit({ key: 'later', verb: 'EDIT', close: CLOSE.IMMEDIATE, seq: true });
    endEdit('later');
    undoOnce(); ticks();          // the later edit, onto the redo stack
    undoOnce(); ticks();          // the kept session, reopened
};
keptThenUndoneTwice();
ok('reopened_before_keep', aiSessionOpen() && canRedo());
commitPreview('jog click');
ok('reopen_keep_unchanged_keeps_redo', canRedo());
ops();
redoOnce();
ok('reopen_keep_unchanged_redo_applies', ops().some((o) => o.startsWith('uswap')) && !canRedo());
done();
keptThenUndoneTwice();
redoOnce(); ticks();          // at the session's end: keeping it again
ok('reopen_redo_keep_keeps_redo', !aiSessionOpen() && canRedo());
done();
keptThenUndoneTwice();
undoOnce(); ticks(); redoOnce(); ticks();   // there and back: nothing changed
commitPreview('jog click');
ok('reopen_undo_redo_keep_keeps_redo', canRedo());
done();
keptThenUndoneTwice();
previewSwitch(1); ticks();
commitPreview('jog click');
ok('reopen_changed_keep_drops_redo', !canRedo());
done();

/* Deferred review 3: no step that changes nothing, so one undo always shows a
 * change. A hand edit that reads back the notes already stored is no step... */
const ait = (notes) => { eng.params['ait:0'] = `1 32 0 1/1 0 0|${notes}`; };
boot(inp());
previewSwitch(2); ticks();
ait(track());
beginEdit({ key: 'same', verb: 'EDIT', target: 'T1 STEP 3', close: CLOSE.IMMEDIATE, seq: true });
endEdit('same');
ticks(6);
undoOnce(); ticks();
eq('unchanged_edit_is_no_step', previewIndex(), 1);
done();
/* ...nor is a gesture that never edited the clip (a volume turn), even where a
 * read would find something new; at ORIG of a reopened session it changes
 * nothing, so keeping it again keeps the redo. */
boot(inp());
previewSwitch(2); ticks();
ait(track() + ',120.24.40.99');
for (const g of [{ key: 'vol:0', verb: 'VOLUME', target: 'T1', seq: false }, { key: 'mainknob:0', verb: 'TEMPO', target: '', seq: true },
    { key: 'clipknob:1', verb: 'LENGTH', target: 'T2', seq: true }]) {
    beginEdit({ ...g, close: CLOSE.TOUCH_RELEASE }); endEdit(g.key);
}
ticks(6);
undoOnce(); ticks();
eq('other_gestures_are_no_step', previewIndex(), 1);
done();
boot(inp());
previewSwitch(-1); ticks();
commitPreview('jog click');
beginEdit({ key: 'later', verb: 'EDIT', close: CLOSE.IMMEDIATE, seq: true }); endEdit('later');
undoOnce(); ticks(); undoOnce(); ticks();
ok('reopened_at_orig', aiSessionOpen() && previewIndex() === 0 && canRedo());
beginEdit({ key: 'vol:0', verb: 'VOLUME', target: 'T1', close: CLOSE.TOUCH_RELEASE, seq: false }); endEdit('vol:0');
ticks(6);
commitPreview('jog click');
ok('orig_volume_turn_keeps_redo', canRedo());
done();
/* A step button's edit, which closes its group without naming it, is a step. */
boot(inp());
previewSwitch(2); ticks();
const before3 = track();
handleStepButton(4, true, false); handleStepButton(4, false, false);
ait(before3 + ',64.24.40.99');
ticks(6);
undoOnce(); ticks();
ok('step_button_edit_is_a_step', previewIndex() === 3 && track() === before3, previewIndex() + ' ' + shown);
done();

/* A held step's knob turn ends on the idle backstop alone: still a step. */
boot(inp());
previewSwitch(2); ticks();
const beforeVel = track();
const realNow = Date.now;
let clock = realNow();
Date.now = () => clock;
beginEdit({ key: 'held:vel:0:4', verb: 'VELOCITY', target: 'T1', close: CLOSE.TOUCH_RELEASE, seq: true });
ait(beforeVel + ',64.24.40.70');
clock += 700; undoTick();
Date.now = realNow;
ticks(6);
undoOnce(); ticks();
ok('held_step_turn_is_a_step', previewIndex() === 3 && track() === beforeVel, previewIndex() + ' ' + shown);
done();

/* The cap: the oldest steps merge into the first, which still returns to option 1. */
{
    const u = new SessionUndo();
    u.start({ index: 1, options: [], knobs: [] });
    for (let i = 0; i < 130; i++) u.push({ index: 2 + (i % 3), options: [], knobs: [] });
    eq('cap_keeps_128_steps', u.size(), SESSION_CAP);
    let last = null;
    for (let i = 0; i < 200; i++) { const x = u.undo(); if (typeof x === 'string') break; last = x; }
    eq('cap_first_step_kept', last.index, 1);
}
}
