/* browser-test/logic/ai-preview.mjs — the preview (design §5.2): ORIG + three
 * options on the jog, each keeping its own edits (engine stash), every way of
 * committing, and one undo for the whole change.
 *
 * Run by browser-test/logic.mjs.
 */

import { _log, eq, ok, installMockEngine, uninstallMockEngine, seqEngineTick, resetSeqEngine,
    appState, selectTrack, undoDepth, beginEdit, endEdit, CLOSE, resetUndoState, resetUndoGroups, undoOnce } from './harness.mjs';
import { openPreview, previewIndex, previewSwitch, commitPreview, aiPreviewTick as previewTick, previewInput,
    aiPhase, aiSetWillChange, resetAiJob, aiPreviewActive, previewLabels, stripWindow } from '../../dist/esm/ai/index.js';
import { seqState } from '../../dist/esm/seq/state.js';

const N = (p) => [{ tick: 0, gate: 24, pitch: p, vel: 100 }];
const input = () => ({ task: 'quantize', track: 0, slot: 0, orig: null,
    options: [N(60), N(62), N(64)], len: 16, scaleNum: 1, scaleDen: 2 });

let eng;
function boot() {
    resetUndoState(); resetUndoGroups(); resetAiJob();
    eng = installMockEngine();
    selectTrack(0);
    seqState.sessionMode = false;
    seqState.session[0].selected = 0;
    seqState.session[0].playing = -1;
    seqEngineTick();   // the preview opens on engine-synced state, as on device
    openPreview(input());
}
function ops() { seqEngineTick(); const o = eng.ops.slice(); eng.ops.length = 0; return o; }
function done() { resetAiJob(); uninstallMockEngine(); resetSeqEngine(); }

