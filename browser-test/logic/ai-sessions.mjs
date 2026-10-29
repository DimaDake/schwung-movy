/* browser-test/logic/ai-sessions.mjs — a generator session belongs to its
 * clip (user, 2026-10-29): leaving the clip parks it, coming back takes it up
 * where it stood, only Back or a jog click keeps an option; a held track
 * button shows the pages; the entry step's icon is lit while it is open.
 *
 * Run by browser-test/logic.mjs.
 */

import { _log, eq, ok, installMockEngine, uninstallMockEngine, seqEngineTick, resetSeqEngine,
    appState, selectTrack, undoDepth, resetUndoState, resetUndoGroups, undoOnce } from './harness.mjs';
import { openPreview, previewIndex, previewSwitch, aiPreviewTick, previewInput, aiPreviewActive, aiSessionOpen,
    aiSessionStep, aiForgetClip, aiPhase, aiSetWillChange, startAiJob, resetAiJob, knobsOf } from '../../dist/esm/ai/index.js';
import { seqState } from '../../dist/esm/seq/state.js';
import { stepIconColor } from '../../dist/esm/seq/leds.js';
import { volumeTrackDown, volumeTrackUp } from '../../dist/esm/mixer/track-volume.js';
import * as G from '../../dist/esm/gen/index.js';
import { fixtureInput } from '../gen-fixtures.mjs';

const N = (p) => [{ tick: 0, gate: 24, pitch: p, vel: 100 }];
const input = (slot = 0, task = 'quantize') => ({ task, track: 0, slot, orig: null,
    options: [N(60), N(62), N(64)], len: 16, scaleNum: 1, scaleDen: 2 });

let eng;
function boot() {
    resetUndoState(); resetUndoGroups(); resetAiJob();
    eng = installMockEngine();
    selectTrack(0);
    seqState.sessionMode = false;
    for (const t of [0, 1]) { seqState.session[t].selected = 0; seqState.session[t].playing = -1; }
    seqEngineTick();
    openPreview(input());
    aiPreviewTick();
}
function ops() { seqEngineTick(); const o = eng.ops.slice(); eng.ops.length = 0; return o; }
function done() { resetAiJob(); uninstallMockEngine(); resetSeqEngine(); }
function tick() { aiPreviewTick(); return ops(); }

