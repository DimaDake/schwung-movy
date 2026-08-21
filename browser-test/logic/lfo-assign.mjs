/* browser-test/logic/lfo-assign.mjs — LFO assignment: helpers, modulated params, the hold gesture, the jog hint
 *
 * Run by browser-test/logic.mjs. The suite body is deliberately left at its
 * original indentation inside run() so blame survives the split.
 */

import {
    portFor, lfoTargetsParam, assignLfoTarget, clearLfoTarget, trackScope, holdTouch,
    holdRelease, holdTurnCancel, holdTick, assignActive, assignCycle, assignCommit,
    assignToastText, resetAssignMode, jogHintTouch, jogHintTick, jogHintVisible, eq,
    bankNames, _log, env,
} from './harness.mjs';

export async function run() {
_log('\nTest: lfo assign helpers');
{
    env.setParams({});
    assignLfoTarget(trackScope(0), 0, 'synth', 'cutoff');
    eq('target written', env.params['lfo1:target'], 'synth');
    eq('target_param written', env.params['lfo1:target_param'], 'cutoff');
    eq('enabled written', env.params['lfo1:enabled'], '1');
    eq('targets param true', lfoTargetsParam(trackScope(0), 0, 'synth', 'cutoff'), true);
    eq('targets other false', lfoTargetsParam(trackScope(0), 0, 'synth', 'reso'), false);
    eq('lfo2 not targeting', lfoTargetsParam(trackScope(0), 1, 'synth', 'cutoff'), false);
    clearLfoTarget(trackScope(0), 0);
    eq('target cleared', env.params['lfo1:target'], '');
    eq('enabled cleared', env.params['lfo1:enabled'], '0');
    eq('targets false after clear', lfoTargetsParam(trackScope(0), 0, 'synth', 'cutoff'), false);
}

_log('\nTest: buildViewModel marks modulated params (from cache)');
{
    const { buildViewModel } = await import('../../dist/esm/model/viewmodel.js');
    const { refreshModulatedKeys } = await import('../../dist/esm/model/store.js');
    const kp = (key) => ({ key, label: key, shortLabel: null, type: 'float', min: 0, max: 1, step: 1,
        options: null, renderStyle: 'arc', automatable: true });
    const s = {
        port: portFor(0), componentKey: 'synth', knobPage: 0, bankNames: [], moduleConfig: null,
        knobParams: [kp('cutoff'), kp('reso'), null, null, null, null, null, null],
        knobValues: [0, 0, null, null, null, null, null, null],
        enumFmt: [], fileValues: new Array(8).fill(null), touchedSlots: [],
        enumOverlay: null, fileOverlay: null, activeModuleName: 'X', moduleId: 'x', drumPadCount: 0,
        drumCurrentPad: 0, drumCurrentPhysPad: 0, noRefreshKeys: new Set(), modulatedKeys: new Set(),
    };
    env.setParams({ 'lfo1:target': 'synth', 'lfo1:target_param': 'cutoff' });
    refreshModulatedKeys(s);
    eq('modulatedKeys cached cutoff', s.modulatedKeys.has('cutoff'), true);
    const vm = buildViewModel(s);
    eq('cutoff modulated', vm.rows[0][0].modulated, true);
    eq('reso not modulated', vm.rows[0][1].modulated, false);
    env.setParams({}); refreshModulatedKeys(s);
    eq('none modulated when no target', buildViewModel(s).rows[0][0].modulated, false);
    const sm = { ...s, componentKey: 'master_fx:fx1', modulatedKeys: new Set() };
    env.setParams({ 'lfo1:target': 'master_fx:fx1', 'lfo1:target_param': 'cutoff' });
    refreshModulatedKeys(sm);
    eq('master_fx excluded', sm.modulatedKeys.size, 0);
}

_log('\nTest: LFO assign-mode gesture');
{
    const info = (over = {}) => ({ gi: 0, key: 'cutoff', ioKey: 'cutoff', target: 'synth',
        value: 0, min: 0, max: 1, type: 'float', automatable: true, ...over });
    env.setParams({});
    resetAssignMode();

    holdTouch(trackScope(0), 0, info({ automatable: false }));
    eq('non-automatable does not arm', holdTick(), false);

    resetAssignMode();
    holdTouch(trackScope(0), 0, info());
    eq('not active before 500ms', assignActive(), false);
    holdTurnCancel();
    eq('turn cancels arm', holdTick(), false);

    const realNow = Date.now;
    let t = 1000; Date.now = () => t;
    holdTouch(trackScope(0), 0, info());
    t = 1600; eq('not active before hold time', holdTick(), false);
    t = 2100; eq('activates after hold time', holdTick(), true);
    eq('active flag set', assignActive(), true);
    eq('toast = modulate LFO1', assignToastText(), 'CLICK: MODULATE <LFO1>');

    assignCycle(1);
    eq('toast = modulate LFO2', assignToastText(), 'CLICK: MODULATE <LFO2>');

    const r = assignCommit();
    eq('commit assigned', JSON.stringify(r), JSON.stringify({ assigned: true, lfoIdx: 1 }));
    eq('lfo2 target written', env.params['lfo2:target'], 'synth');
    eq('mode exited after commit', assignActive(), false);

    t = 3000; holdTouch(trackScope(0), 0, info()); t = 4200;
    eq('re-activates', holdTick(), true);
    eq('starts on assigned LFO2', assignToastText(), 'CLICK: REMOVE <LFO2> MOD');
    const r2 = assignCommit();
    eq('commit removed', JSON.stringify(r2), JSON.stringify({ assigned: false, lfoIdx: 1 }));
    eq('lfo2 target cleared', env.params['lfo2:target'], '');

    t = 5000; holdTouch(trackScope(0), 0, info()); t = 6200; holdTick();
    eq('active before release', assignActive(), true);
    holdRelease(0);
    eq('release cancels', assignActive(), false);
    Date.now = realNow;
}

_log('\nTest: jog hint waits out a hold');
{
    const realNow = Date.now;
    let t = 1000; Date.now = () => t;

    jogHintTouch(false);
    eq('idle jog shows nothing', jogHintVisible(), false);

    jogHintTouch(true);
    eq('touch alone shows nothing', jogHintVisible(), false);
    t = 1600; eq('not shown before hold time', jogHintTick(), false);
    t = 2100; eq('shown after hold time', jogHintTick(), true);
    eq('visible', jogHintVisible(), true);
    eq('promotes once', jogHintTick(), false);

    eq('release reports the repaint', jogHintTouch(false), true);
    eq('hidden on release', jogHintVisible(), false);

    // A turn during the wait cancels: no hint, no matter how long the finger stays.
    t = 3000; jogHintTouch(true);
    t = 3200; jogHintTouch(false);   // the turn
    t = 9000; eq('turn cancels the pending hint', jogHintTick(), false);
    eq('still hidden after a turn', jogHintVisible(), false);

    // A turn while it is up takes it away and asks for a repaint.
    t = 10000; jogHintTouch(true); t = 11100; jogHintTick();
    eq('re-arms on the next touch', jogHintVisible(), true);
    eq('turn while shown reports the repaint', jogHintTouch(false), true);
    eq('gone after the turn', jogHintVisible(), false);

    Date.now = realNow;
}

}
