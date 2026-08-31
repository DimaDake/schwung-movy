/* browser-test/logic/drums.mjs — drum modules: detection, per-pad scoping, the preset overlay, pad on/off
 *
 * Run by browser-test/logic.mjs. The suite body is deliberately left at its
 * original indentation inside run() so blame survives the split.
 */

import {
    MOCK_SYNTHS, drumPadOn, drumPadOff, fail, eq, bootModel,
    _log, env, mockFsEntries, readFileSync,
} from './harness.mjs';

export async function run() {
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

  /* Sweep the knob across the full range and collect everything it writes:
   * every value must be one the DSP round-trips unchanged. */
  const DSP_ACCEPTS = new Set(['gate', 'oneshot', '0']);
  const slot = 7;                       // MODE is the last cell of the Main bank
  const written = new Set();            // pad focus defaults to 1 → p01_mode
  for (const dir of [1, -1]) {
    for (let i = 0; i < 12; i++) {
      m.handleKnobDelta(slot, dir * 4);  // ENUM_DELTA_DIV=4 → one step per turn
      m.tick();
      written.add(env.params['synth:p01_mode']);
    }
  }
  const rejected = [...written].filter(v => !DSP_ACCEPTS.has(v));
  eq('mrdrums MODE: sweep writes nothing the DSP rejects',
     JSON.stringify(rejected), '[]');
  eq('mrdrums MODE: sweep reaches both real modes', written.size, 2);
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
  touchMrdrumsPreset(m);
  const presetRoot = m.getFileBrowseTarget()?.root ?? '';
  eq('preset root reaches factory kits', FACTORY_KITS.startsWith(presetRoot + '/'), true);
  eq('preset root reaches user presets', USER_PRESETS.startsWith(presetRoot + '/'), true);

  const s = bootModel(MRDRUMS_PRESET);
  s.handleKnobTouch(0);              // Main bank slot 0 = SAMPL
  const sample = s.getFileBrowseTarget();
  eq('sample filter = wav + aiff',
     JSON.stringify(sample?.filter), JSON.stringify(['.wav', '.aif', '.aiff']));
  eq('sample start path = factory drum samples', sample?.startPath, FACTORY_DRUMS);
  eq('sample root reaches factory samples',
     FACTORY_DRUMS.startsWith((sample?.root ?? '') + '/'), true);
  eq('sample root reaches user samples',
     '/data/UserData/UserLibrary/Samples'.startsWith((sample?.root ?? '') + '/'), true);
}

_log('\nTest: preset overlay lists factory .json kits, hides folders + wrong files');

{
  mockFsEntries[FACTORY_KITS] = ['Kits', '808 Kit.json', 'loop.wav', 'drum.ablpreset'];
  const m = bootModel(MRDRUMS_PRESET);
  touchMrdrumsPreset(m);
  const opts = m.getViewModel().overlay?.options ?? [];
  eq('overlay shows both preset extensions', opts.length, 2);
  eq('overlay excludes folder Kits', opts.includes('Kits'), false);
  eq('overlay excludes loop.wav', opts.some(p => p.endsWith('.wav')), false);
}

_log('\nTest: overlay labels drop the preset extension');

{
  mockFsEntries[FACTORY_KITS] = ['808 Kit.json', 'drum.ablpreset'];
  const m = bootModel(MRDRUMS_PRESET);
  touchMrdrumsPreset(m);
  const opts = m.getViewModel().overlay?.options ?? [];
  eq('.json stripped from label', opts.includes('808 Kit'), true);
  eq('.ablpreset stripped from label', opts.includes('drum'), true);
}

_log('\nTest: overlay follows the loaded preset out of the factory library');

