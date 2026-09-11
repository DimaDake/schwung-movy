# Movy Track Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire schwung-hosted tracks entirely — tracks 0-15 all become movy chains, with a one-time per-set migration on set load that carries a schwung slot's modules, presets, LFOs and level across, plus a manual Settings row that re-runs it.

**Architecture:** A new `src/track/migrate*.ts` group reads schwung's slots 0-3 through the surviving `HostSlotPort`, builds `ChainTrackState[]` in exactly the shape `restoreChains` already consumes, and merges them into the single chain-set document the set load already sends. It runs only behind the loading splash. Once it works, the two-host machinery (`chtracks`, `chtrackset`, `trackKind`, `HOST_TRACKS`, the engine's `movy_tracks`) is deleted.

**Tech Stack:** TypeScript (esbuild → `ui.js`, QuickJS on device), Rust (`engine/`, `cdylib` → `dsp.so`), Node test suites in `browser-test/`, bash device suites in `scripts/`.

**Spec:** `docs/superpowers/specs/2026-09-10-movy-track-migration-design.md` — read it before Task 1. Every task argues from it.

## Global Constraints

- **File size: hard limit 200 lines** per `src/` file, target 50-100. `browser-test/` ceiling ~600.
- **Comments explain WHY** (constraints, invariants, workarounds) — never WHAT the code literally does.
- **`model/` never calls display functions. `renderer/` has no state. `src/types/` imports nothing from the rest of `src/`.**
- **`ENGINE_VERSION` must match** between `engine/crates/movy-dsp/src/lib.rs` and `src/seq/constants.ts`. Bump it **once** for this whole plan (Task 8), never twice.
- **A redeployed `dsp.so` does not hot-reload** — `deploy.sh` restarts the stack on an md5 change, and the restart must run as root.
- **Local test gate, every task:** `npm test` (builds + runs all eight suites) must report 0 failures. If UI rendering changed: `node browser-test/screenshot.mjs --update` first. If `engine/` changed: `(cd engine && cargo test)`.
- **Prove a new test has teeth:** remove the fix, watch the test fail, put the fix back. A zero count is not evidence.
- **Never `git add -A`.** Add the named files only.
- Commit trailer:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  ```
- **Device tests are flaky.** Run the relevant suite once. If it fails, check for a real regression in what you changed; otherwise report it and move on. If `move.local` is unreachable, **report DEVICE OFFLINE to the user in CAPS**.

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `src/track/legacy-host.ts` | Reads the two dead flag values (`chtracks` from prefs.json, `chtrackset` from a set blob) and resolves which host a set *used to* be on. The only survivor of the flag, marked deletable. |
| `src/track/slot-read.ts` | **The one place that reads a schwung slot.** A future schwung rename has exactly one file to fix. |
| `src/track/migrate-plan.ts` | Pure: slot reads + already-restored chains → `ChainTrackState[]` + warnings. No I/O. |
| `src/track/migrate.ts` | The state machine: candidacy, probe/retry/settle budget, marker, log lines. |
| `browser-test/logic/track-migrate.mjs` | Local suite for all four of the above. |
| `scripts/test-migrate.sh` | Device suite: contract canary, positive, negative control, manual row. |

**Modified:** `src/seq/ui-state.ts` (marker + held document), `src/seq/set-settle.ts` + `set-session.ts` (settle gate), `src/renderer/loading-view.ts` (splash text), `src/seq/flags-page-vm.ts` + `flags-page.ts` + `src/midi/router.ts` (second action row), `src/track/ref.ts` / `registry.ts` / `chain-persist.ts` / `chain-payload.ts`, `src/mixer/*`, `src/seq/drum-sync.ts` / `cpu-page-vm.ts` / `flags*.ts`, `src/lfo/scope.ts`, `src/undo/param-sync.ts`, `engine/crates/movy-dsp/src/lib.rs`, `browser-test/harness.mjs` (slot-aware mock), `scripts/lib/test-set.sh`, `scripts/test-all-device.sh`.

**Deleted:** `src/track/host-mode.ts`, `scripts/test-all-device-schwung.sh`, `scripts/test-all-device-movy.sh`.

**Renamed:** `src/track/host-port.ts` → `src/track/shim-port.ts`.

---

### Task 1: Legacy host resolution

The candidacy rule needs to know which host a set *used to* be on, and it must keep working after the flags are deleted in Task 7. So it reads the raw stored numbers, not `flagValue()`.

**Files:**
- Create: `src/track/legacy-host.ts`
- Create: `browser-test/logic/track-migrate.mjs`
- Modify: `browser-test/logic.mjs` (register the suite — **two** lists: the import at the top, and the run list around line 114)

**Interfaces:**
- Produces: `legacySetWasSchwung(blobFlags: Record<string, unknown> | null | undefined): boolean`

- [x] **Step 1: Write the failing test**

Create `browser-test/logic/track-migrate.mjs`:

```javascript
/* browser-test/logic/track-migrate.mjs — the one-time migration off schwung slots
 *
 * Run by browser-test/logic.mjs.
 */

import { installMockFs, uninstallMockFs, writePrefFlag, eq, ok, _log } from './harness.mjs';

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

}
```

Register it in `browser-test/logic.mjs` — add next to the other `tracks-*` imports:

```javascript
import { run as run_track_migrate } from './logic/track-migrate.mjs';
```

and add `run_track_migrate,` to the run list beside `run_tracks_chain,`.

- [x] **Step 2: Run test to verify it fails**

Run: `npm run build:browser && node browser-test/logic.mjs 2>&1 | tail -20`
Expected: FAIL — cannot resolve `dist/esm/track/legacy-host.js`.

- [x] **Step 3: Write minimal implementation**

Create `src/track/legacy-host.ts`:

```typescript
/* Which host a set USED to be on.
 *
 * The last remnant of `chtracks`/`chtrackset`. It reads the raw stored numbers
 * rather than going through `flags.ts`, because the flags themselves are gone —
 * what is left on disk is the only record of how a set was built, and it is the
 * only thing that says whether a set has instruments waiting in schwung's slots.
 *
 * DELETABLE once the fleet has turned over: every set that has ever been opened
 * by a build carrying this carries a `migv` marker afterwards, so this answer is
 * only ever needed once per set. Delete the file, delete `readPrefFlags`'s last
 * caller for `chtracks`, and every set is simply already migrated. */

import { readPrefFlags } from '../seq/prefs.js';

/* The three values the deleted `chtracks` ordinal could take. */
const HOST_SCHWUNG = 0;
const HOST_MOVY = 1;
const HOST_NEW_SETS = 2;

/** True when tracks 1-4 of this set were schwung shadow slots — i.e. the set may
 *  have instruments that movy can no longer reach.
 *
 *  `o` is the `flags` object out of the set's ui-state blob, or null/undefined
 *  for a set with no blob at all. **A set with no blob answers TRUE**, even
 *  though the shipped default was MOVY: a set DUPLICATED in Move also arrives
 *  without one, and schwung has copied the original's slots into it. Trusting
 *  the default there strands the copy on a host that no longer exists. A
 *  genuinely new set answers true too and simply finds nothing. */
export function legacySetWasSchwung(o: Record<string, unknown> | null | undefined): boolean {
    const mode = storedMode();
    if (mode === HOST_MOVY) return false;
    if (mode === HOST_SCHWUNG) return true;
    /* NEW SETS: the set's own value decides. Absent means a blob written before
     * the field existed, which kept the schwung slots it was built on — the old
     * flag def spelled that `legacy: 0`. */
    if (!o || typeof o['chtrackset'] !== 'number') return true;
    return (o['chtrackset'] as number) <= 0;
}

