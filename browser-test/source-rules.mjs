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
log('\nRule 1: only src/host/param.ts talks to the param globals');

const GLOBALS = /\b(host_module_set_param|host_module_set_param_blocking|host_module_get_param|shadow_get_params|shadow_set_params)\b/;

const ALLOWED = new Set([
    /* The door itself. */
    'src/host/param.ts',
    /* Ambient declarations, not calls. */
    'src/types/schwung.d.ts',
    /* Wraps the globals to TIME them. It has to reach the real functions: a
     * probe that measured the wrapper would measure itself. */
    'src/app/perf-probe.ts',
]);

const offenders = [];
for (const f of walk(SRC)) {
    const rel = relative('.', f);
    if (ALLOWED.has(rel)) continue;
    const code = stripComments(readFileSync(f, 'utf8'));
    if (GLOBALS.test(code)) offenders.push(rel);
}
ok('no module outside the door calls the param globals', offenders.length === 0,
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
    /* The behaviour under test is defined in milliseconds in movy's own model
     * (HOLD_MS), and the checks assert an ABSENCE across that window. A frame
     * budget would re-express the deadline in a unit the feature does not use. */
    ['test-device/scenarios/jog-hint.ts', 'the hold delay under test IS a wall clock'],
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

console.log(fails === 0
    ? '\n\x1b[32m\x1b[1mALL SOURCE RULES PASSED\x1b[0m'
    : `\n\x1b[31m\x1b[1m${fails} SOURCE RULE(S) FAILED\x1b[0m`);
process.exit(fails === 0 ? 0 : 1);
