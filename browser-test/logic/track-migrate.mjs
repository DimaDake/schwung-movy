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

{
  _log('\nmigration plan — what crosses, and what is reported:');
  const { planMigration } = await import('../../dist/esm/track/migrate-plan.js');

  const slot = (n, over) => ({
    slot: n, comp: [{ c: 'synth', m: 'plaits', s: 'BLOB' }],
    volume: 0.5, leftovers: [], unreadable: [], ...over,
  });

  const r = planMigration([slot(0), slot(1)], [], false);
  eq('two tracks migrate', r.migrated.join(','), '0,1');
  eq('chain state carries the track index', r.chains[0].t, 0);
  eq('chain state carries the component', r.chains[0].comp[0].c, 'synth');
  eq('chain state carries the blob', r.chains[0].comp[0].s, 'BLOB');
  /* slot:volume is a linear amplitude with unity at 1.0, exactly like the
   * mixer's gain field — so it maps straight onto the gain and the other
   * mixer fields keep their defaults. */
  ok('level became a mix value', typeof r.chains[0].mix === 'string'
     && r.chains[0].mix.startsWith('0.5000,0.0000,0'));
  eq('no warnings', r.warnings.length, 0);

  /* Unity is the mixer's default, and a default is not written into a set. */
  eq('a slot at unity writes no mix value',
     planMigration([slot(0, { volume: 1 })], [], false).chains[0].mix, undefined);

  /* THE guard: automatic migration never writes over a chain the set carries. */
  const occupied = [{ t: 0, comp: [{ c: 'synth', m: 'obxd' }] }];
  const g = planMigration([slot(0), slot(1)], occupied, false);
  eq('an occupied chain is skipped', g.skipped.join(','), '0');
  eq('only the free track migrates', g.migrated.join(','), '1');
  eq('the occupied chain is left alone', g.chains.length, 1);

  /* …and the manual row is the one thing that may. */
  const o = planMigration([slot(0)], occupied, true);
  eq('overwrite takes the occupied track', o.migrated.join(','), '0');
  eq('overwrite replaces the module', o.chains[0].comp[0].m, 'plaits');

  /* Leftovers and unreadable keys are reported, and do not stop the migration:
   * the schwung slot is never cleared, so what stayed behind is not lost. */
  const w = planMigration([slot(0, { leftovers: ['fx3'], unreadable: ['synth:state'] })], [], false);
  eq('the track still migrated', w.migrated.join(','), '0');
  eq('both problems are reported', w.warnings.length, 2);
  ok('a warning names the track', w.warnings.every((x) => x.includes('track 1')));
  ok('a warning names the position', w.warnings.some((x) => x.includes('fx3')));
  ok('a warning names the key', w.warnings.some((x) => x.includes('synth:state')));

  /* An empty slot is not a migration and must not count as one — otherwise
   * "migrated 0 tracks" and "found nothing" become the same answer. */
  const e = planMigration([slot(0, { comp: [] })], [], false);
  eq('an empty slot migrates nothing', e.migrated.length, 0);
  eq('an empty slot warns about nothing', e.warnings.length, 0);
}

{
  _log('\nmigration state machine — candidacy, stability, budget:');
  const M = await import('../../dist/esm/track/migrate.js');

  installMockFs(); writePrefFlag('chtracks', 2);
  installSlotMock();
  const seedSlot = (n, mod) => seed(n, { 'synth_module': mod });

  /* Already migrated: the marker ends it before a single slot is read. */
  clearSlots(); seedSlot(0, 'plaits');
  M.resetMigration();
  M.beginMigration({ chtrackset: 0 }, M.MIGRATION_VERSION, []);
  eq('a marked set resolves at once', M.migrationTick(0), true);
  eq('a marked set migrates nothing', M.migrationResult(), null);

  /* A set that was already on movy chains is not a candidate. */
  M.resetMigration();
  M.beginMigration({ chtrackset: 1 }, undefined, []);
  eq('a movy set resolves at once', M.migrationTick(0), true);
  eq('a movy set migrates nothing', M.migrationResult(), null);
  eq('a movy set is still marked', M.migrationMarker(), M.MIGRATION_VERSION);

  /* A candidate needs TWO matching non-empty reads. One is not enough: schwung
   * clears every slot before it reloads them, so a single read can catch the
   * rack mid-swap and migrate half a set. */
  M.resetMigration();
  M.beginMigration({ chtrackset: 0 }, undefined, []);
  eq('first probe does not resolve', M.migrationTick(0), false);
  eq('a re-probe inside the interval is ignored', M.migrationTick(10), false);
  eq('second matching probe resolves', M.migrationTick(1000), true);
  eq('it migrated the seeded slot', M.migrationResult().migrated.join(','), '0');

  /* A rack that CHANGES between probes is still loading — keep waiting. */
  M.resetMigration();
  M.beginMigration({ chtrackset: 0 }, undefined, []);
  M.migrationTick(0);
  seedSlot(1, 'mrdrums');
  eq('a changed signature does not resolve', M.migrationTick(1000), false);
  eq('two matching reads then resolve', M.migrationTick(2000), true);
  eq('both tracks came across', M.migrationResult().migrated.join(','), '0,1');

  /* An all-empty rack, stable, is a legitimate "nothing to migrate" — and it
   * must still mark the set, or it re-probes on every open forever. */
  clearSlots();
  M.resetMigration();
  M.beginMigration({ chtrackset: 0 }, undefined, []);
  M.migrationTick(0);
  eq('a stable empty rack resolves', M.migrationTick(1000), true);
  eq('nothing to migrate is not a result', M.migrationResult(), null);
  eq('nothing to migrate still marks the set', M.migrationMarker(), M.MIGRATION_VERSION);

  /* The budget must END. A rack that never stops changing is a set that would
   * otherwise sit on the splash forever. */
  M.resetMigration();
  M.beginMigration({ chtrackset: 0 }, undefined, []);
  let ticks = 0, at = 0, resolved = false;
  while (!resolved && ticks < 50) {
    seedSlot(0, 'mod' + ticks);
    resolved = M.migrationTick(at);
    at += 1000; ticks++;
  }
  ok('the budget ends the wait', resolved && ticks <= 10);
  eq('an exhausted budget still marks the set', M.migrationMarker(), M.MIGRATION_VERSION);

  /* The manual action needs no stability wait: the set is ready, so schwung's
   * slots are settled by definition. */
  clearSlots(); seedSlot(2, 'plaits');
  const man = M.runManualMigration([{ t: 2, comp: [{ c: 'synth', m: 'obxd' }] }]);
  eq('manual overwrites an occupied chain', man.migrated.join(','), '2');

  uninstallSlotMock();
  uninstallMockFs();
}

}
