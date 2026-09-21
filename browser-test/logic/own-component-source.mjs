/* browser-test/logic/own-component-source.mjs — SP-55's MIX and LFO pages on
 * the virtual-component seam. Unlike Clip/Set/Step Params these wrap a REAL
 * port (`portFor`/`hostPort`) rather than `seqState` — the teeth here are the
 * translation: MIX's composite engine param survives a read-modify-write, an
 * LFO cell reaches the real `lfoN:key` behind it, and an LFO cell is refused
 * automation the same way the movy model always has been.
 *
 * Run by browser-test/logic.mjs.
 */

import {
    eq, ok, _log, schwungLibAvailable, setSchwungGridMode, schwungGridReload, schwungPageFor,
} from './harness.mjs';

/* A tiny fake chain-param engine: SET updates the same map GET reads from, so
 * a read-modify-write is proven by what a LATER get() sees, not asserted by
 * inspecting the write call's own payload. */
function mockEngine() {
    const store = {};
    const writes = [];
    const oG = globalThis.host_module_get_param;
    const oS = globalThis.host_module_set_param_blocking;
    globalThis.host_module_get_param = (k) => (k in store ? store[k] : null);
    globalThis.host_module_set_param_blocking = (k, v) => { store[k] = v; writes.push([k, v]); return true; };
    return { store, writes, restore() { globalThis.host_module_get_param = oG; globalThis.host_module_set_param_blocking = oS; } };
}

