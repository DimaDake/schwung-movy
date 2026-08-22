// partition.mjs — assign chains to render workers, and price the assignment.
//
// A static partition cannot finish before its largest member, so the makespan
// (the loaded worker's total) is what parallel chain render actually costs —
// not the mean. Used by `measure-chain-balance.sh` to turn a device measurement
// into a speedup, and by `analyze-isolation-cost.mjs` to price the constraint
// that keeps same-module chains off each other's threads.

/** Longest-processing-time-first: sort descending, drop each onto the least
 *  loaded bin. Within 4/3 of optimal; the exact optimum needs an exponential
 *  search and has never moved a verdict here. */
export function lpt(items, workers) {
  const bins = Array.from({ length: workers }, () => ({ load: 0, items: [] }));
  for (const it of [...items].sort((a, b) => b.cost - a.cost)) {
    const b = bins.reduce((m, x) => (x.load < m.load ? x : m));
    b.load += it.cost;
    b.items.push(it);
  }
  return {
    makespan: Math.max(...bins.map((b) => b.load)),
    total: items.reduce((t, i) => t + i.cost, 0),
    bins,
  };
}

/** LPT with same-`group` items forced onto one worker.
 *
 *  This is the zero-cost answer to shared module statics: two chains holding
 *  the same `.so` share its file-scope state, but only race if they render
 *  CONCURRENTLY. Pinned to one worker they are serial, exactly as today — no
 *  copies, no extra disk, no audit. The price is paid in makespan, which is
 *  what this measures. */
export function lptGrouped(items, workers) {
  const byGroup = new Map();
  for (const it of items) {
    const k = it.group ?? it.id;
    if (!byGroup.has(k)) byGroup.set(k, { id: k, cost: 0, members: [] });
    const g = byGroup.get(k);
    g.cost += it.cost;
    g.members.push(it);
  }
  const packed = lpt([...byGroup.values()], workers);
  // Re-expand so a caller sees chains, not groups.
  return {
    ...packed,
    bins: packed.bins.map((b) => ({
      load: b.load,
      items: b.items.flatMap((g) => g.members),
    })),
  };
}

/** Speedup over serial, including the measured fixed cost of waking and
 *  joining the workers (`plans/2026-08-22-join-cost-prototype.md`). */
export function speedup(total, makespan, joinUs = 0) {
  const denom = makespan + joinUs;
  return denom > 0 ? total / denom : 0;
}

/* CLI, so the device benchmark shares this implementation instead of carrying
 * a second copy of LPT in awk:
 *
 *   node scripts/lib/partition.mjs <workers> <c1,c2,...> [g1,g2,...]  -> "<total> <makespan>"
 *
 * Naming the groups switches to the pinned packing. */
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const [workers, costs, groups] = process.argv.slice(2);
  if (workers && costs) {
    const g = groups ? groups.split(',') : null;
    const items = costs.split(',').map((c, i) => ({ id: `ch${i}`, cost: Number(c), group: g ? g[i] : `ch${i}` }));
    const r = (g ? lptGrouped : lpt)(items, Number(workers));
    console.log(`${Math.round(r.total)} ${Math.round(r.makespan)}`);
  }
}
