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

console.log(fails === 0
    ? '\n\x1b[32m\x1b[1mALL SOURCE RULES PASSED\x1b[0m'
    : `\n\x1b[31m\x1b[1m${fails} SOURCE RULE(S) FAILED\x1b[0m`);
process.exit(fails === 0 ? 0 : 1);
