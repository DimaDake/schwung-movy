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
import { perDetentStep } from '../dist/esm/model/knob-step.js';

const EXPECT_PATH = join(MOVY, 'browser-test', 'dump-expect.json');
const UPDATE = process.argv.includes('--update');

/* Pages where duplicate 5-char on-screen short names are currently tolerated.
 * Short-name uniqueness is NOT yet a global invariant (chunk 2 shrank it from
 * 19 pages to these 3); as other chunks fix a module they drop its entry here
 * and run --update, and this suite then enforces uniqueness on that page. */
/* params[] keys deliberately left off the pages: the module reports an
 * unturnable range (max <= min), so a knob would be dead. level-extras.ts skips
 * them; the async metadata re-resolve renders them as soon as the module
 * publishes a real range. */
const UNREACHABLE_OK = new Set([
    // osirus was captured mid-ROM-load, so it still reported bank_index 0..0.
    // On device it widens to 0..1 and meta-retry.ts renders it (see
    // plans/2026-07-31-params-list-exposure-design.md §6).
    'sound_generator--osirus::bank_index',
    // sfz reports knob_preset 0..0 until a soundfont is loaded.
    'sound_generator--sfz::knob_preset',
    // `view` is a `canvas` — a drawing surface for pushnpull's own web UI, with
    // no knob semantics. level-extras.ts skips types movy cannot render.
    'audio_fx--pushnpull::view',
]);

const KNOWN_COLLIDING_PAGES = new Set([
    'midi_fx--eucalypso::Main',
    'sound_generator--aphex::VCO 1+2',
    'sound_generator--obxd::Global',
    // helm publishes two pairs of params with identical display names on this
    // page (stutter_sync / stutter_resample_sync are both "Stutter Sync", same
    // for tempo), so no shortener can tell them apart — an upstream fix.
    'sound_generator--helm::Stutter',
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
        shownKeys: [...shown].sort(),
    };
}

