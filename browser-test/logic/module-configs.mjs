/* browser-test/logic/module-configs.mjs — movy's per-module configs: what a
 * config adds that the module does not publish (slicer), and which config wins.
 *
 * Run by browser-test/logic.mjs.
 */

import {
    readFileSync, eq, bootModel, _log,
} from './harness.mjs';

export async function run() {
/* ── Sample Slicer: movy-side config for a module that publishes neither a
 *    ui_hierarchy nor its sample param ────────────────────────────────────
 * The metadata below is the device capture the dump replay uses, so these
 * assertions run against what the module really publishes. */

_log('\nTest: slicer config — sample browser, one-shot actions, slice pads');

{
    const cap = JSON.parse(readFileSync(
        new URL('../fixtures/dump-extra/sound_generator--slicer.json', import.meta.url), 'utf8'));
    const preset = { 'synth:name': 'Slicer', 'synth_module': 'slicer' };
    for (const [k, v] of Object.entries(cap.params)) preset['synth:' + k] = v;
    /* get_param('slices') answers on the device; the capture only carries the
     * values the host pushed, so state it here. */
    preset['synth:slices'] = '16';

    const m = bootModel(preset);
    const d = m.dumpLayout();
    const byKey = (k) => d.params.find(p => p && p.key === k);

    // The module maps Move pads 68-99 to slices 0-31 (note_to_slice), so the
    // grid is the full 32 pads and the pad note IS the slice.
    eq('slicer: 32 pads',            d.drum?.padCount, 32);
    eq('slicer: pads start at 68',   d.drum?.padNoteStart, 68);
    eq('slicer: pad note is raw',    d.drum?.rawMidi, true);
    // Selecting a slice is note-driven in the DSP (voice_start sets
    // selected_slice), so a silent shift-select would edit the wrong slice.
    eq('slicer: shift-select still sounds', d.drum?.shiftSelectMidi, true);

    // The sample param exists in no metadata the module publishes.
    eq('slicer: sample_path is absent from chain_params',
       cap.chain_params.some(p => p.key === 'sample_path'), false);
    eq('slicer: and movy still offers it as a file param', byKey('sample_path')?.type, 'file');
    const t = m.fileBrowseTargetForKey('sample_path');
    eq('slicer: browse root',   t?.root, '/data/UserData/UserLibrary');
    eq('slicer: browse start',  t?.startPath, '/data/UserData/UserLibrary/Samples');
    eq('slicer: browse filter', JSON.stringify(t?.filter),
       JSON.stringify(['.wav', '.aif', '.aiff', '.mp3', '.flac']));

    // Actions the module implements but never declares.
    for (const k of ['scan', 'reroll', 'detect_bpm']) {
        eq(`slicer: ${k} is a one-shot`, byKey(k)?.behavior, 'trigger');
        eq(`slicer: ${k} is not automatable`, byKey(k)?.automatable, false);
    }

    // Per-slice params address whichever slice is selected, so an automation
    // lane on one would land on whatever the sequencer last triggered.
    eq('slicer: slice params are not automatable', byKey('slice_attack')?.automatable, false);
}

/* ── which config wins when both exist ────────────────────────────────────── */

_log('\nTest: a module that describes itself wins, unless movy supersedes it');

{
    const { loadModuleConfig } = await import('../../dist/esm/modules/loader.js');
    const saved = globalThis.host_read_file;
    const ownFile = (id) => JSON.stringify({
        id, name: 'FromTheModule',
        banks: [{ name: 'OwnBank', rows: [[]] }],
    });
    const overrideDir = new URL('../../src/module-configs/', import.meta.url);
    globalThis.host_read_file = (p) => {
        const o = /\/tools\/movy\/configs\/([^/]+)\.json$/.exec(String(p));
        if (o) {
            try { return readFileSync(new URL(`${o[1]}.json`, overrideDir), 'utf8'); }
            catch { return null; }
        }
        const m = /\/([^/]+)\/movy_config\.json$/.exec(String(p));
        return m ? ownFile(m[1]) : null;
    };

    /* The default, and the reason forge and libpo32 work: a module's own file
     * beats the bundled table. libpo32 is bundled AND self-describing, so it is
     * the one that would silently regress if the rule were flipped wholesale —
     * which is why this is a per-module flag and not a global inversion. */
    eq('libpo32 keeps its own file', loadModuleConfig('po32-drum')?.name, 'FromTheModule');
    eq('and an unbundled module too',   loadModuleConfig('forge')?.name,  'FromTheModule');

    /* The exception. These four ship a layout that predates the voice-run rule
     * and cannot satisfy it, so movy carries the corrected one. */
    for (const id of ['6w6', '8w8', '9w9', 'cw78']) {
        const cfg = loadModuleConfig(id);
        eq(`${id}: movy's bundled config wins`, cfg?.name !== 'FromTheModule', true);
        eq(`${id}: and it is the voice-run shape`, cfg?.banks?.[0]?.pad, 1);
    }

    /* An override module deployed WITHOUT its config file must not silently get
     * the layout the override exists to replace — it falls back, and says so. */
    globalThis.host_read_file = (p) =>
        /movy_config\.json$/.test(String(p)) ? ownFile('8w8') : null;
    eq('a missing override file falls back to the module',
       loadModuleConfig('8w8')?.name, 'FromTheModule');

    // With no file at all, the bundled table is the fallback it has always been.
    globalThis.host_read_file = () => null;
    eq('bundled is still the fallback', loadModuleConfig('mrdrums')?.id, 'mrdrums');
    eq('and an unknown module is still null', loadModuleConfig('nope'), null);
    globalThis.host_read_file = saved;
}

}
