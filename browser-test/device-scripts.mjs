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
 * test-all-device.sh judges each suite by exit status. test-seq.sh printed its
 * failures and exited 0, so the sweep reported "ALL DEVICE SUITES PASSED" over
 * a suite that had failed every check it ran.
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
 * a fixed sleep before it is worse: the master-FX suite (a TS scenario now)
 * assumed the boot was ~20 s out, wrote its empty-slot seed at t+6 s — after the
 * fresh shim had already restored the old module — and cleared the log over the
 * boot line its own guard reads. Every check it made then ran on a slot that was
 * never empty. Its `rebootWith` clears the log first and then waits on the
 * shim's own boot line, which is the shape to copy.
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
    if (f.endsWith('lib/restart-stack.sh')) continue;    // and this IS the restart
    src.split('\n').forEach((line, i) => {
        if (/^\s*#/.test(line)) return;                   // a comment may name it
        if (/restart-move\.sh/.test(line)) rawRestart.push(`${f}:${i + 1}`);
        if (/pidof\s+(shadow_ui|MoveOriginal)/.test(line)) rawRestart.push(`${f}:${i + 1}`);
    });
}
ok('no suite restarts the stack by hand', rawRestart.length === 0,
   rawRestart.length ? rawRestart.join(', ') : 'all go through ts_restart_stack');

ok('the shared lib defines ts_restart_stack', /^ts_restart_stack\(\)/m.test(libSrc));

/* ── Test 5b: a restart that restarts nothing, and a deploy that ships an ─────
 * engine nobody loads. Both were true at once on 2026-08-29, and together they
 * make a fix look dead: MoveOriginal runs as root, so restart-move.sh run as
 * the ableton user matches nothing with pkill and still exits 0; and the shim
 * dlopens dsp.so by path, so glibc keeps serving the library it already loaded
 * there. Two builds an hour apart, the newer verified on disk by md5, and the
 * running engine stayed the older one through two "successful" restarts.
 */
const restartSrc = readFileSync(join(SCRIPTS, 'lib/restart-stack.sh'), 'utf8');
ok('the restart runs as root', /ssh[^\n]*root@/.test(restartSrc),
   'as the ableton user pkill matches nothing and the stack stays up');
ok('a stack that never went down is reported as a failure',
   /NEVER WENT DOWN/.test(restartSrc) && /sys\.exit\(1\)/.test(restartSrc),
   'otherwise a 60-second wait prints as though it had restarted');
const tsBody = libSrc.split('ts_restart_stack()')[1].split('\n}')[0]
    .split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');   // a comment may name it
ok('ts_restart_stack keeps no second copy of it',
   /restart_move_stack/.test(tsBody) && !/pidof|restart-move\.sh/.test(tsBody),
   'it delegates to lib/restart-stack.sh');

const deploySrc = readFileSync(join(SCRIPTS, 'deploy.sh'), 'utf8');
ok('deploy restarts the stack when the engine binary changed',
   /md5sum/.test(deploySrc) && /restart_move_stack/.test(deploySrc),
   'a redeployed dsp.so is not the one running until MoveOriginal is gone');
ok('and says so loudly when it could not', /RESTART FAILED/.test(deploySrc),
   'a silent stale engine is what makes a real fix look broken');

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

/* ── Test 8: the phrases the fixture's instrument check keys on must be emittable ─
 * `config loaded for` sat in the smoke suite for months and in src/ for none of
 * them. plaits — the fixture's synth, and one that HAS a bundled movy config —
 * never matched it, fell through to the "no synth loaded" branch, and reported a
 * PASS. The suite's instrument check had stopped working, which is worse than a
 * failing check: the sweep printed green exactly where the fixture had failed
 * to reach the track's host, which is the one thing running the suites on two
 * hosts is meant to catch.
 *
 * That suite is `test-device/scenarios/smoke.ts` now, and it decides the same
 * question off the same two phrases — so the same static half is pinned here.
 * Rename either in src/ and the scenario's hierarchy check goes quietly green
 * having tested nothing, which nothing else would notice.
 *
 * Only the STATIC halves are pinned. Most movy log lines are composed at
 * runtime ('auto render held=' + n), so a blanket "every grepped phrase exists
 * in src" scan is dozens of false positives long and would not survive. These
 * two are whole literals in the source, and the scenario's verdict on whether
 * the fixture has an instrument turns on them. */
