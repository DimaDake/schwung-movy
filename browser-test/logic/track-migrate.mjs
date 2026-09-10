/* browser-test/logic/track-migrate.mjs — the one-time migration off schwung slots
 *
 * Run by browser-test/logic.mjs.
 */

import { installMockFs, uninstallMockFs, writePrefFlag, eq, ok, _log } from './harness.mjs';


/* A slot-addressed param store for the migration suites.
 *
 * env.mjs's mock is slot-aware, but several suites delete `shadow_set_param`
 * outright and never restore it, so the ambient globals cannot be relied on by
 * a suite this far down the run. These install and restore their own. */
let slotParams = {};
let prevGet;
let prevSet;

function installSlotMock() {
  slotParams = {};
  prevGet = globalThis.shadow_get_param;
  prevSet = globalThis.shadow_set_param;
  globalThis.shadow_get_param = (s, k) => slotParams[s + '|' + k] ?? null;
  globalThis.shadow_set_param = (s, k, v) => { slotParams[s + '|' + k] = v; return true; };
}

function uninstallSlotMock() {
  if (prevGet) globalThis.shadow_get_param = prevGet; else delete globalThis.shadow_get_param;
  if (prevSet) globalThis.shadow_set_param = prevSet; else delete globalThis.shadow_set_param;
}

const seed = (slot, pairs) => {
  for (const [k, v] of Object.entries(pairs)) globalThis.shadow_set_param(slot, k, v);
};

/* EVERY component, not just the synth: a leftover fx1 keeps the signature
 * non-empty, and the "stable empty rack" case would then never happen. */
const clearSlots = () => {
  for (let s = 0; s < 4; s++) {
    for (const c of ['midi_fx1', 'synth', 'fx1', 'fx2', 'fx3', 'fx4']) {
      globalThis.shadow_set_param(s, c + '_module', '');
    }
    globalThis.shadow_set_param(s, 'slot:volume', '');
  }
};

export async function run() {

{
  _log('\nlegacy host — which host a set USED to be on:');
  const { legacySetWasSchwung } = await import('../../dist/esm/track/legacy-host.js');

  installMockFs();

  /* The shipped global mode was NEW SETS (2): the set's own value decides. */
  writePrefFlag('chtracks', 2);
  eq('set says schwung', legacySetWasSchwung({ chtrackset: 0 }), true);
  eq('set says movy', legacySetWasSchwung({ chtrackset: 1 }), false);
  /* A flags object WITHOUT the key is a set saved before the field existed —
   * `legacy: 0` in the old flag def, i.e. the schwung slots it was built on. */
  eq('flags object without the key is legacy schwung',
     legacySetWasSchwung({ setcommit: 1 }), true);
  /* No blob at all: a brand-new set OR a set duplicated in Move. The spec makes
   * both candidates, because they are indistinguishable until the probe runs. */
  eq('no blob is treated as schwung', legacySetWasSchwung(null), true);

  /* An explicit global mode overrides the set's value in BOTH directions. */
  writePrefFlag('chtracks', 0);
  eq('global SCHWUNG beats a movy set', legacySetWasSchwung({ chtrackset: 1 }), true);
  writePrefFlag('chtracks', 1);
  eq('global MOVY beats a schwung set', legacySetWasSchwung({ chtrackset: 0 }), false);

  /* A device that never opened the page has no stored value at all: the
   * shipped default was NEW SETS, so the set's own value decides. A fresh mock
   * fs is how you get a prefs.json with no `chtracks` in it. */
  uninstallMockFs(); installMockFs();
  eq('absent global falls back to NEW SETS', legacySetWasSchwung({ chtrackset: 1 }), false);
  eq('absent global still reads the set', legacySetWasSchwung({ chtrackset: 0 }), true);

  uninstallMockFs();
}

{
  _log('\nslot read — what movy can see in a schwung slot:');
  const { readSlotChain, slotSignature } = await import('../../dist/esm/track/slot-read.js');

  /* Its OWN slot store, not env.mjs's. Several suites `delete
   * globalThis.shadow_set_param` and never put it back, so a suite that leans
   * on the ambient mock passes or explodes depending on what ran before it. */
  installSlotMock();

  clearSlots();
  seed(0, {
    'synth_module': 'plaits', 'synth:state': 'BLOB-A',
    'fx1_module': 'mverb',   'fx1:state': 'BLOB-B',
    'slot:volume': '0.5000',
    'lfo1:target': 'synth', 'lfo1:target_param': 'cutoff', 'lfo1:enabled': '1',
  });
  seed(1, { 'synth_module': 'mrdrums', 'fx3_module': 'psxverb' });

  const a = readSlotChain(0);
  eq('slot 0 component count', a.comp.length, 2);
  eq('slot 0 synth module', a.comp[0].c + '=' + a.comp[0].m, 'synth=plaits');
  eq('slot 0 synth blob', a.comp[0].s, 'BLOB-A');
  eq('slot 0 fx1 module', a.comp[1].c + '=' + a.comp[1].m, 'fx1=mverb');
  eq('slot 0 volume', a.volume, 0.5);
  ok('slot 0 packed its LFOs', Array.isArray(a.lfo) && a.lfo.length > 0);
  eq('slot 0 has no leftovers', a.leftovers.length, 0);

  const b = readSlotChain(1);
  eq('slot 1 migrates the synth', b.comp.length, 1);
  eq('slot 1 reports the leftover', b.leftovers.join(','), 'fx3');
  /* The read is per-slot. Before the mock knew about slots this whole block
   * passed while every slot returned slot 0's answer. */
  eq('slot 1 is not slot 0', b.comp[0].m, 'mrdrums');

  /* An empty slot is empty — not an error, and not a component list of one. */
  eq('slot 2 is empty', readSlotChain(2).comp.length, 0);

  /* A module that is present but whose blob will not read is the failure worth
   * naming: migrating it silently would ship a track at factory defaults. */
  seed(3, { 'synth_module': 'obxd', 'synth:state': '' });
  const c = readSlotChain(3);
  eq('unreadable blob is reported', c.unreadable.join(','), 'synth:state');

  const sig = slotSignature();
  ok('signature names every slot', sig.split(';').length === 4);
  clearSlots();
  ok('an empty rack signs differently', slotSignature() !== sig);

  uninstallSlotMock();
}

}
