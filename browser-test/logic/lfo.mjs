/* browser-test/logic/lfo.mjs — LFO params, model, target commits, the master chain page, and viz inference
 *
 * Run by browser-test/logic.mjs. The suite body is deliberately left at its
 * original indentation inside run() so blame survives the split.
 */

import {
    portFor, planPageLayout, SHADOW_UI_SLOTS, buildTargetOptions, shortenTarget, targetIndex,
    formatDepth, formatPhase, LFO_SHAPES, LFO_DIVISIONS, compLabel, createLfoModel,
    detectLfoViz, buildLfoViz, lfoShapeId, isShapeEnum, trackScope, masterScope,
    shapeSample, CHAIN_SLOTS, LFO_CHAIN_INDEX, isLfoSlot, init, appState,
    eq, bankNames, P, _log, env,
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
    eq('depth +65%', formatDepth(0.65), '+65%');
    eq('depth -65%', formatDepth(-0.65), '-65%');
    eq('depth 0%', formatDepth(0), '0%');
    eq('phase 180°', formatPhase(0.5), '180°');
}

_log('\nTest: LFO model');
{
    const DETENT = 8; // detent.ts DETENT_DIV — raw delta per ±1 step
    env.setParams({
        'synth:chain_params': JSON.stringify([
            { key: 'cutoff', name: 'Cutoff', type: 'float' },
            { key: 'reso',   name: 'Resonance', type: 'float' },
        ]),
        'lfo1:shape': '0', 'lfo1:polarity': '0', 'lfo1:sync': '0',
        'lfo1:rate_hz': '1.0', 'lfo1:rate_div': '19', 'lfo1:depth': '0',
        'lfo1:phase_offset': '0', 'lfo1:retrigger': '0', 'lfo1:target': '', 'lfo1:target_param': '',
        'lfo2:shape': '1', 'lfo2:sync': '0', 'lfo2:rate_hz': '2.0', 'lfo2:depth': '0',
    });
    const m = createLfoModel(0);
    m.tick();
    let vm = m.getViewModel();
    eq('lfo bankCount', vm.bankCount, 2);
    eq('lfo bank 0 name', vm.moduleName, 'LFO 1');
    eq('pos0 is RATE', vm.rows[0][0].shortName, 'RATE');
    eq('pos1 is SYNC', vm.rows[0][1].shortName, 'SYNC');
    eq('pos2 is MODE', vm.rows[0][2].shortName, 'MODE');
    eq('pos3 is TARGET', vm.rows[0][3].shortName, 'TARGET');
    eq('pos4 is SHAPE', vm.rows[1][0].shortName, 'SHAPE');
    eq('pos5 is PHASE', vm.rows[1][1].shortName, 'PHASE');
    eq('pos6 is RETRIG', vm.rows[1][2].shortName, 'RETRIG');
    eq('pos7 is DEPTH', vm.rows[1][3].shortName, 'DEPTH');
    eq('lfoViz on line 1', vm.lfoViz && vm.lfoViz[0].line, 1);
    eq('lfoViz spans shape+phase', vm.lfoViz[0].startCol, 0);
    eq('no LFO cell is automatable', [...vm.rows[0], ...vm.rows[1]].every(c => c && c.automatable === false), true);
    eq('getKnobParamInfo null (not automatable)', m.getKnobParamInfo(0), null);
    eq('componentKey', m.getComponentKey(), 'lfo');

    // Mode (polarity) inline enum — pos 2.
    m.handleKnobDelta(2, DETENT);
    eq('polarity set to Bipolar', env.params['lfo1:polarity'], '1');
    eq('mode display BI', m.getViewModel().rows[0][2].displayValue, 'BI');
    eq('lfoViz mode follows polarity', m.getViewModel().lfoViz[0].mode, 1);

    // Sync — pos 1 — toggles Rate (pos 0) display.
    eq('rate shows Hz when free', m.getViewModel().rows[0][0].displayValue, '1.0 Hz');
    m.handleKnobDelta(1, DETENT);
    eq('sync set', env.params['lfo1:sync'], '1');
    eq('rate shows division when sync', m.getViewModel().rows[0][0].displayValue, '1/4');

    // Rate — pos 0 — division +1, then free clamp.
    m.handleKnobDelta(0, DETENT);
    eq('rate_div incremented', env.params['lfo1:rate_div'], '20');
    m.handleKnobDelta(1, -DETENT);
    eq('sync cleared', env.params['lfo1:sync'], '0');
    m.handleKnobDelta(0, DETENT * 200);
    eq('rate_hz clamped ≤ 20', parseFloat(env.params['lfo1:rate_hz']) <= 20.0, true);

    // Depth — pos 7 — clamps to −1.
    m.handleKnobDelta(7, -1000);
    eq('depth clamped exactly -1', parseFloat(env.params['lfo1:depth']), -1);

    // Target overlay — pos 3.
    m.handleKnobTouch(3);
    vm = m.getViewModel();
    eq('overlay open on target', vm.overlay !== null, true);
    eq('overlay slot 3', vm.overlay.slot, 3);
    eq('overlay first option None', vm.overlay.options[0], 'None');
    m.handleKnobDelta(3, DETENT);       // select option 1 (first real target)
    m.handleKnobRelease(3);
    eq('target committed', env.params['lfo1:target'], 'synth');
    eq('target_param committed', env.params['lfo1:target_param'], 'cutoff');
    eq('auto-enabled on target', env.params['lfo1:enabled'], '1');
    eq('overlay closed', m.getViewModel().overlay, null);

    // Shape — pos 4 — cycling enum, NO overlay.
    m.handleKnobDelta(4, DETENT * 2);   // +2 shapes → index 2 (Saw)
    eq('shape cycled to 2', env.params['lfo1:shape'], '2');
    eq('lfoViz shape follows', m.getViewModel().lfoViz[0].shape, 2);
    m.handleKnobTouch(4);
    eq('shape touch does NOT open overlay', m.getViewModel().overlay, null);
    m.handleKnobRelease(4);

    // Phase — pos 5 — snaps to a 15° grid (exact 45/90/180 selectable).
    m.handleKnobDelta(5, DETENT * 3);   // +3 steps × 15° = 45°
    eq('phase snaps to 45°', m.getViewModel().rows[1][1].displayValue, '45°');
    m.handleKnobDelta(5, DETENT * 3);   // +45° → 90°
    eq('phase snaps to 90°', m.getViewModel().rows[1][1].displayValue, '90°');
    eq('phase exact 0.25', parseFloat(env.params['lfo1:phase_offset']), 0.25);

    // Retrigger — pos 6.
    m.handleKnobDelta(6, DETENT);
    eq('retrigger on', env.params['lfo1:retrigger'], '1');
    eq('lfoViz retrigger follows', m.getViewModel().lfoViz[0].retrigger, 1);

    m.changePage(1);
    vm = m.getViewModel();
    eq('bank 1 name', vm.moduleName, 'LFO 2');
    eq('bank index', vm.bankIndex, 1);
    m.handleKnobDelta(2, DETENT);
    eq('lfo2 polarity written', env.params['lfo2:polarity'], '1');
    eq('lfo1 polarity untouched', env.params['lfo1:polarity'], '1');

    eq('lfo never empty', m.getViewModel().isEmpty, false);
    eq('getDrumConfig null', m.getDrumConfig(), null);
    eq('getFileBrowseTarget null', m.getFileBrowseTarget(), null);
}

