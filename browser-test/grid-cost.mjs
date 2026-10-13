#!/usr/bin/env node
/* grid-cost.mjs — what a Schwung param page costs per gesture, as a GATE.
 *
 * The complaint SP-13 exists for: a knob turn and a jog page change cost so
 * many host calls they lengthen the tick, and the tick IS movy's MIDI input
 * sampling interval — so a slow gesture drops the CCs that arrived meanwhile.
 * `scripts/grid-call-cost.mjs` measures host calls, load-independently, over
 * 20 spaced gestures against a mock module; `scripts/grid-tick-cpu.mjs` counts
 * contract re-derivations on a steady minijv page. Each child runs in its own
 * process because it builds mock globals and drives a whole app lifecycle.
 *
 * THREE CEILINGS, each an absolute number with its derivation beside it:
 *   - the gesture PREMIUM (calls over the page's own idle floor),
 *   - the IDLE floor in blocking round trips (SP-26 — a premium cannot see it,
 *     it is in both windows and subtracts out),
 *   - contract re-derivations on a steady page: zero (SP-27).
 * The windows must span the same ticks or the premium subtracts a floor of the
 * wrong size (it once did, by 2x); the child refuses to print otherwise. The
 * history of each number is in docs/schwung-page-migration.md (SP-13/26/27);
 * movy's own pages, the old comparison arm, were retired 2026-10-13.
 */
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));

/* The gesture premium ceiling, in calls over the page's own idle floor.
 * Derived from a measured 109 (128 on 2026-10-13); what it must not pass is a
 * DOUBLING of the derivation point (218), so it sits close —
 * the child is deterministic, and the headroom absorbs drift in the mock's page
 * shape, not noise. */
export const PREMIUM_CEILING = 163;

/* The idle floor in BLOCKING ROUND TRIPS over the 600-tick window — the number
 * SP-26 moved and the one a premium cannot see. Measured at 146 (three runs,
 * zero spread). The ceiling is
 * derived the same way as the one above: above every observed run, strictly
 * below the doubling it exists to catch (292), midpoint rounded down. The
 * regression it is really for is much further out — with the cache bypassed the
 * same window costs 753 trips, which is one blocking GET per tick and is what
 * SP-13 measured on device as a DOUBLED tick period. */
export const IDLE_TRIPS_CEILING = 219;

/* The gesture spacing the ceiling was derived at. It is asserted rather than
 * assumed: remove the spacing from the child and the SAME code measures 7
 * instead of 43, which passes every ceiling and reads as a six-fold improvement.
 * A number whose cadence is not pinned is not a measurement. */
export const EXPECTED_GAP_MS = 40;

/* The ONE line the child publishes for this suite, and it is the only thing read
 * from it: the human table above it is the part a later reader is most likely to
 * reword, and a parser pointed at that would break on a column change. */
const LINE = /^grid-cost: calls=(-?\d+) gap=(\d+) idletrips=(\d+) span=(\d+)$/m;

/* SP-27's line, from the other child. Same convention, same reason. */
const CPU_LINE = /^grid-tick-cpu: module=(\S+) params=(\d+) levels=(\d+) parses=(\d+) ticks=(\d+) meanus=(\d+) p99us=(\d+)$/m;

/** Parse scripts/grid-tick-cpu.mjs's summary line, or null if it never printed one. */
export function parseTickCpu(stdout) {
    const m = CPU_LINE.exec(stdout || '');
    return m ? { module: m[1], params: Number(m[2]), levels: Number(m[3]),
                 parses: Number(m[4]), ticks: Number(m[5]),
                 meanUs: Number(m[6]), p99Us: Number(m[7]) } : null;
}

/** Parse the child's summary line, or null if it never printed one. */
export function parseGridCost(stdout) {
    const m = LINE.exec(stdout || '');
    return m ? { calls: Number(m[1]), gap: Number(m[2]),
                 idleTrips: Number(m[3]), span: Number(m[4]) } : null;
}

/**
 * The premium assertion, as a pure function — so it can be PROVEN: the teeth in
 * main() hand it input that is genuinely over budget and require it to say so.
 *
 * A NON-POSITIVE PREMIUM IS NOT A PASS: it means the gesture added nothing,
 * which is what a regression that stops the gesture reaching the router
 * produces (the `setcommit` defect) — no measurement, not a good one.
 */
export function checkPremium(calls, ceiling = PREMIUM_CEILING) {
    if (calls <= 0) {
        return { ok: false, why: `measured ${calls} calls over the idle floor — a gesture that never arrived is not a cheap gesture` };
    }
    if (calls <= ceiling) return { ok: true };
    return { ok: false, why: `${calls} calls over the idle floor (ceiling ${ceiling})` };
}

/**
 * Run the CPU child against one dumped module.
 *
 * `CPU_TICKS` is deliberately small here: this gate asserts a COUNT that is
 * zero or is not, so a long window buys no confidence — it only makes the
 * suite slower. The ledger numbers in docs/ are taken at the script's own
 * default, which is larger because a millisecond distribution does need one.
 */
