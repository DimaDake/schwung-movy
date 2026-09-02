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

// ── ViewModel drum fields: isPadScoped, drumCurrentPad, drumPadCount ───

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
  eq('mrdrums Main bank is pad-scoped', vm0.isPadScoped, true);
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
  eq('krautdrums bank 0 not pad-scoped (default)', vmk.isPadScoped, false);
  eq('krautdrums drumPadCount', vmk.drumPadCount, 16);

  // Navigate to a different bank and verify it's also not padSpecific
  mk.changePage(1);
  const vmk2 = mk.getViewModel();
  eq('krautdrums bank 1 not pad-scoped (default)', vmk2.isPadScoped, false);

  // Non-drum module
  const plaitsPreset = { 'synth:name': 'Plaits', 'synth_module': 'plaits' };
  const mp = bootModel(plaitsPreset);
  eq('plaits not pad-scoped', mp.getViewModel().isPadScoped, false);
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

/* ── Pad-follow: a pad selects the bank that declares it ──────────────────── */

_log('\nTest: bank.pad — a pad press selects that bank');

{
  /* The shape movy accepts: the voice run LEADS (pads 1..3), the pages with no
   * voice sit behind it. Mirrors the real kits without depending on a fixture. */
  const layout = JSON.stringify({
    id: 'padbank', name: 'PadBank',
    drum: { padCount: 3, padNoteStart: 36, rawMidi: false },
    banks: [
      { name: 'Kick',  pad: 1, rows: [[{ key: 'bd_tune', short: 'TUNE', full: 'Tune', type: 'int', min: 0, max: 127 }]] },
      { name: 'Snare', pad: 2, rows: [[{ key: 'sd_tune', short: 'TUNE', full: 'Tune', type: 'int', min: 0, max: 127 }]] },
      { name: 'Hat',   pad: 3, rows: [[{ key: 'hh_tune', short: 'TUNE', full: 'Tune', type: 'int', min: 0, max: 127 }]] },
      { name: 'Main',  rows: [[{ key: 'volume', short: 'VOL', full: 'Volume', type: 'int', min: 0, max: 127 }]] },
    ],
  });
  const savedRead = globalThis.host_read_file;
  globalThis.host_read_file = (p) => p.endsWith('/padbank/movy_config.json') ? layout : null;
  const m = bootModel({ 'synth:name': 'PadBank', 'synth_module': 'padbank',
                        'synth:volume': '64', 'synth:bd_tune': '10',
                        'synth:sd_tune': '20', 'synth:hh_tune': '30' }, 0, 'synth');
  globalThis.host_read_file = savedRead;

  /* Opens on the voice slot, the way it opens forge and weird-dreams. */
  eq('opens on the voice slot', m.getKnobPage(), 0);
  eq('three voices and Main is two seats', m.getBankCount(), 2);

  m.selectBankForPad(2);
  eq('pad 2 selects Snare', m.getKnobPage(), 1);
  eq('and the knob is the snare param', m.getKnobParamInfo(0)?.ioKey, 'sd_tune');

  m.selectBankForPad(1);
  eq('pad 1 selects Kick', m.getKnobPage(), 0);

  /* No voice claims pad 4 — the page must not move. Falling back to a
   * positional guess would drag the user off the page they are editing. */
  m.selectBankForPad(4);
  eq('unclaimed pad leaves the page alone', m.getKnobPage(), 0);

  /* Re-selecting the page you are on is not a change (no needless redraw). */
  m.selectBankForPad(1);
  eq('re-selecting the same voice is a no-op', m.getKnobPage(), 0);

  /* THE PAD ONLY TURNS THE PAGE FROM A VOICE PAGE. On Main it re-points the
   * voice slot and leaves you on Main — the padSpecific behaviour, and the
   * reason reaching for a pad to hear an edit does not lose your place. */
  m.changePage(1);
  eq('jog reaches Main', m.getKnobPage(), 3);
  m.selectBankForPad(3);
  eq('a pad press on Main does not move the page', m.getKnobPage(), 3);
  m.changePage(-1);
  eq('but the slot took the selection', m.getKnobPage(), 2);
  eq('and the knob is that voice\'s param', m.getKnobParamInfo(0)?.ioKey, 'hh_tune');
}

_log('\nTest: bank.pad — absent from a config, nothing follows');

{
  /* mrdrums declares no `pad` anywhere: every existing config must behave
   * exactly as it did before this feature. */
  const m = bootModel(MRDRUMS_PRESET, 0, 'synth');
  const before = m.getKnobPage();
  m.selectBankForPad(1);
  m.selectBankForPad(3);
  eq('no bank.pad → page unchanged', m.getKnobPage(), before);
}

_log('\nTest: bank.pad — shift+pad selects silently');

