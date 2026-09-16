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
 * THE BUDGET IS WRITTEN AS A RATIO AND THE RATIO IS NOMINAL — what is actually
 * asserted is an ABSOLUTE CEILING on the page arm's premium, and saying so is the
 * honest reading rather than a downgrade. `off`'s premium is NEGATIVE by
 * construction: an input suppresses movy's refresh window and in `off` mode the
 * gesture adds nothing to replace it, so no ratio with `off` as its denominator
 * can ever move. The denominator is floored at one call per gesture and the
 * comparison reduces to `pagePremium <= BUDGET_RATIO`. The price of that is that
 * an absolute ceiling DOES drift if the mock's page changes shape or the gesture
 * changes — so those are re-measure triggers, not defects, and the numbers below
 * are what it was set from rather than a magic constant.
 *
 * MEASURED 2026-09-13, corrected windows (600 ticks each side), this harness:
 *   off  = -418 calls  (below its own idle floor, for the reason above)
 *   page =  +51 calls
 * The budget is 90: 1.76x the measurement. It is deliberately close, because the
 * thing it must not let through is a DOUBLING of the page arm's real gesture cost
 * — which is now 102, and 102 > 90. A budget with the old generous headroom would
 * pass exactly the regression this gate exists for. The margin is affordable
 * because the child is deterministic to the call (51 on every run, both arms'
 * idle windows identical at 678), so the headroom guards against legitimate drift
 * in the mock's page shape, not against noise — and drift is a re-measure
 * trigger, as above.
 *
 * THE PAIR QUOTED HERE EARLIER WAS -63 / 397 AND IT WAS WRONG. Those windows had
 * different spans — `window_` advanced its own 300 ticks on top of the 300 the
 * gestures had already advanced, so the gesture window spanned 600 against a
 * 300-tick floor and the subtraction removed HALF a floor. The tell was the
 * gesture row's own `calls/tick`, a 600-tick count divided by 300. Both arms
 * carried the same inflation, which is exactly why it read as a healthy ratio:
 * at the old budget of 550, a regression that doubled the real page gesture cost
 * passed. The spans are now measured, printed, and refused if they disagree.
 *
 * ONE CONSEQUENCE OF THAT FIX IS WORTH KNOWING BEFORE CHANGING THIS FILE, AND IT
 * HOLDS ONLY FOR THE ARM THIS GATE ASSERTS ON. With the spans equal, a cost that
 * scales with ticks adds equally to both of THE PAGE ARM'S windows and cancels
 * out of its premium — so `refreshOneParam` doing its work twice (the mutation
 * this gate was first proven with) adds 675 calls to the gesture window and 675
 * to the idle floor, moves page's premium 51 -> 51, and no longer trips it. That
 * is the metric working, not failing — the premium answers "what did the GESTURE
 * add", and a uniform per-tick increase is not that.
 *
 * IT IS NOT A PROPERTY OF THE METRIC IN GENERAL. Under that same mutation the
 * `off` arm moves -418 -> -851, because in `off` mode the gesture SUPPRESSES
 * movy's refresh window: the added cost lands mostly on the idle side (675 there
 * against ~242 on the gesture side) and the two do not cancel. The cancellation
 * needs both windows' work to be unaffected by whether a gesture is in flight,
 * which is true of page and false of off. Do not apply it to an arm whose gesture
 * suppresses the floor.
 *
 * What does trip this gate is work in the PAGE gesture path: a host round-trip
 * per knob detent in the page arm (`knobTurn`, i.e. the throttle removed, which is
 * the shape the original complaint describes) measures 1311 and leaves the off
 * arm untouched at -418.
 *
 * RE-MEASURED 2026-09-14, AFTER SP-12, AND THE CEILING IS NOW LOOSE. The page
 * arm's gesture premium is **7** (was 51) and its idle floor is **753** over 600
 * ticks, 1.25 calls/tick, against `off` unchanged at -418 / 678 / 1.13. Read the
 * floors together with the premium or the numbers mislead: BEFORE SP-12 the page
 * arm idled at exactly `off`'s 678, not because the grid was free but because the
 * delegated page was polled only on a repaint and a steady movy does not repaint
 * — the page's read cursor never advanced at all. It advances every tick now, and
 * costs 0.12 calls/tick more than the movy refresh it replaced.
 *
 * The consequence for THIS gate is that 90 is 13x the measurement, so a doubled
 * page gesture (14) sails through it — the exact regression the tight budget was
 * chosen for. Re-deriving it is SP-13's, which owns the cost verdict; SP-12
 * deliberately did not move a gate it had just changed the reading of. The
 * numbers above are what SP-13 should set it from.
 */
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));

