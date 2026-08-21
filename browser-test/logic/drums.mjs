/* browser-test/logic/drums.mjs — drum modules: detection, per-pad scoping, the preset overlay, pad on/off
 *
 * Run by browser-test/logic.mjs. The suite body is deliberately left at its
 * original indentation inside run() so blame survives the split.
 */

import {
    MOCK_SYNTHS, drumPadOn, drumPadOff, fail, eq, bootModel,
    _log, env, mockFsEntries,
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
