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

/* SKIPPED, not passed, and it says so. The guard asks the BUILT ARTEFACT, not
 * the variable, because `SCHWUNG` is a BUILD-time alias (`build/browser.mjs`):
 * it selects between the real `param_pages` and a stub that throws on import.
 * With the stub, `schwungLibAvailable()` is false, the mode pins to `off`, and
 * both arms measure the same thing and agree — and that is worse than a skip,
 * because a `page` arm that never ran reports every listed label as ✓ fixed,
 * which instructs a maintainer to DELETE labels that are still failing. An
 * environment variable set NOW is not evidence the build saw one: unset it for
 * a single `node build/browser.mjs` — which `npm run build:browser` does — and
 * this whole file lies. Silence here is what would make this suite lie. */
let libUp = false;
try {
    ({ schwungLibAvailable: libUp } = await import('../dist/esm/renderer/schwung-lib.js'));
    libUp = libUp();
} catch { /* dist/esm missing — same answer: the build never saw a checkout */ }
if (!libUp) {
    console.log('page-mode: SKIPPED (param_pages is not in dist/esm)');
    console.log('page-mode:   rebuild with: SCHWUNG=/path/to/schwung node build/browser.mjs');
    if (process.env.SCHWUNG) {
        console.log('page-mode:   SCHWUNG is set now but was not when dist/esm was built —');
        console.log('page-mode:   a build-time alias cannot be satisfied at run time.');
    }
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
