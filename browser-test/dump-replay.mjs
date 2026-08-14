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
import { detentsPerStep, perDetentStep } from '../dist/esm/model/knob-step.js';
import { waveCellIndices } from '../dist/esm/model/wave-viz.js';
import { waveToggleCells } from '../dist/esm/model/wave-toggle.js';
import { envStageCells } from '../dist/esm/model/env-stage.js';
import { cutKindOf } from '../dist/esm/model/cut-viz.js';
import { planPageLayout, claimedCells } from '../dist/esm/model/page-layout.js';

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
    // Same: noisemaker's preset-bank editor is a canvas (canvas.js#bank_editor).
    'sound_generator--noisemaker::editor',
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
        /* Which knobs read as a framed number, and which are stepped rather than
         * swept. Frozen per module because both rules are name-based: a naming
         * tweak that quietly recruits or drops a param shows up here as a named
         * diff instead of as a surprise on the device. */
        stepCells: [...new Set(model.dumpLayout().params
            .filter(p => p?.renderStyle === 'steps')
            .map(p => p.key + (p.signed ? ' +' : '')))].sort(),
        slowCells: [...new Set(model.dumpLayout().params
            .filter(p => p && detentsPerStep(p) > 1).map(p => p.key))].sort(),
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
    for (const field of ['stepCells', 'slowCells']) {
        check(`${key}: ${field} = ${JSON.stringify(expect[field])} (got ${JSON.stringify(snap[field])})`,
            JSON.stringify(snap[field]) === JSON.stringify(expect[field]));
    }
}

/* Every knob a module declares in ANY hierarchy level must be reachable on some
 * page. Derived from the raw ui_hierarchy, so it is independent of the walk it
 * guards — this is the invariant helm violated (152 params declared, 9 shown).
 * Modules with a movy config curate a subset on purpose and are exempt. */