/** The stored global mode, defaulting to what shipped. */
function storedMode(): number {
    const v = readPrefFlags()['chtracks'];
    return typeof v === 'number' && isFinite(v) ? Math.round(v) : HOST_NEW_SETS;
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npm run build:browser && node browser-test/logic.mjs 2>&1 | tail -20`
Expected: PASS, 0 failures.

- [x] **Step 5: Prove the test has teeth**

Temporarily change `if (!o || typeof o['chtrackset'] !== 'number') return true;` to `return false;`. Re-run — the "flags object without the key" and "no blob" assertions must fail. Put it back.

- [x] **Step 6: Commit**

```bash
git add src/track/legacy-host.ts browser-test/logic/track-migrate.mjs browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
feat(migrate): what host a set used to be on, read from what is left on disk

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Reading a schwung slot

**The one file that reads a schwung slot.** Everything a future schwung rename could break is here, and it reports which key failed rather than returning an empty result.

The browser harness's `shadow_get_param` currently **ignores the slot argument** (`browser-test/harness.mjs:36`), so every slot would read alike and this task's tests would pass while testing nothing. Fixing that mock is part of this task.

**Files:**
- Create: `src/track/slot-read.ts`
- Modify: `browser-test/harness.mjs:36-37` (slot-aware mock)
- Modify: `browser-test/logic/track-migrate.mjs`

**Interfaces:**
- Consumes: `persistableComponents()` from `./chain-persist.js`, `moduleReadKey()` from `../chain/config.js`, `hostPort()` from `./registry.js`, `lfoStateKeys()`/`packLfoState()` from `./lfo-persist.js`
- Produces:
  ```typescript
  export interface SlotComponent { c: string; m: string; s?: string }
  export interface SlotChain {
      slot: number;
      comp: SlotComponent[];
      lfo?: string[];
      volume: number | null;
      /** Chain positions movy's UI cannot show that hold a module ('fx3', …). */
      leftovers: string[];
      /** Keys that read back null when a module was present. */
      unreadable: string[];
  }
  export function readSlotChain(slot: number): SlotChain
  export function slotSignature(): string
  export const EXTRA_POSITIONS: string[]
  ```

- [x] **Step 1: Make the mock slot-aware**

In `browser-test/harness.mjs`, replace lines 36-37:

```javascript
globalThis.shadow_get_param   = (slot, key) =>
    mockState[slot + '|' + key] ?? mockState[key] ?? null;
globalThis.shadow_set_param   = (slot, key, val) => {
    mockState[slot + '|' + key] = val; mockState[key] = val; return true;
};
```

The `?? mockState[key]` fallback keeps every existing suite working — they seed bare keys and read slot 0.

- [x] **Step 2: Write the failing test**

Append to `run()` in `browser-test/logic/track-migrate.mjs`:

```javascript
{
  _log('\nslot read — what movy can see in a schwung slot:');
  const { readSlotChain, slotSignature } = await import('../../dist/esm/track/slot-read.js');

  const seed = (slot, pairs) => {
    for (const [k, v] of Object.entries(pairs)) globalThis.shadow_set_param(slot, k, v);
  };
  const clearSlots = () => {
    for (let s = 0; s < 4; s++) {
      for (const c of ['midi_fx1', 'synth', 'fx1', 'fx2', 'fx3', 'fx4']) {
        globalThis.shadow_set_param(s, c + '_module', '');
      }
      globalThis.shadow_set_param(s, 'slot:volume', '');
    }
  };

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
  /* The read is per-slot. Before the harness mock knew about slots this whole
   * block passed while every slot returned slot 0's answer. */
  eq('slot 1 is not slot 0', b.comp[0].m, 'mrdrums');

  /* An empty slot is empty — not an error, and not a component list of one. */
  eq('slot 2 is empty', readSlotChain(2).comp.length, 0);

  /* A module that is present but whose blob will not read is the failure worth
   * naming: migrating it silently would ship a track at factory defaults. */
  seed(3, { 'synth_module': 'obxd' });
  globalThis.shadow_set_param(3, 'synth:state', '');
  const c = readSlotChain(3);
  eq('unreadable blob is reported', c.unreadable.join(','), 'synth:state');

  const sig = slotSignature();
  ok('signature names every slot', sig.split(';').length === 4);
  clearSlots();
  ok('an empty rack signs differently', slotSignature() !== sig);
}
```

- [x] **Step 3: Run test to verify it fails**

Run: `npm run build:browser && node browser-test/logic.mjs 2>&1 | tail -20`
Expected: FAIL — cannot resolve `dist/esm/track/slot-read.js`.

- [x] **Step 4: Write the implementation**

Create `src/track/slot-read.ts`:

```typescript
/* Reading a schwung shadow slot — the ONLY place movy does it.
 *
 * The migration is the last thing that talks to schwung's slots, and schwung is
 * a moving target: its chain is a LIST of positions, not a fixed set, and key
 * spellings have been refactored under us before. So every read lives here, and
 * a key that does not answer is REPORTED rather than treated as absence — a
 * migration that quietly reads nothing looks exactly like a set with nothing in
 * it, and the difference is the user's instruments.
 *
 * `scripts/test-migrate.sh`'s contract-canary arm reads these same keys off a
 * real device and fails naming whichever one stopped answering. */

import { persistableComponents } from './chain-persist.js';
import { moduleReadKey } from '../chain/config.js';
import { hostPort } from './registry.js';
import { lfoStateKeys, packLfoState } from './lfo-persist.js';

export interface SlotComponent { c: string; m: string; s?: string }

export interface SlotChain {
    slot: number;
    comp: SlotComponent[];
    lfo?: string[];
    volume: number | null;
    /** Positions holding a module that movy's UI has no place to show. */
    leftovers: string[];
    /** Keys that answered null while their component was present. */
    unreadable: string[];
}

/* Chain positions schwung can hold and movy cannot draw. Probed so the user can
 * be TOLD what did not come across; never migrated. schwung's list is
 * open-ended, so this is a reasonable depth rather than a guarantee — a slot
 * with an fx5 in it is beyond what anyone has built. */
export const EXTRA_POSITIONS = ['fx3', 'fx4'];

/* schwung's own slot fader. Spelled here rather than imported from the mixer:
 * it is a schwung key, and this file is where schwung keys live — the mixer
 * stopped having a second shape for a track's level the moment there was one
 * host. */
const SLOT_VOLUME_KEY = 'slot:volume';

/** The four slots' module ids as one string, for the stability comparison.
 *  Cheap: schwung serves these from its own param cache. */
export function slotSignature(): string {
    const comps = persistableComponents();
    const out: string[] = [];
    for (let slot = 0; slot < 4; slot++) {
        const port = hostPort(slot);
        out.push(comps.map((c) => port.getParam(moduleReadKey(c)) ?? '').join('|'));
    }
    return out.join(';');
}

/** Everything movy can see in one slot. Never throws and never guesses. */
export function readSlotChain(slot: number): SlotChain {
    const port = hostPort(slot);
    const out: SlotChain = { slot, comp: [], volume: null, leftovers: [], unreadable: [] };

    for (const c of persistableComponents()) {
        const m = port.getParam(moduleReadKey(c));
        if (!m) continue;
        const comp: SlotComponent = { c, m };
        /* A module with no preset blob is normal — plenty publish none. A blob
         * that reads as the empty string when the module is loaded is not
         * distinguishable from that, so it is reported and the component still
         * migrates: the module in place at defaults beats no module at all. */
        const s = port.getParam(c + ':state');
        if (s) comp.s = s;
        else out.unreadable.push(c + ':state');
        out.comp.push(comp);
    }

    /* Nothing movy can show means nothing to carry: an empty slot has no level
     * worth migrating and no LFO that could be targeting anything. */
    if (out.comp.length === 0) return out;

    for (const c of EXTRA_POSITIONS) {
        if (port.getParam(moduleReadKey(c))) out.leftovers.push(c);
    }

    const keys = lfoStateKeys();
    const lfo = packLfoState(keys.map((k) => port.getParam(k)));
    if (lfo) out.lfo = lfo;

    const raw = port.getParam(SLOT_VOLUME_KEY);
    const v = raw === null ? NaN : parseFloat(raw);
    out.volume = Number.isFinite(v) ? v : null;

    return out;
}
```

- [x] **Step 5: Run test to verify it passes**

Run: `npm run build:browser && node browser-test/logic.mjs 2>&1 | tail -20`
Expected: PASS, 0 failures.

- [x] **Step 6: Prove the slot-aware mock has teeth**

Temporarily revert `browser-test/harness.mjs` line 36 to `(_slot, key) => mockState[key] ?? null`. Re-run — `slot 1 is not slot 0` must fail. Put the fix back.

- [x] **Step 7: Full local gate and commit**

Run: `npm test` — 0 failures (the mock change touches every suite).

```bash
git add src/track/slot-read.ts browser-test/harness.mjs browser-test/logic/track-migrate.mjs
git commit -m "$(cat <<'EOF'
feat(migrate): one place that reads a schwung slot, and it says what did not answer

The browser harness ignored the slot argument, so every slot read alike.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: The migration plan

Pure function: slot reads plus the chains the set already restored → the `ChainTrackState[]` to merge, and what could not come across. No I/O, no state, so every rule in the spec is directly assertable.

**Files:**
- Create: `src/track/migrate-plan.ts`
- Modify: `browser-test/logic/track-migrate.mjs`

**Interfaces:**
- Consumes: `SlotChain` from `./slot-read.js`, `ChainTrackState` from `./chain-persist.js`
- Produces:
  ```typescript
  export interface MigrationResult {
      chains: ChainTrackState[];   // to merge into restoreChains' input
      migrated: number[];          // track indices carried across
      skipped: number[];           // tracks whose movy chain was already occupied
      warnings: string[];          // human-readable, one per problem
  }
  export function planMigration(
      slots: SlotChain[], existing: ChainTrackState[] | undefined | null, overwrite: boolean,
  ): MigrationResult
  ```

- [x] **Step 1: Write the failing test**

Append to `run()` in `browser-test/logic/track-migrate.mjs`:

```javascript
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
  ok('a warning names the track', w.warnings.every((s) => s.includes('track 1')));
  ok('a warning names the position', w.warnings.some((s) => s.includes('fx3')));
  ok('a warning names the key', w.warnings.some((s) => s.includes('synth:state')));

  /* An empty slot is not a migration and must not count as one — otherwise
   * "migrated 0 tracks" and "found nothing" become the same answer. */
  const e = planMigration([slot(0, { comp: [] })], [], false);
  eq('an empty slot migrates nothing', e.migrated.length, 0);
  eq('an empty slot warns about nothing', e.warnings.length, 0);
}
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm run build:browser && node browser-test/logic.mjs 2>&1 | tail -20`
Expected: FAIL — cannot resolve `dist/esm/track/migrate-plan.js`.

- [x] **Step 3: Write the implementation**

Create `src/track/migrate-plan.ts`:

```typescript
/* Turning what a schwung slot holds into what movy's chain set wants.
 *
 * Pure on purpose: the rules that decide whether a user's instrument crosses
 * over are the part worth asserting exactly, and none of them need a device.
 *
 * The output is `ChainTrackState`, the shape `restoreChains` already takes —
 * so a migrated track travels the same document, the same deferred payload and
 * the same retry as a track restored from the set file. There is no second
 * delivery path to keep in step. */