/* Invariants that must hold for every module regardless of the snapshot. */
function checkInvariants(key, model, snap) {
    check(`${key}: page count >= 1`, snap.pageCount >= 1);
    for (const p of model.dumpLayout().params) {
        if (!p) continue;
        check(`${key}: param ${p.key} has a label`, !!p.label && !!String(p.label).trim());
        if (p.type === 'file') continue;
        if (p.behavior === 'trigger') {
            check(`${key}: trigger ${p.key} is not automatable`, !p.automatable);
            const opts = (p.options ?? []).map(o => String(o).toLowerCase());
            check(`${key}: trigger ${p.key} exposes idle + trigger`,
                opts.includes('idle') && opts.includes('trigger'));
        }
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
    check(`${key}: shownKeys match`,
        JSON.stringify(snap.shownKeys) === JSON.stringify(expect.shownKeys));
}

/* Every knob a module declares in ANY hierarchy level must be reachable on some
 * page. Derived from the raw ui_hierarchy, so it is independent of the walk it
 * guards — this is the invariant helm violated (152 params declared, 9 shown).
 * Modules with a movy config curate a subset on purpose and are exempt. */
function checkDeclaredKnobsReachable(key, model, entry) {
    const layout = model.dumpLayout();
    if (layout.hasConfig) return;
    const levels = entry.ui_hierarchy?.levels;
    if (!levels) return;
    const declared = new Set();
    for (const lvl of Object.values(levels)) {
        for (const k of (lvl.knobs ?? [])) {
            const kk = typeof k === 'string' ? k : k?.key;
            if (kk) declared.add(kk);
        }
    }
    const shown = expandLayoutKeys(layout);
    const missing = [...declared].filter(k => !shown.has(k));
    check(`${key}: all ${declared.size} declared knobs reachable (missing: ${missing.slice(0, 5).join(',')})`,
        missing.length === 0);

    /* Every key a level lists in params[] must land on a page too — that is the
     * whole point of the extras pass, and a snapshot alone would happily freeze
     * a regression in place. */
    const listed = new Set();
    for (const lvl of Object.values(levels)) {
        for (const p of (lvl.params ?? [])) {
            const pk = typeof p === 'string' ? p : p?.key;
            if (pk && !pk.startsWith('ui_')) listed.add(pk);
        }
    }
    const unlisted = [...listed]
        .filter(k => !shown.has(k) && !UNREACHABLE_OK.has(`${key}::${k}`));
    check(`${key}: all ${listed.size} listed params reachable (missing: ${unlisted.slice(0, 5).join(',')})`,
        unlisted.length === 0);
}

/* N detents must move a knob N steps, whichever way it is turned. store.ts
 * rounds the value it keeps, so a fractional step on an INT param is dropped
 * rather than carried — and Math.round breaks the .5 tie upward, which made a
 * half-unit step advance clockwise and stall completely counter-clockwise. That
 * hit 257 of the fleet's 464 int params (every range <= 200: obxd octave,
 * obxd cutoff, fizzik tune, …), so assert the rule over the real metadata rather
 * than on hand-written params only. */
function checkKnobStepSymmetric(key, model) {
    for (const p of model.dumpLayout().params) {
        if (!p || p.type === 'file' || p.type === 'enum' || p.options?.length) continue;
        if (p.behavior === 'trigger' || p.knobAcceleration === 'wide') continue;
        if (p.max <= p.min) continue;              // unreachable knob; clamp pins it
        const step = perDetentStep(p);
        check(`${key}: ${p.key} (${p.type} ${p.min}..${p.max}) moves per detent (got ${step})`,
            step > 0);
        if (p.type === 'int') {
            check(`${key}: int ${p.key} steps whole units, so both directions match (got ${step})`,
                Number.isInteger(step));
        }
    }
}

/* An enum knob may only offer the options the module itself reports. Option
 * lists are CONFIG-FIRST in hierarchy.ts (slot.options wins over cp.options),
 * so a hand-written list silently overrides the truth — and an option the DSP
 * can't parse is coerced to its default on write, which refreshOneParam then
 * reads back, snapping the knob a moment after the user lets go. That is how
 * mrdrums' invented "loop" mode behaved (the DSP has only gate/oneshot).
 * Order matters as much as membership: index-format modules (enum-value.ts)
 * exchange the position, not the name.
 * Modules reporting NO options are exempt — labelling a bare 0/1 int as
 * ["Stereo","Mono"] (weird-dreams all_mono) is a legitimate UI overlay. */
function checkEnumOptionsMatchModule(key, model, entry) {
    const cp = new Map((entry.chain_params ?? []).map(p => [p.key, p]));
    for (const p of model.dumpLayout().params) {
        if (!p?.options?.length) continue;
        const modOptions = cp.get(p.key)?.options;
        if (!modOptions?.length) continue;
        check(`${key}: enum ${p.key} options = ${JSON.stringify(modOptions)} (got ${JSON.stringify(p.options)})`,
            JSON.stringify(p.options) === JSON.stringify(modOptions));
    }
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
    checkDeclaredKnobsReachable(key, model, entry);
    checkEnumOptionsMatchModule(key, model, entry);
    checkKnobStepSymmetric(key, model);
    if (!UPDATE) checkExpect(key, snap, expect[key]);
}

/* Undo's module dump, against every real module's real chain_params. A module
 * whose dump comes back empty cannot be restored by a module undo at all — the
 * swap would be one-way — so it is worth knowing before a user finds out. */
{
    const { dumpModuleParams, paramTier } = await import('../dist/esm/undo/module-dump.js');
    const origGet = globalThis.shadow_get_param;
    const empty = [], unordered = [], unsafe = [], noLead = [];
    const ACTION = /(^|_)(rnd|save|reset|init|load|clear|randomi[sz]e)(_|$)/i;
    for (const entry of dump.modules) {
        const cp = Array.isArray(entry.chain_params) ? entry.chain_params : [];
        if (cp.length === 0) continue;   // module published none; nothing to dump
        const uh = entry.ui_hierarchy ?? null;
        globalThis.shadow_get_param = (slot, key) =>
            key === 'synth:chain_params' ? JSON.stringify(cp)
            : key === 'synth:ui_hierarchy' ? (uh ? JSON.stringify(uh) : null)
            : '0';
        const d = dumpModuleParams(0, 'synth');
        const name = `${entry.category}--${entry.id}`;
        if (d.params.length === 0) { empty.push(name); continue; }

        /* The lead must really be the leading slice — module-apply writes
         * [0, leadCount) first and trusts that boundary. Asserted with the
         * implementation's OWN classifier: a second copy of the rule here just
         * drifts from it and starts reporting phantom failures. */
        const keys = d.params.map(([k]) => k);
        const listP = uh?.levels?.root?.list_param ?? '';
        const misplaced = keys.some((k, i) =>
            (i < d.leadCount) !== (paramTier(k, listP) < 2));
        if (misplaced) unordered.push(name);
        /* Nothing that fires an action may ever be replayed. */
        if (keys.some((k) => ACTION.test(k))) unsafe.push(name);
        /* A module that declares a preset list must put it in the lead, or its
         * preset would be applied AFTER the params and overwrite them. */
        const lp = uh?.levels?.root?.list_param;
        if (lp && keys.includes(lp) && keys.indexOf(lp) >= d.leadCount) noLead.push(name);
    }
    globalThis.shadow_get_param = origGet;
    check(`every module with chain_params yields an undo dump (${empty.join(',')})`,
        empty.length === 0);
    check(`no module replays an action param (${unsafe.join(',')})`, unsafe.length === 0);
    check(`every dump's lead really is selector/preset only (${unordered.join(',')})`,
        unordered.length === 0);
    check(`every declared preset list is written before the params (${noLead.join(',')})`,
        noLead.length === 0);
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
