/* browser-test/logic/ai-new-clip.mjs — New Clip's preview
 * (plans/2026-10-28-new-clip-design.md): a per-pad option builds the kit a
 * pad at a time, DENSITY 0 takes a pad out and DENSITY follows its pad into
 * the other per-pad option; a length set in Loop Mode remakes the options and
 * the preview stays open.
 *
 * Run by browser-test/logic.mjs.
 */

import { _log, eq, ok, installMockEngine, uninstallMockEngine, seqEngineTick, resetSeqEngine,
    selectTrack, resetUndoState, resetUndoGroups } from './harness.mjs';
import { openPreview, previewIndex, previewSwitch, aiPreviewTick, previewInput, resetAiJob, knobsOf } from '../../dist/esm/ai/index.js';
import { loopStepOnAt, loopStepOff } from '../../dist/esm/seq/loop-mode.js';
import { seqState } from '../../dist/esm/seq/state.js';
import * as G from '../../dist/esm/gen/index.js';
import { createInput } from '../gen-fixtures.mjs';

let eng;
function boot(input) {
    resetUndoState(); resetUndoGroups(); resetAiJob();
    eng = installMockEngine();
    selectTrack(0);
    seqState.sessionMode = false;
    seqState.session[0].selected = 1;
    seqState.session[0].playing = -1;
    seqState.watchLane = 36;
    seqEngineTick();
    openPreview(input);
    seqEngineTick();
    eng.ops.length = 0;
}
function ops() { seqEngineTick(); const o = eng.ops.slice(); eng.ops.length = 0; return o; }
function ticks(n = 3) { for (let i = 0; i < n; i++) aiPreviewTick(); return ops(); }
function done() { resetAiJob(); uninstallMockEngine(); resetSeqEngine(); }
/* The last clip written: its length and the pads it plays. */
function lastClip(o) {
    const w = o.filter((x) => x.startsWith('aiclip')).pop();
    if (!w) return null;
    const f = w.split(' ');
    const notes = f[7] === '-' ? [] : f[7].split(',').map((n) => n.split('.').map(Number));
    return { len: Number(f[3]), pads: [...new Set(notes.map((n) => n[2]))].sort((a, b) => a - b) };
}
const KNOB = (k, d) => [0xB0, 71 + k, d * 8 > 0 ? d * 8 : 128 + d * 8];
const asPreview = (r, len) => ({ task: 'create', track: 0, slot: 1, orig: null, options: r.picks.map((p) => p.notes), len, scaleNum: 1, scaleDen: 1,
    gen: { ctx: r.ctx, picks: r.picks.map((p) => ({ preset: p.preset, knobs: [...p.knobs] })) } });

export async function run() {
_log('\nTest: new clip preview');
G.forgetOptions();

const r = G.generateAll(createInput(true, 'empty', 4, { pad: 36 }));
boot(asPreview(r, 32));
eq('opens_on_the_first_per_pad_option', previewIndex(), 1);
ticks();

/* Another pad: its notes join the kick's, and the kick's stay. */
seqState.watchLane = 38;
const added = lastClip(ticks());
eq('another_pad_adds_its_notes', added?.pads.join(), '36,38');

/* DENSITY to 0 on that pad: its notes go, the kick's stay. */
const before = knobsOf(1)[0];
for (let i = 0; i < 12; i++) { previewInput(KNOB(0, -1)); aiPreviewTick(); }
const cleared = lastClip(ticks());
ok('density_turned_down', before > 0 && knobsOf(1)[0] === 0);
eq('density_zero_removes_the_selected_pads_notes', cleared?.pads.join(), '36');

/* Back up to 3, then the other per-pad option: pad 38 comes along at 3. */
for (let i = 0; i < 3; i++) { previewInput(KNOB(0, 1)); aiPreviewTick(); }
ticks();
/* And the kick, which both per-pad options already play, down to 1. */
seqState.watchLane = 36;
ticks();
while (knobsOf(1)[0] > 1) { previewInput(KNOB(0, -1)); aiPreviewTick(); }
ticks();
previewSwitch(1);
const other = lastClip(ticks(4));
eq('density_follows_a_pad_both_options_play', knobsOf(2)[0], 1);
seqState.watchLane = 38;
ticks();
eq('density_follows_the_pad_into_the_other_per_pad_option', knobsOf(2)[0], 3);
eq('the_other_per_pad_option_writes_every_pad_touched', other?.pads.join(), '36,38');

/* The whole-kit options ignore the pad: a pad press only plays it. */
previewSwitch(1);
ticks();
seqState.watchLane = 42;
eq('a_kit_option_is_not_rewritten_by_a_pad_press', lastClip(ticks()), null);

/* Loop Mode during the preview: a double-tapped bar sets one bar; the
 * options are made again at it and the preview stays open. */
loopStepOnAt(0, 1000); loopStepOff(0);
loopStepOnAt(0, 1100); loopStepOff(0);
const one = lastClip(ops());
eq('a_loop_length_remakes_the_option_showing', one?.len, 16);
eq('the_preview_stays_open', previewIndex(), 3);
eq('the_engine_got_no_loop_command', eng.ops.filter((o) => o.startsWith('loop ')).length, 0);
previewSwitch(1);
eq('every_option_is_remade_at_the_new_length', lastClip(ops())?.len, 16);
done();

/* A melodic New Clip: a two-bar loop selected in Loop Mode doubles it. */
const m = G.generateAll(createInput(false, 'free', 8, { len: 16 }));
boot(asPreview(m, 16));
loopStepOnAt(0, 5000); loopStepOnAt(1, 5010); loopStepOff(0); loopStepOff(1);
const two = lastClip(ops());
eq('a_two_bar_loop_makes_a_two_bar_part', two?.len, 32);
done();
G.forgetOptions();
}
