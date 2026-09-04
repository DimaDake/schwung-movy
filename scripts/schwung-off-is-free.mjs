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

function build(exclude) {
    execFileSync(process.execPath, [resolve(root, 'build/device.mjs')], {
        cwd: root, stdio: 'pipe',
        env: { ...process.env, MOVY_NO_SCHWUNG_GRID: exclude ? '1' : '' },
    });
    return readFileSync(UI, 'utf8');
}

/* Preserve whatever ui.js the working tree had — this script rebuilds it twice
 * and would otherwise leave the last variant lying there for a later deploy to
 * pick up. */
const saved = existsSync(UI) ? readFileSync(UI, 'utf8') : null;

console.log('schwung-off-is-free: an ordinary build must not pay for the experiment\n');

/* THE AXIS THIS SCRIPT TESTS IS NO LONGER THE ONE THE USER SEES.
 *
 * Which renderer draws is a SETTING now (`schwunggrid`), so an ordinary build
 * carries both. What this still has to prove is the other axis: that a build
 * asked to leave the Schwung layer out really leaves it out, and that the
 * ordinary build's dependency is a DYNAMIC import — one that a device with an
 * older Schwung can fail without movy failing to load. A static import in the
 * default build would be the old bug back, and invisible on any device whose
 * Schwung happens to be current. */
const off  = build(true);
const page = build(false);

const PARAM_PAGES = '/data/UserData/schwung/shared/param_pages';

console.log('MOVY_NO_SCHWUNG_GRID=1 — the layer must be absent:');
check('no param_pages import',
      !off.includes(PARAM_PAGES),
      `found ${(off.match(/param_pages/g) || []).length} reference(s) to ${PARAM_PAGES}`);
check('no Schwung page/widget code',
      !off.includes('renderPageMovy') && !off.includes('createController'),
      'renderPageMovy/createController reachable in a flag-off bundle');

console.log('\nordinary build — present, so "absent" cannot mean "never built":');
check('param_pages import present',
      page.includes(PARAM_PAGES),
      'the flag-on build imports no param_pages — the grid cannot draw');
check('Schwung page/widget code present',
      page.includes('renderPageMovy') && page.includes('createController'),
      'the ordinary build carries no Schwung renderer');
/* The load-bearing one. A STATIC import of param_pages in the default build is
 * a load-time dependency: on an older Schwung the tool does not start, and
 * shadow_ui's stderr is /dev/null so nothing says why. */
check('the dependency is dynamic, not static',
      !/^import[^\n]*param_pages/m.test(page) && page.includes('import("' + PARAM_PAGES),
      'param_pages is imported statically — an older Schwung would stop movy loading');

/* Size is the symptom, not the contract — the assertions above are on the
 * import and the symbols. It is reported because "how much does off cost" is
 * the question a reviewer will actually ask. */
const kb = (n) => (n / 1024).toFixed(1) + ' KB';
console.log(`\n  flag off: ${kb(off.length)}   flag on: ${kb(page.length)}   `
            + `the Schwung layer weighs ${kb(page.length - off.length)}`);

if (saved !== null) writeFileSync(UI, saved);

if (failed) { console.log(`\n\x1b[31m\x1b[1mFAIL: ${failed} check(s)\x1b[0m`); process.exit(1); }
console.log('\n\x1b[32m\x1b[1mPASS: the layer can be excluded entirely, and when included '
            + 'it is reached dynamically.\x1b[0m');
