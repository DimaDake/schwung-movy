#!/usr/bin/env node
/* browser-test/dump-replay.mjs — dump-driven regression suite (IMPROVEMENTS § D).
 *
 * Replays every one of the 76 modules captured in
 * docs/module-dump/device-dump.json through the REAL model and gates two
 * things against a checked-in snapshot (dump-expect.json):
 *   1. global invariants that must hold for EVERY module/page, and
 *   2. per-module layout facts (page count/names, on-screen short names,
 *      envelope/LFO group counts, hidden-param count).
 *
 * This catches layout regressions across ALL real modules, not just the few
 * bundled configs the other suites cover. It is a pure-JS replay over a 2 MB
 * JSON — no device, no network, no per-test rebuild.
 *
 * Run from movy root (dist/esm must be fresh):
 *   node browser-test/dump-replay.mjs            # assert against snapshot
 *   node browser-test/dump-replay.mjs --update   # regenerate the snapshot
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    MOVY, loadDump, createDumpBoot, serializePages, expandLayoutKeys,
} from './dump-boot.mjs';

const EXPECT_PATH = join(MOVY, 'browser-test', 'dump-expect.json');
const UPDATE = process.argv.includes('--update');

/* Pages where duplicate 5-char on-screen short names are currently tolerated.
 * Short-name uniqueness is NOT yet a global invariant (chunk 2 shrank it from
 * 19 pages to these 3); as other chunks fix a module they drop its entry here
 * and run --update, and this suite then enforces uniqueness on that page. */
const KNOWN_COLLIDING_PAGES = new Set([
    'midi_fx--eucalypso::Main',
    'sound_generator--aphex::VCO 1+2',
    'sound_generator--obxd::Global',
]);

let failures = 0;
const _log = (...a) => console.log(...a);
function check(name, cond) {
    if (cond) return;
    failures++;
    _log(`\x1b[31m✗ ${name}\x1b[0m`);
}

/* ── per-module extraction ───────────────────────────────────────────────── */

function snapshot(model, entry) {
    const pages = serializePages(model);
    const shown = expandLayoutKeys(model.dumpLayout());
    const cp = Array.isArray(entry.chain_params) ? entry.chain_params : [];
    const hidden = cp.filter(p => p.key && !shown.has(p.key)).length;
    return {
        pageCount: pages.length,
        pageNames: pages.map(p => p.name),
        pageShortNames: pages.map(p => p.rows.flat().filter(Boolean).map(r => r.shortName)),
        envelopeLines: pages.reduce((n, p) => n + p.envelopeLines.filter(Boolean).length, 0),
        lfoViz: pages.reduce((n, p) => n + p.lfoVizCount, 0),
        hidden,
    };
}

/* Invariants that must hold for every module regardless of the snapshot. */
function checkInvariants(key, model, snap) {
    check(`${key}: page count >= 1`, snap.pageCount >= 1);
    for (const p of model.dumpLayout().params) {
        if (!p) continue;
        check(`${key}: param ${p.key} has a label`, !!p.label && !!String(p.label).trim());
        if (p.type === 'file') continue;
        const isEnum = p.type === 'enum' || (p.options && p.options.length > 0);
        if (isEnum) {
            check(`${key}: enum ${p.key} has options or a range`,
                (p.options && p.options.length > 0) || p.max > p.min);
        } else {
            check(`${key}: numeric ${p.key} has step > 0`, p.step > 0);
            check(`${key}: numeric ${p.key} has min < max`, p.max > p.min);
        }
    }
    snap.pageNames.forEach((pageName, i) => {
        if (KNOWN_COLLIDING_PAGES.has(`${key}::${pageName}`)) return;
        const names = snap.pageShortNames[i];
        const dup = [...new Set(names.filter((n, j) => names.indexOf(n) !== j))];
        check(`${key}: page "${pageName}" short names unique (dup: ${dup.join(',')})`,
            dup.length === 0);
    });
}

/* Field-level comparison against the checked-in snapshot, with a readable
 * message naming module + field on mismatch. */
function checkExpect(key, snap, expect) {
    if (!expect) { check(`${key}: present in dump-expect.json`, false); return; }
    for (const field of ['pageCount', 'envelopeLines', 'lfoViz', 'hidden']) {
        check(`${key}: ${field} = ${expect[field]} (got ${snap[field]})`,
            snap[field] === expect[field]);
    }
    check(`${key}: pageNames = ${JSON.stringify(expect.pageNames)} (got ${JSON.stringify(snap.pageNames)})`,
        JSON.stringify(snap.pageNames) === JSON.stringify(expect.pageNames));
    check(`${key}: pageShortNames match`,
        JSON.stringify(snap.pageShortNames) === JSON.stringify(expect.pageShortNames));
}

/* ── run ─────────────────────────────────────────────────────────────────── */

const dump = loadDump();
const { bootFromDumpEntry } = await createDumpBoot(dump);
const expect = UPDATE ? {} : JSON.parse(readFileSync(EXPECT_PATH, 'utf8'));
const snapshots = {};

for (const entry of dump.modules) {
    const key = `${entry.category}--${entry.id}`;
    let model;
    try {
        model = bootFromDumpEntry(entry);
    } catch (e) {
        check(`${key}: boots without throwing`, false);
        _log(`  ${e.stack ?? e}`);
        continue;
    }
    const snap = snapshot(model, entry);
    snapshots[key] = snap;
    checkInvariants(key, model, snap);
    if (!UPDATE) checkExpect(key, snap, expect[key]);
}

/* Snapshot keys must exactly track the dump (no stale/missing modules). */
if (!UPDATE) {
    const expectKeys = Object.keys(expect).sort().join(',');
    const dumpKeys = Object.keys(snapshots).sort().join(',');
    check(`dump-expect.json covers exactly the dump's modules`, expectKeys === dumpKeys);
}

/* ── report / update ─────────────────────────────────────────────────────── */

_log('');
if (UPDATE) {
    const sorted = {};
    for (const k of Object.keys(snapshots).sort()) sorted[k] = snapshots[k];
    writeFileSync(EXPECT_PATH, JSON.stringify(sorted, null, 1) + '\n');
    _log(`\x1b[32mWrote ${Object.keys(sorted).length} module expectations to dump-expect.json\x1b[0m`);
    if (failures > 0) { _log(`\x1b[31m${failures} INVARIANT CHECK(S) FAILED during --update\x1b[0m`); process.exit(1); }
    process.exit(0);
}
if (failures === 0) {
    _log(`\x1b[32m\x1b[1mALL DUMP-REPLAY CHECKS PASSED (${dump.modules.length} modules)\x1b[0m`);
    process.exit(0);
} else {
    _log(`\x1b[31m\x1b[1m${failures} DUMP-REPLAY CHECK(S) FAILED\x1b[0m`);
    process.exit(1);
}