export async function run() {

const { resetPorts } = await import('../../dist/esm/track/registry.js');
const { mixSchwungSource } = await import('../../dist/esm/mixer/mix-schwung-cells.js');
const { fieldFrac, fieldFromFrac, formatDb, formatPan, packMixValue } =
    await import('../../dist/esm/mixer/mix-io.js');

/* ── MIX: the contract, and the read-modify-write ─────────────────────────── */
_log('\nTest: MIX virtual source (SP-55)');
{
    const eng = mockEngine();
    resetPorts();
    const source = mixSchwungSource(0);

    const hier = JSON.parse(source.getParam('mix:ui_hierarchy'));
    eq('five real fields, no blank-knob holes', hier.levels.root.knobs.join(','),
       'gain,pan,send1,send2,send3');
    const params = JSON.parse(source.getParam('mix:chain_params'));
    eq('one entry per field', params.length, 5);
    ok('every cell is a plain float 0..1 (native first, POSITION units)',
       params.every((p) => p.type === 'float' && p.min === 0 && p.max === 1));

    /* THE TEETH: gain set first, then a send — the send write must carry
     * gain forward. Reverting `applyMixFieldAbs` to read `defaultMix()`
     * instead of `readMix(track)` (a one-line change) makes gain silently
     * reset to unity on the very next field's write — this reddens it. */
    source.setParam('mix:gain', fieldFrac('gain', 2.0).toFixed(4));   // +6 dB-ish
    source.setParam('mix:send1', fieldFrac('send1', 0.5).toFixed(4));
    const packed = eng.store['ch0:mix'];
    const v = { gain: parseFloat(packed.split(',')[0]) };
    ok('the earlier field survived the later write (read-modify-write)',
       Math.abs(v.gain - 2.0) < 1e-3);
    eq('and the engine got the whole packed value', packed.split(',').length >= 4, true);

    /* format() prints the field's own unit, not the raw 0..1 position. */
    const rawGain = source.getParam('mix:gain');
    eq('format() prints dB text for gain', source.formatValue('mix:gain', rawGain, 'cell'),
       formatDb(fieldFromFrac('gain', parseFloat(rawGain))));
    source.setParam('mix:pan', fieldFrac('pan', -1).toFixed(4));   // hard left
    const rawPan = source.getParam('mix:pan');
    eq('format() prints pan text', source.formatValue('mix:pan', rawPan, 'cell'), 'L100');

    eng.restore();
    resetPorts();
}

/* ── LFO: two banks, 16 keys, real per-field port translation ─────────────── */
_log('\nTest: LFO virtual source (SP-55)');
{
    const { lfoSchwungSource } = await import('../../dist/esm/lfo/lfo-schwung-cells.js');
    const { trackScope, masterScope } = await import('../../dist/esm/lfo/scope.js');
    const { LFO_DIVISIONS, RATE_HZ_MIN, RATE_HZ_FACTOR } = await import('../../dist/esm/lfo/params.js');

    const eng = mockEngine();
    resetPorts();
    const scope = trackScope(0);
    const source = lfoSchwungSource(scope);

    const hier = JSON.parse(source.getParam('lfo:ui_hierarchy'));
    eq('sixteen keys, bank order preserved (8 chunks a Schwung page at)',
       hier.levels.root.knobs.length, 16);
    ok('bank 0 first, bank 1 second', hier.levels.root.knobs[0].startsWith('b0_')
       && hier.levels.root.knobs[8].startsWith('b1_'));

    /* A cell reaches the REAL per-LFO key, not a flat 'lfo:*' one nothing
     * answers. Reverting `lfoKey`'s use inside `readParam`/`writeLfoParam`'s
     * caller to the bare cell key would leave `ch0:lfo1:depth` unwritten and
     * this reads back 0 (the default) instead of what was set. */
    source.setParam('lfo:b0_depth', '0.5000');
    eq('depth reached the real lfo1: key', eng.store['ch0:lfo1:depth'], '0.5000');
    eq('and the cell reads it back', source.getParam('lfo:b0_depth'), '0.5');
    eq('bank 1 is independent (lfo2:, untouched)', eng.store['ch0:lfo2:depth'], undefined);

    /* RATE, unsynced: the 41-stop ladder round-trips index -> Hz -> index. */
    eng.store['ch0:lfo1:sync'] = '0';
    source.setParam('lfo:b0_rate', '10');
    const hz = parseFloat(eng.store['ch0:lfo1:rate_hz']);
    ok('index 10 wrote a Hz value on the ladder',
       Math.abs(hz - RATE_HZ_MIN * Math.pow(RATE_HZ_FACTOR, 10)) < 1e-3);
    eq('and reads back the SAME index', source.getParam('lfo:b0_rate'), '10');

    /* RATE, synced: the same cell switches to the division ladder. */
    eng.store['ch0:lfo1:sync'] = '1';
    const opts = JSON.parse(source.getParam('lfo:chain_params')).find((p) => p.key === 'b0_rate').options;
    eq('synced options are the division table', opts.length, LFO_DIVISIONS.length);
    source.setParam('lfo:b0_rate', '3');
    eq('a synced write lands on rate_div, not rate_hz', eng.store['ch0:lfo1:rate_div'], '3');

    /* NOT AUTOMATABLE, through the real page — the fix is in
     * `schwung-page-render.ts`, not in this source, so the teeth need the
     * real page built (`schwungPageFor`), same as SP-53/54's own "plans and
     * settles under page" checks. */
    if (!schwungLibAvailable()) {
        _log('  (the automation-guard check SKIPPED — no param_pages; set SCHWUNG=)');
    } else {
        setSchwungGridMode('page');
        schwungGridReload();
        const page = schwungPageFor(0, 'lfo', null, null);
        for (let i = 0; i < 20 && !page.ready; i++) page.tick();
        ok('the page settled', page.ready);
        const info = page.knobParamInfo(0);
        ok('an LFO cell is never automatable (matches lfo/inert.ts under off)',
           info && info.automatable === false);
        setSchwungGridMode('off');
        schwungGridReload();
    }

    /* Master's retrigger is a dead cell, not an absent one — both banks stay
     * 8 keys so the flat 16-key list still chunks into two aligned pages. */
    const mScope = masterScope();
    ok('the master scope has no retrigger', !mScope.hasRetrigger);
    const mSource = lfoSchwungSource(mScope);
    eq('sixteen keys even without retrigger (dead, not omitted)',
       JSON.parse(mSource.getParam('master_fx:lfo:ui_hierarchy')).levels.root.knobs.length, 16);
    /* `hostPort(0)` (master's channel) has no mocked backing here — the dead
     * cell must not even ATTEMPT the write (see `retriggerCell`'s override),
     * so a real `shadow_set_param` global (absent in this harness) is never
     * asked, and the read stays the fixed '0' whatever was "turned". */
    mSource.setParam('master_fx:lfo:b0_retrigger', '1');
    eq('a turn on the dead cell reads back a fixed 0 regardless', mSource.getParam('master_fx:lfo:b0_retrigger'), '0');

    eng.restore();
    resetPorts();
}

}
