#!/usr/bin/env node
/* browser-test/logic.mjs — pure viewmodel/logic tests, no device or screenshots.
 *
 * Tests business invariants on the model and viewmodel layer.
 * Run from movy root: node browser-test/logic.mjs
 */

import { createModel }    from '../dist/esm/model/index.js';
import { dedupShortNames } from '../dist/esm/renderer/shorten.js';
import { detectEnvelopes } from '../dist/esm/model/envelope.js';
import { planPageLayout } from '../dist/esm/model/page-layout.js';
import { enumRawToIndex, enumUsesIndex, enumSetValue } from '../dist/esm/model/enum-value.js';
import { MOCK_SYNTHS }    from './mock-synth.mjs';
import { drumPadOn, drumPadOff } from '../dist/esm/keyboard/drum-handler.js';
import { ENGINE_VERSION } from '../dist/esm/seq/constants.js';
import {
    readActiveSet, uuidToStatePath, uuidToUiStatePath,
    loadNameIndex, rememberSet, BLANK_STATE,
    stripCopySuffix, findInheritCandidates, resolveStateBlob, resolveUiBlob,
} from '../dist/esm/seq/set-context.js';
import { switchToSet, currentSetUuid, resetSeqPersist } from '../dist/esm/seq/persist.js';
import { keyboardState } from '../dist/esm/keyboard/state.js';
import { installMockEngine } from './mock-engine.mjs';
import { installEnv } from './env.mjs';
import {
    buildTargetOptions, shortenTarget, targetIndex, formatDepth, formatPhase,
    LFO_SHAPES, LFO_DIVISIONS, compLabel,
} from '../dist/esm/lfo/params.js';
import { createLfoModel } from '../dist/esm/lfo/model.js';
import { detectLfoViz } from '../dist/esm/model/lfo-viz.js';
import { buildLfoViz } from '../dist/esm/model/lfo-vm.js';
import { detectFilterViz } from '../dist/esm/model/filter-viz.js';
import { buildFilterViz } from '../dist/esm/model/filter-vm.js';
import { normalizeFilterOption, isFilterModeEnum, filterModeFromEnum, isSlopeEnum, staticModeFromTokens } from '../dist/esm/model/filter-mode.js';
import { shapeId as lfoShapeId, isShapeEnum } from '../dist/esm/model/lfo-shapes.js';
import { lfoTargetsParam, assignLfoTarget, clearLfoTarget } from '../dist/esm/lfo/assign.js';
import { holdTouch, holdRelease, holdTurnCancel, holdTick, assignActive, assignCycle, assignCommit, assignToastText, resetAssignMode } from '../dist/esm/lfo/assign-mode.js';
import { shapeSample } from '../dist/esm/renderer/lfo-wave.js';
import { CHAIN_SLOTS, LFO_CHAIN_INDEX, isLfoSlot } from '../dist/esm/chain/config.js';
import { init } from '../dist/esm/app/init.js';
import { appState } from '../dist/esm/app/state.js';

/* ── Mock globals ─────────────────────────────────────────────────────────── */

const env = installEnv();

let mockFsEntries = {};  // path → string[] of filenames

globalThis.os = {
    readdir: (path) => [mockFsEntries[path] ?? [], 0],
    stat:    (path) => {
        // treat paths without an extension as directories
        const mode = path.lastIndexOf('.') > path.lastIndexOf('/') ? 0x8000 : 0x4000;
        return [{ mode }, 0];
    },
};

const _log = console.log.bind(console);
console.log = (...args) => {
    if (typeof args[0] === 'string' && args[0].startsWith('[movy]')) return;
    _log(...args);
};

let failures = 0;

function ok(label)        { _log(`  \x1b[32m✓\x1b[0m ${label}`); }
function fail(label, why) { _log(`  \x1b[31m✗\x1b[0m ${label}: ${why}`); failures++; }

