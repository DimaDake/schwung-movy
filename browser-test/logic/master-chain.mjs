/* browser-test/logic/master-chain.mjs — movy's own master chain (WP3).
 *
 * The binding: one prefix swap moves the MASTER page's FX and LFO slots from
 * schwung's master (`master_fx:`, a shadow slot) to movy's (`mfx:`, the engine
 * root), and back. The import: schwung's per-Set master files become `mfx:`
 * writes, in two phases, and nothing is ever written to a schwung path.
 *
 * Design: docs/superpowers/specs/2026-09-10-movy-owned-master-chain-design.md §5.
 * Run by browser-test/logic.mjs.
 */

import { eq, ok, _log, setFlag, resetFlags } from './harness.mjs';

export async function run() {
    _log('\n── Master chain: binding follows host + flag; import copies, never writes back ──');
    const { platform, setPlatformForTest } = await import('../../dist/esm/platform/index.js');
    const cfg = await import('../../dist/esm/chain/config.js');
    const { masterPrefix } = await import('../../dist/esm/chain/master-prefix.js');
    const { bindMaster, bindMasterPrefix, movyMasterBound, pushMasterBinding } =
        await import('../../dist/esm/chain/master-binding.js');
    const { planMasterImport, masterImportTick, requestMasterImport, resetMasterImport } =
        await import('../../dist/esm/chain/master-import.js');
    const { componentPort, engineRootPort, hostPort, resetPorts } = await import('../../dist/esm/track/registry.js');
    const { masterScope } = await import('../../dist/esm/lfo/scope.js');
    const { buildSendColumns } = await import('../../dist/esm/seq/cpu-page-vm.js');

    const keys = () => cfg.MASTER_FX_SLOTS.map((s) => s.componentKey).join(',');
    const real = platform;
    const withCaps = (coexists, extra = {}) => ({
        ...real, ...extra,
        caps: { coexistsWithMove: coexists, canSuspend: coexists, ownsMasterVolume: !coexists, ownsPowerButton: !coexists },
    });

    try {
        resetFlags(); resetPorts();
        setPlatformForTest(withCaps(true));
        /* Overtake, flag off: schwung's master, exactly as before. */
        ok('overtake: the movy master is not bound', !movyMasterBound());
        bindMaster();
        eq('overtake: the page keeps schwung\'s keys', keys(),
           'snd0,snd1,snd2,master_fx:fx1,master_fx:fx2,master_fx:fx3,master_fx:fx4,master_fx:lfo');
        const pushed = [];
        pushMasterBinding((k, v) => pushed.push(k + '=' + v));
        eq('overtake: the engine is told its master is out of the path', pushed.join(), 'mfx:own=0');

        /* The test flag, then standalone: movy's master. */
        setFlag('mstown', 1);
        ok('mstown binds the movy master in overtake', movyMasterBound());
        setFlag('mstown', 0);
        setPlatformForTest(withCaps(false));
        ok('standalone always binds the movy master', movyMasterBound());
        bindMaster();
        eq('bound: the FX and LFO slots carry mfx:, the sends are untouched', keys(),
           'snd0,snd1,snd2,mfx:fx1,mfx:fx2,mfx:fx3,mfx:fx4,mfx:lfo');
        eq('bound: the prefix reads back', masterPrefix(), 'mfx:');
        pushed.length = 0;
        pushMasterBinding((k, v) => pushed.push(k + '=' + v));
        eq('standalone: the engine is told to run its master', pushed.join(), 'mfx:own=1');

        /* Routing: movy's master is an engine-root key, never a shadow slot
         * and never track 0's chain. */
        ok('mfx:fx1 routes to the engine root', componentPort(0, 'mfx:fx1') === engineRootPort());
        ok('bare mfx (undo\'s key split) routes to the engine root', componentPort(0, 'mfx') === engineRootPort());
        ok('master_fx:fx1 still routes to the shadow slot', componentPort(0, 'master_fx:fx1') === hostPort(0));
        eq('a movy master module reads back by colon key (the engine maps the alias)',
           cfg.moduleReadKey('mfx:fx2'), 'mfx:fx2:module');
        ok('both masters are master components', cfg.isMasterComponent('mfx:fx1') && cfg.isMasterComponent('master_fx:fx1'));
        ok('only schwung\'s loads by path', !cfg.isShimMasterComponent('mfx:fx1') && cfg.isShimMasterComponent('master_fx:fx1'));
        const sc = masterScope();
        eq('the master LFO scope follows the prefix', sc.keyPrefix, 'mfx:');
        ok('and its port is the engine root', sc.port === engineRootPort());

        bindMasterPrefix('master_fx:');
        eq('rebinding back restores schwung\'s keys', keys(),
           'snd0,snd1,snd2,master_fx:fx1,master_fx:fx2,master_fx:fx3,master_fx:fx4,master_fx:lfo');
        ok('and the LFO scope goes back to the shadow slot', masterScope().port === hostPort(0));
        bindMasterPrefix('mfx:');

        /* The import plan: what each schwung file field becomes. */
        const files = [
            JSON.stringify({ module_path: '/x/freeverb/dsp.so', module_id: 'freeverb',
                state: { room: 0.7 }, bypassed: 0,
                lfos: { lfo1: { enabled: 1, shape: 2, depth: 0.5, target: 'fx2', target_param: 'time',
                                division_table_version: 9 } } }),
            JSON.stringify({ module_path: '/x/tape/dsp.so', module_id: 'tapedelay',
                params: { time: '0.25', plugin_id: 'p1' } }),
            null,
            '{}\n',
        ];
        const plan = planMasterImport(files);
        eq('modules found, per position', plan.modules.join(','), 'freeverb,tapedelay,,');
        eq('phase 1: modules and blobs only',
           plan.first.map((p) => p.join('=')).join(' | '),
           'mfx:fx1:module=freeverb | mfx:fx1:state={"room":0.7} | mfx:fx2:module=tapedelay');
        eq('phase 2: loose params, bypass, then LFOs (minus schwung bookkeeping)',
           plan.second.map((p) => p.join('=')).join(' | '),
           'mfx:fx1:bypassed=0 | mfx:fx2:time=0.25 | mfx:fx2:plugin_id=p1 | mfx:lfo1:enabled=1 | '
           + 'mfx:lfo1:shape=2 | mfx:lfo1:depth=0.5 | mfx:lfo1:target=fx2 | mfx:lfo1:target_param=time');
        ok('every write is an mfx: key', [...plan.first, ...plan.second].every(([k]) => k.startsWith('mfx:')));
        eq('garbage and missing files import nothing', planMasterImport(['{', null, '[]', 'x']).first.length, 0);

        /* The tick: reads schwung's files, writes only the engine. */
        const reads = [], fileWrites = [];
        setPlatformForTest(withCaps(false, {
            readFile: (p) => { reads.push(p); return files[Number(p.slice(-6, -5))] ?? null; },
            writeFile: (p) => { fileWrites.push(p); return true; },
        }));
        const sets = [];
        let imported = '0';
        const get = (k) => (k === 'mfx:imported' ? imported : null);
        const set = (k, v) => { sets.push(k + '=' + v); if (k === 'mfx:imported') imported = v; };
        resetMasterImport();
        masterImportTick('U1', 0, get, set);
        eq('nothing happens until a Set is applied', sets.length, 0);
        requestMasterImport();
        masterImportTick('U1', 0, get, set);
        eq('reads the Set\'s four master files', reads.join(','),
           [0, 1, 2, 3].map((i) => '/data/UserData/schwung/set_state/U1/master_fx_' + i + '.json').join(','));
        eq('phase 1 written', sets.length, 3);
        masterImportTick('U1', 2, get, set);
        eq('phase 2 waits while the loads are pending', sets.length, 3);
        masterImportTick('U1', 0, get, set);
        eq('phase 2 then the mark', sets[sets.length - 1], 'mfx:imported=1');
        eq('all of it', sets.length, 3 + plan.second.length + 1);
        eq('no file was written — schwung\'s master is only read', fileWrites.length, 0);

        sets.length = 0; reads.length = 0;
        requestMasterImport();
        masterImportTick('U1', 0, get, set);
        eq('an imported Set is never imported again', sets.length + reads.length, 0);

        imported = '0';
        setPlatformForTest(withCaps(true, { readFile: (p) => { reads.push(p); return null; } }));
        requestMasterImport();
        masterImportTick('U1', 0, get, set);
        eq('with schwung\'s master bound, nothing is imported', sets.length + reads.length, 0);
        resetMasterImport();

        /* The CPU page: movy's master is a fourth FX column, only when loaded. */
        eq('no master module, the send region is unchanged', buildSendColumns('-,410/980,-', '-').length, 3);
        const four = buildSendColumns('-,-,-', '420/610');
        eq('a loaded master alone opens the region with a fourth column', four.length, 4);
        eq('and it is the live one', four.map((c) => c.kind).join(','), 'empty,empty,empty,live');
    } finally {
        setPlatformForTest(real);
        bindMasterPrefix('master_fx:');
        resetFlags(); resetPorts();
    }
}