_log('\nTest: LFO target commit uses blocking writes (device SHM race)');
{
    const DETENT = 8;
    env.setParams({
        'synth:chain_params': JSON.stringify([{ key: 'cutoff', name: 'Cutoff', type: 'float' }]),
        'lfo1:target': '', 'lfo1:target_param': '',
    });
    // Capture blocking writes; the target commit must go through this path so
    // target+target_param+enabled all land (non-blocking would clobber on device).
    const blocking = [];
    globalThis.shadow_set_param_timeout = (slot, key, val) => {
        if (!(slot >= 0 && slot < SHADOW_UI_SLOTS)) return false;
        blocking.push([key, val]); env.params[key] = val; return true;
    };
    const m2 = createLfoModel(0);
    m2.tick();
    m2.handleKnobTouch(3);
    m2.handleKnobDelta(3, DETENT);     // select the first real target
    m2.handleKnobRelease(3);
    eq('target written blocking', blocking.some(([k, v]) => k === 'lfo1:target' && v === 'synth'), true);
    eq('target_param written blocking', blocking.some(([k, v]) => k === 'lfo1:target_param' && v === 'cutoff'), true);
    eq('enabled written blocking', blocking.some(([k, v]) => k === 'lfo1:enabled' && v === '1'), true);
    // No periodic re-read clobber: many ticks later the target is still set.
    for (let i = 0; i < 400; i++) m2.tick();
    eq('target persists across ticks (no poll clobber)', m2.getViewModel().rows[0][3].displayValue !== 'None', true);
    env.restoreSetParamTimeout();
}

