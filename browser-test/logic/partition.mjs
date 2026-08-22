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

}
