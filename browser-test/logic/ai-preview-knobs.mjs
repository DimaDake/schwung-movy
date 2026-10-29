/* browser-test/logic/ai-preview-knobs.mjs — the preview's knobs
 * (plans/2026-10-27-algorithmic-generators-design.md §5): the option's own
 * knobs regenerate it over the clip, touches show the top strip, ORIG has
 * none, a model reply gets REPLY's four.
 *
 * Run by browser-test/logic.mjs.
 */

import { _log, eq, ok, installMockEngine, uninstallMockEngine, seqEngineTick, resetSeqEngine,
    selectTrack, resetUndoState, resetUndoGroups } from './harness.mjs';
import { openPreview, previewIndex, previewSwitch, commitPreview, aiPreviewTick, previewInput, resetAiJob, knobsOf, knobLevels,
    previewName } from '../../dist/esm/ai/index.js';
import { jogHintTick, jogHintVisible, jogHintTouch } from '../../dist/esm/app/jog-hint.js';
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
/* `d` in clicks; a click is DETENT_DIV raw units (seq/detent.ts). */
const KNOB = (k, d) => [0xB0, 71 + k, d * 8 > 0 ? d * 8 : 128 + d * 8];
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
eq('leds_dark_until_a_knob_is_known_to_do_something', knobLevels().every((l) => l === null), true);
for (let i = 0; i < 8; i++) aiPreviewTick();
ops();
const lv = knobLevels();
const nk = first.preset.knobs.length;
ok('leds_show_each_live_knobs_position', first.preset.knobs.every((k, i) => !G.knobLive(r.ctx, first.preset, first.knobs, i)
    ? lv[i] === null : Math.abs(lv[i] - first.knobs[i] / (k.steps(r.ctx) - 1)) < 1e-9));
ok('leds_dark_past_the_presets_knobs', lv.slice(nk).every((l) => l === null));
const before = knobsOf(1)[live];
const steps = first.preset.knobs[live].steps(r.ctx);
const dir = before >= steps - 1 ? -1 : 1;
previewInput(KNOB(live, dir));
previewInput(KNOB(live, dir));
/* Less than a click is banked, not a step (the knobs were too sensitive). */
previewInput([0xB0, 71 + live, dir > 0 ? 3 : 125]);
eq('a_part_click_moves_nothing', knobsOf(1)[live], before + 2 * dir);
previewInput([0xB0, 71 + live, dir > 0 ? 125 : 3]);
eq('turns_are_coalesced: nothing written before the tick', ops().filter((o) => o.startsWith('aiclip')).length, 0);
aiPreviewTick();
const w = ops().filter((o) => o.startsWith('aiclip 0 1 32 1 1 0'));
eq('turn_regenerates_once_per_tick', w.length, 1);
ok('turn_moves_the_knob', knobsOf(1)[live] !== before);
eq('led_follows_the_turn', knobLevels()[live], knobsOf(1)[live] / (steps - 1));
/* Like a module's params: a knob at its minimum is lit at the bottom of the
 * ramp (level 0), a knob with nothing behind it is dark (null). */
for (let i = 0; i < 16; i++) previewInput(KNOB(live, -1));
aiPreviewTick();
ops();
eq('led_at_minimum_is_lit_not_dark', knobLevels()[live], 0);
for (let i = 0; i < before + 2 * dir; i++) previewInput(KNOB(live, 1));
aiPreviewTick();
ops();
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
ok('leds_dark_on_orig', knobLevels().every((l) => l === null));
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

/* Holding the jog names the generator behind the option showing (the
 * top strip); the hold is the views' own jog-hint timer. */
{
    const realNow = Date.now;
    let t = 1000; Date.now = () => t;
    boot(input);
    jogHintTouch(true);
    t = 2100;
    eq('jog_hold_arms_in_the_preview', jogHintTick(), true);
    eq('jog_hold_names_option_1', previewName(), picks[0].preset.name);
    aiPreviewTick();
    eq('jog_hold_shows_it_in_the_top_strip', seqHeaderShown(), 'GENERATOR: ' + picks[0].preset.name);
    previewInput([0xB0, 14, 1]);
    eq('turning_while_held_renames', previewName(), picks[1].preset.name);
    aiPreviewTick();
    eq('the_strip_follows_the_turn', seqHeaderShown(), 'GENERATOR: ' + picks[1].preset.name);
    eq('turning_while_held_keeps_it_up', jogHintVisible(), true);
    previewSwitch(-9);
    eq('orig_is_named_orig', previewName(), 'ORIG');
    commitPreview();
    eq('commit_takes_the_hold_away', jogHintVisible(), false);
    eq('no_name_after_commit', previewName(), '');
    Date.now = realNow;
    done();
}
}
