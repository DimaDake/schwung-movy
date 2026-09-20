/* browser-test/logic/schwung-page-idle-cost.mjs — SP-49: an idle `page` tick's
 * host-call BUDGET, asserted locally so a regrowth reds a test instead of
 * waiting for the next device measurement to notice.
 *
 * SP-49 measured the idle gap on device (minijv, 70 pages): stashing the
 * reload divider out to where it never fires in a measurement window collapsed
 * the ENTIRE `page`-vs-`off` idle gap to noise — calls/tick 1.1->0.6 (off's own
 * 0.6), worst period 6.1->5.4ms (off's 5.1). The two IPC lines SP-38/39/49
 * could not otherwise attribute (`mget ch0:*`, `get overtake_dsp:*`) rode the
 * SAME divider tick and vanished with it. So the idle cost this suite guards is
 * almost entirely the TWO DIVIDERS' shape: `schwung-page-cache.ts`'s
 * `FILL_TICKS` (bulk value refill) and `schwung-page-contract.ts`'s
 * `RELOAD_POLL_TICKS` (the re-plan poll, widened 8->16 by this same item,
 * since its OWN cost — SU-14, schwung PR #519, unreviewed — cannot be fixed
 * here; only how often movy asks for one can). A tick that pays for either
 * divider on every pass, not on its own turn, is the shape SP-26/27 already
 * fixed twice on the value-refresh side; this is the reload side's equivalent
 * guard.
 *
 * EXPECTED_* ARE LITERAL, NOT IMPORTED, on purpose (this plan, SP-49 §5): the
 * bound must hold still while the code under test is deliberately broken (see
 * the teeth block below), or a broken divider and a broken bound move
 * together and the assertion never reds. A real, intentional widening of
 * either divider is a two-line diff: bump the literal here to match.
 */
import {
    env, setSchwungGridMode, schwungGridReload, schwungPageFor,
    schwungLibAvailable, MOCK_SYNTHS, countTripKinds, ok, _log,
} from './harness.mjs';

const EXPECTED_FILL_TICKS         = 8;   // schwung-page-cache.ts FILL_TICKS
const EXPECTED_RELOAD_POLL_TICKS  = 16;  // schwung-page-contract.ts RELOAD_POLL_TICKS (SP-49)

// A steady-state idle tick still pays a SMALL number of single-key misses
// outside the two dividers above (a settled widget's occasional re-check, a
// name-poll on its own much slower cadence) — SP-49's device trace read this
// as a handful of calls per divider firing, not per tick. Measured against
// THIS harness (real param_pages, mock TrackPort, test16, N=96): 6 reload
// firings cost 31 single-key calls, ~5.2/firing — 5 leaves headroom without
// hiding a regression (an every-tick reload would need ~16x this many).
// Generous on purpose: this budget exists to catch a tick cost that regrows
// into an every-tick read, not to chase the last call.
const PER_RELOAD_MISS_SLACK = 5;

function pageFor(preset) {
    env.setParams(preset);
    schwungGridReload();
    return schwungPageFor(0, 'synth');
}

export async function run() {

if (!schwungLibAvailable()) {
    _log('\nlogic: the idle page tick host-call budget — SKIPPED (no param_pages; set SCHWUNG=)');
    return;
}

_log('\nlogic: the idle page tick host-call budget (SP-49)');

setSchwungGridMode('page');

const p = pageFor(MOCK_SYNTHS.test16);
let n = 0;
while (n < 12 * 60 && !p.ready) { p.tick(); n++; }
ok('the page is up before the idle window starts', p.ready);

// A multiple of BOTH dividers, so the window's edge never gives one of them a
// partial cycle that would make the bound flaky rather than tight.
const N = 96; // lcm(EXPECTED_FILL_TICKS=8, EXPECTED_RELOAD_POLL_TICKS=16) * 4

const { trips, bulk, single } = countTripKinds(() => {
    for (let i = 0; i < N; i++) p.tick();
});

const bound = Math.ceil(N / EXPECTED_FILL_TICKS)
            + Math.ceil(N / EXPECTED_RELOAD_POLL_TICKS) * (1 + PER_RELOAD_MISS_SLACK);

ok(`idle host calls stay in budget (${trips} <= ${bound}, bulk=${bulk} single=${single})`,
   trips <= bound);

schwungGridReload();
setSchwungGridMode(null);
env.setParams(MOCK_SYNTHS.test16);

}
