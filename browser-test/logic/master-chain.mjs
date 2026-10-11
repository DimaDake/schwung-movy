/* browser-test/logic/master-chain.mjs — movy's own master chain (WP3).
 *
 * The MASTER page's FX and LFO slots are movy's (`mfx:`, the engine root) —
 * the only master since WP9. The import: schwung's per-Set master files become
 * `mfx:` writes, in two phases, and nothing is ever written to a schwung path.
 *
 * Design: docs/superpowers/specs/2026-09-10-movy-owned-master-chain-design.md §5.
 * Run by browser-test/logic.mjs.
 */

import { eq, ok, _log, resetFlags } from './harness.mjs';

export async function run() {
    _log('\n── Master chain: movy\'s own, at the engine root; import copies, never writes back ──');
    const { platform, setPlatformForTest } = await import('../../dist/esm/platform/index.js');
    const cfg = await import('../../dist/esm/chain/config.js');
    const { planMasterImport, masterImportTick, requestMasterImport, resetMasterImport } =
        await import('../../dist/esm/chain/master-import.js');
    const { componentPort, engineRootPort, portFor, resetPorts } = await import('../../dist/esm/track/registry.js');
    const { masterScope } = await import('../../dist/esm/lfo/scope.js');
    const { buildSendColumns } = await import('../../dist/esm/seq/cpu-page-vm.js');

    const keys = () => cfg.MASTER_FX_SLOTS.map((s) => s.componentKey).join(',');
    const real = platform;

    try {
        resetFlags(); resetPorts();
        eq('the FX and LFO slots carry mfx:, the sends stay sends', keys(),
           'snd0,snd1,snd2,mfx:fx1,mfx:fx2,mfx:fx3,mfx:fx4,mfx:lfo');

        /* Routing: the master is an engine-root key, never track 0's chain. */
        ok('mfx:fx1 routes to the engine root', componentPort(0, 'mfx:fx1') === engineRootPort());
        ok('bare mfx (undo\'s key split) routes to the engine root', componentPort(0, 'mfx') === engineRootPort());
        ok('a track component still routes to its track', componentPort(0, 'synth') === portFor(0));
        eq('a master module reads back by colon key (the engine maps the alias)',
           cfg.moduleReadKey('mfx:fx2'), 'mfx:fx2:module');
        ok('mfx: is a master component', cfg.isMasterComponent('mfx:fx1') && cfg.isMasterComponent('mfx'));
        ok('a track key is not', !cfg.isMasterComponent('synth') && !cfg.isMasterComponent('snd0'));
        const sc = masterScope();
        eq('the master LFO scope carries the prefix', sc.keyPrefix, 'mfx:');
        ok('and its port is the engine root', sc.port === engineRootPort());

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
        setPlatformForTest({ ...real,
            readFile: (p) => { reads.push(p); return files[Number(p.slice(-6, -5))] ?? null; },
            writeFile: (p) => { fileWrites.push(p); return true; },
        });
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

        resetMasterImport();

        /* The CPU page: movy's master is a fourth FX column, only when loaded. */
        eq('no master module, the send region is unchanged', buildSendColumns('-,410/980,-', '-').length, 3);
        const four = buildSendColumns('-,-,-', '420/610');
        eq('a loaded master alone opens the region with a fourth column', four.length, 4);
        eq('and it is the live one', four.map((c) => c.kind).join(','), 'empty,empty,empty,live');
    } finally {
        setPlatformForTest(real);
        resetFlags(); resetPorts();
    }
}
