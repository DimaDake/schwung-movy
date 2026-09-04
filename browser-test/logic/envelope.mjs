/* browser-test/logic/envelope.mjs — envelope detection, its viewmodel, and the knob↔screen rearrangement
 *
 * Run by browser-test/logic.mjs. The suite body is deliberately left at its
 * original indentation inside run() so blame survives the split.
 */

import {
    detectEnvelopes, planPageLayout, MOCK_SYNTHS, eq, bootModel, P,
    _log, env,
} from './harness.mjs';

export async function run() {
_log('\n── Envelope detection ──');

// Full-word amp ADSR + 4 other params (Moog/OB-Xd main shape)
{
    const page = [
        P('cutoff','Cutoff'), P('resonance','Resonance'), P('contour','Contour'), P('glide','Glide'),
        P('attack','Attack'), P('decay','Decay'), P('sustain','Sustain'), P('release','Release'),
    ];
    const g = detectEnvelopes(page);
    eq('amp ADSR: one group', g.length, 1);
    eq('amp ADSR: a index', g[0]?.a, 4);
    eq('amp ADSR: r index', g[0]?.r, 7);
}
// Two qualified groups: amp (plain) + filter (f_ prefix)
{
    const page = [
        P('attack','Attack'), P('decay','Decay'), P('sustain','Sustain'), P('release','Release'),
        P('f_attack','F Attack'), P('f_decay','F Decay'), P('f_sustain','F Sustain'), P('f_release','F Release'),
    ];
    const g = detectEnvelopes(page);
    eq('dual env: two groups', g.length, 2);
    eq('dual env: amp first (idx0)', g[0]?.a, 0);
    eq('dual env: filter second (idx4)', g[1]?.a, 4);
}
// A2: AD partial (attack+decay, word-matched) → one 2-cell group
{
    const page = [ P('attack','Attack'), P('decay','Decay'), P('cutoff','Cut'), P('reso','Res') ];
    const g = detectEnvelopes(page);
    eq('AD partial: one group', g.length, 1);
    eq('AD partial: roles ad', g[0].roles.join(''), 'ad');
    eq('AD partial: a=0 d=1', `${g[0].a},${g[0].d}`, '0,1');
}
// A2: single role (attack only) → no group (needs ≥2 roles incl. a)
{
    const page = [ P('attack','Attack'), P('cutoff','Cut'), P('reso','Res'), P('drive','Drive') ];
    eq('single role: no group', detectEnvelopes(page).length, 0);
}
// A2: AR partial (qualified) → one group, roles ar
{
    const page = [ P('f_attack','F Attack'), P('f_release','F Release'), P('cut','Cut'), P('res','Res') ];
    const g = detectEnvelopes(page);
    eq('AR partial: one group', g.length, 1);
    eq('AR partial: roles ar', g[0].roles.join(''), 'ar');
    eq('AR partial: named Filter', g[0].name, 'Filter');
}
// A2: ASR partial (3 cells)
{
    const page = [ P('attack','Attack'), P('sustain','Sustain'), P('release','Release'), P('cut','Cut') ];
    const g = detectEnvelopes(page);
    eq('ASR partial: one group', g.length, 1);
    eq('ASR partial: roles asr', g[0].roles.join(''), 'asr');
}
// A2: ADS partial (3 cells, no release)
{
    const page = [ P('attack','Attack'), P('decay','Decay'), P('sustain','Sustain'), P('cut','Cut') ];
    const g = detectEnvelopes(page);
    eq('ADS partial: one group', g.length, 1);
    eq('ADS partial: roles ads', g[0].roles.join(''), 'ads');
}
/* The config's veto. Detection reads the KEY as well as the label, so a module
 * whose key stem matches by accident cannot rename its way out: 9W9 pairs
 * `bd_c_attack` (a click LEVEL) with `bd_c_decay` and got a fake AD graphic
 * hoisted to knob 1, disagreeing with its own editor about knob order. */
{
    const page = [
        P('bd_c_tune','Tune'), P('bd_c_attack','Attack', false), P('bd_c_decay','Decay'),
        P('bd_c_level','Level'),
    ];
    eq('env:false breaks the AD pair', detectEnvelopes(page).length, 0);
}
{
    const page = [
        P('bd_c_tune','Tune'), P('bd_c_attack','Attack'), P('bd_c_decay','Decay'),
        P('bd_c_level','Level'),
    ];
    eq('the same page without the veto still groups', detectEnvelopes(page).length, 1);
}
/* The veto has to win over an explicit tag too — `env: false` is not "untagged",
 * so it must be read before the truthy branch that a stage name takes. */
{
    const page = [
        P('attack','Attack', false), P('decay','Decay', 'd'),
        P('sustain','Sustain', 's'), P('release','Release', 'r'),
    ];
    eq('a vetoed attack leaves no group to build', detectEnvelopes(page).length, 0);
}
// A2: surge Amp Envelope — shape/mode curve params are NOT extra env stages
{
    const page = [
        P('env1_attack','Amp EG Attack'), P('env1_decay','Amp EG Decay'),
        P('env1_sustain','Amp EG Sustain'), P('env1_release','Amp EG Release'),
        P('env1_attack_shape','Amp EG Attack Shape'), P('env1_decay_shape','Amp EG Decay Shape'),
        P('env1_release_shape','Amp EG Release Shape'), P('env1_mode','Amp EG Envelope Mode'),
    ];
    const g = detectEnvelopes(page);
    eq('surge amp: one clean group', g.length, 1);
    eq('surge amp: full ADSR', `${g[0].a},${g[0].d},${g[0].s},${g[0].r}`, '0,1,2,3');
}
// A2 out-of-scope: an LFO's own DAHDSR segments must NOT become an envelope
{
    const page = [
        P('lfo0_delay','LFO 1 Delay'), P('lfo0_attack','LFO 1 Attack'),
        P('lfo0_hold','LFO 1 Hold'), P('lfo0_decay','LFO 1 Decay'),
        P('lfo0_sustain','LFO 1 Sustain'), P('lfo0_release','LFO 1 Release'),
    ];
    eq('LFO DAHDSR: no envelope', detectEnvelopes(page).length, 0);
}
// A2 layout: AD group occupies 2 adjacent cells, leftovers fill the rest
// (drive/mix are plain knobs — a cutoff/reso pair would form its own filter line)
{
    const page = [ P('attack','Attack'), P('decay','Decay'), P('drive','Drive'), P('mix','Mix') ];
    const L = planPageLayout(page);
    eq('AD layout: one envelope', L.envelopes.length, 1);
    const e = L.envelopes[0];
    eq('AD layout: startCol 0, count 2', `${e.startCol},${e.cellCount}`, '0,2');
    const line = L.cells.filter(c => c.line === e.line).sort((x,y)=>x.col-y.col).map(c => c.idx);
    eq('AD layout: env cells then leftovers', JSON.stringify(line), JSON.stringify([0,1,2,3]));
}
// Abbreviations
{
    const page = [ P('atk','Atk'), P('dcy','Dcy'), P('sus','Sus'), P('rel','Rel') ];
    eq('abbrev set: one group', detectEnvelopes(page).length, 1);
}
// Bare single letters — all four present → group
{
    const page = [ P('a','A'), P('d','D'), P('s','S'), P('r','R') ];
    eq('bare letters all four: group', detectEnvelopes(page).length, 1);
}
// Bare single letters — only three present → no group (guard)
{
    const page = [ P('a','A'), P('d','D'), P('s','S'), P('cutoff','Cut') ];
    eq('bare letters partial: no group', detectEnvelopes(page).length, 0);
}
// Explicit env tag overrides naming
{
    const page = [ P('h1','Harm',undefined), P('p2','Punch'),
        P('e_a','EA','a'), P('e_d','ED','d'), P('e_s','ES','s'), P('e_r','ER','r') ];
    const g = detectEnvelopes(page);
    eq('env tag: one group', g.length, 1);
    eq('env tag: a index', g[0]?.a, 2);
}
// C5: noise suffix words (ms/time) ignored so *_ms keys still group (mrsample)
{
    const page = [ P('attack_ms','Attack'), P('decay_ms','Decay'),
        P('sustain','Sustain'), P('release_ms','Release') ];
    const g = detectEnvelopes(page);
    eq('C5 ms-suffix: one group', g.length, 1);
    eq('C5 ms-suffix: named Amp', g[0]?.name, 'Amp');
}
// C5: amp_/vca_ qualifier maps to the Amp group name (fizzik/osirus)
{
    const page = [ P('vca_attack','VCA Attack'), P('vca_decay','VCA Decay'),
        P('vca_sustain','VCA Sustain'), P('vca_release','VCA Release') ];
    const g = detectEnvelopes(page);
    eq('C5 vca: one group', g.length, 1);
    eq('C5 vca: named Amp', g[0]?.name, 'Amp');
}
// C5: env-qualified bare letters (env1 a/d/s/r) detect and name after the env
{
    const page = [ P('env1_a','Env1 A'), P('env1_d','Env1 D'),
        P('env1_s','Env1 S'), P('env1_r','Env1 R') ];
    const g = detectEnvelopes(page);
    eq('C5 env1 bare: one group', g.length, 1);
    eq('C5 env1 bare: named Env1', g[0]?.name, 'Env1');
}
// C5 guard: non-env bare letters (phase_r/pan_r/load_a) are NOT envelope roles
{
    const page = [ P('phase_r','Phase R'), P('pan_r','Pan R'),
        P('load_a','Load A'), P('drive','Drive') ];
    eq('C5 non-env bare letters: no group', detectEnvelopes(page).length, 0);
}
// Layout: amp ADSR on second row, others consolidated to first line
{
    const page = [
        P('cutoff','Cutoff'), P('resonance','Resonance'), P('contour','Contour'), P('glide','Glide'),
        P('attack','Attack'), P('decay','Decay'), P('sustain','Sustain'), P('release','Release'),
    ];
    const L = planPageLayout(page);
    eq('layout: env on line 1', L.envelopes[0]?.line, 1);
    const env = L.cells.filter(c => c.line === 1).map(c => c.idx);
    eq('layout: line1 = a,d,s,r order', JSON.stringify(env), JSON.stringify([4,5,6,7]));
    const knobs = L.cells.filter(c => c.line === 0).map(c => c.idx);
    eq('layout: line0 = the others', JSON.stringify(knobs), JSON.stringify([0,1,2,3]));
}
// Layout: scattered ADSR rearranged onto one line, leftovers on the other
{
    const page = [
        P('attack','Attack'), P('cutoff','Cut'), P('sustain','Sustain'), P('reso','Res'),
        P('decay','Decay'), P('glide','Glide'), P('release','Release'), P('tone','Tone'),
    ];
    const L = planPageLayout(page);
    eq('scattered: one envelope', L.envelopes.length, 1);
    const env = L.cells.filter(c => c.line === L.envelopes[0].line).map(c => c.idx);
    eq('scattered: a,d,s,r order', JSON.stringify(env), JSON.stringify([0,4,2,6]));
}


_log('\n── Envelope viewmodel ──');
// test8: row1 = attack/decay/sustain/release → envelope on line 1
{
    const m = bootModel(MOCK_SYNTHS.test8);
    const vm = m.getViewModel();
    eq('test8: line1 is envelope', !!vm.envelopeLines?.[1], true);
    eq('test8: line0 not envelope', !!vm.envelopeLines?.[0], false);
    eq('test8: line1 col0 = Atk', vm.rows[1][0]?.shortName, 'ATK');
    eq('test8: line1 col3 = Rel', vm.rows[1][3]?.shortName, 'REL');
    eq('test8: line0 col0 = Freq', vm.rows[0][0]?.shortName, 'FREQ');
}
// test16: no ADSR → no envelope
{
    const m = bootModel(MOCK_SYNTHS.test16);
    eq('test16: no envelope line0', !!m.getViewModel().envelopeLines?.[0], false);
    eq('test16: no envelope line1', !!m.getViewModel().envelopeLines?.[1], false);
}
// Touch maps to the right cell on the envelope line (knob 6 = sustain)
{
    const m = bootModel(MOCK_SYNTHS.test8);
    m.handleKnobTouch(6);
    const vm = m.getViewModel();
    eq('test8: touching knob6 marks Sus cell', vm.rows[1][2]?.touched, true);
    eq('test8: Atk cell not touched', vm.rows[1][0]?.touched, false);
}


_log('\n── Envelope knob↔screen mapping (rearrange) ──');
// OB-Xd main page: ADSR scattered at page idx 3-6 → consolidated to line 0.
// Physical knob 0 (top-left) must drive the param shown top-left (attack).
{
    const m = bootModel(MOCK_SYNTHS.obxd_like);
    m.changePage(1);                       // preset page is 0; Main is 1
    const vm = m.getViewModel();
    eq('obxd: line0 is envelope', !!vm.envelopeLines?.[0], true);
    eq('obxd: top-left cell = Attack', vm.rows[0][0]?.shortName, 'ATTAC');
    eq('obxd: bottom-left cell = Cutoff', vm.rows[1][0]?.shortName, 'CUTOF');

    // Touch physical knob 0 → top-left (attack) highlights, not the param that
    // used to live at page index 0 (cutoff, now bottom-left).
    m.handleKnobTouch(0);
    const vt = m.getViewModel();
    eq('obxd: knob0 touches top-left (attack)', vt.rows[0][0]?.touched, true);
    eq('obxd: cutoff cell not touched', vt.rows[1][0]?.touched, false);
    eq('obxd: toast names Attack', vt.toast?.fullName, 'Attack');

    // Turn physical knob 0 → attack changes, cutoff unchanged.
    const a0 = m.getValueByKey('attack'), c0 = m.getValueByKey('cutoff');
    m.handleKnobDelta(0, 20);
    m.tick();
    const moved = m.getValueByKey('attack') !== a0;
    eq('obxd: knob0 moves attack', moved, true);
    eq('obxd: knob0 leaves cutoff', m.getValueByKey('cutoff'), c0);
}


}
