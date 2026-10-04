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
const { MODULE_CHECK_MS } = await import('../../dist/esm/lfo/lfo-target-list.js');
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

/* ── MIX: a turn crosses the travel at movy's own MIX rate ────────────────── */
_log('\nTest: MIX page knob rate matches movy\'s MIX page');
if (!schwungLibAvailable()) {
    _log('  SKIPPED — no param_pages; set SCHWUNG=');
} else {
    const { stepAmpDb, VOL_TOP_DB } = await import('../../dist/esm/mixer/db-ladder.js');
    const { readMix } = await import('../../dist/esm/mixer/mix-io.js');
    const eng = mockEngine();
    resetPorts();
    setSchwungGridMode('page');
    schwungGridReload();
    eng.store['ch0:mix'] = packMixValue({ gain: 1, pan: 0, muted: false, send: [0, 0, 0] });
    const page = schwungPageFor(0, 'mix', null, null);
    for (let i = 0; i < 12 * 60 && page.keyAt(0) !== 'gain'; i++) page.tick();
    eq('knob 1 drives VOL', page.keyAt(0), 'gain');
    for (let i = 0; i < 60; i++) page.tick();   // let the warm read land before stepping from it

    /* THE TEETH: twenty CC units, the same gesture fed to movy's own MIX model
     * (`stepAmpDb`, one CC unit per step). At the virtual source's default of
     * eight units per detent this moved two detents — an eighth of the travel
     * movy's page covers — which is the "different sensitivity" reported. */
    const turn = (slot, raw) => { page.knobTouch(slot, true); page.knobTurn(slot, raw); page.knobTouch(slot, false); };
    const fracBefore = fieldFrac('gain', readMix(0).gain);
    turn(0, 20);
    const got = fieldFrac('gain', readMix(0).gain) - fracBefore;
    const want = fieldFrac('gain', stepAmpDb(1, 20, VOL_TOP_DB)) - fracBefore;
    ok('20 CC units move VOL as far as on movy\'s MIX page (got ' + got.toFixed(4) + ', want ' + want.toFixed(4) + ')',
       want > 0 && Math.abs(got - want) < want * 0.1);

    setSchwungGridMode('off');
    schwungGridReload();
    eng.restore();
    resetPorts();
}

