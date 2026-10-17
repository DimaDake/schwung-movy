/* browser-test/logic/drums.mjs — drum modules: detection, file targets,
 * per-pad key scoping, the shipped kit shape, and pad on/off.
 *
 * Run by browser-test/logic.mjs.
 */

import {
    MOCK_SYNTHS, drumPadOn, drumPadOff, fail, eq, bootModel,
    _log, env, readFileSync, OVERRIDES_MODULE_FILE,
} from './harness.mjs';
import { voiceRunLength } from '../../dist/esm/model/page-rotation.js';

export async function run() {
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
  /* And the GRID pad under it, or a freshly opened rack lights no pad white
   * while the step lane is already editing pad 1 — the module looked like it
   * had no pad selected until you hit one. */
  eq('mrdrums: pad 1 is the lit grid pad', vm.drumCurrentPhysPad, 68);

  const krautPreset = {
    'synth:name': 'KrautDrums',
    'synth_module': 'krautdrums',
    'synth:lvl_bass': '0.85',
  };
  const mk = bootModel(krautPreset);
  const vmk = mk.getViewModel();
  eq('krautdrums: drumPadCount=16', vmk.drumPadCount, 16);
  eq('krautdrums: drumCurrentPad defaults to 1', vmk.drumCurrentPad, 1);
  eq('krautdrums: rawMidi pad 1 is the lit grid pad', vmk.drumCurrentPhysPad, 68);

  const plaitsPreset = {
    'synth:name': 'Plaits',
    'synth_module': 'plaits',
  };
  const mp = bootModel(plaitsPreset);
  eq('plaits: not drum (drumPadCount=0)', mp.getViewModel().drumPadCount, 0);
}

// ── mrdrums MODE: options come from the module, so every step sticks ──────

_log('\nTest: mrdrums MODE offers only options the DSP parses (no snap-back)');

{
  /* mrdrums.json once hardcoded ["oneshot","loop","gate"]; the DSP's
   * parse_mode_value accepts only "gate"/"0" (else oneshot), so selecting
   * "loop" wrote a value the DSP silently coerced — and the next
   * refreshOneParam read "oneshot" back, snapping the knob a beat after the
   * user let go. The config now declares no options at all, inheriting the
   * module's own list, which cannot drift from what the DSP will accept. */
  const m = bootModel(MOCK_SYNTHS.mrdrums);
  for (let i = 0; i < 30; i++) m.tick();

  const mode = m.dumpLayout().params.find(p => p?.key === 'pad_mode');
  eq('mrdrums MODE: options inherited from module',
     JSON.stringify(mode?.options), '["gate","oneshot"]');
  eq('mrdrums MODE: max index is 1', mode?.max, 1);
}

// ── mrdrums preset file param: browse metadata + filtering + validation ───

const MRDRUMS_PRESET = {
  'synth:name': 'MrDrums',
  'synth_module': 'mrdrums',
};
/* Factory drum kits ship as .json under /data/CoreLibrary (Move's own library);
 * user presets are .ablpreset under /data/UserData. Both are reachable only
 * because fileRoot is their common ancestor — see the root-span test. */
const FACTORY_KITS  = '/data/CoreLibrary/Track Presets/Drums/Electronic';
const FACTORY_DRUMS = '/data/CoreLibrary/Samples/Drums';
const USER_PRESETS  = '/data/UserData/UserLibrary/Track Presets';

_log('\nTest: mrdrums preset param keeps fileFilter/fileStartPath/requireContains');

{
  const m = bootModel(MRDRUMS_PRESET);
  const t = m.fileBrowseTargetForKey('ui_preset_path');
  eq('preset target key', t?.key, 'ui_preset_path');
  eq('preset filter = .ablpreset + .json',
     JSON.stringify(t?.filter), JSON.stringify(['.ablpreset', '.json']));
  eq('preset start path = factory drum kits', t?.startPath, FACTORY_KITS);
  eq('preset requireContains = drumRack', t?.requireContains, 'drumRack');
}

_log('\nTest: preset/sample roots span the factory AND user libraries');

