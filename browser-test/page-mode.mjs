#!/usr/bin/env node
/* page-mode.mjs — the schwung page migration's burn-down.
 *
 * Runs the REAL router suite once per arm and ratchets on which checks fail
 * under `page`. The number it prints is the migration's progress, and it is
 * deliberately the only place that number exists: a fresh session reads it in
 * one command and cannot argue with it.
 *
 * Two directions of failure, both hard:
 *   - a failure NOT in the list  → the last change regressed a sibling
 *   - a listed label that PASSES → the list is stale; delete the label
 *
 * A separate process per arm, not two passes in one: app-loop.mjs is 2713 lines
 * of top-level straight-line blocks sharing one set of mock globals, and
 * re-running it in-process would have the second arm inherit the first's state.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));

/* SKIPPED, not passed, and it says so: without a checkout the stub throws on
 * import, the mode pins to `off`, and both arms would measure the same thing
 * and agree. Silence here is what would make this suite lie. */
if (!process.env.SCHWUNG) {
    console.log('page-mode: SKIPPED (no param_pages; set SCHWUNG=/path/to/schwung)');
    process.exit(0);
}

function arm(mode) {
    const r = spawnSync(process.execPath, [join(__dir, 'app-loop.mjs')], {
        env: { ...process.env, MOVY_APP_LOOP_GRID: mode, MOVY_APP_LOOP_LABELS: '1' },
        encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    });
    const m = /APP-LOOP-FAILED-LABELS (\[.*\])/.exec(r.stdout || '');
    if (!m) {
        console.log(r.stdout || '');
        console.log(r.stderr || '');
        throw new Error(`page-mode: the ${mode} arm printed no label line (crash, or the emit moved after process.exit)`);
    }
    return JSON.parse(m[1]);
}

const expected = new Set(JSON.parse(readFileSync(join(__dir, 'page-mode-expected-fail.json'), 'utf8')).labels);
const offFailures  = arm('off');
const pageFailures = arm('page');

let bad = 0;

/* The `off` arm is the control. If it fails, nothing the `page` arm says means
 * anything — the difference would not be attributable to the mode. */
if (offFailures.length) {
    console.log(`  \x1b[31m✗\x1b[0m the off arm must be clean: ${JSON.stringify(offFailures)}`);
    bad++;
}

for (const label of pageFailures) {
    if (!expected.has(label)) {
        console.log(`  \x1b[31m✗\x1b[0m REGRESSION under page — not in the expected-fail list: ${label}`);
        bad++;
    }
}
for (const label of expected) {
    if (!pageFailures.includes(label)) {
        console.log(`  \x1b[32m✓\x1b[0m fixed under page: ${label}`);
        console.log(`  \x1b[31m✗\x1b[0m …so delete it from browser-test/page-mode-expected-fail.json`);
        bad++;
    }
}

console.log(`\npage-mode: ${pageFailures.length} of ${expected.size} expected failures remain`);
if (bad) { console.log(`\x1b[31m\x1b[1mPAGE-MODE LEDGER OUT OF DATE (${bad})\x1b[0m`); process.exit(1); }
console.log('\x1b[32m\x1b[1mPAGE-MODE LEDGER UP TO DATE\x1b[0m');