_log('\nTest: LFO target commit reaches a movy-hosted track');
{
    /* A movy track is a chain in movy's own engine, not a schwung slot: its
     * params are `ch<N>:…` over the engine's param channel. The slot-addressed
     * API refuses the write outright (env.mjs models the real guard), so a
     * commit that goes anywhere near it assigns nothing and the LFO never runs
     * — which is precisely how it failed on device. */
    const { resetPorts } = await import('../../dist/esm/track/registry.js');
    const DETENT = 8;
    const chain = {};
    const oG = globalThis.host_module_get_param;
    const oS = globalThis.host_module_set_param;
    const oB = globalThis.host_module_set_param_blocking;
    globalThis.host_module_get_param = (k) => chain[k] ?? null;
    globalThis.host_module_set_param = (k, v) => { chain[k] = v; return true; };
    globalThis.host_module_set_param_blocking = (k, v) => { chain[k] = v; return true; };
    chain['ch0:synth:chain_params'] = JSON.stringify([{ key: 'cutoff', name: 'Cutoff', type: 'float' }]);
    resetPorts();

    const m3 = createLfoModel(4);          // track 5 = movy chain 0
    m3.tick();
    m3.handleKnobTouch(3);
    m3.handleKnobDelta(3, DETENT);         // first real target
    m3.handleKnobRelease(3);

    eq('movy track: target reached the chain',       chain['ch0:lfo1:target'], 'synth');
    eq('movy track: target_param reached the chain', chain['ch0:lfo1:target_param'], 'cutoff');
    eq('movy track: enabled reached the chain',      chain['ch0:lfo1:enabled'], '1');

    /* Clearing has to travel the same road, or a target can be set and never
     * removed. */
    m3.handleKnobTouch(3);
    m3.handleKnobDelta(3, -DETENT * 4);    // back up to None
    m3.handleKnobRelease(3);
    eq('movy track: clear reached the chain',   chain['ch0:lfo1:target'], '');
    eq('movy track: disabled reached the chain', chain['ch0:lfo1:enabled'], '0');

    globalThis.host_module_get_param = oG;
    globalThis.host_module_set_param = oS;
    globalThis.host_module_set_param_blocking = oB;
    resetPorts();
}