/* The browser cannot walk above fileRoot, so a root that covers only one
 * library strands the other: defaulting into /data/CoreLibrary with the old
 * /data/UserData/UserLibrary root left the user's own presets unreachable. */
{
  const m = bootModel(MRDRUMS_PRESET);
  const presetRoot = m.fileBrowseTargetForKey('ui_preset_path')?.root ?? '';
  eq('preset root reaches factory kits', FACTORY_KITS.startsWith(presetRoot + '/'), true);
  eq('preset root reaches user presets', USER_PRESETS.startsWith(presetRoot + '/'), true);

  const s = bootModel(MRDRUMS_PRESET);
  const sampleKey = s.dumpLayout().params.find(p => p?.type === 'file' && p.key !== 'ui_preset_path')?.key;
  const sample = s.fileBrowseTargetForKey(sampleKey);
  eq('sample filter = wav + aiff',
     JSON.stringify(sample?.filter), JSON.stringify(['.wav', '.aif', '.aiff']));
  eq('sample start path = factory drum samples', sample?.startPath, FACTORY_DRUMS);
  eq('sample root reaches factory samples',
     FACTORY_DRUMS.startsWith((sample?.root ?? '') + '/'), true);
  eq('sample root reaches user samples',
     '/data/UserData/UserLibrary/Samples'.startsWith((sample?.root ?? '') + '/'), true);
}

_log('\nTest: fileContentAllows accepts drumRack, rejects others');

