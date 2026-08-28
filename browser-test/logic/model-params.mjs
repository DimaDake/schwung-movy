/* browser-test/logic/model-params.mjs — params: short-name dedup, rows, master FX, the file param + its overlay
 *
 * Run by browser-test/logic.mjs. The suite body is deliberately left at its
 * original indentation inside run() so blame survives the split.
 */

import {
    dedupShortNames, MOCK_SYNTHS, eq, bootModel, _log, env,
    mockFsEntries, installMockFs, uninstallMockFs, readPrefFileDir, PREFS_PATH,
} from './harness.mjs';

export async function run() {
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
    const { moduleReadKey } = await import('../../dist/esm/chain/config.js');
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
    // Labels drop a declared extension — see stripKnownExt in model/path.ts.
    eq('file overlay: selected = kick', vm.overlay?.options[vm.overlay.selected], 'kick');
}

/* ── hierarchy-declared filepath ──────────────────────────────────────────
 * A module may describe its file browser in module.json's ui_hierarchy rather
 * than in chain_params (slicer, breakbeat). Reading root/filter from
 * chain_params alone left such a browser rooted at /data/UserData, unfiltered. */

_log('\nTest: a filepath declared only in ui_hierarchy keeps its root and filter');

{
    mockFsEntries['/data/UserData/UserLibrary/Samples'] = ['break.wav', 'notes.txt', 'vox.aif'];
    const m = bootModel(MOCK_SYNTHS.hier_file_param);
    for (let i = 0; i < 20; i++) m.tick();
    m.handleKnobTouch(0);
    const vm = m.getViewModel();
    eq('hier filepath: first knob is a file param', vm.rows[0][0]?.type, 'file');
    eq('hier filepath: overlay lists the declared folder, extension-filtered',
       JSON.stringify(vm.overlay?.options ?? []), JSON.stringify(['break', 'vox']));
    eq('hier filepath: browse root is the declared one',
       m.getFileBrowseTarget()?.root, '/data/UserData/UserLibrary');
}

/* ── sticky browse folder ─────────────────────────────────────────────────
 * fileStartPath is a factory default; the folder the user last loaded from
 * outranks it, machine-wide (prefs.json), per param. */

_log('\nTest: an empty file param opens in the folder last loaded from');

{
    mockFsEntries['/data/UserData/Other'] = ['clap.wav', 'rim.wav'];
    // Boot before the mock fs: module-config loading reads through host_read_file.
    const m = bootModel({ ...MOCK_SYNTHS.file_param, 'synth:sample': '' });
    for (let i = 0; i < 20; i++) m.tick();
    installMockFs({ [PREFS_PATH]: JSON.stringify({
        fileDirs: { '?:sample': '/data/UserData/Other' } }) });
    m.handleKnobTouch(0);
    const opts = m.getViewModel().overlay?.options ?? [];
    eq('overlay opens in the remembered folder',
       JSON.stringify(opts), JSON.stringify(['clap', 'rim']));
    eq('browse target starts there too',
       m.getFileBrowseTarget()?.startPath, '/data/UserData/Other');
    uninstallMockFs();
}

_log('\nTest: a loaded file still opens in its own folder');

{
    mockFsEntries['/data/UserData/Samples'] = ['hat.wav', 'kick.wav'];
    mockFsEntries['/data/UserData/Other']   = ['clap.wav', 'rim.wav'];
    const m = bootModel(MOCK_SYNTHS.file_param);   // sample = Samples/kick.wav
    for (let i = 0; i < 20; i++) m.tick();
    installMockFs({ [PREFS_PATH]: JSON.stringify({
        fileDirs: { '?:sample': '/data/UserData/Other' } }) });
    m.handleKnobTouch(0);
    const opts = m.getViewModel().overlay?.options ?? [];
    eq('the loaded file\'s folder outranks the remembered one',
       JSON.stringify(opts), JSON.stringify(['hat', 'kick']));
    uninstallMockFs();
}

_log('\nTest: both commit paths record the folder');

{
    mockFsEntries['/data/UserData/Samples'] = ['hat.wav', 'kick.wav'];
    const m = bootModel(MOCK_SYNTHS.file_param);
    for (let i = 0; i < 20; i++) m.tick();
    installMockFs();
    // The full-screen browser commits through setFileValue.
    m.setFileValue(0, '/data/UserData/Other/clap.wav');
    eq('browser select records its folder',
       readPrefFileDir('?:sample'), '/data/UserData/Other');
    uninstallMockFs();

    // The knob overlay commits on release. A fresh model, because the select
    // above left the first one holding a file from the other folder.
    const m2 = bootModel(MOCK_SYNTHS.file_param);   // sample = Samples/kick.wav
    for (let i = 0; i < 20; i++) m2.tick();
    installMockFs();
    m2.handleKnobTouch(0);
    m2.handleKnobRelease(0);
    eq('overlay release records its folder',
       readPrefFileDir('?:sample'), '/data/UserData/Samples');
    uninstallMockFs();
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

}