_log('\nTest: master chain LFO page');
{
    const { MASTER_FX_SLOTS, MASTER_LFO_INDEX, isMasterLfoSlot, isVirtualSlot } = await import('../../dist/esm/chain/config.js');
    const { createScopedLfoModel } = await import('../../dist/esm/lfo/model.js');
    const { resetPorts } = await import('../../dist/esm/track/registry.js');
    const DETENT = 8;

    eq('master chain has an LFO slot', MASTER_FX_SLOTS.length, 5);
    eq('it is last', MASTER_LFO_INDEX, 4);
    eq('isMasterLfoSlot(4)', isMasterLfoSlot(4), true);
    eq('isMasterLfoSlot(0)', isMasterLfoSlot(0), false);
    eq('the LFO slot is virtual', isVirtualSlot(MASTER_FX_SLOTS[4]), true);
    eq('an FX slot is not', isVirtualSlot(MASTER_FX_SLOTS[0]), false);

    /* The master LFOs live in the shim under `master_fx:`, reachable through any
     * slot — so they are read and written on slot 0 with a namespaced key. */
    env.setParams({
        'master_fx:fx2:chain_params': JSON.stringify([{ key: 'mix', name: 'Mix', type: 'float' }]),
        'master_fx:lfo1:target': '', 'master_fx:lfo1:target_param': '',
    });
    resetPorts();
    const mm = createScopedLfoModel(masterScope());
    mm.tick();

    const mvm = mm.getViewModel();
    eq('master LFO page names itself', mvm.moduleName, 'LFO 1');
    eq('master LFO has two banks', mvm.bankCount, 2);
    eq('master component key is namespaced', mm.getComponentKey(), 'master_fx:lfo');
    /* No notes on the master bus, so no retrigger — and the shim has no key for
     * it. A blank cell, not a dead knob. */
    eq('knob 7 (RETRIG) is blank on master', mvm.rows[1][2], null);
    eq('knob 8 is still DEPTH', mvm.rows[1][3].shortName, 'DEPTH');
    eq('the waveform still spans shape+phase', mvm.lfoViz[0].startCol, 0);

    /* Turning the blank knob must write nothing: the shim would drop it anyway,
     * and a value the hardware never took is worse than no value. */
    mm.handleKnobDelta(6, DETENT * 4);
    eq('a turn of the blank knob writes nothing', env.params['master_fx:lfo1:retrigger'], undefined);

    /* Targets are the four master FX slots, named as the shim parses them —
     * bare `fx2`, never `master_fx:fx2`, which would match no slot. */
    const mopts = buildTargetOptions(masterScope(), 0);
    eq('master targets exclude synth', mopts.some(o => o.target === 'synth'), false);
    const mixOpt = mopts.find(o => o.param === 'mix');
    eq('a loaded master FX param is offered', !!mixOpt, true);
    eq('the target is the bare slot key', mixOpt.target, 'fx2');
    eq('the other master LFO is offered', mopts.some(o => o.target === 'lfo2'), true);

    /* And the commit reaches the shim's namespaced keys. */
    mm.handleKnobTouch(3);
    mm.handleKnobDelta(3, DETENT);
    mm.handleKnobRelease(3);
    eq('master target committed',       env.params['master_fx:lfo1:target'], 'fx2');
    eq('master target_param committed', env.params['master_fx:lfo1:target_param'], 'mix');
    eq('master LFO auto-enabled',       env.params['master_fx:lfo1:enabled'], '1');
    /* Never the track form: an un-namespaced key would edit track 1's LFO. */
    eq('nothing written to a track LFO key', env.params['lfo1:target'], undefined);

    /* A depth turn goes to the same namespace. */
    mm.handleKnobDelta(7, DETENT);
    eq('master depth written namespaced', typeof env.params['master_fx:lfo1:depth'], 'string');

    resetPorts();
}

_log('\nTest: LFO chain slot wiring');
{
    eq('CHAIN_SLOTS has 5 entries', CHAIN_SLOTS.length, 5);
    eq('slot 4 is LFO', CHAIN_SLOTS[4].componentKey, 'lfo');
    eq('LFO_CHAIN_INDEX', LFO_CHAIN_INDEX, 4);
    eq('isLfoSlot(4)', isLfoSlot(4), true);
    eq('isLfoSlot(1)', isLfoSlot(1), false);

    env.setParams({});
    init();
    eq('each track has 5 models', appState.trackModels[0].length, 5);
    eq('track model 4 is LFO', appState.trackModels[0][4].getComponentKey(), 'lfo');
    eq('track model 1 is a module', appState.trackModels[0][1].getComponentKey(), 'synth');
}