/* ── LFO: Schwung's own LFO page, over the real keys (SP-60) ─────────────── */
_log('\nTest: LFO source is Schwung\'s LFO page contract (SP-60)');
{
    const { lfoSchwungSource } = await import('../../dist/esm/lfo/lfo-schwung-source.js');
    const { trackScope, masterScope } = await import('../../dist/esm/lfo/scope.js');
    const { schwungLfoPage } = await import('../../dist/esm/renderer/schwung-lib.js');
    const { RELOAD_POLL_TICKS } = await import('../../dist/esm/renderer/schwung-page.js');

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
        /* Schwung's lfoParams, with ONE cell changed by movy: Target carries
         * the routings movy can reach, as a release-committed enum. */
        const cp = JSON.parse(source.getParam('lfo:chain_params'));
        const bareTarget = (arr) => JSON.stringify(arr.filter((p) => !/:target$/.test(p.key)));
        eq('chain_params are Schwung\'s lfoParams', bareTarget(cp),
           bareTarget(lp.lfoParams(1).concat(lp.lfoParams(2))));
        const tDecl = cp.find((p) => p.key === 'lfo1:target');
        ok('Target is a knob: a release-committed enum, None first',
           tDecl && tDecl.type === 'enum' && tDecl.commit === 'release' && tDecl.options[0] === 'None');
        ok('there is no Enabled cell', !cp.some((p) => /:enabled$/.test(p.key)));
        eq('the same bytes on the next contract poll (no re-plan)',
           source.getParam('lfo:chain_params'), JSON.stringify(cp));

        /* Keys pass straight through to the track's port. */
        source.setParam('lfo:lfo1:depth', '0.5');
        eq('a write reaches the real lfo1: key', eng.store['ch0:lfo1:depth'], '0.5');
        eq('and reads back through the cell', source.getParam('lfo:lfo1:depth'), '0.5');

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

        /* Target is TURNED: an index into movy's reachable routings. The list
         * lives as long as the modules do (the page is dropped on a module
         * change), so a fresh source sees the synth loaded below. */
        eng.store['ch0:synth:chain_params'] = JSON.stringify([{ key: 'cutoff', name: 'Cutoff', type: 'float' }]);
        /* Named by the module's CATALOGUE name (module.json), never by
         * `:name` — minijv answers that with its current patch. */
        eng.store['ch0:synth:name'] = 'Grand Piano Layered';
        eng.store['ch0:synth_module'] = 'braids';
        const oRead = globalThis.host_read_file;
        const manifests = { braids: 'Braids', minijv: 'Mini-JV' };
        globalThis.host_read_file = (path) => {
            const m = /\/sound_generators\/([^/]+)\/module\.json$/.exec(String(path));
            return m && manifests[m[1]] ? JSON.stringify({ id: m[1], name: manifests[m[1]] })
                                         : (oRead ? oRead(path) : null);
        };
        delete eng.store['ch0:lfo1:depth'];
        const tSource = lfoSchwungSource(trackScope(0));
        const opts = JSON.parse(tSource.getParam('lfo:chain_params'))
            .find((p) => p.key === 'lfo1:target').options;
        const at = opts.indexOf('Braids: Cutoff');
        ok('the knob lists the synth param by module name', at > 0);
        ok('and never by the patch name the module answers `:name` with',
           !opts.some((o) => /Grand Piano/.test(o)));
        ok('and the other LFO', opts.includes('LFO 2: Depth'));
        eq('an unrouted LFO reads None (option 0)', tSource.getParam('lfo:lfo1:target'), '0');
        eq('the None cell', tSource.formatValue('lfo:lfo1:target', '0', 'cell'), 'None');
        eq('a turn names the option under the knob before it is stored',
           tSource.formatValue('lfo:lfo1:target', String(at), 'header'), 'Braids: Cutoff');
        eq('a Target write is taken', tSource.setParam('lfo:lfo1:target', String(at)), true);
        eq('turning to a row routes the LFO', eng.store['ch0:lfo1:target'] + ':' + eng.store['ch0:lfo1:target_param'], 'synth:cutoff');
        eq('and enables it', eng.store['ch0:lfo1:enabled'], '1');
        eq('a fresh LFO starts at full depth, as Schwung\'s does', eng.store['ch0:lfo1:depth'], '1');
        eq('the routing reads back as its index', tSource.getParam('lfo:lfo1:target'), String(at));
        eq('the cell names the param', tSource.formatValue('lfo:lfo1:target', String(at), 'cell'), 'Cutoff');
        eng.store['ch0:lfo1:depth'] = '0.3';
        tSource.setParam('lfo:lfo1:target', String(opts.indexOf('LFO 2: Depth')));
        eq('re-aiming a routed LFO keeps the depth it has', eng.store['ch0:lfo1:depth'], '0.3');
        tSource.setParam('lfo:lfo1:target', '0');
        eq('None clears the routing', eng.store['ch0:lfo1:target'] + '|' + eng.store['ch0:lfo1:target_param'], '|');
        eq('and switches the LFO off', eng.store['ch0:lfo1:enabled'], '0');
        /* A MODULE SWAP re-lists Target, with no page drop to tell it: the
         * poll re-asks the module ids once MODULE_CHECK_MS has passed. */
        {
            const realNow = Date.now; let clock = realNow();
            Date.now = () => clock;
            tSource.getParam('lfo:chain_params');
            clock += MODULE_CHECK_MS + 1;
            tSource.getParam('lfo:chain_params');                 /* signature taken */
            eng.store['ch0:synth_module'] = 'minijv';
            eng.store['ch0:synth:name'] = 'Strings Pad';
            eng.store['ch0:synth:chain_params'] = JSON.stringify([{ key: 'res', name: 'Resonance', type: 'enum', options: ['a', 'b'] }]);
            const tgt = () => JSON.parse(tSource.getParam('lfo:chain_params'))
                .find((p) => p.key === 'lfo1:target').options;
            ok('inside the check window the list is kept (no read per poll)', tgt().includes('Braids: Cutoff'));
            clock += MODULE_CHECK_MS + 1;
            const after = tgt();
            ok('after a synth swap Target lists the new synth', after.includes('Mini-JV: Resonance'));
            ok('and not the old one', !after.includes('Braids: Cutoff'));
            Date.now = realNow;
        }
        globalThis.host_read_file = oRead;
        /* The HELD header is drawn in movy's face, so movy fits it — head
         * first, so the param survives a long module name. */
        {
            const { fitHeldHeader } = await import('../../dist/esm/renderer/held-header-fit.js');
            const { fontWidth } = await import('../../dist/esm/font/index.js');
            const h = fitHeldHeader({ left: 'Targ', right: 'Grand Piano Layered: Cutoff', inverted: true });
            ok('a long routing keeps its param in the held header', /: Cutoff$/.test(h.right));
            ok('and fits beside the label', fontWidth('Targ') + 4 + fontWidth(h.right) <= 124);
            const short = { left: 'Targ', right: 'Braids: Cutoff', inverted: true };
            eq('a value that fits is untouched', fitHeldHeader(short).right, 'Braids: Cutoff');
        }
        /* A routing the list lacks (made elsewhere) is appended, never None. */
        eng.store['ch0:lfo1:target'] = 'fx2'; eng.store['ch0:lfo1:target_param'] = 'mix';
        const stale = tSource.getParam('lfo:lfo1:target');
        ok('a routing the list lacks does not read None', stale !== '0');

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
        eq('Target, Mode, Sync, Retrig / Shape, Depth, Phase, Rate', p1.join(','),
           'lfo1:target,lfo1:polarity,lfo1:sync,lfo1:retrigger,lfo1:shape,lfo1:depth,lfo1:phase_offset,lfo1:rate_hz');
        ok('LFO 1 free-running shows rate_hz', p1.includes('lfo1:rate_hz') && !p1.includes('lfo1:rate_div'));
        ok('LFO 2 synced shows rate_div', p2.includes('lfo2:rate_div') && !p2.includes('lfo2:rate_hz'));
        /* PAST THE POLL. Every 16 ticks the contract re-checks itself
         * (`reloadIfChanged`), and a bare call re-planned WITHOUT `visible`:
         * right on the first plan, then both rates and Phase on a page of its
         * own — what the device showed, and what no check above ticked far
         * enough to see. */
        for (let i = 0; i < RELOAD_POLL_TICKS * 3; i++) page.tick();
        eq('still two pages after the contract poll re-plans', page.pageCount, 2);
        /* ...and the NEXT re-plan still has it: a Schwung that skips an
         * unchanged re-plan (SU-14) hides the loss until Sync is turned. */
        eng.store['ch0:lfo1:sync'] = '1';
        page.goToPage(0);
        for (let i = 0; i < RELOAD_POLL_TICKS * 3; i++) page.tick();
        eq('still two pages once Sync is turned', page.pageCount, 2);
        const p1Later = keysOn(0);
        ok('synced LFO 1 swaps to the division, and keeps Phase', p1Later.includes('lfo1:rate_div')
           && !p1Later.includes('lfo1:rate_hz') && p1Later.includes('lfo1:phase_offset'));
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
        eq('master LFO: seven cells (no Retrigger on the master bus)', m1.filter(Boolean).length, 7);
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
