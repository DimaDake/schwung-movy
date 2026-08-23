// render-accounting.mjs — where a parallel block's time actually went.
//
// `measure-parallel-render.sh` reports a speedup. A speedup says nothing about
// WHY it is not larger, and `plans/2026-08-23-parallel-render-prototype.md` §6
// attributed a ~100us gap to "fan-out and preemption" on no evidence at all.
//
// The cost report already carries everything needed to settle it: per-chain
// means in BOTH modes plus the lane plan. This turns them into an identity, so
// each loss is charged to exactly one line and the remainder is what is really
// unexplained:
//
//   serial_wall  = sum(cost_serial) + serial_residual   <- method check, ~0
//   sum(cost_par)= sum(cost_serial) + contention        <- cache/bandwidth
//   makespan     = max over lanes of sum(cost_par)      <- what packing gives
//   par_wall     = makespan + overhead                  <- fan-out, join, preempt
//
// The distinction that matters: a lane finishing early is charged to IMBALANCE,
// inside the makespan. It cannot show up in `overhead`, because the wall is set
// by the LAST lane to finish. Only the busiest lane's cost is on the critical
// path.

/** Sum the per-chain costs of the chains a lane was given. */
const laneLoad = (lane, costs) => lane.reduce((t, c) => t + (costs[c] ?? 0), 0);

/**
 * @param serialWall/parallelWall  measured wall means, ns
 * @param serialCosts/parallelCosts  per-chain means, ns, indexed by chain
 * @param plan  lane -> chain indices, as `chrenderlog` reports it
 */
export function account({ serialWall, serialCosts, parallelWall, parallelCosts, plan }) {
  const serialSum = serialCosts.reduce((t, c) => t + c, 0);
  const parallelSum = parallelCosts.reduce((t, c) => t + c, 0);
  const loads = plan.map((l) => laneLoad(l, parallelCosts));
  // Per-lane inflation splits two causes that both slow a render call down and
  // are otherwise indistinguishable in the total. Lane 0 IS the audio thread —
  // FIFO 90 on core 3, so Move's FIFO 70 workers cannot preempt it, while the
  // FIFO 68 helpers can. Cache/bandwidth contention hits all three lanes about
  // equally; preemption hits only lanes 1+. Free: same two log lines.
  const inflation = plan.map((l) => {
    const s = laneLoad(l, serialCosts);
    return s > 0 ? laneLoad(l, parallelCosts) / s : 0;
  });
  const makespan = loads.length ? Math.max(...loads) : 0;
  // The floor a perfect packing of THIS work would reach. Lanes are counted
  // from the plan, not from a constant: a plan the pool could not staff runs
  // its surplus inline, and pretending those lanes existed would invent a
  // ceiling nothing could reach.
  const ideal = loads.length ? parallelSum / loads.length : 0;

  return {
    serialSum,
    // Non-zero means the per-chain timers do not add up to the wall even with
    // one thread — instrumentation error, and every figure below inherits it.
    serialResidual: serialWall - serialSum,
    parallelSum,
    // Same chains, same notes, more threads. Whatever this is, no scheduling
    // change can recover it: the work itself got more expensive.
    contention: parallelSum - serialSum,
    loads,
    inflation,
    makespan,
    ideal,
    // Idle lane time on the critical path's clock. Charged to the PLAN.
    imbalance: makespan - ideal,
    // The only residue that fan-out, join and preemption can live in.
    overhead: parallelWall - makespan,
    speedup: parallelWall > 0 ? serialWall / parallelWall : 0,
    // What this run would have reached with a free rendezvous — the ceiling
    // T1/T2 in §6 are chasing, and the number that says whether chasing pays.
    ceiling: makespan > 0 ? serialWall / makespan : 0,
  };
}

/** Parse `blocks=.. worst=.. wall=<mean>/<max> cost=<mean>/<max>,...`. */
export function parseCostReport(line) {
  const wall = /wall=(\d+)\/(\d+)/.exec(line);
  const tail = line.split('cost=')[1];
  return {
    wallMean: wall ? Number(wall[1]) : 0,
    wallMax: wall ? Number(wall[2]) : 0,
    costs: tail ? tail.trim().split(',').map((p) => Number(p.split('/')[0])) : [],
  };
}

/** Parse `plan=4,2,10|7,6,5|1,9,3` — an empty lane is a lane, not a gap. */
export function parsePlan(line) {
  const m = /plan=(\S*)/.exec(line);
  if (!m || m[1] === '') return [];
  return m[1].split('|').map((l) => (l === '' ? [] : l.split(',').map(Number)));
}

/* CLI: node render-accounting.mjs <serialWall> <serialCosts> <parWall> <parCosts> <plan> */
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const [sw, sc, pw, pc, pl] = process.argv.slice(2);
  if (pl !== undefined) {
    const nums = (s) => s.split(',').map(Number);
    const a = account({
      serialWall: Number(sw),
      serialCosts: nums(sc),
      parallelWall: Number(pw),
      parallelCosts: nums(pc),
      plan: parsePlan(`plan=${pl}`),
    });
    const us = (n) => (n / 1000).toFixed(1);
    console.log(
      [
        a.serialSum, a.serialResidual, a.parallelSum, a.contention,
        a.makespan, a.ideal, a.imbalance, a.overhead,
      ].map(us).join(' ') + ` ${a.speedup.toFixed(2)} ${a.ceiling.toFixed(2)} ` +
      a.loads.map(us).join(',') + ' ' + a.inflation.map((r) => r.toFixed(2)).join(',')
    );
  }
}