_log('\nTest: detectLfoViz');
{
    const P = (lfo) => ({ key: lfo ?? 'x', lfo, type: 'float', min: 0, max: 1, step: 1, options: null, renderStyle: 'arc', shortLabel: null, label: '', automatable: false });
    const g1 = detectLfoViz([P('shape'), P('phase'), P('mode'), P('retrig'), null, null, null, null]);
    eq('one group', g1.length, 1);
    eq('shape idx', g1[0].shape, 0);
    eq('phase idx', g1[0].phase, 1);
    eq('mode idx', g1[0].mode, 2);
    eq('retrig idx', g1[0].retrig, 3);
    const g2 = detectLfoViz([P('shape'), P('phase'), null, null, null, null, null, null]);
    eq('mode/retrig optional', JSON.stringify([g2[0].mode, g2[0].retrig]), JSON.stringify([null, null]));
    const g3 = detectLfoViz([P('shape'), P(null), null, null, null, null, null, null]);
    eq('needs phase', g3.length, 0);
    const g4 = detectLfoViz([P(null), P(null)]);
    eq('no markers → none', g4.length, 0);
}

_log('\nTest: module-LFO viz inference (A3)');
{
    const LP = (key, label, type, options = null) => ({
        key, label, type, options,
        min: 0, max: type === 'enum' ? options.length - 1 : 1, step: type === 'enum' ? 1 : 0.01,
        renderStyle: 'arc', shortLabel: null, automatable: true, lfo: undefined,
    });
    // Run detection + layout reorder + VM build the way the real pipeline does.
    const viz = (params, values) => buildLfoViz(planPageLayout(params).lfos, params, values);

    // Shape name → id mapping (renderer table).
    eq('map: Ramp Down → saw-down 6', lfoShapeId('Ramp Down'), 6);
    eq('map: Sample & Hold → 4', lfoShapeId('Sample & Hold'), 4);
    eq('map: Step Sequencer → 9', lfoShapeId('Step Sequencer'), 9);
    eq('map: Wave 3 → generic 10', lfoShapeId('Wave 3'), 10);
    eq('map: Cutoff → not a shape', lfoShapeId('Cutoff'), null);
    eq('isShapeEnum: division list is not a shape', isShapeEnum(['Off', '1/4', '1/8']), false);

    // chordism-like: Shape(enum wave) + Rate → reordered onto one line, rate encoded.
    {
        const params = [
            LP('lfo_shape', 'LFO Wave', 'enum', ['Triangle', 'Ramp Up', 'Ramp Down', 'Square']),
            LP('lfo_rate', 'LFO Rate', 'float'),
            LP('lfo_depth', 'LFO Depth', 'float'),
            LP('cutoff', 'Cutoff', 'float'),
        ];
        const g = detectLfoViz(params);
        eq('chordism: one group', g.length, 1);
        eq('chordism: inferred', g[0].inferred, true);
        // no phase → partner is rate; layout seats shape+rate at cols 0,1.
        const L = planPageLayout(params);
        eq('chordism layout: partner is rate', L.lfos[0].partnerRole, 'rate');
        eq('chordism layout: shape col0, rate col1', `${L.cells.find(c => c.idx === 0).col},${L.cells.find(c => c.idx === 1).col}`, '0,1');
        const vm = viz(params, [2, 0.5, 0.3, 0.4]);   // value 2 = Ramp Down, rate 0.5
        eq('chordism vm: shape id 6', vm[0].shape, 6);
        eq('chordism vm: startCol 0', vm[0].startCol, 0);
        eq('chordism vm: rate → 1.5 cycles', vm[0].cycles, 1.5);
    }
    // helm-like: shape names and role words the vocabulary used to miss.
    {
        const HELM_SHAPES = ['Sine', 'Triangle', 'Square', 'Saw Up', 'Saw Down',
            '3 Step', '4 Step', '8 Step', '3 Pyramid', '5 Pyramid', '9 Pyramid',
            'Sample & Hold', 'Sample & Glide'];
        eq('map: Saw Up → saw-up 2',            lfoShapeId('Saw Up'), 2);
        eq('map: Sample & Glide → smooth 5',    lfoShapeId('Sample & Glide'), 5);
        /* The level COUNT rides in the id, so 3/4/8 Step are three different
         * silhouettes rather than one. Without this they collapse together. */
        eq('map: 8 Step → stepped ramp, count 8',   lfoShapeId('8 Step'), 108);
        eq('map: 3 Step → stepped ramp, count 3',   lfoShapeId('3 Step'), 103);
        eq('map: 5 Pyramid → stepped tri, count 5', lfoShapeId('5 Pyramid'), 205);
        eq('map: 9 Pyramid → stepped tri, count 9', lfoShapeId('9 Pyramid'), 209);
        eq('step counts are distinct',
            new Set(['3 Step','4 Step','8 Step'].map(lfoShapeId)).size, 3);
        eq('pyramid counts are distinct',
            new Set(['3 Pyramid','5 Pyramid','9 Pyramid'].map(lfoShapeId)).size, 3);
        /* A stepped climb must not collide with the SAME list's smooth Saw Up
         * or Triangle — that pair is why the cell glyph uses full height. */
        eq('8 Step is not Saw Up',   lfoShapeId('8 Step') !== lfoShapeId('Saw Up'), true);
        eq('9 Pyramid is not Triangle', lfoShapeId('9 Pyramid') !== lfoShapeId('Triangle'), true);
        eq('isShapeEnum: helm waveform list',   isShapeEnum(HELM_SHAPES), true);
        // A quantize enum that merely mentions steps stays a non-shape list.
        eq('isShapeEnum: smack quantize list is not a shape',
            isShapeEnum(['1 Step', '1/2 Step', '2 Steps', '4 Steps']), false);

        const params = [
            LP('mono_lfo_1_waveform',  'Mono LFO 1 Waveform',  'enum', HELM_SHAPES),
            LP('mono_lfo_1_amplitude', 'Mono LFO 1 Amp',       'float'),
            LP('mono_lfo_1_frequency', 'Mono LFO 1 Frequency', 'float'),
            LP('mono_lfo_1_sync',      'Mono LFO 1 Sync',      'enum', ['Seconds', 'Tempo']),
        ];
        const g = detectLfoViz(params);
        eq('helm: one group', g.length, 1);
        eq('helm: frequency is the rate role', g[0].rate, 2);
        eq('helm: amplitude is the depth role', g[0].depth, 1);
        const L = planPageLayout(params);
        eq('helm layout: partner is rate', L.lfos[0].partnerRole, 'rate');
        const vm = viz(params, [7, 0.5, 0.5, 0]);   // option 7 = "8 Step"
        eq('helm vm: shape id 108 (8 Step)', vm[0].shape, 108);
    }
    // minijv-like: the role word is glued onto the LFO token in the key.
    {
        const params = [
            LP('nvram_tone_0_lfo1form', 'LFO1 Form', 'enum', ['TRI', 'SIN', 'SAW', 'SQU']),
            LP('nvram_tone_0_lfo1rate', 'LFO1 Rate', 'float'),
            LP('nvram_tone_0_lfo1delay', 'LFO1 Delay', 'float'),
        ];
        const g = detectLfoViz(params);
        eq('minijv: one group', g.length, 1);
        eq('minijv: rate grouped with shape', g[0].rate, 1);
        eq('minijv layout: placed', planPageLayout(params).lfos.length, 1);
    }
    // fizzik-like: two LFO rows → two groups reordered onto their own lines.
    {
        const shp = ['Sine', 'Tri', 'Saw', 'Square', 'S&H'];
        const tgt = ['Off', 'Cutoff', 'Pitch'];
        const params = [
            LP('lfo1_rate', 'LFO1 Rate', 'float'), LP('lfo1_depth', 'LFO1 Depth', 'float'),
            LP('lfo1_shape', 'LFO1 Shape', 'enum', shp), LP('lfo1_target', 'LFO1 Target', 'enum', tgt),
            LP('lfo2_rate', 'LFO2 Rate', 'float'), LP('lfo2_depth', 'LFO2 Depth', 'float'),
            LP('lfo2_shape', 'LFO2 Shape', 'enum', shp), LP('lfo2_target', 'LFO2 Target', 'enum', tgt),
        ];
        eq('fizzik: two groups', detectLfoViz(params).length, 2);
        const vm = viz(params, [0.3, 0.5, 2, 1, 0.4, 0.6, 3, 0]);
        eq('fizzik vm: two groups', vm.length, 2);
        eq('fizzik vm: g0 startCol 0', vm[0].startCol, 0);
        eq('fizzik vm: g1 line 1', vm[1].line, 1);
        // Shape(idx2) reordered to line0 col0, Rate(idx0) to col1; Target stays a knob.
        const L = planPageLayout(params);
        eq('fizzik layout: shape idx2 at col0', L.cells.find(c => c.idx === 2).col, 0);
        eq('fizzik layout: target idx3 not col0/1', L.cells.find(c => c.idx === 3).col > 1, true);
    }
    // osirus-like: Poly|Mono must NOT be polarity; Symmetry → deform.
    {
        const params = [
            LP('lfo1_shape', 'LFO1 Shape', 'enum', ['Sine', 'Triangle', 'Saw', 'Square', 'S&H', 'S&G', 'Wave 3', 'Wave 4']),
            LP('lfo1_rate', 'LFO1 Rate', 'float'),
            LP('lfo1_mode', 'LFO1 Mode', 'enum', ['Poly', 'Mono']),
            LP('lfo1_symmetry', 'LFO1 Symmetry', 'float'),
        ];
        const g = detectLfoViz(params);
        eq('osirus: one group', g.length, 1);
        eq('osirus: Poly|Mono not polarity', g[0].mode, null);
        eq('osirus: symmetry → deform idx3', g[0].deform, 3);
    }
    // Unmapped shape value (Wave 17) → generic glyph 10; viz not dropped.
    {
        const opts = ['Sine', 'Triangle', 'Saw', 'Square', 'S&H', 'S&G', 'Wave 3', 'Wave 17'];
        const params = [LP('lfo1_shape', 'LFO1 Shape', 'enum', opts), LP('lfo1_rate', 'LFO1 Rate', 'float'), null, null];
        const vm = viz(params, [7, 0.5, null, null]);
        eq('unmapped: viz kept', vm.length, 1);
        eq('unmapped: generic 10', vm[0].shape, 10);
    }
    // Rate partner → cycle count (1..2), keeping the wave readable; depth not drawn.
    {
        const params = [LP('lfo_shape', 'LFO Wave', 'enum', ['Sine', 'Tri', 'Saw', 'Square']),
            LP('lfo_rate', 'LFO Rate', 'float'), LP('lfo_depth', 'LFO Depth', 'float'), null];
        eq('rate min → 1 cycle', viz(params, [0, 0, 0.5, null])[0].cycles, 1);
        eq('rate max → 2 cycles', viz(params, [0, 1, 0.5, null])[0].cycles, 2);
        eq('rate mid → 1.5 cycles', viz(params, [0, 0.5, 0.5, null])[0].cycles, 1.5);
        eq('depth not the partner → no ampScale', 'ampScale' in viz(params, [0, 0.5, 0.5, null])[0], false);
    }
    // Phase partner (preferred) → fixed 2-cycle specimen, rate keeps its own knob.
    {
        const params = [LP('lfo_shape', 'LFO Wave', 'enum', ['Sine', 'Tri', 'Saw', 'Square']),
            LP('lfo_phase', 'LFO Phase', 'float'), LP('lfo_rate', 'LFO Rate', 'float'), null];
        eq('phase preferred: partner phase', planPageLayout(params).lfos[0].partnerRole, 'phase');
        eq('phase partner → 2 cycles', viz(params, [0, 0.25, 0.9, null])[0].cycles, 2);
    }
    // Depth partner (no phase, no rate) → floored amplitude, never flat.
    {
        const params = [LP('lfo_shape', 'LFO Wave', 'enum', ['Sine', 'Tri', 'Saw', 'Square']),
            LP('lfo_depth', 'LFO Depth', 'float'), null, null];
        eq('depth partner', planPageLayout(params).lfos[0].partnerRole, 'depth');
        eq('depth 0 → floored amp 0.35', viz(params, [0, 0, null, null])[0].ampScale, 0.35);
        eq('depth 1 → full amp 1', viz(params, [0, 1, null, null])[0].ampScale, 1);
    }
}

