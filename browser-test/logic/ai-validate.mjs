/* browser-test/logic/ai-validate.mjs — the prompt's hard rules and the
 * validator that never trusts the model's reply (design §6.3).
 *
 * Run by browser-test/logic.mjs.
 */

import { _log, eq, ok } from './harness.mjs';
import { buildPrompt, validateOptions, buildRequest, buildContext, LEVEL_TEMPERATURE } from '../../dist/esm/ai/index.js';

const orig = [{ tick: 0, gate: 12, pitch: 36, vel: 100 }, { tick: 96, gate: 12, pitch: 38, vel: 100 }];
const melOrig = [{ tick: 0, gate: 12, pitch: 60, vel: 100 }, { tick: 96, gate: 12, pitch: 62, vel: 100 }];
const mel = { task: 'quantize', len: 16, drum: false, original: melOrig, kitPads: [] };
const reply = (...opts) => JSON.stringify({ options: opts.map((notes) => ({ label: 'x', notes })) });

export async function run() {
_log('\nTest: AI validate');

let v = validateOptions(reply([[0, 24, 60, 100], [384, 24, 62, 100], [-5, 24, 64, 100]],
    [[380, 50, 40, 0], [380, 50, 200, 90]], [[10, 0, 61, 90]]), mel);
eq('rejects_out_of_clip_notes: option 1 keeps the in-clip note', JSON.stringify(v[0]), '[{"tick":0,"gate":24,"pitch":60,"vel":100}]');
eq('rejects_out_of_clip_notes: clamps gate/vel, drops a pitch far outside the part', JSON.stringify(v[1]), '[{"tick":380,"gate":4,"pitch":40,"vel":1}]');
eq('rejects_out_of_clip_notes: gate 0 -> 1', v[2][0].gate, 1);

v = validateOptions(reply([], [[0, 24, 60, 100]], [[999, 1, 1, 1]]), mel);
eq('drops_empty_option: only one survives', v.length, 1);

v = validateOptions('```json\n' + reply([[0, 24, 60, 100]]) + '\n```', mel);
eq('strips_code_fences', v.length, 1);
/* gemini-flash-lite-latest copies the context's note style (60:C3) into its
 * JSON pitches; on the device that lost 2 of its 3 replies (2026-10-27). */
v = validateOptions('{"options":[{"label":"a","notes":[[0.13, 16.0, 48:C3, 127],[4, 1, 61:C#3, 90]]},'
    + '{"label":"b","notes":[[0, 2, 47:B1, 100]]}]}', { ...mel, units: 'steps' });
eq('pitch_names_in_reply_repaired: both options kept', v.length, 2);
eq('pitch_names_in_reply_repaired: the number wins', JSON.stringify(v[0].map((n) => n.pitch)), '[48,61]');
eq('garbage -> no options',validateOptions('sorry, I cannot', mel).length, 0);
eq('object notes accepted', validateOptions(JSON.stringify({ options: [{ notes: [{ tick: 0, gate: 1, pitch: 60, vel: 9 }] }] }), mel).length, 1);

const drum = { task: 'quantize', len: 16, drum: true, original: orig, kitPads: [36, 38, 42] };
v = validateOptions(reply([[2, 12, 42, 100], [98, 12, 38, 90]], [[0, 12, 42, 100]], [[0, 12, 50, 100], [0, 12, 36, 100]]), drum);
eq('drum_quant_option1_keeps_pads: moved hat snaps back to the kick', v[0][0].pitch, 36);
eq('drum_quant_option1_keeps_pads: in-place snare kept', v[0][1].pitch, 38);
eq('drum_option2_may_move_to_kit_pad', v[1][0].pitch, 42);
eq('drum_option3_drops_non_kit_pad', JSON.stringify(v[2].map((n) => n.pitch)), '[36]');

v = validateOptions(reply([[0, 24, 60, 100], [24, 24, 62, 100]], [[24, 24, 62, 100], [0, 24, 60, 100]], [[0, 24, 64, 100]]), mel);
eq('dedupes_identical_options', v.length, 2);

/* ORIG is already the strip's first entry: a copy of it is no option. */
v = validateOptions(reply([[96, 12, 62, 100], [0, 12, 60, 100]], [[0, 12, 60, 100]]), mel);
eq('drops_option_identical_to_orig', JSON.stringify(v), '[[{"tick":0,"gate":12,"pitch":60,"vel":100}]]');

const many = Array.from({ length: 700 }, (_, i) => [i, 1, 60, 100]);
eq('caps notes at the engine MAX_NOTES', validateOptions(reply(many), { ...mel, len: 64 })[0].length, 512);

const pv = buildPrompt('variation', 'CTX', { len: 32, drum: false });
ok('prompt: a free target scene asks for new chords on some options', /options 1, 3, 5 and 7 move to new\s+chords/i.test(pv.user));
ok('prompt carries the context', pv.user.includes('CTX'));
ok('variation_points_at_target_scene_chords', /chords of the \[TARGET\] scene in HARMONY/.test(pv.user));
ok('prompt states the step range', /0 to under 32/.test(pv.user));
ok('prompt_has_no_scale_rule', !/fits? the key|in (the )?scale|nearest note that fits/i.test(pv.user + buildPrompt('quantize', 'C', { len: 32, drum: false }).user)
    && /chords? (the other tracks|listed)/i.test(pv.user));
const lv = (level) => buildPrompt('quantize', 'C', { len: 32, drum: false, level }).user;
ok('levels_shift_the_ladder: SAFE and WILD differ', lv('SAFE') !== lv('WILD') && lv('SAFE') !== lv('BALANCED'));
ok('levels_shift_the_ladder: BALANCED keeps closest/shaped/inspired', /closest[\s\S]*shaped[\s\S]*inspired/i.test(lv('BALANCED')));
eq('levels: no level is BALANCED', lv(undefined), lv('BALANCED'));
eq('temperature_per_level', ['SAFE', 'BALANCED', 'WILD'].map((l) => JSON.parse(buildRequest({ model: 'm', key: 'k' },
    { system: 's', user: 'u' }, LEVEL_TEMPERATURE[l]).body).generationConfig.temperature).join(','), '1,1,1');
const pq = buildPrompt('quantize', 'CTX', { len: 16, drum: true });
ok('drum quantize prompt: option 1 keeps every pad', /option 1[^.]*same pad/i.test(pq.user));
ok('drum prompt has no harmony option', !/harmon/i.test(buildPrompt('variation', 'C', { len: 16, drum: true }).user.replace(/HARMONY/g, '')));
ok('system says JSON only', /JSON/.test(pq.system));

/* Replies in steps, the context's own numbering (Task 5). */
v = validateOptions(reply([[12.25, 1, 60, 100], [-1, 1, 62, 100], [16, 1, 64, 100], [15.5, 4, 65, 90]]), { ...mel, units: 'steps' });
eq('steps_reply_converted_and_clamped', JSON.stringify(v[0]),
    '[{"tick":294,"gate":24,"pitch":60,"vel":100},{"tick":372,"gate":12,"pitch":65,"vel":90}]');
const cx = buildContext({ bpm: 120, swing: 0, root: 'C', mode: 'major', target: { track: 0, slot: 0 }, source: null,
    tracks: [{ index: 0, name: 'K', module: 'x', drum: false, padNames: null, clips: [{ track: 0, slot: 0, len: 16,
        loopStart: 0, scaleNum: 1, scaleDen: 1, transpose: 0, quant: 0, notes: [{ tick: 294, gate: 36, pitch: 60, vel: 100 }] }] }] });
ok('context_positions_in_steps', /@12\.25 60:C3 d1\.5 v100/.test(cx));
}
