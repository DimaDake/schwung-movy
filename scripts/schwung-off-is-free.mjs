#!/usr/bin/env node
/*
 * schwung-off-is-free.mjs — an ordinary movy build must not pay for the
 * experiment.
 *
 * The experiment is gated by a build-time define, which was assumed to make a
 * flag-off build "byte-identical to stock movy". It never was. esbuild keeps an
 * EXTERNAL import even when every binding it provides is unreachable, so a
 * flag-off ui.js still carried
 *
 *     import { renderPageMovy, BAND_H } from
 *       ".../shared/param_pages/render_page_movy.mjs"
 *
 * at the top level — 13.5 KB of dead widget code, and a hard runtime dependency
 * on a Schwung new enough to ship that file. On a device whose Schwung predates
 * it, that import fails at load and movy does not start AT ALL, with the flag
 * off. The off switch has to be free or it is not an off switch.
 *
 * This asserts the two things that make it free:
 *   1. no param_pages import survives in a flag-off bundle
 *   2. and the Schwung layer's code does not either
 * plus the converse, so a build that quietly stopped emitting the grid could
 * not pass by shipping nothing at all.
 */
import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const UI   = resolve(root, 'ui.js');

let failed = 0;
const check = (name, cond, detail) => {
    if (cond) { console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
    else { console.log(`  \x1b[31m✗\x1b[0m ${name}\n      ${detail}`); failed++; }
};

function build(gridMode) {
    execFileSync(process.execPath, [resolve(root, 'build/device.mjs')], {
        cwd: root, stdio: 'pipe',
        env: { ...process.env, MOVY_SCHWUNG_GRID: gridMode },
    });
    return readFileSync(UI, 'utf8');
}

/* Preserve whatever ui.js the working tree had — this script rebuilds it twice
 * and would otherwise leave the last variant lying there for a later deploy to
 * pick up. */
const saved = existsSync(UI) ? readFileSync(UI, 'utf8') : null;

console.log('schwung-off-is-free: an ordinary build must not pay for the experiment\n');

const off  = build('off');
const page = build('page');

const PARAM_PAGES = '/data/UserData/schwung/shared/param_pages';

console.log('flag OFF — the experiment must be absent:');
check('no param_pages import',
      !off.includes(PARAM_PAGES),
      `found ${(off.match(/param_pages/g) || []).length} reference(s) to ${PARAM_PAGES}`);
check('no Schwung page/widget code',
      !off.includes('renderPageMovy') && !off.includes('createController'),
      'renderPageMovy/createController reachable in a flag-off bundle');

console.log('\nflag ON — and present, so "absent" cannot mean "never built":');
check('param_pages import present',
      page.includes(PARAM_PAGES),
      'the flag-on build imports no param_pages — the grid cannot draw');
check('Schwung page/widget code present',
      page.includes('renderPageMovy') && page.includes('createController'),
      'the flag-on build carries no Schwung renderer');

/* Size is the symptom, not the contract — the assertions above are on the
 * import and the symbols. It is reported because "how much does off cost" is
 * the question a reviewer will actually ask. */
const kb = (n) => (n / 1024).toFixed(1) + ' KB';
console.log(`\n  flag off: ${kb(off.length)}   flag on: ${kb(page.length)}   `
            + `the experiment weighs ${kb(page.length - off.length)}`);

if (saved !== null) writeFileSync(UI, saved);

if (failed) { console.log(`\n\x1b[31m\x1b[1mFAIL: ${failed} check(s)\x1b[0m`); process.exit(1); }
console.log('\n\x1b[32m\x1b[1mPASS: a flag-off build carries no trace of the experiment '
            + '— no param_pages import, no Schwung renderer.\x1b[0m');
