/* browser-test/logic/knob-input.mjs — knob input that is still movy's: the
 * enum wire-format probe, where a module's own layout file is looked for, the
 * global-bank automation guard, and the detent accumulator movy's own pages
 * share with Schwung's virtual cells (SP-57).
 *
 * Run by browser-test/logic.mjs.
 */

import { enumUsesIndex, MOCK_SYNTHS, eq, bootModel, _log } from './harness.mjs';

export async function run() {
_log('\nTest: enum value format helpers');

{
    const div = ["1/4.", "1/4", "1/4T", "1/8.", "1/8", "1/8T", "1/16.", "1/16", "1/16T", "1/32"];
    eq('usesIndex: known name → false',    enumUsesIndex(div, "1/8."),  false);
    eq('usesIndex: numeric → true',        enumUsesIndex(div, "2"),     true);
    eq('usesIndex: null → true (legacy)',  enumUsesIndex(div, null),    true);
}

_log('\nTest: self-describing layouts resolve from every chain component category');
{
  const { loadModuleConfig } = await import('../../dist/esm/modules/loader.js');
  const originalRead = globalThis.host_read_file;
  const reads = [];
  globalThis.host_read_file = (path) => { reads.push(path); return null; };
  loadModuleConfig('voice-layout', 'synth');
  loadModuleConfig('fx-layout', 'fx1');
  loadModuleConfig('master-layout', 'mfx:fx1');
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

/* ── SP-57 H2/H3: the feel of movy's OWN pages ───────────────────────────── */

_log('\nTest: virtual-page knob feel (SP-57)');

{
    const { countDetents } = await import('../../dist/esm/seq/detent.js');
    /* THE ACCUMULATOR IS `seq/detent.ts`, REUSED rather than restated — the
     * remainder carrying across CC events is the whole point, and a second
     * implementation of that rule is how two knobs come to feel different. */
    const accum = [];
    eq('8 raw units are one detent', countDetents(accum, 0, 8, 8), 1);
    eq('4 + 4 is one detent, the remainder carried',
       countDetents(accum, 1, 4, 8) + countDetents(accum, 1, 4, 8), 1);
    eq('7 raw units are none of one', countDetents(accum, 2, 7, 8), 0);
    eq('and the direction survives the division', countDetents(accum, 3, -8, 8), -1);
}
_log('\nTest: worn-encoder direction filter (schwung #658), opt-in');
{
    const kd = await import('../../dist/esm/midi/knob-direction.js');
    const FLAG = '/data/UserData/schwung/knob_direction_filter';
    const exists = globalThis.host_file_exists, read = globalThis.host_read_file;
    const CW = [0xB0, 71, 1], CCW = [0xB0, 71, 127];
    globalThis.host_file_exists = () => false;
    kd.loadKnobDirectionFilter();
    eq('no flag file: every count passes', kd.knobDirectionHeld(CCW), false);
    globalThis.host_file_exists = (p) => p === FLAG;
    globalThis.host_read_file = (p) => (p === FLAG ? '1' : null);
    kd.loadKnobDirectionFilter();
    eq('a knob the file does not list passes', kd.knobDirectionHeld([0xB0, 72, 127]), false);
    eq('a touch is never held', kd.knobDirectionHeld([0x90, 0, 127]), false);
    const held = [];
    for (let i = 0; i < 8; i++) held.push(kd.knobDirectionHeld(CW));
    eq('a new touch commits only once 8 counts agree',
       held.join(), 'true,true,true,true,true,true,true,false');
    eq('then a wrong-way count is held back', kd.knobDirectionHeld(CCW), true);
    eq('and the accepted way passes', kd.knobDirectionHeld(CW), false);
    kd.knobDirectionHeld([0x90, 0, 127]);
    eq('a fresh touch starts the commit over', kd.knobDirectionHeld(CW), true);
    globalThis.host_file_exists = exists;
    globalThis.host_read_file = read;
    kd.loadKnobDirectionFilter();
}
}