log('\nTest 8: the smoke scenario keys on phrases the source can actually emit');
{
    const srcFiles = [];
    const walk = (d) => {
        for (const f of readdirSync(d, { withFileTypes: true })) {
            if (f.isDirectory()) walk(join(d, f.name));
            else if (f.name.endsWith('.ts')) srcFiles.push(join(d, f.name));
        }
    };
    walk('src');
    const src = srcFiles.map((p) => readFileSync(p, 'utf8')).join('\n');
    const smoke = readFileSync('test-device/scenarios/smoke.ts', 'utf8');
    for (const phrase of ['loadHierarchy: config for ', 'loadHierarchy: chain_params ']) {
        ok(`src can emit ${JSON.stringify(phrase)}`, src.includes(phrase));
        ok(`smoke.ts looks for ${JSON.stringify(phrase.trim())}`, smoke.includes(phrase.trim()));
    }

    /* Same rule for the versions suite. Its verdict turns on two strings the
     * version index carries: the `adopted` entry the open writes, and the
     * `pre-restore` entry the restore writes (check 7 reads that index entry
     * now, where the bash grepped a log line). Rename either writer and the
     * scenario goes green having tested nothing. */
    const versionsTs = readFileSync('test-device/scenarios/versions.ts', 'utf8');
    ok('src can write a why of "adopted"', src.includes("'adopted'"));
    ok('versions.ts looks for the adopted entry', versionsTs.includes("'adopted'"));
    ok('src can write a why of "pre-restore"', src.includes("'pre-restore'"));
    ok('versions.ts looks for the pre-restore entry', versionsTs.includes("'pre-restore'"));
    /* And the branch that made the dead phrase harmless-looking: with a fixture
     * that guarantees a synth, an empty hierarchy window cannot be a pass, and
     * the failure has to name what was missing rather than shrug at it. */
    ok('an empty hierarchy window cannot pass', /hLines\.length > 0 &&/.test(smoke));
    ok('a missing instrument is named, not tolerated', /no instrument/.test(smoke));
}

/* ── Test 9: the movy half of the fixture is a fixed PARAMETER state ─────────
 * A schwung slot is restored from slot_<N>.json, module and every parameter
 * value together — "loading a module id alone leaves the slot's parameters
 * wherever the last test dragged them, which is not a fixed state"
 * (scripts/fixtures/README.md). A movy chain has exactly the same problem and
 * it is easier to miss: `set_chain_set` leaves a chain that already holds the
 * module alone, so only the FIRST run gets shipped defaults and every run after
 * inherits the previous suite's knob turns.
 *
 * fixture-ui-state.mjs is what closes that, by filling each component's blob
 * from the same slot file — so the two hosts cannot drift into testing
 * different sounds. This asserts the render actually produces one. */
log('\nTest 9: every movy chain component ships the fixture\'s parameter values');
{
    const rendered = JSON.parse(
        execFileSync('node', ['scripts/fixture-ui-state.mjs', 'scripts/fixtures/device-set'],
                     { encoding: 'utf8' }));
    const comps = (rendered.chains ?? []).flatMap((t) => (t.comp ?? []).map((c) => [t.t, c]));
    ok('the fixture declares at least one movy chain', comps.length > 0);
    for (const [t, c] of comps) {
        const slot = JSON.parse(
            readFileSync(`scripts/fixtures/device-set/slot_${t}.json`, 'utf8'));
        ok(`track ${t} ${c.c} carries a preset blob`, typeof c.s === 'string' && c.s.length > 0);
        ok(`track ${t} ${c.c} is the same module both hosts declare`,
           slot?.chain?.[c.c]?.module === c.m,
           `slot file says ${slot?.chain?.[c.c]?.module}, chains say ${c.m}`);
        ok(`track ${t} ${c.c} blob is the slot file's own state`,
           c.s === JSON.stringify(slot?.chain?.[c.c]?.config?.state));
    }
}