_log('\nTest: LFO shapeSample');
{
    const near = (a, b) => Math.abs(a - b) < 0.001;
    eq('sine @0', near(shapeSample(0, 0), 0), true);
    eq('sine @0.25', near(shapeSample(0, 0.25), 1), true);
    eq('tri @0.25 peak', near(shapeSample(1, 0.25), 1), true);
    eq('saw @0', near(shapeSample(2, 0), -1), true);
    eq('square low half', shapeSample(3, 0.1), 1);
    eq('square high half', shapeSample(3, 0.6), -1);
    eq('wraps by 1', near(shapeSample(0, 1.25), shapeSample(0, 0.25)), true);
    eq('unknown → sine', near(shapeSample(99, 0.25), 1), true);
    eq('bipolar range', shapeSample(4, 0.3) >= -1 && shapeSample(4, 0.3) <= 1, true);
    // A3 shapes 6..10 — deterministic and in bipolar range.
    eq('saw down @0 = +1', near(shapeSample(6, 0), 1), true);
    eq('saw down @0.5 = 0', near(shapeSample(6, 0.5), 0), true);
    eq('noise deterministic', shapeSample(7, 0.3), shapeSample(7, 0.3));
    eq('noise in range', shapeSample(7, 0.3) >= -1 && shapeSample(7, 0.3) <= 1, true);
    eq('envelope glyph peaks early', near(shapeSample(8, 0.12), 1), true);
    eq('staircase stepped', shapeSample(9, 0.05), shapeSample(9, 0.10));   // same step
    eq('generic deterministic', shapeSample(10, 0.4), shapeSample(10, 0.4));
    for (let s = 6; s <= 10; s++)
        eq(`shape ${s} in range`, shapeSample(s, 0.37) >= -1.001 && shapeSample(s, 0.37) <= 1.001, true);
}

