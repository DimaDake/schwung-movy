#!/usr/bin/env node
/* browser-test/schwung-built.mjs — "did the Schwung half actually run?", asked
 * ONCE, at the front of the suite, instead of twelve times in the middle of it.
 *
 * THE FAILURE THIS EXISTS FOR IS A GREEN RUN. `SCHWUNG=` is a BUILD-time alias
 * (`build/browser.mjs`): without it every `param_pages` import in `dist/esm`
 * resolves to a stub that throws, `schwungLibAvailable()` is false, and every
 * suite that grades the delegated page prints `SKIPPED` and returns. The run
 * then ends `ALL LOGIC CHECKS PASSED` — 9 000 lines later, with the half the
 * work was about never executed. Two agents were bitten by exactly this in one
 * session (2026-09-19), and `page-mode.mjs` can be bitten worse: with the
 * library absent it reports every listed label as fixed, which instructs a
 * maintainer to DELETE labels that are still failing.
 *
 * So the rule this file enforces, which is worth stating plainly:
 *
 *     A gate may be GREEN or RED. "It did not run" is RED.
 *
 * `ALLOW_SKIPPED=1` is the deliberate opt-out — for a checkout that genuinely
 * has no schwung beside it, where a partial run is better than none. It still
 * prints what will be skipped, so the opt-out cannot be silent either.
 *
 * Asked of the BUILT ARTEFACT, never of the environment variable: `SCHWUNG=`
 * set on the test run but not on the build is the exact shape of the trap, and
 * a variable check would call that case green.
 */
import { schwungLibAvailable, schwungLibError } from '../dist/esm/renderer/schwung-lib.js';

const BOLD = '\x1b[1m', RED = '\x1b[31m', YEL = '\x1b[33m', GRN = '\x1b[32m', OFF = '\x1b[0m';

if (schwungLibAvailable()) {
    console.log(`${GRN}schwung: param_pages is in the bundle — the Schwung half will RUN${OFF}`);
    process.exit(0);
}

const why = schwungLibError() || 'param_pages did not load';
const lines = [
    `${BOLD}${RED}THE SCHWUNG HALF OF THIS SUITE CANNOT RUN — STOPPING.${OFF}`,
    '',
    `  why:   ${why}`,
    '  what:  every delegated-page assertion (the `page` arm) would print SKIPPED',
    '         and the run would still end "ALL LOGIC CHECKS PASSED".',
    '',
    `  fix:   ${BOLD}SCHWUNG=../schwung npm test${OFF}`,
    '         (SCHWUNG= is a BUILD-time alias — it must be set on the BUILD,',
    '          which `npm test` runs first. Setting it only on a hand-run suite',
    '          leaves dist/esm carrying the stub.)',
    '',
    `  or:    ${BOLD}ALLOW_SKIPPED=1 npm test${OFF} to run the rest deliberately.`,
];
if (process.env.ALLOW_SKIPPED === '1') {
    console.log(`${YEL}${BOLD}schwung: param_pages is NOT in the bundle — the Schwung half will be`
              + ` SKIPPED (ALLOW_SKIPPED=1).${OFF}`);
    console.log(`  why: ${why}`);
    console.log('  A green run below says nothing about the delegated page.');
    process.exit(0);
}
console.log(lines.join('\n'));
process.exit(1);
