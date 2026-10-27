/* browser-test/logic/ai-validate.mjs — the prompt's hard rules and the
 * validator that never trusts the model's reply (design §6.3).
 *
 * Run by browser-test/logic.mjs.
 */

import { _log, eq, ok } from './harness.mjs';
import { buildPrompt, validateOptions } from '../../dist/esm/ai/index.js';

const orig = [{ tick: 0, gate: 12, pitch: 36, vel: 100 }, { tick: 96, gate: 12, pitch: 38, vel: 100 }];
const mel = { task: 'quantize', len: 16, drum: false, original: orig, kitPads: [] };
const reply = (...opts) => JSON.stringify({ options: opts.map((notes) => ({ label: 'x', notes })) });

export async function run() {
_log('\nTest: AI validate');

let v = validateOptions(reply([[0, 24, 60, 100], [384, 24, 62, 100], [-5, 24, 64, 100]],
    [[380, 50, 200, 0]], [[10, 0, 61, 90]]), mel);
eq('rejects_out_of_clip_notes: option 1 keeps the in-clip note', JSON.stringify(v[0]), '[{"tick":0,"gate":24,"pitch":60,"vel":100}]');
eq('rejects_out_of_clip_notes: clamps gate/pitch/vel', JSON.stringify(v[1]), '[{"tick":380,"gate":4,"pitch":127,"vel":1}]');
eq('rejects_out_of_clip_notes: gate 0 -> 1', v[2][0].gate, 1);

v = validateOptions(reply([], [[0, 24, 60, 100]], [[999, 1, 1, 1]]), mel);
eq('drops_empty_option: only one survives', v.length, 1);

v = validateOptions('```json\n' + reply([[0, 24, 60, 100]]) + '\n```', mel);
eq('strips_code_fences', v.length, 1);
eq('garbage -> no options', validateOptions('sorry, I cannot', mel).length, 0);
eq('object notes accepted', validateOptions(JSON.stringify({ options: [{ notes: [{ tick: 0, gate: 1, pitch: 60, vel: 9 }] }] }), mel).length, 1);

const drum = { task: 'quantize', len: 16, drum: true, original: orig, kitPads: [36, 38, 42] };
v = validateOptions(reply([[2, 12, 42, 100], [98, 12, 38, 90]], [[0, 12, 42, 100]], [[0, 12, 50, 100], [0, 12, 36, 100]]), drum);
eq('drum_quant_option1_keeps_pads: moved hat snaps back to the kick', v[0][0].pitch, 36);
eq('drum_quant_option1_keeps_pads: in-place snare kept', v[0][1].pitch, 38);
eq('drum_option2_may_move_to_kit_pad', v[1][0].pitch, 42);
eq('drum_option3_drops_non_kit_pad', JSON.stringify(v[2].map((n) => n.pitch)), '[36]');

v = validateOptions(reply([[0, 24, 60, 100], [24, 24, 62, 100]], [[24, 24, 62, 100], [0, 24, 60, 100]], [[0, 24, 64, 100]]), mel);
eq('dedupes_identical_options', v.length, 2);

const many = Array.from({ length: 700 }, (_, i) => [i, 1, 60, 100]);
eq('caps notes at the engine MAX_NOTES', validateOptions(reply(many), { ...mel, len: 64 })[0].length, 512);

const pv = buildPrompt('variation', 'CTX', { len: 32, drum: false });
ok('prompt_mentions_harmony_option_for_variation', /at least one option[^.]*harmon/i.test(pv.user));
ok('prompt carries the context', pv.user.includes('CTX'));
ok('prompt states the tick range', /0 to 767/.test(pv.user));
const pq = buildPrompt('quantize', 'CTX', { len: 16, drum: true });
ok('drum quantize prompt: option 1 keeps every pad', /option 1[^.]*same pad/i.test(pq.user));
ok('drum prompt has no harmony option', !/harmon/i.test(buildPrompt('variation', 'C', { len: 16, drum: true }).user.replace(/HARMONY/g, '')));
ok('system says JSON only', /JSON/.test(pq.system));
}