_log('\nTest: buildViewModel emits lfoViz (synth reuse)');
{
    const { buildViewModel } = await import('../../dist/esm/model/viewmodel.js');
    const kp = (over) => ({ key: over.key, label: over.key, shortLabel: null, type: over.type ?? 'float',
        min: over.min ?? 0, max: over.max ?? 1, step: 1, options: over.options ?? null,
        renderStyle: 'arc', automatable: false, lfo: over.lfo });
    const s = {
        port: portFor(0), componentKey: 'synth', knobPage: 0, bankNames: [], moduleConfig: null,
        knobParams: [
            kp({ key: 'a' }), kp({ key: 'b' }), kp({ key: 'mode', type: 'enum', options: ['U','B'], max: 1, lfo: 'mode' }), kp({ key: 'd' }),
            kp({ key: 'shp', type: 'enum', options: ['a','b','c','d','e','f'], max: 5, lfo: 'shape' }),
            kp({ key: 'phs', lfo: 'phase' }), kp({ key: 'rt', type: 'int', max: 1, lfo: 'retrig' }), kp({ key: 'amt' }),
        ],
        knobValues: [0, 0, 1, 0, 2, 0.25, 1, 0],
        enumFmt: [], fileValues: [null,null,null,null,null,null,null,null], touchedSlots: [],
        enumOverlay: null, fileOverlay: null, activeModuleName: 'X', moduleId: 'x', drumPadCount: 0,
        drumCurrentPad: 0, drumCurrentPhysPad: 0, noRefreshKeys: new Set(), modulatedKeys: new Set(),
    };
    const vm = buildViewModel(s);
    eq('lfoViz present', Array.isArray(vm.lfoViz) && vm.lfoViz.length === 1, true);
    eq('viz line 1', vm.lfoViz[0].line, 1);
    eq('viz startCol 0', vm.lfoViz[0].startCol, 0);
    eq('viz shape from value', vm.lfoViz[0].shape, 2);
    eq('viz phase from value', vm.lfoViz[0].phase, 0.25);
    eq('viz mode from value', vm.lfoViz[0].mode, 1);
    eq('viz retrig from value', vm.lfoViz[0].retrigger, 1);
}

}
