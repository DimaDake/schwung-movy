#!/usr/bin/env node
// analyze-isolation-cost.mjs — what does module isolation cost, and is the free
// option good enough?
//
// Two chains holding the same module share one `dlopen` mapping, and therefore
// that module's file-scope state (schwung review §6). Serial render makes that
// safe by construction. Parallel render does not, and there are exactly two
// ways out:
//
//   COPY      give each chain its own byte-copy of the .so, so it gets its own
//             mapping and its own statics. Costs disk, RSS and load time, and
//             is what movy already does one level up for the chain host itself
//             (`engine/.../chain_copy.rs`).
//   CONSTRAIN pin same-module chains to ONE worker. They stay serial relative
//             to each other, so nothing is shared concurrently. Costs nothing
//             but makespan — which is what this prices.
//
// Costs are the measured means from `plans/2026-08-22-chain-balance-measurement.md`
// (device, 12 chains, 1170 blocks). No device needed to re-run this.

import { lpt, lptGrouped, speedup } from './lib/partition.mjs';

const JOIN_US = 21;   // measured, plans/2026-08-22-join-cost-prototype.md
const WORKERS = 3;    // the design point; a 4th is worth 0.13x
const BUDGET_US = 2000; // measured work ceiling, docs/chain-cpu-benchmarks.md

/** Per-module render cost, us/block, 4 held notes. Measured. */
const COST = {
  helm: 803.8, surge: 440.0, obxd: 257.0, noisemaker: 238.5,
  'weird-dreams': 87.0, forge: 57.2, dexed: 50.1, plaits: 36.6,
};

/** The set that was actually measured — a different module per chain, cycled. */
const MEASURED = [
  'plaits', 'obxd', 'dexed', 'noisemaker', 'helm', 'forge',
  'weird-dreams', 'surge', 'plaits', 'obxd', 'dexed', 'noisemaker',
];

const chains = (mods) => mods.map((m, i) => ({ id: `ch${i}`, group: m, cost: COST[m] }));

function row(label, items) {
  const free = lpt(items, WORKERS);
  const pinned = lptGrouped(items, WORKERS);
  const sFree = speedup(free.total, free.makespan, JOIN_US);
  const sPin = speedup(pinned.total, pinned.makespan, JOIN_US);
  const loss = sFree > 0 ? (1 - sPin / sFree) * 100 : 0;
  return { label, total: free.total, free, pinned, sFree, sPin, loss };
}

const f1 = (x) => x.toFixed(1).padStart(7);
const f2 = (x) => x.toFixed(2).padStart(5);

console.log(`\nModule isolation: does CONSTRAIN cost less than COPY?`);
console.log(`${WORKERS} workers, ${JOIN_US}us join, budget ${BUDGET_US}us\n`);

const header = `  ${'set'.padEnd(30)} ${'serial'.padStart(8)} ${'free'.padStart(8)} ${'pinned'.padStart(8)}  ${'free x'.padStart(6)} ${'pin x'.padStart(6)}  ${'loss'.padStart(6)}`;
console.log(header);
console.log('  ' + '-'.repeat(header.length - 2));

const results = [];

// 1. The set that was measured on device.
results.push(row('measured (8 modules, 4 dup)', chains(MEASURED)));

// 2. Homogeneity sweep. A real set repeats modules — two drum racks, three
//    obxd tracks — so the question is not "does it hold for 12 distinct" but
//    "where does pinning collapse". Built cheapest-first so the duplicated
//    module is the one a user would plausibly stack.
const names = Object.keys(COST).sort((a, b) => COST[b] - COST[a]);
for (const distinct of [6, 4, 3, 2, 1]) {
  const mods = Array.from({ length: 12 }, (_, i) => names[i % distinct]);
  results.push(row(`${distinct} distinct module${distinct > 1 ? 's' : ''} x 12 chains`, mods.length ? chains(mods) : []));
}

// 3. The worst case that matters: twelve of the single most expensive module.
results.push(row('12 x helm (worst realistic)', chains(Array(12).fill('helm'))));

for (const r of results) {
  console.log(
    `  ${r.label.padEnd(30)} ${f1(r.total)} ${f1(r.free.makespan)} ${f1(r.pinned.makespan)}  ` +
    `${f2(r.sFree)}x ${f2(r.sPin)}x  ${f1(r.loss)}%`
  );
}

console.log(`\n  fits the ${BUDGET_US}us budget?`);
for (const r of results) {
  const mark = (v) => (v <= BUDGET_US ? 'yes' : 'NO ');
  console.log(
    `  ${r.label.padEnd(30)} serial ${mark(r.total)}  free ${mark(r.free.makespan)}  pinned ${mark(r.pinned.makespan)}`
  );
}

console.log(`
  CONSTRAIN is free when the set is varied and worthless when it is not:
  pinning cannot beat 1.00x on a set of one module, and that is a set people
  build (twelve drum tracks). COPY is the only option that holds regardless of
  what the user loads — so the question this answers is whether a HYBRID is
  worth it, not whether pinning alone suffices.
`);