{
  /* The silence is drumPadOn's call (suppressMidi), and the page move is the
   * model's; together they make Shift+Pad a silent page change. Asserted as
   * one gesture so the pair cannot drift apart. */
  const cfg = { padCount: 4, padNoteStart: 36, rawMidi: false };
  let sent = [];
  const origSend = globalThis.shadow_send_midi_to_dsp;
  globalThis.shadow_send_midi_to_dsp = (msg) => { sent.push([...msg]); };

  const padShift = drumPadOn(69, 68, true, cfg, 'synth', 0, 100);
  eq('shift+pad sounds nothing', sent.length, 0);
  eq('shift+pad still resolves a pad', padShift, 2);

  sent = [];
  const padPlain = drumPadOn(69, 68, false, cfg, 'synth', 0, 100);
  eq('plain pad does sound', sent.length > 0, true);
  eq('plain pad resolves the same pad', padPlain, 2);

  globalThis.shadow_send_midi_to_dsp = origSend;
}

/* ── padKeys: per-voice keys behind ONE re-targeting row ─────────────────── */

_log('\nTest: padKeys per-pad addressing');
{
  /* The pre-2.0 9W9 layout, under a synthetic name — 9W9 itself dropped this
   * form (see the 9w9 test below), and a fixture called "9w9" would assert a
   * layout the module deliberately stopped shipping. The mechanism is still
   * right for a kit whose pads share a control set, so its coverage lives on
   * here. Serve the fixture the way module-configs does, since the logic
   * harness stubs host_read_file to null. */
  const savedRead = globalThis.host_read_file;
  const layout = readFileSync(new URL('../fixtures/padkeys-movy-config.json', import.meta.url), 'utf8');
  globalThis.host_read_file = (p) => p.endsWith('/padkeys/movy_config.json') ? layout : null;
  const nw = bootModel(MOCK_SYNTHS.padkeys, 0, 'synth');
  globalThis.host_read_file = savedRead;
  const vm = nw.getViewModel();
  eq('padKeys module is a drum module', vm.drumPadCount, 11);
  eq('Voice bank is pad-scoped', vm.isPadScoped, true);

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

/* ── 9W9 as it actually ships: a page per voice, each naming its pad ─────── */

_log('\nTest: the four kits ship the one shape movy accepts');
{
  /* Straight copies of each module's src/movy_config.json. The value of
   * asserting the SHIPPED files is that they break when a kit and movy stop
   * agreeing — the 1-based pad numbering especially, which a synthetic fixture
   * would only restate. */
  const KITS = [
    // id      mock    voices  pages behind the voice run
    ['6w6',   '6w6',   8,  ['Master', 'Reverb', 'Delay']],
    ['8w8',   '8w8',  16,  ['Master', 'Reverb', 'Delay']],
    ['9w9',   'nw9',  11,  ['Main', 'Reverb', 'Delay']],
    ['cw78',  'cw78', 14,  ['Master', 'Rhythm', 'Reverb', 'Delay']],
  ];
  const saved = globalThis.host_read_file;
  for (const [id, mock, voices, tail] of KITS) {
    const layout = readFileSync(
        new URL(`../fixtures/${id}-movy-config.json`, import.meta.url), 'utf8');
    globalThis.host_read_file = (p) => p.endsWith(`/${id}/movy_config.json`) ? layout : null;
    const m = bootModel(MOCK_SYNTHS[mock], 0, 'synth');
    globalThis.host_read_file = saved;

    const cfg   = JSON.parse(layout);
    const names = m.dumpLayout().banks.map(b => b.name);
    /* Control: an unserved config also boots to one page, so without this the
     * collapse assertions below would pass on a model that loaded nothing. */
    eq(`${id}: config loaded`, names.length, voices + tail.length);
    eq(`${id}: padCount is the voice count`, m.getViewModel().drumPadCount, voices);

    /* The voice run leads and claims pads 1..N; nothing behind it claims one. */
    eq(`${id}: the voice run leads`,
       cfg.banks.slice(0, voices).every(b => b.pad !== undefined), true);
    eq(`${id}: claiming pads 1..${voices}`,
       cfg.banks.slice(0, voices).map(b => b.pad).sort((a, b) => a - b).join(','),
       Array.from({ length: voices }, (_, i) => i + 1).join(','));
    eq(`${id}: no pad behind the run`,
       cfg.banks.slice(voices).some(b => b.pad !== undefined), false);
    eq(`${id}: and those are the pages without a voice`,
       names.slice(voices).join(','), tail.join(','));

    /* One seat for the voices, one each for the rest. */
    eq(`${id}: ${names.length} banks, ${1 + tail.length} pages`,
       m.getBankCount(), 1 + tail.length);
    eq(`${id}: opens on the voice slot`, m.getKnobPage(), 0);
    eq(`${id}: the voice page carries the pad icon`,
       m.getViewModel().isPadScoped, true);

    // Every pad reaches its own voice, by pad number and not by position.
    let hits = 0;
    for (let pad = 1; pad <= voices; pad++) {
      m.selectBankForPad(pad);
      if (names[m.getKnobPage()] === names[cfg.banks.findIndex(b => b.pad === pad)]) hits++;
    }
    eq(`${id}: all ${voices} pads select their own voice`, hits, voices);

    // The jog walks the tail, and the icon stops claiming a voice there.
    for (let i = 0; i < tail.length; i++) {
      m.changePage(1);
      eq(`${id}: jog ${i + 1} → ${tail[i]}`, names[m.getKnobPage()], tail[i]);
      eq(`${id}: no pad icon on ${tail[i]}`, m.getViewModel().isPadScoped, false);
    }
    m.changePage(1);
    eq(`${id}: the rotation ends at ${tail[tail.length - 1]}`,
       names[m.getKnobPage()], tail[tail.length - 1]);
  }
}

_log('\nTest: the voice slot keeps its place and its selection');
{
  const layout = readFileSync(
      new URL('../fixtures/8w8-movy-config.json', import.meta.url), 'utf8');
  const saved = globalThis.host_read_file;
  globalThis.host_read_file = (p) => p.endsWith('/8w8/movy_config.json') ? layout : null;
  const m = bootModel(MOCK_SYNTHS['8w8'], 0, 'synth');
  globalThis.host_read_file = saved;
  const names = m.dumpLayout().banks.map(b => b.name);

  eq('nineteen banks collapse to four pages', m.getBankCount(), 4);

  m.selectBankForPad(11);
  eq('pad 11 → Maracas', names[m.getKnobPage()], 'Maracas');

  /* The bar reads POSITIONS: Maracas is bank 10 and would otherwise light an
   * eleventh dot on a four-dot bar. */
  eq('the voice slot is the first dot', m.getViewModel().bankIndex, 0);
  eq('of four', m.getViewModel().bankCount, 4);
  eq('named for the voice, not the slot', m.getViewModel().bankName, 'Maracas');

  /* The slot REMEMBERS. Jogging away to Delay and back must return to the
   * voice you were editing; going back to Kick would undo the pad press. */
  m.changePage(2);
  eq('jog to Reverb', names[m.getKnobPage()], 'Reverb');
  m.changePage(-2);
  eq('and back → the voice you left, not the first one',
     names[m.getKnobPage()], 'Maracas');

  /* Shift+jog walks the same positions. Stepping by BANK index would leave the
   * page on a voice the slot is not showing. */
  m.changePageGroup(1);
  eq('shift+jog leaves the voice run in one step', names[m.getKnobPage()], 'Master');
  m.changePageGroup(-1);
  eq('and comes back to the same voice', names[m.getKnobPage()], 'Maracas');
}

_log('\nTest: a pad behind the voice run is not a voice');
{
  /* The shape movy refuses: a page-only pad, a spare grid seat that opens
   * Reverb. It reads as a free shortcut and is the opposite — having a pad is
   * what makes a bank a voice, so honouring it here would turn Reverb into a
   * voice and take it out of the rotation. Movy ignores it instead. */
  const layout = JSON.stringify({
    id: 'strays', name: 'Strays',
    drum: { padCount: 2, padNoteStart: 36, rawMidi: false },
    banks: [
      { name: 'Kick',   pad: 1, rows: [[{ key: 'bd', short: 'BD', full: 'BD', type: 'int', min: 0, max: 127 }]] },
      { name: 'Snare',  pad: 2, rows: [[{ key: 'sd', short: 'SD', full: 'SD', type: 'int', min: 0, max: 127 }]] },
      { name: 'Master', rows: [[{ key: 'vol', short: 'VOL', full: 'Vol', type: 'int', min: 0, max: 127 }]] },
      { name: 'Reverb', pad: 3, rows: [[{ key: 'rev', short: 'REV', full: 'Rev', type: 'int', min: 0, max: 127 }]] },
    ],
  });
  const saved = globalThis.host_read_file;
  globalThis.host_read_file = (p) => p.endsWith('/strays/movy_config.json') ? layout : null;
  const m = bootModel({ 'synth:name': 'Strays', 'synth_module': 'strays' }, 0, 'synth');
  globalThis.host_read_file = saved;
  const names = m.dumpLayout().banks.map(b => b.name);

  eq('the stray pad does not extend the voice run', m.getBankCount(), 3);
  eq('so Reverb keeps its own seat', names[m.getKnobPage()], 'Kick');
  m.changePage(2);
  eq('reachable by jog', names[m.getKnobPage()], 'Reverb');
  eq('and it is not a voice page', m.getViewModel().isPadScoped, false);

  /* Pressing that pad does nothing at all: it is behind the run, so it names
   * no voice, and the page it sits on is not a voice page either. */
  m.selectBankForPad(3);
  eq('and its pad selects nothing', names[m.getKnobPage()], 'Reverb');
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
