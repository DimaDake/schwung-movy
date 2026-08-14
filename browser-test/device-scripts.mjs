#!/usr/bin/env node
/* browser-test/device-scripts.mjs — invariants on the device-test shell scripts.
 *
 * The device suites assert by grepping a captured debug log. Those assertions
 * are themselves code, and they can be wrong in a way that is worse than a bug:
 * a check that reports "missing" for a line that is present sends you hunting a
 * device fault that does not exist. This suite pins the one idiom that did.
 *
 * Run from movy root: node browser-test/device-scripts.mjs
 */

import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

let failures = 0;
const log = (...a) => console.log(...a);
function ok(name, cond, detail = '') {
    if (cond) log(`  \x1b[32m✓\x1b[0m ${name}${detail ? `  (${detail})` : ''}`);
    else { log(`  \x1b[31m✗\x1b[0m ${name}${detail ? `  (${detail})` : ''}`); failures++; }
}

const SCRIPTS = 'scripts';
const shFiles = [
    ...readdirSync(SCRIPTS).filter(f => f.endsWith('.sh')).map(f => join(SCRIPTS, f)),
    ...readdirSync(join(SCRIPTS, 'lib')).filter(f => f.endsWith('.sh')).map(f => join(SCRIPTS, 'lib', f)),
];

/* ── Test 1: the hazard is real ──────────────────────────────────────────────
 * `grep -q` exits at its first match. Under `set -o pipefail` that kills the
 * writer with EPIPE and the pipeline reports 141 — a *found* line read as a
 * failed check. It only bites once the log outgrows the pipe buffer, which is
 * why it surfaced as five phantom device failures rather than as an outage.
 */
log('\nTest 1: grep -q under pipefail loses a match in a large stream');

const BIG = 'MARKER-AT-THE-TOP\n' + 'filler line to push past the pipe buffer\n'.repeat(50000);

function bashStatus(body) {
    try {
        const out = execFileSync('bash', ['-c', `set -euo pipefail\n${body}\necho "rc=$?"`], {
            input: BIG, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
        });
        return out.trim();
    } catch (e) {
        return `threw rc=${e.status}`;
    }
}

// LOG is fed on stdin so the payload never lands in an argv limit.
const hazard = bashStatus('LOG=$(cat); echo "$LOG" | grep -q "MARKER-AT-THE-TOP" && echo found || echo MISSED');
ok('the old idiom really does lose the match', /MISSED|threw/.test(hazard),
   `bash said: ${hazard.replace(/\n/g, ' | ')}`);

/* ── Test 2: qgrep survives it ───────────────────────────────────────────── */
log('\nTest 2: qgrep reports the same match as found');

const lib = 'scripts/lib/test-set.sh';
const fixed = bashStatus(
    // Pull just the helper out of the lib: sourcing it whole needs HOST/MOVY_DIR.
    `qgrep() { grep "$@" >/dev/null; }\n` +
    'LOG=$(cat); echo "$LOG" | qgrep "MARKER-AT-THE-TOP" && echo found || echo MISSED');
ok('the drop-in reads the whole stream and finds it', /found/.test(fixed),
   `bash said: ${fixed.replace(/\n/g, ' | ')}`);

const libSrc = readFileSync(lib, 'utf8');
ok('the shared lib actually defines qgrep', /^qgrep\(\)/m.test(libSrc));

/* ── Test 3: no script reintroduces the idiom ────────────────────────────── */
log('\nTest 3: no device script pipes into grep -q');

const offenders = [];
for (const f of shFiles) {
    const src = readFileSync(f, 'utf8');
    src.split('\n').forEach((line, i) => {
        // A pipeline inside an ssh command runs on the device, where qgrep does
        // not exist — and is safe there: no pipefail, and the writers are small.
        if (/\bssh\b|\bts_ssh\b/.test(line)) return;
        if (/\|\s*grep\s+-[a-zA-Z]*q/.test(line)) offenders.push(`${f}:${i + 1}`);
    });
}
ok('every local log assertion uses qgrep', offenders.length === 0,
   offenders.length ? offenders.join(', ') : `${shFiles.length} scripts clean`);

/* ── Test 3b: a failing suite must say so in its exit code ────────────────────
 * test-all-device.sh judges each suite by exit status. test.sh and test-seq.sh
 * printed their failures and exited 0, so the sweep reported "ALL DEVICE SUITES
 * PASSED" over a suite that had failed every check it ran.
 */
log('\nTest 3b: every device suite exits non-zero when it fails');

const noExit = [];
for (const f of shFiles) {
    const lines = readFileSync(f, 'utf8').split('\n');
    lines.forEach((line, i) => {
        // The summary line a suite prints when it has failures. An `exit 1`
        // anywhere else in the file (a fixture that could not be established,
        // say) does not make THIS branch propagate — which is exactly how the
        // gap survived, so the search is scoped to the branch.
        if (!/echo.*(CHECK\(S\) FAILED|CHECKS? FAILED|FAILED: )/.test(line)) return;
        const branch = lines.slice(i, i + 6).join('\n').split(/^\s*fi\b/m)[0];
        if (!/exit 1/.test(branch)) noExit.push(`${f}:${i + 1}`);
    });
}
ok('a failure branch always ends in exit 1', noExit.length === 0,
   noExit.length ? noExit.join(', ') : 'all suites propagate failure');

/* ── Test 4: every script that uses qgrep can see it ─────────────────────── */
log('\nTest 4: qgrep users source the lib that defines it');

const missingSource = [];
for (const f of shFiles) {
    const src = readFileSync(f, 'utf8');
    if (!/\bqgrep\b/.test(src)) continue;
    if (f.endsWith('lib/test-set.sh')) continue;          // defines it
    if (!/source .*lib\/test-set\.sh/.test(src)) missingSource.push(f);
}
ok('no script calls qgrep without sourcing test-set.sh', missingSource.length === 0,
   missingSource.length ? missingSource.join(', ') : 'all sourced');

/* ── Summary ─────────────────────────────────────────────────────────────── */

log('');
if (failures === 0) {
    log('\x1b[32m\x1b[1mALL DEVICE-SCRIPT CHECKS PASSED\x1b[0m');
    process.exit(0);
} else {
    log(`\x1b[31m\x1b[1m${failures} DEVICE-SCRIPT CHECK(S) FAILED\x1b[0m`);
    process.exit(1);
}
