/* browser-test/logic/cpu-page.mjs — the CPU page's view model: what the sixteen
 * columns mean, and what they mean when the engine is silent, old, or hosting
 * only some of the tracks.
 *
 * Run by browser-test/logic.mjs.
 */

import {
    buildCpuPageVM, FULL_SCALE_US, setFlag, resetFlags,
    ok, eq, _log,
} from './harness.mjs';

export async function run() {
    const { seqState } = await import('../../dist/esm/seq/state.js');

    /* Eight loaded chains; chain 8 loaded but asleep. Microseconds per block. */
    const COST = [
        '240/180/310', '370/300/450', '1050/900/1180', '920/700/1010',
        '250/200/300', '320/320/400', '180/140/220', '670/560/790',
        '0/0/0', '0/0/0', '0/0/0', '0/0/0', '0/0/0', '0/0/0', '0/0/0', '0/0/0',
    ].join(',');

    const feed = ({ mask = '01ff/0100', cost = COST, wall = '1491/2180/2902' } = {}) => {
        seqState.cpuCost = cost;
        seqState.cpuWall = wall;
        seqState.cpuMask = mask;
    };

    _log('\ncpu page: columns');
    resetFlags();
    setFlag('cpuopt', 1);
    setFlag('chtracks', 1);          // every track is a movy chain
    feed();
    let vm = buildCpuPageVM();
    eq('one column per track', vm.columns.length, 16);
    eq('a rendering chain is live', vm.columns[2].kind, 'live');
    eq('its total is what the engine said', vm.columns[2].totalUs, 1050);
    eq('and its synth stage', vm.columns[2].synthUs, 900);
    eq('and its held peak', vm.columns[2].peakUs, 1180);
    eq('loaded but silent is asleep, not empty', vm.columns[8].kind, 'asleep');
    eq('nothing loaded is empty', vm.columns[9].kind, 'empty');

    _log('\ncpu page: capacity');
    eq('block period comes from the engine', vm.blockUs, 2902);
    ok('load is wall over block', Math.abs(vm.load - 1491 / 2902) < 1e-6);
    ok('peak load likewise', Math.abs(vm.peakLoad - 2180 / 2902) < 1e-6);

    /* An overrun is the one reading that matters most. Clamping it here would
     * hide it, so the bar clamps and the number does not. */
    feed({ wall: '3400/3900/2902' });
    vm = buildCpuPageVM();
    ok('an overrun reads over 1.0', vm.load > 1);

    _log('\ncpu page: tracks movy cannot measure');
    resetFlags();
    setFlag('cpuopt', 1);
    setFlag('chtracks', 0);          // tracks 1-4 stay on the schwung host
    feed();
    vm = buildCpuPageVM();
    eq('a schwung-hosted track is n/a', vm.columns[0].kind, 'na');
    eq('and so are the other three', vm.columns[3].kind, 'na');
    eq('a movy chain beside them still reads', vm.columns[4].kind, 'live');

    _log('\ncpu page: CPU Optimize off');
    resetFlags();
    setFlag('cpuopt', 0);
    setFlag('chtracks', 1);
    /* One render_block call: the synth stage IS the whole chain, so the FX
     * segment comes out empty with no branch anywhere in the renderer. */
    feed({ cost: ['800/800/900'].concat(Array(15).fill('0/0/0')).join(','), mask: '0001/0000' });
    vm = buildCpuPageVM();
    eq('optimized is reported', vm.optimized, false);
    eq('synth equals total when the chain does not split', vm.columns[0].synthUs, 800);
    eq('so the FX segment is nothing', vm.columns[0].totalUs - vm.columns[0].synthUs, 0);

    _log('\ncpu page: the pixel quantisation the repaint gate compares on');
    {
        const { barPixels } = await import('../../dist/esm/renderer/cpu-view.js');
        /* app/tick.ts hashes barPixels(), not microseconds. If these stopped
         * collapsing, the meter would repaint ~24 times a second on jitter it
         * cannot draw — and inflate the very number it is displaying, because
         * the UI thread competes with the render lanes for Move's cores. */
        eq('a microsecond is below a pixel', barPixels(801), barPixels(800));
        eq('so is the next one', barPixels(799), barPixels(800));
        ok('100 us is not', barPixels(900) !== barPixels(800));
        eq('nothing is the floor', barPixels(0), 0);
        ok('full scale is the ceiling', barPixels(FULL_SCALE_US) > 0);
        eq('and over-scale clamps to it', barPixels(FULL_SCALE_US * 3), barPixels(FULL_SCALE_US));
        eq('a negative us cannot draw upward', barPixels(-500), 0);
    }

    _log('\ncpu page: nothing to draw');
    resetFlags();
    setFlag('chtracks', 1);
    seqState.cpuCost = ''; seqState.cpuWall = ''; seqState.cpuMask = '';
    vm = buildCpuPageVM();
    eq('an engine that never sent the fields draws empty', vm.columns[0].kind, 'empty');
    eq('and no load', vm.load, 0);
    ok('with a sane block period', vm.blockUs > 0);
    eq('full scale is fixed', FULL_SCALE_US, 1000);
}