function cpuRun(module, ticks = 600) {
    const r = spawnSync(process.execPath,
        [join(__dir, '..', 'scripts', 'grid-tick-cpu.mjs'), module],
        { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
          env: { ...process.env, CPU_TICKS: String(ticks) } });
    const line = parseTickCpu(r.stdout);
    if (!line) {
        console.log(r.stdout || '');
        console.log(r.stderr || '');
        throw new Error(`the ${module} run printed no grid-tick-cpu line`);
    }
    return line;
}

function costRun() {
    const r = spawnSync(process.execPath, [join(__dir, '..', 'scripts', 'grid-call-cost.mjs')], {
        encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: process.env,
    });
    const line = parseGridCost(r.stdout);
    if (!line) {
        /* The child's own stdout/stderr are dumped rather than swallowed: a
         * crash here is a real message, and "no line" on its own sends the next
         * reader looking for a parser bug instead of a stack trace. */
        console.log(r.stdout || '');
        console.log(r.stderr || '');
        throw new Error('the cost child printed no grid-cost line (crash, or the emit moved after process.exit)');
    }
    return line;
}

async function main() {
    let failures = 0;
    const ESC = String.fromCharCode(27);
    const ok   = (l) => console.log(`  ${ESC}[32m✓${ESC}[0m ${l}`);
    const fail = (l, why) => { console.log(`  ${ESC}[31m✗${ESC}[0m ${l}: ${why}`); failures++; };

    /* THE TEETH, PINNED: without them a `checkPremium` hollowed out to
     * `return {ok:true}` leaves everything green. */
    const teeth = (label, calls, want) => {
        const got = checkPremium(calls).ok;
        if (got === want) ok(`teeth: ${label}`);
        else fail(`teeth: ${label}`, `said ${got ? 'within' : 'over'} budget, want the opposite`);
    };
    teeth('the measured premium is within budget', 109, true);
    teeth('a DOUBLED gesture is over budget', 218, false);
    teeth('a premium in the thousands is over budget', 5000, false);
    teeth('a cheaper gesture is within budget, so the check is not a constant', 20, true);
    teeth('a gesture that measured nothing is not a pass', 0, false);

    const run = costRun();
    /* THE CADENCE THE CEILING WAS DERIVED AT. Drop the spacing and the same code
     * measures 7 rather than 43 and every ceiling passes — a silently faster
     * harness makes the number BETTER, so it is checked. */
    if (run.gap !== EXPECTED_GAP_MS) {
        fail('the gesture cadence', `${run.gap} ms apart, not the ${EXPECTED_GAP_MS} ms the ceiling was derived at`);
    } else {
        const r = checkPremium(run.calls);
        if (r.ok) ok(`the gesture premium is ${run.calls} calls over the idle floor (ceiling ${PREMIUM_CEILING})`);
        else fail('gesture cost', r.why);
    }

    /* THE IDLE FLOOR, IN ROUND TRIPS — SP-26's own gate. */
    if (run.span > 0 && run.idleTrips <= IDLE_TRIPS_CEILING) {
        ok(`a page idles at ${run.idleTrips} round trips per ${run.span} ticks`
           + ` (${(run.idleTrips / run.span).toFixed(3)} a tick; ceiling ${IDLE_TRIPS_CEILING})`);
    } else {
        fail('the idle floor', `${run.idleTrips} round trips over ${run.span} ticks is over the ceiling of`
             + ` ${IDLE_TRIPS_CEILING} — the page's reads are not being batched (the 9.1 ms tick SP-13 measured)`);
    }

    /* SP-27 — A STEADY PAGE RE-DERIVES THE MODULE'S CONTRACT ZERO TIMES. An
     * invariant, not a threshold. On minijv on purpose: 433 params and 57 levels,
     * where the discarded re-plan measured 2.8 ms per reload; the shape is
     * asserted too, so a fixture that shrank to a two-param mock cannot pass. */
    {
        const cpu = cpuRun('minijv');
        if (cpu.params < 400 || cpu.levels < 50) {
            fail('the minijv fixture', `${cpu.params} params / ${cpu.levels} levels is not minijv`);
        } else if (cpu.parses === 0) {
            ok(`a steady page re-derives minijv's contract 0 times per ${cpu.ticks} ticks`
               + ` (${cpu.params} params, ${cpu.levels} levels; mean tick ${cpu.meanUs}us)`);
        } else {
            fail('contract re-derivations', `${cpu.parses} over ${cpu.ticks} ticks, want 0 — the reload is`
                 + ` re-planning minijv on its divider and throwing the result away (SP-27)`);
        }
    }

    if (failures === 0) console.log(`\n${ESC}[32m${ESC}[1mGRID COST IS WITHIN BUDGET${ESC}[0m`);
    else { console.log(`\n${ESC}[31m${ESC}[1m${failures} GRID-COST CHECK(S) FAILED${ESC}[0m`); process.exit(1); }
}

/* Run the sweep when invoked directly, and only then.
 *
 * BOTH SIDES ARE REALPATHED, because comparing them as spelled is wrong under a
 * symlink: node resolves the entry point's symlinks, so `import.meta.url` comes
 * back as the real path while `argv[1]` keeps the spelling used to invoke it.
 * The guard then never matches, and the suite prints NOTHING and exits 0 — a
 * false green of exactly the shape this file exists to prevent. Same guard as
 * fleet-pages.mjs. */
if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) await main();
