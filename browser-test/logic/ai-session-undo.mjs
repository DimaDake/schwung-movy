/* browser-test/logic/ai-session-undo.mjs — granular undo through a generator
 * session (plans/2026-11-01-generator-ux-design.md §2.4, the worked example
 * in §3): a knob gesture, a hand edit and an option switch are each a step;
 * undo after keeping reopens the preview; walking past ORIG closes it.
 *
 * Run by browser-test/logic.mjs.
 */

import { _log, eq, ok, installMockEngine, uninstallMockEngine, seqEngineTick, resetSeqEngine,
    selectTrack, resetUndoState, resetUndoGroups, undoOnce, redoOnce, beginEdit, endEdit, CLOSE } from './harness.mjs';
import { openPreview, previewIndex, previewSwitch, commitPreview, aiPreviewTick, previewInput, resetAiJob, knobsOf,
    aiSessionOpen, aiForgetClip, SessionUndo, SESSION_CAP } from '../../dist/esm/ai/index.js';
import { seqState } from '../../dist/esm/seq/state.js';
import * as G from '../../dist/esm/gen/index.js';
import { createInput } from '../gen-fixtures.mjs';

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
beginEdit({ key: 'step5', verb: 'EDIT', close: CLOSE.IMMEDIATE, seq: true });
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
