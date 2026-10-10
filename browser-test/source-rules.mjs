#!/usr/bin/env node
/* browser-test/source-rules.mjs — rules about the SHAPE of src/, not its
 * behaviour. A rule here exists because the thing it forbids was done, cost
 * something, and would be done again by the next person who did not know.
 *
 * Run from movy root: node browser-test/source-rules.mjs
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = 'src';
let fails = 0;
const log = (s) => console.log(s);
const ok = (label, cond, detail = '') => {
    if (cond) console.log(`  \x1b[32m✓\x1b[0m ${label}${detail ? '  (' + detail + ')' : ''}`);
    else { console.log(`  \x1b[31m✗\x1b[0m ${label}${detail ? '  ' + detail : ''}`); fails++; }
};

function walk(dir, acc = []) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p, acc);
        else if (e.name.endsWith('.ts')) acc.push(p);
    }
    return acc;
}

/* Comments are allowed to name anything — most of what src/ knows about this
 * channel is written down in them, and a rule that forbade the words would push
 * that knowledge out of the code. So the scan is over CODE. */
function stripComments(src) {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

/* ── Rule 1: the param channel has ONE door ──────────────────────────────────
 *
 * `overtake_dsp`'s param SHM is a single slot shared with every other writer on
 * the device, and its rules are not obvious: writes must block, a blocking
 * write REFUSES under contention and says so by returning false, a bulk read
 * can come back short and must not be read as a page of empty values.
 *
 * Every one of those was learned on device, and each was then re-implemented,
 * slightly differently, by whoever needed the channel next — two track ports
 * carried verbatim copies of it, and `seq/engine.ts` threw the refusal away
 * entirely, which silently dropped sequencer commands until 2026-09-13.
 *
 * So: `src/host/param.ts` owns the rules and counts what the slot refuses, and
 * nothing else touches the globals. The count is the other half of the point —
 * a dropped write is otherwise perfectly silent, and a test run that never sees
 * one cannot tell a healthy channel from a lucky one.
 */
log('\nRule 1: only src/host/param.ts talks to the engine param channel');

/* The channel's host half is the platform's engine calls (Rule 3 keeps the raw
 * globals inside src/platform/), so the door is the only caller of those. */
const GLOBALS = /\bplatform\.engine(Available|Get|Set|SetBlocking|GetBulk|SetBulk)\b/;

const ALLOWED = new Set([
    /* The door itself. */
    'src/host/param.ts',
]);

const offenders = [];
for (const f of walk(SRC)) {
    const rel = relative('.', f);
    if (ALLOWED.has(rel)) continue;
    const code = stripComments(readFileSync(f, 'utf8'));
    if (GLOBALS.test(code)) offenders.push(rel);
}
ok('no module outside the door calls the engine param channel', offenders.length === 0,
   offenders.length
       ? `${offenders.join(', ')} — go through src/host/param.ts (paramGet/paramSet/paramGetMany/paramSetMany)`
       : `${ALLOWED.size} allowed, everything else clean`);

/* The door is only a door if it is actually counting. A refusal that is not
 * recorded is the state this rule exists to prevent, so the counter is checked
 * to exist rather than assumed. */
const door = readFileSync('src/host/param.ts', 'utf8');
ok('and the door counts what the slot refuses',
   /refused\+\+/.test(door) && /export function paramStats/.test(door));


/* ── Rule 2: the device tier waits on the device, never on a clock ───────────
 *
 * Move's tick rate swings between 63 and 205 Hz with load, so a fixed sleep is
 * a bet on how busy the device happens to be. Every one of those bets is a
 * flake waiting for a slow run, and the bash tier this harness replaced was
 * mostly made of them — ~25 s of `sleep` in the automation suite alone.
 *
 * `wait.ts` exists so a wait is a quantity of DEVICE WORK: `until` spends
 * frames and fails with the value it was still seeing, which a sleep can never
 * do. The rule is a ratchet — the sleeps that are left are named here, with the
 * reason each one cannot be a frame budget.
 */
log('\nRule 2: no new fixed sleeps in test-device/');

const SLEEP = /(^|[^.\w])setTimeout\s*\(/;

const SLEEP_ALLOWED = new Map([
    /* Polls for a device server's port to open. The frame clock is served BY
     * that server, so there is no frame to wait on until it answers. */
    ['test-device/daemon.ts', 'waits for the frame clock itself to come up'],
    /* movy-host IS the standalone frame clock: while it is down (its launch,
     * its exit, Move's return between the two) there is no frame to count. */
    ['test-device/transport-standalone.ts', 'waits across the frame clock being down'],
]);

const sleepers = [];
for (const f of walk('test-device').filter((p) => !/\/(dist|selftest|device-agent)\//.test(p))) {
    const rel = relative('.', f);
    if (SLEEP_ALLOWED.has(rel)) continue;
    if (SLEEP.test(stripComments(readFileSync(f, 'utf8')))) sleepers.push(rel);
}
ok('scenarios wait on frames, not on setTimeout', sleepers.length === 0,
   sleepers.length
       ? `${sleepers.join(', ')} — use until()/frames() from test-device/wait.ts`
       : `${SLEEP_ALLOWED.size} named exceptions, everything else clean`);

/* An allowlist is only a ratchet while its entries are real. A stale one is an
 * exemption nobody asked for, sitting open for the next sleep. */
const staleExemptions = [...SLEEP_ALLOWED.keys()]
    .filter((f) => !SLEEP.test(stripComments(readFileSync(f, 'utf8'))));
ok('and the named exceptions still need to be exceptions', staleExemptions.length === 0,
   staleExemptions.length ? `${staleExemptions.join(', ')} no longer sleeps — drop it from the list` : '');


/* ── Rule 3: the host is reached through src/platform/ only ─────────────────
 *
 * movy is moving from overtaking Move (schwung's shadow_ui hosts ui.js) to a
 * standalone host of its own, and the SAME ui.js runs on both until the switch
 * (plans/2026-10-09-standalone-migration.md, WP1). That only stays one file
 * per host if no other module names a host global: one stray `shadow_*` call
 * is a feature that silently does nothing — or throws — on the other host.
 *
 * A name after `/` is a path into schwung's tree (`shadow_ui_slot_grid.mjs`),
 * not a call, so it is skipped. Comments are free to name anything, as above.
 */
log('\nRule 3: host globals are named only in src/platform/');

const HOST_GLOBAL = /(?<![\w/$])(shadow_|host_|move_midi_)[A-Za-z0-9_]+/g;

const hostOffenders = [];
for (const f of walk(SRC)) {
    const rel = relative('.', f);
    if (rel.startsWith('src/platform/')) continue;
    const hits = stripComments(readFileSync(f, 'utf8')).match(HOST_GLOBAL);
    if (hits) hostOffenders.push(`${rel} (${[...new Set(hits)].join(', ')})`);
}
ok('no module outside src/platform/ names a host global', hostOffenders.length === 0,
   hostOffenders.length
       ? `${hostOffenders.join('; ')} — add it to the Platform interface (src/platform/platform.ts)`
       : 'everything outside src/platform/ is clean');

console.log(fails === 0
    ? '\n\x1b[32m\x1b[1mALL SOURCE RULES PASSED\x1b[0m'
    : `\n\x1b[31m\x1b[1m${fails} SOURCE RULE(S) FAILED\x1b[0m`);
process.exit(fails === 0 ? 0 : 1);
