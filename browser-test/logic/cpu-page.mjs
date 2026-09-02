/* browser-test/logic/cpu-page.mjs — the CPU page's view model: what the sixteen
 * columns mean, and what they mean when the engine is silent, old, or hosting
 * only some of the tracks.
 *
 * Run by browser-test/logic.mjs.
 */

import {
    buildCpuPageVM, FULL_SCALE_US, USABLE_BLOCK, scaleFor, scaleLabel, setFlag, resetFlags,
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
    /* 100% is where the device starts dropping samples, not where the raw block
     * runs out — measured at 65-69% of the block, so the budget is 70% of it. */
    eq('the budget is the usable share of the block', vm.budgetUs, Math.round(2902 * USABLE_BLOCK));
    ok('budget is well under the raw block', vm.budgetUs < vm.blockUs);
    ok('load is wall over BUDGET', Math.abs(vm.load - 1491 / vm.budgetUs) < 1e-6);
    ok('peak load likewise', Math.abs(vm.peakLoad - 2180 / vm.budgetUs) < 1e-6);
    ok('so a wall at 70% of the block reads as full', Math.abs(vm.blockUs * 0.7 / vm.budgetUs - 1) < 0.01);

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

    _log('\ncpu page: the scale grows to fit, and never shrinks below 1 ms');
    {
        const col = (total, peak) => ({ kind: 'live', totalUs: total, synthUs: total, peakUs: peak });
        /* The floor. A light set must not get a scale of its own, or a column
         * stops meaning the same thing from one session to the next. */
        eq('an empty set sits at the floor', scaleFor([]), FULL_SCALE_US);
        eq('and so does a light one', scaleFor([col(180, 240), col(90, 120)]), FULL_SCALE_US);
        eq('exactly 1 ms still fits', scaleFor([col(1000, 1000)]), FULL_SCALE_US);

        /* The whole point: past 1 ms nothing may be clamped into looking like a
         * different column. */
        eq('one heavy chain lifts the whole plot', scaleFor([col(1200, 1400), col(200, 260)]), 1500);
        eq('and further when it has to', scaleFor([col(2400, 2900)]), 3000);

        /* Driven by the BAR, not the peak. Loading a chain costs milliseconds
         * in dlopen and first-block allocation, and that single block lands in
         * the held peak — on device it took the scale to 5 ms and squashed
         * every real column to nothing for the rest of the viewing. */
        eq('a lone spike in the held peak does NOT lift it', scaleFor([col(300, 4800)]), FULL_SCALE_US);
        eq('a sustained bar does', scaleFor([col(1300, 4800)]), 1500);

        /* Past the ladder the reading has stopped being about proportions. */
        eq('a runaway chain clamps at the top of the ladder', scaleFor([col(40000, 40000)]), 9000);

        eq('the label reads whole milliseconds plainly', scaleLabel(2000), '2MS');
        eq('and a half step with one decimal', scaleLabel(1500), '1.5MS');
        eq('the floor is 1MS', scaleLabel(FULL_SCALE_US), '1MS');
    }

    _log('\ncpu page: the pixel quantisation the repaint gate compares on');
    {
        const { barPixels } = await import('../../dist/esm/renderer/cpu-view.js');
        /* app/tick.ts hashes barPixels(), not microseconds. If these stopped
         * collapsing, the meter would repaint ~24 times a second on jitter it
         * cannot draw — and inflate the very number it is displaying, because
         * the UI thread competes with the render lanes for Move's cores. */
        const S = FULL_SCALE_US;
        eq('a microsecond is below a pixel', barPixels(801, S), barPixels(800, S));
        eq('so is the next one', barPixels(799, S), barPixels(800, S));
        ok('100 us is not', barPixels(900, S) !== barPixels(800, S));
        eq('nothing is the floor', barPixels(0, S), 0);
        ok('full scale is the ceiling', barPixels(S, S) > 0);
        eq('and over-scale clamps to it', barPixels(S * 3, S), barPixels(S, S));
        eq('a negative us cannot draw upward', barPixels(-500, S), 0);
        /* The same microseconds are a different height at a different scale —
         * which is exactly why the scale is in the repaint signature. */
        ok('a taller scale shortens the same bar', barPixels(800, 2000) < barPixels(800, S));
        eq('and the top of the plot is the same either way', barPixels(2000, 2000), barPixels(S, S));
    }

    _log('\ncpu page: nothing to draw');
    resetFlags();
    setFlag('chtracks', 1);
    seqState.cpuCost = ''; seqState.cpuWall = ''; seqState.cpuMask = '';
    vm = buildCpuPageVM();
    eq('an engine that never sent the fields draws empty', vm.columns[0].kind, 'empty');
    eq('and no load', vm.load, 0);
    ok('with a sane block period', vm.blockUs > 0);
    eq('the floor is 1 ms', FULL_SCALE_US, 1000);
    eq('an engine that sent nothing still has a scale', vm.scaleUs, FULL_SCALE_US);
}
