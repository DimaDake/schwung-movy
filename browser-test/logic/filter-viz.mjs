/* browser-test/logic/filter-viz.mjs — filter mode vocabulary, detection, layout seating and the filter viewmodel
 *
 * Run by browser-test/logic.mjs. The suite body is deliberately left at its
 * original indentation inside run() so blame survives the split.
 */

import {
    portFor, planPageLayout, detectFilterViz, buildFilterViz, normalizeFilterOption, isFilterModeEnum,
    filterModeFromEnum, isSlopeEnum, staticModeFromTokens, eq, bankNames, _log,
    env,
} from './harness.mjs';

export async function run() {
_log('\nTest: filter-mode vocabulary (A1)');
{
    // Option-string normalization → spectral mode.
    eq('LP → lp', normalizeFilterOption('LP'), 'lp');
    eq('HighPass → hp', normalizeFilterOption('HighPass'), 'hp');
    eq('BandPass → bp', normalizeFilterOption('BandPass'), 'bp');
    eq('BandStop → notch', normalizeFilterOption('BandStop'), 'notch');
    eq('Notch → notch', normalizeFilterOption('Notch'), 'notch');
    eq('Peak → peak', normalizeFilterOption('Peak'), 'peak');
    eq('AP → ap', normalizeFilterOption('AP'), 'ap');
    eq('Off → off', normalizeFilterOption('Off'), 'off');
    eq('lowercase lp → lp', normalizeFilterOption('lp'), 'lp');
    eq('LP 24 dB → lp', normalizeFilterOption('LP 24 dB'), 'lp');
    eq('HP+LP combined → bp', normalizeFilterOption('HP+LP'), 'bp');
    eq('LP only → lp', normalizeFilterOption('LP only'), 'lp');
    eq('HP only → hp', normalizeFilterOption('HP only'), 'hp');
    eq('Analog 2P → none', normalizeFilterOption('Analog 2P'), null);
    eq('Sticky Bass → none', normalizeFilterOption('Sticky Bass'), null);

    // Enum-vocabulary rule: ≥2 spectral options and ≥half filter words.
    eq('filter mode enum qualifies', isFilterModeEnum(['LP', 'HP', 'BP', 'Notch', 'Peak', 'AP']), true);
    eq('freak lowercase enum qualifies', isFilterModeEnum(['lp', 'bp', 'hp']), true);
    eq('osirus enum (4/8 spectral) qualifies', isFilterModeEnum(
        ['LowPass', 'HighPass', 'BandPass', 'BandStop', 'Analog 1P', 'Analog 2P', 'Analog 3P', 'Analog 4P']), true);
    eq('surge type enum qualifies', isFilterModeEnum(
        ['Off', 'LP 12 dB', 'LP 24 dB', 'LP Legacy Ladder', 'HP 12 dB', 'HP 24 dB', 'BP 12 dB', 'N 12 dB']), true);
    eq('ambiotica algo enum NOT a mode', isFilterModeEnum(['Mismember', 'Loona', 'NAPS', 'Flow']), false);
    eq('chordism slope enum NOT a mode', isFilterModeEnum(['12 dB', '24 dB']), false);
    eq('on/off toggle NOT a mode', isFilterModeEnum(['Off', 'On']), false);
    eq('noise-type enum NOT a mode', isFilterModeEnum(['White', 'Pink', 'Brown']), false);
    eq('null options NOT a mode', isFilterModeEnum(null), false);

    // Value → mode; unknown falls back to lp.
    eq('value 1 → hp', filterModeFromEnum(['LP', 'HP', 'BP'], 1), 'hp');
    eq('value 2 → bp', filterModeFromEnum(['LP', 'HP', 'BP'], 2), 'bp');
    eq('unknown option → lp', filterModeFromEnum(['Analog 1P', 'Analog 2P'], 0), 'lp');

    // Slope enum detection.
    eq('12/24 dB is a slope enum', isSlopeEnum(['12 dB', '24 dB']), true);
    eq('mode enum is not a slope enum', isSlopeEnum(['LP', 'HP', 'BP']), false);

    // Static token inference from a cutoff's own name tokens.
    eq('token hpf → hp', staticModeFromTokens(['hpf', 'cut']), 'hp');
    eq('token lpf → lp', staticModeFromTokens(['lpf', 'cut']), 'lp');
    eq('token lowcut → hp (cut the lows)', staticModeFromTokens(['low', 'cut']), 'hp');
    eq('token hicut → lp', staticModeFromTokens(['hi', 'cut']), 'lp');
    eq('token bpf → bp', staticModeFromTokens(['dly', 'bpf', 'cut']), 'bp');
    eq('bare bp w/o filter ctx → none (dexed breakpoint)', staticModeFromTokens(['op1', 'key', 'bp']), null);
    eq('plain cutoff tokens → none (→ default lp later)', staticModeFromTokens(['cutoff']), null);
}

_log('\nTest: detectFilterViz (A1)');
{
    const F = (key, label, type = 'float', options = null) => ({
        key, label, shortLabel: null, type, options,
        min: 0, max: type === 'enum' ? (options ? options.length - 1 : 1) : 1,
        step: type === 'enum' ? 1 : 0.01, renderStyle: 'arc', automatable: true,
    });

    // moog-like: bare cutoff+resonance, no mode enum → one group, static null (LP later).
    {
        const g = detectFilterViz([F('cutoff', 'Cutoff'), F('resonance', 'Resonance'), F('contour', 'Contour'), F('octave', 'Octave')]);
        eq('moog: one group', g.length, 1);
        eq('moog: cutoff idx0', g[0].cutoff, 0);
        eq('moog: reso idx1', g[0].resonance, 1);
        eq('moog: no mode enum', g[0].modeIdx, null);
        eq('moog: no static mode', g[0].staticMode, null);
    }
    // filter-module: cutoff+resonance + same-page mode enum → modeIdx bound.
    {
        const g = detectFilterViz([
            F('cutoff', 'Cutoff'), F('resonance', 'Resonance'), F('drive', 'Drive'), F('mix', 'Mix'),
            F('env_amount', 'Env Amt'), F('lfo_amount', 'LFO Amt'), F('lfo_rate_div', 'Div'),
            F('mode', 'Mode', 'enum', ['LP', 'HP', 'BP', 'Notch', 'Peak', 'AP']),
        ]);
        eq('filter: one group', g.length, 1);
        eq('filter: modeIdx = 7', g[0].modeIdx, 7);
    }
    // denis-like: filter_cutoff pairs via filter_q (q = resonance), same qualifier.
    {
        const g = detectFilterViz([F('filter_cutoff', 'Cutoff'), F('filter_q', 'Q'), F('drive', 'Drive'), F('mix', 'Mix')]);
        eq('denis: one group via q', g.length, 1);
        eq('denis: cutoff0/reso1', `${g[0].cutoff},${g[0].resonance}`, '0,1');
    }
    // fizzik: a randomizer rnd_reson must NOT be read as resonance.
    {
        const g = detectFilterViz([
            F('rnd_reson', 'Rnd Reson', 'int'), F('cutoff', 'Cutoff'), F('resonance', 'Resonance'),
            F('ftype', 'Filter Type', 'enum', ['LP', 'HP', 'BP', 'Notch']),
        ]);
        eq('fizzik: one group', g.length, 1);
        eq('fizzik: reso is real resonance (idx2)', g[0].resonance, 2);
        eq('fizzik: mode = ftype (idx3)', g[0].modeIdx, 3);
    }
    // aphex Main: BOTH lpf_cut+lpf_reso AND hpf_cut+hpf_reso → two groups, LP & HP static.
    {
        const g = detectFilterViz([
            F('lpf_cut', 'LPF Cut'), F('lpf_reso', 'LPF Peak'), F('hpf_cut', 'HPF Cut'), F('hpf_reso', 'HPF Peak'),
        ]);
        eq('aphex: two groups', g.length, 2);
        const lp = g.find(x => x.cutoff === 0), hp = g.find(x => x.cutoff === 2);
        eq('aphex: lpf pair 0/1', `${lp.cutoff},${lp.resonance}`, '0,1');
        eq('aphex: lpf static lp', lp.staticMode, 'lp');
        eq('aphex: hpf pair 2/3', `${hp.cutoff},${hp.resonance}`, '2,3');
        eq('aphex: hpf static hp', hp.staticMode, 'hp');
    }
    // aphex cross-pair guard: hpf_cut + lpf_reso only (different quals) must NOT pair.
    {
        const g = detectFilterViz([F('hpf_cut', 'HPF Cut'), F('lpf_reso', 'LPF Peak'), F('drive', 'Drive'), F('mix', 'Mix')]);
        eq('cross-pair rejected', g.length, 0);
    }
    // osirus: unqualified cutoff pairs with filter1_resonance (lone-pair, one empty qual).
    {
        const g = detectFilterViz([
            F('cutoff', 'Cutoff'), F('filter1_resonance', 'Filt1 Reso'),
            F('filter1_mode', 'Filt1 Mode', 'enum', ['LowPass', 'HighPass', 'BandPass', 'BandStop']),
            F('filter_routing', 'Filt Routing', 'enum', ['Serial 4', 'Serial 6', 'Parallel 4', 'Split']),
        ]);
        eq('osirus: one group', g.length, 1);
        eq('osirus: cutoff0/reso1', `${g[0].cutoff},${g[0].resonance}`, '0,1');
        eq('osirus: mode = filter1_mode (idx2)', g[0].modeIdx, 2);
    }
    // surge: filter1 and filter2 pairs on one page stay separate by qualifier.
    {
        const g = detectFilterViz([
            F('filter1_cutoff', 'Filter 1 Cutoff'), F('filter1_resonance', 'Filter 1 Resonance'),
            F('filter2_cutoff', 'Filter 2 Cutoff'), F('filter2_resonance', 'Filter 2 Resonance'),
        ]);
        eq('surge: two groups', g.length, 2);
        const f1 = g.find(x => x.cutoff === 0), f2 = g.find(x => x.cutoff === 2);
        eq('surge: filter1 pair 0/1', `${f1.cutoff},${f1.resonance}`, '0,1');
        eq('surge: filter2 pair 2/3', `${f2.cutoff},${f2.resonance}`, '2,3');
    }
    // chordism Filter page: same-page mode + slope enums bound.
    {
        const g = detectFilterViz([
            F('filter_cutoff', 'Cutoff'), F('filter_resonance', 'Resonance'),
            F('filter_mode', 'Mode', 'enum', ['LP', 'HP', 'BP']),
            F('filter_slope', 'Slope', 'enum', ['12 dB', '24 dB']),
        ]);
        eq('chordism: one group', g.length, 1);
        eq('chordism: mode idx2', g[0].modeIdx, 2);
        eq('chordism: slope idx3', g[0].slopeIdx, 3);
    }
    // spectra negative: frequency + resonators (a mixer, not a filter) → no group.
    {
        const g = detectFilterViz([
            F('frequency', 'Frequency'), F('resonators', 'Resonators', 'enum', ['5', '7', '12']),
            F('compress', 'Compress'), F('hpf', 'HPF', 'int'),
        ]);
        eq('spectra: no group', g.length, 0);
    }
    // enum cutoff/reso are numeric-int (obxd/minijv) — still detected.
    {
        const g = detectFilterViz([F('cutoff', 'Cutoff', 'int'), F('resonance', 'Resonance', 'int'), F('filter_env', 'Filter Env', 'int'), F('mm', 'Multimode', 'int')]);
        eq('int pair: one group', g.length, 1);
    }
}

_log('\nTest: planPageLayout seats cutoff→resonance on one line (A1)');
{
    const F = (key, label, type = 'float', options = null) => ({
        key, label, shortLabel: null, type, options,
        min: 0, max: type === 'enum' ? (options ? options.length - 1 : 1) : 1,
        step: type === 'enum' ? 1 : 0.01, renderStyle: 'arc', automatable: true,
    });
    // Cutoff/resonance not first, reversed order → reflowed to line front, cutoff then reso.
    {
        const page = [F('drive', 'Drive'), F('resonance', 'Resonance'), F('cutoff', 'Cutoff'), F('mix', 'Mix')];
        const L = planPageLayout(page);
        eq('one filter placement', L.filters.length, 1);
        const f = L.filters[0];
        eq('startCol 0', f.startCol, 0);
        eq('cutoff seated col0', L.cells.find(c => c.idx === 2).col, 0);
        eq('resonance seated col1', L.cells.find(c => c.idx === 1).col, 1);
        eq('same line', L.cells.find(c => c.idx === 2).line, L.cells.find(c => c.idx === 1).line);
    }
    // Claim priority: ADSR envelope + cutoff/reso → env owns its line, filter its own.
    {
        const page = [
            F('attack', 'Attack'), F('decay', 'Decay'), F('sustain', 'Sustain'), F('release', 'Release'),
            F('cutoff', 'Cutoff'), F('resonance', 'Resonance'), F('env_amt', 'Env Amt'), F('octave', 'Octave'),
        ];
        const L = planPageLayout(page);
        eq('env + filter both placed', `${L.envelopes.length},${L.filters.length}`, '1,1');
        const envLine = L.envelopes[0].line, fLine = L.filters[0].line;
        eq('env and filter on different lines', envLine !== fLine, true);
        eq('filter cutoff at its col0', L.cells.find(c => c.idx === 4).col, 0);
        eq('filter reso at its col1', L.cells.find(c => c.idx === 5).col, 1);
    }
    // aphex: two pairs → two lines, LP on one, HP on the other.
    {
        const page = [F('lpf_cut', 'LPF Cut'), F('lpf_reso', 'LPF Peak'), F('hpf_cut', 'HPF Cut'), F('hpf_reso', 'HPF Peak'),
            F('freq', 'MG Freq'), F('depth', 'Depth'), F('drive', 'Drive'), F('vol', 'Volume')];
        const L = planPageLayout(page);
        eq('aphex: two filter lines', L.filters.length, 2);
        eq('aphex: on different lines', L.filters[0].line !== L.filters[1].line, true);
    }
}

_log('\nTest: buildFilterViz VM (A1)');
{
    const F = (key, label, type = 'float', options = null, min = 0, max = 1) => ({
        key, label, shortLabel: null, type, options, min,
        max: type === 'enum' ? (options ? options.length - 1 : 1) : max,
        step: type === 'enum' ? 1 : 0.01, renderStyle: 'arc', automatable: true,
    });
    const build = (params, values, all = params, allV = values) =>
        buildFilterViz(planPageLayout(params).filters, params, values, all, allV);

    // Normalized cutoff/resonance from min/max; default LP when no mode.
    {
        const params = [F('cutoff', 'Cutoff', 'float', null, 0, 100), F('resonance', 'Resonance'), F('drive', 'Drive'), F('mix', 'Mix')];
        const vm = build(params, [50, 0.25, 0, 1]);
        eq('one vm', vm.length, 1);
        eq('cutoff normalized 0.5', vm[0].cutoff, 0.5);
        eq('reso normalized 0.25', vm[0].resonance, 0.25);
        eq('default mode lp', vm[0].mode, 'lp');
        eq('startCol 0', vm[0].startCol, 0);
    }
    // Same-page mode enum drives the curve live (value 1 → HP).
    {
        const params = [F('cutoff', 'Cutoff'), F('resonance', 'Resonance'),
            F('mode', 'Mode', 'enum', ['LP', 'HP', 'BP', 'Notch', 'Peak', 'AP']), F('mix', 'Mix')];
        eq('mode value 1 → hp', build(params, [0.5, 0.2, 1, 1])[0].mode, 'hp');
        eq('mode value 3 → notch', build(params, [0.5, 0.2, 3, 1])[0].mode, 'notch');
    }
    // Off-page mode (chordism Main): pair on page, filter_mode elsewhere in chain.
    {
        const pageParams = [F('filter_cutoff', 'Cutoff'), F('filter_resonance', 'Resonance'), F('drive', 'Drive'), F('vol', 'Vol')];
        const pageValues = [0.5, 0.2, 0, 1];
        const allParams = [...pageParams, F('filter_mode', 'Mode', 'enum', ['LP', 'HP', 'BP'])];
        const allValues = [...pageValues, 1];   // 1 = HP
        const vm = buildFilterViz(planPageLayout(pageParams).filters, pageParams, pageValues, allParams, allValues);
        eq('off-page mode → hp', vm[0].mode, 'hp');
    }
    // Static token inference (aphex): lpf → lp, hpf → hp, no enum anywhere.
    {
        const params = [F('lpf_cut', 'LPF Cut'), F('lpf_reso', 'LPF Peak'), F('hpf_cut', 'HPF Cut'), F('hpf_reso', 'HPF Peak')];
        const vm = build(params, [0.5, 0.2, 0.5, 0.2]);
        const lp = vm.find(v => v.startCol === 0 && v.line === planPageLayout(params).filters.find(f => f.cutoff === 0).line);
        eq('aphex vm: two curves', vm.length, 2);
        eq('aphex vm: an lp present', vm.some(v => v.mode === 'lp'), true);
        eq('aphex vm: an hp present', vm.some(v => v.mode === 'hp'), true);
    }
    // Slope from a dedicated 12/24 dB enum.
    {
        const params = [F('filter_cutoff', 'Cutoff'), F('filter_resonance', 'Resonance'),
            F('filter_mode', 'Mode', 'enum', ['LP', 'HP', 'BP']), F('filter_slope', 'Slope', 'enum', ['12 dB', '24 dB'])];
        eq('slope 12 → 0', build(params, [0.5, 0.2, 0, 0])[0].slope, 0);
        eq('slope 24 → 1', build(params, [0.5, 0.2, 0, 1])[0].slope, 1);
    }
}

_log('\nTest: buildViewModel emits filterViz + claim priority (A1)');
{
    const { buildViewModel } = await import('../../dist/esm/model/viewmodel.js');
    const kp = (over) => ({ key: over.key, label: over.label ?? over.key, shortLabel: null, type: over.type ?? 'float',
        min: over.min ?? 0, max: over.max ?? 1, step: 1, options: over.options ?? null,
        renderStyle: 'arc', automatable: false });
    const base = {
        port: portFor(0), componentKey: 'synth', knobPage: 0, bankNames: [], moduleConfig: null,
        enumFmt: [], touchedSlots: [], enumOverlay: null, fileOverlay: null,
        activeModuleName: 'X', moduleId: 'x', drumPadCount: 0, drumCurrentPad: 0,
        drumCurrentPhysPad: 0, noRefreshKeys: new Set(), modulatedKeys: new Set(),
    };
    // Filter module Main page: cutoff/resonance + mode enum → one filterViz.
    {
        const knobParams = [
            kp({ key: 'cutoff', label: 'Cutoff' }), kp({ key: 'resonance', label: 'Resonance' }),
            kp({ key: 'drive', label: 'Drive' }), kp({ key: 'mix', label: 'Mix' }),
            kp({ key: 'env_amount', label: 'Env' }), kp({ key: 'lfo_amount', label: 'LFO' }),
            kp({ key: 'lfo_rate_div', label: 'Div' }),
            kp({ key: 'mode', label: 'Mode', type: 'enum', options: ['LP', 'HP', 'BP', 'Notch', 'Peak', 'AP'], max: 5 }),
        ];
        const knobValues = [0.5, 0.2, 0, 1, 0, 0, 0, 1];   // mode 1 = HP
        const vm = buildViewModel({ ...base, knobParams, knobValues,
            fileValues: knobParams.map(() => null) });
        eq('filterViz present', Array.isArray(vm.filterViz) && vm.filterViz.length === 1, true);
        eq('filterViz mode hp', vm.filterViz[0].mode, 'hp');
        eq('filterViz cutoff 0.5', vm.filterViz[0].cutoff, 0.5);

        // Automation edit: the curve tracks the held-step cutoff, not the base.
        const auto = {
            assignedLanes: 1, activeLanes: 1, held: true, poolFull: false,
            heldValues: new Map([[0, 0.9]]), liveValues: new Map(),
            laneForKey: (k) => (k === 'cutoff' ? 0 : -1),
        };
        const vmA = buildViewModel({ ...base, knobParams, knobValues,
            fileValues: knobParams.map(() => null) }, auto);
        eq('filterViz cutoff follows held automation (0.9)', vmA.filterViz[0].cutoff, 0.9);
    }
    // Claim priority: ADSR env + cutoff/reso coexist — both graphics emitted.
    {
        const knobParams = [
            kp({ key: 'attack', label: 'Attack' }), kp({ key: 'decay', label: 'Decay' }),
            kp({ key: 'sustain', label: 'Sustain' }), kp({ key: 'release', label: 'Release' }),
            kp({ key: 'cutoff', label: 'Cutoff' }), kp({ key: 'resonance', label: 'Resonance' }),
            kp({ key: 'env_amt', label: 'Env Amt' }), kp({ key: 'octave', label: 'Octave' }),
        ];
        const knobValues = [0.1, 0.2, 0.3, 0.4, 0.5, 0.2, 0, 0];
        const vm = buildViewModel({ ...base, knobParams, knobValues, fileValues: knobParams.map(() => null) });
        eq('envelope present', (vm.envelopeLines ?? []).filter(Boolean).length, 1);
        eq('filterViz still present', (vm.filterViz ?? []).length, 1);
        const envLine = vm.envelopeLines.findIndex(Boolean);
        eq('filter on the other line', vm.filterViz[0].line !== envLine, true);
    }
}

}