/* ── Test 10: clearing a version store is done with root ─────────────────────
 * Movy's saves go through the host, which runs as ROOT, so the version store it
 * writes (sets/<uuid>/v/<n>/) is root-owned DIRECTORIES. `ableton` cannot unlink
 * inside them, so an ableton-only clear fails. test-versions.sh shipped that way
 * and could only ever pass on a device where movy had never written a version:
 * green once, dead on every run after. It is the versions scenario now, and the
 * hazard moved with it — the seed step must fall back to root ssh, and must
 * unlink the state files before scp'ing over them (scp opens the destination for
 * writing and is refused on a root-owned file).
 */
log('\nTest 10: the versions scenario can reach the root-owned tree');

ok('the shared lib defines ts_ssh_root', /^ts_ssh_root\(\)/m.test(libSrc),
   'without it a suite has no way to remove what movy wrote as root');

const versionsTs = readFileSync('test-device/scenarios/versions.ts', 'utf8');
ok('the scenario clears the version store', /rm -rf/.test(versionsTs) && /v'/.test(versionsTs),
   'if it does not, the check below is vacuous');
ok('and falls back to root ssh for it', /sshRoot/.test(versionsTs),
   'an ableton-only clear dies on a root-owned tree');
ok('and unlinks the state files before seeding over them',
   /seq-state\.json'/.test(versionsTs) && /ui-state\.json'/.test(versionsTs),
   'scp over a root-owned file is refused');

/* ── Test 11: the release routine keeps its announcement step ────────────────
 * The announcement is only "part of the release" while the build gate refuses a
 * tarball without the file and the announcer refuses to call it live before the
 * store is actually serving that version. Announcing on the tag instead would
 * tell people to update to something the store may not offer yet.
 */
log('\nTest 11: the release routine still gates on the announcement');

const buildSrc = readFileSync('scripts/build-module.sh', 'utf8');
ok('build-module.sh requires docs/discord-v$MOD_VER.md',
   /docs\/discord-v\$MOD_VER\.md/.test(buildSrc) && /exit 1/.test(buildSrc),
   'without it a release can ship with no announcement written');
ok('and enforces Discord\'s 2000-character cap', /2000/.test(buildSrc));

const annSrc = readFileSync('scripts/announce-release.mjs', 'utf8');
ok('the announcer checks the asset really downloads',
   /method:\s*'HEAD'/.test(annSrc),
   'a tagged release whose upload failed must not be announced');

/* Posting is manual because the channel is not ours to hold a credential for.
 * If that ever changes the send belongs here behind an explicit flag — but it
 * must not arrive by accident, and a credential in a committed file is the one
 * mistake that editing cannot undo once pushed. */
ok('and sends nothing itself', !/discord\.com\/api/.test(annSrc),
   'posting is manual; a send path would need a credential and a real test');
const leaked = /discord\.com\/api\/webhooks\/\d+\/[\w-]{20,}/.test(annSrc)
            || /\b[MN][\w-]{23}\.[\w-]{6}\.[\w-]{27}\b/.test(annSrc);
ok('and carries no credential', !leaked, 'a webhook URL or bot token is in the file');

/* ── Test 12: the device address reaches the node helpers ────────────────────
 * The suites take the device as $1 and use it for ssh and scp. The node helpers
 * they call take it from `process.env.HOST` instead, defaulting to move.local.
 * A plain shell assignment satisfies the first and not the second, so a run
 * against an IP drove ssh at the right device and every WebSocket read at a
 * name that did not resolve: `ts_verify` returned nothing, the fixture reported
 * "no answer reading the chain", and every suite in the sweep spent six 24 s
 * load attempts before saying so. It reads as a device fault and is a quoting
 * bug.
 */
log('\nTest 12: the device address reaches the node helpers');

const envHostHelpers = readdirSync(SCRIPTS)
    .filter(f => f.endsWith('.mjs'))
    .filter(f => /process\.env\.HOST/.test(readFileSync(join(SCRIPTS, f), 'utf8')));