export async function run() {
_log('\nTest: generator sessions per clip');

boot();
previewSwitch(1);
ops();
const d0 = undoDepth();
selectTrack(1);
let o = tick();
eq('track_switch_parks: not shown', aiSessionOpen(), false);
ok('track_switch_parks: the stash is kept', !o.some((x) => x.startsWith('aiclr')));
ok('track_switch_parks: the visit is one undo', o.some((x) => x.startsWith('ucommit')) && undoDepth() === d0 + 1);
eq('parked: the job may start elsewhere', aiPhase(), 'idle');
selectTrack(0);
o = tick();
eq('return_resumes', aiPreviewActive(), true);
eq('return_resumes: on the option left', previewIndex(), 2);
ok('return_resumes: the clip is not rewritten', !o.some((x) => x.startsWith('aiclip') || x.startsWith('aiload')));
ok('return_resumes: a new visit snapshots for undo', o.some((x) => x.startsWith('usnap')));
eq('resumed: jog still switches', (previewInput([0xB0, MoveMainKnob, 1]), previewIndex()), 3);
done();

/* Two clips, two sessions: each comes back as it was. */
boot();
seqState.session[0].selected = 3;
tick();
openPreview(input(3));
previewSwitch(-1);
ops();
eq('second session on slot 3', previewIndex(), 0);
seqState.session[0].selected = 0;
o = tick();
eq('clip_switch_takes_over_that_clips_session', previewIndex(), 1);
ok('clip_switch: no stash cleared', !o.some((x) => x.startsWith('aiclr')));
eq('jog_click_keeps_this_clip_only', previewInput([0xB0, MoveMainButton, 127]), true);
o = ops();
ok('commit clears only its own clip', o.includes('aiclr 0 0') && !o.includes('aiclr'));
seqState.session[0].selected = 3;
tick();
eq('the other clip is still in its session', previewIndex(), 0);
done();

/* Session mode and the other views park; returning resumes. */
boot();
seqState.sessionMode = true;
tick();
eq('session_mode_parks', aiSessionOpen(), false);
seqState.sessionMode = false;
tick();
eq('session_mode_off_resumes', aiSessionOpen(), true);
appState.currentView += 1;
tick();
eq('other_view_parks', aiSessionOpen(), false);
appState.currentView -= 1;
tick();
eq('track_view_resumes', aiSessionOpen(), true);
done();

/* Undo, a Set change and a deleted clip end parked sessions too. */
boot();
selectTrack(1);
tick();
undoOnce();
ok('undo_ends_parked_sessions', ops().includes('aiclr'));
selectTrack(0);
tick();
eq('undo: nothing resumes', aiSessionOpen(), false);
done();

boot();
selectTrack(1);
tick();
aiSetWillChange();
ok('set_change_ends_parked_sessions', ops().includes('aiclr'));
selectTrack(0);
tick();
eq('set change: nothing resumes', aiSessionOpen(), false);
done();

boot();
seqState.sessionMode = true;
tick();
aiForgetClip(0, 0);
ok('deleted_clip_ends_its_session', ops().includes('aiclr 0 0'));
seqState.sessionMode = false;
tick();
eq('deleted clip: nothing resumes', aiSessionOpen(), false);
done();

/* No second generator on a clip already in a session. */
boot();
startAiJob('variation', 0, 0);
eq('no_job_while_a_session_is_open', aiPhase(), 'preview');
done();

/* The entry step's icon, lit like an open page's. */
boot();
eq('quantize_session_names_step16', aiSessionStep(), 15);
eq('lit_full_without_shift', stepIconColor(15, { shift: false, metro: false, fullVel: false, genStep: aiSessionStep() }), 124);   // WHITE_BRIGHT
selectTrack(1);
tick();
eq('dark_once_parked', aiSessionStep(), -1);
done();
boot();
aiForgetClip(0, 0);
openPreview(input(0, 'create'));
eq('new_clip_names_step14', aiSessionStep(), 13);
openPreview(input(1, 'double'));
eq('smart_double_names_step15', aiSessionStep(), 14);
done();

/* A held track button shows the pages; letting go brings the session back. */
boot();
volumeTrackDown(0);
eq('track_hold_shows_the_pages', aiPreviewActive(), false);
eq('track_hold: the session stays', aiSessionOpen(), true);
eq('track_hold: the knobs go to the page', previewInput([0xB0, 71, 1]), false);
eq('track_hold: the jog goes to the page', previewInput([0xB0, MoveMainKnob, 1]), false);
volumeTrackUp(0);
eq('track_release_brings_it_back', aiPreviewActive(), true);
eq('track_release: on the same option', previewIndex(), 1);
done();

/* A parked session keeps its knobs. */
const r = G.generateAll(fixtureInput('lead', { scene: 'free' }));
const picks = r.picks.map((p) => ({ preset: p.preset, knobs: [...p.knobs] }));
const live = picks[0].preset.knobs.findIndex((_, i) => G.knobLive(r.ctx, picks[0].preset, picks[0].knobs, i));
boot();
aiForgetClip(0, 0);
openPreview({ ...input(), task: 'variation', options: r.picks.map((p) => p.notes),
    len: 32, scaleNum: 1, scaleDen: 1, gen: { ctx: r.ctx, picks } });
for (let i = 0; i < 8; i++) tick();
const was = knobsOf(1)[live];
const steps = picks[0].preset.knobs[live].steps(r.ctx);
const dir = was + 1 < steps ? 1 : -1;
previewInput([0xB0, 71 + live, dir > 0 ? 8 : 120]);
tick();
selectTrack(1);
tick();
eq('parked: no knobs on screen', knobsOf(1).length, 0);
selectTrack(0);
tick();
eq('knob_positions_survive_parking', knobsOf(1)[live], was + dir);
done();
resetUndoState(); resetUndoGroups();
}
