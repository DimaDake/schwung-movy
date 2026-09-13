#!/usr/bin/env node
/* grid-cost.mjs — what the Schwung page grid costs per gesture, as a GATE.
 *
 * The complaint SP-13 exists for is that under `page` mode a knob turn and a jog
 * page change cost so many host calls they lengthen the tick, and the tick IS
 * movy's MIDI input sampling interval — so a gesture does not just feel slow, it
 * drops the CCs that arrived meanwhile. `scripts/grid-call-cost.mjs` measures
 * that in host calls, load-independently, by running the same 20 gestures
 * against the same mock module under each arm. This asserts on the result.
 *
 * TWO ARMS, TWO PROCESSES. Each arm is a `spawnSync` of the same child, exactly
 * as page-mode.mjs runs app-loop.mjs, and for the same reason: the child builds
 * mock globals and a mock engine at load and then drives a whole app lifecycle,
 * so a second arm in the same process would inherit the first one's state.
 *
 * SKIPPED, NOT PASSED, WITHOUT A CHECKOUT — and it says so. Without SCHWUNG the
 * built `dist/esm` serves a stub that throws on import, so `page` pins itself to
 * `off` and BOTH arms measure the same program. That is the one result an A/B
 * must not be able to fake, and it is checked below rather than assumed.
 *
 * THE BUDGET IS A RATIO. page's gesture premium over its own idle floor may not
 * exceed this multiple of off's. A ratio does not move when the harness gains
 * ticks or a page gains params, which an absolute number would; the numbers it
 * was set from are recorded underneath, so the next reader is not guessing at a
 * magic constant.
 *
 * MEASURED 2026-09-13, this harness, this repo:
 *   off  = -63 calls  (an input SUPPRESSES movy's refresh window and, in `off`
 *                      mode, the gesture adds nothing to replace it — so the arm
 *                      lands BELOW its own idle floor and the ratio's
 *                      denominator is pinned at one call per gesture)
 *   page = 397 calls  → ratio 397
 * The budget is 550: 38% of headroom above the measurement, and the mutation
 * grid-call-cost.mjs's own teeth-proof applies to store.ts (refreshOneParam
 * doing its work twice) lands at 729, i.e. 33% past it in the other direction.
 */
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));

/* The committed budget. Both arms are the same child with a different mode, so
 * the units cancel; a value near 1 would fail on a one-call difference in the
 * mock and a value in the thousands would never catch anything. */
export const BUDGET_RATIO = 550;

/* The ONE line the child publishes for this suite, and it is the only thing read
 * from it: the human table above it is the part a later reader is most likely to
 * reword, and a parser pointed at that would break on a column change. */
const LINE = /^grid-cost: arm=(\S+) mode=(\S+) calls=(-?\d+)$/m;

/** Parse the child's summary line, or null if it never printed one. */
export function parseGridCost(stdout) {
    const m = LINE.exec(stdout || '');
    return m ? { arm: m[1], mode: m[2], calls: Number(m[3]) } : null;
}

/**
 * The whole assertion, as a pure function of the two arms' numbers.
 *
 * Pure so it can be PROVEN: the real numbers pass, and a suite whose check is
 * `return []` would be green for every input. The synthetic cases in main() hand
 * this input that is genuinely over budget and require it to say so.
 *
 * The denominators are floored at one call per gesture. An arm that adds no
 * measurable host calls — or, as `off` does here, suppresses more than it adds —
 * is not a usable divisor, and a ratio against a negative number would make the
 * budget mean the opposite of what it says.
 */
export function checkRatio(offCalls, pageCalls, budget = BUDGET_RATIO) {
    const ratio = pageCalls / Math.max(1, offCalls);
    if (ratio <= budget) return { ok: true, ratio };
    return {
        ok: false,
        ratio,
        why: `page costs ${ratio.toFixed(0)}x off (budget ${budget}x) — page ${pageCalls} calls, off ${offCalls}`,
    };
}