/* How "go back to my own presets" works: the browser moves the param to a user
 * path, and every later knob touch scans that path's folder instead of the
 * factory default. No extra state — the loaded value IS the location. */
{
  mockFsEntries[USER_PRESETS] = ['My Kit.ablpreset', 'Other Kit.ablpreset'];
  const m = bootModel({ ...MRDRUMS_PRESET,
                        'synth:ui_preset_path': USER_PRESETS + '/My Kit.ablpreset' });
  // Page first: the store only reads back params for the visible page, so
  // ticking on the Main bank never populates the preset knob's file value.
  m.changePage(m.getBankCount());
  for (let i = 0; i < 20; i++) m.tick();
  m.handleKnobTouch(0);
  const opts = m.getViewModel().overlay?.options ?? [];
  eq('overlay scans the loaded preset\'s folder', JSON.stringify(opts),
     JSON.stringify(['My Kit', 'Other Kit']));
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

_log('\nTest: overlay commit rejects a non-drum preset (param unchanged)');

{
  /* Both are .json now: widening the filter to reach factory kits also admits
   * every other .json Move keeps in those trees (instrument racks, schwung
   * sets), so the content check is the only thing keeping them out. */
  mockFsEntries[FACTORY_KITS] = ['808 Kit.json', 'synth.json'];
  const saved = globalThis.host_read_file;
  // Override only across the release/validation — loadModuleConfig also reads
  // via host_read_file, so the model must boot with the real (null) impl first.
  const presetContent = (p) => p.endsWith('808 Kit.json')
    ? '{ "kind": "drumRack" }' : '{ "kind": "instrumentRack" }';

  // sorted: 808 Kit.json[0], synth.json[1]
  const m = bootModel(MRDRUMS_PRESET);
  touchMrdrumsPreset(m);
  m.handleKnobDelta(0, 4);  // → synth.json (wrong type)
  globalThis.host_read_file = presetContent;
  const rejected = m.handleKnobRelease(0);
  globalThis.host_read_file = saved;
  eq('wrong preset → handleKnobRelease returns true', rejected, true);
  eq('wrong preset → param not set', env.params['synth:ui_preset_path'], undefined);

  const m2 = bootModel(MRDRUMS_PRESET);
  touchMrdrumsPreset(m2);  // selected idx 0 = 808 Kit.json
  globalThis.host_read_file = presetContent;
  const ok2 = m2.handleKnobRelease(0);
  globalThis.host_read_file = saved;
  eq('drum preset → not rejected', ok2, false);
  eq('factory kit → param set', env.params['synth:ui_preset_path'],
     FACTORY_KITS + '/808 Kit.json');
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

_log('\nTest: mrdrums per-pad scoping');
{
  // Focus is movy-owned: defaults to 1 even though the mock DSP reports
  // ui_current_pad=5 (no longer seeded from the DSP).
  const md = bootModel(MOCK_SYNTHS.mrdrums, 0, 'synth');
  eq('focus defaults to 1 (not DSP pad 5)', md.getViewModel().drumCurrentPad, 1);

  /* Locate VOL rather than hard-coding a knob number: this asserts pad
   * SCOPING (alias → concrete key), and pinning it to a slot made it fail
   * whenever the page's layout legitimately changed — the sample waveform
   * seats the sample and its start marker together, which moves VOL along. */
  const volKnob = [0, 1, 2, 3, 4, 5, 6, 7]
      .find((k) => md.getKnobParamInfo(k)?.key === 'pad_vol');
  eq('VOL knob is on page 0', volKnob !== undefined, true);

  // A normal knob turn writes the concrete focused-pad key, never the alias.
  const seen = [];
  const origSet = globalThis.shadow_set_param;
  globalThis.shadow_set_param = (s, k, v) => { seen.push(k); return origSet(s, k, v); };
  md.handleKnobDelta(volKnob, 5);   // queued
  md.tick();                        // flush pending delta through applyKnobDelta
  globalThis.shadow_set_param = origSet;
  eq('normal edit writes p01_vol', seen.includes('synth:p01_vol'), true);
  eq('normal edit avoids alias pad_vol', seen.includes('synth:pad_vol'), false);

  // The automation info exposes the concrete I/O key for lane assignment.
  const info = md.getKnobParamInfo(volKnob);
  eq('ioKey is concrete for focused pad', info.ioKey, 'p01_vol');
  eq('pad VOL automatable', info.automatable, true);

  // Switching the focused pad re-reads that pad's values immediately.
  md.updateDrumPad(5, 76);
  eq('focus moved to pad 5', md.getViewModel().drumCurrentPad, 5);
  eq('VOL re-read for pad 5 (p05_vol=0.50)', md.getKnobParamInfo(volKnob).value, 0.5);
  eq('ioKey follows focus', md.getKnobParamInfo(volKnob).ioKey, 'p05_vol');

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

/* ── 9W9: per-voice keys via padKeys ─────────────────────────────────────── */

_log('\nTest: 9w9 padKeys per-pad addressing');
{
  /* 9W9 ships its own movy_config.json (canonical: athousanddetails/schwung-9W9,
   * src/movy_config.json); serve the fixture snapshot the way module-configs
   * does, since the logic harness stubs host_read_file to null. */
  const savedRead = globalThis.host_read_file;
  const layout = readFileSync(new URL('../fixtures/9w9-movy-config.json', import.meta.url), 'utf8');
  globalThis.host_read_file = (p) => p.endsWith('/9w9/movy_config.json') ? layout : null;
  const nw = bootModel(MOCK_SYNTHS.nw9, 0, 'synth');
  globalThis.host_read_file = savedRead;
  const vm = nw.getViewModel();
  eq('9w9 is a drum module', vm.drumPadCount, 11);
  eq('Voice bank is pad-specific', vm.isPadSpecific, true);

  const at = (key) => [0, 1, 2, 3, 4, 5, 6, 7]
      .find((k) => nw.getKnobParamInfo(k)?.key === key);
  const pitch = at('pad_pitch'), decay = at('pad_decay'), drive = at('pad_drive'),
        pdepth = at('pad_pdepth');
  eq('Voice bank knobs are on page 0', pitch !== undefined && decay !== undefined, true);

  // Pad 1 = kick: the alias resolves to the kick circuit's own param.
  eq('pad 1 pitch → bd_c_tune', nw.getKnobParamInfo(pitch).ioKey, 'bd_c_tune');
  eq('pad 1 pitch value', nw.getKnobParamInfo(pitch).value, 10);
  eq('pad 1 drive → bd_c_drive', nw.getKnobParamInfo(drive).ioKey, 'bd_c_drive');
  eq('pad 1 drive automatable', nw.getKnobParamInfo(drive).automatable, true);

  // A turn writes the voice's key — never the alias, which no DSP would accept.
  const seen = [];
  const origSet = globalThis.shadow_set_param;
  globalThis.shadow_set_param = (sl, k, v) => { seen.push(k); return origSet(sl, k, v); };
  nw.handleKnobDelta(pitch, 4);
  nw.tick();
  globalThis.shadow_set_param = origSet;
  eq('edit writes bd_c_tune', seen.includes('synth:bd_c_tune'), true);
  eq('edit never writes the alias', seen.includes('synth:pad_pitch'), false);

  // Pad 2 = snare: same knob, a different circuit's key and value.
  nw.updateDrumPad(2, 69);
  eq('pad 2 pitch → sd_c_tune', nw.getKnobParamInfo(pitch).ioKey, 'sd_c_tune');
  eq('pad 2 pitch value re-read', nw.getKnobParamInfo(pitch).value, 20);

  // Pads 8 and 9 are ONE circuit with two decay knobs (closed / open hat) —
  // the mapping a pad-number template cannot express in any form.
  nw.updateDrumPad(8, 79);
  eq('pad 8 decay → ohh_decay_closed', nw.getKnobParamInfo(decay).ioKey, 'ohh_decay_closed');
  eq('pad 8 decay value', nw.getKnobParamInfo(decay).value, 81);
  nw.updateDrumPad(9, 84);
  eq('pad 9 decay → ohh_decay (same voice)', nw.getKnobParamInfo(decay).ioKey, 'ohh_decay');
  eq('pad 9 decay value', nw.getKnobParamInfo(decay).value, 91);
  eq('pad 9 pitch shares the voice key', nw.getKnobParamInfo(pitch).ioKey, 'ohh_pitch');

  eq('pad 9 drive → ohh_drive', nw.getKnobParamInfo(drive).ioKey, 'ohh_drive');

  // The hat has no pitch envelope, so Pitch Depth is listed as null for it:
  // unavailable, inert, and no automation dot — rather than showing the kick's
  // value and writing to a key this voice hasn't got.
  const cell = (k) => { const vm2 = nw.getViewModel();
      return vm2.rows[Math.floor(k / 4)]?.[k % 4]; };
  eq('absent P.Depth reads as unavailable', cell(pdepth)?.displayValue, '...');
  eq('absent P.Depth not automatable', nw.getKnobParamInfo(pdepth).automatable, false);
  const seen2 = [];
  globalThis.shadow_set_param = (sl, k, v) => { seen2.push(k); return origSet(sl, k, v); };
  nw.handleKnobDelta(pdepth, 6);
  nw.tick();
  globalThis.shadow_set_param = origSet;
  eq('absent P.Depth writes nothing', seen2.length, 0);

  // Back to a voice that has it: the knob comes alive again.
  nw.updateDrumPad(1, 68);
  eq('P.Depth live again on pad 1', nw.getKnobParamInfo(pdepth).ioKey, 'bd_c_sweep_depth');
  eq('P.Depth displays again on pad 1', cell(pdepth)?.displayValue, '14');
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
