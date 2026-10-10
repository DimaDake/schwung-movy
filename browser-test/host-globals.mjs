#!/usr/bin/env node
/* browser-test/host-globals.mjs — does the shared JS still call only globals
 * the manifest lists?
 *
 * movy imports schwung's param_pages (and a few siblings) from the device's
 * INSTALLED schwung at runtime. Under shadow_ui that is safe by construction;
 * under movy-host (the standalone flavour, plan WP6) every global those files
 * reach for must be one movy-host registers. browser-test/host-globals.json is
 * that list, and this fails the moment the schwung checkout uses a name it
 * does not carry — the early warning, before a schwung update ships it to a
 * device running the standalone build.
 *
 * Fixing a failure: decide what movy-host does about the new global (native,
 * stub or retire — docs/standalone/inventory.md), then
 *     SCHWUNG=../schwung node scripts/host-globals.mjs --write
 */

import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { MANIFEST, movyGlobals, sharedGlobals } from '../scripts/host-globals.mjs';

let fails = 0;
const ok = (label, cond, detail = '') => {
    if (cond) console.log(`  \x1b[32m✓\x1b[0m ${label}${detail ? '  (' + detail + ')' : ''}`);
    else { console.log(`  \x1b[31m✗\x1b[0m ${label}${detail ? '  ' + detail : ''}`); fails++; }
};

console.log('\nhost-globals: the host surface movy and its shared JS depend on');
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const REGEN = 'regenerate: SCHWUNG=../schwung node scripts/host-globals.mjs --write';

const movy = movyGlobals();
const listed = new Set(manifest.movy);
const movyNew = movy.filter((n) => !listed.has(n));
const movyGone = manifest.movy.filter((n) => !movy.includes(n));
ok('the manifest lists every global movy declares', movyNew.length === 0 && movyGone.length === 0,
   movyNew.length || movyGone.length
       ? `new: ${movyNew.join(', ') || '-'}; gone: ${movyGone.join(', ') || '-'} — ${REGEN}`
       : `${movy.length} globals`);

if (!process.env.SCHWUNG) {
    console.log('  shared half: SKIPPED (set SCHWUNG=/path/to/schwung)');
} else {
    const shared = sharedGlobals(resolve(process.env.SCHWUNG));
    const names = Object.keys(shared);
    /* A scan that finds nothing would pass the check below vacuously — a moved
     * param_pages directory looks exactly like a schwung with no globals. */
    ok('the scan reaches the shared JS', names.includes('shadow_get_held_step'),
       names.length ? `${names.length} globals` : 'found no globals at all — is SCHWUNG a schwung checkout?');
    const unlisted = names.filter((n) => !(n in manifest.shared));
    ok('the shared JS calls no global the manifest does not list', unlisted.length === 0,
       unlisted.length
           ? unlisted.map((n) => `${n} (${shared[n].join(', ')})`).join('; ') + ` — ${REGEN}`
           : `scanned against manifest from ${manifest.scannedAt}`);
    const stale = Object.keys(manifest.shared).filter((n) => !(n in shared));
    if (stale.length) console.log(`  note: no longer used by the shared JS: ${stale.join(', ')}`);
}

/* ── movy-host answers every entry (plan WP6) ──
 *
 * A manifest name is satisfied when one of these provides it:
 *   - movy-host's own C (host/*.c registers it by its string name);
 *   - schwung's compiled-in libraries (js_display, js_host_common), read from
 *     the PINNED tag the host is built from, never the live checkout;
 *   - an ES import in ui.js's banner (constants.mjs, input_filter.mjs), which
 *     the shared JS itself provides;
 *   - a build define (__MOVY_DEBUG__).
 * Anything else is a global movy-host would leave undefined: a ReferenceError
 * at the first call on the standalone flavour. */
console.log('\nhost-globals: movy-host registers every manifest entry');
{
    const hostDir = resolve(dirname(MANIFEST), '..', 'host');
    const cSrc = readdirSync(hostDir).filter((f) => f.endsWith('.c'))
        .map((f) => readFileSync(join(hostDir, f), 'utf8')).join('\n');
    const banner = readFileSync(resolve(hostDir, '..', 'build', 'device.mjs'), 'utf8');
    const imported = new Set([...banner.matchAll(/import \{([^}]*)\}/g)]
        .flatMap((m) => m[1].match(/[A-Za-z_]\w*/g) ?? []));
    const tag = /SCHWUNG_PIN_TAG:-([^}]+)\}/.exec(readFileSync(resolve(hostDir, '..', 'scripts', 'lib', 'schwung-pin.sh'), 'utf8'))[1];
    let libSrc = null;
    if (process.env.SCHWUNG) {
        try {
            libSrc = ['src/host/js_display.c', 'src/host/js_host_common.c'].map((f) => execFileSync('git',
                ['-C', resolve(process.env.SCHWUNG), 'show', `${tag}:${f}`], { encoding: 'utf8' })).join('\n');
        } catch { libSrc = null; }
    }
    const names = [...new Set([...manifest.movy, ...Object.keys(manifest.shared)])];
    const missing = [], unchecked = [];
    for (const n of names) {
        if (n === '__MOVY_DEBUG__' || imported.has(n)) continue;
        if (n.startsWith('module:')) {
            /* quickjs-libc's std/os, which JS_NewCustomContext registers. */
            if (!/JS_NewCustomContext\(/.test(cSrc)) missing.push(n);
            continue;
        }
        if (cSrc.includes(`"${n}"`)) continue;
        if (libSrc === null) { unchecked.push(n); continue; }
        if (!libSrc.includes(`"${n}"`)) missing.push(n);
    }
    ok('every manifest global has a provider on movy-host', missing.length === 0,
       missing.length ? `unregistered: ${missing.join(', ')} — add it to host/globals_*.c (native or stub)`
                      : `${names.length} names${unchecked.length ? `; ${unchecked.length} lib names unchecked (set SCHWUNG)` : ''}`);
}

console.log(fails === 0
    ? '\n\x1b[32m\x1b[1mHOST GLOBALS OK\x1b[0m'
    : `\n\x1b[31m\x1b[1m${fails} HOST-GLOBALS CHECK(S) FAILED\x1b[0m`);
process.exit(fails === 0 ? 0 : 1);