ok('node helpers do read HOST from the environment', envHostHelpers.length > 0,
   `${envHostHelpers.length} helper(s) — if this is 0 the checks below are vacuous`);

ok('the shared lib exports HOST', /^export HOST\b/m.test(libSrc),
   'every suite sources this file, so one export covers them all');

/* Any other script that calls one of those helpers has to supply HOST itself:
 * sourcing the lib is what exports it, and a script that skips the lib gets
 * nothing. A lib is not a runnable script — it inherits whatever sourced it, so
 * it passes when every one of its sourcers does. */
const helperCall = new RegExp(`node\\s+\\S*scripts/(${envHostHelpers.join('|').replace(/\./g, '\\.')})`);
const srcOf = new Map(shFiles.map(f => [f, readFileSync(f, 'utf8')]));
const supplies = f => /source .*lib\/test-set\.sh/.test(srcOf.get(f)) || /^export HOST\b/m.test(srcOf.get(f));
const unexported = shFiles.filter((f) => {
    if (!helperCall.test(srcOf.get(f))) return false;
    if (supplies(f)) return false;
    if (!f.includes('/lib/')) return true;
    const base = f.split('/').pop();
    const sourcers = shFiles.filter(o => o !== f && srcOf.get(o).includes(base));
    return !sourcers.every(supplies);
});
ok('every script calling one passes it the address', unexported.length === 0,
   unexported.length ? unexported.join(', ') : `${shFiles.length} scripts checked`);

/* ── Test 13: test-migrate.sh keys on phrases the source can actually emit ───
 * migrate.ts composes its log lines from pieces at runtime ('mig: ' +
 * (forceOverwrite ? 'manual — ' : '') + 'migrated ' + n + ' track(s)'), the
 * same reason Test 8 above only pins two whole literals rather than scanning
 * every log line in the codebase — a mid-string check is what survives that,
 * checking the PIECES the shell script's grep depends on actually exist. */
log('\nTest 13: test-migrate.sh keys on phrases the source can actually emit');
{
    const migrateSrc = readFileSync('src/track/migrate.ts', 'utf8');
    const migrateSh = readFileSync('scripts/test-migrate.sh', 'utf8');
    for (const piece of ["'mig: '", "'migrated '", "'manual — '", "'mig: nothing to migrate'"]) {
        ok(`src can emit ${piece}`, migrateSrc.includes(piece));
    }
    for (const phrase of ['mig: migrated', 'mig: nothing to migrate', 'mig: manual']) {
        ok(`test-migrate.sh looks for ${JSON.stringify(phrase)}`, migrateSh.includes(phrase));
    }
    /* The contract canary's own claim: it asks the device for slot:volume,
     * the one key that round-trips over the remote-UI subscribe channel
     * (verified on device — see scripts/slot-param.mjs). synth:state does not
     * broadcast there at all; test-migrate.sh's positive arm is its canary
     * instead, since a renamed synth:state fails distinctly there (a migrated
     * chain with no preset blob). */
    const slotReadSrc = readFileSync('src/track/slot-read.ts', 'utf8');
    ok('slot-read.ts reads a component\'s :state blob', slotReadSrc.includes("c + ':state'"));
    ok('slot-read.ts reads slot:volume', slotReadSrc.includes('SLOT_VOLUME_KEY')
       && slotReadSrc.includes("'slot:volume'"));
    ok('the canary asks for "slot:volume"', migrateSh.includes('"slot:volume"'));
    ok('the positive arm checks the migrated blob, covering synth:state',
       migrateSh.includes('factory defaults'));
}

/* ── Summary ─────────────────────────────────────────────────────────────── */

log('');
if (failures === 0) {
    log('\x1b[32m\x1b[1mALL DEVICE-SCRIPT CHECKS PASSED\x1b[0m');
    process.exit(0);
} else {
    log(`\x1b[31m\x1b[1m${failures} DEVICE-SCRIPT CHECK(S) FAILED\x1b[0m`);
    process.exit(1);
}
