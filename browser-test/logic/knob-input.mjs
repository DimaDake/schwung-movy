/* browser-test/logic/knob-input.mjs — knob input: enum value formats, delta normalisation, step cells, module metadata
 *
 * Run by browser-test/logic.mjs. The suite body is deliberately left at its
 * original indentation inside run() so blame survives the split.
 */

import {
    createModel, portFor, enumRawToIndex, enumUsesIndex, enumSetValue, MOCK_SYNTHS,
    eq, bootModel, _log, env,
} from './harness.mjs';

export async function run() {
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

_log('\nTest: knob delta normalizes sweep across param ranges');
{
  const { applyKnobDelta } = await import('../../dist/esm/model/store.js');
  const mkP = (min, max, type = 'float', step = 0.01) => ({
    key: 'p', label: 'p', shortLabel: null, type, min, max, step,
    options: null, renderStyle: 'arc', automatable: true,
  });
  // Fraction of the param's range moved by one detent.
  const fracPerDetent = (p, delta = 1) => {
    const s = {
      port: portFor(0), componentKey: 'synth', knobPage: 0, moduleConfig: null,
      knobParams: [p], knobValues: [p.min], enumFmt: [undefined],
      fileValues: [null], slotMapCache: null, dirty: false,
    };
    applyKnobDelta(s, 0, delta);
    return (s.knobValues[0] - p.min) / (p.max - p.min);
  };
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  const REF = 0.01 * 0.5;   // MIN_STEP_RANGE_FRAC * ARC_DELTA_SCALE
  // Every float moves the SAME fraction of its range per detent, regardless of units.
  eq('0..1 float: 1% range × arc / detent', near(fracPerDetent(mkP(0, 1)), REF), true);
  eq('0.5..20 float (reso): same fraction', near(fracPerDetent(mkP(0.5, 20)), REF), true);
  eq('100..15000 float (Hz cutoff): same fraction', near(fracPerDetent(mkP(100, 15000)), REF), true);
  // A float that was hair-trigger (coarse step) is normalized down to the same feel.
  eq('coarse-step float normalized, not faster', near(fracPerDetent(mkP(0, 1, 'float', 0.2)), REF), true);
  // Int keeps its natural step as a floor (small range still moves by ≥1).
  // A narrow range needs a whole step's worth of clicks to show it (see the
  // four-clicks-per-step block below), so ask for that many.
  const iMove = (min, max, delta = 1) => {
    const s = { port: portFor(0), componentKey: 'synth', knobPage: 0, moduleConfig: null,
      knobParams: [mkP(min, max, 'int', 1)], knobValues: [min], enumFmt: [undefined],
      fileValues: [null], slotMapCache: null, detentAccum: [], dirty: false };
    applyKnobDelta(s, 0, delta);
    return s.knobValues[0] - min;
  };
  eq('int 0..7 moves by 1 (floor)', iMove(0, 7, 4), 1);
  eq('int 20..20000 moves fast (range/100)', iMove(20, 20000) >= 90, true);
}

_log('\nTest: a knob moves the same amount in both directions');
{
  const { applyKnobDelta } = await import('../../dist/esm/model/store.js');
  const mkP = (min, max, type, step = 1, extra = {}) => ({
    key: 'p', label: 'p', shortLabel: null, type, min, max, step,
    options: null, renderStyle: 'arc', automatable: true, ...extra,
  });
  /* Signed movement of one flush of `delta` detents from `start`. */
  const move = (p, start, delta) => {
    const s = {
      port: portFor(0), componentKey: 'synth', knobPage: 0, moduleConfig: null,
      knobParams: [p], knobValues: [start], enumFmt: [undefined],
      fileValues: [null], slotMapCache: null, paramGestures: {}, triggerStates: {},
      detentAccum: [], dirty: false,
    };
    applyKnobDelta(s, 0, delta);
    return s.knobValues[0] - start;
  };
  /* Both edges of an obxd-style octave (int -2..2) and its cutoff (int 0..100)
   * from mid-range, one step each way. A half-unit step used to round the
   * clockwise tie up and the counter-clockwise one back to where it started, so
   * ccw was DEAD at one detent — the reported "sticks at the edges, too fast in
   * the middle". Every int in the dumped fleet with a range <= 200 had it.
   * `clicks` is what one step costs: 4 for a narrow range, 1 for a wide one. */
  for (const [name, p, start, clicks] of [
    ['octave int -2..2', mkP(-2, 2, 'int'), 0, 4],
    ['cutoff int 0..100', mkP(0, 100, 'int'), 50, 1],
    ['int 1..16', mkP(1, 16, 'int'), 8, 1],
    ['int -24..24', mkP(-24, 24, 'int'), 0, 1],
  ]) {
    eq(`${name}: one cw step moves +1`,  move(p, start, clicks),  1);
    eq(`${name}: one ccw step moves -1`, move(p, start, -clicks), -1);
  }
  // Multi-detent flushes (a fast turn) stay symmetric too.
  eq('int 0..100: 3 detents cw = +3',  move(mkP(0, 100, 'int'), 50, 3),  3);
  eq('int 0..100: 3 detents ccw = -3', move(mkP(0, 100, 'int'), 50, -3), -3);
  // Unaffected paths keep their existing speed, in both directions.
  eq('wide int keeps its range/100 step cw',  move(mkP(20, 20000, 'int'), 10000, 1),  100);
  eq('wide int keeps its range/100 step ccw', move(mkP(20, 20000, 'int'), 10000, -1), -100);
  const f = mkP(0, 1, 'float', 0.01);
  eq('float unchanged: symmetric 0.5% of range',
    Math.abs(move(f, 0.5, 1) + move(f, 0.5, -1)) < 1e-9 && Math.abs(move(f, 0.5, 1) - 0.005) < 1e-9,
    true);
  // 'wide' acceleration has its own unit-step path — untouched.
  const w = mkP(1, 9999, 'int', 1, { knobAcceleration: 'wide' });
  eq('wide-acceleration int: ±1 per deliberate detent',
    move(w, 500, 1) === 1 && move(w, 500, -1) === -1, true);
}

_log('\nTest: narrow discrete params take four clicks per step');
{
  const { applyKnobDelta } = await import('../../dist/esm/model/store.js');
  const mkP = (min, max, type = 'int', step = 1, extra = {}) => ({
    key: 'p', label: 'p', shortLabel: null, type, min, max, step,
    options: null, renderStyle: 'arc', automatable: true, ...extra,
  });
  const st = (p, value) => ({
    port: portFor(0), componentKey: 'synth', knobPage: 0, moduleConfig: null,
    knobParams: [p], knobValues: [value], enumFmt: [undefined], fileValues: [null],
    slotMapCache: null, paramGestures: {}, triggerStates: {}, detentAccum: [],
    dirty: false,
  });
  const writes = [];
  const origSet = globalThis.shadow_set_param;
  globalThis.shadow_set_param = (_s, k, v) => { writes.push([k, v]); return true; };

  // One click at a time: nothing moves until the fourth.
  const s = st(mkP(-2, 2), 0);
  const seen = [];
  for (let i = 0; i < 8; i++) { applyKnobDelta(s, 0, 1); seen.push(s.knobValues[0]); }
  eq('narrow int: 4 clicks per step up', JSON.stringify(seen),
    JSON.stringify([0, 0, 0, 1, 1, 1, 1, 2]));
  // Counter-clockwise is the mirror image.
  const d = st(mkP(-2, 2), 2);
  const seenDown = [];
  for (let i = 0; i < 8; i++) { applyKnobDelta(d, 0, -1); seenDown.push(d.knobValues[0]); }
  eq('narrow int: 4 clicks per step down', JSON.stringify(seenDown),
    JSON.stringify([2, 2, 2, 1, 1, 1, 1, 0]));
  // A sub-step turn writes nothing at all: no IPC, no undo entry.
  writes.length = 0;
  const q = st(mkP(0, 3), 1);
  applyKnobDelta(q, 0, 1);
  applyKnobDelta(q, 0, 1);
  eq('sub-step turn writes nothing', writes.length, 0);
  applyKnobDelta(q, 0, 2);
  eq('crossing the step writes once', writes.length, 1);
  eq('crossing the step moves by one', q.knobValues[0], 2);
  // A batched flush of 4 detents moves one step, like 4 separate clicks.
  const b = st(mkP(1, 8), 4);
  applyKnobDelta(b, 0, 4);
  eq('batched 4 detents = one step', b.knobValues[0], 5);
  // Excluded: 0..1 toggles, wide ranges, floats, and 'wide' acceleration.
  const t = st(mkP(0, 1, 'int', 1, { renderStyle: 'hbar' }), 0);
  applyKnobDelta(t, 0, 1);
  eq('0..1 toggle still flips on one click', t.knobValues[0], 1);
  const wide = st(mkP(0, 100), 50);
  applyKnobDelta(wide, 0, 1);
  eq('wide int unchanged: one unit per click', wide.knobValues[0], 51);
  const flt = st(mkP(0, 1, 'float', 0.01), 0.5);
  applyKnobDelta(flt, 0, 1);
  eq('float unchanged', Math.abs(flt.knobValues[0] - 0.505) < 1e-9, true);
  const acc = st(mkP(1, 8, 'int', 1, { knobAcceleration: 'wide' }), 4);
  applyKnobDelta(acc, 0, 1);
  eq("'wide' acceleration keeps its own rate", acc.knobValues[0], 5);
  globalThis.shadow_set_param = origSet;
}

_log('\nTest: octave and voice-count params become step cells');
{
  const { cellStyleFor } = await import('../../dist/esm/model/step-labels.js');
  const { formatValue } = await import('../../dist/esm/model/store.js');
  const style = (key, min, max, type = 'int') => {
    const c = cellStyleFor(key, type, min, max);
    return c.renderStyle + (c.signed ? '+' : '');
  };
  // Octave-like, signed because the range is a transpose.
  eq('obxd octave -2..2',            style('octave', -2, 2),             'steps+');
  eq('octave_transpose -3..3',       style('octave_transpose', -3, 3),   'steps+');
  eq('lane1_octave -3..3',           style('lane1_octave', -3, 3),       'steps+');
  eq('nusaw sub_octave -2..0',       style('sub_octave', -2, 0),         'steps+');
  eq('moog osc1_range -2..2',        style('osc1_range', -2, 2),         'steps+');
  // Octave-like counts are unsigned.
  eq('helm arp_octaves 1..4',        style('arp_octaves', 1, 4),         'steps');
  // Voice counts are unsigned at any width.
  eq('obxd voice_count 1..8',        style('voice_count', 1, 8),         'steps');
  eq('freak unison 1..8',            style('unison', 1, 8),              'steps');
  eq('granny active_voices 0..8',    style('active_voices', 0, 8),       'steps');
  eq('forge cho_voices 2..8',        style('cho_voices', 2, 8),          'steps');
  eq('helm osc_1_unison_voices',     style('osc_1_unison_voices', 1, 15),'steps');
  eq('mrdrums g_polyphony 1..64',    style('g_polyphony', 1, 64),        'steps');
  eq('sfz voices 1..128',            style('voices', 1, 128),            'steps');
  // Booleans are switches, not framed numbers.
  eq('helm sub_octave 0..1',         style('sub_octave', 0, 1),          'switch');
  eq('obxd unison 0..1',             style('unison', 0, 1),              'switch');
  eq('obxd bend_range 0..1',         style('bend_range', 0, 1),          'switch');
  // Excluded: too wide to be an octave, amounts, randomisers, non-ints.
  eq('genera octaves 0..100',        style('octaves', 0, 100),           'arc');
  eq('lane1_oct_seed 0..65535',      style('lane1_oct_seed', 0, 65535),  'arc');
  eq('signal rnd_voices 0..127',     style('rnd_voices', 0, 127),        'arc');
  eq('obxd unison_det 0..100',       style('unison_det', 0, 100),        'arc');
  eq('osirus unison_detune 0..127',  style('unison_detune', 0, 127),     'arc');
  eq('hera pitch_range 0..2',        style('pitch_range', 0, 2),         'arc');
  eq('obxd legato 0..3',             style('legato', 0, 3),              'arc');
  eq('obxd cutoff 0..100',           style('cutoff', 0, 100),            'arc');
  eq('float octave-named stays arc', style('octave', -2, 2, 'float'),    'arc');
  // The sign shows up in the value text, so box and touched readout agree.
  const p = (signed) => ({ key: 'octave', label: 'Octave', shortLabel: null, type: 'int',
    min: -2, max: 2, step: 1, options: null, renderStyle: 'steps', automatable: true,
    ...(signed ? { signed: true } : {}) });
  eq('signed int shows +1',  formatValue(p(true), 1),   '+1');
  eq('signed int shows 0',   formatValue(p(true), 0),   '0');
  eq('signed int shows -2',  formatValue(p(true), -2),  '-2');
  eq('count shows 4 unsigned', formatValue(p(false), 4), '4');
}

_log('\nTest: a suppressed param still learns its value once');
{
  /* An automation lane (or an LFO target) suppresses read-back so the page keeps
   * showing the UI-owned base instead of the engine-driven value. But that base
   * starts as null, and only a knob TURN used to seed it — so a param that was
   * automated before it was ever touched had no value at all: its step cell read
   * "..." and its arc sat at minimum (which on an octave -3..3 looks like a real
   * -3). knobParamInfo also handed automation p.min as the base. The device
   * fixture puts a lane on exactly this param, which is how it was found. */
  /* The lane must exist before the first refresh, exactly as it does on device:
   * the set is restored (with its automation) and only then does movy tick. */
  env.setParams(MOCK_SYNTHS.test_steps);
  const m = createModel(portFor(0), 'synth');
  m.setNoRefreshKeys(['octave']);
  m.reload();
  for (let i = 0; i < 40; i++) m.tick();          // plenty of refresh cursors
  const oct = m.getViewModel().rows.flat().find(c => c && c.shortName === 'OCT');
  eq('suppressed param shows its value, not "..."', oct.displayValue, '+2');
  eq('suppressed param arc is not pinned at minimum', oct.normalizedValue > 0, true);
  const info = m.getKnobParamInfo(0);
  eq('automation gets the real base, not min', info.value, 2);
  /* Still suppressed after seeding: the engine-driven value must not creep in. */
  env.setParams({ ...MOCK_SYNTHS.test_steps, 'synth:octave': '-3' });
  for (let i = 0; i < 40; i++) m.tick();
  eq('read-back stays suppressed once seeded',
    m.getViewModel().rows.flat().find(c => c && c.shortName === 'OCT').displayValue, '+2');
}

_log('\nTest: a numeric cell keeps its sign, and +/1 sit right in the box');
{
  const { enumSquareLines } = await import('../../dist/esm/renderer/shorten.js');
  const { fontWidth5x3 }    = await import('../../dist/esm/font/index5x3.js');
  const { G5 }              = await import('../../dist/esm/font/glyphs5x3.js');
  const CHARS5 = ' !"\'()+,-./:0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ%<>=?*';

  /* enumSquareLines turns '-' into a word separator so LOW_PASS and SAMPLE-HOLD
   * split across the two lines of the box. A NUMBER is not a two-word label:
   * that rule silently ate the minus, so "-3" drew as "3" — identical to
   * positive 3, which surge publishes as an octave option right beside it. */
  const lines = (v) => JSON.stringify(enumSquareLines(v));
  eq('-3 keeps its sign',   lines('-3'),   JSON.stringify(['-3', '']));
  eq('-1 keeps its sign',   lines('-1'),   JSON.stringify(['-1', '']));
  eq('+2 unchanged',        lines('+2'),   JSON.stringify(['+2', '']));
  eq('0 unchanged',         lines('0'),    JSON.stringify(['0', '']));
  eq('128 stays one line',  lines('128'),  JSON.stringify(['128', '']));
  // Word labels must still split exactly as before.
  eq('LOW_PASS still splits',    lines('LOW_PASS'),    JSON.stringify(['LOW', 'PAS']));
  eq('SAMPLE-HOLD still splits', lines('SAMPLE-HOLD'), JSON.stringify(['SAM', 'HOL']));
  eq('LINEAR still wraps',       lines('LINEAR'),      JSON.stringify(['LIN', 'EAR']));
  // The widest value any step cell can show must fit the box (KW 16 → inner 14).
  eq('widest count fits the box', fontWidth5x3('128') <= 14, true);
  eq('signed offset fits the box', fontWidth5x3('-4') <= 14, true);

  /* Glyph geometry, against 5x3-font.otf: the plus is drawn on rows 1-3 of the
   * 5-row cell (it was on 0-2, so it floated 1-2px above the digits beside it),
   * and the 1's flag points LEFT off a right-hand stem. */
  const rowsOf = (ch) => G5[CHARS5.indexOf(ch)].slice(4);
  const art = (ch) => rowsOf(ch).map(b => [0,1,2].map(c => (b & (1 << c)) ? '#' : '.').join(''));
  eq('plus is vertically centred', JSON.stringify(art('+')),
    JSON.stringify(['...', '.#.', '###', '.#.', '...']));
  eq('minus is vertically centred', JSON.stringify(art('-')),
    JSON.stringify(['...', '...', '###', '...', '...']));
  eq('one has a left flag and no foot', JSON.stringify(art('1')),
    JSON.stringify(['##.', '.#.', '.#.', '.#.', '.#.']));
  eq('equals is vertically centred', JSON.stringify(art('=')),
    JSON.stringify(['...', '###', '...', '###', '...']));
  // Digits stay monospaced so a value does not shift as it changes.
  eq('every digit advances by 4',
    '0123456789'.split('').every(d => G5[CHARS5.indexOf(d)][0] === 4), true);
}

_log('\nTest: module interaction metadata drives triggers, acceleration, and automation');
{
  const { applyKnobDelta } = await import('../../dist/esm/model/store.js');
  const trigger = {
    key: 'capture', label: 'Capture', shortLabel: null, type: 'enum',
    min: 0, max: 1, step: 1, options: ['idle', 'trigger'],
    renderStyle: 'arc', automatable: false, behavior: 'trigger',
  };
  const seed = {
    key: 'seed', label: 'Seed', shortLabel: null, type: 'int',
    min: 1, max: 9999, step: 1, options: null,
    renderStyle: 'arc', automatable: true, knobAcceleration: 'wide',
  };
  const state = (p, value) => ({
    port: portFor(0), componentKey: 'synth', knobPage: 0, moduleConfig: null,
    knobParams: [p], knobValues: [value], enumFmt: [undefined],
    fileValues: [null], slotMapCache: null, paramGestures: {}, triggerStates: {},
    dirty: false,
  });

  const originalSet = globalThis.shadow_set_param;
  const writes = [];
  globalThis.shadow_set_param = (_slot, key, value) => { writes.push([key, value]); return true; };
  env.setParams({ 'synth:capture': '0' });
  const ts = state(trigger, 0);
  applyKnobDelta(ts, 0, 1);
  applyKnobDelta(ts, 0, 1);
  eq('trigger: clockwise fires once per gesture', JSON.stringify(writes),
    JSON.stringify([['synth:capture', '1']]));
  eq('trigger: display returns to idle immediately', ts.knobValues[0], 0);
  applyKnobDelta(ts, 0, -1);
  applyKnobDelta(ts, 0, 1);
  eq('trigger: counter-clockwise sends idle and re-arms', JSON.stringify(writes.slice(1)),
    JSON.stringify([['synth:capture', '0'], ['synth:capture', '1']]));
  globalThis.shadow_set_param = originalSet;

  const originalNow = Date.now;
  let now = 1000;
  Date.now = () => now;
  const ss = state(seed, 1000);
  applyKnobDelta(ss, 0, 1);                // deliberate turn: +1
  now += 100; applyKnobDelta(ss, 0, 1);    // continuing turn: +10
  now += 20;  applyKnobDelta(ss, 0, 1);    // fast sweep: +250
  eq('wide acceleration: slow + medium + fast reaches 1261', ss.knobValues[0], 1261);
  now += 10;  applyKnobDelta(ss, 0, -1);   // reversal is fine again
  eq('wide acceleration: direction reversal moves one step', ss.knobValues[0], 1260);
  Date.now = originalNow;

  const metadataPreset = {
    'synth:name': 'Metadata',
    'synth:ui_hierarchy': JSON.stringify({ levels: { root: {
      knobs: ['capture', 'seed', 'locked'],
      params: [
        { key: 'capture', name: 'Capture', type: 'enum', options: ['idle', 'trigger'] },
        { key: 'seed', name: 'Seed', type: 'int', min: 1, max: 9999, knob_acceleration: 'wide' },
        { key: 'locked', name: 'Locked', type: 'float', min: 0, max: 1 },
      ],
    } } }),
    'synth:chain_params': JSON.stringify([
      { key: 'capture', name: 'Capture', type: 'enum', options: ['idle', 'trigger'], automatable: true },
      { key: 'seed', name: 'Seed', type: 'int', min: 1, max: 9999 },
      { key: 'locked', name: 'Locked', type: 'float', min: 0, max: 1, automatable: false },
    ]),
    'synth:capture': '0', 'synth:seed': '4303', 'synth:locked': '0.5',
  };
  const params = bootModel(metadataPreset).dumpLayout().params.filter(Boolean);
  const byKey = Object.fromEntries(params.map(p => [p.key, p]));
  eq('metadata: idle/trigger enum inferred as a trigger', byKey.capture.behavior, 'trigger');
  eq('metadata: triggers are never automatable', byKey.capture.automatable, false);
  eq('metadata: knob_acceleration survives hierarchy parsing', byKey.seed.knobAcceleration, 'wide');
  eq('metadata: explicit numeric automatable=false is respected', byKey.locked.automatable, false);
}

_log('\nTest: self-describing layouts resolve from every chain component category');
{
  const { loadModuleConfig } = await import('../../dist/esm/modules/loader.js');
  const originalRead = globalThis.host_read_file;
  const reads = [];
  globalThis.host_read_file = (path) => { reads.push(path); return null; };
  loadModuleConfig('voice-layout', 'synth');
  loadModuleConfig('fx-layout', 'fx1');
  loadModuleConfig('master-layout', 'master_fx:fx1');
  loadModuleConfig('midi-layout', 'midi_fx1');
  globalThis.host_read_file = originalRead;
  eq('layout path: sound generator', reads[0],
    '/data/UserData/schwung/modules/sound_generators/voice-layout/movy_config.json');
  eq('layout path: audio FX', reads[1],
    '/data/UserData/schwung/modules/audio_fx/fx-layout/movy_config.json');
  eq('layout path: master FX', reads[2],
    '/data/UserData/schwung/modules/audio_fx/master-layout/movy_config.json');
  eq('layout path: MIDI FX', reads[3],
    '/data/UserData/schwung/modules/midi_fx/midi-layout/movy_config.json');
}

/* Global-bank params are not reachable as chain `target:params` (device spike),
 * so they can never be automated no matter what a module claims. movy's own
 * config may still override per slot (it knows which per-voice keys resolve),
 * but third-party metadata must not — otherwise a module re-enables an
 * automation dot on a param the host cannot resolve. */
_log('\nTest: module automatable metadata cannot override the global-bank guard');
{
  const globalCp = (extra) => ({
    ...MOCK_SYNTHS.mrdrums,
    'synth:chain_params': JSON.stringify([
      { key: 'g_master_vol', name: 'Master Vol', type: 'float', min: 0, max: 2, ...extra },
    ]),
  });
  const automatableOf = (preset) => {
    const p = bootModel(preset).dumpLayout().params
      .filter(Boolean).find(q => q.key === 'g_master_vol');
    return p?.automatable;
  };
  eq('global param: silent chain_params stays non-automatable',
    automatableOf(globalCp({})), false);
  eq('global param: module automatable=true is ignored',
    automatableOf(globalCp({ automatable: true })), false);
}

/* The shadow UI accumulates knob deltas and flushes ONE CC per tick, so a fast
 * hardware spin arrives as a single large delta. Multiplying that by the
 * acceleration ladder compounds twice — measured on device, 3 events at delta=6
 * moved `seed` 3000 of its 9999 range, putting the middle out of reach at speed.
 * The ladder must scale a unit step, not the incoming delta. */
_log('\nTest: wide acceleration scales a unit step, not the accumulated delta');
{
  const { applyKnobDelta } = await import('../../dist/esm/model/store.js');
  const seed = {
    key: 'seed', label: 'Seed', shortLabel: null, type: 'int',
    min: 1, max: 9999, step: 1, options: null,
    renderStyle: 'arc', automatable: true, knobAcceleration: 'wide',
  };
  const originalNow = Date.now;
  const run = (secondDelta) => {
    let now = 1000;
    Date.now = () => now;
    const s = {
      port: portFor(0), componentKey: 'synth', knobPage: 0, moduleConfig: null,
      knobParams: [seed], knobValues: [5000], enumFmt: [undefined],
      fileValues: [null], slotMapCache: null, paramGestures: {}, triggerStates: {},
      dirty: false,
    };
    applyKnobDelta(s, 0, 1);              // establish direction: +1
    const base = s.knobValues[0];
    now += 20; applyKnobDelta(s, 0, secondDelta);   // fast sweep → ×250
    Date.now = originalNow;
    return s.knobValues[0] - base;
  };
  eq('one accumulated detent at speed travels 250', run(1), 250);
  eq('six accumulated detents at speed travel 250, not 1500', run(6), 250);
}

/* A one-shot control has to say what it did. The badge phase drives the widget:
 * ARMED (turn CW to fire) → FIRED (momentary confirmation) → COOLING (latched
 * while the gesture-end debounce runs) → ARMED again. */
}
