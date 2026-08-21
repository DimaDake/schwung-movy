/* browser-test/logic/trigger-badge.mjs — action params: the trigger badge phases (armed / fired / cooling / latched)
 *
 * Run by browser-test/logic.mjs. The suite body is deliberately left at its
 * original indentation inside run() so blame survives the split.
 */

import {
    portFor, eq, bootModel, _log, env,
} from './harness.mjs';

export async function run() {
_log('\nTest: trigger badge phases run armed -> fired -> cooling -> armed');
{
  const { applyKnobDelta } = await import('../../dist/esm/model/store.js');
  const { triggerVisual } = await import('../../dist/esm/model/trigger.js');
  const TRIG = {
    key: 'capture', label: 'Capture', shortLabel: null, type: 'enum',
    min: 0, max: 1, step: 1, options: ['idle', 'trigger'],
    renderStyle: 'arc', automatable: false, behavior: 'trigger',
  };
  const mkState = () => ({
    port: portFor(0), componentKey: 'synth', knobPage: 0, moduleConfig: null,
    knobParams: [TRIG], knobValues: [0], enumFmt: [true], fileValues: [null],
    slotMapCache: null, paramGestures: {}, triggerStates: {}, dirty: false,
  });
  const originalNow = Date.now, originalSet = globalThis.shadow_set_param;
  let now = 10000;
  Date.now = () => now;
  const writes = [];
  globalThis.shadow_set_param = (_s, k, v) => { writes.push([k, v]); return true; };

  const s = mkState();
  eq('armed before any turn', triggerVisual(s, 'capture').phase, 'armed');
  applyKnobDelta(s, 0, 1);
  eq('one clockwise turn fires once', writes.length, 1);
  eq('fired immediately after the turn', triggerVisual(s, 'capture').phase, 'fired');
  now += 250;   // past TRIGGER_FLASH_MS
  eq('cooling once the flash expires', triggerVisual(s, 'capture').phase, 'cooling');
  now += 600;   // 850ms since the turn, past TRIGGER_REARM_MS
  eq('re-armed once the drain empties', triggerVisual(s, 'capture').phase, 'armed');

  Date.now = originalNow;
  globalThis.shadow_set_param = originalSet;
}

/* The renderer cannot show what never reaches it. PR #2 left `behavior` inside
 * the model, so the badge phase has to travel out through the ParamVM. */
_log('\nTest: the badge phase and drain reach the ParamVM');
{
  const preset = {
    'synth:name': 'vmmod', 'synth_module': 'vmmod',
    'synth:chain_params': JSON.stringify([
      { key: 'capture', name: 'Capture', type: 'enum', options: ['idle', 'trigger'] },
      { key: 'wet', name: 'Wet', type: 'float', min: 0, max: 1 },
    ]),
    'synth:capture': 'idle', 'synth:wet': '0.5',
  };
  const originalSet = globalThis.shadow_set_param;
  const m = bootModel(preset);
  for (let i = 0; i < 4; i++) m.tick();
  globalThis.shadow_set_param = () => true;
  const cap = () => m.getViewModel().rows[0][0];

  eq('armed trigger reports its phase', cap().trigger, 'armed');
  eq('a non-trigger param has no phase', m.getViewModel().rows[0][1].trigger, undefined);

  m.handleKnobDelta(0, 1); m.tick();
  eq('fired phase reaches the ParamVM', cap().trigger, 'fired');
  eq('fired carries a full drain', cap().triggerCool, 8);

  globalThis.shadow_set_param = originalSet;
}

/* The fired confirmation is the icon blinking, not a whole-cell flash, so the
 * phase alone is not enough — the renderer needs which half of the cycle it is in. */
_log('\nTest: the fired icon blinks on a fixed half-period');
{
  const { applyKnobDelta } = await import('../../dist/esm/model/store.js');
  const { triggerVisual } = await import('../../dist/esm/model/trigger.js');
  const { TRIGGER_FLASH_MS, TRIGGER_BLINK_MS } = await import('../../dist/esm/model/constants.js');
  const TRIG = {
    key: 'capture', label: 'Capture', shortLabel: null, type: 'enum',
    min: 0, max: 1, step: 1, options: ['idle', 'trigger'],
    renderStyle: 'arc', automatable: false, behavior: 'trigger',
  };
  const originalNow = Date.now, originalSet = globalThis.shadow_set_param;
  let now = 40000;
  Date.now = () => now;
  globalThis.shadow_set_param = () => true;
  const s = {
    port: portFor(0), componentKey: 'synth', knobPage: 0, moduleConfig: null,
    knobParams: [TRIG], knobValues: [0], enumFmt: [true], fileValues: [null],
    slotMapCache: null, paramGestures: {}, triggerStates: {}, dirty: false,
  };
  const firedAt = now;
  applyKnobDelta(s, 0, 1);

  const at = (ms) => { now = firedAt + ms; return triggerVisual(s, 'capture'); };
  eq('blink starts on', at(0).blinkOn, true);
  eq('blink is off in the second half-period', at(TRIGGER_BLINK_MS + 5).blinkOn, false);
  eq('blink is on again in the third', at(TRIGGER_BLINK_MS * 2 + 5).blinkOn, true);

  const cycles = [];
  for (let t = 0; t < TRIGGER_FLASH_MS; t += 5) cycles.push(at(t).blinkOn);
  const alternations = cycles.filter((v, i) => i > 0 && v !== cycles[i - 1]).length;
  eq('the flash window contains several alternations', alternations >= 3, true);
  eq('blink is irrelevant once cooling', at(TRIGGER_FLASH_MS + 10).blinkOn, false);

  Date.now = originalNow;
  globalThis.shadow_set_param = originalSet;
}

/* Writes are IPC, and a trigger's displayed value never changes, so the only
 * writes worth making are the ones that change what the DSP sees. */
_log('\nTest: a trigger writes only when the action actually changes');
{
  const { applyKnobDelta } = await import('../../dist/esm/model/store.js');
  const { triggerVisual, COOL_STEPS } = await import('../../dist/esm/model/trigger.js');
  const TRIG = {
    key: 'capture', label: 'Capture', shortLabel: null, type: 'enum',
    min: 0, max: 1, step: 1, options: ['idle', 'trigger'],
    renderStyle: 'arc', automatable: false, behavior: 'trigger',
  };
  const originalNow = Date.now, originalSet = globalThis.shadow_set_param;
  let now = 20000;
  Date.now = () => now;
  let writes = [];
  globalThis.shadow_set_param = (_s, k, v) => { writes.push(v); return true; };
  const s = {
    port: portFor(0), componentKey: 'synth', knobPage: 0, moduleConfig: null,
    knobParams: [TRIG], knobValues: [0], enumFmt: [true], fileValues: [null],
    slotMapCache: null, paramGestures: {}, triggerStates: {}, dirty: false,
  };

  applyKnobDelta(s, 0, -1);
  eq('counter-clockwise while armed writes nothing', writes.length, 0);

  writes = [];
  applyKnobDelta(s, 0, 1);
  eq('clockwise while armed fires', JSON.stringify(writes), JSON.stringify(['1']));

  writes = [];
  now += 100;
  applyKnobDelta(s, 0, 1);
  eq('clockwise while cooling writes nothing', writes.length, 0);
  eq('...and restarts the drain', triggerVisual(s, 'capture').coolSteps, COOL_STEPS);

  writes = [];
  applyKnobDelta(s, 0, -1);
  eq('counter-clockwise while cooling sends idle', JSON.stringify(writes), JSON.stringify(['0']));
  eq('...and re-arms', triggerVisual(s, 'capture').phase, 'armed');

  Date.now = originalNow;
  globalThis.shadow_set_param = originalSet;
}

/* The drain is what makes the re-arm debounce visible. Quantising it means the
 * badge repaints ~8 times per cooldown instead of once per tick (~70). */
_log('\nTest: the cooldown drain empties in COOL_STEPS quantised steps');
{
  const { applyKnobDelta } = await import('../../dist/esm/model/store.js');
  const { triggerVisual, COOL_STEPS } = await import('../../dist/esm/model/trigger.js');
  const { TRIGGER_REARM_MS, TRIGGER_FLASH_MS } = await import('../../dist/esm/model/constants.js');
  const TRIG = {
    key: 'capture', label: 'Capture', shortLabel: null, type: 'enum',
    min: 0, max: 1, step: 1, options: ['idle', 'trigger'],
    renderStyle: 'arc', automatable: false, behavior: 'trigger',
  };
  const originalNow = Date.now, originalSet = globalThis.shadow_set_param;
  let now = 30000;
  Date.now = () => now;
  globalThis.shadow_set_param = () => true;
  const s = {
    port: portFor(0), componentKey: 'synth', knobPage: 0, moduleConfig: null,
    knobParams: [TRIG], knobValues: [0], enumFmt: [true], fileValues: [null],
    slotMapCache: null, paramGestures: {}, triggerStates: {}, dirty: false,
  };
  const firedAt = now;
  applyKnobDelta(s, 0, 1);

  const seen = [];
  for (let t = TRIGGER_FLASH_MS; t < TRIGGER_REARM_MS; t += 10) {
    now = firedAt + t;
    seen.push(triggerVisual(s, 'capture').coolSteps);
  }
  const distinct = [...new Set(seen)];
  const sorted = [...seen].every((v, i) => i === 0 || v <= seen[i - 1]);
  eq('drain never increases while cooling', sorted, true);
  eq('drain uses at most COOL_STEPS levels', distinct.length <= COOL_STEPS, true);
  eq('drain stays within 1..COOL_STEPS', distinct.every(v => v >= 1 && v <= COOL_STEPS), true);

  now = firedAt + TRIGGER_REARM_MS + 1;
  eq('drain reaches armed at the end of the window', triggerVisual(s, 'capture').phase, 'armed');

  Date.now = originalNow;
  globalThis.shadow_set_param = originalSet;
}

/* A module can already hold the param at `trigger` when movy loads — a latching
 * module, or a restored preset. Assuming ARMED there would write `trigger` to a
 * param already at `trigger`: no edge, no action, but a FIRED flash. movy must
 * not write `idle` to normalise it either — smack's `arm` is "arm-and-record"
 * and holds real module state. So show it latched and let the user turn back. */
_log('\nTest: a trigger already at trigger on load starts latched, not armed');
{
  const { triggerVisual } = await import('../../dist/esm/model/trigger.js');
  const preset = {
    'synth:name': 'seedmod', 'synth_module': 'seedmod',
    'synth:chain_params': JSON.stringify([
      { key: 'capture', name: 'Capture', type: 'enum', options: ['idle', 'trigger'] },
    ]),
    'synth:capture': 'trigger',
  };
  const originalSet = globalThis.shadow_set_param;
  const writes = [];
  const m = bootModel(preset);
  for (let i = 0; i < 6; i++) m.tick();
  globalThis.shadow_set_param = (_s, k, v) => { writes.push([k, v]); return true; };

  eq('load wrote nothing to normalise the param', writes.length, 0);

  m.handleKnobDelta(0, 1); m.tick();
  eq('clockwise does not fire a param already at trigger',
    writes.filter(([k]) => k === 'synth:capture').length, 0);

  m.handleKnobDelta(0, -1); m.tick();
  eq('counter-clockwise re-arms it',
    JSON.stringify(writes.filter(([k]) => k === 'synth:capture')),
    JSON.stringify([['synth:capture', 'idle']]));

  globalThis.shadow_set_param = originalSet;
}

/* A hierarchy reload fires ~1s after a module loads, as pollModuleName settles —
 * exactly when a user first reaches for the knob. Wiping the latch there fires a
 * destructive action twice (observed on device as 4 rapid detents -> 2 fires).
 * A reload of the SAME module must preserve the gesture; a different module must
 * not inherit the previous one's latch. */
_log('\nTest: a latched trigger survives a same-module reload but not a module change');
{
  const trigPreset = (mod) => ({
    'synth:name': mod, 'synth_module': mod,
    'synth:chain_params': JSON.stringify([
      { key: 'capture', name: 'Capture', type: 'enum', options: ['idle', 'trigger'] },
    ]),
    'synth:capture': '0',
  });
  const originalSet = globalThis.shadow_set_param;
  const fires = () => writes.filter(([k, v]) => k === 'synth:capture' && v !== '0').length;
  let writes = [];

  /* The model buffers knob deltas and applies them on the next tick, so every
   * turn needs a tick to actually reach the param. */
  const turn = (d) => { m.handleKnobDelta(0, d); m.tick(); };

  const m = bootModel(trigPreset('trigmod'));
  globalThis.shadow_set_param = (_s, k, v) => { writes.push([k, v]); return true; };
  turn(1);
  eq('fires on the first clockwise turn', fires(), 1);

  m.reload(); m.tick(); m.tick();          // same module reloads
  turn(1);
  eq('same-module reload keeps it latched', fires(), 1);

  env.setParams(trigPreset('othermod'));   // a different module loads
  m.reload(); m.tick(); m.tick();
  writes = [];
  turn(1);
  eq('a module change re-arms it', fires(), 1);

  globalThis.shadow_set_param = originalSet;
}

}