export async function run() {
_log('\nTest: AI preview');

boot();
let o = ops();
eq('opens_on_option1', previewIndex(), 1);
eq('preview is active', aiPreviewActive(), true);
ok('open snapshots once for undo', o.filter((x) => x.startsWith('usnap')).length === 1);
ok('open stashes ORIG', o.includes('aistash 0 0 0'));
ok('open writes option 1 at quant 0', o.includes('aiclip 0 0 16 1 2 0 0.24.60.100'));

previewSwitch(1);
o = ops();
ok('switch_writes_aiclip_with_quant0: stashes the one left', o.includes('aistash 0 0 1'));
ok('switch_writes_aiclip_with_quant0: writes option 2', o.includes('aiclip 0 0 16 1 2 0 0.24.62.100'));
previewSwitch(-2);
o = ops();
eq('orig index', previewIndex(), 0);
ok('orig_restores_by_aiload', o.includes('aistash 0 0 2') && o.includes('aiload 0 0 0'));
previewSwitch(2);
o = ops();
ok('edits_kept_per_option: a visited option comes back from its stash', o.includes('aiload 0 0 2') && !o.some((x) => x.startsWith('aiclip')));
previewSwitch(9);
eq('switch clamps at 3', previewIndex(), 3);
previewSwitch(-9);
eq('switch clamps at ORIG', previewIndex(), 0);
ops();

/* An edit made while previewing joins the AI's undo entry. */
const depth = undoDepth();
beginEdit({ key: 'step:0', verb: 'STEP', close: CLOSE.IMMEDIATE, seq: true });
endEdit('step:0');
eq('edit during preview opens no entry of its own', undoDepth(), depth);
ok('...and takes no second snapshot', !ops().some((x) => x.startsWith('usnap')));
eq('jog_click_commits: consumed', previewInput([0xB0, MoveMainButton, 127]), true);
o = ops();
eq('jog_click_commits: idle', aiPreviewActive(), false);
/* The stash stays: undoing this entry reopens the session (ai/preview-undo.ts). */
ok('commit_keeps_the_stash_and_closes_the_group', !o.includes('aiclr 0 0') && o.some((x) => x.startsWith('ucommit')));
eq('undo_after_commit_restores_pre_ai_clip_in_one_step', undoDepth(), depth + 1);
done();

boot();
eq('back_commits_not_exits: consumed', previewInput([0xB0, MoveBack, 127]), true);
eq('back_commits_not_exits: idle', aiPreviewActive(), false);
done();

boot();
eq('jog turn switches', (previewInput([0xB0, MoveMainKnob, 1]), previewIndex()), 2);
eq('other input passes through (editing allowed)', previewInput([0x90, 68, 100]), false);
eq('knob turns are idle in preview', previewInput([0xB0, 71, 1]), true);
seqState.session[0].playing = 2;
previewTick();
eq('song_advance_does_not_commit', aiPreviewActive(), true);
selectTrack(1);
previewTick();
eq('track_switch_leaves_the_session', aiPreviewActive(), false);
done();

boot();
seqState.session[0].selected = 3;
previewTick();
eq('clip_switch_leaves_the_session', aiPreviewActive(), false);
done();

boot();
appState.currentView = appState.currentView + 1;
previewTick();
eq('view_change_leaves_the_session', aiPreviewActive(), false);
appState.currentView -= 1;
done();

boot();
seqState.sessionMode = true;
previewTick();
eq('session_toggle_leaves_the_session', aiPreviewActive(), false);
seqState.sessionMode = false;
done();

boot();
const d0 = undoDepth();
undoOnce();
/* Undo during the preview walks back through it (§2.4): option 1 is its first step, so ORIG. */
eq('undo_during_preview_steps_back: still open', aiPreviewActive(), true);
eq('undo_during_preview_steps_back: on ORIG', previewIndex(), 0);
eq('undo_during_preview_steps_back: no entry taken', undoDepth(), d0);
done();

boot();
aiSetWillChange();
eq('set_change_aborts_running_commits_preview', aiPreviewActive(), false);
ok('set change clears every stash', ops().includes('aiclr'));
done();

/* Variation's six (plans/2026-10-27-variation-eight-options.md): every one
 * reachable and stashable, numbered in order. */
boot();
commitPreview();
ops();
openPreview({ ...input(), task: 'variation', options: [60, 62, 64, 65, 67, 69].map(N) });
eq('eight: strip labels number the options', previewLabels().join(' '), '1 2 3 4 5 6');
previewSwitch(9);
eq('eight: the jog reaches the last option', previewIndex(), 6);
o = ops();
ok('eight: the last option is written fresh', o.includes('aiclip 0 0 16 1 2 0 0.24.69.100'));
previewSwitch(-1);
o = ops();
ok('eight: the engine stash takes slot 6', o.includes('aistash 0 0 6'));
previewSwitch(1);
ok('eight: and gives it back', ops().includes('aiload 0 0 6'));
done();
resetUndoState(); resetUndoGroups();
/* Scrolling past the picks (§2.2): the jog reaches every option, the strip
 * windows them with MORE while there are more, and stops at the last. */
{
    const many = { ...input(), options: Array.from({ length: 10 }, (_, i) => N(60 + i)), picks: 3 };
    resetUndoState(); resetUndoGroups(); resetAiJob();
    eng = installMockEngine(); selectTrack(0); seqState.sessionMode = false; seqState.session[0].selected = 0; seqEngineTick();
    openPreview(many);
    previewSwitch(99);
    eq('jog_stops_at_last_option', previewIndex(), 10);
    eq('strip_window_at_the_picks', stripWindow(2, 10, 3).join(), '1,3,true');
    eq('strip_window_scrolled', stripWindow(7, 10, 3).join(), '5,7,true');
    eq('strip_window_at_the_end', stripWindow(10, 10, 3).join(), '8,10,false');
    eq('strip_window_fits_all', stripWindow(2, 3, 3).join(), '1,3,false');
    commitPreview();
    done();
}

}
