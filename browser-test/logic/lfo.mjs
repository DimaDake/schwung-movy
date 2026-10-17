/* browser-test/logic/lfo.mjs — the LFO target list and the LFO chain slot.
 *
 * Run by browser-test/logic.mjs. (The movy-drawn LFO page, its model and its
 * waveform visualisation were retired with movy's own pages.)
 */

import {
    buildTargetOptions, shortenTarget, targetIndex,
    LFO_SHAPES, LFO_DIVISIONS, compLabel, trackScope,
    CHAIN_SLOTS, LFO_CHAIN_INDEX, isLfoSlot, init, appState,
    eq, _log, env,
} from './harness.mjs';

export async function run() {
_log('\nTest: LFO param helpers');
{
    env.setParams({
        'synth:chain_params': JSON.stringify([
            { key: 'cutoff', name: 'Cutoff', type: 'float' },
            { key: 'reso',   name: 'Resonance', type: 'float' },
            { key: 'wave',   name: 'Wave', type: 'enum' },
            { key: 'label',  name: 'Label', type: 'string' },   // filtered out
        ]),
        'fx1:chain_params': JSON.stringify([
            { key: 'mix', name: 'Mix', type: 'float' },
        ]),
    });
    const opts = buildTargetOptions(trackScope(0), 0);
    eq('target[0] is None', opts[0].label, 'None');
    eq('target[0] target null', opts[0].target, null);
    // Synth: Cutoff/Resonance/Wave (3) + FX1 Mix (1) + other-LFO params (3) = 7, +None = 8
    eq('target option count (string filtered)', opts.length, 8);
    eq('cutoff mapped', JSON.stringify(opts[1]), JSON.stringify({ label: shortenTarget(compLabel('synth'), 'Cutoff'), target: 'synth', param: 'cutoff' }));
    eq('no string-typed param', opts.some(o => o.param === 'label'), false);
    eq('other-LFO target present', opts.some(o => o.target === 'lfo2' && o.param === 'depth'), true);

    eq('shorten fits 11', shortenTarget('Syn', 'Resonance').length <= 11, true);
    eq('shorten format', shortenTarget('Syn', 'Cutoff'), 'Syn:Cutoff');

    eq('targetIndex finds mix', targetIndex(opts, 'fx1', 'mix') > 0, true);
    eq('targetIndex none→0', targetIndex(opts, '', ''), 0);

    eq('shapes count', LFO_SHAPES.length, 6);
    eq('divisions count', LFO_DIVISIONS.length, 27);
}

_log('\nTest: LFO chain slot wiring');
{
    eq('CHAIN_SLOTS has 6 entries', CHAIN_SLOTS.length, 6);
    eq('slot 4 is LFO', CHAIN_SLOTS[4].componentKey, 'lfo');
    eq('LFO_CHAIN_INDEX', LFO_CHAIN_INDEX, 4);
    eq('isLfoSlot(4)', isLfoSlot(4), true);
    eq('isLfoSlot(1)', isLfoSlot(1), false);

    env.setParams({});
    init();
    eq('each track has 6 models', appState.trackModels[0].length, 6);
    eq('track model 5 is MIX', appState.trackModels[0][5].getComponentKey(), 'mix');
    eq('track model 4 is LFO', appState.trackModels[0][4].getComponentKey(), 'lfo');
    eq('track model 1 is a module', appState.trackModels[0][1].getComponentKey(), 'synth');
}

}