function eq(label, actual, expected) {
    if (actual === expected) ok(label);
    else fail(label, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function notMatch(label, str, pattern) {
    if (!pattern.test(str)) ok(label);
    else fail(label, `'${str}' should not match ${pattern}`);
}

function bootModel(preset, slot = 0, componentKey = 'synth') {
    env.setParams(preset);
    const m = createModel(slot, componentKey);
    m.reload();  // sets pollCountdown=1 so pollModuleName fires on next tick
    m.tick();    // tick 1: polls name, resets hierarchyKey
    m.tick();    // tick 2: reloads hierarchy with the real module name
    return m;
}

/* ── vm.moduleName is raw name — no track prefix ─────────────────────────── */

_log('\nTest: vm.moduleName is raw module name (no track prefix)');

for (const [name, preset] of [
    ['Test 8',  MOCK_SYNTHS.test8    ],
    ['Plaits',  MOCK_SYNTHS.plaits   ],
    ['OB-Xd',  MOCK_SYNTHS.obxd_like],
    ['Wurl',   MOCK_SYNTHS.wurl     ],
]) {
    const vm = bootModel(preset).getViewModel();
    eq(`${name}: vm.moduleName`, vm.moduleName, name);
    notMatch(`${name}: no T> prefix`, vm.moduleName, /^T\d+ > /);
}

/* ── moduleName is slot-independent ─────────────────────────────────────── */

_log('\nTest: vm.moduleName does not vary by activeSlot');

for (const slot of [0, 1, 2, 3]) {
    const vm = bootModel(MOCK_SYNTHS.test8, slot).getViewModel();
    eq(`slot ${slot}: moduleName = 'Test 8'`, vm.moduleName, 'Test 8');
}

/* ── bank structure ───────────────────────────────────────────────────────── */

_log('\nTest: bankCount and bankName');

{
    const vm = bootModel(MOCK_SYNTHS.test8).getViewModel();
    eq('test8: bankCount = 1', vm.bankCount, 1);
    eq('test8: bankName empty (single bank)', vm.bankName, '');
}

{
    const vm = bootModel(MOCK_SYNTHS.obxd_like).getViewModel();
    eq('obxd: bankCount = 4 (preset + main + global + filter)', vm.bankCount, 4);
    eq('obxd: first bankName = Preset', vm.bankName, 'Preset');
}

/* ── nav-only level expansion ─────────────────────────────────────────────── */

_log('\nTest: navigation-only levels expand recursively');

{
    const m = bootModel(MOCK_SYNTHS.nav_levels);
    eq('nav_levels: bankCount = 4', m.getViewModel().bankCount, 4);

    const names = [];
    for (let i = 0; i < 4; i++) {
        if (i > 0) m.changePage(1);
        names.push(m.getViewModel().bankName);
    }
    eq('nav_levels: bank 0 = Main',       names[0], 'Main');
    eq('nav_levels: bank 1 = Main',       names[1], 'Main');
    eq('nav_levels: bank 2 = Mod/Pitch',  names[2], 'Mod/Pitch');
    eq('nav_levels: bank 3 = Mod/Filter', names[3], 'Mod/Filter');
    eq('nav_levels: no bare Mod bank',    names.includes('Mod'), false);

    // page 2 (Mod/Pitch) should expose 3 params
    m.changePage(-1);
    eq('nav_levels: Mod/Pitch has 3 params',
        m.getViewModel().rows.flat().filter(Boolean).length, 3);
}

/* ── moog: generic children-delegation hierarchy → 12 banks ─────────────── */

_log('\nTest: moog hierarchy via children delegation (generic path)');

{
    const m = bootModel(MOCK_SYNTHS.moog);
    const bankNames = [];
    for (let i = 0; i < 12; i++) {
        if (i > 0) m.changePage(1);
        bankNames.push(m.getViewModel().bankName);
    }
    eq('moog: bankCount = 12', m.getViewModel().bankCount, 12);
    eq('moog: bank 0  = Preset',       bankNames[0],  'Preset');
    eq('moog: bank 1  = Main',         bankNames[1],  'Main');
    eq('moog: bank 2  = Oscillator 1', bankNames[2],  'Oscillator 1');
    eq('moog: bank 6  = Mixer',        bankNames[6],  'Mixer');
    eq('moog: bank 11 = Performance',  bankNames[11], 'Performance');

    // Osc banks (2-5): row[0] = [wave, volume, range, detune/noise]; wave+range are int
    m.changePage(-11); // back to bank 0
    for (let bank = 0; bank < 12; bank++) {
        if (bank > 0) m.changePage(1);
        if (bank < 2 || bank > 5) continue;
        const oscNum = bank - 1;
        const vm2  = m.getViewModel();
        const wave  = vm2.rows[0][0];
        const range = vm2.rows[0][2];
        if (!wave)  { fail(`moog: Osc ${oscNum} wave slot non-null`,  'null'); continue; }
        if (!range) { fail(`moog: Osc ${oscNum} range slot non-null`, 'null'); continue; }
        eq(`moog: Osc ${oscNum} wave type = int`,  wave.type,  'int');
        eq(`moog: Osc ${oscNum} range type = int`, range.type, 'int');
    }

    // Main bank (bank 1): 8 non-null params
    m.changePage(-11);
    m.changePage(1);
    eq('moog: Main bank has 8 params',
        m.getViewModel().rows.flat().filter(Boolean).length, 8);

    // osc1_range min=-2 max=2 via chain_params
    const moogRange = bootModel({ ...MOCK_SYNTHS.moog, 'synth:osc1_range': '-2' });
    for (let i = 0; i < 60; i++) moogRange.tick();
    moogRange.changePage(2); // bank 0 → bank 2 = Oscillator 1
    {
        const rangeSlot = moogRange.getViewModel().rows[0][2];
        if (!rangeSlot) { fail('moog: osc1_range slot exists', 'null'); }
        else {
            eq('moog: osc1_range displayValue for -2', rangeSlot.displayValue, '-2');
            const expectedNv = ((-2) - (-2)) / (2 - (-2)); // 0
            eq('moog: osc1_range normalizedValue reflects min=-2',
                Math.round(rangeSlot.normalizedValue * 100), Math.round(expectedNv * 100));
        }
    }
}

/* ── C1: preset knob not duplicated across pages ─────────────────────────── */

_log('\nTest: preset knob renders exactly once (C1)');

{
    const m = bootModel(MOCK_SYNTHS.preset_dup);
    const params = m.dumpLayout().params.filter(Boolean);
    const presetCells = params.filter(p => p.renderStyle === 'preset');
    eq('preset_dup: exactly one preset knob across all pages', presetCells.length, 1);
    eq('preset_dup: preset key is "preset"', presetCells[0]?.key, 'preset');
    // Regular knobs survive the dedupe.
    eq('preset_dup: base_note still present', params.some(p => p.key === 'base_note'), true);
    // Dedicated Preset page exists (root has 8 knobs → presetSeparate).
    eq('preset_dup: first bank = Preset', m.getViewModel().bankName, 'Preset');
}

/* ── B1: chain_params with no ui_hierarchy still builds param pages ───────── */

_log('\nTest: chain_params-only module builds pages (B1)');

{
    const m = bootModel(MOCK_SYNTHS.chainparams_only);
    const dump = m.dumpLayout();
    const params = dump.params.filter(Boolean);
    // 9 user params (ui_page skipped) → 2 pages of 8.
    eq('chainparams_only: 9 params (ui_* skipped)', params.length, 9);
    eq('chainparams_only: no ui_page param', params.some(p => p.key === 'ui_page'), false);
    eq('chainparams_only: bankCount = 2', m.getBankCount(), 2);
    // chain_params order preserved.
    eq('chainparams_only: first param = map_x', params[0]?.key, 'map_x');
    // Metadata carried through: enum, filepath, ranges.
    const mode = params.find(p => p.key === 'mode');
    eq('chainparams_only: mode is enum', mode?.type, 'enum');
    eq('chainparams_only: mode options length 3', mode?.options?.length, 3);
    const sample = params.find(p => p.key === 'sample');
    eq('chainparams_only: sample is file', sample?.type, 'file');
    const gain = params.find(p => p.key === 'gain');
    eq('chainparams_only: gain max = 2', gain?.max, 2);
    const spread = params.find(p => p.key === 'spread');
    eq('chainparams_only: spread is int', spread?.type, 'int');
    eq('chainparams_only: spread min = -12', spread?.min, -12);
    // filepath must not be double-added by the orphan-filepath injection.
    eq('chainparams_only: sample appears once', params.filter(p => p.key === 'sample').length, 1);
}

/* Existing hierarchy-driven mocks are unaffected by the B1 fallback. */
{
    eq('test8 unaffected: bankCount = 1', bootModel(MOCK_SYNTHS.test8).getBankCount(), 1);
    eq('moog unaffected: bankCount = 12', bootModel(MOCK_SYNTHS.moog).getBankCount(), 12);
    eq('granny unaffected: sample is file',
        bootModel(MOCK_SYNTHS.granny_like).dumpLayout().params.find(p => p?.key === 'sample_path')?.type,
        'file');
}

/* ── C4: metadata-less params infer int type + range on first read ───────── */

_log('\nTest: guessed-meta params infer int/range on read (C4)');

{
    const m = bootModel(MOCK_SYNTHS.guessed_meta);
    // Right after load only knob 0 (base_note) has been refreshed; a later knob
    // is still the raw float guess, flagged for inference.
    const atLoad = m.dumpLayout().params.filter(Boolean);
    eq('guessed_meta: plugin_index guessed float at load', atLoad.find(p => p.key === 'plugin_index')?.type, 'float');
    eq('guessed_meta: plugin_index flagged metaGuessed',   atLoad.find(p => p.key === 'plugin_index')?.metaGuessed, true);

    // Ticks cycle refreshOneParam over every param → first read triggers inference.
    for (let i = 0; i < 60; i++) m.tick();

    // Positive int → 0 .. smallest power-of-two ≥ value.
    eq('guessed_meta: base_note inferred int',    m.paramRangeByKey('base_note')?.type, 'int');
    eq('guessed_meta: base_note widened max = 64', m.paramRangeByKey('base_note')?.max, 64);
    eq('guessed_meta: base_note value = 60',       m.getValueByKey('base_note'), 60);
    eq('guessed_meta: plugin_index max = 4 (pow2 ≥ 3)', m.paramRangeByKey('plugin_index')?.max, 4);

    // Negative → symmetric bounds.
    eq('guessed_meta: transpose inferred int', m.paramRangeByKey('transpose')?.type, 'int');
    eq('guessed_meta: transpose min = -24',    m.paramRangeByKey('transpose')?.min, -24);
    eq('guessed_meta: transpose max = 24',     m.paramRangeByKey('transpose')?.max, 24);

    // Float in [0,1] keeps the guess.
    eq('guessed_meta: depth stays float', m.paramRangeByKey('depth')?.type, 'float');
    eq('guessed_meta: depth max = 1',     m.paramRangeByKey('depth')?.max, 1);

    // metaGuessed cleared after inference (learned once, like enumFmt).
    eq('guessed_meta: base_note metaGuessed cleared',
        m.dumpLayout().params.find(p => p?.key === 'base_note')?.metaGuessed, undefined);
}

/* meta-infer pure helper — direct unit tests. */
_log('\nTest: inferGuessedMeta pure helper (C4)');
{
    const { inferGuessedMeta } = await import('../dist/esm/model/meta-infer.js');
    const base = { type: 'float', min: 0, max: 1, step: 0.02 };
    eq('infer: int 60 → int',          inferGuessedMeta(base, '60')?.type, 'int');
    eq('infer: int 60 → max 64',       inferGuessedMeta(base, '60')?.max, 64);
    eq('infer: int 60 → min 0',        inferGuessedMeta(base, '60')?.min, 0);
    eq('infer: int 60 → step 1',       inferGuessedMeta(base, '60')?.step, 1);
    eq('infer: int -24 → min -24',     inferGuessedMeta(base, '-24')?.min, -24);
    eq('infer: int -24 → max 24',      inferGuessedMeta(base, '-24')?.max, 24);
    eq('infer: int 30 → pow2 max 32',  inferGuessedMeta(base, '30')?.max, 32);
    eq('infer: int 64 → max 64',       inferGuessedMeta(base, '64')?.max, 64);
    eq('infer: float 0.5 → no change', inferGuessedMeta(base, '0.5'), null);
    eq('infer: value 1 → no change',   inferGuessedMeta(base, '1'), null);
    eq('infer: value 0 → no change',   inferGuessedMeta(base, '0'), null);
    eq('infer: non-numeric → no change', inferGuessedMeta(base, 'abc'), null);
}

/* ── C2: on-screen short-name dedup ──────────────────────────────────────── */

_log('\nTest: dedupShortNames — collisions resolved to unique names');

function dedup(labels) {
    return dedupShortNames(labels.map(l => ({ label: l, shortLabel: null })), 5);
}
function assertUnique(tag, labels, names) {
    // Two names may match only if their labels are identical.
    const seen = new Map();
    let dup = null;
    names.forEach((n, i) => {
        if (seen.has(n) && seen.get(n) !== labels[i]) dup = `${n} (${labels[i]} vs ${seen.get(n)})`;
        seen.set(n, labels[i]);
    });
    eq(`${tag}: all shortNames unique`, dup, null);
    eq(`${tag}: all ≤ 5 chars`, names.every(n => n.length <= 5 && n.length > 0), true);
}

{
    // chordism Oscillators — the headline bug: "Wave/Shape 1..4" → bare digits.
    const osc = ["Wave 1","Wave 2","Wave 3","Wave 4","Shape 1","Shape 2","Shape 3","Shape 4"];
    const n = dedup(osc);
    assertUnique('osc', osc, n);
    eq('osc: Wave 1 → WAVE1', n[0], 'WAVE1');
    eq('osc: Wave 4 → WAVE4', n[3], 'WAVE4');
    eq('osc: Shape 1 → SHAP1', n[4], 'SHAP1');
    eq('osc: Shape 3 → SHAP3', n[6], 'SHAP3');
}
{
    // chordism Delay — persisting collisions after one strip (TONE, MOD).
    const delay = ["Delay Mix","Delay Time","Delay Feedback","Delay Tone Hi",
                   "Delay Tone Lo","Delay Mode","Delay Mod Rate","Delay Mod Depth"];
    const n = dedup(delay);
    assertUnique('delay', delay, n);
    eq('delay: Tone Hi → TONHI', n[3], 'TONHI');
    eq('delay: Tone Lo → TONLO', n[4], 'TONLO');
    eq('delay: Mod Rate → RATE',  n[6], 'RATE');
    eq('delay: Mod Depth → DEPTH', n[7], 'DEPTH');
}
{
    // chordism Ctrl Src — deep prefix ("Ctrl to ...") + a ≤2 tail ("FM").
    const ctrl = ["Ctrl Src","Ctrl CC","Ctrl to Cutoff","Ctrl to Morph",
                  "Ctrl to Vibrato","Ctrl to Shape","Ctrl to FM"];
    const n = dedup(ctrl);
    assertUnique('ctrl', ctrl, n);
    eq('ctrl: to Cutoff → CUTOF', n[2], 'CUTOF');
    // "Ctrl to FM" already shortens to a unique "TO FM" — a non-colliding name,
    // so it must be left unchanged (per the no-baseline-shift rule).
    eq('ctrl: to FM → TO FM',     n[6], 'TO FM');
}
{
    // chordism Morph — a 4-way MORPH collision with no shared leading word.
    const morph = ["Morph","Morph Int","Lvl Morph LFO Rate","Lvl Morph LFO Depth",
                   "Pan Morph","Pan Int","Pan Morph LFO Rate","Pan Morph LFO Depth"];
    const n = dedup(morph);
    assertUnique('morph', morph, n);
    eq('morph: plain Morph → MORPH', n[0], 'MORPH');
}
{
    // surge Amp Envelope — DECAY vs DECAY SHAPE.
    const amp = ["Amp EG Attack","Amp EG Decay","Amp EG Sustain","Amp EG Release",
                 "Amp EG Attack Shape","Amp EG Decay Shape","Amp EG Release Shape","Amp EG Envelope Mode"];
    const n = dedup(amp);
    assertUnique('amp', amp, n);
    eq('amp: Decay → DECAY',       n[1], 'DECAY');
    eq('amp: Decay Shape → SHAPE', n[5], 'SHAPE');
}
{
    // surge Oscillator 1 — WIDTH 1/2 with a deep common prefix.
    const surgeOsc = ["Osc 1 Type","Osc 1 Pitch","Osc 1 Shape","Osc 1 Width 1",
                      "Osc 1 Width 2","Osc 1 Sub Mix","Osc 1 Sync","Osc 1 Unison Detune"];
    const n = dedup(surgeOsc);
    assertUnique('surgeOsc', surgeOsc, n);
    eq('surgeOsc: Width 1 → WIDT1', n[3], 'WIDT1');
    eq('surgeOsc: Width 2 → WIDT2', n[4], 'WIDT2');
}
{
    // palette Main — AMOUNT/MACRO ×4 with a distinguishing "FXn" head word.
    const pal = ["FX1 Amount","FX1 Macro","FX2 Amount","FX2 Macro",
                 "FX3 Amount","FX3 Macro","FX4 Amount","FX4 Macro"];
    assertUnique('palette', pal, dedup(pal));
}
{
    // Explicit shortLabels are never altered, even when they collide.
    const entries = [
        { label: "Foo Bar", shortLabel: "SAME" },
        { label: "Baz Qux", shortLabel: "SAME" },
    ];
    const n = dedupShortNames(entries, 5);
    eq('explicit shortLabels preserved', JSON.stringify(n), JSON.stringify(["SAME", "SAME"]));
}
{
    // Non-colliding labels keep their plain autoShorten form.
    const plain = ["Cutoff", "Reso", "Drive", "Volume"];
    eq('non-colliding unchanged', JSON.stringify(dedup(plain)),
        JSON.stringify(["CUTOF", "RESO", "DRIVE", "VOLUM"]));
}

_log('\nTest: colliding page renders unique shortNames through the model');
{
    const vm = bootModel(MOCK_SYNTHS.collide_osc).getViewModel();
    const names = vm.rows.flat().filter(Boolean).map(c => c.shortName);
    eq('collide_osc: 8 knobs shown', names.length, 8);
    eq('collide_osc: all shortNames unique', new Set(names).size, 8);
}

/* ── isEmpty flag ─────────────────────────────────────────────────────────── */

_log('\nTest: vm.isEmpty');

eq('no_params: isEmpty = true',  bootModel(MOCK_SYNTHS.no_params).getViewModel().isEmpty, true);
eq('test8: isEmpty = false',     bootModel(MOCK_SYNTHS.test8).getViewModel().isEmpty,     false);

/* ── master FX module read key ─────────────────────────────────────────────
 * Track components expose the loaded module id via an underscore alias
 * (fx1_module); master FX has none and is read with its colon key
 * (master_fx:fx1:module). A wrong key here left an added master FX module
 * reading back empty ("click jog to add"). */
_log('\nTest: master FX module detection');
{
    const { moduleReadKey } = await import('../dist/esm/chain/config.js');
    eq('track module read key', moduleReadKey('fx1'), 'fx1_module');
    eq('master module read key', moduleReadKey('master_fx:fx1'), 'master_fx:fx1:module');

    // A master FX slot whose module id is set under the colon key is detected
    // as loaded (not empty) — the bug was the model reading the underscore key.
    const preset = {
        'master_fx:fx1:module':       'reverb',
        'master_fx:fx1:name':         'Reverb',
        'master_fx:fx1:ui_hierarchy': JSON.stringify({ levels: { root: { knobs: ['mix'] } } }),
        'master_fx:fx1:chain_params': JSON.stringify([{ key: 'mix', name: 'Mix', type: 'float', min: 0, max: 1 }]),
        'master_fx:fx1:mix':          '0.5',
    };
    const vm = bootModel(preset, 0, 'master_fx:fx1').getViewModel();
    eq('master FX module detected (not empty)', vm.isEmpty, false);
    eq('master FX module name', vm.moduleName, 'Reverb');
}

/* ── row params populated ─────────────────────────────────────────────────── */

_log('\nTest: vm.rows populated correctly');

{
    const vm = bootModel(MOCK_SYNTHS.test8).getViewModel();
    const nonNull = vm.rows.flat().filter(Boolean).length;
    eq('test8: 8 params in rows', nonNull, 8);
}

{
    const vm = bootModel(MOCK_SYNTHS.no_params).getViewModel();
    const nonNull = vm.rows.flat().filter(Boolean).length;
    eq('no_params: 0 params in rows', nonNull, 0);
}

/* ── granny-style: filepath in chain_params but absent from all knobs arrays ── */

_log('\nTest: filepath absent from knobs arrays is injected into Main page');

{
    const m = bootModel(MOCK_SYNTHS.granny_like);
    const vm = m.getViewModel();
    const first = vm.rows[0][0];
    eq('granny_like: first knob = sample_path (file)', first?.type, 'file');
    eq('granny_like: sample_path fullName = Sample File', first?.fullName, 'Sample File');
    eq('granny_like: position still present', vm.rows[0][1]?.fullName, 'Position');
}

/* ── file param detection ─────────────────────────────────────────────────── */

_log('\nTest: file param detected from chain_params type:filepath');

{
    const m = bootModel(MOCK_SYNTHS.file_param);
    const vm = m.getViewModel();
    const sampleKnob = vm.rows[0][0];
    eq('file_param: sample knob type = file', sampleKnob?.type, 'file');
    eq('file_param: vol knob type = float',   vm.rows[0][1]?.type, 'float');
}

/* ── file overlay behavior ────────────────────────────────────────────────── */

_log('\nTest: file overlay opens on touch with dir scan');

{
    mockFsEntries['/data/UserData/Samples'] = ['hat.wav', 'kick.wav', 'snare.wav'];
    const m  = bootModel(MOCK_SYNTHS.file_param);
    for (let i = 0; i < 20; i++) m.tick();
    m.handleKnobTouch(0);
    const vm = m.getViewModel();
    eq('file overlay: 3 items',         vm.overlay?.options.length, 3);
    eq('file overlay: slot = 0',        vm.overlay?.slot, 0);
    eq('file overlay: selected = kick', vm.overlay?.options[vm.overlay.selected], 'kick.wav');
}

_log('\nTest: file overlay scrolls with knob delta');

{
    mockFsEntries['/data/UserData/Samples'] = ['hat.wav', 'kick.wav', 'snare.wav'];
    const m = bootModel(MOCK_SYNTHS.file_param);
    for (let i = 0; i < 20; i++) m.tick();
    m.handleKnobTouch(0);
    m.handleKnobDelta(0, 4);  // ENUM_DELTA_DIV=4 → 1 step
    eq('file overlay: moved to snare', m.getViewModel().overlay?.selected, 2);
    m.handleKnobDelta(0, -4);
    eq('file overlay: moved back to kick', m.getViewModel().overlay?.selected, 1);
}

_log('\nTest: file overlay commits on release');

{
    mockFsEntries['/data/UserData/Samples'] = ['hat.wav', 'kick.wav', 'snare.wav'];
    const m = bootModel({ ...MOCK_SYNTHS.file_param });
    for (let i = 0; i < 20; i++) m.tick();
    m.handleKnobTouch(0);
    m.handleKnobDelta(0, 8);  // 2 steps: sorted hat[0],kick[1],snare[2]; kick→idx1+2=3 clamped→2=snare
    m.handleKnobRelease(0);
    eq('file overlay: committed to shadow', env.params['synth:sample'], '/data/UserData/Samples/snare.wav');
    eq('file overlay: dismissed',          m.getViewModel().overlay, null);
}

/* ── enum value format: name-based vs index-based modules ─────────────────── */

_log('\nTest: enum value format helpers');

{
    const div = ["1/4.", "1/4", "1/4T", "1/8.", "1/8", "1/8T", "1/16.", "1/16", "1/16T", "1/32"];
    eq('rawToIndex: name → index',        enumRawToIndex(div, "1/8."), 3);
    eq('rawToIndex: index string → index', enumRawToIndex(div, "3"),    3);
    eq('rawToIndex: out-of-range clamps',  enumRawToIndex(div, "99"),   9);
    eq('rawToIndex: garbage → 0',          enumRawToIndex(div, "xyz"),  0);
    eq('usesIndex: known name → false',    enumUsesIndex(div, "1/8."),  false);
    eq('usesIndex: numeric → true',        enumUsesIndex(div, "2"),     true);
    eq('usesIndex: null → true (legacy)',  enumUsesIndex(div, null),    true);
    eq('setValue: name format',            enumSetValue(div, 3, false), "1/8.");
    eq('setValue: index format',           enumSetValue(div, 3, true),  "3");
}

_log('\nTest: name-based enum reads back to the right option (not parseFloat-collapsed)');

{
    const m  = bootModel(MOCK_SYNTHS.name_enum);
    for (let i = 0; i < 20; i++) m.tick();   // let staggered refresh read division
    const vm = m.getViewModel();
    // "1/8" is index 4; the old parseFloat("1/8")===1 bug pinned this to "1/4".
    eq('name enum: division shows 1/8', vm.rows[0][0].displayValue, '1/8');
    eq('name enum: enumIndex = 4',      vm.rows[0][0].enumIndex,    4);
}

_log('\nTest: name-based enum overlay commits the option NAME (arp-style module)');

{
    const m = bootModel(MOCK_SYNTHS.name_enum);
    for (let i = 0; i < 20; i++) m.tick();
    m.handleKnobTouch(0);                 // division has 10 options → overlay opens
    eq('name enum: overlay seeded at 4', m.getViewModel().overlay?.selected, 4);
    m.handleKnobDelta(0, -4);             // ENUM_DELTA_DIV=4 → one step back → index 3
    m.handleKnobRelease(0);
    eq('name enum: committed NAME 1/8.', env.params['synth:division'], '1/8.');
    eq('name enum: not the index "3"',   env.params['synth:division'] === '3', false);
}

_log('\nTest: index-based enum (majority) is unchanged — reads + commits the INDEX');

{
    const m  = bootModel(MOCK_SYNTHS.index_enum);
    for (let i = 0; i < 20; i++) m.tick();
    const vm = m.getViewModel();
    eq('index enum: model shows Wave', vm.rows[0][0].displayValue, 'Wave');  // index 2
    eq('index enum: enumIndex = 2',    vm.rows[0][0].enumIndex,    2);
    m.handleKnobTouch(0);                 // 8 options → overlay opens
    m.handleKnobDelta(0, 4);              // one step forward → index 3
    m.handleKnobRelease(0);
    eq('index enum: committed INDEX "3"', env.params['synth:model'], '3');
}

/* ── viewmodel: file display value and browseHint ─────────────────────────── */

_log('\nTest: file knob displayValue = basename of current path');

{
    const m = bootModel(MOCK_SYNTHS.file_param);
    for (let i = 0; i < 20; i++) m.tick();
    const vm = m.getViewModel();
    eq('file knob displayValue = kick.wav', vm.rows[0][0]?.displayValue, 'kick.wav');
}

_log('\nTest: browseHint = true when file param is primary touched slot');

{
    mockFsEntries['/data/UserData/Samples'] = ['kick.wav'];
    const m = bootModel(MOCK_SYNTHS.file_param);
    for (let i = 0; i < 20; i++) m.tick();
    m.handleKnobTouch(0);
    eq('toast.browseHint = true',   m.getViewModel().toast?.browseHint, true);
    eq('toast.fullName = Sample',   m.getViewModel().toast?.fullName, 'Sample');
}

_log('\nTest: browseHint = false for non-file param touch');

{
    const m = bootModel(MOCK_SYNTHS.test8);
    m.handleKnobTouch(0);
    eq('toast.browseHint = false for float', m.getViewModel().toast?.browseHint, false);
}

// ── Drum module detection ─────────────────────────────────────────────────

_log('\nTest: drum module detection via loadHierarchy');

{
  const mrdrumsPreset = {
    'synth:name': 'MrDrums',
    'synth_module': 'mrdrums',
    'synth:pad_vol': '0.8',
    'synth:ui_current_pad': '3',
  };

  const m = bootModel(mrdrumsPreset);
  const vm = m.getViewModel();
  eq('mrdrums: isDrum via drumPadCount', vm.drumPadCount, 16);
  // Focus is movy-owned: defaults to 1, NOT seeded from the DSP's ui_current_pad.
  eq('mrdrums: drumCurrentPad defaults to 1', vm.drumCurrentPad, 1);

  const krautPreset = {
    'synth:name': 'KrautDrums',
    'synth_module': 'krautdrums',
    'synth:lvl_bass': '0.85',
  };
  const mk = bootModel(krautPreset);
  const vmk = mk.getViewModel();
  eq('krautdrums: drumPadCount=16', vmk.drumPadCount, 16);
  eq('krautdrums: drumCurrentPad defaults to 1', vmk.drumCurrentPad, 1);

  const plaitsPreset = {
    'synth:name': 'Plaits',
    'synth_module': 'plaits',
  };
  const mp = bootModel(plaitsPreset);
  eq('plaits: not drum (drumPadCount=0)', mp.getViewModel().drumPadCount, 0);
}

// ── mrdrums preset file param: browse metadata + filtering + validation ───

const MRDRUMS_PRESET = {
  'synth:name': 'MrDrums',
  'synth_module': 'mrdrums',
};
const TRACK_PRESETS = '/data/UserData/UserLibrary/Track Presets';

/* Navigate to the preset knob. Each config bank owns one full page, so
 * ui_preset_path sits at physical slot 0 of the last bank (Preset). */
function touchMrdrumsPreset(m) {
  m.changePage(m.getBankCount());  // clamps to the last page (Preset bank)
  m.handleKnobTouch(0);
}

_log('\nTest: mrdrums preset param keeps fileFilter/fileStartPath/requireContains');

{
  const m = bootModel(MRDRUMS_PRESET);
  touchMrdrumsPreset(m);
  const t = m.getFileBrowseTarget();
  eq('preset target key', t?.key, 'ui_preset_path');
  eq('preset filter = .ablpreset', JSON.stringify(t?.filter), JSON.stringify(['.ablpreset']));
  eq('preset start path = Track Presets', t?.startPath, TRACK_PRESETS);
  eq('preset requireContains = drumRack', t?.requireContains, 'drumRack');
}

_log('\nTest: preset overlay starts in Track Presets and hides folders + wrong files');

{
  mockFsEntries[TRACK_PRESETS] = ['Kits', 'drum.ablpreset', 'loop.wav', 'synth.ablpreset'];
  const m = bootModel(MRDRUMS_PRESET);
  touchMrdrumsPreset(m);
  const opts = m.getViewModel().overlay?.options ?? [];
  eq('overlay only shows .ablpreset files', opts.length, 2);
  eq('overlay excludes folder Kits', opts.some(p => p.endsWith('/Kits')), false);
  eq('overlay excludes loop.wav', opts.some(p => p.endsWith('.wav')), false);
}

_log('\nTest: fileContentAllows accepts drumRack, rejects others');

{
  const { fileContentAllows } = await import('../dist/esm/model/file-validate.js');
  const saved = globalThis.host_read_file;
  globalThis.host_read_file = (p) => p.endsWith('drum.ablpreset')
    ? '{ "kind": "drumRack", "chains": [] }'
    : '{ "kind": "instrumentRack" }';
  eq('drumRack preset allowed', fileContentAllows('/x/drum.ablpreset', 'drumRack'), true);
  eq('non-drumRack preset rejected', fileContentAllows('/x/synth.ablpreset', 'drumRack'), false);
  eq('no token required → always allowed', fileContentAllows('/x/synth.ablpreset', undefined), true);
  globalThis.host_read_file = () => null;
  eq('unreadable file fails open (allowed)', fileContentAllows('/x/drum.ablpreset', 'drumRack'), true);
  globalThis.host_read_file = saved;
}

_log('\nTest: overlay commit rejects a non-drum preset (param unchanged)');

{
  mockFsEntries[TRACK_PRESETS] = ['drum.ablpreset', 'synth.ablpreset'];
  const saved = globalThis.host_read_file;
  // Override only across the release/validation — loadModuleConfig also reads
  // via host_read_file, so the model must boot with the real (null) impl first.
  const presetContent = (p) => p.endsWith('drum.ablpreset')
    ? '{ "kind": "drumRack" }' : '{ "kind": "instrumentRack" }';

  // sorted: drum.ablpreset[0], synth.ablpreset[1]
  const m = bootModel(MRDRUMS_PRESET);
  touchMrdrumsPreset(m);
  m.handleKnobDelta(0, 4);  // → synth.ablpreset (wrong type)
  globalThis.host_read_file = presetContent;
  const rejected = m.handleKnobRelease(0);
  globalThis.host_read_file = saved;
  eq('wrong preset → handleKnobRelease returns true', rejected, true);
  eq('wrong preset → param not set', env.params['synth:ui_preset_path'], undefined);

  const m2 = bootModel(MRDRUMS_PRESET);
  touchMrdrumsPreset(m2);  // selected idx 0 = drum.ablpreset
  globalThis.host_read_file = presetContent;
  const ok2 = m2.handleKnobRelease(0);
  globalThis.host_read_file = saved;
  eq('drum preset → not rejected', ok2, false);
  eq('drum preset → param set', env.params['synth:ui_preset_path'], TRACK_PRESETS + '/drum.ablpreset');
}

_log('\nTest: track colors — track 3 pink, track 4 blue');

{
  const { TRACK_COLOR, TRACK_COLOR_DIM } = await import('../dist/esm/seq/colors.js');
  eq('track 3 = BrightPink(25)', TRACK_COLOR[2], 25);
  eq('track 4 = Blue(125)',      TRACK_COLOR[3], 125);
  eq('track 3 dim = DeepMagenta(109)', TRACK_COLOR_DIM[2], 109);
  eq('track 4 dim = DarkBlue(95)',     TRACK_COLOR_DIM[3], 95);
}

// ── ViewModel drum fields: isPadSpecific, drumCurrentPad, drumPadCount ───

_log('\nTest: ViewModel drum fields');

{
  const mrdrumsPreset = {
    'synth:name': 'MrDrums',
    'synth_module': 'mrdrums',
    'synth:ui_current_pad': '5',
    'synth:pad_vol': '0.8',
  };
  const m = bootModel(mrdrumsPreset);

  // Main bank (index 0) has padSpecific=true
  const vm0 = m.getViewModel();
  eq('mrdrums Main bank isPadSpecific', vm0.isPadSpecific, true);
  eq('mrdrums drumCurrentPad defaults to 1', vm0.drumCurrentPad, 1);
  eq('mrdrums drumPadCount', vm0.drumPadCount, 16);

  // KrautDrums: all banks default to padSpecific=false
  const krautPreset = {
    'synth:name': 'KrautDrums',
    'synth_module': 'krautdrums',
    'synth:lvl_bass': '0.5',
  };
  const mk = bootModel(krautPreset);
  const vmk = mk.getViewModel();
  eq('krautdrums bank 0 isPadSpecific=false (default)', vmk.isPadSpecific, false);
  eq('krautdrums drumPadCount', vmk.drumPadCount, 16);

  // Navigate to a different bank and verify it's also not padSpecific
  mk.changePage(1);
  const vmk2 = mk.getViewModel();
  eq('krautdrums bank 1 isPadSpecific=false (default)', vmk2.isPadSpecific, false);

  // Non-drum module
  const plaitsPreset = { 'synth:name': 'Plaits', 'synth_module': 'plaits' };
  const mp = bootModel(plaitsPreset);
  eq('plaits isPadSpecific=false', mp.getViewModel().isPadSpecific, false);
  eq('plaits drumPadCount=0', mp.getViewModel().drumPadCount, 0);
}

/* ── pad-scoping helper ──────────────────────────────────────────────────── */

_log('\nTest: pad-scope concreteKey');
{
  const { concreteKey } = await import('../dist/esm/model/pad-scope.js');
  const ps = { aliasPrefix: 'pad_', concreteKeyTemplate: 'p{pad}_{suffix}', padDigits: 2 };
  eq('alias→concrete pad 3', concreteKey(ps, 3, 'pad_vol'), 'p03_vol');
  eq('non-pad passthrough', concreteKey(ps, 3, 'g_master_vol'), 'g_master_vol');
  eq('no config passthrough', concreteKey(undefined, 3, 'pad_vol'), 'pad_vol');
  // Genericness: a totally different scheme must work with zero code change.
  const alt = { aliasPrefix: 'v_', concreteKeyTemplate: 'voice{pad}.{suffix}', padDigits: 3 };
  eq('generic template', concreteKey(alt, 7, 'v_cut'), 'voice007.cut');
}

/* ── Mr Drums: focused-pad scoping ───────────────────────────────────────── */

_log('\nTest: mrdrums per-pad scoping');
{
  // Focus is movy-owned: defaults to 1 even though the mock DSP reports
  // ui_current_pad=5 (no longer seeded from the DSP).
  const md = bootModel(MOCK_SYNTHS.mrdrums, 0, 'synth');
  eq('focus defaults to 1 (not DSP pad 5)', md.getViewModel().drumCurrentPad, 1);

  // A normal knob turn writes the concrete focused-pad key, never the alias.
  const seen = [];
  const origSet = globalThis.shadow_set_param;
  globalThis.shadow_set_param = (s, k, v) => { seen.push(k); return origSet(s, k, v); };
  md.handleKnobDelta(1, 5);  // page 0, knob 1 = pad_vol (VOL); queued
  md.tick();                 // flush pending delta through applyKnobDelta
  globalThis.shadow_set_param = origSet;
  eq('normal edit writes p01_vol', seen.includes('synth:p01_vol'), true);
  eq('normal edit avoids alias pad_vol', seen.includes('synth:pad_vol'), false);

  // The automation info exposes the concrete I/O key for lane assignment.
  const info = md.getKnobParamInfo(1);
  eq('ioKey is concrete for focused pad', info.ioKey, 'p01_vol');
  eq('pad VOL automatable', info.automatable, true);

  // Switching the focused pad re-reads that pad's values immediately.
  md.updateDrumPad(5, 76);
  eq('focus moved to pad 5', md.getViewModel().drumCurrentPad, 5);
  eq('VOL re-read for pad 5 (p05_vol=0.50)', md.getKnobParamInfo(1).value, 0.5);
  eq('ioKey follows focus', md.getKnobParamInfo(1).ioKey, 'p05_vol');

  // A Global-bank numeric param is non-automatable via bank.global (not `g_`).
  md.changePage(2);  // Main(0) → Rand(1) → Global(2)
  const gInfo = md.getKnobParamInfo(0); // g_master_vol
  eq('global param non-automatable', gInfo?.automatable ?? false, false);
}

/* ── Weird Dreams: same scoping via a different naming scheme ─────────────── */

_log('\nTest: weird-dreams per-voice scoping');
{
  // cv_* alias → concrete v{pad}_{suffix}, 1-indexed, no padding, no currentPadParam.
  const wd = bootModel(MOCK_SYNTHS.weird_dreams, 0, 'synth');
  eq('focus defaults to 1', wd.getViewModel().drumCurrentPad, 1);
  eq('VOL reads v1_vol (0.11)', wd.getKnobParamInfo(0).value, 0.11);
  eq('ioKey is v1_vol', wd.getKnobParamInfo(0).ioKey, 'v1_vol');

  // Switch focus → reads voice 3's concrete keys.
  wd.updateDrumPad(3, 70);
  eq('focus moved to voice 3', wd.getViewModel().drumCurrentPad, 3);
  eq('VOL re-read for v3 (0.33)', wd.getKnobParamInfo(0).value, 0.33);
  eq('ioKey follows focus to v3_vol', wd.getKnobParamInfo(0).ioKey, 'v3_vol');
}

/* ── drumPadOn / drumPadOff ──────────────────────────────────────────────── */

_log('\nTest: drumPadOn');

{
  let sentMidi = [];
  let setParams = {};
  const origSendMidi  = globalThis.shadow_send_midi_to_dsp;
  const origSetParam  = globalThis.shadow_set_param;
  globalThis.shadow_send_midi_to_dsp = (msg) => { sentMidi.push([...msg]); };
  globalThis.shadow_set_param = (_s, key, val) => { setParams[key] = val; return true; };

  const mrdCfg = { padCount: 16, padNoteStart: 36, rawMidi: false, currentPadParam: 'ui_current_pad' };

  // pad 68, rawMidi=false, rootNote=36: PAD_MAP[0]=0 → midiNote=36 → drumPad=1
  sentMidi = []; setParams = {};
  const r1 = drumPadOn(68, 68, false, mrdCfg, 36, 'synth', 0, 100);
  eq('mrdrums pad68 → drumPad 1', r1, 1);
  eq('sends NoteOn 36', sentMidi[0]?.[1], 36);
  eq('velocity 100', sentMidi[0]?.[2], 100);
  eq('sets ui_current_pad=1', setParams['synth:ui_current_pad'], '1');

  // pad 76: padIdx=8, col=0, row=1 → drumPad=5, midiNote=40
  sentMidi = []; setParams = {};
  const r2 = drumPadOn(76, 68, false, mrdCfg, 36, 'synth', 0, 100);
  eq('mrdrums pad76 → drumPad 5', r2, 5);
  eq('mrdrums pad76 → midiNote 40', sentMidi[0]?.[1], 40);

  // shift+pad (no shiftSelectMidi) → suppresses MIDI, still sets param
  sentMidi = []; setParams = {};
  const r3 = drumPadOn(68, 68, true, mrdCfg, 36, 'synth', 0, 100);
  eq('shift+pad returns drumPad 1', r3, 1);
  eq('shift: no MIDI sent', sentMidi.length, 0);
  eq('shift: still sets param', setParams['synth:ui_current_pad'], '1');

  // shiftSelectMidi=true (weird-dreams) → sends vel=1
  const wdCfg = { padCount: 8, padNoteStart: 36, rawMidi: false, shiftSelectMidi: true };
  sentMidi = [];
  drumPadOn(68, 68, true, wdCfg, 36, 'synth', 0, 100);
  eq('shiftSelectMidi: sends vel=1', sentMidi[0]?.[2], 1);

  // rawMidi=true (krautdrums): midiNote=physPad → drumPad=physPad-padNoteStart+1
  const kCfg = { padCount: 16, padNoteStart: 68, rawMidi: true };
  sentMidi = []; setParams = {};
  const r4 = drumPadOn(68, 68, false, kCfg, 36, 'synth', 0, 100);
  eq('krautdrums pad68 → drumPad 1', r4, 1);
  eq('rawMidi sends pad note 68', sentMidi[0]?.[1], 68);

  // rawMidi out-of-range: kCfg padCount=16, pad84=drumPad17
  sentMidi = [];
  const r5 = drumPadOn(84, 68, false, kCfg, 36, 'synth', 0, 100);
  eq('rawMidi out-of-range → null', r5, null);

  // right-half column (col=4, pad72): inactive for rawMidi=false
  sentMidi = [];
  const r6 = drumPadOn(72, 68, false, mrdCfg, 36, 'synth', 0, 100);
  eq('grid col>=4 → null', r6, null);
  eq('grid col>=4: no MIDI', sentMidi.length, 0);

  // Held tracking: a sounding pad registers in keyboardState.held so the drum
  // grid can light it green; release clears it. A shift-select makes no sound,
  // so it must not register as held.
  const { keyboardState } = await import('../dist/esm/keyboard/state.js');
  for (const k of Object.keys(keyboardState.held)) delete keyboardState.held[+k];
  drumPadOn(76, 68, false, mrdCfg, 36, 'synth', 0, 100);   // sounds midiNote 40
  eq('held pad tracked (phys→midi)', keyboardState.held[76], 40);
  drumPadOff(76, 68, mrdCfg, 36, 0);
  eq('held pad cleared on release', keyboardState.held[76], undefined);
  drumPadOn(68, 68, true, mrdCfg, 36, 'synth', 0, 100);     // shift-select, silent
  eq('shift-select not held', keyboardState.held[68], undefined);
  for (const k of Object.keys(keyboardState.held)) delete keyboardState.held[+k];

  globalThis.shadow_send_midi_to_dsp = origSendMidi;
  globalThis.shadow_set_param = origSetParam;
}

/* ── seq engine plumbing: cmd batching + status polling ──────────────────── */
{
    _log('\nseq engine plumbing:');
    const { installMockEngine, uninstallMockEngine } = await import('./mock-engine.mjs');
    const { seqCmd, seqEngineTick, resetSeqEngine, engineAvailable } =
        await import('../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../dist/esm/seq/state.js');

    const engine = installMockEngine();
    resetSeqEngine(); resetSeqState();

    eq('engine detected via host_module_* globals', engineAvailable(), true);
    seqEngineTick(); // boot probe: ping matches → engine ready
    seqEngineTick(); // first post-boot tick polls status

    eq('status poll marks engineOk', seqState.engineOk, true);
    eq('status play=0 parsed', seqState.playing, false);

    // Multiple queued ops must flush as ONE batched set_param (coalescing).
    seqCmd('watch 0');
    seqCmd('non 0 60 100');
    seqCmd('nof 0 60');
    seqEngineTick();
    eq('three ops → one set_param call', engine.cmdBatches.length, 1);
    eq('batch joins ops with ;', engine.cmdBatches[0], 'watch 0;non 0 60 100;nof 0 60');
    eq('ops parsed on engine side', engine.ops.length, 3);

    // No queued ops → no set_param traffic.
    const before = engine.setParamCalls;
    seqEngineTick();
    eq('idle tick sends no cmd', engine.setParamCalls, before);

    // Status changes propagate on the next poll cadence.
    engine.status.play = 1;
    engine.status.tick = 4321;
    engine.status.bpm = 13350;
    for (let i = 0; i < 10; i++) seqEngineTick();
    eq('play state mirrored', seqState.playing, true);
    eq('engine tick mirrored', seqState.engineTick, 4321);
    eq('bpm mirrored', seqState.bpmX100, 13350);

    // Mock engine serializes arbitrary status keys so tests can inject act=.
    const { activeHasNote } = await import('../dist/esm/seq/state.js');
    engine.status.act = '38';            // track 0 pitch 38 sounding
    for (let i = 0; i < 10; i++) seqEngineTick();
    eq('injected act= populates activeNotes', activeHasNote(0, 38), true);
    delete engine.status.act;

    // Unknown status keys must be ignored (forward compat).
    engine.status.tick = 9;
    globalThis.host_module_get_param = (key) =>
        key === 'status' ? 'play=1 tick=9 bpm=13350 future_key=42' : null;
    for (let i = 0; i < 10; i++) seqEngineTick();
    eq('unknown status key ignored', seqState.engineTick, 9);

    // Dead engine (all gets return null): the boot probe re-issues the DSP
    // load a bounded number of times, then gives up for the session.
    const dead = installMockEngine();
    let deadGets = 0;
    globalThis.host_module_get_param = () => { deadGets++; return null; };
    resetSeqEngine(); resetSeqState();
    const { engineReady } = await import('../dist/esm/seq/engine.js');
    for (let i = 0; i < 5000; i++) seqEngineTick();
    eq('dead engine: 3 load attempts', dead.loadRequests.length, 3);
    eq('dead engine: load path correct',
        dead.loadRequests[0], '/data/UserData/schwung/modules/tools/movy/dsp.so');
    eq('dead engine: gives up (not ready)', engineReady(), false);
    eq('dead engine: probing bounded', deadGets <= 40, true);
    eq('dead engine: engineOk stays false', seqState.engineOk, false);

    // Stale engine (wrong version pong): reload requested immediately.
    const e3 = installMockEngine();
    globalThis.host_module_get_param = (key) => (key === 'ping' ? 'pong 0.0.1' : null);
    resetSeqEngine(); resetSeqState();
    seqEngineTick();
    eq('stale engine: reload requested on first probe', e3.loadRequests.length, 1);
    e3.reset();

    // No engine at all: everything is a no-op.
    uninstallMockEngine();
    resetSeqEngine();
    seqCmd('play');
    seqEngineTick();
    eq('no engine: engineAvailable false', engineAvailable(), false);
}

/* ── automation: status fields parse into the mirror ─────────────────────── */
{
    _log('\nautomation status parse:');
    const { parseStatusForTest } = await import('../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../dist/esm/seq/state.js');
    resetSeqState();
    parseStatusForTest('play=0 trk=0 alanes=05 aauto=04 hauto=2:50');
    eq('autoAssigned parsed', seqState.autoAssigned, 0x05);
    eq('autoActive parsed', seqState.autoActive, 0x04);
    eq('heldLocks lane 2 = 50', seqState.heldLocks.get(2), 50);
    // Empty hauto clears the map.
    parseStatusForTest('play=0 trk=0 hauto=');
    eq('empty hauto clears heldLocks', seqState.heldLocks.size, 0);
}

/* ── EXT follow: engine ext= status field ────────────────────────────────── */
{
    _log('\nEXT follow status parse:');
    const { parseStatusForTest } = await import('../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../dist/esm/seq/state.js');
    resetSeqState();
    eq('extSync defaults false', seqState.extSync, false);
    parseStatusForTest('play=1 bpm=12500 ext=1 trk=0');
    eq('ext=1 sets extSync', seqState.extSync, true);
    parseStatusForTest('play=1 bpm=12500 ext=0 trk=0');
    eq('ext=0 clears extSync', seqState.extSync, false);
}

/* ── Play-link toggle: link= status field + LINK Set-page cell ────────────── */
{
    _log('\nPlay-link toggle:');
    const { parseStatusForTest } = await import('../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../dist/esm/seq/state.js');
    const { buildMainPageVM } = await import('../dist/esm/seq/main-page-vm.js');
    resetSeqState();
    eq('linkEnabled defaults false', seqState.linkEnabled, false);
    eq('LINK cell shows OFF by default', buildMainPageVM().rows[1][0].displayValue, 'OFF');
    parseStatusForTest('play=0 ext=0 link=1 trk=0');
    eq('link=1 sets linkEnabled', seqState.linkEnabled, true);
    eq('LINK cell shows ON', buildMainPageVM().rows[1][0].displayValue, 'ON');
    parseStatusForTest('play=0 ext=0 link=0 trk=0');
    eq('link=0 clears linkEnabled', seqState.linkEnabled, false);
}

/* ── tempo override: debounced desired-tempo write ───────────────────────── */
{
    _log('\ntempo override: debounced desired-tempo write');
    const { scheduleTempoOverride, tempoOverrideTick } =
        await import('../dist/esm/seq/tempo-override.js');
    const writes = [];
    globalThis.host_write_file = (p, v) => { writes.push([p, v]); return true; };
    scheduleTempoOverride(12500);
    scheduleTempoOverride(12600);           // knob still turning — supersedes
    for (let i = 0; i < 59; i++) tempoOverrideTick();
    eq('no write during debounce', writes.length, 0);
    tempoOverrideTick();
    eq('single write after debounce', writes.length, 1);
    eq('path', writes[0][0], '/data/UserData/schwung/desired-tempo');
    eq('value is the LAST bpm, 4 decimals', writes[0][1], '126.0000\n');
    delete globalThis.host_write_file;
}

/* ── swing: engine swing status field ────────────────────────────────────── */
{
    _log('\nswing status parse:');
    const { parseStatusForTest } = await import('../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../dist/esm/seq/state.js');
    resetSeqState();
    parseStatusForTest('play=1 bpm=12000 swing=66');
    eq('swing mirrored from status', seqState.swingPct, 66);
}

/* ── seq router: step toggle, chords, drum lanes, bars, Play, watch ──────── */
{
    _log('\nseq router:');
    const { installMockEngine, uninstallMockEngine } = await import('./mock-engine.mjs');
    const { seqHandleMidi, seqNotePadPlayed, seqNotePadReleased, seqSetLane, setMuteHeld } =
        await import('../dist/esm/seq/router.js');
    const { seqEngineTick, resetSeqEngine } = await import('../dist/esm/seq/engine.js');
    const { seqState, resetSeqState, occHasStep, occToggleStep } = await import('../dist/esm/seq/state.js');
    const { resetSeqToast, seqToastActive } = await import('../dist/esm/seq/render.js');

    const engine = installMockEngine();
    resetSeqEngine(); resetSeqState(); resetSeqToast();
    seqEngineTick(); // boot probe → ready
    const lastOp = () => engine.ops[engine.ops.length - 1];
    /* A tap = press then release; the note toggle fires on release. */
    const tapStep = (button) => {
        seqHandleMidi([0x90, 16 + button, 127], false);
        seqHandleMidi([0x80, 16 + button, 0], false);
    };

    eq('pad note not claimed', seqHandleMidi([0x90, 68, 100], false), false);
    eq('knob CC not claimed', seqHandleMidi([0xB0, 71, 65], false), false);

    // Pad play (padNote 80 → midiNote 72) sets the step-entry pitch + holds it.
    seqNotePadPlayed(0, 80, 72, 110);
    eq('pad play recorded as step-entry pitch', seqState.lastPitch[0], 72);

    // Tap step while a pad is held → places that note; toggles on release.
    eq('step note claimed', seqHandleMidi([0x90, 16, 127], false), true);
    seqHandleMidi([0x80, 16, 0], false);
    eq('optimistic occ set', occHasStep(0), true);
    eq('optimistic clip created (1 bar)', seqState.lenSteps, 16);
    eq('step entry does not auto-start', seqState.playing, false);
    seqEngineTick();
    eq('tog cmd emitted', lastOp(), 'tog 0 0 72 110');

    // Two held pads → chord placed in one tog op.
    seqState.playing = false;
    seqNotePadPlayed(0, 81, 74, 100);   // held: 72 and 74
    tapStep(5);                          // step 5
    seqEngineTick();
    eq('chord tog emits both pitches', lastOp(), 'tog 0 5 72 100 74 100');

    // Releasing pads → next step uses the last-played note only.
    seqNotePadReleased(80); seqNotePadReleased(81);
    seqNotePadPlayed(0, 80, 67, 90);
    seqNotePadReleased(80);              // pad released before the step tap
    tapStep(1);                          // step 1
    seqEngineTick();
    eq('after release, single note placed', lastOp(), 'tog 0 1 67 90');

    // Drum-lane mode: seqSetLane(38) → wlane, and a step tap uses ltog.
    seqSetLane(38);
    seqEngineTick();
    eq('wlane cmd emitted', lastOp(), 'wlane 38');
    tapStep(0);
    seqEngineTick();
    eq('drum lane uses ltog', lastOp(), 'ltog 0 0 38 90');
    seqSetLane(-1);
    seqEngineTick();
    eq('melodic lane -1', lastOp(), 'wlane -1');

    // ── Multi-step entry ──────────────────────────────────────────────────
    // Melodic: hold step A + press step B is the length gesture (set A's note
    // length to span A→B), so B is NOT entered as a step.
    resetSeqState(); engine.reset(); resetSeqEngine(); seqEngineTick();
    seqState.lenSteps = 16;
    occToggleStep(0);                            // step 0 occupied → length anchor
    seqHandleMidi([0x90, 16 + 0, 127], false);   // hold occupied step 0
    seqHandleMidi([0x90, 16 + 3, 127], false);   // press step 3 → length gesture
    seqHandleMidi([0x80, 16 + 3, 0], false);
    seqHandleMidi([0x80, 16 + 0, 0], false);
    seqEngineTick();
    eq('melodic hold+press: B not entered', occHasStep(3), false);
    eq('melodic hold+press: emits slen', engine.ops.some((o) => o.startsWith('slen')), true);

    // Drum lane: hold step 0 + press step 3 enters BOTH (no length gesture) —
    // multiple steps can be entered while one is held.
    resetSeqState(); engine.reset(); resetSeqEngine(); seqEngineTick();
    seqState.lenSteps = 16;
    seqSetLane(38); seqEngineTick();
    seqHandleMidi([0x90, 16 + 0, 127], false);   // hold step 0
    seqHandleMidi([0x90, 16 + 3, 127], false);   // press step 3 while step 0 held
    seqHandleMidi([0x80, 16 + 3, 0], false);     // release → step 3 toggles on
    seqHandleMidi([0x80, 16 + 0, 0], false);     // release → step 0 toggles on
    eq('drum multi: step 0 entered', occHasStep(0), true);
    eq('drum multi: step 3 entered', occHasStep(3), true);
    eq('drum multi: no length gesture', engine.ops.some((o) => o.startsWith('slen')), false);

    // Drum multi-step where the anchor is held past the 300ms step-automation
    // threshold (reproduces the device failure): after step 3 is released,
    // step 0 is held alone, and the per-tick stepAutoTick must NOT promote it to
    // step-automation mode (which would suppress its toggle). The anchor must
    // still enter on release.
    {
        const { stepAutoTick } = await import('../dist/esm/seq/step-edit.js');
        resetSeqState(); engine.reset(); resetSeqEngine(); seqEngineTick();
        seqState.lenSteps = 16;
        seqSetLane(38); seqEngineTick();
        const realNow = Date.now;
        let clock = 1000;
        Date.now = () => clock;
        seqHandleMidi([0x90, 16 + 0, 127], false);   // hold step 0 (press at t=1000)
        seqHandleMidi([0x90, 16 + 3, 127], false);   // press step 3 while step 0 held
        seqHandleMidi([0x80, 16 + 3, 0], false);     // release step 3 → toggles on
        clock = 1500;                                // 500ms later — past the 300ms threshold
        stepAutoTick();                              // per-tick promotion check fires here
        seqHandleMidi([0x80, 16 + 0, 0], false);     // release step 0 → must still toggle
        Date.now = realNow;
        eq('drum multi (>300ms hold): anchor still entered', occHasStep(0), true);
        eq('drum multi (>300ms hold): B still entered', occHasStep(3), true);
    }

    // Harder ordering (matches device MIDI-inject latency): the anchor is held
    // ALONE past 300ms and promoted to step-automation FIRST, then the second
    // step is pressed. The multi-press must cancel the anchor's promotion so it
    // still enters on release.
    {
        const { stepAutoTick } = await import('../dist/esm/seq/step-edit.js');
        resetSeqState(); engine.reset(); resetSeqEngine(); seqEngineTick();
        seqState.lenSteps = 16;
        seqSetLane(38); seqEngineTick();
        const realNow = Date.now;
        let clock = 1000;
        Date.now = () => clock;
        seqHandleMidi([0x90, 16 + 0, 127], false);   // hold step 0
        clock = 1400;                                // 400ms alone → promotes to auto mode
        stepAutoTick();
        seqHandleMidi([0x90, 16 + 3, 127], false);   // NOW press step 3 (multi-press)
        seqHandleMidi([0x80, 16 + 3, 0], false);     // release step 3
        seqHandleMidi([0x80, 16 + 0, 0], false);     // release step 0
        Date.now = realNow;
        eq('drum multi (anchor promoted first): anchor still entered', occHasStep(0), true);
        eq('drum multi (anchor promoted first): B entered', occHasStep(3), true);
    }
    seqSetLane(-1); seqEngineTick();

    // Mute held: a track-button press must NOT retarget the watched track.
    resetSeqState(); engine.reset(); resetSeqEngine(); seqEngineTick();
    seqState.watchTrack = 0;
    setMuteHeld(true);
    seqHandleMidi([0xB0, 42, 127], false);   // track button for track 1 (CC 43 = track 0)
    eq('mute+track keeps watchTrack', seqState.watchTrack, 0);
    eq('mute+track emits no watch cmd', engine.ops.some((o) => o.startsWith('watch ')), false);
    setMuteHeld(false);

    // Copy held + two step presses (note view) → cpy then pst, no note toggled.
    resetSeqState(); engine.reset(); resetSeqEngine(); seqEngineTick();
    {
        const { copyButton } = await import('../dist/esm/seq/duplicate.js');
        copyButton(true);
        seqHandleMidi([0x90, 16 + 2, 127], false); // source step 2
        seqHandleMidi([0x90, 16 + 9, 127], false); // dest step 9
        copyButton(false);
        seqEngineTick();                           // flush queued cmds to the mock engine
        eq('dup step copy via router', engine.ops.includes('cpy 0 2 2'), true);
        eq('dup step paste via router', engine.ops.includes('pst 0 9'), true);
        eq('dup step did not toggle a note', engine.ops.some((o) => o.startsWith('tog ')), false);
    }

    // Session: Copy held + two clip pads → clipcopy then clippaste, no launch.
    resetSeqState(); engine.reset(); resetSeqEngine(); seqEngineTick();
    seqState.sessionMode = true;
    {
        const { copyButton } = await import('../dist/esm/seq/duplicate.js');
        copyButton(true);
        seqHandleMidi([0x90, 68, 127], false);     // pad 68 = track 3 slot 0 (bottom-left)
        seqHandleMidi([0x90, 68 + 1, 127], false); // dest pad
        copyButton(false);
        seqEngineTick();
        eq('dup clip copy via router', engine.ops.some((o) => o.startsWith('clipcopy')), true);
        eq('dup clip paste via router', engine.ops.some((o) => o.startsWith('clippaste')), true);
        eq('dup clip did not launch', engine.ops.some((o) => o.startsWith('launch')), false);
    }
    seqState.sessionMode = false;

    // Session: Clear held + clip pad → clipdelat + toast; multiple while held.
    resetSeqState(); engine.reset(); resetSeqEngine(); resetSeqToast(); seqEngineTick();
    seqState.sessionMode = true;
    seqHandleMidi([0xB0, 119, 127], false);   // hold Clear
    seqHandleMidi([0x90, 68, 127], false);     // clip A
    seqHandleMidi([0x90, 68 + 1, 127], false); // clip B (still held)
    seqEngineTick();
    eq('clear+clip deletes A', engine.ops.includes('clipdelat 3 0'), true);
    eq('clear+clip deletes B', engine.ops.includes('clipdelat 3 1'), true);
    seqHandleMidi([0xB0, 119, 0], false);
    seqState.sessionMode = false;

    // Step entry while stopped does not start the transport (UI mirror).
    resetSeqState(); engine.reset(); resetSeqEngine(); seqEngineTick();
    seqState.playing = false;
    seqHandleMidi([0x90, 16 + 0, 127], false);
    seqHandleMidi([0x80, 16 + 0, 0], false);
    eq('step entry keeps playing false', seqState.playing, false);

    // Bar navigation: Right advances the visible bar (clip is 1 bar long, so
    // one extra empty bar is reachable), with a toast; clamps at the end.
    resetSeqState(); resetSeqToast();
    seqState.lenSteps = 16; // one bar
    eq('Right arrow claimed (engine ready)', seqHandleMidi([0xB0, 63, 127], false), true);
    eq('barOffset advanced to 1', seqState.barOffset, 1);
    // Bar-N toasts were dropped (Task 9); bar nav is now silent.
    seqHandleMidi([0xB0, 63, 127], false);     // clamp: max is 1 for a 1-bar clip
    eq('barOffset clamped', seqState.barOffset, 1);
    seqHandleMidi([0xB0, 62, 127], false);     // Left
    eq('Left arrow returns to bar 0', seqState.barOffset, 0);
    // Step tap on bar 1 targets absolute step 16.
    seqState.barOffset = 1;
    seqNotePadPlayed(0, 80, 60, 100); seqNotePadReleased(80);
    tapStep(0);
    seqEngineTick();
    eq('bar offset maps to absolute step', lastOp(), 'tog 0 16 60 100');

    // Play toggles transport based on the mirror.
    resetSeqState();
    eq('Play CC claimed', seqHandleMidi([0xB0, 85, 127], false), true);
    seqEngineTick();
    eq('play cmd emitted', lastOp(), 'play');
    eq('optimistic play mirror', seqState.playing, true);
    seqHandleMidi([0xB0, 85, 127], false);
    seqEngineTick();
    eq('second press emits stop', lastOp(), 'stop');

    // Track buttons: watch retarget without claiming the event.
    eq('track button NOT claimed', seqHandleMidi([0xB0, 41, 127], false), false);
    seqEngineTick();
    eq('watch cmd emitted for track 2', lastOp(), 'watch 2');
    eq('watchTrack mirrored', seqState.watchTrack, 2);

    // Arrows fall through to existing nav when the engine is NOT ready.
    uninstallMockEngine(); resetSeqEngine(); resetSeqState();
    eq('Right arrow NOT claimed without engine', seqHandleMidi([0xB0, 63, 127], false), false);

    engine.reset(); resetSeqEngine(); resetSeqState(); resetSeqToast();
}

/* ── seq LEDs: track-colored step row, cached painting ───────────────────── */
{
    _log('\nseq LEDs:');
    const { seqLedsTick, seqLedsInvalidate } = await import('../dist/esm/seq/leds.js');
    const { seqState, resetSeqState, occToggleStep } = await import('../dist/esm/seq/state.js');
    const { C_WHITE, C_DARKGREY, C_GREEN, C_BLACK, trackColorDim } =
        await import('../dist/esm/seq/colors.js');

    const ledCalls = [];
    const origSetLED = globalThis.setLED;
    const origSetButtonLED = globalThis.setButtonLED;
    globalThis.setLED = (note, color) => ledCalls.push([note, color]);
    globalThis.setButtonLED = (cc, color) => ledCalls.push(['b' + cc, color]);

    resetSeqState(); seqLedsInvalidate();
    seqState.watchTrack = 0;
    seqState.lenSteps = 32;       // 2 bars
    occToggleStep(0); occToggleStep(4);
    seqState.playing = true;
    seqState.curStep = 2;

    // Cold frame paints progressively (FRAME_BUDGET sends/tick); drain it so
    // every LED (incl. the last-painted transport button) has been emitted.
    for (let i = 0; i < 3; i++) seqLedsTick();
    let byNote = Object.fromEntries(ledCalls.map(([n, c]) => [n, c]));
    eq('occupied step white', byNote[16], C_WHITE);
    eq('occupied step white (2)', byNote[20], C_WHITE);
    eq('playhead green', byNote[18], C_GREEN);
    eq('empty in-loop dim track color', byNote[17], trackColorDim(0));
    eq('play button lit (green)', byNote.b85, C_GREEN);

    // Cached layer: identical repaint sends nothing.
    ledCalls.length = 0;
    seqLedsTick();
    eq('no LED traffic when unchanged', ledCalls.length, 0);

    // Playhead movement repaints exactly the two affected steps.
    seqState.curStep = 3;
    seqLedsTick();
    eq('playhead move repaints 2 LEDs', ledCalls.length, 2);

    // Bar 2 view: bar 1 is in-loop (steps 16-31), so all dim track color;
    // a step past the loop would be dim gray, but len=32 fills bar 1.
    ledCalls.length = 0;
    seqState.barOffset = 1;
    seqState.playing = false;
    seqLedsInvalidate();
    seqLedsTick();
    byNote = Object.fromEntries(ledCalls.map(([n, c]) => [n, c]));
    eq('bar 2 in-loop dim track color', byNote[16], trackColorDim(0));

    // Steps past the clip length are not part of the pattern → fully off.
    ledCalls.length = 0;
    seqState.lenSteps = 16;       // shrink to 1 bar; bar 2 now beyond the clip
    seqLedsInvalidate();
    seqLedsTick();
    byNote = Object.fromEntries(ledCalls.map(([n, c]) => [n, c]));
    eq('step beyond clip length is off', byNote[16], C_BLACK);

    // Recording: playhead step is red instead of green.
    resetSeqState(); seqLedsInvalidate();
    const { C_REC_RED: C_REC_RED_LED } = await import('../dist/esm/seq/colors.js');
    seqState.watchTrack = 0; seqState.lenSteps = 16; seqState.playing = true;
    seqState.recording = true; seqState.curStep = 0;
    ledCalls.length = 0;
    for (let i = 0; i < 3; i++) seqLedsTick();
    byNote = Object.fromEntries(ledCalls.map(([n, c]) => [n, c]));
    eq('playhead red when recording', byNote[16], C_REC_RED_LED);

    // Session (master chain) mode: step row goes dark — there is no per-step
    // editing for master FX, so notes 16..31 must be painted black.
    resetSeqState(); seqLedsInvalidate();
    seqState.sessionMode = true;
    seqState.lenSteps = 16; occToggleStep(0); occToggleStep(4);
    ledCalls.length = 0;
    for (let i = 0; i < 3; i++) seqLedsTick();   // drain progressive cold frame
    byNote = Object.fromEntries(ledCalls.map(([n, c]) => [n, c]));
    eq('session step 0 off', byNote[16], 0);
    eq('session step 4 off', byNote[20], 0);

    globalThis.setLED = origSetLED;
    globalThis.setButtonLED = origSetButtonLED;
    resetSeqState(); seqLedsInvalidate();
}

/* ── seq pads: chromatic layout + coloring ───────────────────────────────── */
{
    _log('\nseq chromatic pads:');
    const { chromaticPitch, chromaticPadColor, inScale } =
        await import('../dist/esm/seq/pads.js');
    const { trackColor } = await import('../dist/esm/seq/colors.js');

    const PAD_MIN = 68;
    const base = 48; // C3 at bottom-left

    // Bottom-left = base; +1 per column right; +5 per row up.
    eq('bottom-left = base note', chromaticPitch(68, PAD_MIN, base), 48);
    eq('one column right = +1 semitone', chromaticPitch(69, PAD_MIN, base), 49);
    eq('one row up = +5 semitones', chromaticPitch(76, PAD_MIN, base), 53);
    eq('top-left (row 3) = +15', chromaticPitch(92, PAD_MIN, base), 63);

    // Coloring: root C = track color, in-scale gray, out-of-scale dark.
    eq('root C uses track color', chromaticPadColor(68, PAD_MIN, base, 2, false), trackColor(2));
    // base+2 = D (in C major) → light gray (118)
    eq('in-scale note light gray', chromaticPadColor(70, PAD_MIN, base, 0, false), 118);
    // base+1 = C# (out of scale) → dark
    eq('out-of-scale dark', chromaticPadColor(69, PAD_MIN, base, 0, false), 0);
    // isPlaying=true → green (sounding, highest priority)
    eq('playing pad green', chromaticPadColor(69, PAD_MIN, base, 0, true), 11);

    eq('C in C major scale', inScale(60, 48, 0), true);
    eq('C# not in C major scale', inScale(61, 48, 0), false);
}

/* ── seq Full Velocity toggle (Shift+Step 10) ────────────────────────────── */
{
    _log('\nseq full velocity:');
    const { installMockEngine, uninstallMockEngine } = await import('./mock-engine.mjs');
    const { seqHandleMidi } = await import('../dist/esm/seq/router.js');
    const { seqEngineTick, resetSeqEngine } = await import('../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../dist/esm/seq/state.js');

    installMockEngine();
    resetSeqEngine(); resetSeqState();
    seqEngineTick(); // ready

    eq('full velocity off by default', seqState.fullVelocity, false);
    // Shift + Step 10 (note 25) toggles it; the event is still claimed.
    eq('shift+step claimed', seqHandleMidi([0x90, 25, 127], true), true);
    eq('full velocity toggled on', seqState.fullVelocity, true);
    seqHandleMidi([0x90, 25, 127], true);
    eq('full velocity toggled off', seqState.fullVelocity, false);

    // A bare step press+release (no shift) toggles a note, not the flag.
    seqHandleMidi([0x90, 25, 127], false);
    seqHandleMidi([0x80, 25, 0], false);
    eq('bare step did not touch full velocity', seqState.fullVelocity, false);

    const { resetStepEdit } = await import('../dist/esm/seq/step-edit.js');
    uninstallMockEngine(); resetSeqEngine(); resetSeqState(); resetStepEdit();
}

/* ── seq loop mode: toggle, set window, double, resize ───────────────────── */
{
    _log('\nseq loop mode:');
    const { installMockEngine, uninstallMockEngine } = await import('./mock-engine.mjs');
    const { seqHandleMidi } = await import('../dist/esm/seq/router.js');
    const { seqEngineTick, resetSeqEngine } = await import('../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../dist/esm/seq/state.js');
    const { resetLoopMode } = await import('../dist/esm/seq/loop-mode.js');
    const { resetStepEdit } = await import('../dist/esm/seq/step-edit.js');
    const { resetSeqToast } = await import('../dist/esm/seq/render.js');

    const engine = installMockEngine();
    resetSeqEngine(); resetSeqState(); resetLoopMode(); resetStepEdit(); resetSeqToast();
    seqEngineTick(); // ready
    seqState.lenSteps = 32; // 2-bar clip

    // Loop button tap (down then up with no gesture) latches Loop Mode on.
    seqHandleMidi([0xB0, 58, 127], false);
    seqHandleMidi([0xB0, 58, 0], false);
    eq('Loop tap enters Loop Mode', seqState.loopMode, true);

    // Two bars pressed together → loop window [min,max].
    seqHandleMidi([0x90, 16 + 1, 127], false); // bar 1 (index 1)
    seqHandleMidi([0x90, 16 + 3, 127], false); // bar 3
    seqEngineTick();
    eq('two-bar press sets loop window', engine.ops[engine.ops.length - 1], 'loop 0 16 48');
    eq('optimistic loopStart', seqState.loopStart, 16);
    eq('optimistic lenSteps', seqState.lenSteps, 48);
    seqHandleMidi([0x80, 16 + 1, 0], false);
    seqHandleMidi([0x80, 16 + 3, 0], false);

    // Double-tap one bar → 1-bar loop at that bar.
    seqHandleMidi([0x90, 16 + 2, 127], false);
    seqHandleMidi([0x80, 16 + 2, 0], false);
    seqHandleMidi([0x90, 16 + 2, 127], false); // within double-tap window
    seqEngineTick();
    eq('double-tap sets 1-bar loop', engine.ops[engine.ops.length - 1], 'loop 0 32 16');
    seqHandleMidi([0x80, 16 + 2, 0], false);

    // Loop + wheel resizes by whole bars (loop currently 1 bar at bar 2).
    seqHandleMidi([0xB0, 58, 127], false);     // hold Loop
    seqHandleMidi([0xB0, 14, 1], false);       // wheel +1 → 2 bars from bar 2
    seqEngineTick();
    eq('Loop+wheel grows the loop', engine.ops[engine.ops.length - 1], 'loop 0 32 32');
    seqHandleMidi([0xB0, 58, 0], false);       // release; gesture happened → no toggle
    eq('Loop+wheel hold did not toggle mode', seqState.loopMode, true);

    // Shift+Step 15 doubles the loop.
    seqState.loopStart = 0; seqState.lenSteps = 16;
    seqHandleMidi([0x90, 16 + 14, 127], true);
    seqEngineTick();
    eq('Shift+Step15 doubles loop', engine.ops[engine.ops.length - 1], 'dbl 0');

    // Momentary semantics. resetMomentary + resetLoopMode so press state is clean.
    const { resetMomentary } = await import('../dist/esm/seq/momentary.js');
    resetMomentary(); resetLoopMode();

    // Clean tap from Note → latches Loop on.
    seqState.loopMode = false;
    seqHandleMidi([0xB0, 58, 127], false); // down: loopPrev=false → loopMode=true
    seqHandleMidi([0xB0, 58, 0], false);   // up: tap (0 ticks elapsed) → latch
    eq('Loop tap from Note latches on', seqState.loopMode, true);

    // Clean tap while already in Loop → toggles back to Note.
    seqHandleMidi([0xB0, 58, 127], false); // down: loopPrev=true
    seqHandleMidi([0xB0, 58, 0], false);   // up: tap → toggle off
    eq('Loop tap while in Loop exits to Note', seqState.loopMode, false);

    // Loop + wheel from Note: the gesture reverts on release (no latch).
    seqState.loopMode = false;
    seqHandleMidi([0xB0, 58, 127], false); // down: loopPrev=false → loopMode=true
    seqHandleMidi([0xB0, 14, 1], false);   // wheel → momentaryGesture
    seqHandleMidi([0xB0, 58, 0], false);   // up: gesture → revert to Note
    eq('Loop+wheel from Note reverts', seqState.loopMode, false);

    uninstallMockEngine(); resetSeqEngine(); resetSeqState(); resetLoopMode();
}

/* ── seq loop LEDs: bars on the step row ─────────────────────────────────── */
{
    _log('\nseq loop LEDs:');
    const { seqLedsTick, seqLedsInvalidate } = await import('../dist/esm/seq/leds.js');
    const { seqState, resetSeqState, occToggleStep } = await import('../dist/esm/seq/state.js');
    const { C_WHITE, C_DARKGREY, trackColor } = await import('../dist/esm/seq/colors.js');

    const ledCalls = [];
    const origSetLED = globalThis.setLED;
    globalThis.setLED = (note, color) => ledCalls.push([note, color]);

    resetSeqState(); seqLedsInvalidate();
    seqState.loopMode = true;
    seqState.watchTrack = 0;
    seqState.loopStart = 16;   // loop = bar 1..2
    seqState.lenSteps = 32;
    seqState.barOffset = 1;    // bar 1 is selected
    occToggleStep(16 * 3 + 2); // content in bar 3

    seqLedsTick();
    const byNote = Object.fromEntries(ledCalls.map(([n, c]) => [n, c]));
    // New loop-bar semantics: selected=white, content=blink track color, else off.
    eq('selected bar white (bar 1)', byNote[17], C_WHITE);
    eq('empty bar off (bar 2)', byNote[18], 0);
    eq('content bar blink on = track color', byNote[19], trackColor(0));
    eq('empty bar off (bar 0)', byNote[16], 0);

    globalThis.setLED = origSetLED;
    resetSeqState(); seqLedsInvalidate();
}

/* ── seq step editing: hold-step gestures ────────────────────────────────── */
{
    _log('\nseq step editing:');
    const { installMockEngine, uninstallMockEngine } = await import('./mock-engine.mjs');
    const { seqHandleMidi, seqNotePadPlayed } = await import('../dist/esm/seq/router.js');
    const { seqEngineTick, resetSeqEngine } = await import('../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../dist/esm/seq/state.js');
    const { resetStepEdit } = await import('../dist/esm/seq/step-edit.js');
    const { resetLoopMode } = await import('../dist/esm/seq/loop-mode.js');
    const { resetSeqToast } = await import('../dist/esm/seq/render.js');
    const { clearHeldSet } = await import('../dist/esm/seq/held.js');

    const engine = installMockEngine();
    const reset = () => {
        resetSeqEngine(); resetSeqState(); resetStepEdit(); resetLoopMode(); resetSeqToast();
        for (let t = 0; t < 4; t++) clearHeldSet(t); // clear white selection between sub-tests
        engine.reset();
    };
    reset();
    seqEngineTick(); // ready

    const lastOp = () => engine.ops[engine.ops.length - 1];

    // Hold step 3 + Volume turn → velocity edit (note NOT toggled on release).
    seqHandleMidi([0x90, 16 + 3, 127], false);   // hold step 3
    eq('Volume claimed while step held', seqHandleMidi([0xB0, 79, 1], false), true);
    seqEngineTick();
    eq('velocity edit op', lastOp(), 'evel 0 3 3 -1 4');
    seqHandleMidi([0x80, 16 + 3, 0], false);     // release — gesture happened
    seqEngineTick();
    eq('held+edit did not toggle a note', engine.ops.filter(o => o.startsWith('tog')).length, 0);

    // Hold step + wheel → NOT consumed (the wheel navigates param pages now; note
    // length on jog was dropped). + arrow → nudge; + arrow w/ shift → fine.
    reset(); seqEngineTick();
    seqHandleMidi([0x90, 16 + 0, 127], false);
    eq('wheel not consumed for length while a step is held', seqHandleMidi([0xB0, 14, 1], false), false);
    seqEngineTick();
    eq('no length op emitted', engine.ops.some(o => o.startsWith('elen')), false);
    seqHandleMidi([0xB0, 63, 127], false);       // right arrow
    seqEngineTick();
    eq('nudge coarse op', lastOp(), 'enudge 0 0 0 -1 2');
    seqHandleMidi([0xB0, 62, 127], true);        // left arrow + shift = fine
    seqEngineTick();
    eq('nudge fine op', lastOp(), 'enudge 0 0 0 -1 -1');
    seqHandleMidi([0x80, 16 + 0, 0], false);

    // Hold step + plus = transpose (melodic). Drum lane disables transpose.
    reset(); seqEngineTick();
    seqHandleMidi([0x90, 16 + 5, 127], false);
    eq('plus claimed while step held', seqHandleMidi([0xB0, 55, 127], false), true);
    seqEngineTick();
    eq('transpose op', lastOp(), 'etrn 0 5 5 -1 1');
    seqHandleMidi([0x80, 16 + 5, 0], false);

    // Hold step + pad → toggle that pitch at the step (single step).
    reset(); seqEngineTick();
    seqHandleMidi([0x90, 16 + 2, 127], false);   // hold step 2
    seqNotePadPlayed(0, 80, 67, 100);            // pad while held
    seqEngineTick();
    eq('hold-step + pad toggles pitch at step', lastOp(), 'ltog 0 2 67 100');
    seqHandleMidi([0x80, 16 + 2, 0], false);

    // Multi-step hold in Loop Mode: pressing two bars registers both for edits.
    reset(); seqEngineTick();
    seqState.loopMode = true;
    seqHandleMidi([0x90, 16 + 1, 127], false);
    seqHandleMidi([0x90, 16 + 4, 127], false);
    seqHandleMidi([0xB0, 79, 1], false);         // Volume up
    seqEngineTick();
    eq('multi-step (loop mode) velocity edits both bars', engine.ops.filter(o => o.startsWith('evel')).length, 2);
    seqHandleMidi([0x80, 16 + 1, 0], false);
    seqHandleMidi([0x80, 16 + 4, 0], false);
    seqState.loopMode = false;

    // A plain tap (no gesture) DOES toggle a note on release.
    reset(); seqEngineTick();
    seqState.lastPitch[0] = 64; seqState.lastVel[0] = 90;
    seqHandleMidi([0x90, 16 + 7, 127], false);
    seqHandleMidi([0x80, 16 + 7, 0], false);
    seqEngineTick();
    eq('tap toggles a note on release', lastOp(), 'tog 0 7 64 90');

    // Loop Mode: hold a bar + wheel no longer edits note length (length dropped;
    // the wheel falls through to page/chain nav).
    reset(); seqEngineTick();
    seqState.loopMode = true;
    seqHandleMidi([0x90, 16 + 1, 127], false);   // hold bar 1
    eq('loop bar + wheel not consumed for length', seqHandleMidi([0xB0, 14, 1], false), false);
    seqEngineTick();
    eq('no loop-mode length op', engine.ops.some(o => o.startsWith('elen')), false);
    seqHandleMidi([0x80, 16 + 1, 0], false);

    uninstallMockEngine(); reset();
}

/* ── seq copy & delete operations ────────────────────────────────────────── */
{
    _log('\nseq copy & delete:');
    const { installMockEngine, uninstallMockEngine } = await import('./mock-engine.mjs');
    const { seqHandleMidi, seqNotePadPlayed } = await import('../dist/esm/seq/router.js');
    const { seqEngineTick, resetSeqEngine } = await import('../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../dist/esm/seq/state.js');
    const { resetEditOps } = await import('../dist/esm/seq/edit-ops.js');
    const { resetStepEdit } = await import('../dist/esm/seq/step-edit.js');
    const { resetLoopMode } = await import('../dist/esm/seq/loop-mode.js');
    const { resetSeqToast } = await import('../dist/esm/seq/render.js');
    const { resetDuplicate } = await import('../dist/esm/seq/duplicate.js');

    const engine = installMockEngine();
    const reset = () => {
        resetSeqEngine(); resetSeqState(); resetEditOps(); resetDuplicate();
        resetStepEdit(); resetLoopMode(); resetSeqToast(); engine.reset();
    };
    const lastOp = () => engine.ops[engine.ops.length - 1];
    reset(); seqEngineTick();

    // Copy held → source step → dest step: copy then paste-replace, no toggles.
    // (The full duplicate-gesture matrix is covered in the 'duplicate gesture'
    // and 'seq router' blocks; here we just confirm the Copy button routes to
    // it and releases cleanly.)
    seqHandleMidi([0xB0, 60, 127], false);     // Copy down
    seqHandleMidi([0x90, 16 + 0, 127], false); // source step 0
    seqHandleMidi([0x90, 16 + 8, 127], false); // dest step 8
    seqHandleMidi([0xB0, 60, 0], false);       // Copy up
    seqEngineTick();
    eq('dup copy then paste', engine.ops.includes('cpy 0 0 0') && engine.ops.includes('pst 0 8'), true);
    eq('dup presses did not toggle notes', engine.ops.filter(o => o.startsWith('tog')).length, 0);

    // Delete tap → delete clip.
    reset(); seqEngineTick();
    seqHandleMidi([0xB0, 119, 127], false);
    seqHandleMidi([0xB0, 119, 0], false);
    seqEngineTick();
    eq('Delete tap deletes clip', lastOp(), 'clipdel 0');

    // Delete tap while on a later bar refocuses to bar 0, so new steps go to the
    // first bar (not the bar that was on screen when the now-empty clip vanished).
    reset(); seqEngineTick();
    seqState.barOffset = 1;                      // viewing the second bar
    seqHandleMidi([0xB0, 119, 127], false);
    seqHandleMidi([0xB0, 119, 0], false);
    eq('clip delete refocuses to bar 0', seqState.barOffset, 0);

    // Delete + step → delete that step's notes (no clip delete on release).
    reset(); seqEngineTick();
    seqHandleMidi([0xB0, 119, 127], false);    // Delete down
    seqHandleMidi([0x90, 16 + 5, 127], false); // step 5
    seqEngineTick();
    eq('Delete+step clears the step notes', engine.ops.includes('del 0 5 5 -1'), true);
    eq('Delete+step clears the step automation', engine.ops.includes('aclrstep 0 5'), true);
    seqHandleMidi([0xB0, 119, 0], false);      // release — acted, so no clip delete
    seqEngineTick();
    eq('Delete+step release did not delete clip',
        engine.ops.filter(o => o.startsWith('clipdel')).length, 0);

    // Delete + step in Loop Mode → delete the whole bar.
    reset(); seqEngineTick();
    seqState.loopMode = true;
    seqHandleMidi([0xB0, 119, 127], false);
    seqHandleMidi([0x90, 16 + 2, 127], false); // bar 2
    seqEngineTick();
    eq('Delete+bar clears the bar', engine.ops.includes('del 0 32 47 -1'), true);
    seqHandleMidi([0xB0, 119, 0], false);

    // Delete + drum pad → clear that pitch across the clip.
    reset(); seqEngineTick();
    seqHandleMidi([0xB0, 119, 127], false);
    seqNotePadPlayed(0, 80, 38, 100);          // pad while Delete held
    seqEngineTick();
    eq('Delete+pad clears the pitch', lastOp(), 'del 0 0 255 38');
    seqHandleMidi([0xB0, 119, 0], false);

    // Step held + Clear → clears that step's automation (no clip delete, no note).
    reset(); seqEngineTick();
    seqHandleMidi([0x90, 16 + 7, 127], false); // hold step 7
    seqHandleMidi([0xB0, 119, 127], false);    // Clear down while holding
    seqEngineTick();
    eq('step+Clear clears that step automation', engine.ops.includes('aclrstep 0 7'), true);
    seqHandleMidi([0xB0, 119, 0], false);      // Clear release
    seqHandleMidi([0x80, 16 + 7, 0], false);   // step release
    seqEngineTick();
    eq('step+Clear did not delete the clip', engine.ops.filter(o => o.startsWith('clipdel')).length, 0);
    eq('step+Clear did not toggle a note', engine.ops.filter(o => o.startsWith('tog')).length, 0);

    uninstallMockEngine(); reset();
}

/* ── seq recording: Rec, metronome, quantize, live capture ───────────────── */
{
    _log('\nseq recording:');
    const { installMockEngine, uninstallMockEngine } = await import('./mock-engine.mjs');
    const { seqHandleMidi, seqNotePadPlayed, seqNotePadReleased } =
        await import('../dist/esm/seq/router.js');
    const { seqEngineTick, resetSeqEngine } = await import('../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../dist/esm/seq/state.js');
    const { resetEditOps } = await import('../dist/esm/seq/edit-ops.js');
    const { resetStepEdit } = await import('../dist/esm/seq/step-edit.js');
    const { resetSeqToast } = await import('../dist/esm/seq/render.js');

    const engine = installMockEngine();
    const reset = () => {
        resetSeqEngine(); resetSeqState(); resetEditOps(); resetStepEdit();
        resetSeqToast(); engine.reset();
    };
    const lastOp = () => engine.ops[engine.ops.length - 1];
    reset(); seqEngineTick();

    // Rec press → rec command on the watched track.
    seqHandleMidi([0xB0, 86, 127], false);
    seqEngineTick();
    eq('Rec emits rec command', lastOp(), 'rec 0');

    // Shift+Step 6 toggles metronome; Shift+Step 16 quantizes.
    seqHandleMidi([0x90, 16 + 5, 127], true);
    seqEngineTick();
    eq('Shift+Step6 toggles metronome', lastOp(), 'metro 1');
    seqHandleMidi([0x90, 16 + 15, 127], true);
    seqEngineTick();
    eq('Shift+Step16 quantizes', lastOp(), 'quant 0');

    // Live pad notes forward non/nof for recording capture.
    reset(); seqEngineTick();
    seqNotePadPlayed(0, 80, 67, 110);
    seqEngineTick();
    eq('pad-on forwards non', lastOp(), 'non 0 67 110');
    seqNotePadReleased(80);
    seqEngineTick();
    eq('pad-off forwards nof', lastOp(), 'nof 0 67');

    // Status mirrors recording flags for the Rec LED.
    engine.status.rec = 1; engine.status.cin = 0; engine.status.metro = 1;
    globalThis.host_module_get_param = (key) =>
        key === 'status' ? 'play=1 rec=1 cin=0 metro=1' : (key === 'ping' ? 'pong ' + ENGINE_VERSION : null);
    for (let i = 0; i < 10; i++) seqEngineTick();
    eq('recording flag mirrored', seqState.recording, true);
    eq('metronome flag mirrored', seqState.metro, true);

    uninstallMockEngine(); reset();
}

/* ── seq session mode: grid, launch/stop, copy/delete clips ──────────────── */
{
    _log('\nseq session mode:');
    const { installMockEngine, uninstallMockEngine } = await import('./mock-engine.mjs');
    const { seqHandleMidi } = await import('../dist/esm/seq/router.js');
    const { seqEngineTick, resetSeqEngine } = await import('../dist/esm/seq/engine.js');
    const { seqState, resetSeqState, sessionFromStr } = await import('../dist/esm/seq/state.js');
    const { resetSession } = await import('../dist/esm/seq/session.js');
    const { resetSeqToast } = await import('../dist/esm/seq/render.js');
    const { resetDuplicate } = await import('../dist/esm/seq/duplicate.js');

    const engine = installMockEngine();
    const reset = () => { resetSeqEngine(); resetSeqState(); resetSession(); resetDuplicate(); resetSeqToast(); engine.reset(); };
    const lastOp = () => engine.ops[engine.ops.length - 1];
    reset(); seqEngineTick();

    // Note/Session toggle.
    seqHandleMidi([0xB0, 50, 127], false);
    eq('Note/Session enters session', seqState.sessionMode, true);

    // Pad grid mapping: top-left pad (note 92) = track 0, slot 0.
    seqHandleMidi([0x90, 92, 127], false);
    seqEngineTick();
    eq('top-left pad → launch track 0 slot 0', lastOp(), 'launch 0 0');
    eq('launch retargets watch track', seqState.watchTrack, 0);
    // Bottom-left pad (note 68) = track 3, slot 0.
    seqHandleMidi([0x90, 68, 127], false);
    seqEngineTick();
    eq('bottom-left pad → track 3 slot 0', lastOp(), 'launch 3 0');
    // One column right on the top row (note 93) = track 0, slot 1.
    seqHandleMidi([0x90, 93, 127], false);
    seqEngineTick();
    eq('column maps to slot', lastOp(), 'launch 0 1');

    // Pads are claimed in session mode (not played as notes).
    eq('session pad note-on claimed', seqHandleMidi([0x90, 80, 100], false), true);
    eq('session pad note-off claimed', seqHandleMidi([0x80, 80, 0], false), true);

    // Delete + pad → delete that clip.
    reset(); seqEngineTick(); seqState.sessionMode = true;
    seqHandleMidi([0xB0, 119, 127], false);   // Delete down
    seqHandleMidi([0x90, 92, 127], false);    // track 0 slot 0
    seqEngineTick();
    eq('Delete+pad clears the clip', lastOp(), 'clipdelat 0 0');
    seqHandleMidi([0xB0, 119, 0], false);

    // Copy HELD → src pad → dest pad (still held) → clip copy then paste.
    reset(); seqEngineTick(); seqState.sessionMode = true;
    seqHandleMidi([0xB0, 60, 127], false);    // Copy down (held)
    seqHandleMidi([0x90, 92, 127], false);    // src = track 0 slot 0
    seqEngineTick();
    eq('clip copy op', lastOp(), 'clipcopy 0 0');
    seqHandleMidi([0x90, 93, 127], false);    // dest = track 0 slot 1 (still held)
    seqEngineTick();
    eq('clip paste op', lastOp(), 'clippaste 0 1');
    seqHandleMidi([0xB0, 60, 0], false);      // Copy up

    // Status `sess=` populates the grid mirror.
    sessionFromStr('03.0.-.0,00.-.-.0,00.-.-.0,00.-.-.0');
    eq('session exist bitmap parsed', seqState.session[0].exist, 0x03);
    eq('session playing slot parsed', seqState.session[0].playing, 0);
    eq('session no-queue parsed as -1', seqState.session[0].queued, -1);

    uninstallMockEngine(); reset();
}

/* ── seq session LEDs: clip grid colors ──────────────────────────────────── */
{
    _log('\nseq session LEDs:');
    const { sessionPaintGrid, resetSession } = await import('../dist/esm/seq/session.js');
    const { seqState, resetSeqState, sessionFromStr } = await import('../dist/esm/seq/state.js');
    const { C_WHITE, C_BLACK, C_DARKGREY, trackColor,
            ANIM_NONE, ANIM_PULSE, ANIM_PULSE_FAST, ANIM_PULSE_SLOW }
        = await import('../dist/esm/seq/colors.js');

    resetSeqState(); resetSession();
    // track0: slot0 exists+playing; slot1 exists (stopped); slot2 queued;
    // slot3 exists+selected (focus). tracks 1-3: empty, selected=0.
    sessionFromStr('0F.0.2.3,00.-.-.0,00.-.-.0,00.-.-.0');

    const cells = {};
    sessionPaintGrid((note, base, anim, channel) => { cells[note] = { base, anim, channel }; }, 68);
    // top row = track 0: notes 92/93/94/95 = slots 0/1/2/3.
    eq('playing pulses (Pulse4th) to white', cells[92].channel, ANIM_PULSE);
    eq('playing anim target white', cells[92].anim, C_WHITE);
    eq('playing base = track color', cells[92].base, trackColor(0));
    eq('stopped clip is solid', cells[93].channel, ANIM_NONE);
    eq('stopped clip = track color', cells[93].base, trackColor(0));
    eq('queued pulses fast (Pulse8th)', cells[94].channel, ANIM_PULSE_FAST);
    eq('queued anim target white', cells[94].anim, C_WHITE);
    eq('selected clip pulses slow (Pulse2th)', cells[95].channel, ANIM_PULSE_SLOW);
    eq('selected clip base = track color', cells[95].base, trackColor(0));

    // Selection highlight is NOT gated on watchTrack: every track greys its own
    // selected (default slot 0) empty cell, solid (no animation).
    eq('track3 selected-empty grey', cells[68].base, C_DARKGREY); // bottom row slot 0
    eq('track3 selected-empty solid', cells[68].channel, ANIM_NONE);
    eq('track2 selected-empty grey', cells[76].base, C_DARKGREY);
    eq('track1 selected-empty grey', cells[84].base, C_DARKGREY);
    eq('track3 unselected-empty dark', cells[69].base, C_BLACK);   // slot 1, not selected
    eq('track3 unselected-empty solid', cells[69].channel, ANIM_NONE);

    resetSeqState(); resetSession();
}

/* ── seq LED animation channel constants ─────────────────────────────────── */
{
    _log('\nseq anim constants:');
    const { ANIM_NONE, ANIM_PULSE, ANIM_PULSE_FAST, ANIM_PULSE_SLOW }
        = await import('../dist/esm/seq/colors.js');
    eq('NoAnimation channel', ANIM_NONE, 0x00);
    eq('Pulse4th channel', ANIM_PULSE, 0x09);
    eq('Pulse8th channel', ANIM_PULSE_FAST, 0x08);
    eq('Pulse2th channel', ANIM_PULSE_SLOW, 0x0A);
}

/* ── seq cachedSetAnimLED: native animation + base handshake ──────────────── */
{
    _log('\nseq anim LED cache:');
    const { cachedSetAnimLED, ledFrameReset, seqLedsInvalidate }
        = await import('../dist/esm/seq/leds.js');
    const { ANIM_NONE, ANIM_PULSE } = await import('../dist/esm/seq/colors.js');

    const sent = [];
    const savedSend = globalThis.move_midi_internal_send;
    globalThis.move_midi_internal_send = (arr) => { sent.push(arr.slice()); };
    const tick = (fn) => { ledFrameReset(); fn(); };

    seqLedsInvalidate();              // clear cache state

    // Solid color: one note-on on channel 0.
    tick(() => cachedSetAnimLED(70, 22, 22, ANIM_NONE));
    eq('solid emits one msg', sent.length, 1);
    eq('solid status ch0', sent[0][1], 0x90);
    eq('solid note', sent[0][2], 70);
    eq('solid color', sent[0][3], 22);

    // Re-sending the same solid state sends nothing.
    sent.length = 0;
    tick(() => cachedSetAnimLED(70, 22, 22, ANIM_NONE));
    eq('unchanged solid sends nothing', sent.length, 0);

    // Animate a note whose base is already established (base 22 == last solid):
    // emits exactly one message, on the Pulse channel, with the anim color.
    sent.length = 0;
    tick(() => cachedSetAnimLED(70, 22, 120, ANIM_PULSE));
    eq('anim w/ established base = one msg', sent.length, 1);
    eq('anim status = 0x90 | channel', sent[0][1], 0x90 | ANIM_PULSE);
    eq('anim color is the target', sent[0][3], 120);

    // Re-sending the same animation sends nothing.
    sent.length = 0;
    tick(() => cachedSetAnimLED(70, 22, 120, ANIM_PULSE));
    eq('unchanged anim sends nothing', sent.length, 0);

    // Handshake: a note whose base differs from last sent emits the base (ch0)
    // this tick, then the animation on the NEXT tick.
    seqLedsInvalidate(); sent.length = 0;
    tick(() => cachedSetAnimLED(71, 7, 120, ANIM_PULSE));   // base 7 never sent
    eq('handshake tick1 = base on ch0', sent.length, 1);
    eq('handshake tick1 status ch0', sent[0][1], 0x90);
    eq('handshake tick1 color = base', sent[0][3], 7);
    sent.length = 0;
    tick(() => cachedSetAnimLED(71, 7, 120, ANIM_PULSE));   // same request next tick
    eq('handshake tick2 = anim', sent.length, 1);
    eq('handshake tick2 status = pulse', sent[0][1], 0x90 | ANIM_PULSE);
    eq('handshake tick2 color = anim', sent[0][3], 120);

    globalThis.move_midi_internal_send = savedSend;
    seqLedsInvalidate();
}

/* ── seq loop overview strip (bottom-of-screen render) ───────────────────── */
{
    _log('\nseq loop strip:');
    const rects = [];
    const origFill = globalThis.fill_rect;
    globalThis.fill_rect = (x, y, w, h, v) => rects.push({ x, y, w, h, v });

    const { drawLoopStrip } = await import('../dist/esm/seq/render.js');
    const { seqState, resetSeqState } = await import('../dist/esm/seq/state.js');

    // 2-bar clip, bar 0 selected, not playing.
    resetSeqState();
    seqState.lenSteps = 32;
    seqState.barOffset = 0;
    rects.length = 0;
    drawLoopStrip();
    // First rect clears the band; then a thick segment for the selected bar
    // and a thin one for the other.
    eq('strip clears its band first', rects[0].v, 0);
    const segs = rects.slice(1).filter(r => r.v === 1);
    eq('two bar segments drawn', segs.length, 2);
    eq('selected bar is thick (2px)', segs[0].h, 2);
    eq('other bar is thin (1px)', segs[1].h, 1);

    // Single-bar loop → the sole bar is thin (native rule).
    resetSeqState(); seqState.lenSteps = 16; seqState.barOffset = 0;
    rects.length = 0;
    drawLoopStrip();
    const seg1 = rects.slice(1).filter(r => r.v === 1);
    eq('single-bar loop draws one segment', seg1.length, 1);
    eq('single bar is thin', seg1[0].h, 1);

    // Navigating to the empty bar past a 1-bar loop draws a "+" (two rects).
    resetSeqState(); seqState.lenSteps = 16; seqState.barOffset = 1;
    rects.length = 0;
    drawLoopStrip();
    // bar 0 segment (1) + plus icon (2 rects) = 3 lit rects.
    eq('empty bar shows a plus marker', rects.slice(1).filter(r => r.v === 1).length, 3);

    // Playing adds a vertical playhead mark (4px tall).
    resetSeqState(); seqState.lenSteps = 32; seqState.playing = true; seqState.curStep = 4;
    rects.length = 0;
    drawLoopStrip();
    eq('playhead mark drawn while playing', rects.some(r => r.v === 1 && r.h === 4), true);

    // No clip in the current slot → the band is cleared but no line is drawn.
    resetSeqState(); seqState.lenSteps = 0; seqState.barOffset = 0;
    rects.length = 0;
    drawLoopStrip();
    eq('empty slot clears the band', rects[0].v, 0);
    eq('empty slot draws no line', rects.slice(1).filter(r => r.v === 1).length, 0);
    // Even mid-transport, an empty slot shows nothing (no clip = nothing to play).
    resetSeqState(); seqState.lenSteps = 0; seqState.playing = true;
    rects.length = 0;
    drawLoopStrip();
    eq('empty slot draws no playhead while playing', rects.slice(1).filter(r => r.v === 1).length, 0);

    globalThis.fill_rect = origFill;
    resetSeqState();
}

/* ── seq persistence: load on boot, autosave on dirty ────────────────────── */
{
    _log('\nseq persistence:');
    const { installMockEngine, uninstallMockEngine } = await import('./mock-engine.mjs');
    const { seqEngineTick, resetSeqEngine } = await import('../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../dist/esm/seq/state.js');
    const { seqPersistTick, resetSeqPersist } = await import('../dist/esm/seq/persist.js');

    // Mock the device filesystem. With no active_set.txt present, persist falls
    // back to the per-set "_default" path (off-device / no native set).
    const files = {};
    const PATH = '/data/UserData/schwung/modules/tools/movy/sets/_default/seq-state.json';
    globalThis.host_read_file  = (p) => files[p] ?? null;
    globalThis.host_write_file = (p, c) => { files[p] = c; return true; };

    const engine = installMockEngine();
    // Extend the mock to serve/accept a state blob.
    let engineState = 'movy1\nbpm 12000\n';
    const origGet = globalThis.host_module_get_param;
    globalThis.host_module_get_param = (key) => (key === 'state' ? engineState : origGet(key));
    const origSetB = globalThis.host_module_set_param_blocking;
    let loadedBlob = null;
    globalThis.host_module_set_param_blocking = (key, val) => {
        if (key === 'state') loadedBlob = val;
        return true;
    };

    // Restore: a saved file on disk is pushed to the engine once on boot.
    files[PATH] = 'movy1\nbpm 14000\ncl 0 0 16 0 0:24:60:100\n';
    resetSeqEngine(); resetSeqState(); resetSeqPersist();
    seqEngineTick();      // boot probe → ready
    seqPersistTick();     // first ready tick → load
    eq('state restored from file on boot', loadedBlob, files[PATH]);

    // Autosave: when dirty, the serialized state is written to the file.
    engineState = 'movy1\nbpm 13000\ncl 0 0 32 0 0:24:62:110\n';
    seqState.dirty = true;
    files[PATH] = ''; // clear to observe the write
    for (let i = 0; i < 700; i++) seqPersistTick(); // past the save interval
    eq('autosave wrote the engine state', files[PATH], engineState);
    eq('dirty cleared after save', seqState.dirty, false);

    // Not dirty → no write.
    files[PATH] = 'SENTINEL';
    for (let i = 0; i < 700; i++) seqPersistTick();
    eq('no write when clean', files[PATH], 'SENTINEL');

    globalThis.host_module_get_param = origGet;
    globalThis.host_module_set_param_blocking = origSetB;
    delete globalThis.host_read_file;
    delete globalThis.host_write_file;
    uninstallMockEngine(); resetSeqEngine(); resetSeqState(); resetSeqPersist();
    globalThis.host_read_file = () => null; // restore the default test stub
}

/* ── automation: restore re-requests label sync ──────────────────────────────
 * The boot label-sync runs before the persist restore, so it reads the engine
 * before its lanes exist (empty registry → no dot, no held value, no read-back
 * suppression). The restore must re-request the sync so the registry repopulates
 * from the now-restored engine labels. */
_log('\nautomation: restore re-requests label sync:');
{
    const { resetSeqEngine, seqEngineTick, takeLabelSync } = await import('../dist/esm/seq/engine.js');
    const { seqPersistTick, resetSeqPersist } = await import('../dist/esm/seq/persist.js');
    const { resetSeqState } = await import('../dist/esm/seq/state.js');
    const { installMockEngine, uninstallMockEngine } = await import('./mock-engine.mjs');

    const files = {};
    const PATH = '/data/UserData/schwung/modules/tools/movy/seq-state.json';
    globalThis.host_read_file  = (p) => files[p] ?? null;
    globalThis.host_write_file = () => true;
    const engine = installMockEngine();
    const origSetB = globalThis.host_module_set_param_blocking;
    globalThis.host_module_set_param_blocking = () => true;

    files[PATH] = 'movy1\nau 0 0 100 synth:cutoff\n';   // a persisted lane label
    resetSeqEngine(); resetSeqState(); resetSeqPersist();
    seqEngineTick();          // boot probe → ready → requestLabelSync (the boot's own)
    takeLabelSync();          // consume it, to isolate the restore's re-request
    eq('no pending label sync before restore', takeLabelSync(), false);
    seqPersistTick();         // first ready tick → restore pushes state
    eq('restore re-requests label sync', takeLabelSync(), true);

    globalThis.host_module_set_param_blocking = origSetB;
    delete globalThis.host_read_file;
    delete globalThis.host_write_file;
    uninstallMockEngine(); resetSeqEngine(); resetSeqState(); resetSeqPersist();
    globalThis.host_read_file = () => null;
}

/* ── active-notes mirror ─────────────────────────────────────────────────── */
{
    _log('\nactive-notes mirror:');
    const { activeFromStr, activeHasNote } = await import('../dist/esm/seq/state.js');

    activeFromStr('60.64,,38,');
    eq('track0 has 60',  activeHasNote(0, 60), true);
    eq('track0 has 64',  activeHasNote(0, 64), true);
    eq('track0 lacks 38', activeHasNote(0, 38), false);
    eq('track1 empty',   activeHasNote(1, 60), false);
    eq('track2 has 38',  activeHasNote(2, 38), true);
    activeFromStr(',,,'); // all clear
    eq('cleared',        activeHasNote(2, 38), false);
}

/* ── last-held set ───────────────────────────────────────────────────────── */
{
    _log('\nlast-held set:');
    const { noteHeld, setHeldSet, clearHeldSet } = await import('../dist/esm/seq/held.js');

    clearHeldSet(0);
    eq('empty initially', noteHeld(0, 60), false);
    setHeldSet(0, [60, 64, 67]);
    eq('60 held',  noteHeld(0, 60), true);
    eq('64 held',  noteHeld(0, 64), true);
    eq('62 not',   noteHeld(0, 62), false);
    eq('track1 unaffected', noteHeld(1, 60), false);
    setHeldSet(0, [72]);                 // replaces
    eq('replaced: 60 gone', noteHeld(0, 60), false);
    eq('replaced: 72 in',   noteHeld(0, 72), true);
}

/* ── drum pad LED color ──────────────────────────────────────────────────── */
{
    _log('\ndrum pad LED color:');
    globalThis.Black     = 0;
    globalThis.White     = 120;
    globalThis.NeonGreen = 11;

    const { drumPadLedColor } = await import('../dist/esm/keyboard/leds.js');
    const { trackColor } = await import('../dist/esm/seq/colors.js');

    const cfg = { rawMidi: false, padNoteStart: 36, padCount: 16 };
    const padMin = 68;
    // pad index 0 => drumPad 1 => note 36; selected when currentPhysPad === pad.
    const unselNotPlaying = drumPadLedColor(68, padMin, cfg, 36, /*phys*/-1, /*track*/2, /*playing*/false);
    eq('unselected = track color', unselNotPlaying, trackColor(2));
    const selected = drumPadLedColor(68, padMin, cfg, 36, /*phys*/68, 2, false);
    eq('selected = white', selected, 120);
    const playing = drumPadLedColor(68, padMin, cfg, 36, -1, 2, /*playing*/true);
    eq('playing = green', playing, 11);
    const off = drumPadLedColor(72, padMin, cfg, 36, -1, 2, false); // col>=4 => off
    eq('right half = off', off, 0);
}

/* ── chromatic pad LED color ─────────────────────────────────────────────── */
{
    _log('\nchromatic pad LED color:');
    const { chromaticPadColor, chromaticPitch } = await import('../dist/esm/seq/pads.js');
    const { trackColor } = await import('../dist/esm/seq/colors.js');
    const { setHeldSet, clearHeldSet } = await import('../dist/esm/seq/held.js');

    const padMin = 68, base = 60; // bottom-left = C4
    // bottom-left pad is the root C => track color, unless playing/held.
    eq('root = track color', chromaticPadColor(68, padMin, base, 0, false), trackColor(0));
    eq('playing = green',    chromaticPadColor(68, padMin, base, 0, /*playing*/true), 11);
    // mark the held set: pitch at pad 69 = C#4 = 61.
    setHeldSet(0, [chromaticPitch(69, padMin, base)]);
    eq('held-set = white',   chromaticPadColor(69, padMin, base, 0, false), 120);
    clearHeldSet(0);
    // step-hold overlay: holdNotes array overrides the noteHeld set
    const holdPitches = [chromaticPitch(68, padMin, base)]; // C4 = 60
    eq('holdNotes-in-array = white', chromaticPadColor(68, padMin, base, 0, false, holdPitches), 120);
    eq('holdNotes-missing = normal', chromaticPadColor(69, padMin, base, 0, false, holdPitches), 0); // C# out of scale → black
}

/* ── transport LEDs ──────────────────────────────────────────────────────── */
{
    _log('\ntransport LEDs:');
    const { transportPlayColor, transportRecColor } = await import('../dist/esm/seq/leds.js');
    const { C_REC_RED } = await import('../dist/esm/seq/colors.js');

    eq('play stopped = dark grey',   transportPlayColor(false), 124);
    eq('play running = green',       transportPlayColor(true), 11);
    eq('rec idle = dark grey',       transportRecColor(false, false), 124);
    eq('rec recording = red',        transportRecColor(true, false), C_REC_RED);
    eq('rec counting-in = red',      transportRecColor(false, true), C_REC_RED);
    eq('rec proper red color = 127', C_REC_RED, 127);
}

/* ── affordance LEDs ─────────────────────────────────────────────────────── */
{
    _log('\naffordance LEDs:');
    const {
        backLedColor, arrowLedColor, sampleLedColor, captureLedColor, undoLedColor,
    } = await import('../dist/esm/seq/buttons.js');
    const { VIEW_CHAIN, VIEW_KNOBS } = await import('../dist/esm/app/state.js');

    eq('back off in chain view',  backLedColor(VIEW_CHAIN), 0);
    eq('back dim in module view', backLedColor(VIEW_KNOBS), 16);
    eq('left off at bar 0',  arrowLedColor(-1, 0, 3, false), 0);
    eq('left dim mid',       arrowLedColor(-1, 1, 3, false), 16);
    eq('left bright pressed', arrowLedColor(-1, 1, 3, true), 124);
    eq('right off at max',   arrowLedColor(+1, 3, 3, false), 0);
    eq('right dim mid',      arrowLedColor(+1, 1, 3, false), 16);
    eq('sample always off',  sampleLedColor(), 0);
    eq('capture off',        captureLedColor(), 0);
    eq('undo off',           undoLedColor(), 0);
}

/* ── step-icon LEDs ──────────────────────────────────────────────────────── */
{
    _log('\nstep-icon LEDs:');
    const { stepIconColor } = await import('../dist/esm/seq/leds.js');

    // step indexes are 0-based: step 6 -> idx 5 (metro), step 10 -> idx 9 (full vel)
    const off = { shift: false, metro: false, fullVel: false };
    eq('metro idx dark when off+noshift', stepIconColor(5, off), 0);
    eq('metro idx lit when metro on',     stepIconColor(5, { shift: false, metro: true, fullVel: false }), 124);
    eq('fullvel idx lit when on',         stepIconColor(9, { shift: false, metro: false, fullVel: true }), 124);
    // Shift held: all shortcut icons show (dim if inactive, bright if active).
    eq('shift shows metro dim',  stepIconColor(5, { shift: true, metro: false, fullVel: false }), 16);
    eq('shift shows dbl-loop dim', stepIconColor(14, { shift: true, metro: false, fullVel: false }), 16);
    eq('shift shows quant dim',  stepIconColor(15, { shift: true, metro: false, fullVel: false }), 16);
    eq('non-shortcut idx dark',  stepIconColor(0, { shift: true, metro: false, fullVel: false }), 0);
    // Set Params openers (steps 5/7/9 = idx 4/6/8): dim while Shift held, full bright while page open.
    eq('shift shows set-params step dim', stepIconColor(4, { shift: true, metro: false, fullVel: false }), 16);
    eq('set-params step bright when page open', stepIconColor(6, { shift: false, metro: false, fullVel: false, mainPage: true }), 124);
    eq('set-params step dark when closed+noshift', stepIconColor(8, { shift: false, metro: false, fullVel: false, mainPage: false }), 0);
    // Clip Params opener (Step 3 = idx 2): dim while Shift held in Track view,
    // full bright while the page is open, off in Session view (not available there).
    eq('shift shows clip-params step dim', stepIconColor(2, { shift: true, metro: false, fullVel: false }), 16);
    eq('clip-params step bright when page open', stepIconColor(2, { shift: false, metro: false, fullVel: false, clipPage: true }), 124);
    eq('clip-params step dark when closed+noshift', stepIconColor(2, { shift: false, metro: false, fullVel: false, clipPage: false }), 0);
    eq('clip-params step off in Session even with Shift', stepIconColor(2, { shift: true, metro: false, fullVel: false, session: true }), 0);
}

/* ── track-button LEDs ───────────────────────────────────────────────────── */
{
    _log('\ntrack-button LEDs:');
    const { trackButtonColor } = await import('../dist/esm/seq/leds.js');
    const { trackColor, trackColorDim } = await import('../dist/esm/seq/colors.js');

    eq('base = track color', trackButtonColor(1, /*active*/false, /*muted*/false), trackColor(1));
    eq('active = white pulse', trackButtonColor(1, true, false), 120);
    eq('muted dim',     trackButtonColor(2, false, true), trackColorDim(2));
    eq('muted+active still white', trackButtonColor(2, true, true), 120);
}

/* ── loop bar color ──────────────────────────────────────────────────────── */
{
    _log('\nloop bar color:');
    const { loopBarColor } = await import('../dist/esm/seq/leds.js');
    const { trackColor } = await import('../dist/esm/seq/colors.js');

    const base = { isPlayhead:false, selected:false, hasContent:false, inLoop:false, blink:true, track:1 };
    eq('playhead green', loopBarColor({ ...base, isPlayhead:true }), 11);
    eq('selected white', loopBarColor({ ...base, selected:true }), 120);
    eq('content blink on = track', loopBarColor({ ...base, hasContent:true, blink:true }), trackColor(1));
    eq('content blink off = off', loopBarColor({ ...base, hasContent:true, blink:false }), 0);
    eq('empty = off', loopBarColor({ ...base }), 0);
}

/* ── session cell color ──────────────────────────────────────────────────── */
{
    _log('\nsession cell color:');
    const { sessionCellColor } = await import('../dist/esm/seq/session.js');
    const { trackColor, C_BLACK, C_WHITE, C_DARKGREY,
            ANIM_NONE, ANIM_PULSE, ANIM_PULSE_FAST, ANIM_PULSE_SLOW }
        = await import('../dist/esm/seq/colors.js');

    const base = { exists:false, isSel:false, isPlaying:false, isQueued:false, track:1 };
    const tc = trackColor(1);
    const led = (ctx) => JSON.stringify(sessionCellColor(ctx));
    const want = (b, a, ch) => JSON.stringify({ base:b, anim:a, channel:ch });
    // Solid (no animation) states.
    eq('empty unselected = off', led({ ...base }), want(C_BLACK, C_BLACK, ANIM_NONE));
    eq('content unselected = solid track', led({ ...base, exists:true }), want(tc, tc, ANIM_NONE));
    eq('selected empty = solid grey', led({ ...base, isSel:true }), want(C_DARKGREY, C_DARKGREY, ANIM_NONE));
    // Animated states (pulse base->white at distinct rates).
    eq('selected content = slow pulse', led({ ...base, exists:true, isSel:true }), want(tc, C_WHITE, ANIM_PULSE_SLOW));
    eq('playing = pulse', led({ ...base, exists:true, isPlaying:true }), want(tc, C_WHITE, ANIM_PULSE));
    eq('queued = fast pulse', led({ ...base, exists:true, isQueued:true }), want(tc, C_WHITE, ANIM_PULSE_FAST));
    // Priority: queued outranks playing.
    eq('queued outranks playing', sessionCellColor({ ...base, exists:true, isPlaying:true, isQueued:true }).channel, ANIM_PULSE_FAST);
}

/* ── loop single-press selects bar ───────────────────────────────────────── */
{
    _log('\nloop single-press selects bar:');
    const { loopStepOn, resetLoopMode } = await import('../dist/esm/seq/loop-mode.js');
    const { seqState, resetSeqState } = await import('../dist/esm/seq/state.js');

    resetLoopMode();
    seqState.barOffset = 0;
    loopStepOn(3);
    eq('barOffset follows press', seqState.barOffset, 3);
}

/* ── header announce TTL ─────────────────────────────────────────────────── */
{
    _log('\nheader announce TTL:');
    const { seqHeaderAnnounce, seqHeaderActive, seqHeaderTick, resetSeqHeader } =
        await import('../dist/esm/seq/render.js');

    resetSeqHeader();
    eq('inactive initially', seqHeaderActive(), false);
    seqHeaderAnnounce('Session', 2);
    eq('active after announce', seqHeaderActive(), true);
    seqHeaderTick(); seqHeaderTick();
    eq('expires after ttl', seqHeaderActive(), false);
}

/* ── mute gesture ────────────────────────────────────────────────────────── */
{
    _log('\nmute gesture:');
    const { installMockEngine, uninstallMockEngine } = await import('./mock-engine.mjs');
    const { muteTrack, setMuteHeld, muteHeld } = await import('../dist/esm/seq/router.js');
    const { seqState, resetSeqState } = await import('../dist/esm/seq/state.js');
    const { peekSeqCmdQueue, resetSeqEngine } = await import('../dist/esm/seq/engine.js');

    installMockEngine();
    resetSeqEngine(); resetSeqState();

    setMuteHeld(true);
    eq('mute held', muteHeld(), true);
    resetSeqEngine();
    seqState.muted[2] = false;
    muteTrack(2);
    eq('queues mute on', peekSeqCmdQueue().some(c => c === 'mute 2 1'), true);
    resetSeqEngine();
    seqState.muted[2] = true;
    muteTrack(2);
    eq('queues mute off', peekSeqCmdQueue().some(c => c === 'mute 2 0'), true);
    setMuteHeld(false);

    uninstallMockEngine();
}

/* ── mute tap: Track view tap mutes the active track ─────────────────────── */
{
    _log('\nmute tap:');
    const { installMockEngine, uninstallMockEngine } = await import('./mock-engine.mjs');
    const { seqHandleMidi } = await import('../dist/esm/seq/router.js');
    const { resetSeqEngine, peekSeqCmdQueue } = await import('../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../dist/esm/seq/state.js');
    const { resetMomentary } = await import('../dist/esm/seq/momentary.js');
    const { appState } = await import('../dist/esm/app/state.js');

    const CC_MUTE = 88;
    installMockEngine();
    resetSeqEngine(); resetSeqState(); resetMomentary();

    // A quick down+up (< HOLD_MS) is a tap. In Track view it mutes the active
    // track (activeSlot), even though no track button was pressed while held.
    appState.activeSlot = 1;
    seqState.sessionMode = false;
    seqState.muted[1] = false;
    seqHandleMidi([0xB0, CC_MUTE, 127], false);
    seqHandleMidi([0xB0, CC_MUTE, 0], false);
    eq('track-view tap mutes active track', peekSeqCmdQueue().some(c => c === 'mute 1 1'), true);

    // Session view: a Mute tap must NOT mute (Mute stays a pure modifier there).
    resetSeqEngine(); resetMomentary();
    appState.activeSlot = 2;
    seqState.sessionMode = true;
    seqState.muted[2] = false;
    seqHandleMidi([0xB0, CC_MUTE, 127], false);
    seqHandleMidi([0xB0, CC_MUTE, 0], false);
    eq('session-view tap does not mute', peekSeqCmdQueue().some(c => c.startsWith('mute 2')), false);

    seqState.sessionMode = false;
    uninstallMockEngine();
}

/* ── mute mirror ─────────────────────────────────────────────────────────── */
{
    _log('\nmute mirror:');
    const { muteFromStr, seqState } = await import('../dist/esm/seq/state.js');

    muteFromStr('0100');
    eq('t0 unmuted', seqState.muted[0], false);
    eq('t1 muted',   seqState.muted[1], true);
    eq('t2 unmuted', seqState.muted[2], false);
    muteFromStr('1111');
    eq('all muted',  seqState.muted[3], true);
}

/* ── momentary: tap vs hold ───────────────────────────────────────────────── */
{
    _log('\nmomentary tap vs hold:');
    const { momentaryDownAt, momentaryUpAt, momentaryGesture, resetMomentary } =
        await import('../dist/esm/seq/momentary.js');

    let restored = 0;
    const restore = () => { restored++; };

    // Timestamps are wall-clock ms (HOLD_MS = 500). A quick tap (< 500 ms) →
    // latch, restore NOT called.
    resetMomentary();
    momentaryDownAt(40, 1000, restore);
    eq('tap returns tap', momentaryUpAt(40, 1300), 'tap'); // 300 ms
    eq('tap does not restore', restored, 0);

    // Hold (>= 500 ms) → revert, restore called.
    resetMomentary();
    momentaryDownAt(40, 1000, restore);
    eq('hold returns revert', momentaryUpAt(40, 1700), 'revert'); // 700 ms
    eq('hold restores', restored, 1);

    // 499 ms is still a tap (one ms below threshold).
    resetMomentary();
    momentaryDownAt(40, 0, restore);
    eq('499 ms is still tap', momentaryUpAt(40, 499), 'tap');
    eq('499-ms does not restore', restored, 1);

    // 500 ms exactly → revert.
    resetMomentary();
    momentaryDownAt(40, 0, restore);
    eq('500 ms is hold', momentaryUpAt(40, 500), 'revert');
    eq('500-ms restores', restored, 2);

    // Gesture while held → revert even on a quick release.
    resetMomentary();
    momentaryDownAt(40, 1000, restore);
    momentaryGesture();
    eq('gesture returns revert', momentaryUpAt(40, 1050), 'revert'); // 50 ms
    eq('gesture restores', restored, 3);

    // Up for a different button is ignored.
    resetMomentary();
    momentaryDownAt(40, 1000, restore);
    eq('other-button up none', momentaryUpAt(58, 2000), 'none');
    eq('other-button up ignored', restored, 3);
}

/* ── seqRestoreWatch: restores watchTrack + barOffset ───────────────────── */
{
    _log('\nseqRestoreWatch:');
    const { installMockEngine, uninstallMockEngine } = await import('./mock-engine.mjs');
    const { resetSeqEngine, peekSeqCmdQueue } = await import('../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../dist/esm/seq/state.js');
    const { seqRestoreWatch } = await import('../dist/esm/seq/router.js');

    installMockEngine();
    resetSeqEngine(); resetSeqState();
    seqState.watchTrack = 2;
    seqState.barOffset  = 3;

    seqRestoreWatch(0);
    eq('watchTrack restored to 0', seqState.watchTrack, 0);
    eq('barOffset reset to 0',     seqState.barOffset,  0);
    const cmds = peekSeqCmdQueue();
    eq('watch cmd emitted', cmds.some(c => c === 'watch 0'), true);

    // Calling with same track still resets barOffset and emits watch.
    resetSeqEngine();
    seqState.watchTrack = 1; seqState.barOffset = 2;
    seqRestoreWatch(1);
    eq('same track: barOffset reset', seqState.barOffset, 0);
    eq('same track: watch emitted',   peekSeqCmdQueue().some(c => c === 'watch 1'), true);

    uninstallMockEngine(); resetSeqEngine(); resetSeqState();
}

/* ── selected-note entry (a step press places the full white selection) ───── */
{
    _log('\nseq selected-note entry:');
    const { installMockEngine, uninstallMockEngine } = await import('./mock-engine.mjs');
    const { seqHandleMidi } = await import('../dist/esm/seq/router.js');
    const { seqEngineTick, resetSeqEngine } = await import('../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../dist/esm/seq/state.js');
    const { setHeldSet } = await import('../dist/esm/seq/held.js');

    const engine = installMockEngine();
    resetSeqEngine(); resetSeqState(); seqEngineTick();
    seqState.lenSteps = 16; seqState.watchLane = -1;
    const lastOp = () => engine.ops[engine.ops.length - 1];

    // Select a 3-note chord (white selection), then enter with no pads held.
    setHeldSet(0, [60, 64, 67]);
    seqState.lastVel[0] = 100;
    seqState.lastPitch[0] = 60;
    seqHandleMidi([0x90, 16 + 2, 127], false);
    seqHandleMidi([0x80, 16 + 2, 0], false);
    seqEngineTick();
    eq('step press enters full selection', lastOp(), 'tog 0 2 60 100 64 100 67 100');

    uninstallMockEngine(); resetSeqEngine(); resetSeqState();
}

/* ── synth multi-entry (two empty steps held → notes on both) ─────────────── */
{
    _log('\nseq synth multi-entry:');
    const { installMockEngine, uninstallMockEngine } = await import('./mock-engine.mjs');
    const { seqHandleMidi } = await import('../dist/esm/seq/router.js');
    const { seqEngineTick, resetSeqEngine } = await import('../dist/esm/seq/engine.js');
    const { seqState, resetSeqState, occHasStep } = await import('../dist/esm/seq/state.js');
    const { setHeldSet } = await import('../dist/esm/seq/held.js');
    const { resetStepEdit } = await import('../dist/esm/seq/step-edit.js');

    const engine = installMockEngine();
    resetSeqEngine(); resetSeqState(); resetStepEdit(); seqEngineTick();
    seqState.lenSteps = 16; seqState.watchLane = -1;       // melodic
    setHeldSet(0, [60]); seqState.lastVel[0] = 100; seqState.lastPitch[0] = 60;

    // Two EMPTY steps pressed together → BOTH get notes, no length gesture.
    seqHandleMidi([0x90, 16 + 4, 127], false);   // press empty step 4
    seqHandleMidi([0x90, 16 + 6, 127], false);   // press empty step 6 while 4 held
    seqHandleMidi([0x80, 16 + 6, 0], false);     // release → step 6 toggles on
    seqHandleMidi([0x80, 16 + 4, 0], false);     // release → step 4 toggles on
    seqEngineTick();                             // flush queued cmds into engine.ops
    eq('synth multi: step 4 entered', occHasStep(4), true);
    eq('synth multi: step 6 entered', occHasStep(6), true);
    eq('synth multi: no length gesture', engine.ops.some((o) => o.startsWith('slen')), false);

    uninstallMockEngine(); resetSeqEngine(); resetSeqState(); resetStepEdit();
}

/* ── length gesture: occupancy gate + end/start toggle ────────────────────── */
{
    _log('\nseq length gesture (occupancy + toggle):');
    const { installMockEngine, uninstallMockEngine } = await import('./mock-engine.mjs');
    const { seqHandleMidi } = await import('../dist/esm/seq/router.js');
    const { seqEngineTick, resetSeqEngine } = await import('../dist/esm/seq/engine.js');
    const { seqState, resetSeqState, occHasStep, occToggleStep } =
        await import('../dist/esm/seq/state.js');
    const { resetStepEdit } = await import('../dist/esm/seq/step-edit.js');

    const engine = installMockEngine();
    const TPS = 24; // ticks per step
    // Flush queued cmds, then return slen ops emitted since the last flush call.
    const slenAfter = () => { seqEngineTick(); return engine.ops.filter((o) => o.startsWith('slen')); };
    const press = (b) => seqHandleMidi([0x90, 16 + b, 127], false);
    const release = (b) => seqHandleMidi([0x80, 16 + b, 0], false);

    // Occupied anchor: first press B=3 → note ends at END of step 3 (4 steps).
    resetSeqEngine(); resetSeqState(); resetStepEdit(); engine.reset(); seqEngineTick();
    seqState.lenSteps = 16; seqState.watchLane = -1;
    occToggleStep(0);                 // step 0 has a note (occupied anchor)
    press(0);                          // hold occupied step 0
    press(3);                          // press step 3 → length to END of 3
    eq('length end-of-B: slen = 4 steps', slenAfter().at(-1), `slen 0 0 0 -1 ${4 * TPS}`);
    eq('length gesture: B not entered', occHasStep(3), false);

    // Press same B=3 again (still holding A) → trim to START of step 3 (3 steps).
    release(3); press(3);
    eq('length toggle: slen = 3 steps', slenAfter().at(-1), `slen 0 0 0 -1 ${3 * TPS}`);
    // Press again → back to END (4 steps).
    release(3); press(3);
    eq('length toggle back: slen = 4 steps', slenAfter().at(-1), `slen 0 0 0 -1 ${4 * TPS}`);
    release(3); release(0);

    // Backward press (B <= A) on an occupied anchor → no-op, no entry.
    seqEngineTick(); engine.reset(); resetStepEdit();
    if (!occHasStep(5)) occToggleStep(5);   // ensure step 5 occupied (anchor)
    press(5);
    press(2);                          // B < A
    eq('backward press: no slen', slenAfter().length, 0);
    eq('backward press: step 2 not entered', occHasStep(2), false);
    release(2); release(5);

    uninstallMockEngine(); resetSeqEngine(); resetSeqState(); resetStepEdit();
}

/* ── step-row length span ────────────────────────────────────────────────── */
{
    _log('\nstep-row length span:');
    const { lengthSpanColor } = await import('../dist/esm/seq/leds.js');
    const { C_LIGHTGREY, C_DARKGREY, trackColorDim } = await import('../dist/esm/seq/colors.js');
    // held abs step 2, length 4 → steps 3,4,5 are span (light-grey), step 2 is the held note.
    eq('span step light-grey', lengthSpanColor(4, 2, 4, 0), C_LIGHTGREY); // absStep 4 within [3,5]
    eq('last span step light-grey', lengthSpanColor(5, 2, 4, 0), C_LIGHTGREY);
    eq('held step not span', lengthSpanColor(2, 2, 4, 0), -1);          // -1 = "not a span step"
    eq('past span', lengthSpanColor(6, 2, 4, 0), -1);
    eq('1-step note has no tail', lengthSpanColor(3, 2, 1, 0), -1);
    eq('no hold', lengthSpanColor(4, -1, 0, 0), -1);
    // The tail must be visually distinct from in-clip dim and out-of-clip dark-grey.
    eq('tail grey differs from in-clip dim', C_LIGHTGREY !== trackColorDim(0), true);
    eq('tail grey differs from out-of-clip dark-grey', C_LIGHTGREY !== C_DARKGREY, true);
}

/* ── hold-A-press-B length gesture ──────────────────────────────────────── */
{
    _log('\nhold-A-press-B length:');
    const { installMockEngine, uninstallMockEngine } = await import('./mock-engine.mjs');
    const { resetSeqEngine, peekSeqCmdQueue } = await import('../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../dist/esm/seq/state.js');
    const { editStepDown, setLengthTo, heldStepAbs, resetStepEdit } = await import('../dist/esm/seq/step-edit.js');

    installMockEngine();
    resetSeqEngine(); resetSeqState(); resetStepEdit();
    seqState.barOffset = 0; seqState.watchLane = -1; seqState.watchTrack = 0;

    editStepDown(2);                  // hold step 2 (abs 2)
    eq('heldStepAbs is 2', heldStepAbs(), 2);
    setLengthTo(6);                   // first press of step 6 → ends at END of 6 = 5 steps = 120 ticks
    eq('slen emitted (end of B)', peekSeqCmdQueue().some(c => c === 'slen 0 2 2 -1 120'), true);
    setLengthTo(6);                   // same B again → trim to START of 6 = 4 steps = 96 ticks
    eq('slen emitted (start of B, toggled)', peekSeqCmdQueue().some(c => c === 'slen 0 2 2 -1 96'), true);
    resetStepEdit();
    editStepDown(4);
    eq('B<=A is no-op', setLengthTo(4), false);

    uninstallMockEngine(); resetSeqEngine(); resetSeqState(); resetStepEdit();
}

/* ── playhead position ───────────────────────────────────────────────────── */
{
    _log('\nplayhead position:');
    const { playheadX } = await import('../dist/esm/seq/render.js');
    const W = 128;
    eq('start at 0', playheadX(0, 32, W), 0);
    eq('mid', playheadX(16 * 24, 32, W), 64);   // half of a 32-step clip
    eq('clamps to width-1', playheadX(999999, 32, W), W - 1);
    eq('empty clip → 0', playheadX(0, 0, W), 0);
}

/* ── batch3 status mirror ────────────────────────────────────────────────── */
{
    _log('\nbatch3 status mirror:');
    const { parseStatusForTest } = await import('../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../dist/esm/seq/state.js');
    resetSeqState();
    parseStatusForTest('play=1 tick=10 step=2 pos=53 len=32 hlen=4 occ=' + '0'.repeat(64));
    eq('posTick parsed', seqState.posTick, 53);
    eq('holdLen parsed', seqState.holdLen, 4);
    parseStatusForTest('hnotes=60.64.67');
    eq('holdNotes parsed (3 pitches)', seqState.holdNotes.length, 3);
    eq('holdNotes[0] = 60', seqState.holdNotes[0], 60);
    parseStatusForTest('hnotes=');
    eq('holdNotes empty string clears array', seqState.holdNotes.length, 0);
}

/* ── visual metronome helper ─────────────────────────────────────────────── */
{
    _log('\nvisual metronome:');
    const { metronomeStep } = await import('../dist/esm/seq/leds.js');

    eq('beat0 lights step 0',  metronomeStep(0, 0),       true);
    eq('beat0 lights step 3',  metronomeStep(3, 0),       true);
    eq('beat0 dark step 4',    metronomeStep(4, 0),       false);
    eq('beat1 lights step 4',  metronomeStep(4, 96),      true);
    eq('beat3 lights step 12', metronomeStep(12, 96 * 3), true);
    eq('wraps to beat0 at 4 beats', metronomeStep(0, 96 * 4), true);
}

/* ── big font (preset value) ───────────────────────────────────────────── */
_log('\nTest: big preset font metrics');
{
    const { fontWidthBig, BIG_FONT_HEIGHT } = await import('../dist/esm/font/big.js');
    eq('big font cap-height = 11', BIG_FONT_HEIGHT, 11);
    // Up to 3 preset digits must fit the 32px knob cell (else small-font fallback).
    eq('3 digits fit the cell', fontWidthBig('888') <= 32, true);
}

/* ── preset knob render style ──────────────────────────────────────────── */
_log('\nTest: preset param uses the preset render style');
{
    // obxd_like has 8 root knobs (= KNOBS_PER_PAGE), so the preset gets its own
    // page 0; rows[0][0] is the preset param.
    const vm = bootModel(MOCK_SYNTHS.obxd_like).getViewModel();
    eq('preset knob renderStyle = preset', vm.rows[0][0]?.renderStyle, 'preset');
}

/* ── model exposes per-knob param info for automation ────────────────────── */
_log('\nTest: getKnobParamInfo');
{
    const m = bootModel(MOCK_SYNTHS.obxd_like);
    const info = m.getKnobParamInfo(0);
    eq('param info present', info !== null, true);
    eq('param info has key', typeof info.key, 'string');
    eq('param info has target', info.target, 'synth');
    eq('param info has automatable flag', typeof info.automatable, 'boolean');
    // Out-of-range knob → null.
    eq('out-of-range knob → null', m.getKnobParamInfo(99), null);
}

/* ── viewmodel carries automation fields ─────────────────────────────────── */
_log('\nTest: viewmodel automation fields');
{
    const m = bootModel(MOCK_SYNTHS.obxd_like);
    const firstKey = m.getKnobParamInfo(0)?.key;
    // Lane 0 bound to the first param's key, with a lock present.
    const auto = {
        assignedLanes: 0b1, activeLanes: 0b1, held: false, poolFull: false,
        heldValues: new Map(), liveValues: new Map(),
        laneForKey: (key) => (key === firstKey ? 0 : -1),
    };
    const vm = m.getViewModel(auto);
    const pv = vm.rows[0][0];
    eq('first param automated dot set', pv.automated, true);
    eq('viewmodel exposes automationHeld', vm.automationHeld, false);
    // No-arg getViewModel → no automation.
    eq('default vm: not automated', m.getViewModel().rows[0][0].automated, false);

    // Held step with a lock on lane 0: the param shows its held-step value
    // INVERTED (touched) instead of the name — even though no knob is physically
    // touched. This is what keeps an automated param highlighted while the step
    // stays held (e.g. after releasing the knob).
    const p0 = m.getKnobParamInfo(0);
    const heldAuto = {
        assignedLanes: 0b1, activeLanes: 0b1, held: true, poolFull: false,
        heldValues: new Map([[0, p0.max]]),   // lane 0 locked to its max at this step
        liveValues: new Map(),
        laneForKey: (key) => (key === firstKey ? 0 : -1),
    };
    const heldVm = m.getViewModel(heldAuto).rows[0][0];
    eq('held param shows as touched (not the name)', heldVm.touched, true);
    // displayValue is the held-step value, not the param's short name.
    eq('held param shows a value, not its name', heldVm.displayValue !== heldVm.shortName, true);
    // The on-screen knob ARC must also follow the held value (base cutoff=0.70,
    // held=max=1.0): editing automation moves the knob, like normal editing.
    eq('held param knob arc follows held value (max → nv≈1)',
        Math.round(heldVm.normalizedValue * 100), 100);

    // Live record (no step held): a knob being turned reports a live value; the
    // arc follows it and the cell shows touched, exactly like normal editing.
    const liveAuto = {
        assignedLanes: 0b1, activeLanes: 0b1, held: false, poolFull: false,
        heldValues: new Map(), liveValues: new Map([[0, p0.max]]),
        laneForKey: (key) => (key === firstKey ? 0 : -1),
    };
    const liveVm = m.getViewModel(liveAuto).rows[0][0];
    eq('live-record param knob arc follows live value (max → nv≈1)',
        Math.round(liveVm.normalizedValue * 100), 100);
    eq('live-record param shows as touched', liveVm.touched, true);
}

/* ── automation: registry + lane assignment ──────────────────────────────── */
_log('\nautomation registry:');
{
    const {
        resetAutomation, laneForParam, assignLane, norm7, denorm7,
    } = await import('../dist/esm/seq/automation.js');
    const { resetSeqEngine, peekSeqCmdQueue } = await import('../dist/esm/seq/engine.js');
    resetAutomation(); resetSeqEngine();
    eq('norm7 mid → 64', norm7(1, 0, 2), 64);
    eq('denorm7 max → 2', denorm7(127, 0, 2), 2);

    const info = { gi: 0, key: 'cutoff', ioKey: 'cutoff', target: 'synth', value: 1, min: 0, max: 2, type: 'float', automatable: true };
    const lane = assignLane(0, 0, info, () => true);
    eq('first lane assigned', lane, 0);
    eq('lane lookup by target:param', laneForParam(0, 'synth:cutoff'), 0);
    // alabel + abase queued for the engine.
    const q = peekSeqCmdQueue().join('|');
    eq('alabel queued', q.includes('alabel 0 0 synth:cutoff'), true);
    eq('abase queued', q.includes('abase 0 0 64'), true);
    // Re-assigning the same param returns the same lane.
    eq('same param → same lane', assignLane(0, 0, info, () => true), 0);
    // Pool of 8: filling all returns -1.
    for (let i = 1; i < 8; i++) assignLane(0, 0, { ...info, key: 'k' + i, ioKey: 'k' + i }, () => true);
    eq('pool full → -1', assignLane(0, 0, { ...info, key: 'k8', ioKey: 'k8' }, () => true), -1);
}

/* ── automation: pool-full derives from the live lane count ───────────────── */
/* (Not the old sticky autoPoolFull flag, which lagged a step behind reaching 8
 * and never reset when lanes were freed → params stayed hidden forever.) */
_log('\nautomation pool-full (lane count):');
{
    const { resetAutomation, assignLane, clearLane, poolIsFull } = await import('../dist/esm/seq/automation.js');
    const { resetSeqEngine } = await import('../dist/esm/seq/engine.js');
    resetAutomation(); resetSeqEngine();
    const mk = (k) => ({ gi: 0, key: k, ioKey: k, target: 'synth', value: 1, min: 0, max: 2, type: 'float', automatable: true });
    eq('empty pool not full', poolIsFull(0), false);
    for (let i = 0; i < 7; i++) assignLane(0, 0, mk('k' + i), () => true);
    eq('7 lanes not full yet', poolIsFull(0), false);
    assignLane(0, 0, mk('k7'), () => true);            // 8th → full immediately
    eq('8 lanes → pool full', poolIsFull(0), true);
    clearLane(0, 3);                                   // freeing a lane → not full
    eq('after freeing one → not full', poolIsFull(0), false);
}

/* ── automation: knob-turn routing (hold-step / Rec / base) ──────────────── */
_log('\nautomation knob routing:');
{
    const { resetAutomation, handleAutomationKnob, automationKnobReleased, liveTurnValues } = await import('../dist/esm/seq/automation.js');
    const { resetSeqEngine, peekSeqCmdQueue } = await import('../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../dist/esm/seq/state.js');
    const info = { gi: 0, key: 'cutoff', ioKey: 'cutoff', target: 'synth', value: 1, min: 0, max: 2, type: 'float', automatable: true };

    // Step-automation mode: knob turn writes a lock at the held step.
    resetAutomation(); resetSeqEngine(); resetSeqState();
    seqState.stepAutoMode = true; seqState.holdStep = 4;
    eq('step-auto knob consumed', handleAutomationKnob(0, 0, info, +1, () => true), true);
    eq('aset at held step 4', peekSeqCmdQueue().some((o) => o.startsWith('aset 0 0 4 ')), true);

    // Non-automatable param is never consumed.
    resetAutomation(); resetSeqEngine(); resetSeqState();
    seqState.stepAutoMode = true; seqState.holdStep = 4;
    eq('non-automatable not consumed',
        handleAutomationKnob(0, 0, { ...info, automatable: false }, +1, () => true), false);

    // Normal mode (no step-auto, no Rec): not consumed → normal param path edits
    // the base immediately (no lag).
    resetAutomation(); resetSeqEngine(); resetSeqState();
    eq('normal-mode knob not consumed (even if a lane)',
        handleAutomationKnob(0, 0, info, +1, () => true), false);

    // Rec-armed + playing → lock at the current playing step.
    resetAutomation(); resetSeqEngine(); resetSeqState();
    seqState.recording = true; seqState.playing = true; seqState.curStep = 7;
    eq('rec knob consumed', handleAutomationKnob(0, 0, info, +1, () => true), true);
    eq('aset at playing step 7', peekSeqCmdQueue().some((o) => o.startsWith('aset 0 0 7 ')), true);
    resetSeqState();

    // Live-recorded automation latches: releasing the knob does NOT revert the
    // param to base — the recorded lock holds until its end trigger.
    resetAutomation(); resetSeqEngine(); resetSeqState();
    seqState.recording = true; seqState.playing = true; seqState.curStep = 7;
    handleAutomationKnob(0, 0, info, +1, () => true);   // assigns lane 0, records lock
    const beforeLen = peekSeqCmdQueue().length;
    automationKnobReleased(0, 0, info);
    const afterRelease = peekSeqCmdQueue().slice(beforeLen);
    eq('recorded-lane release issues no abase revert',
        afterRelease.some((o) => o.startsWith('abase 0 0')), false);
    resetSeqState();

    // Live take: the on-screen knob follows the turn (a live value exists for the
    // lane), then snaps back to base on release (the live value is cleared).
    resetAutomation(); resetSeqEngine(); resetSeqState();
    seqState.recording = true; seqState.playing = true; seqState.curStep = 3;
    handleAutomationKnob(0, 0, info, +5, () => true);
    eq('live take exposes a live knob value while turning', liveTurnValues(0).has(0), true);
    automationKnobReleased(0, 0, info);
    eq('release clears the live knob value (knob snaps to base)', liveTurnValues(0).has(0), false);
    resetSeqState();

    // A live take must ACCUMULATE across playback steps. The status poll clears
    // heldLocks each tick (no step held), and the playhead advances every step;
    // if the live seed came from heldLocks / a per-step context it would reset to
    // base on every turn (the "feedback loop back to the original position" bug).
    resetAutomation(); resetSeqEngine(); resetSeqState();
    seqState.recording = true; seqState.playing = true;
    seqState.curStep = 2;
    handleAutomationKnob(0, 0, info, +5, () => true);
    const v1 = liveTurnValues(0).get(0);
    seqState.heldLocks.clear();            // simulate the ~24Hz hauto poll wiping it
    seqState.curStep = 3;                  // playhead advanced to the next step
    handleAutomationKnob(0, 0, info, +5, () => true);
    const v2 = liveTurnValues(0).get(0);
    eq('live take accumulates across steps (not reset to base)', v2 > v1, true);
    eq('live take accumulated by both deltas', v2 - v1, 5);
    resetSeqState();

    // Step-automation does NOT leak a live value (held path drives the knob via
    // heldLocks instead, so the knob doesn't snap back while the step is held).
    resetAutomation(); resetSeqEngine(); resetSeqState();
    seqState.stepAutoMode = true; seqState.holdStep = 4;
    handleAutomationKnob(0, 0, info, +1, () => true);
    eq('step-auto turn does not set a live value', liveTurnValues(0).has(0), false);
    resetSeqState();
}

/* ── Clear + automation-knob clear must not delete the clip ──────────────── */
_log('\nclear + automation knob:');
{
    const { deleteButton, markDeleteActed, resetEditOps } =
        await import('../dist/esm/seq/edit-ops.js');
    const { resetSeqEngine, peekSeqCmdQueue } = await import('../dist/esm/seq/engine.js');
    resetEditOps(); resetSeqEngine();
    deleteButton(true);            // hold Clear
    markDeleteActed();             // automation-knob clear acted
    deleteButton(false);           // release Clear
    eq('clear+automation-knob does not delete clip',
        peekSeqCmdQueue().some((o) => o.startsWith('clipdel')), false);
}

/* ── toast shows a flat ~1s regardless of requested ttl ─────────────────── */
_log('\ntoast duration:');
{
    const { seqToast, seqToastActive, seqToastTick, resetSeqToast } =
        await import('../dist/esm/seq/render.js');
    resetSeqToast();
    seqToast('hi', 10);            // request a short ttl (ignored)
    let ticks = 0;
    while (seqToastActive()) { seqToastTick(); ticks++; if (ticks > 1000) break; }
    // ~1s at the device's ~196 ticks/s; flat regardless of the requested ttl.
    eq('toast shows ~1s (180–210 ticks) regardless of requested ttl', ticks >= 180 && ticks <= 210, true);
}

/* ── duplicate gesture (Copy held → source → dest, replace) ──────────────── */
_log('\nduplicate gesture:');
{
    const { copyButton, onUnit, dupActive, resetDuplicate } =
        await import('../dist/esm/seq/duplicate.js');
    const { resetSeqEngine, peekSeqCmdQueue } = await import('../dist/esm/seq/engine.js');

    // Clip: copy source slot, paste-replace at dest (cross-track), source stays armed.
    resetDuplicate(); resetSeqEngine();
    copyButton(true);
    eq('dup active while held', dupActive(), true);
    onUnit({ kind: 'clip', track: 0, slot: 0 });
    onUnit({ kind: 'clip', track: 1, slot: 3 });
    onUnit({ kind: 'clip', track: 2, slot: 5 }); // second dest — source still armed
    const q = peekSeqCmdQueue();
    eq('clip copy emitted', q.includes('clipcopy 0 0'), true);
    eq('clip paste 1', q.includes('clippaste 1 3'), true);
    eq('clip paste 2 (armed)', q.includes('clippaste 2 5'), true);
    copyButton(false);
    eq('dup inactive after release', dupActive(), false);

    // Step: cpy single step, pst at dest.
    resetDuplicate(); resetSeqEngine();
    copyButton(true);
    onUnit({ kind: 'step', track: 0, step: 2 });
    onUnit({ kind: 'step', track: 0, step: 9 });
    const qs = peekSeqCmdQueue();
    eq('step copy', qs.includes('cpy 0 2 2'), true);
    eq('step paste', qs.includes('pst 0 9'), true);
    copyButton(false);

    // Bar: cpy the 16-step bar range, pst at dest bar start.
    resetDuplicate(); resetSeqEngine();
    copyButton(true);
    onUnit({ kind: 'bar', track: 0, bar: 0 });
    onUnit({ kind: 'bar', track: 0, bar: 2 });
    const qb = peekSeqCmdQueue();
    eq('bar copy', qb.includes('cpy 0 0 15'), true);
    eq('bar paste', qb.includes('pst 0 32'), true);
    copyButton(false);

    // No source captured yet → a press is the source, not a paste.
    resetDuplicate(); resetSeqEngine();
    copyButton(true);
    onUnit({ kind: 'clip', track: 0, slot: 1 });
    eq('first press is copy not paste',
        peekSeqCmdQueue().some((o) => o.startsWith('clippaste')), false);
    copyButton(false);

    // onUnit ignored when not held.
    resetDuplicate(); resetSeqEngine();
    onUnit({ kind: 'clip', track: 0, slot: 0 });
    eq('onUnit no-op when not held', peekSeqCmdQueue().length, 0);
}

/* ── automation: hold+knob gesture enters step-auto, release is not a tap ─── */
_log('\nautomation gesture (tap vs hold):');
{
    const { resetAutomation, handleAutomationKnob } = await import('../dist/esm/seq/automation.js');
    const { editStepDown, editStepUp, endStepAutomation, resetStepEdit } =
        await import('../dist/esm/seq/step-edit.js');
    const { resetSeqEngine, peekSeqCmdQueue } = await import('../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../dist/esm/seq/state.js');
    const info = { gi: 0, key: 'cutoff', ioKey: 'cutoff', target: 'synth', value: 1, min: 0, max: 2, type: 'float', automatable: true };

    resetAutomation(); resetSeqEngine(); resetSeqState(); resetStepEdit();
    editStepDown(0);                         // hold step 0 (barOffset 0)
    eq('not step-auto until a gesture', seqState.stepAutoMode, false);
    eq('hold+knob consumed', handleAutomationKnob(0, 0, info, +1, () => true), true);
    eq('entered step-auto mode', seqState.stepAutoMode, true);
    eq('aset at held step 0', peekSeqCmdQueue().some((o) => o.startsWith('aset 0 0 0 ')), true);
    eq('release after step-auto is NOT a tap', editStepUp(0), false);

    // A plain tap (no knob, no hold) stays a tap → toggles a note.
    resetStepEdit(); resetSeqState();
    editStepDown(1);
    eq('plain press is still a tap', editStepUp(1), true);

    // endStepAutomation clears the mode + held snapshot.
    seqState.stepAutoMode = true; seqState.heldLocks.set(0, 50);
    endStepAutomation();
    eq('endStepAutomation clears mode', seqState.stepAutoMode, false);
    eq('endStepAutomation clears heldLocks', seqState.heldLocks.size, 0);
}

/* ── automation: tap a knob (no turn) in step-auto clears that step ───────── */
_log('\nautomation tap-to-clear:');
{
    const { resetAutomation, handleAutomationKnob, automationKnobTouched, automationKnobReleased } =
        await import('../dist/esm/seq/automation.js');
    const { resetStepEdit } = await import('../dist/esm/seq/step-edit.js');
    const { resetSeqEngine, peekSeqCmdQueue } = await import('../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../dist/esm/seq/state.js');
    const info = { gi: 0, key: 'cutoff', ioKey: 'cutoff', target: 'synth', value: 1, min: 0, max: 2, type: 'float', automatable: true };

    resetAutomation(); resetSeqEngine(); resetSeqState(); resetStepEdit();
    seqState.stepAutoMode = true; seqState.holdStep = 4;
    handleAutomationKnob(0, 0, info, +1, () => true);    // create a lock by turning
    eq('lock present after a turn', seqState.heldLocks.has(0), true);

    // Tap = touch then release without turning → clears this step's lock.
    resetSeqEngine();
    automationKnobTouched(0);
    automationKnobReleased(0, 0, info);
    eq('tap queues aclrs at held step', peekSeqCmdQueue().some((o) => o.startsWith('aclrs 0 0 4')), true);
    eq('tap clears the optimistic held lock', seqState.heldLocks.has(0), false);

    // Touch + turn is NOT a tap → no clear.
    resetSeqEngine();
    automationKnobTouched(0);
    handleAutomationKnob(0, 0, info, +1, () => true);
    automationKnobReleased(0, 0, info);
    eq('touch+turn does not clear', peekSeqCmdQueue().some((o) => o.startsWith('aclrs')), false);
    resetSeqState();
}

/* ── automation: holding a bar in Loop mode sets the whole bar ────────────── */
_log('\nautomation bar-range (Loop mode):');
{
    const { resetAutomation, handleAutomationKnob } = await import('../dist/esm/seq/automation.js');
    const { editStepDown, resetStepEdit } = await import('../dist/esm/seq/step-edit.js');
    const { resetSeqEngine, peekSeqCmdQueue } = await import('../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../dist/esm/seq/state.js');
    const info = { gi: 0, key: 'cutoff', ioKey: 'cutoff', target: 'synth', value: 1, min: 0, max: 2, type: 'float', automatable: true };

    resetAutomation(); resetSeqEngine(); resetSeqState(); resetStepEdit();
    seqState.loopMode = true;
    editStepDown(1);                         // hold bar 1 → range steps 16..31
    eq('bar-knob consumed', handleAutomationKnob(0, 0, info, +1, () => true), true);
    eq('writes asetr across the bar', peekSeqCmdQueue().some((o) => o.startsWith('asetr 0 0 16 31 ')), true);
    eq('no single-step aset for a bar', peekSeqCmdQueue().some((o) => o.startsWith('aset 0 0 ')), false);
    resetSeqState(); resetStepEdit();
}

/* ── automation: held-step display change detection (repaint trigger) ─────── */
_log('\nautomation display-dirty:');
{
    const { resetAutomation, automationDisplayDirty, handleAutomationKnob, automationKnobReleased } = await import('../dist/esm/seq/automation.js');
    const { resetSeqEngine } = await import('../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../dist/esm/seq/state.js');

    resetAutomation(); resetSeqState();
    eq('idle: not dirty', automationDisplayDirty(), false);

    seqState.stepAutoMode = true;
    eq('enter step-auto → dirty', automationDisplayDirty(), true);
    eq('unchanged → not dirty', automationDisplayDirty(), false);

    seqState.heldLocks.set(0, 100);          // a lock appears at the held step
    eq('new lock → dirty', automationDisplayDirty(), true);

    seqState.heldLocks.set(0, 50);           // turning the knob changes the value
    eq('lock value change → dirty', automationDisplayDirty(), true);
    eq('same value again → not dirty', automationDisplayDirty(), false);

    seqState.stepAutoMode = false;           // release the step
    eq('exit step-auto → dirty', automationDisplayDirty(), true);
    resetAutomation(); resetSeqState();

    // Live record (NOT step-auto): turning a knob must ALSO trigger a repaint so
    // the on-screen arc/value follows the live take; release snaps back to base
    // (also a repaint). Without this, the screen stays frozen while turning.
    resetAutomation(); resetSeqEngine(); resetSeqState();
    const liveInfo = { gi: 0, key: 'cutoff', ioKey: 'cutoff', target: 'synth', value: 1, min: 0, max: 2, type: 'float', automatable: true };
    seqState.recording = true; seqState.playing = true; seqState.curStep = 2;
    automationDisplayDirty();                 // settle the baseline signature
    handleAutomationKnob(0, 0, liveInfo, +5, () => true);
    eq('live take knob turn → dirty', automationDisplayDirty(), true);
    eq('live take unchanged → not dirty', automationDisplayDirty(), false);
    automationKnobReleased(0, 0, liveInfo);
    eq('live take release (snap to base) → dirty', automationDisplayDirty(), true);
    resetAutomation(); resetSeqEngine(); resetSeqState();
}

/* ── pad-scope: concrete→alias reverse mapping ───────────────────────────── */
_log('\npad-scope aliasFromConcrete:');
{
    const { aliasFromConcrete } = await import('../dist/esm/model/pad-scope.js');
    const ps = { aliasPrefix: 'pad_', concreteKeyTemplate: 'p{pad}_{suffix}', padDigits: 2 };
    eq('p07_pan → pad_pan', aliasFromConcrete(ps, 'p07_pan'), 'pad_pan');
    eq('p01_decay_ms → pad_decay_ms', aliasFromConcrete(ps, 'p01_decay_ms'), 'pad_decay_ms');
    eq('bare alias is not concrete → null', aliasFromConcrete(ps, 'pad_pan'), null);
    eq('non-matching key → null', aliasFromConcrete(ps, 'timbre'), null);
    eq('no scoping → null', aliasFromConcrete(undefined, 'p07_pan'), null);
}

/* ── automation: lane validation (purge stale / obsolete-alias lanes) ─────── */
_log('\nautomation validateLane:');
{
    const { validateLane } = await import('../dist/esm/seq/automation.js');
    const ps = { aliasPrefix: 'pad_', concreteKeyTemplate: 'p{pad}_{suffix}', padDigits: 2 };
    // The lookup mirrors the model's loaded param set (config-driven for drums:
    // it lists the ALIAS keys, never the concrete per-pad keys).
    const meta = { cutoff: { min: 0, max: 2, type: 'float' }, pad_pan: { min: -1, max: 1, type: 'float' } };
    const lookup = (k) => meta[k] ?? null;
    // Plain param present → keep with its range.
    eq('plain param kept (range)', validateLane('synth:cutoff', null, lookup).max, 2);
    // Bare pad-alias key (pre per-pad migration) → drop even though pad_pan exists.
    eq('obsolete alias dropped', validateLane('synth:pad_pan', ps, lookup), 'drop');
    // Concrete pad key whose alias IS a known param → KEEP (its alias' range).
    eq('valid per-pad lane kept', validateLane('synth:p07_pan', ps, lookup).max, 1);
    // Concrete pad key whose alias is unknown (module changed) → stale → drop.
    eq('stale per-pad lane dropped', validateLane('synth:p07_cutoff', ps, lookup), 'drop');
    // Plain param not in the set (cross-module leftover) → stale → drop.
    eq('stale plain param dropped', validateLane('synth:timbre', ps, lookup), 'drop');
}

/* ── automation: clearing a clip's automation re-requests a label sync ─────── */
/* The engine frees a lane when its last lock is removed; the UI must re-sync so
 * the freed lane leaves the registry (no phantom assigned lane). */
_log('\nautomation clear re-requests label sync:');
{
    const { resetAutomation, clearStepAllAutomation, automationKnobReleased, automationKnobTouched, assignLane } =
        await import('../dist/esm/seq/automation.js');
    const { resetSeqEngine, takeLabelSync } = await import('../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../dist/esm/seq/state.js');

    resetAutomation(); resetSeqEngine(); resetSeqState();
    takeLabelSync();                                   // drain any pending
    clearStepAllAutomation(0, 4);                      // Clear + step
    eq('clearStepAllAutomation requests a label sync', takeLabelSync(), true);

    // Tap-clear (touch + release without turning) clears a step's lock too.
    resetAutomation(); resetSeqEngine(); resetSeqState();
    takeLabelSync();
    seqState.stepAutoMode = true; seqState.holdStep = 4;
    const info = { gi: 0, key: 'cutoff', ioKey: 'cutoff', target: 'synth', value: 1, min: 0, max: 2, type: 'float', automatable: true };
    const tapLane = assignLane(0, 0, info, () => true); // lane must exist + hold a lock to clear
    seqState.heldLocks.set(tapLane, 60);
    takeLabelSync();                                   // drain the assign's sync, if any
    automationKnobTouched(0);                           // arm tap-to-clear
    automationKnobReleased(0, 0, info);                // tap (never turned) → aclrs
    eq('tap-clear requests a label sync', takeLabelSync(), true);
    resetSeqState();
}

/* ── automation: label re-sync from engine (validates + purges) ───────────── */
_log('\nautomation label sync:');
{
    const { resetAutomation, syncLabelsFromEngine, laneForParam, automationRegistry } =
        await import('../dist/esm/seq/automation.js');
    const { resetSeqEngine, peekSeqCmdQueue } = await import('../dist/esm/seq/engine.js');
    resetAutomation(); resetSeqEngine();
    const applied = [];
    // Lane 1 valid (cutoff), lane 2 obsolete-alias (pad_vol), lane 3 stale (timbre).
    syncLabelsFromEngine(
        '-.synth:cutoff.synth:pad_vol.synth:timbre.-.-.-.-,-.-.-.-.-.-.-.-,-.-.-.-.-.-.-.-,-.-.-.-.-.-.-.-',
        (slot, lane, tp) => applied.push(slot + ':' + lane + ':' + tp),
        (track, tp) => {
            if (tp === 'synth:cutoff') return { min: 0, max: 1, type: 'float' };
            if (tp === 'synth:pad_vol') return 'drop';   // obsolete alias
            if (tp === 'synth:timbre') return 'drop';    // stale param
            return 'unknown';
        },
    );
    eq('valid lane synced into registry', laneForParam(0, 'synth:cutoff'), 1);
    eq('re-applied valid knob mapping', applied.includes('0:1:synth:cutoff'), true);
    eq('obsolete-alias lane purged', laneForParam(0, 'synth:pad_vol'), -1);
    eq('stale lane purged', laneForParam(0, 'synth:timbre'), -1);
    // Purge emits aclr so the engine + persistence drop the lane too.
    const q = peekSeqCmdQueue();
    eq('aclr queued for obsolete-alias lane', q.includes('aclr 0 2'), true);
    eq('aclr queued for stale lane', q.includes('aclr 0 3'), true);
    eq('no aclr for the valid lane', q.includes('aclr 0 1'), false);
}

/* ── step page: held trig values parse into the mirror ───────────────────── */
{
    _log('\nstep page status parse:');
    const { parseStatusForTest } = await import('../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../dist/esm/seq/state.js');
    resetSeqState();
    parseStatusForTest('play=0 trk=0 step=3 hvel=100 hgate=48 hgmix=1 hprob=40 hcond=2:3 hinv=1');
    eq('holdVel parsed', seqState.holdVel, 100);
    eq('holdGate parsed', seqState.holdGate, 48);
    eq('holdGateMixed parsed', seqState.holdGateMixed, true);
    eq('holdProb parsed', seqState.holdProb, 40);
    eq('holdCondA parsed', seqState.holdCondA, 2);
    eq('holdCondB parsed', seqState.holdCondB, 3);
    eq('holdInvert parsed', seqState.holdInvert, true);
}

/* ── step page: session-memory selection rule ────────────────────────────── */
{
    _log('\nstep page memory:');
    const { stepPageState, onSessionStart, onSessionEnd, setStepPageSelected, resetStepPage } =
        await import('../dist/esm/seq/step-page.js');
    resetStepPage();
    onSessionStart();
    eq('first session defaults to module page', stepPageState.selected, false);
    setStepPageSelected(true);
    onSessionEnd();
    onSessionStart();
    eq('step page reopens after a step-page session', stepPageState.selected, true);
    setStepPageSelected(false);
    onSessionEnd();
    onSessionStart();
    eq('module-page session does not reopen step page', stepPageState.selected, false);
}

/* ── step page: ViewModel builder + value mappings ───────────────────────── */
{
    _log('\nstep page viewmodel:');
    const { buildStepPageVM, LENGTH_TICKS, lengthIndexForTicks } =
        await import('../dist/esm/seq/step-page-vm.js');
    eq('48 ticks -> 1/8 index', lengthIndexForTicks(48), 2);
    eq('length list 1/8 = 48 ticks', LENGTH_TICKS[2], 48);
    const vm = buildStepPageVM({
        holdVel: 100, holdGate: 48, holdGateMixed: false,
        holdProb: 40, holdCondA: 2, holdCondB: 3, holdInvert: true,
    });
    eq('title is step', vm.moduleName, 'step');
    const c = vm.rows[0];
    eq('velocity = vbar', c[0].renderStyle, 'vbar');
    eq('velocity bar at avg', Math.abs(c[0].normalizedValue - 100 / 127) < 0.01, true);
    eq('length = len (fraction render)', c[1].type, 'len');
    eq('length shows 1/8', c[1].displayValue, '1/8');
    eq('probability shows 40%', c[2].displayValue, '40%');
    eq('condition = preset', c[3].renderStyle, 'preset');
    eq('condition shows 2:3', c[3].displayValue, '2:3');
    eq('invert ON', vm.rows[1][0].displayValue, 'ON');
    const vm2 = buildStepPageVM({ holdVel: 80, holdGate: 24, holdGateMixed: true,
        holdProb: 100, holdCondA: 1, holdCondB: 1, holdInvert: false });
    eq('mixed length shows ...', vm2.rows[0][1].displayValue, '...');
}

/* ── step page: a touched knob produces the shared top toast ──────────────── */
{
    _log('\nstep page toast:');
    const { buildStepPageVM } = await import('../dist/esm/seq/step-page-vm.js');
    const { stepPageState, setStepTouchedKnob } = await import('../dist/esm/seq/step-page.js');
    const h = { holdVel: 90, holdGate: 96, holdGateMixed: false,
        holdProb: 70, holdCondA: 1, holdCondB: 2, holdInvert: false };
    setStepTouchedKnob(-1);
    eq('no toast when nothing touched', buildStepPageVM(h).toast, null);
    setStepTouchedKnob(2);                 // probability knob
    const t = buildStepPageVM(h).toast;
    eq('touched knob → toast name', t.fullName, 'Probability');
    eq('touched knob → toast value', t.value, '70%');
    setStepTouchedKnob(-1);
    stepPageState.touchedKnob = -1;
}

/* ── chromatic pad: root highlight follows baseNote pitch class ──────────── */
{
    _log('\nchromatic pad root highlight:');
    const { chromaticPadColor } = await import('../dist/esm/seq/pads.js');
    // PAD_MIN=68, baseNote=48 (C). Bottom-left pad (68) plays pitch 48 (C) → root.
    // With baseNote=50 (D), pad 68 plays 50 (D) → root color; old code keyed on C only.
    const ROOT_T0 = chromaticPadColor(68, 68, 50, 0, false, null, 0); // D major, root pad
    const trackCol = chromaticPadColor(68, 68, 48, 0, false, null, 0); // C major, root pad
    eq('root highlight follows baseNote pitch class', ROOT_T0, trackCol);
}

/* ── scales: musical scale definitions and in-scale testing ─────────────── */
{
    _log('\nscales:');
    const { SCALES, SCALE_NAMES, inScaleFor } = await import('../dist/esm/seq/scales.js');
    eq('thirteen scales', SCALES.length, 13);
    eq('first scale is Major', SCALE_NAMES[0], 'Major');
    // Major anchored to D (root 2): D E F# G A B C# in scale; F natural (5) out.
    eq('root in scale', inScaleFor(2, 2, 0), true);     // D
    eq('F# in D major', inScaleFor(6, 2, 0), true);     // F#
    eq('F natural out of D major', inScaleFor(5, 2, 0), false);
    // Chromatic (index 12): everything in scale.
    eq('chromatic admits all', inScaleFor(5, 2, 12), true);
}

/* ── main params page: state machine + knob/touch/release handlers ──────── */
{
    _log('\nmain params page:');
    const {
        mainPageState, openMainPage, closeMainPage, mainPageActive,
        mainPageKnob, mainPageTouch, mainPageRelease, resetMainPage,
    } = await import('../dist/esm/seq/main-page.js');
    const { peekSeqCmdQueue, resetSeqEngine } = await import('../dist/esm/seq/engine.js');
    const { keyboardState } = await import('../dist/esm/keyboard/state.js');
    const { resetSeqState } = await import('../dist/esm/seq/state.js');

    // resetSeqState restores bpmX100=12000 and swingPct=50 so the tempo/swing
    // assertions below don't depend on test ordering.
    resetMainPage(); resetSeqEngine(); resetSeqState();
    openMainPage(3);
    eq('page active after open', mainPageActive(), true);
    // Tempo: 8 raw delta units = 1 detent = +1 BPM. seqState.bpmX100 starts 12000.
    mainPageKnob(0, 8, 0);
    const q1 = peekSeqCmdQueue();
    eq('tempo +1 BPM emits bpm 12100', q1.some((c) => c.startsWith('bpm 12100')), true);
    // Swing: +1 detent → swing 51.
    mainPageKnob(1, 8, 0);
    const q2 = peekSeqCmdQueue();
    eq('swing +1 emits swing 51', q2.some((c) => c === 'swing 51'), true);
    // Key overlay: touch opens, turn scrolls, release commits.
    mainPageTouch(3, true);
    eq('overlay opens on key touch', mainPageState.scaleOverlay, true);
    mainPageKnob(3, 8, 0);                 // scroll to scale index 1
    eq('overlay scrolled', mainPageState.scaleSel, 1);
    mainPageRelease(3);
    eq('scale committed on release', keyboardState.scale, 1);
    eq('overlay closed on release', mainPageState.scaleOverlay, false);
    // Root knob wraps the pitch class within the current octave (B↔C); octave fixed.
    keyboardState.rootNote = 59;           // B3 (octave base 48, pitch class 11)
    mainPageKnob(2, 8, 0);                  // +1 detent
    eq('root wraps B->C within octave', keyboardState.rootNote, 48);
    mainPageKnob(2, -8, 0);                 // -1 detent
    eq('root wraps C->B within octave', keyboardState.rootNote, 59);
    // Close returns origin.
    eq('close returns origin view', closeMainPage(), 3);
    eq('page inactive after close', mainPageActive(), false);
}

/* ── clip-scale tables ──────────────────────────────────────────────────── */
{
    _log('\nclip-scale tables:');
    const { SCALE_LABELS, SCALE_RATIONALS, scaleCellText, scaleToastText, rationalToIdx, SCALE_DEFAULT_IDX }
      = await import('../dist/esm/seq/clip-scale.js');
    eq('8 scale values', SCALE_LABELS.length, 8);
    eq('default idx 4', SCALE_DEFAULT_IDX, 4);
    eq('idx4 is 1/1', JSON.stringify(SCALE_RATIONALS[4]), '[1,1]');
    eq('cell whole 1X', scaleCellText(4), '1X');
    eq('cell fraction 1/2', scaleCellText(2), '1/2');
    eq('toast fraction 1/2X', scaleToastText(2), '1/2X');
    eq('toast whole 2X', scaleToastText(6), '2X');
    eq('rationalToIdx 3/4 -> 3', rationalToIdx(3, 4), 3);
}

/* ── clip params page: state machine + knob/touch/release handlers ──────── */
{
    _log('\nclip params page:');
    const {
        clipPageState, openClipPage, closeClipPage, clipPageActive,
        clipPageKnob, clipPageTouch, clipPageRelease, resetClipPage,
    } = await import('../dist/esm/seq/clip-page.js');
    const { seqState, resetSeqState } = await import('../dist/esm/seq/state.js');
    const { resetSeqEngine, peekSeqCmdQueue } = await import('../dist/esm/seq/engine.js');

    resetClipPage(); resetSeqEngine(); resetSeqState();
    openClipPage(2, 0);
    eq('clip page active after open', clipPageActive(), true);
    // Transpose: knob 2, +1 detent (8 raw units) → +1 semitone + ctr command.
    seqState.clipTranspose = 0;
    clipPageKnob(2, 8, 0);
    eq('transpose +1', seqState.clipTranspose, 1);
    eq('emits ctr 0 1', peekSeqCmdQueue().some((c) => c === 'ctr 0 1'), true);
    clipPageKnob(2, -8 * 60, 0);            // drive well past -36
    eq('transpose clamped to -36', seqState.clipTranspose, -36);
    // Length: knob 1, +1 detent → +1 step + clen command.
    seqState.lenSteps = 16;
    clipPageKnob(1, 8, 0);
    eq('length +1 step', seqState.lenSteps, 17);
    eq('emits clen 0 17', peekSeqCmdQueue().some((c) => c === 'clen 0 17'), true);
    // SCALE overlay: knob 0 touch opens, scroll, release commits + emits cscl.
    seqState.clipScaleIdx = 4;
    clipPageTouch(0, true);
    eq('scale overlay opens on touch', clipPageState.scaleOverlay, true);
    clipPageKnob(0, 8, 0);                  // scroll idx 4 -> 5 (3/2)
    eq('overlay scrolled', clipPageState.scaleSel, 5);
    clipPageRelease(0, 0);
    eq('scale committed on release', seqState.clipScaleIdx, 5);
    eq('emits cscl 0 3 2', peekSeqCmdQueue().some((c) => c === 'cscl 0 3 2'), true);
    eq('overlay closed on release', clipPageState.scaleOverlay, false);
    // Close returns the origin view.
    eq('close returns origin view', closeClipPage(), 2);
    eq('clip page inactive after close', clipPageActive(), false);
}

/* ── clip params page: ViewModel ──────────────────────────────────────────── */
{
    _log('\nclip params page VM:');
    const { buildClipPageVM } = await import('../dist/esm/seq/clip-page-vm.js');
    const { openClipPage, clipPageTouch, resetClipPage } = await import('../dist/esm/seq/clip-page.js');
    const { seqState, resetSeqState } = await import('../dist/esm/seq/state.js');

    resetClipPage(); resetSeqState();
    seqState.clipScaleIdx = 2; seqState.lenSteps = 16; seqState.clipTranspose = 12;
    openClipPage(0, 0);
    let vm = buildClipPageVM();
    eq('header is CLIP PARAMETERS', vm.headerOverride, 'CLIP PARAMETERS');
    eq('scale cell stacked text 1/2', vm.rows[0][0].displayValue, '1/2');
    eq('scale cell type len', vm.rows[0][0].type, 'len');
    eq('length cell big 16', vm.rows[0][1].displayValue, '16');
    eq('transpose cell big 12', vm.rows[0][2].displayValue, '12');
    // Toasts carry units.
    clipPageTouch(2, true);
    eq('transpose toast +12 ct', buildClipPageVM().toast.value, '+12 ct');
    clipPageTouch(1, true);
    eq('length toast 16 steps', buildClipPageVM().toast.value, '16 steps');
    clipPageTouch(0, true);                 // opens SCALE overlay
    vm = buildClipPageVM();
    eq('scale toast 1/2X', vm.toast.value, '1/2X');
    eq('overlay on slot 0', vm.overlay && vm.overlay.slot, 0);
}

/* ── step entry is clamped beyond the clip length ────────────────────────── */
{
    _log('\nstep entry clamped beyond length:');
    const { installMockEngine } = await import('./mock-engine.mjs');
    const { seqHandleMidi, seqNotePadPlayed } = await import('../dist/esm/seq/router.js');
    const { seqEngineTick, resetSeqEngine } = await import('../dist/esm/seq/engine.js');
    const { seqState, resetSeqState, occHasStep } = await import('../dist/esm/seq/state.js');

    const engine = installMockEngine();
    resetSeqEngine(); resetSeqState();
    seqEngineTick();
    const lastOp = () => engine.ops[engine.ops.length - 1];
    const tapStep = (b) => { seqHandleMidi([0x90, 16 + b, 127], false); seqHandleMidi([0x80, 16 + b, 0], false); };

    seqNotePadPlayed(0, 80, 72, 110);   // sets the step-entry pitch
    seqState.lenSteps = 4;              // sub-bar clip; steps 4..15 are hidden
    tapStep(8);                          // step 8 is in the hidden remainder
    seqEngineTick();
    eq('no tog for hidden sub-bar step', engine.ops.some((o) => o.startsWith('tog 0 8')), false);
    eq('occ not set beyond length', occHasStep(8), false);
    // A step within the length still places a note (and does not extend it).
    tapStep(2);
    seqEngineTick();
    eq('within-length step places note', occHasStep(2), true);
    eq('tog emitted within length', lastOp(), 'tog 0 2 72 110');
    eq('length unchanged by in-bounds entry', seqState.lenSteps, 4);
    // The next empty bar stays tappable to grow the clip (bar-aligned growth).
    seqState.lenSteps = 16; seqState.barOffset = 1;
    tapStep(0);                          // absolute step 16 → extends to bar 2
    seqEngineTick();
    eq('next empty bar still grows clip', lastOp(), 'tog 0 16 72 110');
}

/* ── held-step notes display transposed (match live pads) ─────────────────── */
{
    _log('\nheld-step transpose display:');
    const { displayHoldNotes } = await import('../dist/esm/seq/leds.js');
    const { seqState, resetSeqState } = await import('../dist/esm/seq/state.js');
    resetSeqState();
    seqState.holdNotes = [60, 64];
    seqState.clipTranspose = 3;
    eq('hold notes shifted +3', JSON.stringify(displayHoldNotes()), '[63,67]');
    seqState.clipTranspose = 0;
    eq('no transpose passes through', JSON.stringify(displayHoldNotes()), '[60,64]');
    seqState.holdNotes = [126]; seqState.clipTranspose = 36;
    eq('clamps to MIDI 127', JSON.stringify(displayHoldNotes()), '[127]');
    resetSeqState();
}

/* ── root change never paints pads directly (drum/Session grids stay fixed) ── */
{
    _log('\nroot change does not paint pads directly:');
    const { mainPageKnob, resetMainPage } = await import('../dist/esm/seq/main-page.js');
    const { keyboardState } = await import('../dist/esm/keyboard/state.js');
    resetMainPage();
    keyboardState.rootNote = 48; // C
    let padPaints = 0;
    const origSetLED = globalThis.setLED;
    globalThis.setLED = (idx) => { if (idx >= 68 && idx <= 99) padPaints++; }; // pad note range
    mainPageKnob(2, 8, 0);       // +1 detent on the root knob (→ setRoot)
    globalThis.setLED = origSetLED;
    eq('root knob turn changes rootNote', keyboardState.rootNote, 49);
    eq('root knob paints no pad LEDs (per-tick track-aware loop owns pads)', padPaints, 0);
}

/* ── main params page ViewModel ──────────────────────────────────────────── */
{
    _log('\nmain params page ViewModel:');
    const { buildMainPageVM } = await import('../dist/esm/seq/main-page-vm.js');
    const { mainPageState, resetMainPage } = await import('../dist/esm/seq/main-page.js');
    const { seqState } = await import('../dist/esm/seq/state.js');
    const { keyboardState } = await import('../dist/esm/keyboard/state.js');

    resetMainPage();
    seqState.bpmX100 = 12000; seqState.swingPct = 50;
    keyboardState.rootNote = 48; keyboardState.scale = 0; // C, Major
    mainPageState.active = true; mainPageState.touchedKnob = 0;
    let vm = buildMainPageVM();
    eq('tempo cell shows 120', vm.rows[0][0].displayValue, '120');
    eq('root cell shows C', vm.rows[0][2].displayValue, 'C');
    eq('key cell shows Major', vm.rows[0][3].displayValue, 'Major');
    eq('toast names tempo', vm.toast.fullName, 'Tempo');
    eq('tempo toast value', vm.toast.value, '120 bpm');
    // Overlay present when scale list open.
    mainPageState.scaleOverlay = true; mainPageState.scaleSel = 1; mainPageState.touchedKnob = 3;
    vm = buildMainPageVM();
    eq('overlay carries 13 scales', vm.overlay && vm.overlay.options.length, 13);
    eq('overlay selection from scaleSel', vm.overlay?.selected, 1);
}

/* ── UI-state persistence round-trip ──────────────────────────────────── */
{
    _log('\nUI-state persistence round-trip:');
    const { serializeUiState, applyUiState } = await import('../dist/esm/seq/persist.js');
    const { keyboardState } = await import('../dist/esm/keyboard/state.js');

    keyboardState.rootNote = 50; keyboardState.scale = 2;
    const blob = serializeUiState();
    keyboardState.rootNote = 48; keyboardState.scale = 0;
    applyUiState(blob);
    eq('root restored', keyboardState.rootNote, 50);
    eq('scale restored', keyboardState.scale, 2);

    // Tolerant parse: unknown fields are ignored; missing fields keep current.
    keyboardState.rootNote = 60; keyboardState.scale = 1;
    applyUiState('{"root":36}');
    eq('partial blob updates root', keyboardState.rootNote, 36);
    eq('partial blob keeps scale', keyboardState.scale, 1);

    // Clamping: root clamped to 0..103.
    applyUiState('{"root":200,"scale":0}');
    eq('root clamped to 103', keyboardState.rootNote, 103);

    // Corrupt JSON is a no-op.
    keyboardState.rootNote = 48; keyboardState.scale = 0;
    applyUiState('not json');
    eq('corrupt blob leaves root unchanged', keyboardState.rootNote, 48);
    eq('corrupt blob leaves scale unchanged', keyboardState.scale, 0);
}


_log('\n── Envelope detection ──');
const P = (key, label, env) => ({ key, label, shortLabel: null, type: 'float',
    min: 0, max: 1, step: 0.01, options: null, renderStyle: 'arc', automatable: true, env });

// Full-word amp ADSR + 4 other params (Moog/OB-Xd main shape)
{
    const page = [
        P('cutoff','Cutoff'), P('resonance','Resonance'), P('contour','Contour'), P('glide','Glide'),
        P('attack','Attack'), P('decay','Decay'), P('sustain','Sustain'), P('release','Release'),
    ];
    const g = detectEnvelopes(page);
    eq('amp ADSR: one group', g.length, 1);
    eq('amp ADSR: a index', g[0]?.a, 4);
    eq('amp ADSR: r index', g[0]?.r, 7);
}
// Two qualified groups: amp (plain) + filter (f_ prefix)
{
    const page = [
        P('attack','Attack'), P('decay','Decay'), P('sustain','Sustain'), P('release','Release'),
        P('f_attack','F Attack'), P('f_decay','F Decay'), P('f_sustain','F Sustain'), P('f_release','F Release'),
    ];
    const g = detectEnvelopes(page);
    eq('dual env: two groups', g.length, 2);
    eq('dual env: amp first (idx0)', g[0]?.a, 0);
    eq('dual env: filter second (idx4)', g[1]?.a, 4);
}
// A2: AD partial (attack+decay, word-matched) → one 2-cell group
{
    const page = [ P('attack','Attack'), P('decay','Decay'), P('cutoff','Cut'), P('reso','Res') ];
    const g = detectEnvelopes(page);
    eq('AD partial: one group', g.length, 1);
    eq('AD partial: roles ad', g[0].roles.join(''), 'ad');
    eq('AD partial: a=0 d=1', `${g[0].a},${g[0].d}`, '0,1');
}
// A2: single role (attack only) → no group (needs ≥2 roles incl. a)
{
    const page = [ P('attack','Attack'), P('cutoff','Cut'), P('reso','Res'), P('drive','Drive') ];
    eq('single role: no group', detectEnvelopes(page).length, 0);
}
// A2: AR partial (qualified) → one group, roles ar
{
    const page = [ P('f_attack','F Attack'), P('f_release','F Release'), P('cut','Cut'), P('res','Res') ];
    const g = detectEnvelopes(page);
    eq('AR partial: one group', g.length, 1);
    eq('AR partial: roles ar', g[0].roles.join(''), 'ar');
    eq('AR partial: named Filter', g[0].name, 'Filter');
}
// A2: ASR partial (3 cells)
{
    const page = [ P('attack','Attack'), P('sustain','Sustain'), P('release','Release'), P('cut','Cut') ];
    const g = detectEnvelopes(page);
    eq('ASR partial: one group', g.length, 1);
    eq('ASR partial: roles asr', g[0].roles.join(''), 'asr');
}
// A2: ADS partial (3 cells, no release)
{
    const page = [ P('attack','Attack'), P('decay','Decay'), P('sustain','Sustain'), P('cut','Cut') ];
    const g = detectEnvelopes(page);
    eq('ADS partial: one group', g.length, 1);
    eq('ADS partial: roles ads', g[0].roles.join(''), 'ads');
}
// A2: surge Amp Envelope — shape/mode curve params are NOT extra env stages
{
    const page = [
        P('env1_attack','Amp EG Attack'), P('env1_decay','Amp EG Decay'),
        P('env1_sustain','Amp EG Sustain'), P('env1_release','Amp EG Release'),
        P('env1_attack_shape','Amp EG Attack Shape'), P('env1_decay_shape','Amp EG Decay Shape'),
        P('env1_release_shape','Amp EG Release Shape'), P('env1_mode','Amp EG Envelope Mode'),
    ];
    const g = detectEnvelopes(page);
    eq('surge amp: one clean group', g.length, 1);
    eq('surge amp: full ADSR', `${g[0].a},${g[0].d},${g[0].s},${g[0].r}`, '0,1,2,3');
}
// A2 out-of-scope: an LFO's own DAHDSR segments must NOT become an envelope
{
    const page = [
        P('lfo0_delay','LFO 1 Delay'), P('lfo0_attack','LFO 1 Attack'),
        P('lfo0_hold','LFO 1 Hold'), P('lfo0_decay','LFO 1 Decay'),
        P('lfo0_sustain','LFO 1 Sustain'), P('lfo0_release','LFO 1 Release'),
    ];
    eq('LFO DAHDSR: no envelope', detectEnvelopes(page).length, 0);
}
// A2 layout: AD group occupies 2 adjacent cells, leftovers fill the rest
// (drive/mix are plain knobs — a cutoff/reso pair would form its own filter line)
{
    const page = [ P('attack','Attack'), P('decay','Decay'), P('drive','Drive'), P('mix','Mix') ];
    const L = planPageLayout(page);
    eq('AD layout: one envelope', L.envelopes.length, 1);
    const e = L.envelopes[0];
    eq('AD layout: startCol 0, count 2', `${e.startCol},${e.cellCount}`, '0,2');
    const line = L.cells.filter(c => c.line === e.line).sort((x,y)=>x.col-y.col).map(c => c.idx);
    eq('AD layout: env cells then leftovers', JSON.stringify(line), JSON.stringify([0,1,2,3]));
}
// Abbreviations
{
    const page = [ P('atk','Atk'), P('dcy','Dcy'), P('sus','Sus'), P('rel','Rel') ];
    eq('abbrev set: one group', detectEnvelopes(page).length, 1);
}
// Bare single letters — all four present → group
{
    const page = [ P('a','A'), P('d','D'), P('s','S'), P('r','R') ];
    eq('bare letters all four: group', detectEnvelopes(page).length, 1);
}
// Bare single letters — only three present → no group (guard)
{
    const page = [ P('a','A'), P('d','D'), P('s','S'), P('cutoff','Cut') ];
    eq('bare letters partial: no group', detectEnvelopes(page).length, 0);
}
// Explicit env tag overrides naming
{
    const page = [ P('h1','Harm',undefined), P('p2','Punch'),
        P('e_a','EA','a'), P('e_d','ED','d'), P('e_s','ES','s'), P('e_r','ER','r') ];
    const g = detectEnvelopes(page);
    eq('env tag: one group', g.length, 1);
    eq('env tag: a index', g[0]?.a, 2);
}
// C5: noise suffix words (ms/time) ignored so *_ms keys still group (mrsample)
{
    const page = [ P('attack_ms','Attack'), P('decay_ms','Decay'),
        P('sustain','Sustain'), P('release_ms','Release') ];
    const g = detectEnvelopes(page);
    eq('C5 ms-suffix: one group', g.length, 1);
    eq('C5 ms-suffix: named Amp', g[0]?.name, 'Amp');
}
// C5: amp_/vca_ qualifier maps to the Amp group name (fizzik/osirus)
{
    const page = [ P('vca_attack','VCA Attack'), P('vca_decay','VCA Decay'),
        P('vca_sustain','VCA Sustain'), P('vca_release','VCA Release') ];
    const g = detectEnvelopes(page);
    eq('C5 vca: one group', g.length, 1);
    eq('C5 vca: named Amp', g[0]?.name, 'Amp');
}
// C5: env-qualified bare letters (env1 a/d/s/r) detect and name after the env
{
    const page = [ P('env1_a','Env1 A'), P('env1_d','Env1 D'),
        P('env1_s','Env1 S'), P('env1_r','Env1 R') ];
    const g = detectEnvelopes(page);
    eq('C5 env1 bare: one group', g.length, 1);
    eq('C5 env1 bare: named Env1', g[0]?.name, 'Env1');
}
// C5 guard: non-env bare letters (phase_r/pan_r/load_a) are NOT envelope roles
{
    const page = [ P('phase_r','Phase R'), P('pan_r','Pan R'),
        P('load_a','Load A'), P('drive','Drive') ];
    eq('C5 non-env bare letters: no group', detectEnvelopes(page).length, 0);
}
// Layout: amp ADSR on second row, others consolidated to first line
{
    const page = [
        P('cutoff','Cutoff'), P('resonance','Resonance'), P('contour','Contour'), P('glide','Glide'),
        P('attack','Attack'), P('decay','Decay'), P('sustain','Sustain'), P('release','Release'),
    ];
    const L = planPageLayout(page);
    eq('layout: env on line 1', L.envelopes[0]?.line, 1);
    const env = L.cells.filter(c => c.line === 1).map(c => c.idx);
    eq('layout: line1 = a,d,s,r order', JSON.stringify(env), JSON.stringify([4,5,6,7]));
    const knobs = L.cells.filter(c => c.line === 0).map(c => c.idx);
    eq('layout: line0 = the others', JSON.stringify(knobs), JSON.stringify([0,1,2,3]));
}
// Layout: scattered ADSR rearranged onto one line, leftovers on the other
{
    const page = [
        P('attack','Attack'), P('cutoff','Cut'), P('sustain','Sustain'), P('reso','Res'),
        P('decay','Decay'), P('glide','Glide'), P('release','Release'), P('tone','Tone'),
    ];
    const L = planPageLayout(page);
    eq('scattered: one envelope', L.envelopes.length, 1);
    const env = L.cells.filter(c => c.line === L.envelopes[0].line).map(c => c.idx);
    eq('scattered: a,d,s,r order', JSON.stringify(env), JSON.stringify([0,4,2,6]));
}


_log('\n── Envelope viewmodel ──');
// test8: row1 = attack/decay/sustain/release → envelope on line 1
{
    const m = bootModel(MOCK_SYNTHS.test8);
    const vm = m.getViewModel();
    eq('test8: line1 is envelope', !!vm.envelopeLines?.[1], true);
    eq('test8: line0 not envelope', !!vm.envelopeLines?.[0], false);
    eq('test8: line1 col0 = Atk', vm.rows[1][0]?.shortName, 'ATK');
    eq('test8: line1 col3 = Rel', vm.rows[1][3]?.shortName, 'REL');
    eq('test8: line0 col0 = Freq', vm.rows[0][0]?.shortName, 'FREQ');
}
// test16: no ADSR → no envelope
{
    const m = bootModel(MOCK_SYNTHS.test16);
    eq('test16: no envelope line0', !!m.getViewModel().envelopeLines?.[0], false);
    eq('test16: no envelope line1', !!m.getViewModel().envelopeLines?.[1], false);
}
// Touch maps to the right cell on the envelope line (knob 6 = sustain)
{
    const m = bootModel(MOCK_SYNTHS.test8);
    m.handleKnobTouch(6);
    const vm = m.getViewModel();
    eq('test8: touching knob6 marks Sus cell', vm.rows[1][2]?.touched, true);
    eq('test8: Atk cell not touched', vm.rows[1][0]?.touched, false);
}


_log('\n── Envelope knob↔screen mapping (rearrange) ──');
// OB-Xd main page: ADSR scattered at page idx 3-6 → consolidated to line 0.
// Physical knob 0 (top-left) must drive the param shown top-left (attack).
{
    const m = bootModel(MOCK_SYNTHS.obxd_like);
    m.changePage(1);                       // preset page is 0; Main is 1
    const vm = m.getViewModel();
    eq('obxd: line0 is envelope', !!vm.envelopeLines?.[0], true);
    eq('obxd: top-left cell = Attack', vm.rows[0][0]?.shortName, 'ATTAC');
    eq('obxd: bottom-left cell = Cutoff', vm.rows[1][0]?.shortName, 'CUTOF');

    // Touch physical knob 0 → top-left (attack) highlights, not the param that
    // used to live at page index 0 (cutoff, now bottom-left).
    m.handleKnobTouch(0);
    const vt = m.getViewModel();
    eq('obxd: knob0 touches top-left (attack)', vt.rows[0][0]?.touched, true);
    eq('obxd: cutoff cell not touched', vt.rows[1][0]?.touched, false);
    eq('obxd: toast names Attack', vt.toast?.fullName, 'Attack');

    // Turn physical knob 0 → attack changes, cutoff unchanged.
    const a0 = m.getValueByKey('attack'), c0 = m.getValueByKey('cutoff');
    m.handleKnobDelta(0, 20);
    m.tick();
    const moved = m.getValueByKey('attack') !== a0;
    eq('obxd: knob0 moves attack', moved, true);
    eq('obxd: knob0 leaves cutoff', m.getValueByKey('cutoff'), c0);
}


/* ── Per-set state ───────────────────────────────────────────────────────── */

_log('\nTest: set-context paths + active-set reader + name index');
{
    const fs = {};
    globalThis.host_read_file  = (p) => (p in fs ? fs[p] : null);
    globalThis.host_write_file = (p, c) => { fs[p] = c; return true; };
    globalThis.host_file_exists = (p) => p in fs;
    globalThis.host_ensure_dir = () => true;

    fs['/data/UserData/schwung/active_set.txt'] = 'abc-123\nMy Song\n';
    const as = readActiveSet();
    eq('readActiveSet uuid', as.uuid, 'abc-123');
    eq('readActiveSet name', as.name, 'My Song');

    eq('state path keyed by uuid', uuidToStatePath('abc-123'),
        '/data/UserData/schwung/modules/tools/movy/sets/abc-123/seq-state.json');
    eq('ui path keyed by uuid', uuidToUiStatePath('abc-123'),
        '/data/UserData/schwung/modules/tools/movy/sets/abc-123/ui-state.json');
    eq('empty uuid → _default state path', uuidToStatePath(''),
        '/data/UserData/schwung/modules/tools/movy/sets/_default/seq-state.json');

    eq('BLANK_STATE is the format tag', BLANK_STATE, 'movy1\n');

    rememberSet('My Song', 'abc-123');
    eq('name index round-trips', loadNameIndex()['My Song'], 'abc-123');

    delete fs['/data/UserData/schwung/active_set.txt'];
    eq('missing active_set → empty uuid', readActiveSet().uuid, '');
}

_log('\nTest: inherit-on-copy resolution');
{
    const fs = {};
    globalThis.host_read_file  = (p) => (p in fs ? fs[p] : null);
    globalThis.host_write_file = (p, c) => { fs[p] = c; return true; };
    globalThis.host_file_exists = (p) => p in fs;
    globalThis.host_ensure_dir = () => true;
    const stPath = (u) => '/data/UserData/schwung/modules/tools/movy/sets/' + u + '/seq-state.json';
    const uiPath = (u) => '/data/UserData/schwung/modules/tools/movy/sets/' + u + '/ui-state.json';
    const setDir = (u) => '/data/UserData/UserLibrary/Sets/' + u;

    eq('strip " Copy"',   stripCopySuffix('My Song Copy'),   'My Song');
    eq('strip " Copy 2"', stripCopySuffix('My Song Copy 2'), 'My Song');
    eq('no suffix → null', stripCopySuffix('My Song'),        null);

    // Parent "p-uuid" (name "My Song") has state + a live Move set.
    fs[stPath('p-uuid')] = 'movy1\nbpm 12000\n';
    fs[uiPath('p-uuid')] = '{"root":50,"scale":1}';
    fs[setDir('p-uuid')] = '';            // dir marker
    fs[setDir('c-uuid')] = '';            // the copy's Move set exists too
    const idx = { 'My Song': 'p-uuid' };

    const cands = findInheritCandidates('My Song Copy', idx);
    eq('one inherit candidate found', cands.length, 1);
    eq('candidate is the parent', cands[0].uuid, 'p-uuid');

    // Resolving a copy with no own state seeds + returns the parent's blob.
    fs['/data/UserData/schwung/modules/tools/movy/sets/name-index.json'] = JSON.stringify(idx);
    const blob = resolveStateBlob('c-uuid', 'My Song Copy');
    eq('inherited state blob', blob, 'movy1\nbpm 12000\n');
    eq('copy seeded into dst state file', fs[stPath('c-uuid')], 'movy1\nbpm 12000\n');
    eq('copy seeded dst ui file', resolveUiBlob('c-uuid'), '{"root":50,"scale":1}');

    // Unknown brand-new set with no family → blank.
    eq('unknown set → blank', resolveStateBlob('z-uuid', 'Fresh'), 'movy1\n');

    // A set that already has its own state returns it (no inherit).
    fs[stPath('own')] = 'movy1\nswing 60\n';
    eq('own state wins', resolveStateBlob('own', 'Whatever'), 'movy1\nswing 60\n');
}

_log('\nTest: switchToSet save-then-load orchestration');
{
    const eng = installMockEngine();         // installs host_module_* on globalThis
    const fs = {};
    globalThis.host_read_file  = (p) => (p in fs ? fs[p] : null);
    globalThis.host_write_file = (p, c) => { fs[p] = c; return true; };
    globalThis.host_file_exists = (p) => p in fs;
    globalThis.host_ensure_dir = () => true;
    const stPath = (u) => '/data/UserData/schwung/modules/tools/movy/sets/' + u + '/seq-state.json';
    const uiPath = (u) => '/data/UserData/schwung/modules/tools/movy/sets/' + u + '/ui-state.json';

    resetSeqPersist();
    eng.reset();

    // Set A has saved state + ui; load it (no old to save on first switch).
    fs[stPath('A')] = 'movy1\nbpm 13000\n';
    fs[uiPath('A')] = '{"root":55,"scale":2}';
    switchToSet('A', 'Song A', false);
    eq('loaded A blob into engine', eng.stateLoads[eng.stateLoads.length - 1], 'movy1\nbpm 13000\n');
    eq('applied A ui root', keyboardState.rootNote, 55);
    eq('applied A ui scale', keyboardState.scale, 2);
    eq('current uuid is A', currentSetUuid(), 'A');

    // The engine now "holds" A's state; switching to fresh B must SAVE A first.
    eng.stateBlob = 'movy1\nbpm 13000\nEDITED\n';     // simulate edited engine state
    switchToSet('B', 'Song B', true);
    eq('A saved before B load', fs[stPath('A')], 'movy1\nbpm 13000\nEDITED\n');
    eq('B is blank (no file, no family)', eng.stateLoads[eng.stateLoads.length - 1], 'movy1\n');
    eq('B ui reset to defaults (root 48)', keyboardState.rootNote, 48);
    eq('B ui reset to defaults (scale 0)', keyboardState.scale, 0);
    eq('current uuid is B', currentSetUuid(), 'B');
}

_log('\nTest: LFO param helpers');
{
    env.setParams({
        'synth:chain_params': JSON.stringify([
            { key: 'cutoff', name: 'Cutoff', type: 'float' },
            { key: 'reso',   name: 'Resonance', type: 'float' },
            { key: 'wave',   name: 'Wave', type: 'enum' },
            { key: 'label',  name: 'Label', type: 'string' },   // filtered out
        ]),
        'fx1:chain_params': JSON.stringify([
            { key: 'mix', name: 'Mix', type: 'float' },
        ]),
    });
    const opts = buildTargetOptions(0, 0);
    eq('target[0] is None', opts[0].label, 'None');
    eq('target[0] target null', opts[0].target, null);
    // Synth: Cutoff/Resonance/Wave (3) + FX1 Mix (1) + other-LFO params (3) = 7, +None = 8
    eq('target option count (string filtered)', opts.length, 8);
    eq('cutoff mapped', JSON.stringify(opts[1]), JSON.stringify({ label: shortenTarget(compLabel('synth'), 'Cutoff'), target: 'synth', param: 'cutoff' }));
    eq('no string-typed param', opts.some(o => o.param === 'label'), false);
    eq('other-LFO target present', opts.some(o => o.target === 'lfo2' && o.param === 'depth'), true);

    eq('shorten fits 11', shortenTarget('Syn', 'Resonance').length <= 11, true);
    eq('shorten format', shortenTarget('Syn', 'Cutoff'), 'Syn:Cutoff');

    eq('targetIndex finds mix', targetIndex(opts, 'fx1', 'mix') > 0, true);
    eq('targetIndex none→0', targetIndex(opts, '', ''), 0);

    eq('shapes count', LFO_SHAPES.length, 6);
    eq('divisions count', LFO_DIVISIONS.length, 27);
    eq('depth +65%', formatDepth(0.65), '+65%');
    eq('depth -65%', formatDepth(-0.65), '-65%');
    eq('depth 0%', formatDepth(0), '0%');
    eq('phase 180°', formatPhase(0.5), '180°');
}

_log('\nTest: LFO model');
{
    const DETENT = 8; // detent.ts DETENT_DIV — raw delta per ±1 step
    env.setParams({
        'synth:chain_params': JSON.stringify([
            { key: 'cutoff', name: 'Cutoff', type: 'float' },
            { key: 'reso',   name: 'Resonance', type: 'float' },
        ]),
        'lfo1:shape': '0', 'lfo1:polarity': '0', 'lfo1:sync': '0',
        'lfo1:rate_hz': '1.0', 'lfo1:rate_div': '19', 'lfo1:depth': '0',
        'lfo1:phase_offset': '0', 'lfo1:retrigger': '0', 'lfo1:target': '', 'lfo1:target_param': '',
        'lfo2:shape': '1', 'lfo2:sync': '0', 'lfo2:rate_hz': '2.0', 'lfo2:depth': '0',
    });
    const m = createLfoModel(0);
    m.tick();
    let vm = m.getViewModel();
    eq('lfo bankCount', vm.bankCount, 2);
    eq('lfo bank 0 name', vm.moduleName, 'LFO 1');
    eq('pos0 is RATE', vm.rows[0][0].shortName, 'RATE');
    eq('pos1 is SYNC', vm.rows[0][1].shortName, 'SYNC');
    eq('pos2 is MODE', vm.rows[0][2].shortName, 'MODE');
    eq('pos3 is TARGET', vm.rows[0][3].shortName, 'TARGET');
    eq('pos4 is SHAPE', vm.rows[1][0].shortName, 'SHAPE');
    eq('pos5 is PHASE', vm.rows[1][1].shortName, 'PHASE');
    eq('pos6 is RETRIG', vm.rows[1][2].shortName, 'RETRIG');
    eq('pos7 is DEPTH', vm.rows[1][3].shortName, 'DEPTH');
    eq('lfoViz on line 1', vm.lfoViz && vm.lfoViz[0].line, 1);
    eq('lfoViz spans shape+phase', vm.lfoViz[0].startCol, 0);
    eq('no LFO cell is automatable', [...vm.rows[0], ...vm.rows[1]].every(c => c && c.automatable === false), true);
    eq('getKnobParamInfo null (not automatable)', m.getKnobParamInfo(0), null);
    eq('componentKey', m.getComponentKey(), 'lfo');

    // Mode (polarity) inline enum — pos 2.
    m.handleKnobDelta(2, DETENT);
    eq('polarity set to Bipolar', env.params['lfo1:polarity'], '1');
    eq('mode display BI', m.getViewModel().rows[0][2].displayValue, 'BI');
    eq('lfoViz mode follows polarity', m.getViewModel().lfoViz[0].mode, 1);

    // Sync — pos 1 — toggles Rate (pos 0) display.
    eq('rate shows Hz when free', m.getViewModel().rows[0][0].displayValue, '1.0 Hz');
    m.handleKnobDelta(1, DETENT);
    eq('sync set', env.params['lfo1:sync'], '1');
    eq('rate shows division when sync', m.getViewModel().rows[0][0].displayValue, '1/4');

    // Rate — pos 0 — division +1, then free clamp.
    m.handleKnobDelta(0, DETENT);
    eq('rate_div incremented', env.params['lfo1:rate_div'], '20');
    m.handleKnobDelta(1, -DETENT);
    eq('sync cleared', env.params['lfo1:sync'], '0');
    m.handleKnobDelta(0, DETENT * 200);
    eq('rate_hz clamped ≤ 20', parseFloat(env.params['lfo1:rate_hz']) <= 20.0, true);

    // Depth — pos 7 — clamps to −1.
    m.handleKnobDelta(7, -1000);
    eq('depth clamped exactly -1', parseFloat(env.params['lfo1:depth']), -1);

    // Target overlay — pos 3.
    m.handleKnobTouch(3);
    vm = m.getViewModel();
    eq('overlay open on target', vm.overlay !== null, true);
    eq('overlay slot 3', vm.overlay.slot, 3);
    eq('overlay first option None', vm.overlay.options[0], 'None');
    m.handleKnobDelta(3, DETENT);       // select option 1 (first real target)
    m.handleKnobRelease(3);
    eq('target committed', env.params['lfo1:target'], 'synth');
    eq('target_param committed', env.params['lfo1:target_param'], 'cutoff');
    eq('auto-enabled on target', env.params['lfo1:enabled'], '1');
    eq('overlay closed', m.getViewModel().overlay, null);

    // Shape — pos 4 — cycling enum, NO overlay.
    m.handleKnobDelta(4, DETENT * 2);   // +2 shapes → index 2 (Saw)
    eq('shape cycled to 2', env.params['lfo1:shape'], '2');
    eq('lfoViz shape follows', m.getViewModel().lfoViz[0].shape, 2);
    m.handleKnobTouch(4);
    eq('shape touch does NOT open overlay', m.getViewModel().overlay, null);
    m.handleKnobRelease(4);

    // Phase — pos 5 — snaps to a 15° grid (exact 45/90/180 selectable).
    m.handleKnobDelta(5, DETENT * 3);   // +3 steps × 15° = 45°
    eq('phase snaps to 45°', m.getViewModel().rows[1][1].displayValue, '45°');
    m.handleKnobDelta(5, DETENT * 3);   // +45° → 90°
    eq('phase snaps to 90°', m.getViewModel().rows[1][1].displayValue, '90°');
    eq('phase exact 0.25', parseFloat(env.params['lfo1:phase_offset']), 0.25);

    // Retrigger — pos 6.
    m.handleKnobDelta(6, DETENT);
    eq('retrigger on', env.params['lfo1:retrigger'], '1');
    eq('lfoViz retrigger follows', m.getViewModel().lfoViz[0].retrigger, 1);

    m.changePage(1);
    vm = m.getViewModel();
    eq('bank 1 name', vm.moduleName, 'LFO 2');
    eq('bank index', vm.bankIndex, 1);
    m.handleKnobDelta(2, DETENT);
    eq('lfo2 polarity written', env.params['lfo2:polarity'], '1');
    eq('lfo1 polarity untouched', env.params['lfo1:polarity'], '1');

    eq('lfo never empty', m.getViewModel().isEmpty, false);
    eq('getDrumConfig null', m.getDrumConfig(), null);
    eq('getFileBrowseTarget null', m.getFileBrowseTarget(), null);
}

_log('\nTest: LFO target commit uses blocking writes (device SHM race)');
{
    const DETENT = 8;
    env.setParams({
        'synth:chain_params': JSON.stringify([{ key: 'cutoff', name: 'Cutoff', type: 'float' }]),
        'lfo1:target': '', 'lfo1:target_param': '',
    });
    // Capture blocking writes; the target commit must go through this path so
    // target+target_param+enabled all land (non-blocking would clobber on device).
    const blocking = [];
    globalThis.shadow_set_param_timeout = (_s, key, val) => { blocking.push([key, val]); env.params[key] = val; return true; };
    const m2 = createLfoModel(0);
    m2.tick();
    m2.handleKnobTouch(3);
    m2.handleKnobDelta(3, DETENT);     // select the first real target
    m2.handleKnobRelease(3);
    eq('target written blocking', blocking.some(([k, v]) => k === 'lfo1:target' && v === 'synth'), true);
    eq('target_param written blocking', blocking.some(([k, v]) => k === 'lfo1:target_param' && v === 'cutoff'), true);
    eq('enabled written blocking', blocking.some(([k, v]) => k === 'lfo1:enabled' && v === '1'), true);
    // No periodic re-read clobber: many ticks later the target is still set.
    for (let i = 0; i < 400; i++) m2.tick();
    eq('target persists across ticks (no poll clobber)', m2.getViewModel().rows[0][3].displayValue !== 'None', true);
    delete globalThis.shadow_set_param_timeout;
}

_log('\nTest: LFO chain slot wiring');
{
    eq('CHAIN_SLOTS has 5 entries', CHAIN_SLOTS.length, 5);
    eq('slot 4 is LFO', CHAIN_SLOTS[4].componentKey, 'lfo');
    eq('LFO_CHAIN_INDEX', LFO_CHAIN_INDEX, 4);
    eq('isLfoSlot(4)', isLfoSlot(4), true);
    eq('isLfoSlot(1)', isLfoSlot(1), false);

    env.setParams({});
    init();
    eq('each track has 5 models', appState.trackModels[0].length, 5);
    eq('track model 4 is LFO', appState.trackModels[0][4].getComponentKey(), 'lfo');
    eq('track model 1 is a module', appState.trackModels[0][1].getComponentKey(), 'synth');
}

_log('\nTest: detectLfoViz');
{
    const P = (lfo) => ({ key: lfo ?? 'x', lfo, type: 'float', min: 0, max: 1, step: 1, options: null, renderStyle: 'arc', shortLabel: null, label: '', automatable: false });
    const g1 = detectLfoViz([P('shape'), P('phase'), P('mode'), P('retrig'), null, null, null, null]);
    eq('one group', g1.length, 1);
    eq('shape idx', g1[0].shape, 0);
    eq('phase idx', g1[0].phase, 1);
    eq('mode idx', g1[0].mode, 2);
    eq('retrig idx', g1[0].retrig, 3);
    const g2 = detectLfoViz([P('shape'), P('phase'), null, null, null, null, null, null]);
    eq('mode/retrig optional', JSON.stringify([g2[0].mode, g2[0].retrig]), JSON.stringify([null, null]));
    const g3 = detectLfoViz([P('shape'), P(null), null, null, null, null, null, null]);
    eq('needs phase', g3.length, 0);
    const g4 = detectLfoViz([P(null), P(null)]);
    eq('no markers → none', g4.length, 0);
}

_log('\nTest: module-LFO viz inference (A3)');
{
    const LP = (key, label, type, options = null) => ({
        key, label, type, options,
        min: 0, max: type === 'enum' ? options.length - 1 : 1, step: type === 'enum' ? 1 : 0.01,
        renderStyle: 'arc', shortLabel: null, automatable: true, lfo: undefined,
    });
    // Run detection + layout reorder + VM build the way the real pipeline does.
    const viz = (params, values) => buildLfoViz(planPageLayout(params).lfos, params, values);

    // Shape name → id mapping (renderer table).
    eq('map: Ramp Down → saw-down 6', lfoShapeId('Ramp Down'), 6);
    eq('map: Sample & Hold → 4', lfoShapeId('Sample & Hold'), 4);
    eq('map: Step Sequencer → 9', lfoShapeId('Step Sequencer'), 9);
    eq('map: Wave 3 → generic 10', lfoShapeId('Wave 3'), 10);
    eq('map: Cutoff → not a shape', lfoShapeId('Cutoff'), null);
    eq('isShapeEnum: division list is not a shape', isShapeEnum(['Off', '1/4', '1/8']), false);

    // chordism-like: Shape(enum wave) + Rate → reordered onto one line, rate encoded.
    {
        const params = [
            LP('lfo_shape', 'LFO Wave', 'enum', ['Triangle', 'Ramp Up', 'Ramp Down', 'Square']),
            LP('lfo_rate', 'LFO Rate', 'float'),
            LP('lfo_depth', 'LFO Depth', 'float'),
            LP('cutoff', 'Cutoff', 'float'),
        ];
        const g = detectLfoViz(params);
        eq('chordism: one group', g.length, 1);
        eq('chordism: inferred', g[0].inferred, true);
        // no phase → partner is rate; layout seats shape+rate at cols 0,1.
        const L = planPageLayout(params);
        eq('chordism layout: partner is rate', L.lfos[0].partnerRole, 'rate');
        eq('chordism layout: shape col0, rate col1', `${L.cells.find(c => c.idx === 0).col},${L.cells.find(c => c.idx === 1).col}`, '0,1');
        const vm = viz(params, [2, 0.5, 0.3, 0.4]);   // value 2 = Ramp Down, rate 0.5
        eq('chordism vm: shape id 6', vm[0].shape, 6);
        eq('chordism vm: startCol 0', vm[0].startCol, 0);
        eq('chordism vm: rate → 1.5 cycles', vm[0].cycles, 1.5);
    }
    // fizzik-like: two LFO rows → two groups reordered onto their own lines.
    {
        const shp = ['Sine', 'Tri', 'Saw', 'Square', 'S&H'];
        const tgt = ['Off', 'Cutoff', 'Pitch'];
        const params = [
            LP('lfo1_rate', 'LFO1 Rate', 'float'), LP('lfo1_depth', 'LFO1 Depth', 'float'),
            LP('lfo1_shape', 'LFO1 Shape', 'enum', shp), LP('lfo1_target', 'LFO1 Target', 'enum', tgt),
            LP('lfo2_rate', 'LFO2 Rate', 'float'), LP('lfo2_depth', 'LFO2 Depth', 'float'),
            LP('lfo2_shape', 'LFO2 Shape', 'enum', shp), LP('lfo2_target', 'LFO2 Target', 'enum', tgt),
        ];
        eq('fizzik: two groups', detectLfoViz(params).length, 2);
        const vm = viz(params, [0.3, 0.5, 2, 1, 0.4, 0.6, 3, 0]);
        eq('fizzik vm: two groups', vm.length, 2);
        eq('fizzik vm: g0 startCol 0', vm[0].startCol, 0);
        eq('fizzik vm: g1 line 1', vm[1].line, 1);
        // Shape(idx2) reordered to line0 col0, Rate(idx0) to col1; Target stays a knob.
        const L = planPageLayout(params);
        eq('fizzik layout: shape idx2 at col0', L.cells.find(c => c.idx === 2).col, 0);
        eq('fizzik layout: target idx3 not col0/1', L.cells.find(c => c.idx === 3).col > 1, true);
    }
    // osirus-like: Poly|Mono must NOT be polarity; Symmetry → deform.
    {
        const params = [
            LP('lfo1_shape', 'LFO1 Shape', 'enum', ['Sine', 'Triangle', 'Saw', 'Square', 'S&H', 'S&G', 'Wave 3', 'Wave 4']),
            LP('lfo1_rate', 'LFO1 Rate', 'float'),
            LP('lfo1_mode', 'LFO1 Mode', 'enum', ['Poly', 'Mono']),
            LP('lfo1_symmetry', 'LFO1 Symmetry', 'float'),
        ];
        const g = detectLfoViz(params);
        eq('osirus: one group', g.length, 1);
        eq('osirus: Poly|Mono not polarity', g[0].mode, null);
        eq('osirus: symmetry → deform idx3', g[0].deform, 3);
    }
    // Unmapped shape value (Wave 17) → generic glyph 10; viz not dropped.
    {
        const opts = ['Sine', 'Triangle', 'Saw', 'Square', 'S&H', 'S&G', 'Wave 3', 'Wave 17'];
        const params = [LP('lfo1_shape', 'LFO1 Shape', 'enum', opts), LP('lfo1_rate', 'LFO1 Rate', 'float'), null, null];
        const vm = viz(params, [7, 0.5, null, null]);
        eq('unmapped: viz kept', vm.length, 1);
        eq('unmapped: generic 10', vm[0].shape, 10);
    }
    // Rate partner → cycle count (1..2), keeping the wave readable; depth not drawn.
    {
        const params = [LP('lfo_shape', 'LFO Wave', 'enum', ['Sine', 'Tri', 'Saw', 'Square']),
            LP('lfo_rate', 'LFO Rate', 'float'), LP('lfo_depth', 'LFO Depth', 'float'), null];
        eq('rate min → 1 cycle', viz(params, [0, 0, 0.5, null])[0].cycles, 1);
        eq('rate max → 2 cycles', viz(params, [0, 1, 0.5, null])[0].cycles, 2);
        eq('rate mid → 1.5 cycles', viz(params, [0, 0.5, 0.5, null])[0].cycles, 1.5);
        eq('depth not the partner → no ampScale', 'ampScale' in viz(params, [0, 0.5, 0.5, null])[0], false);
    }
    // Phase partner (preferred) → fixed 2-cycle specimen, rate keeps its own knob.
    {
        const params = [LP('lfo_shape', 'LFO Wave', 'enum', ['Sine', 'Tri', 'Saw', 'Square']),
            LP('lfo_phase', 'LFO Phase', 'float'), LP('lfo_rate', 'LFO Rate', 'float'), null];
        eq('phase preferred: partner phase', planPageLayout(params).lfos[0].partnerRole, 'phase');
        eq('phase partner → 2 cycles', viz(params, [0, 0.25, 0.9, null])[0].cycles, 2);
    }
    // Depth partner (no phase, no rate) → floored amplitude, never flat.
    {
        const params = [LP('lfo_shape', 'LFO Wave', 'enum', ['Sine', 'Tri', 'Saw', 'Square']),
            LP('lfo_depth', 'LFO Depth', 'float'), null, null];
        eq('depth partner', planPageLayout(params).lfos[0].partnerRole, 'depth');
        eq('depth 0 → floored amp 0.35', viz(params, [0, 0, null, null])[0].ampScale, 0.35);
        eq('depth 1 → full amp 1', viz(params, [0, 1, null, null])[0].ampScale, 1);
    }
}

_log('\nTest: LFO shapeSample');
{
    const near = (a, b) => Math.abs(a - b) < 0.001;
    eq('sine @0', near(shapeSample(0, 0), 0), true);
    eq('sine @0.25', near(shapeSample(0, 0.25), 1), true);
    eq('tri @0.25 peak', near(shapeSample(1, 0.25), 1), true);
    eq('saw @0', near(shapeSample(2, 0), -1), true);
    eq('square low half', shapeSample(3, 0.1), 1);
    eq('square high half', shapeSample(3, 0.6), -1);
    eq('wraps by 1', near(shapeSample(0, 1.25), shapeSample(0, 0.25)), true);
    eq('unknown → sine', near(shapeSample(99, 0.25), 1), true);
    eq('bipolar range', shapeSample(4, 0.3) >= -1 && shapeSample(4, 0.3) <= 1, true);
    // A3 shapes 6..10 — deterministic and in bipolar range.
    eq('saw down @0 = +1', near(shapeSample(6, 0), 1), true);
    eq('saw down @0.5 = 0', near(shapeSample(6, 0.5), 0), true);
    eq('noise deterministic', shapeSample(7, 0.3), shapeSample(7, 0.3));
    eq('noise in range', shapeSample(7, 0.3) >= -1 && shapeSample(7, 0.3) <= 1, true);
    eq('envelope glyph peaks early', near(shapeSample(8, 0.12), 1), true);
    eq('staircase stepped', shapeSample(9, 0.05), shapeSample(9, 0.10));   // same step
    eq('generic deterministic', shapeSample(10, 0.4), shapeSample(10, 0.4));
    for (let s = 6; s <= 10; s++)
        eq(`shape ${s} in range`, shapeSample(s, 0.37) >= -1.001 && shapeSample(s, 0.37) <= 1.001, true);
}

_log('\nTest: buildViewModel emits lfoViz (synth reuse)');
{
    const { buildViewModel } = await import('../dist/esm/model/viewmodel.js');
    const kp = (over) => ({ key: over.key, label: over.key, shortLabel: null, type: over.type ?? 'float',
        min: over.min ?? 0, max: over.max ?? 1, step: 1, options: over.options ?? null,
        renderStyle: 'arc', automatable: false, lfo: over.lfo });
    const s = {
        activeSlot: 0, componentKey: 'synth', knobPage: 0, bankNames: [], moduleConfig: null,
        knobParams: [
            kp({ key: 'a' }), kp({ key: 'b' }), kp({ key: 'mode', type: 'enum', options: ['U','B'], max: 1, lfo: 'mode' }), kp({ key: 'd' }),
            kp({ key: 'shp', type: 'enum', options: ['a','b','c','d','e','f'], max: 5, lfo: 'shape' }),
            kp({ key: 'phs', lfo: 'phase' }), kp({ key: 'rt', type: 'int', max: 1, lfo: 'retrig' }), kp({ key: 'amt' }),
        ],
        knobValues: [0, 0, 1, 0, 2, 0.25, 1, 0],
        enumFmt: [], fileValues: [null,null,null,null,null,null,null,null], touchedSlots: [],
        enumOverlay: null, fileOverlay: null, activeModuleName: 'X', moduleId: 'x', drumPadCount: 0,
        drumCurrentPad: 0, drumCurrentPhysPad: 0, noRefreshKeys: new Set(), modulatedKeys: new Set(),
    };
    const vm = buildViewModel(s);
    eq('lfoViz present', Array.isArray(vm.lfoViz) && vm.lfoViz.length === 1, true);
    eq('viz line 1', vm.lfoViz[0].line, 1);
    eq('viz startCol 0', vm.lfoViz[0].startCol, 0);
    eq('viz shape from value', vm.lfoViz[0].shape, 2);
    eq('viz phase from value', vm.lfoViz[0].phase, 0.25);
    eq('viz mode from value', vm.lfoViz[0].mode, 1);
    eq('viz retrig from value', vm.lfoViz[0].retrigger, 1);
}

_log('\nTest: filter-mode vocabulary (A1)');
{
    // Option-string normalization → spectral mode.
    eq('LP → lp', normalizeFilterOption('LP'), 'lp');
    eq('HighPass → hp', normalizeFilterOption('HighPass'), 'hp');
    eq('BandPass → bp', normalizeFilterOption('BandPass'), 'bp');
    eq('BandStop → notch', normalizeFilterOption('BandStop'), 'notch');
    eq('Notch → notch', normalizeFilterOption('Notch'), 'notch');
    eq('Peak → peak', normalizeFilterOption('Peak'), 'peak');
    eq('AP → ap', normalizeFilterOption('AP'), 'ap');
    eq('Off → off', normalizeFilterOption('Off'), 'off');
    eq('lowercase lp → lp', normalizeFilterOption('lp'), 'lp');
    eq('LP 24 dB → lp', normalizeFilterOption('LP 24 dB'), 'lp');
    eq('HP+LP combined → bp', normalizeFilterOption('HP+LP'), 'bp');
    eq('LP only → lp', normalizeFilterOption('LP only'), 'lp');
    eq('HP only → hp', normalizeFilterOption('HP only'), 'hp');
    eq('Analog 2P → none', normalizeFilterOption('Analog 2P'), null);
    eq('Sticky Bass → none', normalizeFilterOption('Sticky Bass'), null);

    // Enum-vocabulary rule: ≥2 spectral options and ≥half filter words.
    eq('filter mode enum qualifies', isFilterModeEnum(['LP', 'HP', 'BP', 'Notch', 'Peak', 'AP']), true);
    eq('freak lowercase enum qualifies', isFilterModeEnum(['lp', 'bp', 'hp']), true);
    eq('osirus enum (4/8 spectral) qualifies', isFilterModeEnum(
        ['LowPass', 'HighPass', 'BandPass', 'BandStop', 'Analog 1P', 'Analog 2P', 'Analog 3P', 'Analog 4P']), true);
    eq('surge type enum qualifies', isFilterModeEnum(
        ['Off', 'LP 12 dB', 'LP 24 dB', 'LP Legacy Ladder', 'HP 12 dB', 'HP 24 dB', 'BP 12 dB', 'N 12 dB']), true);
    eq('ambiotica algo enum NOT a mode', isFilterModeEnum(['Mismember', 'Loona', 'NAPS', 'Flow']), false);
    eq('chordism slope enum NOT a mode', isFilterModeEnum(['12 dB', '24 dB']), false);
    eq('on/off toggle NOT a mode', isFilterModeEnum(['Off', 'On']), false);
    eq('noise-type enum NOT a mode', isFilterModeEnum(['White', 'Pink', 'Brown']), false);
    eq('null options NOT a mode', isFilterModeEnum(null), false);

    // Value → mode; unknown falls back to lp.
    eq('value 1 → hp', filterModeFromEnum(['LP', 'HP', 'BP'], 1), 'hp');
    eq('value 2 → bp', filterModeFromEnum(['LP', 'HP', 'BP'], 2), 'bp');
    eq('unknown option → lp', filterModeFromEnum(['Analog 1P', 'Analog 2P'], 0), 'lp');

    // Slope enum detection.
    eq('12/24 dB is a slope enum', isSlopeEnum(['12 dB', '24 dB']), true);
    eq('mode enum is not a slope enum', isSlopeEnum(['LP', 'HP', 'BP']), false);

    // Static token inference from a cutoff's own name tokens.
    eq('token hpf → hp', staticModeFromTokens(['hpf', 'cut']), 'hp');
    eq('token lpf → lp', staticModeFromTokens(['lpf', 'cut']), 'lp');
    eq('token lowcut → hp (cut the lows)', staticModeFromTokens(['low', 'cut']), 'hp');
    eq('token hicut → lp', staticModeFromTokens(['hi', 'cut']), 'lp');
    eq('token bpf → bp', staticModeFromTokens(['dly', 'bpf', 'cut']), 'bp');
    eq('bare bp w/o filter ctx → none (dexed breakpoint)', staticModeFromTokens(['op1', 'key', 'bp']), null);
    eq('plain cutoff tokens → none (→ default lp later)', staticModeFromTokens(['cutoff']), null);
}

_log('\nTest: detectFilterViz (A1)');
{
    const F = (key, label, type = 'float', options = null) => ({
        key, label, shortLabel: null, type, options,
        min: 0, max: type === 'enum' ? (options ? options.length - 1 : 1) : 1,
        step: type === 'enum' ? 1 : 0.01, renderStyle: 'arc', automatable: true,
    });

    // moog-like: bare cutoff+resonance, no mode enum → one group, static null (LP later).
    {
        const g = detectFilterViz([F('cutoff', 'Cutoff'), F('resonance', 'Resonance'), F('contour', 'Contour'), F('octave', 'Octave')]);
        eq('moog: one group', g.length, 1);
        eq('moog: cutoff idx0', g[0].cutoff, 0);
        eq('moog: reso idx1', g[0].resonance, 1);
        eq('moog: no mode enum', g[0].modeIdx, null);
        eq('moog: no static mode', g[0].staticMode, null);
    }
    // filter-module: cutoff+resonance + same-page mode enum → modeIdx bound.
    {
        const g = detectFilterViz([
            F('cutoff', 'Cutoff'), F('resonance', 'Resonance'), F('drive', 'Drive'), F('mix', 'Mix'),
            F('env_amount', 'Env Amt'), F('lfo_amount', 'LFO Amt'), F('lfo_rate_div', 'Div'),
            F('mode', 'Mode', 'enum', ['LP', 'HP', 'BP', 'Notch', 'Peak', 'AP']),
        ]);
        eq('filter: one group', g.length, 1);
        eq('filter: modeIdx = 7', g[0].modeIdx, 7);
    }
    // denis-like: filter_cutoff pairs via filter_q (q = resonance), same qualifier.
    {
        const g = detectFilterViz([F('filter_cutoff', 'Cutoff'), F('filter_q', 'Q'), F('drive', 'Drive'), F('mix', 'Mix')]);
        eq('denis: one group via q', g.length, 1);
        eq('denis: cutoff0/reso1', `${g[0].cutoff},${g[0].resonance}`, '0,1');
    }
    // fizzik: a randomizer rnd_reson must NOT be read as resonance.
    {
        const g = detectFilterViz([
            F('rnd_reson', 'Rnd Reson', 'int'), F('cutoff', 'Cutoff'), F('resonance', 'Resonance'),
            F('ftype', 'Filter Type', 'enum', ['LP', 'HP', 'BP', 'Notch']),
        ]);
        eq('fizzik: one group', g.length, 1);
        eq('fizzik: reso is real resonance (idx2)', g[0].resonance, 2);
        eq('fizzik: mode = ftype (idx3)', g[0].modeIdx, 3);
    }
    // aphex Main: BOTH lpf_cut+lpf_reso AND hpf_cut+hpf_reso → two groups, LP & HP static.
    {
        const g = detectFilterViz([
            F('lpf_cut', 'LPF Cut'), F('lpf_reso', 'LPF Peak'), F('hpf_cut', 'HPF Cut'), F('hpf_reso', 'HPF Peak'),
        ]);
        eq('aphex: two groups', g.length, 2);
        const lp = g.find(x => x.cutoff === 0), hp = g.find(x => x.cutoff === 2);
        eq('aphex: lpf pair 0/1', `${lp.cutoff},${lp.resonance}`, '0,1');
        eq('aphex: lpf static lp', lp.staticMode, 'lp');
        eq('aphex: hpf pair 2/3', `${hp.cutoff},${hp.resonance}`, '2,3');
        eq('aphex: hpf static hp', hp.staticMode, 'hp');
    }
    // aphex cross-pair guard: hpf_cut + lpf_reso only (different quals) must NOT pair.
    {
        const g = detectFilterViz([F('hpf_cut', 'HPF Cut'), F('lpf_reso', 'LPF Peak'), F('drive', 'Drive'), F('mix', 'Mix')]);
        eq('cross-pair rejected', g.length, 0);
    }
    // osirus: unqualified cutoff pairs with filter1_resonance (lone-pair, one empty qual).
    {
        const g = detectFilterViz([
            F('cutoff', 'Cutoff'), F('filter1_resonance', 'Filt1 Reso'),
            F('filter1_mode', 'Filt1 Mode', 'enum', ['LowPass', 'HighPass', 'BandPass', 'BandStop']),
            F('filter_routing', 'Filt Routing', 'enum', ['Serial 4', 'Serial 6', 'Parallel 4', 'Split']),
        ]);
        eq('osirus: one group', g.length, 1);
        eq('osirus: cutoff0/reso1', `${g[0].cutoff},${g[0].resonance}`, '0,1');
        eq('osirus: mode = filter1_mode (idx2)', g[0].modeIdx, 2);
    }
    // surge: filter1 and filter2 pairs on one page stay separate by qualifier.
    {
        const g = detectFilterViz([
            F('filter1_cutoff', 'Filter 1 Cutoff'), F('filter1_resonance', 'Filter 1 Resonance'),
            F('filter2_cutoff', 'Filter 2 Cutoff'), F('filter2_resonance', 'Filter 2 Resonance'),
        ]);
        eq('surge: two groups', g.length, 2);
        const f1 = g.find(x => x.cutoff === 0), f2 = g.find(x => x.cutoff === 2);
        eq('surge: filter1 pair 0/1', `${f1.cutoff},${f1.resonance}`, '0,1');
        eq('surge: filter2 pair 2/3', `${f2.cutoff},${f2.resonance}`, '2,3');
    }
    // chordism Filter page: same-page mode + slope enums bound.
    {
        const g = detectFilterViz([
            F('filter_cutoff', 'Cutoff'), F('filter_resonance', 'Resonance'),
            F('filter_mode', 'Mode', 'enum', ['LP', 'HP', 'BP']),
            F('filter_slope', 'Slope', 'enum', ['12 dB', '24 dB']),
        ]);
        eq('chordism: one group', g.length, 1);
        eq('chordism: mode idx2', g[0].modeIdx, 2);
        eq('chordism: slope idx3', g[0].slopeIdx, 3);
    }
    // spectra negative: frequency + resonators (a mixer, not a filter) → no group.
    {
        const g = detectFilterViz([
            F('frequency', 'Frequency'), F('resonators', 'Resonators', 'enum', ['5', '7', '12']),
            F('compress', 'Compress'), F('hpf', 'HPF', 'int'),
        ]);
        eq('spectra: no group', g.length, 0);
    }
    // enum cutoff/reso are numeric-int (obxd/minijv) — still detected.
    {
        const g = detectFilterViz([F('cutoff', 'Cutoff', 'int'), F('resonance', 'Resonance', 'int'), F('filter_env', 'Filter Env', 'int'), F('mm', 'Multimode', 'int')]);
        eq('int pair: one group', g.length, 1);
    }
}

_log('\nTest: planPageLayout seats cutoff→resonance on one line (A1)');
{
    const F = (key, label, type = 'float', options = null) => ({
        key, label, shortLabel: null, type, options,
        min: 0, max: type === 'enum' ? (options ? options.length - 1 : 1) : 1,
        step: type === 'enum' ? 1 : 0.01, renderStyle: 'arc', automatable: true,
    });
    // Cutoff/resonance not first, reversed order → reflowed to line front, cutoff then reso.
    {
        const page = [F('drive', 'Drive'), F('resonance', 'Resonance'), F('cutoff', 'Cutoff'), F('mix', 'Mix')];
        const L = planPageLayout(page);
        eq('one filter placement', L.filters.length, 1);
        const f = L.filters[0];
        eq('startCol 0', f.startCol, 0);
        eq('cutoff seated col0', L.cells.find(c => c.idx === 2).col, 0);
        eq('resonance seated col1', L.cells.find(c => c.idx === 1).col, 1);
        eq('same line', L.cells.find(c => c.idx === 2).line, L.cells.find(c => c.idx === 1).line);
    }
    // Claim priority: ADSR envelope + cutoff/reso → env owns its line, filter its own.
    {
        const page = [
            F('attack', 'Attack'), F('decay', 'Decay'), F('sustain', 'Sustain'), F('release', 'Release'),
            F('cutoff', 'Cutoff'), F('resonance', 'Resonance'), F('env_amt', 'Env Amt'), F('octave', 'Octave'),
        ];
        const L = planPageLayout(page);
        eq('env + filter both placed', `${L.envelopes.length},${L.filters.length}`, '1,1');
        const envLine = L.envelopes[0].line, fLine = L.filters[0].line;
        eq('env and filter on different lines', envLine !== fLine, true);
        eq('filter cutoff at its col0', L.cells.find(c => c.idx === 4).col, 0);
        eq('filter reso at its col1', L.cells.find(c => c.idx === 5).col, 1);
    }
    // aphex: two pairs → two lines, LP on one, HP on the other.
    {
        const page = [F('lpf_cut', 'LPF Cut'), F('lpf_reso', 'LPF Peak'), F('hpf_cut', 'HPF Cut'), F('hpf_reso', 'HPF Peak'),
            F('freq', 'MG Freq'), F('depth', 'Depth'), F('drive', 'Drive'), F('vol', 'Volume')];
        const L = planPageLayout(page);
        eq('aphex: two filter lines', L.filters.length, 2);
        eq('aphex: on different lines', L.filters[0].line !== L.filters[1].line, true);
    }
}

_log('\nTest: buildFilterViz VM (A1)');
{
    const F = (key, label, type = 'float', options = null, min = 0, max = 1) => ({
        key, label, shortLabel: null, type, options, min,
        max: type === 'enum' ? (options ? options.length - 1 : 1) : max,
        step: type === 'enum' ? 1 : 0.01, renderStyle: 'arc', automatable: true,
    });
    const build = (params, values, all = params, allV = values) =>
        buildFilterViz(planPageLayout(params).filters, params, values, all, allV);

    // Normalized cutoff/resonance from min/max; default LP when no mode.
    {
        const params = [F('cutoff', 'Cutoff', 'float', null, 0, 100), F('resonance', 'Resonance'), F('drive', 'Drive'), F('mix', 'Mix')];
        const vm = build(params, [50, 0.25, 0, 1]);
        eq('one vm', vm.length, 1);
        eq('cutoff normalized 0.5', vm[0].cutoff, 0.5);
        eq('reso normalized 0.25', vm[0].resonance, 0.25);
        eq('default mode lp', vm[0].mode, 'lp');
        eq('startCol 0', vm[0].startCol, 0);
    }
    // Same-page mode enum drives the curve live (value 1 → HP).
    {
        const params = [F('cutoff', 'Cutoff'), F('resonance', 'Resonance'),
            F('mode', 'Mode', 'enum', ['LP', 'HP', 'BP', 'Notch', 'Peak', 'AP']), F('mix', 'Mix')];
        eq('mode value 1 → hp', build(params, [0.5, 0.2, 1, 1])[0].mode, 'hp');
        eq('mode value 3 → notch', build(params, [0.5, 0.2, 3, 1])[0].mode, 'notch');
    }
    // Off-page mode (chordism Main): pair on page, filter_mode elsewhere in chain.
    {
        const pageParams = [F('filter_cutoff', 'Cutoff'), F('filter_resonance', 'Resonance'), F('drive', 'Drive'), F('vol', 'Vol')];
        const pageValues = [0.5, 0.2, 0, 1];
        const allParams = [...pageParams, F('filter_mode', 'Mode', 'enum', ['LP', 'HP', 'BP'])];
        const allValues = [...pageValues, 1];   // 1 = HP
        const vm = buildFilterViz(planPageLayout(pageParams).filters, pageParams, pageValues, allParams, allValues);
        eq('off-page mode → hp', vm[0].mode, 'hp');
    }
    // Static token inference (aphex): lpf → lp, hpf → hp, no enum anywhere.
    {
        const params = [F('lpf_cut', 'LPF Cut'), F('lpf_reso', 'LPF Peak'), F('hpf_cut', 'HPF Cut'), F('hpf_reso', 'HPF Peak')];
        const vm = build(params, [0.5, 0.2, 0.5, 0.2]);
        const lp = vm.find(v => v.startCol === 0 && v.line === planPageLayout(params).filters.find(f => f.cutoff === 0).line);
        eq('aphex vm: two curves', vm.length, 2);
        eq('aphex vm: an lp present', vm.some(v => v.mode === 'lp'), true);
        eq('aphex vm: an hp present', vm.some(v => v.mode === 'hp'), true);
    }
    // Slope from a dedicated 12/24 dB enum.
    {
        const params = [F('filter_cutoff', 'Cutoff'), F('filter_resonance', 'Resonance'),
            F('filter_mode', 'Mode', 'enum', ['LP', 'HP', 'BP']), F('filter_slope', 'Slope', 'enum', ['12 dB', '24 dB'])];
        eq('slope 12 → 0', build(params, [0.5, 0.2, 0, 0])[0].slope, 0);
        eq('slope 24 → 1', build(params, [0.5, 0.2, 0, 1])[0].slope, 1);
    }
}

_log('\nTest: buildViewModel emits filterViz + claim priority (A1)');
{
    const { buildViewModel } = await import('../dist/esm/model/viewmodel.js');
    const kp = (over) => ({ key: over.key, label: over.label ?? over.key, shortLabel: null, type: over.type ?? 'float',
        min: over.min ?? 0, max: over.max ?? 1, step: 1, options: over.options ?? null,
        renderStyle: 'arc', automatable: false });
    const base = {
        activeSlot: 0, componentKey: 'synth', knobPage: 0, bankNames: [], moduleConfig: null,
        enumFmt: [], touchedSlots: [], enumOverlay: null, fileOverlay: null,
        activeModuleName: 'X', moduleId: 'x', drumPadCount: 0, drumCurrentPad: 0,
        drumCurrentPhysPad: 0, noRefreshKeys: new Set(), modulatedKeys: new Set(),
    };
    // Filter module Main page: cutoff/resonance + mode enum → one filterViz.
    {
        const knobParams = [
            kp({ key: 'cutoff', label: 'Cutoff' }), kp({ key: 'resonance', label: 'Resonance' }),
            kp({ key: 'drive', label: 'Drive' }), kp({ key: 'mix', label: 'Mix' }),
            kp({ key: 'env_amount', label: 'Env' }), kp({ key: 'lfo_amount', label: 'LFO' }),
            kp({ key: 'lfo_rate_div', label: 'Div' }),
            kp({ key: 'mode', label: 'Mode', type: 'enum', options: ['LP', 'HP', 'BP', 'Notch', 'Peak', 'AP'], max: 5 }),
        ];
        const knobValues = [0.5, 0.2, 0, 1, 0, 0, 0, 1];   // mode 1 = HP
        const vm = buildViewModel({ ...base, knobParams, knobValues,
            fileValues: knobParams.map(() => null) });
        eq('filterViz present', Array.isArray(vm.filterViz) && vm.filterViz.length === 1, true);
        eq('filterViz mode hp', vm.filterViz[0].mode, 'hp');
        eq('filterViz cutoff 0.5', vm.filterViz[0].cutoff, 0.5);
    }
    // Claim priority: ADSR env + cutoff/reso coexist — both graphics emitted.
    {
        const knobParams = [
            kp({ key: 'attack', label: 'Attack' }), kp({ key: 'decay', label: 'Decay' }),
            kp({ key: 'sustain', label: 'Sustain' }), kp({ key: 'release', label: 'Release' }),
            kp({ key: 'cutoff', label: 'Cutoff' }), kp({ key: 'resonance', label: 'Resonance' }),
            kp({ key: 'env_amt', label: 'Env Amt' }), kp({ key: 'octave', label: 'Octave' }),
        ];
        const knobValues = [0.1, 0.2, 0.3, 0.4, 0.5, 0.2, 0, 0];
        const vm = buildViewModel({ ...base, knobParams, knobValues, fileValues: knobParams.map(() => null) });
        eq('envelope present', (vm.envelopeLines ?? []).filter(Boolean).length, 1);
        eq('filterViz still present', (vm.filterViz ?? []).length, 1);
        const envLine = vm.envelopeLines.findIndex(Boolean);
        eq('filter on the other line', vm.filterViz[0].line !== envLine, true);
    }
}

_log('\nTest: lfo assign helpers');
{
    env.setParams({});
    assignLfoTarget(0, 0, 'synth', 'cutoff');
    eq('target written', env.params['lfo1:target'], 'synth');
    eq('target_param written', env.params['lfo1:target_param'], 'cutoff');
    eq('enabled written', env.params['lfo1:enabled'], '1');
    eq('targets param true', lfoTargetsParam(0, 0, 'synth', 'cutoff'), true);
    eq('targets other false', lfoTargetsParam(0, 0, 'synth', 'reso'), false);
    eq('lfo2 not targeting', lfoTargetsParam(0, 1, 'synth', 'cutoff'), false);
    clearLfoTarget(0, 0);
    eq('target cleared', env.params['lfo1:target'], '');
    eq('enabled cleared', env.params['lfo1:enabled'], '0');
    eq('targets false after clear', lfoTargetsParam(0, 0, 'synth', 'cutoff'), false);
}

_log('\nTest: buildViewModel marks modulated params (from cache)');
{
    const { buildViewModel } = await import('../dist/esm/model/viewmodel.js');
    const { refreshModulatedKeys } = await import('../dist/esm/model/store.js');
    const kp = (key) => ({ key, label: key, shortLabel: null, type: 'float', min: 0, max: 1, step: 1,
        options: null, renderStyle: 'arc', automatable: true });
    const s = {
        activeSlot: 0, componentKey: 'synth', knobPage: 0, bankNames: [], moduleConfig: null,
        knobParams: [kp('cutoff'), kp('reso'), null, null, null, null, null, null],
        knobValues: [0, 0, null, null, null, null, null, null],
        enumFmt: [], fileValues: new Array(8).fill(null), touchedSlots: [],
        enumOverlay: null, fileOverlay: null, activeModuleName: 'X', moduleId: 'x', drumPadCount: 0,
        drumCurrentPad: 0, drumCurrentPhysPad: 0, noRefreshKeys: new Set(), modulatedKeys: new Set(),
    };
    env.setParams({ 'lfo1:target': 'synth', 'lfo1:target_param': 'cutoff' });
    refreshModulatedKeys(s);
    eq('modulatedKeys cached cutoff', s.modulatedKeys.has('cutoff'), true);
    const vm = buildViewModel(s);
    eq('cutoff modulated', vm.rows[0][0].modulated, true);
    eq('reso not modulated', vm.rows[0][1].modulated, false);
    env.setParams({}); refreshModulatedKeys(s);
    eq('none modulated when no target', buildViewModel(s).rows[0][0].modulated, false);
    const sm = { ...s, componentKey: 'master_fx:fx1', modulatedKeys: new Set() };
    env.setParams({ 'lfo1:target': 'master_fx:fx1', 'lfo1:target_param': 'cutoff' });
    refreshModulatedKeys(sm);
    eq('master_fx excluded', sm.modulatedKeys.size, 0);
}

_log('\nTest: LFO assign-mode gesture');
{
    const info = (over = {}) => ({ gi: 0, key: 'cutoff', ioKey: 'cutoff', target: 'synth',
        value: 0, min: 0, max: 1, type: 'float', automatable: true, ...over });
    env.setParams({});
    resetAssignMode();

    holdTouch(0, 0, info({ automatable: false }));
    eq('non-automatable does not arm', holdTick(), false);

    resetAssignMode();
    holdTouch(0, 0, info());
    eq('not active before 500ms', assignActive(), false);
    holdTurnCancel();
    eq('turn cancels arm', holdTick(), false);

    const realNow = Date.now;
    let t = 1000; Date.now = () => t;
    holdTouch(0, 0, info());
    t = 1600; eq('not active before hold time', holdTick(), false);
    t = 2100; eq('activates after hold time', holdTick(), true);
    eq('active flag set', assignActive(), true);
    eq('toast = modulate LFO1', assignToastText(), 'CLICK: MODULATE <LFO1>');

    assignCycle(1);
    eq('toast = modulate LFO2', assignToastText(), 'CLICK: MODULATE <LFO2>');

    const r = assignCommit();
    eq('commit assigned', JSON.stringify(r), JSON.stringify({ assigned: true, lfoIdx: 1 }));
    eq('lfo2 target written', env.params['lfo2:target'], 'synth');
    eq('mode exited after commit', assignActive(), false);

    t = 3000; holdTouch(0, 0, info()); t = 4200;
    eq('re-activates', holdTick(), true);
    eq('starts on assigned LFO2', assignToastText(), 'CLICK: REMOVE <LFO2> MOD');
    const r2 = assignCommit();
    eq('commit removed', JSON.stringify(r2), JSON.stringify({ assigned: false, lfoIdx: 1 }));
    eq('lfo2 target cleared', env.params['lfo2:target'], '');

    t = 5000; holdTouch(0, 0, info()); t = 6200; holdTick();
    eq('active before release', assignActive(), true);
    holdRelease(0);
    eq('release cancels', assignActive(), false);
    Date.now = realNow;
}

/* ── dumpLayout: external layout snapshot (scripts/dump-movy-layout.mjs) ── */

_log('\nTest: dumpLayout exposes banks + raw params');

{
    const m = bootModel(MOCK_SYNTHS.mrdrums);
    const d = m.dumpLayout();
    eq('dumpLayout: moduleId',        d.moduleId, 'mrdrums');
    eq('dumpLayout: hasConfig',       d.hasConfig, true);
    eq('dumpLayout: drum config exposed', d.drum !== null, true);
    eq('dumpLayout: config bank names present', d.banks.length > 0 && typeof d.banks[0].name, 'string');
    const first = d.params.find(p => p !== null);
    eq('dumpLayout: param has step',  typeof first?.step, 'number');
    eq('dumpLayout: param has renderStyle', typeof first?.renderStyle, 'string');
    // snapshot is a copy — mutating it must not touch the live model
    first.min = -999;
    const range = m.paramRangeByKey(first.key);
    eq('dumpLayout: copies, not references', range?.min === -999, false);
}

{
    const m = bootModel(MOCK_SYNTHS.test8);
    const d = m.dumpLayout();
    eq('dumpLayout: generic path hasConfig=false', d.hasConfig, false);
    eq('dumpLayout: generic path 8 params', d.params.filter(Boolean).length, 8);
    eq('dumpLayout: generic bank count matches model', d.banks.length, m.getBankCount());
    eq('dumpLayout: generic params = banks × 8', d.params.length, d.banks.length * 8);
}

/* ── Chunk-6 custom configs: chordism, sfz, 303, chiptune, hush1 ──────────── */

_log('\nTest: chunk-6 module configs (chordism/sfz/303/chiptune/hush1)');
{
    const { detectEnvelopes } = await import('../dist/esm/model/envelope.js');

    const layout = (id) => bootModel(MOCK_SYNTHS[id]).dumpLayout();
    const byKey  = (d, k) => d.params.find(p => p && p.key === k);
    const idxOf  = (d, k) => d.params.findIndex(p => p && p.key === k);

    // Every page's on-screen short names must be unique (the dump flagged
    // duplicate "1/2/3/4" and "TO" collisions on the auto layout).
    const noDupShorts = (id) => {
        const m = bootModel(MOCK_SYNTHS[id]);
        const n = m.getBankCount();
        for (let b = 0; b < n; b++) {
            m.changePage(b - m.getKnobPage());
            const names = m.getViewModel().rows.flat().filter(Boolean).map(c => c.shortName);
            if (new Set(names).size !== names.length) return `bank ${b}: ${names.join(',')}`;
        }
        return null;
    };

    // Bank counts
    eq('chordism: 17 banks', layout('chordism').banks.length, 17);
    eq('sfz: 3 banks',       layout('sfz').banks.length,      3);
    eq('303: 3 banks',       layout('303').banks.length,      3);
    eq('chiptune: 3 banks',  layout('chiptune').banks.length, 3);
    eq('hush1: 7 banks',     layout('hush1').banks.length,    7);

    // chordism B3 fix: all four top pitch classes reachable, as 16-way enums.
    {
        const d = layout('chordism');
        for (const k of ['chord_pc_8', 'chord_pc_9', 'chord_pc_10', 'chord_pc_11']) {
            const p = byKey(d, k);
            eq(`chordism: ${k} reachable`, !!p, true);
            eq(`chordism: ${k} is enum`, p?.type, 'enum');
            eq(`chordism: ${k} has 16 options`, p?.options?.length, 16);
        }
        // Restored hidden params (a representative sample of the plan's list).
        for (const k of ['detune', 'chord_spread', 'chord_rotation', 'fm_modulator',
                         'fm_amount', 'filter_lfo_rate', 'vib_delay', 'delay_tone',
                         'glide_legato', 'lfo_phase_1', 'sweep_rate']) {
            eq(`chordism: restored ${k}`, !!byKey(d, k), true);
        }
        // Named preset knob (option-a shared path), not a bare index.
        const pre = d.params.find(p => p && p.renderStyle === 'preset');
        eq('chordism: preset renders as preset', !!pre, true);
        eq('chordism: preset has names', Array.isArray(pre?.options), true);
        eq('chordism: preset spans 57 entries (max 56)', pre?.max, 56);
    }

    // sfz B4: named params + ADSR envelope + adjacent cutoff/reso.
    {
        const d = layout('sfz');
        const envs = detectEnvelopes(d.params.slice(0, 8));
        eq('sfz: amp envelope detected', envs.length >= 1, true);
        eq('sfz: envelope named Amp', envs[0]?.name, 'Amp');
        eq('sfz: cutoff+reso adjacent', idxOf(d, 'reso') - idxOf(d, 'cutoff'), 1);
        eq('sfz: voices is int', byKey(d, 'voices')?.type, 'int');
        eq('sfz: gain max=2', byKey(d, 'gain')?.max, 2);
        // count=0 in the dump → preset degrades to an indexed knob (no names).
        const pre = d.params.find(p => p && p.renderStyle === 'preset');
        eq('sfz: preset present', !!pre, true);
        eq('sfz: preset has no names (indexed)', pre?.options, null);
        eq('sfz: knob_preset (degenerate 0..0) omitted', !!byKey(d, 'knob_preset'), false);
    }

    // 303 B5: waveform enum surfaced; no forced ADSR (303 has no A/D/S/R quartet).
    {
        const d = layout('303');
        eq('303: waveform is enum', byKey(d, 'waveform')?.type, 'enum');
        eq('303: waveform options Saw/Square',
            JSON.stringify(byKey(d, 'waveform')?.options), JSON.stringify(['Saw', 'Square']));
        eq('303: drive_model reachable', !!byKey(d, 'drive_model'), true);
        eq('303: devil_mod_switch reachable', !!byKey(d, 'devil_mod_switch'), true);
        eq('303: cutoff+reso adjacent', idxOf(d, 'resonance') - idxOf(d, 'cutoff'), 1);
        let envCount = 0;
        for (let b = 0; b < d.banks.length; b++) envCount += detectEnvelopes(d.params.slice(b * 8, b * 8 + 8)).length;
        eq('303: no envelope graphic forced', envCount, 0);
    }

    // chiptune B5: all hidden surfaced, int ADSR detected, named preset.
    {
        const d = layout('chiptune');
        for (const k of ['chip', 'alloc_mode', 'noise_mode', 'sweep', 'wavetable',
                         'channel_mask', 'detune', 'octave_transpose',
                         'pitch_env_depth', 'pitch_env_speed']) {
            eq(`chiptune: ${k} reachable`, !!byKey(d, k), true);
        }
        eq('chiptune: env detected', detectEnvelopes(d.params.slice(0, 8)).length, 1);
        const pre = d.params.find(p => p && p.renderStyle === 'preset');
        eq('chiptune: named preset (32)', pre?.max, 31);
        eq('chiptune: preset has names', Array.isArray(pre?.options), true);
    }

    // hush1 B5: dual Amp+Filter envelopes, lfo_waveform adjacent to lfo_rate.
    {
        const d = layout('hush1');
        const filtEnv = detectEnvelopes(d.params.slice(16, 24));  // bank 2 = Filter
        const ampEnv  = detectEnvelopes(d.params.slice(24, 32));  // bank 3 = Amp Env
        eq('hush1: filter envelope named Filter', filtEnv[0]?.name, 'Filter');
        eq('hush1: amp envelope named Amp', ampEnv[0]?.name, 'Amp');
        eq('hush1: lfo_waveform adjacent to lfo_rate', idxOf(d, 'lfo_waveform') - idxOf(d, 'lfo_rate'), 1);
        eq('hush1: lfo_waveform is enum', byKey(d, 'lfo_waveform')?.type, 'enum');
        for (const k of ['pulse_width', 'pwm_mode', 'sub_mode', 'white_noise',
                         'bend_range', 'lfo_sync', 'retrigger', 'hold']) {
            eq(`hush1: ${k} reachable`, !!byKey(d, k), true);
        }
        const pre = d.params.find(p => p && p.renderStyle === 'preset');
        eq('hush1: named preset (11)', pre?.max, 10);
    }

    // mrdrums B5: pad-scoped choke group added.
    {
        const d = bootModel({ 'synth:name': 'MrDrums', 'synth_module': 'mrdrums' }).dumpLayout();
        eq('mrdrums: pad_choke_group added', !!byKey(d, 'pad_choke_group'), true);
        eq('mrdrums: choke group is int 0..16', byKey(d, 'pad_choke_group')?.max, 16);
    }

    // No duplicate on-screen short names on any page of any chunk-6 module.
    for (const id of ['chordism', 'sfz', '303', 'chiptune', 'hush1']) {
        eq(`${id}: no duplicate shortNames per page`, noDupShorts(id), null);
    }
}

_log('\nTest: chunk-7 module configs (krautdrums/weird-dreams banks)');
{
    const boot = (id, extra = {}) => bootModel({ 'synth:name': id, 'synth_module': id, ...extra });
    const layout = (id, extra = {}) => boot(id, extra).dumpLayout();
    const byKey  = (d, k) => d.params.find(p => p && p.key === k);
    const noDupShorts = (m) => {
        const n = m.getBankCount();
        for (let b = 0; b < n; b++) {
            m.changePage(b - m.getKnobPage());
            const names = m.getViewModel().rows.flat().filter(Boolean).map(c => c.shortName);
            if (new Set(names).size !== names.length) return `bank ${b}: ${names.join(',')}`;
        }
        return null;
    };

    // krautdrums: new Rhythm bank (rhythm_1..8 + 5 restored globals), others intact.
    {
        const d = layout('krautdrums');
        eq('krautdrums: 6 banks (Levels/FX/Attitude/General/Rhythm/Global)', d.banks.length, 6);
        eq('krautdrums: Rhythm bank present', d.banks.some(b => b.name === 'Rhythm'), true);
        eq('krautdrums: Global bank present', d.banks.some(b => b.name === 'Global'), true);
        for (let n = 1; n <= 8; n++) {
            const p = byKey(d, `rhythm_${n}`);
            eq(`krautdrums: rhythm_${n} is 17-way enum`, p?.type === 'enum' && p?.options?.length === 17, true);
        }
        for (const k of ['tempo_mode', 'limiter', 'delay_type', 'reverb_type', 'delay_sync']) {
            eq(`krautdrums: restored ${k}`, !!byKey(d, k), true);
        }
        // Existing banks untouched.
        for (const k of ['lvl_bass', 'filter_cutoff', 'tempo', 'master_vol']) {
            eq(`krautdrums: kept ${k}`, !!byKey(d, k), true);
        }
        eq('krautdrums: no duplicate shortNames per page', noDupShorts(boot('krautdrums')), null);
    }

    // weird-dreams: new EQ + Master banks; padScoping Voice bank still resolves.
    {
        const d = layout('weird-dreams');
        eq('weird-dreams: 5 banks (Voice/Patch/FX/EQ/Master)', d.banks.length, 5);
        eq('weird-dreams: EQ bank present', d.banks.some(b => b.name === 'EQ'), true);
        eq('weird-dreams: Master bank present', d.banks.some(b => b.name === 'Master'), true);
        for (const k of ['eq_lo', 'eq_mid', 'eq_hi', 'dj_filter', 'lo_freq', 'mid_freq',
                         'hi_freq', 'comp', 'q_lo', 'q_mid', 'q_hi', 'master', 'all_mono']) {
            eq(`weird-dreams: restored ${k}`, !!byKey(d, k), true);
        }
        eq('weird-dreams: all_mono is enum', byKey(d, 'all_mono')?.type, 'enum');
        // Action/init params deliberately skipped.
        for (const k of ['reset_eq', 'init_freq', 'save_kit', 'same_freq', 'rnd_pan']) {
            eq(`weird-dreams: skipped action ${k}`, !!byKey(d, k), false);
        }
        // Pad-scoped voice editing intact (Voice bank unchanged).
        const wd = bootModel(MOCK_SYNTHS.weird_dreams);
        eq('weird-dreams: VOL still reads v1_vol', wd.getKnobParamInfo(0).ioKey, 'v1_vol');
        wd.updateDrumPad(3, 70);
        eq('weird-dreams: VOL follows focus to v3_vol', wd.getKnobParamInfo(0).ioKey, 'v3_vol');
        eq('weird-dreams: no duplicate shortNames per page', noDupShorts(bootModel(MOCK_SYNTHS.weird_dreams)), null);
    }

    // signal: new 4-voice pad-scoped config; cv_ alias → v{pad}_ concrete.
    {
        const d = layout('signal', MOCK_SYNTHS.signal);
        eq('signal: 9 banks', d.banks.length, 9);
        eq('signal: 4 drum pads', d.drum?.padCount, 4);
        // Restored hidden per-voice + global params reachable (as cv_ aliases / keys).
        for (const k of ['cv_attack', 'cv_sub_div', 'cv_sweep', 'cv_tone_rnd', 'cv_bank_pitch_0',
                         'drummer_brain', 'fill_shape', 'step_grid', 'out_mode']) {
            eq(`signal: reachable ${k}`, !!byKey(d, k), true);
        }
        const sg = bootModel(MOCK_SYNTHS.signal);
        eq('signal: focus defaults to voice 1', sg.getViewModel().drumCurrentPad, 1);
        for (let t = 0; t < 4; t++) sg.tick();   // round-robin refresh reaches row-0 knobs
        eq('signal: VOL reads v1_vol (0.11)', sg.getKnobParamInfo(1).value, 0.11);
        eq('signal: ioKey is v1_vol', sg.getKnobParamInfo(1).ioKey, 'v1_vol');
        sg.updateDrumPad(3, 38);
        eq('signal: VOL re-read for v3 (0.33)', sg.getKnobParamInfo(1).value, 0.33);
        eq('signal: ioKey follows to v3_vol', sg.getKnobParamInfo(1).ioKey, 'v3_vol');
        eq('signal: no duplicate shortNames per page', noDupShorts(bootModel(MOCK_SYNTHS.signal)), null);
    }

    // forge: 16-pad Kit A/B, per-voice editing is PLAYBACK-SAFE — padScoping
    // remaps cv_* → pv{pad}_ concrete keys (patched DSP addresses a fixed
    // voice/kit, independent of the playing note). Full detail across 5 banks.
    {
        const d = layout('forge', MOCK_SYNTHS.forge);
        eq('forge: 11 banks', d.banks.length, 11);
        eq('forge: 16 drum pads', d.drum?.padCount, 16);
        eq('forge: padScoping cv_ → pv{pad}_', d.drum?.padScoping?.concreteKeyTemplate, 'pv{pad}_{suffix}');
        // Rich per-voice params exposed as cv_* aliases (Osc/Filter/Env/Mod/Setup).
        for (const k of ['cv_wave', 'cv_ratio_c', 'cv_f1_cut', 'cv_f1_type', 'cv_e1_atk',
                         'cv_e1_crv', 'cv_lfo_w', 'cv_mod_dest', 'cv_algo', 'cv_poly']) {
            eq(`forge: per-voice ${k}`, !!byKey(d, k), true);
        }
        for (const k of ['morph_src', 'morph_curve', 'all_mono']) eq(`forge: restored ${k}`, !!byKey(d, k), true);
        for (const k of ['copy_a_b', 'swap_ab', 'rnd_b_from_a']) eq(`forge: skipped ${k}`, !!byKey(d, k), false);

        const fg = bootModel(MOCK_SYNTHS.forge);
        // Pad 1 (Kit A voice 1): WAVE alias cv_wave resolves to pv1_wave = 1 (Tri).
        eq('forge: WAVE ioKey is pv1_wave', fg.getKnobParamInfo(0).ioKey, 'pv1_wave');
        eq('forge: pv1_wave value (Tri=1)', fg.getKnobParamInfo(0).value, 1);
        // Switch to pad 11 (Kit B voice 3): same knob now addresses pv11_wave = 3.
        fg.updateDrumPad(11, 46);
        eq('forge: focus moved to pad 11', fg.getViewModel().drumCurrentPad, 11);
        eq('forge: WAVE ioKey follows to pv11_wave', fg.getKnobParamInfo(0).ioKey, 'pv11_wave');
        eq('forge: pv11_wave re-read (Square=3)', fg.getKnobParamInfo(0).value, 3);
        // Playback-safe: the key is a fixed pv-index, not note-driven.
        fg.updateDrumPad(3, 38);
        eq('forge: pad 3 → pv3_wave (Saw=2)', `${fg.getKnobParamInfo(0).ioKey}=${fg.getKnobParamInfo(0).value}`, 'pv3_wave=2');
        eq('forge: no duplicate shortNames per page', noDupShorts(bootModel(MOCK_SYNTHS.forge)), null);
    }
}

/* ── Summary ─────────────────────────────────────────────────────────────── */

_log('');
if (failures === 0) {
    _log('\x1b[32m\x1b[1mALL LOGIC CHECKS PASSED\x1b[0m');
    process.exit(0);
} else {
    _log(`\x1b[31m\x1b[1m${failures} LOGIC CHECK(S) FAILED\x1b[0m`);
    process.exit(1);
}
