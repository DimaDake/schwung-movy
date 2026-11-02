/* browser-test/logic/gen-layout.mjs — fixed knob slots
 * (plans/2026-11-01-generator-ux-design.md §2.1, §4): every generator's
 * knobs sit in their role's slot, nothing is dropped while a slot is dark,
 * and SEED/DRIFT follow the placement rule.
 *
 * Run by browser-test/logic.mjs.
 */

import { _log, eq, ok } from './harness.mjs';
import * as G from '../../dist/esm/gen/index.js';

export async function run() {
_log('\nTest: generator knob layout');

const bad = { missing: [], unreal: [], dropped: [], dark: [], role: [], seed: [] };
for (const p of G.PRESETS) {
    const L = G.LAYOUTS?.[p.id];
    if (!L || L.length !== 8) { bad.missing.push(p.id); continue; }
    if (!L.every((n) => n === null || p.knobs.some((k) => k.name === n))) bad.unreal.push(p.id);
    const out = p.knobs.map((k) => k.name).filter((n) => !L.includes(n));
    if (!out.every((n) => (G.DROPPED[p.id] ?? []).includes(n))) bad.dropped.push(`${p.id}:${out}`);
    if (out.length && L.includes(null)) bad.dark.push(p.id);
    const off = L.filter((n, s) => n !== null && G.ROLE[n] !== undefined && G.ROLE[n] !== s + 1 && !(G.EXCEPT[p.id] ?? []).includes(n));
    if (off.length) bad.role.push(`${p.id}:${off}`);
    const si = L.indexOf('SEED'), di = L.indexOf('DRIFT');
    if (si >= 0 && si !== 7) bad.seed.push(`${p.id}:SEED@${si + 1}`);
    if (di >= 0 && (si >= 0 ? di !== 5 && di !== 6 : di !== 7)) bad.seed.push(`${p.id}:DRIFT@${di + 1}`);
}
eq('layout_exists_for_every_preset', bad.missing.join(' '), '');
eq('layout_names_real_knobs', bad.unreal.join(' '), '');
eq('only_listed_knobs_dropped', bad.dropped.join(' '), '');
eq('nothing_dropped_while_a_slot_is_dark', bad.dark.join(' '), '');
eq('knobs_sit_in_their_role_slot', bad.role.join(' '), '');
eq('seed_on_8_drift_on_8_or_6_7', bad.seed.join(' '), '');
ok('slot_knob_maps_to_the_preset_knob', G.slotKnob(G.presetById('n-chords'), 2) === G.knobIndex(G.presetById('n-chords'), 'HARMONY'));
eq('dark_slot_maps_to_nothing', G.slotKnob(G.presetById('v-harmonize'), 3), null);
}