{
  const { fileContentAllows } = await import('../../dist/esm/model/file-validate.js');
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

_log('\nTest: track colors — track 3 neon pink, track 4 royal blue');

{
  const { TRACK_COLOR, TRACK_COLOR_DIM } = await import('../../dist/esm/seq/colors.js');
  /* A cheap pin so the table is not completely unguarded on a checkout without
   * the schwung sibling repo — track-colors.mjs skips wholesale when it is
   * missing, and that is where the real palette reasoning lives. */
  eq('track 3 = AzureBlue dim(95)',    TRACK_COLOR[2], 95);
  eq('track 4 = NeonPink(23)',         TRACK_COLOR[3], 23);
  eq('track 3 dim = ElectricViolet dim(103)', TRACK_COLOR_DIM[2], 103);
  eq('track 4 dim = NeonPink dim(109)',       TRACK_COLOR_DIM[3], 109);
}

// ── ViewModel drum fields: drumCurrentPad, drumPadCount ───

_log('\nTest: ViewModel drum fields');

{
  const mrdrumsPreset = {
    'synth:name': 'MrDrums',
    'synth_module': 'mrdrums',
    'synth:ui_current_pad': '5',
    'synth:pad_vol': '0.8',
  };
  const m = bootModel(mrdrumsPreset);

  const vm0 = m.getViewModel();
  eq('mrdrums drumCurrentPad defaults to 1', vm0.drumCurrentPad, 1);
  eq('mrdrums drumPadCount', vm0.drumPadCount, 16);

  const krautPreset = {
    'synth:name': 'KrautDrums',
    'synth_module': 'krautdrums',
    'synth:lvl_bass': '0.5',
  };
  const mk = bootModel(krautPreset);
  const vmk = mk.getViewModel();
  eq('krautdrums drumPadCount', vmk.drumPadCount, 16);

  // Non-drum module
  const plaitsPreset = { 'synth:name': 'Plaits', 'synth_module': 'plaits' };
  const mp = bootModel(plaitsPreset);
  eq('plaits drumPadCount=0', mp.getViewModel().drumPadCount, 0);
}

/* ── pad-scoping helper ──────────────────────────────────────────────────── */

_log('\nTest: pad-scope concreteKey');
{
  const { concreteKey } = await import('../../dist/esm/model/pad-scope.js');
  const ps = { aliasPrefix: 'pad_', concreteKeyTemplate: 'p{pad}_{suffix}', padDigits: 2 };
  eq('alias→concrete pad 3', concreteKey(ps, 3, 'pad_vol'), 'p03_vol');
  eq('non-pad passthrough', concreteKey(ps, 3, 'g_master_vol'), 'g_master_vol');
  eq('no config passthrough', concreteKey(undefined, 3, 'pad_vol'), 'pad_vol');
  // Genericness: a totally different scheme must work with zero code change.
  const alt = { aliasPrefix: 'v_', concreteKeyTemplate: 'voice{pad}.{suffix}', padDigits: 3 };
  eq('generic template', concreteKey(alt, 7, 'v_cut'), 'voice007.cut');
  // suffixOverrides: an overridden suffix uses its own template within maxPad,
  // falls back to the main template past it (Forge sends: v3_fx1 vs pv9_fx1).
  const ov = {
    aliasPrefix: 'cv_', concreteKeyTemplate: 'pv{pad}_{suffix}', padDigits: 1,
    suffixOverrides: { fx1: { template: 'v{pad}_{suffix}', maxPad: 8 } },
  };
  eq('override within maxPad', concreteKey(ov, 3, 'cv_fx1'), 'v3_fx1');
  eq('override past maxPad → main', concreteKey(ov, 9, 'cv_fx1'), 'pv9_fx1');
  eq('non-override suffix → main', concreteKey(ov, 3, 'cv_wave'), 'pv3_wave');

  /* padKeys: voices named after the circuit, not the pad number. */
  const tbl = { aliasPrefix: 'pad_', padKeys: { pitch: ['bd_c_tune', 'sd_c_tune', null] } };
  eq('table pad 1', concreteKey(tbl, 1, 'pad_pitch'), 'bd_c_tune');
  eq('table pad 2', concreteKey(tbl, 2, 'pad_pitch'), 'sd_c_tune');
  // A listed null means "this voice has no such knob" → alias stays unresolved.
  eq('listed null → unresolved', concreteKey(tbl, 3, 'pad_pitch'), 'pad_pitch');
  eq('pad past list, no template → unresolved', concreteKey(tbl, 9, 'pad_pitch'), 'pad_pitch');
  eq('unlisted suffix, no template → unresolved', concreteKey(tbl, 1, 'pad_decay'), 'pad_decay');
  eq('non-alias passthrough', concreteKey(tbl, 1, 'master_drive'), 'master_drive');

  // Both forms in one config: the table wins where it speaks, the template
  // covers the rest — so a module can list its odd voices and template the rest.
  const both = {
    aliasPrefix: 'pad_', concreteKeyTemplate: 'p{pad}_{suffix}', padDigits: 2,
    padKeys: { pitch: ['bd_c_tune'] },
  };
  eq('table wins over template', concreteKey(both, 1, 'pad_pitch'), 'bd_c_tune');
  eq('past table end → template', concreteKey(both, 3, 'pad_pitch'), 'p03_pitch');
  eq('unlisted suffix → template', concreteKey(both, 3, 'pad_vol'), 'p03_vol');
}

/* ── Mr Drums: focused-pad scoping ───────────────────────────────────────── */

_log('\nTest: the four kits ship the one shape movy accepts');
{
  /* The bundled configs (src/module-configs/), which beat each module's own
   * file. Asserting the SHIPPED files is the point: they break when a kit and
   * movy stop agreeing — the 1-based pad numbering especially. The leading
   * voice run is what config-hierarchy.ts translates into Schwung's rack. */
  const KITS = [
    // id      voices  pages behind the voice run
    ['6w6',   8,  ['Reverb', 'Delay', 'Master']],
    ['8w8',  16,  ['Reverb', 'Delay', 'Master']],
    ['9w9',  11,  ['Reverb', 'Delay', 'Main']],
    ['cw78', 14,  ['Rhythm', 'Reverb', 'Delay', 'Master']],
  ];
  for (const [id, voices, tail] of KITS) {
    const cfg = JSON.parse(readFileSync(
        new URL(`../../src/module-configs/${id}.json`, import.meta.url), 'utf8'));
    eq(`${id}: bundled, and listed as overriding the module's file`,
       OVERRIDES_MODULE_FILE.has(id), true);
    eq(`${id}: the voice run is ${voices} long`,
       voiceRunLength(cfg.banks.map(b => b.pad)), voices);
    eq(`${id}: claiming pads 1..${voices}`,
       cfg.banks.slice(0, voices).map(b => b.pad).sort((a, b) => a - b).join(','),
       Array.from({ length: voices }, (_, i) => i + 1).join(','));
    eq(`${id}: no pad behind the run`,
       cfg.banks.slice(voices).some(b => b.pad !== undefined), false);
    eq(`${id}: and those are the pages without a voice`,
       cfg.banks.slice(voices).map(b => b.name).join(','), tail.join(','));
  }
}

_log('\nTest: a pad behind the voice run is not a voice');
{
  /* The shape movy refuses: a page-only pad, a spare grid seat that opens
   * Reverb. Having a pad is what makes a bank a voice, so honouring it would
   * turn Reverb into one. The stray has to fall BEHIND a bank that declares
   * none, or it just extends the run. */
  eq('the stray pad does not extend the voice run', voiceRunLength([1, 2, undefined, 3]), 2);
  eq('no pad at all is no voice run', voiceRunLength([undefined, 1]), 0);
}

/* ── the drum grid's geometry ────────────────────────────────────────────── */

_log('\nTest: drum grid mapping round-trips');

{
  const { drumPadOfPhys, drumNoteOfPhys, physPadOfDrumPad } =
    await import('../../dist/esm/keyboard/drum-grid.js');

  /* Input, LEDs, the engine's pad map and the model's initial focus all read
   * these, so a pad and its rack position must be each other's inverse — a
   * disagreement is a pad that sounds one voice and lights another. */
  for (const cfg of [{ padCount: 16, padNoteStart: 36, rawMidi: false },
                     { padCount: 8,  padNoteStart: 36, rawMidi: false },
                     { padCount: 16, padNoteStart: 68, rawMidi: true }]) {
    let roundTrips = 0;
    for (let pad = 1; pad <= cfg.padCount; pad++) {
      const phys = physPadOfDrumPad(pad, 68, cfg);
      if (drumPadOfPhys(phys, 68, cfg) === pad
          && drumNoteOfPhys(phys, 68, cfg) === cfg.padNoteStart + pad - 1) roundTrips++;
    }
    eq(`pad ↔ grid position round-trips (${cfg.rawMidi ? 'rawMidi' : 'rack'} ${cfg.padCount})`,
       roundTrips, cfg.padCount);
  }
  eq('the fifth column is not part of a rack', drumPadOfPhys(72, 68, { padCount: 16, padNoteStart: 36, rawMidi: false }), -1);
  eq('nor is a pad past the module\'s count', drumPadOfPhys(76, 68, { padCount: 4, padNoteStart: 36, rawMidi: false }), -1);
  eq('a dead pad plays no note', drumNoteOfPhys(72, 68, { padCount: 16, padNoteStart: 36, rawMidi: false }), -1);
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

  // pad 68, rawMidi=false: PAD_MAP[0]=0 → midiNote=36 → drumPad=1
  sentMidi = []; setParams = {};
  const r1 = drumPadOn(68, 68, false, mrdCfg, 'synth', 0, 100);
  eq('mrdrums pad68 → drumPad 1', r1, 1);
  eq('sends NoteOn 36', sentMidi[0]?.[1], 36);
  eq('velocity 100', sentMidi[0]?.[2], 100);
  eq('sets ui_current_pad=1', setParams['synth:ui_current_pad'], '1');

  // pad 76: padIdx=8, col=0, row=1 → drumPad=5, midiNote=40
  sentMidi = []; setParams = {};
  const r2 = drumPadOn(76, 68, false, mrdCfg, 'synth', 0, 100);
  eq('mrdrums pad76 → drumPad 5', r2, 5);
  eq('mrdrums pad76 → midiNote 40', sentMidi[0]?.[1], 40);

  // shift+pad (no shiftSelectMidi) → suppresses MIDI, still sets param
  sentMidi = []; setParams = {};
  const r3 = drumPadOn(68, 68, true, mrdCfg, 'synth', 0, 100);
  eq('shift+pad returns drumPad 1', r3, 1);
  eq('shift: no MIDI sent', sentMidi.length, 0);
  eq('shift: still sets param', setParams['synth:ui_current_pad'], '1');

  // shiftSelectMidi=true (weird-dreams) → sends vel=1
  const wdCfg = { padCount: 8, padNoteStart: 36, rawMidi: false, shiftSelectMidi: true };
  sentMidi = [];
  drumPadOn(68, 68, true, wdCfg, 'synth', 0, 100);
  eq('shiftSelectMidi: sends vel=1', sentMidi[0]?.[2], 1);

  // rawMidi=true (krautdrums): midiNote=physPad → drumPad=physPad-padNoteStart+1
  const kCfg = { padCount: 16, padNoteStart: 68, rawMidi: true };
  sentMidi = []; setParams = {};
  const r4 = drumPadOn(68, 68, false, kCfg, 'synth', 0, 100);
  eq('krautdrums pad68 → drumPad 1', r4, 1);
  eq('rawMidi sends pad note 68', sentMidi[0]?.[1], 68);

  // rawMidi out-of-range: kCfg padCount=16, pad84=drumPad17
  sentMidi = [];
  const r5 = drumPadOn(84, 68, false, kCfg, 'synth', 0, 100);
  eq('rawMidi out-of-range → null', r5, null);

  // right-half column (col=4, pad72): inactive for rawMidi=false
  sentMidi = [];
  const r6 = drumPadOn(72, 68, false, mrdCfg, 'synth', 0, 100);
  eq('grid col>=4 → null', r6, null);
  eq('grid col>=4: no MIDI', sentMidi.length, 0);

  // Held tracking: a sounding pad registers in the ledger so the drum grid can
  // light it green; release clears it. A shift-select makes no sound, so it
  // must not register as sounding.
  const ledger = await import('../../dist/esm/keyboard/held-notes.js');
  ledger.drainAll();
  drumPadOn(76, 68, false, mrdCfg, 'synth', 0, 100);   // sounds midiNote 40
  eq('held pad tracked (phys→midi)', ledger.noteReleased(76)?.pitch, 40);
  drumPadOn(76, 68, false, mrdCfg, 'synth', 0, 100);   // sound it again
  drumPadOff(76);
  eq('held pad cleared on release', ledger.isSounding(76), false);
  drumPadOn(68, 68, true, mrdCfg, 'synth', 0, 100);     // shift-select, silent
  eq('shift-select not held', ledger.isSounding(68), false);
  ledger.drainAll();

  globalThis.shadow_send_midi_to_dsp = origSendMidi;
  globalThis.shadow_set_param = origSetParam;
}

}
