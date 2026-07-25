#!/usr/bin/env node
/* report-page-diff.mjs — what a layout change added or removed, per module.
 *
 * Diffs two browser-test/dump-expect.json snapshots (pages + shown param keys)
 * so a hierarchy/layout change can be reviewed module by module instead of by
 * reading a 77-module JSON diff.
 *
 * Usage: node scripts/report-page-diff.mjs <before.json> [after.json]
 */
import { readFileSync } from 'node:fs';

const before = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const after  = JSON.parse(readFileSync(process.argv[3] ?? 'browser-test/dump-expect.json', 'utf8'));

let addedPages = 0, addedParams = 0, changed = 0;
for (const key of Object.keys(after).sort()) {
    const b = before[key], a = after[key];
    const newPages  = a.pageNames.filter(n => !(b?.pageNames ?? []).includes(n));
    const newKeys   = (a.shownKeys ?? []).filter(k => !(b?.shownKeys ?? []).includes(k));
    const gonePages = (b?.pageNames ?? []).filter(n => !a.pageNames.includes(n));
    const lostKeys  = (b?.shownKeys ?? []).filter(k => !(a.shownKeys ?? []).includes(k));
    if (!newPages.length && !gonePages.length) continue;

    /* A page whose knob row is identical to a new page's was renamed, not
     * removed — report those separately so real removals stay visible. */
    const sig = (snap, name) => JSON.stringify(snap.pageShortNames[snap.pageNames.indexOf(name)]);
    const renamed = [], removed = [], claimed = new Set();
    for (const g of gonePages) {
        const match = newPages.find(n => !claimed.has(n) && sig(a, n) === sig(b, g));
        if (match) { claimed.add(match); renamed.push(`${g} → ${match}`); } else removed.push(g);
    }
    const added = newPages.filter(n => !claimed.has(n));

    changed++; addedPages += added.length; addedParams += newKeys.length;
    console.log(`\n${key}  ${b?.pageCount ?? 0} → ${a.pageCount} pages`);
    if (added.length)   console.log(`  + pages (${added.length}): ${added.join(', ')}`);
    if (renamed.length) console.log(`  ~ renamed (${renamed.length}): ${renamed.join(', ')}`);
    if (removed.length) console.log(`  - pages (${removed.length}, duplicate of a retained page): ${removed.join(', ')}`);
    if (newKeys.length)   console.log(`  + params (${newKeys.length}): ${newKeys.join(', ')}`);
    if (lostKeys.length)  console.log(`  !! LOST params (${lostKeys.length}): ${lostKeys.join(', ')}`);
}
console.log(`\n${changed} modules changed, +${addedPages} pages, +${addedParams} params reachable`);