function checkDeclaredKnobsReachable(key, model, entry) {
    /* A param the module itself is hiding right now (visible_if) is not
     * missing — mrsample hides Loop Start/End/Xfade until Loop is on. */
    const hidden = new Set(model.dumpLayout().hiddenKeys ?? []);
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
    const missing = [...declared].filter(k => !shown.has(k) && !hidden.has(k));
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
        .filter(k => !shown.has(k) && !hidden.has(k) && !UNREACHABLE_OK.has(`${key}::${k}`));
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
        /* An on/off switch must keep flipping on one click: it never had the
         * fractional-step bug, and four clicks to flip is worse. */
        if (p.max - p.min <= 1) {
            check(`${key}: toggle ${p.key} keeps one click per flip`, detentsPerStep(p) === 1);
            check(`${key}: toggle ${p.key} is not a step cell`, p.renderStyle !== 'steps');
        }
        if (p.renderStyle === 'steps') {
            check(`${key}: step cell ${p.key} is an int`, p.type === 'int');
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

/* Every param in the fleet that draws a waveform silhouette instead of its
 * option text. Pinned as an explicit list rather than a count: the interesting
 * regression is a specific module drifting in or out (a new glyph accidentally
 * making helm's step counts "unique", or a remap silently dropping chordism),
 * and a bare count would let one module swap for another unnoticed. */
/* Binary "is this waveform sounding?" switches, drawn as a dotted/solid
 * silhouette instead of an on/off bar. Pinned for the same reason as the
 * pickers: the failure mode is a module drifting in or out unnoticed. */
const WAVE_TOGGLES_EXPECTED = [
    'sound_generator--hush1::white_noise',
    'sound_generator--obxd::lfo_sh',
    'sound_generator--obxd::lfo_sin',
    'sound_generator--obxd::lfo_square',
    'sound_generator--obxd::osc1_pulse',
    'sound_generator--obxd::osc1_saw',
    'sound_generator--obxd::osc2_pulse',
    'sound_generator--obxd::osc2_saw',
    'sound_generator--surge::mute_noise',   // inverted: ON means silent
];

/* Lone Attack/Decay knobs drawn as a single ramp (sound generators only).
 * Pinned like the others: the failure mode is a module silently drifting in or
 * out as the word rules change. */
const ENV_STAGES_EXPECTED = [
    'sound_generator--303::accent_decay d',
    'sound_generator--303::decay d',
    'sound_generator--303::normal_decay d',
    'sound_generator--303::soft_attack a',
    'sound_generator--essaim::decay d',
    'sound_generator--fizzik::a_decay d',
    'sound_generator--fizzik::b_decay d',
    'sound_generator--forge::all_decay d',
    'sound_generator--forge::cv_e2_dec d',
    'sound_generator--forge::cv_pe_dec d',
    'sound_generator--freak::lpg_decay d',
    'sound_generator--krautdrums::all_decay d',
    /* noisemaker lists aenv_a twice: on the Amp Env page it is part of a placed
     * ADSR (claimed), and on the Env Draw page it stands alone. */
    'sound_generator--noisemaker::aenv_a a',
    'sound_generator--plaits::attack a',
    'sound_generator--plaits::decay d',
    'sound_generator--po32-drum::decay d',
    'sound_generator--signal::all_decay d',
    'sound_generator--signal::cv_attack a',
    'sound_generator--signal::cv_decay d',
    'sound_generator--signal::mod_decay d',
    'sound_generator--weird-dreams::cv_decay d',
];

/* EQ band groups drawn as one response curve. Pinned like the others; the
 * bipolar-dB test is what keeps crossover frequencies and per-band Q out. */
/* Low/high cut corners: pairs drawn as one band-pass, lone cuts as one corner
 * in their own cell. Pinned like the others. */
const CUT_PAIRS_EXPECTED = [
    'audio_fx--cloudseed low_cut+high_cut',
    'audio_fx--dragonfly-hall low_cut+high_cut',
    'audio_fx--midiverb low_cut_hz+high_cut_hz',
    'audio_fx--spectra hpf+lpf',
    'audio_fx--verglas filter_hp+filter_lp',
    'sound_generator--aphex esp_lo_cut+esp_hi_cut',
    'sound_generator--noisemaker delay_lo+delay_hi',
    'sound_generator--noisemaker reverb_lo+reverb_hi',
];
const CUT_SINGLES_EXPECTED = [
    'audio_fx--magneto lowcut lowcut',
    'audio_fx--superboom hiCut highcut',
    'sound_generator--303 feedback_hpf lowcut',
    'sound_generator--chordism reverb_lowcut lowcut',
    'sound_generator--hera hpf lowcut',
    'sound_generator--krautdrums hpf_freq lowcut',
    'sound_generator--noisemaker highpass lowcut',
    'sound_generator--surge lowcut lowcut',
];

const EQ_GROUPS_EXPECTED = [
    'audio_fx--magneto low/mid/high',
    'audio_fx--ottx low/mid/high',
    'sound_generator--forge low/mid/high',
    'sound_generator--krautdrums mid/high',
    'sound_generator--weird-dreams low/mid/high',
];

const WAVE_CELLS_EXPECTED = [
    'audio_fx--ambiotica::mod_shape',
    'audio_fx--spectra::motion_shape',
    'audio_fx--war_bells::mot_shape',
    'sound_generator--303::waveform',
    'sound_generator--aphex::v1_wave',
    'sound_generator--aphex::v2_wave',
    'sound_generator--chordism::wave_1',
    'sound_generator--chordism::wave_2',
    'sound_generator--chordism::wave_3',
    'sound_generator--chordism::wave_4',
    'sound_generator--forge::cv_wave',
    /* Helm's stepped families qualify because the level count is encoded in the
     * glyph id; at the cell's full height a stepped climb is distinguishable
     * from the same list's smooth Saw Up. */
    'sound_generator--helm::osc_1_waveform',
    'sound_generator--helm::osc_2_waveform',
    'sound_generator--helm::sub_waveform',
    'sound_generator--noisemaker::osc1_wave',
    'sound_generator--noisemaker::osc2_wave',
    'sound_generator--osirus::delay_lfo_shape',
    'sound_generator--osirus::sub_osc_shape',
    'sound_generator--signal::mod_shape',
];

/* Record which params draw a waveform silhouette. ParamVM carries no param key,
 * so the names come from the detector over the same page slices the VM uses;
 * the VM is then cross-checked to have produced that many 'wave' cells, which
 * is what proves the detector is actually wired through to renderStyle. */
function collectWaveCells(key, model, into, intoToggles, intoStages, intoEqs, intoCuts, intoCutSingles) {
    const params = model.dumpLayout().params;
    let detected = 0;
    for (let start = 0; start < params.length; start += 8) {
        const page = params.slice(start, start + 8);
        const layout = planPageLayout(page);
        for (const i of waveCellIndices(page, layout)) {
            into.push(`${key}::${page[i].key}`);
            detected++;
        }
        const claimed = claimedCells(layout);
        for (const [i] of waveToggleCells(page, claimed)) {
            intoToggles.push(`${key}::${page[i].key}`);
            detected++;
        }
        for (const q of layout.eqs) intoEqs.push(`${key} ${q.bands.join('/')}`);
        for (const c of layout.cuts)
            intoCuts.push(`${key} ${page[c.lowcut].key}+${page[c.highcut].key}`);
        page.forEach((p, i) => {
            if (!p || claimed.has(i)) return;
            const k = cutKindOf(p);
            if (k) intoCutSingles.push(`${key} ${p.key} ${k}`);
        });
        if (model.getComponentKey() === 'synth') {
            for (const [i, st] of envStageCells(page, claimed)) {
                intoStages.push(`${key}::${page[i].key} ${st}`);
                detected++;
            }
        }
    }
    let styled = 0;
    /* snapshot() already walked every page and changePage CLAMPS at the last one
     * rather than wrapping, so rewind before counting or every read repeats the
     * final page. */
    model.changePage(-model.getBankCount());
    for (let pg = 0; pg < model.getBankCount(); pg++) {
        const vm = model.getViewModel();
        for (const row of vm.rows) {
            for (const pvm of row) if (pvm?.renderStyle === 'wave' || pvm?.renderStyle === 'envstage') styled++;
        }
        model.changePage(1);
    }
    check(`${key}: VM styles every detected wave/stage cell (${detected} detected, ${styled} styled)`,
        detected === styled);
}

/* ── run ─────────────────────────────────────────────────────────────────── */

const dump = loadDump();
const { bootFromDumpEntry } = await createDumpBoot(dump);
const expect = UPDATE ? {} : JSON.parse(readFileSync(EXPECT_PATH, 'utf8'));
const snapshots = {};
const waveCells = [];
const waveToggles = [];
const envStages = [];
const eqGroups = [];
const cutPairs = [];
const cutSingles = [];

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
    collectWaveCells(key, model, waveCells, waveToggles, envStages, eqGroups, cutPairs, cutSingles);
    if (!UPDATE) checkExpect(key, snap, expect[key]);
}

/* Fleet-wide low/high cut placements. */
for (const [label, got0, want0] of [
    ['cut pairs', cutPairs, CUT_PAIRS_EXPECTED],
    ['cut singles', cutSingles, CUT_SINGLES_EXPECTED],
]) {
    const got = [...new Set(got0)].sort();
    const want = want0.slice().sort();
    const added   = got.filter(k => !want.includes(k));
    const dropped = want.filter(k => !got.includes(k));
    check(`${label}: ${got.length}${added.length ? ` — UNEXPECTED: ${added.join(', ')}` : ''}${dropped.length ? ` — MISSING: ${dropped.join(', ')}` : ''}`,
        added.length === 0 && dropped.length === 0);
}

/* Fleet-wide EQ band groups. */
{
    const got = [...new Set(eqGroups)].sort();
    const want = EQ_GROUPS_EXPECTED.slice().sort();
    const added   = got.filter(k => !want.includes(k));
    const dropped = want.filter(k => !got.includes(k));
    check(`eq groups: ${got.length}${added.length ? ` — UNEXPECTED: ${added.join(', ')}` : ''}${dropped.length ? ` — MISSING: ${dropped.join(', ')}` : ''}`,
        added.length === 0 && dropped.length === 0);
}

/* Fleet-wide lone-envelope-stage set. */
{
    const got = [...new Set(envStages)].sort();
    const want = ENV_STAGES_EXPECTED.slice().sort();
    const added   = got.filter(k => !want.includes(k));
    const dropped = want.filter(k => !got.includes(k));
    check(`env stages: ${got.length} params${added.length ? ` — UNEXPECTED: ${added.join(', ')}` : ''}${dropped.length ? ` — MISSING: ${dropped.join(', ')}` : ''}`,
        added.length === 0 && dropped.length === 0);
}

/* Fleet-wide waveform-toggle set. */
{
    const got = waveToggles.slice().sort();
    const want = WAVE_TOGGLES_EXPECTED.slice().sort();
    const added   = got.filter(k => !want.includes(k));
    const dropped = want.filter(k => !got.includes(k));
    check(`wave toggles: ${got.length} params${added.length ? ` — UNEXPECTED: ${added.join(', ')}` : ''}${dropped.length ? ` — MISSING: ${dropped.join(', ')}` : ''}`,
        added.length === 0 && dropped.length === 0);
}

/* Fleet-wide waveform-silhouette set. */
{
    const got = waveCells.slice().sort();
    const want = WAVE_CELLS_EXPECTED.slice().sort();
    const added   = got.filter(k => !want.includes(k));
    const dropped = want.filter(k => !got.includes(k));
    check(`wave cells: ${got.length} params${added.length ? ` — UNEXPECTED: ${added.join(', ')}` : ''}${dropped.length ? ` — MISSING: ${dropped.join(', ')}` : ''}`,
        added.length === 0 && dropped.length === 0);
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
