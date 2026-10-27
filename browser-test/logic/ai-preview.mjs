/* browser-test/logic/ai-preview.mjs — the preview (design §5.2): ORIG + three
 * options on the jog, each keeping its own edits (engine stash), every way of
 * committing, and one undo for the whole change.
 *
 * Run by browser-test/logic.mjs.
 */

import { _log, eq, ok, installMockEngine, uninstallMockEngine, seqEngineTick, resetSeqEngine,
    appState, selectTrack, undoDepth, beginEdit, endEdit, CLOSE, resetUndoState, resetUndoGroups, undoOnce } from './harness.mjs';
import { openPreview, previewIndex, previewSwitch, commitPreview, aiPreviewTick as previewTick, previewInput,
    aiPhase, aiSetWillChange, resetAiJob, aiPreviewActive } from '../../dist/esm/ai/index.js';
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
ok('commit clears the stash and closes the group', o.includes('aiclr') && o.some((x) => x.startsWith('ucommit')));
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
eq('track_switch_commits', aiPreviewActive(), false);
done();

boot();
seqState.session[0].selected = 3;
previewTick();
eq('clip_switch_commits', aiPreviewActive(), false);
done();

boot();
appState.currentView = appState.currentView + 1;
previewTick();
eq('view_change_commits', aiPreviewActive(), false);
appState.currentView -= 1;
done();

boot();
seqState.sessionMode = true;
previewTick();
eq('session_toggle_commits', aiPreviewActive(), false);
seqState.sessionMode = false;
done();

boot();
const d0 = undoDepth();
undoOnce();
eq('undo_during_preview_commits_first: preview closed', aiPreviewActive(), false);
eq('undo_during_preview_commits_first: undid the AI step itself', undoDepth(), d0);
done();

boot();
aiSetWillChange();
eq('set_change_aborts_running_commits_preview', aiPreviewActive(), false);
ok('set change commit clears the stash', ops().includes('aiclr'));
done();
resetUndoState(); resetUndoGroups();
}
