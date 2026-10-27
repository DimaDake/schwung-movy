/* browser-test/logic/ai-preview-knobs.mjs — the preview's knobs
 * (plans/2026-10-27-algorithmic-generators-design.md §5): the option's own
 * knobs regenerate it over the clip, touches show the top strip, ORIG has
 * none, a model reply gets REPLY's four.
 *
 * Run by browser-test/logic.mjs.
 */

import { _log, eq, ok, installMockEngine, uninstallMockEngine, seqEngineTick, resetSeqEngine,
    selectTrack, resetUndoState, resetUndoGroups } from './harness.mjs';
import { openPreview, previewIndex, previewSwitch, commitPreview, aiPreviewTick, previewInput, resetAiJob, knobsOf } from '../../dist/esm/ai/index.js';
import { seqState } from '../../dist/esm/seq/state.js';
import { seqHeaderShown, resetSeqHeader } from '../../dist/esm/seq/render.js';
import * as G from '../../dist/esm/gen/index.js';
import { fixtureInput } from '../gen-fixtures.mjs';

let eng;
function boot(input) {
    resetUndoState(); resetUndoGroups(); resetAiJob(); resetSeqHeader();
    eng = installMockEngine();
    selectTrack(0);
    seqState.sessionMode = false;
    seqState.session[0].selected = 1;
    seqState.session[0].playing = -1;
    seqEngineTick();
    openPreview(input);
    seqEngineTick();
    eng.ops.length = 0;
}
function ops() { seqEngineTick(); const o = eng.ops.slice(); eng.ops.length = 0; return o; }
function done() { resetAiJob(); uninstallMockEngine(); resetSeqEngine(); }
const KNOB = (k, d) => [0xB0, 71 + k, d > 0 ? d : 128 + d];
const TOUCH = (k, on) => [on ? 0x90 : 0x80, k, on ? 127 : 0];

export async function run() {
_log('\nTest: preview knobs');

const r = G.generateAll(fixtureInput('lead', { scene: 'free' }));
const picks = r.picks.map((p) => ({ preset: p.preset, knobs: [...p.knobs] }));
const input = { task: 'variation', track: 0, slot: 1, orig: null, options: r.picks.map((p) => p.notes),
    len: 32, scaleNum: 1, scaleDen: 1, gen: { ctx: r.ctx, picks } };
const first = picks[0];
const live = first.preset.knobs.findIndex((_, i) => G.knobLive(r.ctx, first.preset, first.knobs, i));
ok('a live knob exists on option 1', live >= 0);

boot(input);
eq('opens on option 1', previewIndex(), 1);
const before = knobsOf(1)[live];
const steps = first.preset.knobs[live].steps(r.ctx);
const dir = before >= steps - 1 ? -1 : 1;
previewInput(KNOB(live, dir));
previewInput(KNOB(live, dir));
eq('turns_are_coalesced: nothing written before the tick', ops().filter((o) => o.startsWith('aiclip')).length, 0);
aiPreviewTick();
const w = ops().filter((o) => o.startsWith('aiclip 0 1 32 1 1 0'));
eq('turn_regenerates_once_per_tick', w.length, 1);
ok('turn_moves_the_knob', knobsOf(1)[live] !== before);
const expect = G.regenerate(r.ctx, first.preset, knobsOf(1)).map((n) => `${n.tick}.${n.gate}.${n.pitch}.${n.vel}`).join(',');
eq('turn_writes_the_presets_take_at_the_new_positions', w[0].split(' ').pop(), expect);
ok('turn_shows_the_strip: name left, value right', seqHeaderShown().startsWith(first.preset.knobs[live].name + '|'));

resetSeqHeader();
previewInput(TOUCH(live, true));
ok('touch_shows_the_strip', seqHeaderShown().startsWith(first.preset.knobs[live].name));
previewInput(TOUCH(live, false));
eq('a touch never reaches the page underneath', previewInput(TOUCH(live, true)), true);

previewSwitch(1);
ops();
ok('switch_announces_the_option_and_its_preset', seqHeaderShown().startsWith('2  ' + picks[1].preset.name));
previewSwitch(-2);
ops();
eq('on ORIG', previewIndex(), 0);
previewInput(KNOB(live, 1));
aiPreviewTick();
eq('orig_has_no_knobs', ops().filter((o) => o.startsWith('aiclip')).length, 0);
previewSwitch(1);
ops();
eq('option_keeps_its_own_knob_positions', knobsOf(1)[live], Math.max(0, Math.min(steps - 1, before + 2 * dir)));
commitPreview();
done();

/* A knob that cannot change this option is hidden: no strip, no write. */
const qi = fixtureInput('pad', { task: 'quantize' });
/* On the beat, one wrong note: something to fix, nothing to swing. */
qi.tracks[0].clips[0].notes = qi.tracks[0].clips[0].notes.map((n, i) => (i === 1 ? { ...n, pitch: n.pitch + 1 } : n));
const dctx = G.prepare(qi);
const tight = G.presetById('q-tight');
const tv = G.defaults(tight, dctx);
const swing = tight.knobs.findIndex((k) => k.name === 'SWING');
eq('swing_on_a_pad_on_the_beat_is_dead', G.knobLive(dctx, tight, tv, swing), false);
const notes = G.generateOption(dctx, tight, tv).notes;
boot({ task: 'quantize', track: 0, slot: 0, orig: null, options: [notes], len: 32, scaleNum: 1, scaleDen: 1,
    gen: { ctx: dctx, picks: [{ preset: tight, knobs: tv }] } });
resetSeqHeader();
previewInput(KNOB(swing, 1));
aiPreviewTick();
eq('dead_knob_writes_nothing', ops().filter((o) => o.startsWith('aiclip')).length, 0);
eq('dead_knob_shows_nothing', seqHeaderShown(), '');
commitPreview();
done();

/* REPLY: a model's option keeps its notes until a knob is turned. */
const base = r.picks[0].notes;
const rp = G.replyPreset('variation', false, base);
const rv = G.defaults(rp, r.ctx);
eq('reply_has_four_knobs', rp.knobs.length, 4);
eq('reply_defaults_leave_it_as_it_came', G.generateOption(r.ctx, rp, rv).notes?.length, base.length);
ok('reply_density_up_adds_notes', (G.generateOption(r.ctx, rp, [9, 5, 5, 0]).notes?.length ?? 0) > base.length);
}