function arm(which) {
    const r = spawnSync(process.execPath, [join(__dir, '..', 'scripts', 'grid-call-cost.mjs'), which], {
        encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: process.env,
    });
    const line = parseGridCost(r.stdout);
    if (!line) {
        /* The child's own stdout/stderr are dumped rather than swallowed: a
         * crash here is a real message, and "no line" on its own sends the next
         * reader looking for a parser bug instead of a stack trace. */
        console.log(r.stdout || '');
        console.log(r.stderr || '');
        throw new Error(`the ${which} arm printed no grid-cost line (crash, or the emit moved after process.exit)`);
    }
    return line;
}

async function main() {
    if (!process.env.SCHWUNG) {
        console.log('grid-cost: SKIPPED (no param_pages; set SCHWUNG=/path/to/schwung)');
        process.exit(0);
    }

    let failures = 0;
    const ESC = String.fromCharCode(27);
    const ok   = (l) => console.log(`  ${ESC}[32m✓${ESC}[0m ${l}`);
    const fail = (l, why) => { console.log(`  ${ESC}[31m✗${ESC}[0m ${l}: ${why}`); failures++; };

    /* THE TEETH, PINNED. Without these the suite's only real input is a healthy
     * pair of numbers, so `checkRatio` hollowed out to `return {ok:true}` leaves
     * everything green and nobody finds out until the day it matters. They stay
     * in the suite rather than in the ledger because prose cannot fail. */
    const teeth = (label, off, page, want) => {
        const got = checkRatio(off, page).ok;
        if (got === want) ok(`teeth: ${label}`);
        else fail(`teeth: ${label}`, `said ${got ? 'within' : 'over'} budget, want the opposite`);
    };
    teeth('the measured pair is within budget, so this check is not merely always red', -63, 397, true);
    teeth('a doubled page gesture is over budget', -63, 729, false);
    teeth('a page arm that grew into the thousands is over budget', -63, 5000, false);
    teeth('a page arm that got CHEAPER is within budget, so the check is not a constant',
          -63, 200, true);
    /* The floor, on its own: broken INPUT rather than a broken assertion. A
     * negative or zero denominator must not flip the comparison. */
    teeth('a zero denominator cannot divide the budget away', 0, 5000, false);
    teeth('a negative denominator cannot divide the budget away', -63, 5000, false);

    const off  = arm('off');
    const page = arm('page');

    /* ASKED-FOR ARM vs MODE THAT RAN. They are the same string on a working
     * build, and when they are not, the two arms measured one program — which
     * reads as "the grid is free" rather than as a broken harness. This is the
     * failure the header describes, and it is a FAILURE, not a skip. */
    let comparable = true;
    if (off.mode !== 'off') {
        fail('the off arm', `resolved to '${off.mode}' — the mode was not the one asked for`);
        comparable = false;
    }
    if (page.mode !== 'page') {
        fail('the page arm', `resolved to '${page.mode}' — schwungLibAvailable() is false, so this build has no `
            + `param_pages (rebuild with SCHWUNG=../schwung) and both arms measured the same program`);
        comparable = false;
    }

    /* THE RATIO IS ONLY MEANINGFUL BETWEEN TWO DIFFERENT PROGRAMS. Assessing it
     * anyway prints a verdict line beside the failure above, and on this exact
     * input that line reads "page costs -63x off" and says it is within budget —
     * a number that looks like a measurement and is arithmetic on two copies of
     * the same arm. */
    if (!comparable) {
        fail('the two arms', 'are not comparable, so no ratio was assessed');
    } else {
        const r = checkRatio(off.calls, page.calls);
        if (r.ok) ok(`page gesture costs ${r.ratio.toFixed(0)}x off (budget ${BUDGET_RATIO}x)`
            + ` — page ${page.calls} calls, off ${off.calls}, same 20 gestures each`);
        else fail('page gesture cost', r.why);
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
 * fleet-pages.mjs and page-mode.mjs. */
if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) await main();
