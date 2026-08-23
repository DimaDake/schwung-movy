/* browser-test/logic/partition.mjs — assigning chains to render workers
 *
 * Run by browser-test/logic.mjs. These are the numbers the parallel-render
 * design is decided on, so the packer needs teeth: `lpt` bounds the speedup
 * and `lptGrouped` prices the alternative to copying every module .so.
 */

import { eq, _log } from './harness.mjs';

const chain = (id, cost, group) => ({ id, cost, group: group ?? id });

export async function run() {
/* ── LPT packing ─────────────────────────────────────────────────────────── */
{
    _log('\npartition (LPT):');
    const { lpt, lptGrouped, speedup } = await import('../../scripts/lib/partition.mjs');

    // A partition cannot finish before its largest member. This is the whole
    // reason the balance measurement exists, so it is asserted rather than
    // assumed: helm at 804 of 2504 caps the design at 3.11x.
    const one = lpt([chain('a', 800), chain('b', 100), chain('c', 100)], 3);
    eq('makespan is at least the largest item', one.makespan, 800);
    eq('total is preserved', one.total, 1000);

    // Perfectly divisible work divides perfectly.
    const even = lpt([1, 2, 3, 4].map((i) => chain(`c${i}`, 300)), 3);
    eq('four equal items over three workers', even.makespan, 600);

    // Sorting descending is what makes this LPT and not plain greedy. Fed in
    // ASCENDING order, an unsorted greedy strands the big item alone on top of
    // a full bin (4); LPT places it first (3). A greedy that forgot to sort
    // would still "work" and would quietly over-report the achievable speedup.
    const ascending = [1, 1, 1, 3].map((c, i) => chain(`x${i}`, c));
    eq('sorts descending before packing', lpt(ascending, 2).makespan, 3);

    // LPT is an approximation, not an optimum, and the design is decided on
    // these numbers — so the gap is pinned rather than assumed away. Here the
    // true optimum is 6 (3+3 | 2+2+2) and LPT returns 7. Within the 4/3 bound.
    const suboptimal = [3, 3, 2, 2, 2].map((c, i) => chain(`y${i}`, c));
    eq('LPT is 4/3-approximate, not optimal', lpt(suboptimal, 2).makespan, 7);

    eq('every item lands in exactly one bin',
        lpt(suboptimal, 2).bins.reduce((n, b) => n + b.items.length, 0), 5);

    // More workers than items must not divide by zero or lose work.
    const sparse = lpt([chain('a', 50)], 4);
    eq('idle workers are harmless', sparse.makespan, 50);
}

/* ── grouped packing: the alternative to copying a module per chain ──────── */
{
    _log('\npartition (same-module pinning):');
    const { lpt, lptGrouped, speedup } = await import('../../scripts/lib/partition.mjs');

    // Two chains of the same module must land on ONE worker — that is the
    // entire safety property. If they split, they render concurrently and
    // share the module's file-scope statics, which is the bug this avoids.
    const dup = [chain('ch0', 100, 'obxd'), chain('ch1', 100, 'obxd'), chain('ch2', 100, 'helm')];
    const pinned = lptGrouped(dup, 3);
    const obxdBins = pinned.bins.filter((b) => b.items.some((i) => i.group === 'obxd'));
    eq('same-module chains share one worker', obxdBins.length, 1);
    eq('and both of them are on it', obxdBins[0].items.length, 2);
    eq('pinning costs makespan', pinned.makespan, 200);
    eq('unpinned would have been faster', lpt(dup, 3).makespan, 100);

    // Expansion must return chains, not the groups used for packing —
    // a caller assigning work needs chain ids.
    eq('bins expand back to chains',
        pinned.bins.reduce((n, b) => n + b.items.length, 0), 3);

    // The degenerate case that decides the design: one module everywhere
    // pins everything to one worker and buys exactly nothing.
    const same = Array.from({ length: 12 }, (_, i) => chain(`ch${i}`, 100, 'helm'));
    eq('twelve of one module cannot be split', lptGrouped(same, 3).makespan, 1200);
    eq('speedup collapses to serial', speedup(1200, lptGrouped(same, 3).makespan), 1);

    // Grouping keys on `group`, not `id` — defaulting to id would silently
    // turn every grouped call back into a plain LPT and pass the happy tests.
    const distinct = [chain('ch0', 100, 'a'), chain('ch1', 100, 'b')];
    eq('different modules still split', lptGrouped(distinct, 2).makespan, 100);
}

/* ── speedup accounting ──────────────────────────────────────────────────── */
{
    _log('\npartition (speedup):');
    const { speedup } = await import('../../scripts/lib/partition.mjs');

    eq('serial work over makespan', speedup(2400, 800), 3);
    // The join is a fixed cost paid once per block, not per worker — measured
    // at ~21us in plans/2026-08-22-join-cost-prototype.md.
    eq('the join is charged once', speedup(2400, 779, 21), 3);
    eq('a zero makespan reports no speedup rather than Infinity', speedup(2400, 0), 0);
}

/* ── where a measured parallel block's time went ─────────────────────────── */
{
    _log('\npartition (render accounting):');
    const { account, parseCostReport, parsePlan } =
        await import('../../scripts/lib/render-accounting.mjs');

    // A clean run: three lanes of 300/300/300, no contention, no overhead.
    const clean = account({
        serialWall: 900, serialCosts: [300, 300, 300],
        parallelWall: 300, parallelCosts: [300, 300, 300],
        plan: [[0], [1], [2]],
    });
    eq('the per-chain timers add up to the serial wall', clean.serialResidual, 0);
    eq('perfect balance leaves no imbalance', clean.imbalance, 0);
    eq('and no unexplained overhead', clean.overhead, 0);
    eq('speedup is the wall ratio', clean.speedup, 3);

    // THE CORRECTION. A lane finishing early cannot be part of the
    // fan-out/preemption residue: the wall is set by the LAST lane, so lane 0
    // idling is already inside the makespan. Plan §6 filed it as a candidate
    // for the unattributed ~100us, which the identity here rules out.
    const lopsided = account({
        serialWall: 900, serialCosts: [200, 300, 400],
        parallelWall: 400, parallelCosts: [200, 300, 400],
        plan: [[0], [1], [2]],
    });
    eq('an early lane costs makespan, not overhead', lopsided.overhead, 0);
    eq('it is charged to imbalance instead', lopsided.imbalance, 100);
    eq('the makespan is the busiest lane', lopsided.makespan, 400);

    // Real overhead is the residue AFTER the busiest lane is paid for.
    const slow = account({
        serialWall: 900, serialCosts: [300, 300, 300],
        parallelWall: 400, parallelCosts: [300, 300, 300],
        plan: [[0], [1], [2]],
    });
    eq('wall above the makespan is overhead', slow.overhead, 100);
    eq('a free rendezvous would have reached the ceiling', slow.ceiling, 3);

    // Work that got more expensive under threads is charged to contention, and
    // is the one loss no scheduling change can recover.
    const hot = account({
        serialWall: 900, serialCosts: [300, 300, 300],
        parallelWall: 360, parallelCosts: [360, 360, 360],
        plan: [[0], [1], [2]],
    });
    eq('extra per-chain cost is contention', hot.contention, 180);
    eq('and does not leak into overhead', hot.overhead, 0);
    eq('even inflation across lanes reads as cache, not preemption',
        hot.inflation.join(','), '1.2,1.2,1.2');

    // The discriminator. Lane 0 is the audio thread at FIFO 90 on core 3, which
    // Move's FIFO 70 workers cannot preempt; the FIFO 68 helpers can. A lane 0
    // that stays flat while the helpers inflate is preemption, not bandwidth —
    // and only one of those two is worth trying to schedule around.
    const preempted = account({
        serialWall: 900, serialCosts: [300, 300, 300],
        parallelWall: 450, parallelCosts: [300, 450, 450],
        plan: [[0], [1], [2]],
    });
    eq('an unpreemptable lane 0 stays at 1.0', preempted.inflation[0], 1);
    eq('while the helpers show the hit', preempted.inflation.slice(1).join(','), '1.5,1.5');

    // A lane with no serial cost must not divide by zero.
    const idle = account({
        serialWall: 300, serialCosts: [300, 0],
        parallelWall: 300, parallelCosts: [300, 0],
        plan: [[0], [1]],
    });
    eq('an empty lane reports 0 inflation, not NaN', idle.inflation[1], 0);

    // Pinning shows up as one lane carrying a group. The ceiling must be
    // computed from the lanes the PLAN has, not a fixed worker count — a lane
    // the pool could not staff runs inline and never existed.
    const pinned = account({
        serialWall: 1200, serialCosts: [300, 300, 300, 300],
        parallelWall: 600, parallelCosts: [300, 300, 300, 300],
        plan: [[0, 1], [2], [3]],
    });
    eq('a pinned pair sets the makespan', pinned.makespan, 600);
    eq('ideal is over the plan’s own lanes', pinned.ideal, 400);
    eq('so pinning reads as imbalance', pinned.imbalance, 200);

    // Parsing the real log lines. A trailing field appended after `cost=` would
    // be read as a chain, so the shape is pinned here too.
    const r = parseCostReport('chain cost: blocks=9 worst=5 wall=1091/1349 cost=10/20,30/40');
    eq('wall mean parses', r.wallMean, 1091);
    eq('per-chain means parse', r.costs.join(','), '10,30');
    eq('lane plan parses', JSON.stringify(parsePlan('parallel=1 lanes=3 plan=4,2|7|1,9')),
        '[[4,2],[7],[1,9]]');
    eq('an empty plan is empty, not [NaN]', JSON.stringify(parsePlan('plan=')), '[]');
}

}
