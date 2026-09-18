/* browser-test/logic/page-contract.mjs — SP-15: does the contract ever resolve?
 *
 * `createPageContract` (src/renderer/schwung-page-contract.ts) decides whether
 * there is a page set to draw, and asks again while there is not. The ASKING is
 * this item: a page built while its slot was still empty spends its retry
 * budget on an answer that has not arrived yet, and once the budget is spent
 * nothing re-arms it — so the module that lands afterwards is never read. On
 * device that is "the first module I drop into an empty slot keeps movy's page
 * until I navigate away and back", which after a cold boot is the first thing
 * anyone does in `page` mode.
 *
 * Driven through the REAL controller and the REAL port over the harness's param
 * store. A hand-written fake controller could not be evidence here: the half
 * that decides "there is nothing to draw" is the contract's tri-state
 * (`contractUnresolved`), and only the controller produces it.
 *
 * Run by browser-test/logic.mjs.
 */

import {
    env, setSchwungGridMode, schwungGridReload, schwungPageFor,
    schwungLibAvailable, MOCK_SYNTHS, countTrips, ok, eq, _log,
} from './harness.mjs';

export async function run() {

if (!schwungLibAvailable()) {
    _log('\nlogic: the page contract lifecycle — SKIPPED (no param_pages; set SCHWUNG=)');
    return;
}

_log('\nlogic: the page contract lifecycle');

setSchwungGridMode('page');

/* A page for track 0's synth over a store holding `preset`. The registry is
 * dropped first because each case needs its OWN contract: `attempts` and the
 * counters beside it are per-page state, which is what this suite is about. */
function pageFor(preset) {
    env.setParams(preset);
    schwungGridReload();
    return schwungPageFor(0, 'synth');
}

/* Ticks until `pred`, and answers how many it took — the count is what says
 * whether the page arrived promptly or only after the test gave up waiting. */
function tickUntil(p, pred, budget) {
    let n = 0;
    while (n < budget && !pred()) { p.tick(); n++; }
    return n;
}

/* What the retry budget was: RETRY_TICKS (12) x RETRY_LIMIT (60). Used here as
 * a GENEROUS DEADLINE and never as the thing under test — an assertion written
 * against the implementation's own pace would agree with it by construction. */
const OLD_BUDGET = 12 * 60;

/* ── SP-15(a): a module that arrives after the budget is spent ─────────────── */

/* THE DELAY IS THE POINT. The budget once spent on an empty slot was the only
 * one that page would ever get: when it ran out the asking stopped for good, so
 * a module landing at tick 721 was never read — for the rest of the session,
 * with no symptom beyond a page that does not exist. Every case below is the
 * same module at a different delay, and each must be drawn as promptly as a
 * module that was there from the start. */
for (const delay of [0, 100, 719, 721, 1500]) {
    const p = pageFor({});
    for (let i = 0; i < delay; i++) p.tick();
    eq(`an empty slot draws nothing at +${delay}`, p.ready, false);

    env.setParams(MOCK_SYNTHS.test16);
    const took = tickUntil(p, () => p.ready, OLD_BUDGET);
    ok(`a module landing at +${delay} draws its page (after ${took} ticks)`,
       p.ready);
}

/* ── SP-15(b): a slot set to None hands the frame back ────────────────────── */

/* "RESOLVED AND EMPTY" IS A STATEMENT ABOUT THE ENGINE'S ANSWER, and it is the
 * answer a slot that has just gone None produces: the chain host keeps its
 * instance and serves `synth:module` EMPTY rather than absent. Only that shape
 * may eject — see the third case below for the one that may not — so the store
 * is made to answer the way the engine does rather than by deleting the keys. */
{
    const p = pageFor(MOCK_SYNTHS.test16);
    tickUntil(p, () => p.ready, OLD_BUDGET);
    ok('the module’s page is drawn', p.ready);

    env.setParams({ 'synth:module': '', 'synth:ui_hierarchy': '',
                    'synth:chain_params': '' });
    const took = tickUntil(p, () => !p.ready, OLD_BUDGET);
    ok('setting the slot to None hands the frame back', !p.ready);
    _log(`    (the frame came back after ${took} ticks)`);
}

/* A FAILED READ IS NOT NEWS. `null` is the channel saying it did not answer —
 * granny's file browser blocks the param thread for 100 ms and a live module's
 * read times out — so the previous verdict is HELD rather than replaced by
 * "there is nothing here", exactly as schwung's own host holds its screen.
 * Ejecting on it would throw the user out of a live editor. Asserted HERE
 * because the two shapes are one key apart and collapsing them is the mistake
 * this branch has made five times. */
{
    const p = pageFor(MOCK_SYNTHS.test16);
    tickUntil(p, () => p.ready, OLD_BUDGET);

    env.setParams({});
    for (let i = 0; i < 40; i++) p.tick();
    eq('a read that did not land leaves the frame alone', p.ready, true);
}

/* ── the asking is paced, so it is never a page's standing cost ───────────── */

/* THE OTHER HALF OF "KEEPS ASKING", AND WHY THE FIX GOES IN THE RULE RATHER
 * THAN IN THE NUMBERS. A contract with nothing to draw is the COMMON case — an
 * empty chain slot, a track nobody has loaded — so "keeps asking" may not mean
 * "asks at read pace forever": RETRY_TICKS is the pace of a READ retry, right
 * while a module is settling and wrong for a page that has nothing coming. Past
 * the load window the page asks once per module LOAD, and this is what holds it
 * there.
 *
 * THE TWO NUMBERS ARE BOTH MEASURED, and the second is the reason the check
 * exists: over the same 800 ticks an empty slot costs 4 round trips under the
 * paced rule, and 134 when the latch is kept and RETRY_LIMIT is merely raised
 * to 200 — the fix the ledger rules out, and one that passes every check above.
 * 100 sits between them, but the margin is ASYMMETRIC: 25x of headroom on the
 * paced side, only 34% on the bad one. A drift towards read pace lands outside
 * it; a slower idle pace still has room to move, but far less than the midpoint
 * implies, so re-tuning that pace means re-measuring both sides. */
{
    const p = pageFor({});
    for (let i = 0; i < OLD_BUDGET + 200; i++) p.tick();

    const TICKS = 800;
    const trips = countTrips(() => { for (let i = 0; i < TICKS; i++) p.tick(); });
    _log(`    (${trips} round trips over ${TICKS} ticks of an empty slot)`);
    ok('an empty slot is not re-read at read pace', trips < 100);
}

schwungGridReload();
setSchwungGridMode(null);
env.setParams(MOCK_SYNTHS.test16);

}