import type { ChainTrackState } from './chain-persist.js';
import type { SlotChain } from './slot-read.js';
import { defaultMix, packMixValue } from '../mixer/mix-io.js';
import { packMix } from './mix-persist.js';

export interface MigrationResult {
    /** The migrated tracks, to merge into `restoreChains`' input. */
    chains: ChainTrackState[];
    migrated: number[];
    /** Tracks whose movy chain already held something. Automatic only. */
    skipped: number[];
    /** One sentence per problem, for the log and the toast. */
    warnings: string[];
}

/** Plan the migration.
 *
 *  `existing` is what the set's own blob restored — a track already in there is
 *  skipped, because a set that carries its own chain for track 1 is not a set
 *  waiting to be migrated. `overwrite` is the manual Settings action, which is
 *  the one caller allowed past that guard: the two reasons to press it are a
 *  migration that came up partial and a chain since broken by hand, and both
 *  are exactly what the guard would refuse. */
export function planMigration(
    slots: SlotChain[],
    existing: ChainTrackState[] | undefined | null,
    overwrite: boolean,
): MigrationResult {
    const out: MigrationResult = { chains: [], migrated: [], skipped: [], warnings: [] };
    const occupied = new Set<number>();
    for (const c of Array.isArray(existing) ? existing : []) {
        if (c && typeof c.t === 'number' && Array.isArray(c.comp) && c.comp.length > 0) {
            occupied.add(c.t);
        }
    }

    for (const s of slots) {
        /* A slot's index IS the track's, and a track's chain IS its index. */
        const t = s.slot;
        if (s.comp.length === 0) continue;
        if (occupied.has(t) && !overwrite) { out.skipped.push(t); continue; }

        const track: ChainTrackState = { t, comp: s.comp.map((c) => ({ ...c })) };
        if (s.lfo) track.lfo = s.lfo;
        const mix = mixFromVolume(s.volume);
        if (mix) track.mix = mix;
        out.chains.push(track);
        out.migrated.push(t);

        /* Reported, never fatal: the schwung slot is not cleared, so anything
         * that stayed behind is still in Move's own set file. The user is told
         * so a quiet difference does not read as a bug. */
        for (const pos of s.leftovers) {
            out.warnings.push('track ' + (t + 1) + ': ' + pos + ' stayed in schwung');
        }
        for (const key of s.unreadable) {
            out.warnings.push('track ' + (t + 1) + ': ' + key + ' did not read');
        }
    }
    return out;
}

/** schwung's `slot:volume` as movy's mixer value, or undefined at unity.
 *
 *  Both are linear amplitude with unity at 1.0, so the number carries straight
 *  across onto `gain`; pan and the sends have no schwung equivalent and keep
 *  their defaults. `packMix` returns undefined for an all-default value, which
 *  is what keeps an untouched track out of the set file. */