/* The committed budget: an ABSOLUTE CEILING on the page arm's premium, in calls
 * over its own idle floor, and set close to the measurement on purpose. What it
 * must not pass is a DOUBLING of the measured gesture cost — 51 -> 102 — so a
 * budget with comfortable headroom would pass exactly the regression this exists
 * for. It can afford to sit close because the child is deterministic (51 every
 * run, both arms' idle windows 678), so the headroom that is there absorbs drift
 * in the mock's page shape, not noise. */
export const BUDGET_RATIO = 90;

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
    /* A PAGE ARM THAT MEASURED NOTHING IS NOT A PASS, and without this line it is
     * a very quiet one: `0 / 1 = 0 <= budget` reads green, and the near-zero tooth
     * below used to encode that a cheap page arm passes. A regression that stops
     * the gesture reaching the router produces EXACTLY this — the harness
     * reporting a healthy number over a void, which is the `setcommit` defect
     * found and fixed in this very task. A non-positive premium means the gesture
     * added nothing, so there is no measurement here, not a good one. */
    if (pageCalls <= 0) {
        return {
            ok: false,
            ratio: 0,
            why: `the page arm measured ${pageCalls} calls over its idle floor — a gesture that never arrived is not a cheap gesture`,
        };
    }
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
    teeth('the measured pair is within budget, so this check is not merely always red', -418, 51, true);
    /* THE ONE THE BUDGET IS SET BY. 51 is the measured page premium, so 102 is
     * that gesture costing TWICE what it costs today — the regression the tight
     * budget exists for, and the reason the budget cannot be generous. */
    teeth('a DOUBLED page gesture is over budget', -418, 102, false);
    teeth('a page arm that grew into the thousands is over budget', -418, 5000, false);
    teeth('a page arm that got CHEAPER than measured is within budget, so the check is not a constant',
          -418, 20, true);
    /* The floor, on its own: broken INPUT rather than a broken assertion. A
     * negative or zero denominator must not flip the comparison. */
    teeth('a zero denominator cannot divide the budget away', 0, 5000, false);
    teeth('a negative denominator cannot divide the budget away', -418, 5000, false);
    /* THE VOID. `checkRatio(0, 0)` used to be `0 / 1 = 0 <= budget` — green — so a
     * harness that measured nothing at all, on both arms, reported the best
     * possible result. That is the `setcommit` failure of this very task. */
    teeth('a page arm that measured nothing is not a pass, however cheap it looks', 0, 0, false);
    teeth('a page arm that measured nothing is not a pass even against a healthy off arm',
          -418, 0, false);

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
    /* A GESTURE THAT NEVER ARRIVED IS NOT A CHEAP GESTURE. `checkRatio` refuses a
     * non-positive page count on its own — it is pinned by two teeth above — but
     * naming it here says WHAT happened instead of reporting it as a budget
     * figure, and it is the failure this task's own `setcommit` defect produced:
     * both arms reporting the idle refresh and nothing on top, exit 0. */
    if (page.mode === 'page' && page.calls <= 0) {
        fail('the page arm', `measured ${page.calls} calls over its idle floor — the gesture did not reach the router`
            + ` (see the setcommit guard in grid-call-cost.mjs), so this run has no result rather than a good one`);
        comparable = false;
    }

    /* THE RATIO IS ONLY MEANINGFUL BETWEEN TWO DIFFERENT PROGRAMS. Assessing it
     * anyway prints a verdict line beside the failure above, and on this exact
     * input that line reads "page costs -418x off" and says it is within budget —
     * a number that looks like a measurement and is arithmetic on two copies of
     * the same arm. */
    if (!comparable) {
        fail('the two arms', 'are not comparable, so no ratio was assessed');
    } else {
        const r = checkRatio(off.calls, page.calls);
        /* The verdict names the CEILING, not the ratio, because the ratio is the
         * nominal half: with `off` negative the denominator is floored at one and
         * the assertion is `pagePremium <= budget`. The ratio is still printed —
         * it is what a reader will look for — but as the arithmetic it is. */
        if (r.ok) ok(`page's gesture premium is ${page.calls} calls over its own idle floor`
            + ` (ceiling ${BUDGET_RATIO}; off measured ${off.calls}, nominal ratio ${r.ratio.toFixed(0)}x)`);
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
