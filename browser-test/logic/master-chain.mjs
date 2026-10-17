/* browser-test/logic/master-chain.mjs — movy's own master chain (WP3).
 *
 * The MASTER page's FX and LFO slots are movy's (`mfx:`, the engine root) —
 * the only master since WP9. schwung's per-Set master files are brought over
 * by the engine's set migration (set_migrate.rs, cargo-tested), not here.
 *
 * Design: docs/superpowers/specs/2026-09-10-movy-owned-master-chain-design.md §5.
 * Run by browser-test/logic.mjs.
 */

import { eq, ok, _log, resetFlags } from './harness.mjs';

export async function run() {
    _log('\n── Master chain: movy\'s own, at the engine root; import copies, never writes back ──');
    const { platform, setPlatformForTest } = await import('../../dist/esm/platform/index.js');
    const cfg = await import('../../dist/esm/chain/config.js');
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
