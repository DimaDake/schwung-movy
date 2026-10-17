/* browser-test/logic/model-params.mjs — what a module's model still answers:
 * whether the slot is empty, master FX detection, and the file browser's
 * target for a file param (root, filter, start folder, current file).
 *
 * Run by browser-test/logic.mjs.
 */

import {
    MOCK_SYNTHS, eq, bootModel, _log, env,
    installMockFs, uninstallMockFs, readPrefFileDir, PREFS_PATH,
} from './harness.mjs';

export async function run() {

_log('\nTest: vm.isEmpty');

eq('no_params: isEmpty = true',  bootModel(MOCK_SYNTHS.no_params).getViewModel().isEmpty, true);
eq('test8: isEmpty = false',     bootModel(MOCK_SYNTHS.test8).getViewModel().isEmpty,     false);

/* ── master FX module read key ─────────────────────────────────────────────
 * Track components expose the loaded module id via an underscore alias
 * (fx1_module); master FX has none and is read with its colon key
 * (mfx:fx1:module). A wrong key here left an added master FX module
 * reading back empty ("click jog to add"). */
_log('\nTest: master FX module detection');
{
    const { moduleReadKey } = await import('../../dist/esm/chain/config.js');
    eq('track module read key', moduleReadKey('fx1'), 'fx1_module');
    eq('master module read key', moduleReadKey('mfx:fx1'), 'mfx:fx1:module');

    const preset = {
        'mfx:fx1:module':       'reverb',
        'mfx:fx1:name':         'Reverb',
        'mfx:fx1:ui_hierarchy': JSON.stringify({ levels: { root: { knobs: ['mix'] } } }),
        'mfx:fx1:chain_params': JSON.stringify([{ key: 'mix', name: 'Mix', type: 'float', min: 0, max: 1 }]),
        'mfx:fx1:mix':          '0.5',
    };
    const vm = bootModel(preset, 0, 'mfx:fx1').getViewModel();
    eq('master FX module detected (not empty)', vm.isEmpty, false);
    eq('master FX module name', vm.moduleName, 'Reverb');
}

/* ── the file browser's target ────────────────────────────────────────────
 * A module may describe its file browser in module.json's ui_hierarchy rather
 * than in chain_params (slicer, breakbeat). Reading root/filter from
 * chain_params alone left such a browser rooted at /data/UserData, unfiltered. */
_log('\nTest: a filepath declared only in ui_hierarchy keeps its root and filter');
{
    const m = bootModel(MOCK_SYNTHS.hier_file_param);
    const t = m.fileBrowseTargetForKey('sample_path');
    eq('browse root is the declared one', t?.root, '/data/UserData/UserLibrary');
    eq('and so is the filter', JSON.stringify(t?.filter), JSON.stringify(['.wav', '.aif']));
}

/* fileStartPath is a factory default; the folder the user last loaded from
 * outranks it, machine-wide (prefs.json), per param. */
_log('\nTest: an empty file param opens in the folder last loaded from');
{
    // Boot before the mock fs: module-config loading reads through host_read_file.
    const m = bootModel({ ...MOCK_SYNTHS.file_param, 'synth:sample': '' });
    installMockFs({ [PREFS_PATH]: JSON.stringify({
        fileDirs: { '?:sample': '/data/UserData/Other' } }) });
    eq('browse target starts there', m.fileBrowseTargetForKey('sample')?.startPath, '/data/UserData/Other');
    uninstallMockFs();
}

/* The browser opens ON the loaded file, so the target reads it live — no movy
 * mirror of a module's values exists to go stale. */
_log('\nTest: the current file is read live');
{
    const m = bootModel(MOCK_SYNTHS.file_param);
    eq('the loaded file', m.fileBrowseTargetForKey('sample')?.currentPath,
       '/data/UserData/Samples/kick.wav');
    env.params['synth:sample'] = '/data/UserData/Samples/snare.wav';
    eq('a file loaded behind movy’s back', m.fileBrowseTargetForKey('sample')?.currentPath,
       '/data/UserData/Samples/snare.wav');
}

_log('\nTest: the browser commit records the folder');
{
    const m = bootModel(MOCK_SYNTHS.file_param);
    installMockFs();
    m.setFileValue(0, '/data/UserData/Other/clap.wav');
    eq('browser select records its folder', readPrefFileDir('?:sample'), '/data/UserData/Other');
    uninstallMockFs();
}

_log('\nTest: a dive anchor resolves movy’s target without a slot');
{
    /* A DIVE COMES FROM SCHWUNG: `{action:"open", key, fullKey}` names the
     * parameter outright and carries no slot of movy's, so the target has to
     * resolve BY KEY. */
    const m = bootModel(MOCK_SYNTHS.file_param);
    eq('with no touch on record the slot route answers nothing',
       m.getFileBrowseTarget(() => 'sample'), null);
    const byKey = m.fileBrowseTargetForKey('sample');
    eq('but the anchor resolves by key alone', byKey?.key, 'sample');
    m.handleKnobTouch(0);
    eq('and it is the SAME target the slot route gives once a touch exists',
       JSON.stringify(byKey), JSON.stringify(m.getFileBrowseTarget(() => 'sample')));
    eq('a key movy has no config for resolves to nothing, so Schwung’s '
       + 'declaration stands alone rather than movy guessing one',
       m.fileBrowseTargetForKey('ui_preset_path'), null);
}

}