function mixFromVolume(volume: number | null): string | undefined {
    if (volume === null || !isFinite(volume)) return undefined;
    return packMix(packMixValue({ ...defaultMix(), gain: volume }));
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npm run build:browser && node browser-test/logic.mjs 2>&1 | tail -20`
Expected: PASS, 0 failures.

- [x] **Step 5: Prove the guard has teeth**

Temporarily delete `if (occupied.has(t) && !overwrite) { out.skipped.push(t); continue; }`. Re-run — `an occupied chain is skipped` and `the occupied chain is left alone` must fail. Put it back.

- [x] **Step 6: Commit**

```bash
git add src/track/migrate-plan.ts browser-test/logic/track-migrate.mjs
git commit -m "$(cat <<'EOF'
feat(migrate): what crosses from a schwung slot, and what gets reported

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: The migration state machine

Candidacy, the probe budget, and the stability rule that stops movy reading schwung mid-reload.

**Files:**
- Create: `src/track/migrate.ts`
- Modify: `browser-test/logic/track-migrate.mjs`

**Interfaces:**
- Consumes: `legacySetWasSchwung`, `readSlotChain`/`slotSignature`, `planMigration`
- Produces:
  ```typescript
  export const MIGRATION_VERSION = 1;
  export type MigrateState = 'idle' | 'probing' | 'done';
  export function beginMigration(blobFlags, marker: unknown, existing): void
  export function migrationTick(nowMs: number): boolean   // true = resolved
  export function migrationResult(): MigrationResult | null
  export function migrationMarker(): number               // what to persist as `migv`
  export function migrationPending(): boolean
  export function runManualMigration(existing): MigrationResult   // one shot, overwrite
  export function resetMigration(): void
  ```

- [x] **Step 1: Write the failing test**

Append to `run()` in `browser-test/logic/track-migrate.mjs`:

```javascript
{
  _log('\nmigration state machine — candidacy, stability, budget:');
  const M = await import('../../dist/esm/track/migrate.js');

  installMockFs(); writePrefFlag('chtracks', 2);
  const seedSlot = (s, mod) => globalThis.shadow_set_param(s, 'synth_module', mod);
  /* EVERY component, not just the synth: the mock param store persists across
   * these blocks, so an fx1 left over from the slot-read block would keep the
   * signature non-empty and the "stable empty rack" case would never happen. */
  const clear = () => {
    for (let s = 0; s < 4; s++) {
      for (const c of ['midi_fx1', 'synth', 'fx1', 'fx2', 'fx3', 'fx4']) {
        globalThis.shadow_set_param(s, c + '_module', '');
      }
    }
  };

  /* Already migrated: the marker ends it before a single slot is read. */
  clear(); seedSlot(0, 'plaits');
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
  ok('it migrated the seeded slot', M.migrationResult().migrated.join(',') === '0');

  /* A rack that CHANGES between probes is still loading — keep waiting. */
  M.resetMigration();
  M.beginMigration({ chtrackset: 0 }, undefined, []);
  M.migrationTick(0);
  seedSlot(1, 'mrdrums');
  eq('a changed signature does not resolve', M.migrationTick(1000), false);
  eq('two matching reads then resolve', M.migrationTick(2000), true);
  ok('both tracks came across', M.migrationResult().migrated.join(',') === '0,1');

  /* An all-empty rack, stable, is a legitimate "nothing to migrate" — and it
   * must still mark the set, or it re-probes on every open forever. */
  clear();
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
  while (!resolved && ticks < 50) { seedSlot(0, 'mod' + ticks); resolved = M.migrationTick(at); at += 1000; ticks++; }
  ok('the budget ends the wait', resolved && ticks <= 10);
  eq('an exhausted budget still marks the set', M.migrationMarker(), M.MIGRATION_VERSION);

  /* The manual action needs no stability wait: the set is ready, so schwung's
   * slots are settled by definition. */
  clear(); seedSlot(2, 'plaits');
  const man = M.runManualMigration([{ t: 2, comp: [{ c: 'synth', m: 'obxd' }] }]);
  eq('manual overwrites an occupied chain', man.migrated.join(','), '2');

  uninstallMockFs();
}
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm run build:browser && node browser-test/logic.mjs 2>&1 | tail -20`
Expected: FAIL — cannot resolve `dist/esm/track/migrate.js`.

- [x] **Step 3: Write the implementation**

Create `src/track/migrate.ts`:

```typescript
/* The one-time move of tracks 1-4 off schwung's shadow slots.
 *
 * Runs behind the loading splash and nowhere else. A migration that ran against
 * a live surface could race a user's edit, and the splash is the only state in
 * which no gesture reaches the instrument.
 *
 * **The stability rule is the whole file.** schwung reloads a set's slots by
 * clearing all four and then loading each one (shadow_ui.js, SET_CHANGED: pass 1
 * clears, pass 2 load_files), so a single read can land mid-reload and see an
 * empty rack — or half of one. Migrating on that would write a set with its
 * instruments missing, and marking it afterwards would make that permanent. So
 * a rack counts as settled only when two consecutive reads AGREE, and the wait
 * has a budget: the splash must end.
 *
 * Marking a set that could not be migrated is deliberate (see the spec). Nothing
 * is destroyed by it — the schwung slot is never cleared, so the patch is still
 * in Move's own set file. Leaving the set unmarked instead would re-probe it on
 * every open for the rest of its life. */

import { legacySetWasSchwung } from './legacy-host.js';
import { readSlotChain, slotSignature, type SlotChain } from './slot-read.js';
import { planMigration, type MigrationResult } from './migrate-plan.js';
import type { ChainTrackState } from './chain-persist.js';
import { mlog } from '../log.js';

/** The `migv` value this build writes. A set carrying it is never probed again. */
export const MIGRATION_VERSION = 1;

/* Wall-clock, not ticks: the device tick rate swings 63-205 Hz with load, so a
 * tick count is not a duration. Six probes at 250 ms is ~1.5 s inside a splash
 * that already waits seconds for modules to load. */
const PROBE_MS = 250;
const MAX_PROBES = 6;

type State = 'idle' | 'probing' | 'done';

let state: State = 'idle';
let existingChains: ChainTrackState[] | null = null;
let result: MigrationResult | null = null;
let lastSig = '';
let probes = 0;
let nextAt = 0;

export function resetMigration(): void {
    state = 'idle'; existingChains = null; result = null;
    lastSig = ''; probes = 0; nextAt = 0;
}

/** Start the migration for the set being loaded.
 *
 *  `marker` is the blob's `migv` field, `blobFlags` its `flags` object, and
 *  `existing` the chains the blob itself restored — a track already in there is
 *  the set's own and is never written over. */
export function beginMigration(
    blobFlags: Record<string, unknown> | null | undefined,
    marker: unknown,
    existing: ChainTrackState[] | undefined | null,
): void {
    resetMigration();
    if (typeof marker === 'number' && marker >= MIGRATION_VERSION) { state = 'done'; return; }
    if (!legacySetWasSchwung(blobFlags)) {
        /* Not a candidate, but still marked: a set that never had schwung
         * tracks has nothing to find, and saying so once is cheaper than
         * asking again on every open. */
        state = 'done';
        return;
    }
    existingChains = Array.isArray(existing) ? existing : [];
    state = 'probing';
}

/** True when the migration has resolved and the chain document may go out.
 *  Call once per tick while the splash is up; `nowMs` is `Date.now()`. */
export function migrationTick(nowMs: number): boolean {
    if (state !== 'probing') return true;
    if (probes > 0 && nowMs < nextAt) return false;
    nextAt = nowMs + PROBE_MS;
    probes++;

    const sig = slotSignature();
    const empty = /^[|;]*$/.test(sig);
    /* Two consecutive AGREEING reads. An empty rack agreeing with itself is a
     * real answer — a set whose slots hold nothing — and gets the same
     * treatment as a full one: resolve, and mark. */
    if (sig === lastSig) {
        if (!empty) finish(collect());
        else { mlog('mig: nothing to migrate'); finish(null); }
        return true;
    }
    lastSig = sig;

    if (probes >= MAX_PROBES) {
        /* The rack would not settle. Marked anyway, and said out loud: the
         * splash must end, and nothing has been lost — the slots still hold
         * what they held. */
        mlog('mig: schwung slots NEVER SETTLED after ' + probes
            + ' probes — tracks 1-4 not migrated');
        finish(null);
        return true;
    }
    return false;
}

function collect(): MigrationResult {
    const slots: SlotChain[] = [];
    for (let s = 0; s < 4; s++) slots.push(readSlotChain(s));
    const r = planMigration(slots, existingChains, false);
    mlog('mig: migrated ' + r.migrated.length + ' track(s)'
        + (r.skipped.length ? ', skipped ' + r.skipped.length : '')
        + (r.warnings.length ? ', ' + r.warnings.length + ' warning(s)' : ''));
    for (const w of r.warnings) mlog('mig: ' + w);
    return r;
}

function finish(r: MigrationResult | null): void {
    result = r && r.migrated.length > 0 ? r : null;
    state = 'done';
}

/** What the migration produced, or null when it produced nothing. */
export function migrationResult(): MigrationResult | null { return result; }

/** Whether the chain document is still being held. */
export function migrationPending(): boolean { return state === 'probing'; }

/** The `migv` to persist. Always the current version once resolved — including
 *  after a failure, deliberately. */
export function migrationMarker(): number {
    return state === 'done' ? MIGRATION_VERSION : 0;
}

/** The Settings action: one probe, no stability wait, and it OVERWRITES.
 *
 *  The set is `ready` when this runs, so schwung's slots are settled by
 *  definition — the wait above exists only for the load-time race. */
export function runManualMigration(
    existing: ChainTrackState[] | undefined | null,
): MigrationResult {
    const slots: SlotChain[] = [];
    for (let s = 0; s < 4; s++) slots.push(readSlotChain(s));
    const r = planMigration(slots, existing, true);
    mlog('mig: manual — ' + r.migrated.length + ' track(s)');
    for (const w of r.warnings) mlog('mig: ' + w);
    return r;
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npm run build:browser && node browser-test/logic.mjs 2>&1 | tail -20`
Expected: PASS, 0 failures.

- [x] **Step 5: Prove the stability rule has teeth**

Temporarily change `if (sig === lastSig)` to `if (true)`. Re-run — `first probe does not resolve` and `a changed signature does not resolve` must fail. Put it back.

- [x] **Step 6: Commit**

```bash
git add src/track/migrate.ts browser-test/logic/track-migrate.mjs
git commit -m "$(cat <<'EOF'
feat(migrate): two agreeing reads, a budget that ends, and a marker either way

schwung clears every slot before reloading it, so one read can catch the
rack mid-swap. Migrating on that and then marking makes it permanent.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Wire it into the set load

The marker round-trips through the blob, and the chain document waits for the migration.

**Files:**
- Modify: `src/seq/ui-state.ts`
- Modify: `src/seq/set-settle.ts`
- Modify: `src/seq/set-session.ts`
- Modify: `browser-test/logic/track-migrate.mjs`

**Interfaces:**
- Consumes: `beginMigration`, `migrationTick`, `migrationResult`, `migrationMarker`, `migrationPending`, `MIGRATION_VERSION`
- Produces: `flushHeldChains(): boolean` from `ui-state.ts` — sends the held document; true once sent. `chainDocSent(): boolean` from `set-settle.ts`.

- [x] **Step 1: Write the failing test**

Append to `run()` in `browser-test/logic/track-migrate.mjs`:

```javascript
{
  _log('\nset load — the marker, and the document that waits:');
  const { serializeUiState, applyUiState, installMockFs: mfs2, uninstallMockFs: umfs2,
          writePrefFlag: wpf2 } = await import('./harness.mjs');
  const M2 = await import('../../dist/esm/track/migrate.js');
  const { flushHeldChains } = await import('../../dist/esm/seq/ui-state.js');

  mfs2(); wpf2('chtracks', 2);

  /* A candidate set HOLDS its chain document until the migration resolves.
   * Sending it first and migrating after would need a second document, which
   * re-queues every load the first one started. */
  for (let s = 0; s < 4; s++) globalThis.shadow_set_param(s, 'synth_module', '');
  globalThis.shadow_set_param(0, 'synth_module', 'plaits');
  M2.resetMigration();
  applyUiState(JSON.stringify({ flags: { chtrackset: 0 }, chains: [] }));
  ok('the document is held while probing', M2.migrationPending());
  eq('nothing was sent yet', flushHeldChains(), false);
  M2.migrationTick(0);
  M2.migrationTick(1000);
  eq('the document goes out once resolved', flushHeldChains(), true);

  /* And the marker is written, so the next open does not probe again. */
  const blob = JSON.parse(serializeUiState());
  eq('the blob carries the marker', blob.migv, M2.MIGRATION_VERSION);

  /* A set already carrying the marker never holds anything. */
  M2.resetMigration();
  applyUiState(JSON.stringify({ migv: M2.MIGRATION_VERSION, flags: { chtrackset: 0 }, chains: [] }));
  eq('a marked set does not hold', M2.migrationPending(), false);

  umfs2();
}
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm run build:browser && node browser-test/logic.mjs 2>&1 | tail -20`
Expected: FAIL — `flushHeldChains` is not exported.

- [x] **Step 3: Implement in `ui-state.ts`**

Add the imports:

```typescript
import {
    beginMigration, migrationMarker, migrationPending, migrationResult, migrationTick,
} from '../track/migrate.js';
import type { ChainTrackState } from '../track/chain-persist.js';
import type { SendState } from '../track/send-persist.js';
```

Add module state and the flush, above `serializeUiState`:

```typescript
/* The chain document, held while the migration decides what belongs in it.
 *
 * One document, never two: it names every chain in the set, so sending it and
 * then sending a migrated version re-queues every load the first one started —
 * seconds of dlopen on the audio thread, in front of a user staring at a splash
 * that already ended once. */
let held: { chains: ChainTrackState[] | undefined; sends: SendState[] | undefined } | null = null;

/** Send the held chain document if the migration has resolved. Returns whether
 *  it went out — `set-settle.ts` will not promote the Set until it has. */
export function flushHeldChains(): boolean {
    if (!held) return true;
    if (migrationPending()) return false;
    const mig = migrationResult();
    /* Merged, not appended: a migrated track can only be one the set's own
     * blob did not carry (`planMigration` skips an occupied chain), so there
     * is nothing to collide with — but the sort keeps the document in track
     * order, which is what makes a dumped document readable. */
    const chains = [...(held.chains ?? []), ...(mig ? mig.chains : [])]
        .sort((a, b) => (a?.t ?? 0) - (b?.t ?? 0));
    const n = restoreChains(chains, held.sends);
    if (n > 0) mlog('chains: restoring ' + n + ' movy chain component(s)');
    held = null;
    return true;
}
```

In `serializeUiState()`, add the marker beside `flags`:

```typescript
        /* Which migration this set has been through. Present means its tracks
         * 1-4 are movy chains and schwung's slots are no longer consulted —
         * including after a migration that could not complete, deliberately. */
        migv: migrationMarker(),
```

In `applyUiState()`, replace the `loadSetHostChoice(...)` + `restoreChains(...)` block with:

```typescript
        /* FIRST, ahead of the chains: the migration decides what belongs in the
         * document, and a candidate set may not be able to answer yet — schwung
         * clears its slots before reloading them, so an early read sees an empty
         * rack. `flushHeldChains` sends the document once it can. */
        beginMigration(o.flags && typeof o.flags === 'object' ? o.flags : null,
                       o.migv, o.chains);
        held = { chains: o.chains, sends: o.sends };
        flushHeldChains();
```

In `resetUiState()`, replace **both** `loadSetHostChoice(null)` and the direct
`restoreChains(null, null)` call with:

```typescript
    /* A Set with no UI blob at all: new work, or a set duplicated in Move —
     * indistinguishable until the probe runs, so both are candidates.
     *
     * The empty document is HELD rather than sent, and that is load-bearing: a
     * duplicated set's instruments are found by the probe, and a document
     * already sent could not carry them. Held-and-empty still unloads the
     * previous Set's chains, just one probe later, behind the same splash. */
    beginMigration(null, undefined, []);
    held = { chains: [], sends: null };
    flushHeldChains();
```

Delete the now-unused `loadSetHostChoice` import.

- [x] **Step 4: Implement the settle gate**

In `src/seq/set-settle.ts`, add to `settleCheck()`:

```typescript
export function settleCheck(): Settle {
    /* Before anything else: a candidate Set is still holding its chain
     * document, so `chainPending` is trivially 0 and promoting on it would put
     * a live surface in front of a Set whose modules were never asked for. The
     * same shape as the splash that gated on the engine only. */
    if (!flushHeldChains()) {
        return Date.now() - start >= CAP_MS ? 'capped' : 'wait';
    }
    if (statusSeq() > baseSeq && seqState.chainPending === 0 && setCommitIdle()) return 'done';
    return Date.now() - start >= CAP_MS ? 'capped' : 'wait';
}
```

with `import { flushHeldChains } from './ui-state.js';`, and extend `settleOutstanding()`:

```typescript
export function settleOutstanding(): string {
    return 'chpend=' + seqState.chainPending + ' commit=' + (setCommitIdle() ? 'idle' : 'busy')
        + (migrationPending() ? ' migrating' : '');
}
```

In `src/seq/set-session.ts`, drive the probe from `settleTick()` — add as its first line:

```typescript
    /* The migration probes on wall-clock, and this is the only loop that runs
     * while the splash is up. */
    migrationTick(Date.now());
```

- [x] **Step 5: Run tests to verify they pass**

Run: `npm run build:browser && node browser-test/logic.mjs 2>&1 | tail -20`
Expected: PASS, 0 failures.

- [x] **Step 6: Prove the settle gate has teeth**

Temporarily remove the `if (!flushHeldChains())` block from `settleCheck()`. Run `node browser-test/logic.mjs` — the set-settling suite's held-document assertion must fail. If it does not, the assertion is not reaching the gate: add one to `browser-test/logic/set-settling.mjs` that calls `settleCheck()` with a candidate set mid-probe and expects `'wait'`. Put the block back.

- [x] **Step 7: Full gate and commit**

Run: `npm test` — 0 failures.

```bash
git add src/seq/ui-state.ts src/seq/set-settle.ts src/seq/set-session.ts \
        browser-test/logic/track-migrate.mjs browser-test/logic/set-settling.mjs
git commit -m "$(cat <<'EOF'
feat(migrate): one chain document, held until the migration can fill it

settleCheck promoted on chainPending == 0, which is trivially true before
any document has gone out.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Splash text and the warning toast

**Files:**
- Modify: `src/renderer/loading-view.ts`
- Modify: `src/seq/set-session.ts`
- Modify: `browser-test/logic/track-migrate.mjs`
- Modify: `browser-test/screenshot.mjs` (new scene)

- [x] **Step 1: Write the failing test**

Append to `run()` in `browser-test/logic/track-migrate.mjs`:

```javascript
{
  _log('\nsplash — what the user reads while it happens:');
  const { loadingStage } = await import('../../dist/esm/renderer/loading-view.js');
  eq('booting is unchanged', loadingStage('booting', 0, false), 'STARTING ENGINE');
  eq('loading is unchanged', loadingStage('loading', 0, false), 'LOADING SET');
  eq('settling is unchanged', loadingStage('settling', 2, false), 'LOADING MODULES');
  /* A migration is neither a load nor a preparation, and it is the one wait
   * long enough that a user deserves to know what it is. */
  eq('migrating says so', loadingStage('settling', 0, true), 'MIGRATING TRACKS');
  eq('migrating outranks the module count', loadingStage('settling', 3, true), 'MIGRATING TRACKS');
}
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm run build:browser && node browser-test/logic.mjs 2>&1 | tail -20`
Expected: FAIL — `loadingStage('settling', 0, true)` returns `'PREPARING SET'`.

- [x] **Step 3: Implement**

In `src/renderer/loading-view.ts`:

```typescript
export function loadingStage(phase: string, chainPending: number, migrating = false): string {
    if (phase === 'booting') return 'STARTING ENGINE';
    if (phase !== 'settling') return 'LOADING SET';
    /* First: the modules have not been ASKED for yet while this is true — the
     * document is held — so a module count would read as 0 and the splash would
     * claim to be preparing a Set it has not started loading. */
    if (migrating) return 'MIGRATING TRACKS';
    /* The tail of the wait is the Set-commit press borrowing the surface, which
     * is not a load and must not claim to be one. */
    return chainPending > 0 ? 'LOADING MODULES' : 'PREPARING SET';
}
```

Update `renderLoadingView` to take and forward a `migrating` argument, and update its call site in `src/app/tick.ts` to pass `migrationPending()`.

In `src/seq/set-session.ts`, raise the toast at promotion — inside `settleTick()`, immediately before `phase = 'ready';`:

```typescript
    /* After the splash, not during it: a toast drawn behind the loading view is
     * a toast nobody sees. */
    const mig = migrationResult();
    if (mig && mig.warnings.length > 0) {
        seqToast('MIGRATED — SEE LOG (' + mig.warnings.length + ')');
    }
```

with `import { seqToast } from './render.js';`.

- [x] **Step 4: Run test to verify it passes**

Run: `npm run build:browser && node browser-test/logic.mjs 2>&1 | tail -20`
Expected: PASS.

- [x] **Step 5: Add the screenshot scene and regenerate baselines**

Add a scene to `browser-test/screenshot.mjs` named `loading_migrating` that calls `renderLoadingView('settling', '', 0, 'set', true)`. Then:

```bash
node browser-test/screenshot.mjs --update
node browser-test/screenshot.mjs
```

Expected: the new baseline is written and the suite passes.

- [x] **Step 6: Commit**

```bash
git add src/renderer/loading-view.ts src/app/tick.ts src/seq/set-session.ts \
        browser-test/logic/track-migrate.mjs browser-test/screenshot.mjs \
        browser-test/screenshots/baseline/loading_migrating.png
git commit -m "$(cat <<'EOF'
feat(migrate): the splash says what the wait is, and the toast says what stayed behind

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Delete the schwung track host (UI)

Now that migration works, tracks 0-3 are movy chains unconditionally.

**Files:**
- Delete: `src/track/host-mode.ts`
- Rename: `src/track/host-port.ts` → `src/track/shim-port.ts`
- Modify: `src/track/ref.ts`, `registry.ts`, `chain-persist.ts`, `chain-payload.ts`
- Modify: `src/seq/flags-def.ts`, `flags.ts`, `flags-visible.ts`, `flags-page.ts`
- Modify: `src/mixer/mix-io.ts`, `mix-model.ts`, `mix-cells.ts`, `track-volume.ts`
- Modify: `src/seq/drum-sync.ts`, `src/seq/cpu-page-vm.ts`, `src/lfo/scope.ts`, `src/undo/param-sync.ts`
- Modify: `browser-test/logic/tracks-refs.mjs`, `tracks-chain.mjs`, `flags.mjs`, `cpu-page.mjs`, `harness.mjs`

- [x] **Step 1: Update the tests first — they are the specification**

In `browser-test/logic/tracks-refs.mjs`, replace the `trackKind` assertions with:

```javascript
  /* One host now. A track's chain IS its index, for all sixteen. */
  eq('chain instance of track 0', chainInstance(0), 0);
  eq('chain instance of track 3', chainInstance(3), 3);
  eq('chain instance of track 4', chainInstance(4), 4);
  eq('chain instance of track 15', chainInstance(15), 15);
```

Delete the whole `chtracks moves tracks 1-4 onto movy chains` block. In `flags.mjs`, delete every `chtracks`/`chtrackset` assertion. In `cpu-page.mjs`, replace the `kind: 'na'` expectations for tracks 0-3 with `'empty'`. Remove `movyTracksOn`, `loadSetHostChoice` from the `harness.mjs` export list and its imports.

- [x] **Step 2: Run tests to verify they fail**

Run: `npm run build:browser && node browser-test/logic.mjs 2>&1 | tail -30`
Expected: FAIL — `chainInstance(0)` is `-1`, and the CPU columns say `na`.

- [x] **Step 3: Cut `ref.ts` down**

```typescript
/* What a track IS.
 *
 * Movy's tracks used to be schwung shadow slots, so "track" and "slot" were the
 * same number. They are not: every track is a chain movy hosts itself, and
 * `track/migrate.ts` is what carried the last schwung-hosted ones across. */

/** Chains movy hosts, one per track. Must equal `MOVY_CHAINS`
 *  (`chain_slots.rs`) — asserted in `browser-test/logic/tracks-refs.mjs`. */
export const MOVY_CHAINS = 16;

/* Must stay in lockstep with the engine's NUM_TRACKS (seq-core/src/track.rs). */
export const TRACK_COUNT = 16;

/** Tracks per group: the 4 track buttons, and one row of the session grid. */
export const GROUP_SIZE = 4;

export interface TrackRef { index: number }

export function trackRef(index: number): TrackRef { return { index }; }
export function trackGroup(index: number): number { return Math.floor(index / GROUP_SIZE); }
export function trackIndexInGroup(index: number): number { return index % GROUP_SIZE; }

/** **A track's chain IS its index.** */
export function chainInstance(index: number): number { return index; }
```

Delete `HOST_TRACKS`, `TrackKind`, `trackKind`, `movyTracksOn`, and the `kind` field on `TrackRef`.

- [x] **Step 4: Fix the fallout, file by file**

Compile-driven. `npm run build:device` names each site; apply this rule at every one:

- `trackKind(t) === 'movy'` → `true` (delete the branch's else)
- `trackKind(t) === 'host'` → `false` (delete the branch)
- `chainInstance(t) < 0` → unreachable; delete the guard
- `r.kind` on a `TrackRef` → delete

Specifically:
- `registry.ts` — `portFor` loses its ternary: `p = new MovyChainPort(index)`. **Keep `hostPort`, `componentPort` and `engineRootPort` exactly as they are** — `master_fx:` still rides slot 0, and `hostPort` is what the migration reads through. Update `HostSlotPort` → `ShimSlotPort` from `./shim-port.js`.
- `mix-io.ts` — delete `HOST_VOLUME_KEY`, `mixerKeyFor`'s ternary (return `MIX_KEY`), and the host branches in `readMix`/`writeMix`. `isMixerKey` becomes `key === MIX_KEY`. Safe: `slot-read.ts` spells `slot:volume` itself, precisely so the mixer does not have to keep a second shape for a track's level alive on its behalf.
- `mix-model.ts:73` — drop `&& trackKind(track) === 'host' && field !== 'gain'`. `mix-model.ts:131` — pass no `kind`. `mix-model.ts:152` — delete the `return null` host branch.
- `track-volume.ts:106,110,198` — take the movy branch unconditionally; `:119` reads `MIX_KEY` through the port, not `slot:volume`.
- `drum-sync.ts:62` — delete the host-probe branch entirely and the `probed`/`retryIn` bookkeeping it is the only user of. A movy chain can only change from inside movy, so there is nothing to discover.
- `cpu-page-vm.ts:94` — delete the `'na'` branch. Leave the `'na'` kind in the type: the renderer still has a case for it and removing it is scope this task does not need.
- `lfo/scope.ts:64` — no change (it already uses `hostPort(0)` for master, which is correct and stays). Update the comment: the reason is no longer `chtracks`, it is that a master key is not a track's.
- `undo/param-sync.ts:27` — drop the `slot:volume` half of the comment and the key.
- `chain-persist.ts` — `captureChains` drops `trackKind(t) !== 'movy'`; `chainSetTriples` drops `chainInstance(t) < 0`; `restoreChains` drops the same guard. `chain-payload.ts:deliverChainPayloads` drops its `chainInstance(p.t) < 0` skip.
- `flags-def.ts` — delete the `chtracks` and `chtrackset` entries, `HOST_SCHWUNG`/`HOST_MOVY`/`HOST_NEW_SETS`, and `resolveHost`. Bump `FLAGS_REV` to 3.
- `flags.ts` — `engineValue` loses its `chtracks` fold and becomes `ensure()[key]`; delete `pushFlagToEngine` (`host-mode.ts` was its only caller) and the `resolveHost` import.
- `flags-visible.ts` — delete the `chtrackset` visibility rule and the `HOST_NEW_SETS`/`flagValue` imports.
- `flags-page.ts` — delete the `setHostMode`/`setSetHost` branches in `flagsPageKnob` and the `host-mode.js` import.
- Delete `src/track/host-mode.ts`.

- [x] **Step 5: Run tests to verify they pass**

```bash
npm run build:device && npm test
```
Expected: 0 failures. Fix any suite still importing a deleted symbol.

- [x] **Step 6: Verify nothing is left**

```bash
grep -rn "chtracks\|chtrackset\|trackKind\|HOST_TRACKS\|movyTracksOn\|host-mode" \
  --include="*.ts" src browser-test
```
Expected: no hits except `legacy-host.ts`'s deliberate read of the stored `chtracks` value and its comments.

- [x] **Step 7: Commit**

```bash
git add -u src browser-test
git add src/track/shim-port.ts
git commit -m "$(cat <<'EOF'
refactor: one host for every track

trackKind, HOST_TRACKS, chtracks and chtrackset are gone; a track's chain
is its index. HostSlotPort survives as ShimSlotPort — master_fx still
rides slot 0, and the migration reads schwung's slots through it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Delete the schwung track host (engine)

**Files:**
- Modify: `engine/crates/movy-dsp/src/lib.rs`
- Modify: `src/seq/constants.ts` (`ENGINE_VERSION`)
- Modify: `engine/crates/movy-dsp/src/chain_slots.rs` (comment only)

- [x] **Step 1: Update the tests first**

In `lib.rs`, replace `chtracks_moves_the_first_four_tracks` with:

```rust
    #[test]
    fn every_track_is_a_chain() {
        let inst = MovyDsp::new();
        let _ = &inst;
        // One host: a track's chain IS its index, for all sixteen. The four
        // that used to be schwung's are carried across by the UI's one-time
        // migration (src/track/migrate.ts) before this build ever runs.
        assert_eq!(chain_for(0), Some(0));
        assert_eq!(chain_for(3), Some(3));
        assert_eq!(chain_for(15), Some(15));
        assert_eq!(chain_for(16), None, "past the last track");
    }
```

- [x] **Step 2: Run to verify it fails**

Run: `cd engine && cargo test 2>&1 | tail -20`
Expected: FAIL — `chain_for` takes two arguments.

- [x] **Step 3: Implement**

In `lib.rs`:

```rust
/// A track's chain. **`ch<N>` IS track N** — there is no second host, and no
/// offset. Tracks 0..3 were schwung shadow slots until the one-time migration
/// in `src/track/migrate.ts` moved them here.
fn chain_for(track: u8) -> Option<usize> {
    let t = track as usize;
    if t < MOVY_CHAINS { Some(t) } else { None }
}
```

Delete the `movy_tracks` field (line 154), its initializer (167), the whole `"chtracks" =>` arm (223-229), and `HOST_TRACKS` if it has no other user. Update the three `chain_for(track, self.movy_tracks)` call sites in `drain_out` (505, 519, 536) to `chain_for(track)`.

Bump `ENGINE_VERSION` in `lib.rs` **and** `src/seq/constants.ts` to the same new value.

- [x] **Step 4: Run to verify it passes**

```bash
cd engine && cargo test 2>&1 | tail -5
cd .. && ./scripts/build-dsp.sh
```
Expected: tests pass; the build succeeds (it fails on an `ENGINE_VERSION` mismatch, which is the check that the two bumps agree).

- [x] **Step 5: Full gate and commit**

Run: `npm test`

```bash
git add engine/crates/movy-dsp/src/lib.rs engine/crates/movy-dsp/src/chain_slots.rs src/seq/constants.ts
git commit -m "$(cat <<'EOF'
refactor(engine): drain_out has one destination

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: The manual Settings row

**Files:**
- Modify: `src/seq/flags-page-vm.ts`, `src/seq/flags-page.ts`, `src/midi/router.ts`
- Create: `src/seq/migrate-action.ts`
- Modify: `browser-test/logic/flags.mjs`

**Interfaces:**
- Produces: `ACTION_ROWS` (name/value/hint per row) from `flags-page-vm.ts`; `actionRowSelected(): number` (index into `ACTION_ROWS`, or -1) from `flags-page.ts`; `migrateRowArmed(): boolean`, `armMigrateRow()`, `disarmMigrateRow()`, `runMigrateRow(): string` from `migrate-action.ts`.

- [x] **Step 1: Write the failing test**

Append to `browser-test/logic/flags.mjs`:

```javascript
{
  _log('\nsettings — the second action row:');
  const { buildFlagsPageVM, flagsPageState, flagsRowCount, visibleFlags } =
    await import('./harness.mjs');
  const { actionRowSelected } = await import('../../dist/esm/seq/flags-page.js');
  const { migrateRowArmed, armMigrateRow, disarmMigrateRow } =
    await import('../../dist/esm/seq/migrate-action.js');

  const flags = visibleFlags(true);
  /* The count is what the jog clamps to. A row added to the clamp but not to
   * the viewmodel is selectable, clickable and invisible — which is exactly how
   * BACKUPS shipped the first time, with every screenshot byte-identical. */
  eq('two action rows past the flags', flagsRowCount(), flags.length + 2);

  flagsPageState.selected = flags.length;
  eq('vm draws every row', buildFlagsPageVM(flags).rows.length, flags.length + 2);
  eq('first action row is BACKUPS', buildFlagsPageVM(flags).rows[flags.length].name, 'BACKUPS');
  eq('backups is action 0', actionRowSelected(), 0);

  flagsPageState.selected = flags.length + 1;
  const vm = buildFlagsPageVM(flags);
  eq('second action row is MIGRATE', vm.rows[flags.length + 1].name, 'MIGRATE TRACKS');
  eq('migrate is action 1', actionRowSelected(), 1);
  eq('it is selected', vm.rows[flags.length + 1].selected, true);
  eq('its hint is shown', vm.hint.length > 0, true);

  /* Arming: a stray jog-click stops playback and reloads every module, so the
   * row says what the next click will do before it does it. */
  disarmMigrateRow();
  eq('unarmed value', buildFlagsPageVM(flags).rows[flags.length + 1].value, '>');
  armMigrateRow();
  eq('armed', migrateRowArmed(), true);
  eq('armed value', buildFlagsPageVM(flags).rows[flags.length + 1].value, 'CONFIRM?');
  /* Moving away disarms: an arm left standing on a row the user has scrolled
   * off is a confirmation they did not give. */
  flagsPageState.selected = 0;
  buildFlagsPageVM(flags);
  eq('moving off disarms', migrateRowArmed(), false);
}
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm run build:browser && node browser-test/logic.mjs 2>&1 | tail -20`
Expected: FAIL — `flagsRowCount()` is `flags.length + 1`.

- [x] **Step 3: Implement**

Create `src/seq/migrate-action.ts`:

```typescript
/* The Settings row that re-runs the migration.
 *
 * It is not a second migration path: it clears this set's marker and re-enters
 * the load, so the ordinary one runs behind the ordinary splash. That is what
 * keeps the "no edit may race a migration" rule true for a gesture made while
 * the instrument is live.
 *
 * It OVERWRITES, where the automatic path skips a chain that already holds
 * something. The two reasons to press it are a migration that came up partial
 * and a chain since broken by hand, and a guard would refuse both. Safe to
 * re-run: schwung's slot is never cleared. */

import { readSlotChain } from '../track/slot-read.js';
import { seqToast } from './render.js';

let armed = false;

export function migrateRowArmed(): boolean { return armed; }
export function armMigrateRow(): void { armed = true; }
export function disarmMigrateRow(): void { armed = false; }

/** Whether any schwung slot still holds something movy could take. Cheap —
 *  schwung serves these from its own param cache. */
export function slotsHaveContent(): boolean {
    for (let s = 0; s < 4; s++) if (readSlotChain(s).comp.length > 0) return true;
    return false;
}

/** The confirmed press. Returns whether the caller should re-enter the load. */
export function runMigrateRow(clearMarker: () => void): boolean {
    armed = false;
    if (!slotsHaveContent()) {
        /* No reload: nothing to migrate is not worth stopping the music for. */
        seqToast('NOTHING TO MIGRATE');
        return false;
    }
    clearMarker();
    return true;
}
```

In `flags-page-vm.ts`, replace the single-row constants with a table and generalize the count:

```typescript
/* The rows on this page that are not flags. They sit LAST so they never move
 * when the flag list differs between debug and release builds, and they are
 * ACTIONS: knob 1 does nothing on them and the jog click is what acts.
 *
 * A LIST rather than one hardcoded row, because the count is what the jog
 * clamps to and what the viewmodel draws, and those two disagreeing is how
 * BACKUPS first shipped: added to the clamp and the router but not here, so it
 * was selectable, clickable and invisible, with every screenshot byte-identical
 * because the viewmodel never changed. */
export const ACTION_ROWS = [
    { name: 'BACKUPS', hint: 'Older versions of this set. Restore one.' },
    { name: 'MIGRATE TRACKS', hint: 'Pull tracks 1-4 out of Schwung. Reloads the set.' },
] as const;
```

and in `buildFlagsPageVM`:

```typescript
    const count = flags.length + ACTION_ROWS.length;
    const sel = Math.max(0, Math.min(count - 1, flagsPageState.selected));
    const action = sel - flags.length;   // -1 when a flag is selected
    const rows: FlagRow[] = flags.map((f, i) => ({
        name: f.name,
        value: flagValueLabel(f, flagValue(f.key)),
        selected: i === sel,
    }));
    /* Building the rows is also where an arm expires: the user has scrolled off
     * the row, and a confirmation they can no longer see is not one they gave. */
    if (action !== 1) disarmMigrateRow();
    ACTION_ROWS.forEach((a, i) => rows.push({
        name: a.name,
        value: i === 1 && migrateRowArmed() ? 'CONFIRM?' : '>',
        selected: action === i,
    }));
    const def = action >= 0 ? null : flags[sel];
    return {
        rows, selected: sel,
        hint: action >= 0 ? ACTION_ROWS[action].hint : (def ? def.hint : ''),
        knobNormalized: def ? flagNormalized(def, flagValue(def.key)) : 0,
    };
```

In `flags-page.ts`, replace `flagsRowCount`/`backupsRowSelected`:

```typescript
export function flagsRowCount(): number { return visibleFlags().length + ACTION_ROWS.length; }

/** Which action row is selected, or -1 for a flag. */
export function actionRowSelected(): number {
    const i = flagsPageState.selected - visibleFlags().length;
    return i >= 0 ? i : -1;
}

/** Kept for the router's read: the first action row. */
export function backupsRowSelected(): boolean { return actionRowSelected() === 0; }
```

and change `flagsPageKnob`'s guard to `if (actionRowSelected() >= 0) return;`.

In `src/midi/router.ts` around line 620, extend the click handler:

```typescript
        if (flagsPageActive() && actionRowSelected() === 0) {
            openVersionsPage();
            appState.dirty = true;
            return;
        }
        if (flagsPageActive() && actionRowSelected() === 1) {
            /* Arm, then act. A stray click here stops playback and reloads
             * every module in the set. */
            if (!migrateRowArmed()) armMigrateRow();
            else if (runMigrateRow(clearSetMigrationMarker)) {
                /* Save first: the autosave is on a ~3-8 s countdown, so a
                 * reload without this drops whatever the user just played. */
                saveCurrentSetNow();
                reloadCurrentSet();
            }
            appState.dirty = true;
            return;
        }
```

Add `clearSetMigrationMarker()` to `src/seq/ui-state.ts` (sets a module flag that makes `serializeUiState` write `migv: 0`, and calls `markUiStateDirty()`), and export `saveCurrentSetNow()` from `set-session.ts` wrapping the existing `saveSet(setId, gen, true)` path.

- [x] **Step 4: Run tests to verify they pass**

Run: `npm run build:browser && node browser-test/logic.mjs 2>&1 | tail -20`
Expected: PASS.

- [x] **Step 5: Prove the count/viewmodel agreement has teeth**

Temporarily change `flagsRowCount()` back to `visibleFlags().length + 1`. Re-run — `two action rows past the flags` must fail. Put it back.

- [x] **Step 6: Screenshot and commit**

```bash
node browser-test/screenshot.mjs --update && node browser-test/screenshot.mjs && npm test
git add src/seq/migrate-action.ts src/seq/flags-page-vm.ts src/seq/flags-page.ts \
        src/seq/ui-state.ts src/seq/set-session.ts src/midi/router.ts \
        browser-test/logic/flags.mjs browser-test/screenshots/baseline
git commit -m "$(cat <<'EOF'
feat(settings): MIGRATE TRACKS, armed before it acts

Re-enters the load path rather than migrating in place, so the same
splash rule holds for a gesture made while the instrument is live.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: The device suite

**Files:**
- Create: `scripts/test-migrate.sh`
- Modify: `browser-test/device-scripts.mjs`
- Modify: `scripts/test-all-device.sh` (add `test-migrate.sh` to `SCRIPTS`)

- [x] **Step 1: Write the suite header and the contract canary**

Create `scripts/test-migrate.sh`, modelled on `scripts/test-versions.sh`:

```bash
#!/usr/bin/env bash
# test-migrate.sh — tracks 1-4 come out of schwung's slots and into movy's
# chains, once per set.
#
# The local suite proves the rules against mock params. This proves the two
# things it cannot: that the keys the migration reads are keys a REAL schwung
# still answers, and that a migrated track arrives with the PATCH the user had
# rather than the module's factory defaults.
set -euo pipefail
HOST="${1:-move.local}"
MOVY_DIR="$(cd "$(dirname "$0")/.." && pwd)"
export HOST
# shellcheck source=lib/test-set.sh
source "$MOVY_DIR/scripts/lib/test-set.sh"
test_set_begin
trap test_set_end EXIT INT TERM

PASS=0; FAIL=0
ok()  { echo -e "  \033[0;32m✓\033[0m $1"; PASS=$((PASS+1)); }
bad() { echo -e "  \033[0;31m✗\033[0m $1"; FAIL=$((FAIL+1)); }

slot_get() { node "$MOVY_DIR/scripts/module-slot.mjs" get "$1" "$2" </dev/null 2>/dev/null; }
chain_get() { node "$MOVY_DIR/scripts/chain-params.mjs" get "$1" </dev/null 2>/dev/null; }

# ── Arm 1: the contract canary ──────────────────────────────────────────────
# EVERY key the migration reads, off a slot the fixture really seeded. When
# schwung renames or drops one, this says WHICH — without it the migration
# quietly finds nothing and all three arms below still pass on an empty set.
echo "── contract: the keys the migration depends on ──"
SYNTH=$(slot_get 0 synth)
if [ -z "$SYNTH" ]; then
    bad "slot 0 holds no synth — the fixture did not seed, nothing below is valid"
    exit 1
fi
ok "slot 0 synth reads back ($SYNTH)"
for key in "synth:state" "slot:volume"; do
    val=$(ts_slot_param 0 "$key")
    if [ -z "$val" ]; then bad "schwung no longer answers '$key' — migration reads it"
    else ok "'$key' answers"; fi
done
```

Add `ts_slot_param <slot> <key>` to `scripts/lib/test-set.sh` if it does not
exist — a one-line wrapper over the same remote-UI read `module-slot.mjs` uses,
so the canary reads through the same transport movy does.

- [x] **Step 2: Write the three behaviour arms**

Continue the same script:

2. **Positive.** With movy closed, write a legacy ui blob for the active set
   (`{"flags":{"chtrackset":0}}` — no `migv`, no `chains`) to
   `/data/UserData/schwung/modules/tools/movy/sets/<uuid>/ui-state.json` via
   `ts_ssh`, using `ts_active_uuid`. Restart the stack so schwung reloads
   its slots from `slot_N.json`, open movy with `ts_open_movy`, and wait with
   `ts_wait_ui_state` (there is no bare `ts_wait_ui`). Then assert, in this order:
   - `ts_ssh` the log for `[movy] mig: migrated 1 track(s)` (or 2, per the
     fixture's `slots.txt`) — **present**.
   - write `chloadedlog` and grep the log: chain 0 names the fixture's synth.
   - `chain_get 'ch0:synth:<param>'` for a param the fixture set **off its
     default** in `slot_0.json`, and assert it still reads off-default. This is
     the audibility assertion — a module id proves a load, not a patch.
   - the set's `ui-state.json` now parses with `migv` >= 1 and a non-empty
     `chains` array.
   - `slot_get 0 synth` still answers `$SYNTH`: **the schwung slot is never
     cleared**, and a migration that emptied it would be data loss.

3. **Negative control + idempotence.** Close and reopen movy on the same set:
   assert `mig: migrated` is **absent** from the fresh log and `chloadedlog`
   still names the same module. Then clear all four slots
   (`node scripts/slot-state.mjs clear <n>`), blank the marker in the blob, and
   reopen: assert `[movy] mig: nothing to migrate` is **present**. Without this
   arm "migrated 0 tracks" and "found nothing" are the same green.

4. **Manual row.** With a chain already loaded, open Settings
   (`ts_tap_cc` Shift + Step 2), jog to the last row, click once (assert the row
   is armed — grab the framebuffer with `scripts/grab-screen.mjs` or assert the
   `mig: manual` line is *absent*), click again, and assert
   `[movy] mig: manual — N track(s)` appears and the chain holds the slot's
   module.

Finish with the usual `echo "$PASS passed, $FAIL failed"; [ "$FAIL" -eq 0 ]`.

- [x] **Step 3: Add the invariant check**

In `browser-test/device-scripts.mjs`, add `test-migrate.sh` to the scripts it validates: every log pattern it greps for must exist in `src/`, so the suite cannot report "missing" for a line movy never prints.

- [x] **Step 4: Run locally, then on device**

```bash
node browser-test/device-scripts.mjs
ssh -o ConnectTimeout=3 ableton@move.local echo ok 2>/dev/null \
  && ./scripts/deploy.sh && ./scripts/test-migrate.sh \
  || echo "DEVICE OFFLINE — SKIPPING DEVICE TESTS"
```

If the device is offline, **report it to the user in CAPS**. If a device arm fails, check the output for a real regression in what you changed; do not re-run or bisect.

- [x] **Step 5: Commit**

```bash
git add scripts/test-migrate.sh scripts/lib/test-set.sh browser-test/device-scripts.mjs scripts/test-all-device.sh
git commit -m "$(cat <<'EOF'
test(device): the migration, and a canary for the day schwung renames a key

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Collapse the two-host device matrix

**Files:**
- Delete: `scripts/test-all-device-schwung.sh`, `scripts/test-all-device-movy.sh`
- Modify: `scripts/lib/test-set.sh`, `scripts/test-all-device.sh`, `scripts/fixtures/README.md`
- Modify: `browser-test/device-scripts.mjs`

- [x] **Step 1: Strip `TS_HOST_MODE`**

In `scripts/lib/test-set.sh`: delete the variable and its validation (lines 30-45), the prefs pinning (`ts_save_host_flag` / the `chtracks` writes and read-back, ~505-610), the host-mode banner (781), and the `TS_HOST_MODE` branches at 625, 695, 717. `ts_fixture_synth` (625) becomes unconditional. **Keep the `slots.txt` / `slot_N.json` seeding** — it is now the migration suite's input.

In `scripts/test-all-device.sh`: delete `TS_HOST_MODE`, its export, `ts_save_host_flag`, and the two banner lines that name the host.

- [x] **Step 2: Verify the library still works**

```bash
ssh -o ConnectTimeout=3 ableton@move.local echo ok 2>/dev/null \
  && ./scripts/test-fixture-selftest.sh \
  || echo "DEVICE OFFLINE — SKIPPING DEVICE TESTS"
```

This is the suite that exists for exactly this change: a fixture that quietly did nothing would make every other suite look clean while running on whatever the device happened to hold.

- [x] **Step 3: Run the full sweep**

```bash
./scripts/test-all-device.sh
```

- [x] **Step 4: Commit**

```bash
git rm scripts/test-all-device-schwung.sh scripts/test-all-device-movy.sh
git add scripts/lib/test-set.sh scripts/test-all-device.sh scripts/fixtures/README.md \
        browser-test/device-scripts.mjs
git commit -m "$(cat <<'EOF'
test(device): one sweep, because there is one host

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Documentation

**Files:**
- Modify: `MANUAL.md`, `README.md`, `CHANGELOG.md`, `docs/track-performance.md`, `plans/2026-08-24-movy-hosted-first-tracks.md`

- [x] **Step 1: `MANUAL.md`**

Delete the `Tracks 1-4 Host` / `This Set` settings rows from the Settings section and from the Controls reference tables (section 8). Add a short subsection describing what happens the first time an older set is opened (a `MIGRATING TRACKS` splash, the tracks arriving as movy chains, the schwung slot left as it was), and the `MIGRATE TRACKS` row with its two-click confirm. Add the `loading_migrating` screenshot:

```bash
node scripts/make-doc-assets.mjs loading_migrating
```

and reference it as `docs/assets/loading_migrating.png`.

- [x] **Step 2: `README.md`**

Update the chain description to say all sixteen tracks are movy chains. Remove any host-choice mention from *Features*.

- [x] **Step 3: `CHANGELOG.md`**

An entry under Unreleased: the migration, the removed flags, the new Settings row, and the `ENGINE_VERSION` bump.

- [x] **Step 4: `docs/track-performance.md`**

Its §1/§2 measurements were taken with `chtracks` as a variable. Add a note that the flag is gone and every track is a chain; do not re-write the numbers.

- [x] **Step 5: Point the old plan at the new spec**

At the top of `plans/2026-08-24-movy-hosted-first-tracks.md`:

```markdown
> **Superseded (2026-09-10):** the host choice this plan added is gone. Tracks
> 1-4 are movy chains unconditionally, and work built on schwung slots is carried
> across by a one-time migration — see
> `docs/superpowers/specs/2026-09-10-movy-track-migration-design.md`. Its
> "re-address, do not migrate" section still explains why migration on a LIVE
> FLIP was rejected; the migration runs on set load, behind the splash.
```

- [x] **Step 6: Final gate and commit**

```bash
npm test && (cd engine && cargo test 2>&1 | tail -3)
ssh -o ConnectTimeout=3 ableton@move.local echo ok 2>/dev/null \
  && ./scripts/test-all-device.sh \
  || echo "DEVICE OFFLINE — SKIPPING DEVICE TESTS"
git add MANUAL.md README.md CHANGELOG.md docs/track-performance.md \
        docs/assets/loading_migrating.png plans/2026-08-24-movy-hosted-first-tracks.md
git commit -m "$(cat <<'EOF'
docs: tracks 1-4 have one host, and how an old set gets there

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
git push
```
