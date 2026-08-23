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

/* ── Test 5: "the stack is back" must mean a NEW stack ────────────────────────
 * restart-move.sh detaches and sleeps ~1 s before it kills anything, so for the
 * first seconds `pidof MoveOriginal` still answers with the doomed process. A
 * suite that waits that way proceeds against a stack that is about to die, and
 * a fixed sleep before it is worse: test-master-fx.sh assumed the boot was ~20 s
 * out, wrote its empty-slot seed at t+6 s — after the fresh shim had already
 * restored the old module — and cleared the log over the boot line its own guard
 * reads. Every check it made then ran on a slot that was never empty.
 */
log('\nTest 5: a restart is waited for by pid change, not by pidof');

/* Its own runner, not bashStatus: the simulation backgrounds processes, and
 * they would hold the captured stdout open (and leave the 2 MB stdin fixture
 * unread) for as long as they live. */
function bashRun(body) {
    try {
        return execFileSync('bash', ['-c', body], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    } catch (e) { return `threw rc=${e.status}`; }
}

const timing = bashRun(`
tmp=$(mktemp -d)
sleep 5 >/dev/null 2>&1 & old=$!
# restart-move.sh's shape: detach, sleep, THEN kill and start the replacement.
( sleep 0.4; kill $old 2>/dev/null; sleep 5 >/dev/null 2>&1 & echo $! > "$tmp/new" ) >/dev/null 2>&1 &
# The old wait, asked the instant the restart is triggered.
kill -0 $old 2>/dev/null && echo BARE-WAIT-SAW-THE-DOOMED-PROCESS
# The fixed wait: block until the pid actually changes.
for _ in $(seq 1 100); do [ -s "$tmp/new" ] && break; sleep 0.05; done
new=$(cat "$tmp/new" 2>/dev/null || true)
[ -n "$new" ] && [ "$new" != "$old" ] && echo PID-CHANGE-WAIT-SAW-A-NEW-STACK
kill $new 2>/dev/null; rm -rf "$tmp"
exit 0
`);
ok('the bare wait really does return on the old process',
   /BARE-WAIT-SAW-THE-DOOMED-PROCESS/.test(timing), timing.replace(/\n/g, ' | '));
ok('waiting for the pid to change waits for the real thing',
   /PID-CHANGE-WAIT-SAW-A-NEW-STACK/.test(timing), timing.replace(/\n/g, ' | '));

const rawRestart = [];
for (const f of shFiles) {
    const src = readFileSync(f, 'utf8');
    if (f.endsWith('lib/test-set.sh')) continue;          // ts_restart_stack lives here
    src.split('\n').forEach((line, i) => {
        if (/^\s*#/.test(line)) return;                   // a comment may name it
        if (/restart-move\.sh/.test(line)) rawRestart.push(`${f}:${i + 1}`);
        if (/pidof\s+(shadow_ui|MoveOriginal)/.test(line)) rawRestart.push(`${f}:${i + 1}`);
    });
}
ok('no suite restarts the stack by hand', rawRestart.length === 0,
   rawRestart.length ? rawRestart.join(', ') : 'all go through ts_restart_stack');

ok('the shared lib defines ts_restart_stack', /^ts_restart_stack\(\)/m.test(libSrc));

/* ── Test 6: a benchmark whose engine writes go nowhere must not report ───────
 * `ep` writes a movy engine param over the WebSocket on port 7700 and discards
 * both streams, so a lost write is indistinguishable from one that changed
 * nothing. A whole parallel-render sweep once ran to a printed conclusion —
 * chains "loaded", a chord "held", every arm sampled — with all 200 writes
 * dropped, because the host argument was an ssh-config alias that resolves for
 * ssh and not for the socket. It read as "the build is not deployed".
 */
log('\nTest 6: a benchmark checks that its engine writes arrive');

const benchSrc = readFileSync('scripts/lib/chain-bench.sh', 'utf8');
ok('ep counts its failures instead of discarding them',
   /EP_FAILS=\$\(\(EP_FAILS \+ 1\)\)/.test(benchSrc),
   'a write that never arrived is not a write that changed nothing');
ok('the shared lib defines cb_require_engine_link',
   /^cb_require_engine_link\(\)/m.test(benchSrc));

const unchecked = [];
for (const f of shFiles) {
    const src = readFileSync(f, 'utf8');
    if (f.endsWith('lib/chain-bench.sh')) continue;        // defines it
    if (!/source .*lib\/chain-bench\.sh/.test(src)) continue;
    if (!/cb_require_engine_link/.test(src)) unchecked.push(f);
}
ok('every benchmark that drives the engine proves the link first',
   unchecked.length === 0,
   unchecked.length ? unchecked.join(', ') : 'all probe before they measure');

/* ── Test 7: the equivalence oracle's scoring ────────────────────────────────
 * measure-render-equivalence.sh compares three digest arms and prints a verdict.
 * It is the one step of that run where being wrong is SILENT: every other step
 * either yields a number or fails loudly, but a scoring bug here prints a
 * confident green PASS over a set that was never actually compared. The two
 * ways that happens are counting silent chains (silence hashes identically no
 * matter which lane rendered it) and counting chains that do not even repeat
 * themselves serially.
 */
log('\nTest 7: three digest arms are scored into the right verdict');

/** The real scorer over synthetic arms →
 *  "<pass> <fail> <silent> <unstable> <exposed> <raced>".
 *  `plan` is chrenderlog's `<lane0>|<lane1>|...`; it defaults to putting every
 *  chain on a helper so the cases that are not about lanes stay readable.
 *  `mods` defaults to all-DISTINCT module names — with every chain sharing one
 *  name every pair would count as a duplicate and `raced` would be noise in
 *  cases that are not about duplicates at all. */
function score(a, b, a2, n, plan = null, mods = null) {
    const out = execFileSync('awk', [
        '-v', `a=${a}`, '-v', `b=${b}`, '-v', `a2=${a2}`, '-v', `n=${n}`,
        '-v', `plan=${plan ?? '|' + [...Array(n).keys()].join(',')}`,
        '-v', `mods=${mods ?? [...Array(n).keys()].map(i => 'm' + i).join(' ')}`,
        '-v', 'G=', '-v', 'R=', '-v', 'Y=', '-v', 'Z=',
        '-f', 'scripts/lib/digest-verdict.awk',
    ], { encoding: 'utf8' });
    return out.split('\n').find(l => l.startsWith('SUMMARY')).slice(8);
}

// Two chains, both sounding, both stable, parallel agrees.
ok('identical arms score as evidence that passed',
   score('aaaa/9,bbbb/9', 'aaaa/9,bbbb/9', 'aaaa/9,bbbb/9', 2) === '2 0 0 0 2 0');

// The finding the whole run exists to produce.
ok('a parallel arm that differs is a FAIL, not a rounding note',
   score('aaaa/9,bbbb/9', 'aaaa/9,cccc/9', 'aaaa/9,bbbb/9', 2) === '1 1 0 0 1 0');

// The dangerous false pass: nothing sounded, so every digest matches.
ok('silent chains are coverage, never agreement',
   score('0000/0,0000/0', '0000/0,0000/0', '0000/0,0000/0', 2) === '0 0 2 0 0 0');

// The other false pass: a chain that cannot even reproduce itself serially
// says nothing about threading, whichever way the parallel arm lands.
ok('a chain that fails its own serial control is excluded, not failed',
   score('aaaa/9,bbbb/9', 'aaaa/9,zzzz/9', 'aaaa/9,dddd/9', 2) === '1 0 0 1 1 0');
ok('and excluded even when the parallel arm happens to match arm A',
   score('bbbb/9', 'bbbb/9', 'dddd/9', 1) === '0 0 0 1 0 0');

/* The third false pass, and the subtlest. Lane 0 IS the audio thread: a chain
 * the planner put there renders on the same thread in both arms, so it matches
 * for the same reason serial matches serial. Same-module chains are pinned to
 * one lane, so a whole set landing on lane 0 is a plan the planner can really
 * produce — and it would print a green PASS having tested nothing. */
ok('a pass on lane 0 is not counted as concurrency being exercised',
   score('aaaa/9,bbbb/9', 'aaaa/9,bbbb/9', 'aaaa/9,bbbb/9', 2, '0,1') === '2 0 0 0 0 0');
ok('and a pass on a helper lane is',
   score('aaaa/9,bbbb/9', 'aaaa/9,bbbb/9', 'aaaa/9,bbbb/9', 2, '0|1') === '2 0 0 0 1 0');

/* The fourth false pass, and the one PIN=0 exists to close. Pinning keeps two
 * instances of one module on one lane, so the race it prevents never happens
 * and a green run says nothing about it. `raced` counts only chains that had a
 * sibling of the SAME module on ANOTHER lane, which is what makes an unpinned
 * run distinguishable from a pinned one that happened to spread. */
ok('two instances of one module on two lanes count as having raced',
   score('aaaa/9,bbbb/9', 'aaaa/9,bbbb/9', 'aaaa/9,bbbb/9', 2, '0|1', 'obxd obxd')
   === '2 0 0 0 1 2');
ok('the same two pinned to one lane did not, however green they print',
   score('aaaa/9,bbbb/9', 'aaaa/9,bbbb/9', 'aaaa/9,bbbb/9', 2, '|0,1', 'obxd obxd')
   === '2 0 0 0 2 0');

const eqSrc = readFileSync('scripts/measure-render-equivalence.sh', 'utf8');
ok('a run where nothing was comparable exits non-zero',
   /INCONCLUSIVE/.test(eqSrc) && /PASS" -eq 0/.test(eqSrc),
   'zero differences out of zero comparisons is not equivalence');
ok('an unpinned run that raced nothing exits non-zero too',
   /PIN" = "0" \] && \[ "\$RACED" -eq 0/.test(eqSrc),
   'PIN=0 asks about duplicates; zero races cannot answer it');

/* ── Summary ─────────────────────────────────────────────────────────────── */

log('');
if (failures === 0) {
    log('\x1b[32m\x1b[1mALL DEVICE-SCRIPT CHECKS PASSED\x1b[0m');
    process.exit(0);
} else {
    log(`\x1b[31m\x1b[1m${failures} DEVICE-SCRIPT CHECK(S) FAILED\x1b[0m`);
    process.exit(1);
}
