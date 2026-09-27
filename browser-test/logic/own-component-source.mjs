/* browser-test/logic/own-component-source.mjs — SP-55's MIX page and SP-60's
 * LFO page (Schwung's own contract) on the virtual-component seam. Unlike Clip/Set/Step Params these wrap a REAL
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

/* ── LFO: Schwung's own LFO page, over the real keys (SP-60) ─────────────── */
_log('\nTest: LFO source is Schwung\'s LFO page contract (SP-60)');
{
    const { lfoSchwungSource } = await import('../../dist/esm/lfo/lfo-schwung-source.js');
    const { trackScope, masterScope } = await import('../../dist/esm/lfo/scope.js');
    const { schwungLfoPage } = await import('../../dist/esm/renderer/schwung-lib.js');

    const eng = mockEngine();
    /* The master LFOs ride schwung's shim (`hostPort(0)` → shadow_*_param). */
    const shim = {};
    const oSG = globalThis.shadow_get_param, oSS = globalThis.shadow_set_param;
    globalThis.shadow_get_param = (_slot, k) => (k in shim ? shim[k] : null);
    globalThis.shadow_set_param = (_slot, k, v) => { shim[k] = v; return true; };
    resetPorts();

    if (!schwungLibAvailable()) {
        eq('without param_pages there is no LFO contract, so no source', lfoSchwungSource(trackScope(0)), null);
        _log('  (the rest SKIPPED — no param_pages; set SCHWUNG=)');
    } else {
        const lp = schwungLfoPage();
        ok('Schwung serves its LFO page builders', !!lp);
        const source = lfoSchwungSource(trackScope(0));

        /* THE SAME CONTRACT, not a lookalike: the levels are Schwung's own
         * `lfoLevels`, key for key. Re-declaring cells here (SP-55) is what
         * this item removed. */
        const hier = JSON.parse(source.getParam('lfo:ui_hierarchy'));
        eq('LFO 1 is Schwung\'s LFO 1 level', JSON.stringify(hier.levels.lfo1),
           JSON.stringify(lp.lfoLevels([1, 2]).lfo1));
        eq('chain_params are Schwung\'s lfoParams', source.getParam('lfo:chain_params'),
           JSON.stringify(lp.lfoParams(1).concat(lp.lfoParams(2))));

        /* Keys pass straight through to the track's port. */
        source.setParam('lfo:lfo1:depth', '0.5');
        eq('a write reaches the real lfo1: key', eng.store['ch0:lfo1:depth'], '0.5');
        eq('and reads back through the cell', source.getParam('lfo:lfo1:depth'), '0.5');
        eq('Target is a door — a knob never writes it', source.setParam('lfo:lfo1:target', 'fx1'), false);

        /* The rate cell Schwung shows is the one Sync selects. */
        eng.store['ch0:lfo1:sync'] = '0';
        const hzCond = lp.lfoParams(1).find((p) => p.key === 'lfo1:rate_hz').visible_if;
        const divCond = lp.lfoParams(1).find((p) => p.key === 'lfo1:rate_div').visible_if;
        ok('free-running: Hz visible, division hidden', source.visible(hzCond) && !source.visible(divCond));
        eng.store['ch0:lfo1:sync'] = '1';
        ok('synced: division visible, Hz hidden', !source.visible(hzCond) && source.visible(divCond));
        delete eng.store['ch0:lfo1:sync'];
        ok('an LFO never written reads Free: Hz visible, division hidden (not both)',
           source.visible(hzCond) && !source.visible(divCond));

        /* Target text and picker come from movy's own target list. */
        eng.store['ch0:synth:chain_params'] = JSON.stringify([{ key: 'cutoff', name: 'Cutoff', type: 'float' }]);
        eq('an unrouted LFO reads None', source.formatValue('lfo:lfo1:target', '', 'cell'), 'None');
        const pick = source.picker('lfo:lfo1:target');
        ok('the door opens a picker listing the synth param', pick && pick.options.some((o) => /Cutoff/.test(o)));
        pick.commit(pick.options.findIndex((o) => /Cutoff/.test(o)));
        eq('choosing a row routes the LFO', eng.store['ch0:lfo1:target'] + ':' + eng.store['ch0:lfo1:target_param'], 'synth:cutoff');
        eq('and enables it', eng.store['ch0:lfo1:enabled'], '1');
        eq('the cell names the param', source.formatValue('lfo:lfo1:target', 'synth', 'cell'), 'Cutoff');
        eq('the header names where it lives', source.formatValue('lfo:lfo1:target', 'synth', 'header'), 'Syn: Cutoff');

        /* Through the real page: two pages, eight cells each, Sync choosing
         * the rate cell — fail-open `visible` would give nine and a third page. */
        setSchwungGridMode('page');
        schwungGridReload();
        eng.store['ch0:lfo1:sync'] = '0'; eng.store['ch0:lfo2:sync'] = '1';
        const page = schwungPageFor(0, 'lfo', null, null);
        for (let i = 0; i < 20 && !page.ready; i++) page.tick();
        ok('the page settled', page.ready);
        eq('LFO 1 and LFO 2 — two pages', page.pageCount, 2);
        const keysOn = (i) => { page.goToPage(i); return [0, 1, 2, 3, 4, 5, 6, 7].map((k) => page.keyAt(k)); };
        const p1 = keysOn(0), p2 = keysOn(1);
        eq('LFO 1: eight cells', p1.filter(Boolean).length, 8);
        ok('LFO 1 free-running shows rate_hz', p1.includes('lfo1:rate_hz') && !p1.includes('lfo1:rate_div'));
        ok('LFO 2 synced shows rate_div', p2.includes('lfo2:rate_div') && !p2.includes('lfo2:rate_hz'));
        const info = page.knobParamInfo(1);
        ok('an LFO cell is never automatable (matches lfo/inert.ts under off)',
           info && info.automatable === false);

        /* The master chain draws the same page over `master_fx:lfoN:*`. */
        const mSource = lfoSchwungSource(masterScope());
        eq('master LFO 1 is Schwung\'s master_fx: level',
           JSON.stringify(JSON.parse(mSource.getParam('master_fx:lfo:ui_hierarchy')).levels.lfo1),
           JSON.stringify(lp.lfoLevels([1, 2], 'master_fx:').lfo1));
        mSource.setParam('master_fx:lfo:master_fx:lfo2:depth', '-0.25');
        eq('a master write reaches the shim key', shim['master_fx:lfo2:depth'], '-0.25');
        eq('and not a track chain', eng.store['ch0:master_fx:lfo2:depth'], undefined);
        shim['master_fx:lfo1:sync'] = '1'; shim['master_fx:lfo2:sync'] = '0';
        const mPage = schwungPageFor(0, 'master_fx:lfo', null, null);
        for (let i = 0; i < 20 && !mPage.ready; i++) mPage.tick();
        eq('master: two pages', mPage.pageCount, 2);
        mPage.goToPage(0);
        const m1 = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => mPage.keyAt(k));
        ok('master LFO 1 synced shows its rate_div', m1.includes('master_fx:lfo1:rate_div')
           && !m1.includes('master_fx:lfo1:rate_hz'));
        setSchwungGridMode('off');
        schwungGridReload();
    }

    globalThis.shadow_get_param = oSG; globalThis.shadow_set_param = oSS;
    eng.restore();
    resetPorts();
}

}
