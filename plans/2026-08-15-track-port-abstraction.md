# TrackPort Abstraction Implementation Plan (Stage 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every "a track is a schwung slot 0-3" assumption in the UI with a `TrackPort` interface, so later stages can add movy-hosted tracks without touching the ~62 call sites again.

**Architecture:** A new `src/track/` owns three things: `TrackRef` (what a track *is*), `TrackPort` (what you can *do* to one), and a registry that maps an index to a cached port. `HostSlotPort` is the only implementation in this stage and wraps exactly today's `shadow_*` calls. `ModelState` carries a port instead of a slot number; `appState.activeTrack` replaces `appState.activeSlot`.

**Tech Stack:** TypeScript → esbuild bundle (`ui.js`), QuickJS on device. Tests are plain node ESM under `browser-test/`.

**Stage 1 delivers no user-visible change.** Every existing suite must pass unmodified except where a test asserts on the internals being moved. That is the acceptance criterion: if behaviour changed, the refactor is wrong.

Design doc: `docs/superpowers/specs/2026-08-15-sixteen-track-sequencer-design.md` §2.

## Global Constraints

- **File size:** hard limit 200 lines, target 50-100. One responsibility per file.
- **Comments explain WHY** (constraints, invariants, workarounds) — never WHAT the code literally does.
- **No code duplication.** Refactor into a shared location before proceeding.
- **`src/types/` never imports from the rest of `src/`.**
- **`model/` never calls display functions.** `renderer/` has no state.
- **Branch:** all work on `feat/16-track-sequencer`. Never `git add -A`.
- **Every task ends green:** `npm run typecheck` (zero errors) and `node browser-test/logic.mjs` (0 failures) before the commit step.
- **`TRACK_COUNT` stays 4 in this stage.** Raising it to 16 is Stage 2's job and would make the engine and UI disagree.

---

### Task 1: `TrackRef` — what a track is

**Files:**
- Create: `src/track/ref.ts`
- Modify: `browser-test/logic.mjs` (append a test block before the final summary)

**Interfaces:**
- Consumes: nothing.
- Produces: `TRACK_COUNT: number`, `HOST_TRACKS: number`, `TrackKind = 'host' | 'movy'`, `TrackRef { index: number; kind: TrackKind }`, `trackRef(index): TrackRef`, `trackGroup(index): number`, `trackIndexInGroup(index): number`, `trackKind(index): TrackKind`, `chainInstance(index): number`.

- [ ] **Step 1: Write the failing test**

Append to `browser-test/logic.mjs`, before the final summary block:

```javascript
{
  _log('\ntrack refs — index arithmetic:');
  const { trackRef, trackGroup, trackIndexInGroup, trackKind, chainInstance, HOST_TRACKS } =
    await import('../dist/esm/track/ref.js');

  eq('track 0 is host', trackKind(0), 'host');
  eq('track 3 is host', trackKind(3), 'host');
  /* Stage 1 ships with TRACK_COUNT=4, but the predicate is what Stage 2 turns
   * on — so it is specified now and tested now. */
  eq('track 4 is movy', trackKind(4), 'movy');
  eq('track 15 is movy', trackKind(15), 'movy');

  eq('group of track 0', trackGroup(0), 0);
  eq('group of track 3', trackGroup(3), 0);
  eq('group of track 4', trackGroup(4), 1);
  eq('group of track 15', trackGroup(15), 3);

  eq('index-in-group of 0', trackIndexInGroup(0), 0);
  eq('index-in-group of 5', trackIndexInGroup(5), 1);
  eq('index-in-group of 15', trackIndexInGroup(15), 3);

  /* Chain instances are movy-side only and 0-based: track 4 is the FIRST movy
   * chain, not the fifth. Getting this offset wrong would address the wrong
   * synth on every movy track. */
  eq('chain instance of track 4', chainInstance(4), 0);
  eq('chain instance of track 15', chainInstance(15), 11);
  eq('host tracks have no chain instance', chainInstance(3), -1);

  const r = trackRef(6);
  eq('trackRef carries index', r.index, 6);
  eq('trackRef carries kind', r.kind, 'movy');
  eq('HOST_TRACKS is 4', HOST_TRACKS, 4);
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run build:browser && node browser-test/logic.mjs
```
Expected: FAIL — `Cannot find module '../dist/esm/track/ref.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/track/ref.ts`:

```typescript
/* What a track IS, independent of how you talk to it.
 *
 * Movy's tracks used to be schwung shadow slots, so "track" and "slot" were the
 * same number everywhere. They stop being the same thing once movy hosts chains
 * of its own, and this file is where that distinction is defined once. */

/** Tracks backed by a schwung shadow slot. Their index IS their slot number. */
export const HOST_TRACKS = 4;

/* Stage 1 keeps this at 4. Stage 2 raises it to 16 together with the engine's
 * NUM_TRACKS — moving one without the other makes the UI and the engine
 * disagree about how many tracks exist. */
export const TRACK_COUNT = 4;

/** Tracks per group: the 4 track buttons, and one row of the session grid. */
export const GROUP_SIZE = 4;

export type TrackKind = 'host' | 'movy';

export interface TrackRef {
    index: number;
    kind:  TrackKind;
}

export function trackKind(index: number): TrackKind {
    return index < HOST_TRACKS ? 'host' : 'movy';
}

export function trackRef(index: number): TrackRef {
    return { index, kind: trackKind(index) };
}

export function trackGroup(index: number): number {
    return Math.floor(index / GROUP_SIZE);
}

export function trackIndexInGroup(index: number): number {
    return index % GROUP_SIZE;
}

/** Movy-side chain instance for a track, or -1 for a host track. 0-based: the
 *  first movy track (index 4) is chain instance 0. */
export function chainInstance(index: number): number {
    return index < HOST_TRACKS ? -1 : index - HOST_TRACKS;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run build:browser && node browser-test/logic.mjs
```
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add src/track/ref.ts browser-test/logic.mjs
git commit -m "feat(track): add TrackRef and index arithmetic"
```

---

### Task 2: `TrackPort` and `HostSlotPort`

**Files:**
- Create: `src/track/port.ts`, `src/track/host-port.ts`, `src/track/registry.ts`
- Modify: `browser-test/logic.mjs` (allowlist at :9878, plus a new test block)

**Interfaces:**
- Consumes: `TrackRef`, `trackRef` (Task 1).
- Produces: `TrackPort` interface with `track: TrackRef`, `getParam(key): string | null`, `setParam(key, value): boolean`, `setParamTimeout(key, value, timeoutMs): boolean`, `getMany(keys: string[]): (string | null)[]`, `setMany(pairs: [string, string][]): boolean`, `sendMidi(statusType: number, d1: number, d2: number): void`. Plus `portFor(index: number): TrackPort` and `resetPorts(): void` from `registry.ts`.

**Why `sendMidi` takes a status *type*, not a full status byte:** `shadow_send_midi_to_dsp` has no slot argument — a host track is addressed by the MIDI **channel** in the status byte (`step-rec-preview.ts:45` sends `MidiNoteOn | t`). The port owns that channel so no call site has to remember to OR it in, and the movy implementation can route by instance instead.

- [ ] **Step 1: Write the failing test**

Append to `browser-test/logic.mjs`:

```javascript
{
  _log('\ntrack ports — host port wraps the shadow API:');
  const { portFor, resetPorts } = await import('../dist/esm/track/registry.js');

  const gets = [], sets = [], midi = [];
  const origGet = globalThis.shadow_get_param;
  const origSet = globalThis.shadow_set_param;
  const origMidi = globalThis.shadow_send_midi_to_dsp;
  globalThis.shadow_get_param = (slot, key) => { gets.push([slot, key]); return 'v:' + key; };
  globalThis.shadow_set_param = (slot, key, val) => { sets.push([slot, key, val]); return true; };
  globalThis.shadow_send_midi_to_dsp = (m) => { midi.push(m.slice()); };

  resetPorts();
  const p2 = portFor(2);

  eq('port knows its track', p2.track.index, 2);
  eq('port knows its kind', p2.track.kind, 'host');

  eq('getParam returns the value', p2.getParam('synth:cutoff'), 'v:synth:cutoff');
  eq('getParam addressed the right slot', gets[0][0], 2);
  eq('getParam passed the key through', gets[0][1], 'synth:cutoff');

  p2.setParam('synth:cutoff', '0.5');
  eq('setParam addressed the right slot', sets[0][0], 2);
  eq('setParam passed key/value', sets[0][1] + '=' + sets[0][2], 'synth:cutoff=0.5');

  /* getMany is one call per key for a host track — the batching only pays off
   * for movy chains. What matters here is that the ORDER of results matches the
   * order of keys, because callers index into it positionally. */
  gets.length = 0;
  const many = p2.getMany(['a', 'b', 'c']);
  eq('getMany returns one result per key', many.length, 3);
  eq('getMany preserves order', many.join(','), 'v:a,v:b,v:c');
  eq('getMany issued one get per key', gets.length, 3);

  /* The channel is the port's job: a caller passes the TYPE nibble only. */
  p2.sendMidi(0x90, 60, 100);
  eq('sendMidi ORs in the track channel', midi[0][0], 0x92);
  eq('sendMidi passes pitch', midi[0][1], 60);
  eq('sendMidi passes velocity', midi[0][2], 100);

  /* Ports are cached: rebuilding one per call would allocate on every param
   * read, and reads happen per tick. */
  eq('portFor caches', portFor(2) === p2, true);

  globalThis.shadow_get_param = origGet;
  globalThis.shadow_set_param = origSet;
  globalThis.shadow_send_midi_to_dsp = origMidi;
  resetPorts();
}
```

Also add to the `ALLOWED` map at `browser-test/logic.mjs:9878`:

```javascript
        'src/track/host-port.ts':       'the host-track door — writes go through setChainParam above it',
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run build:browser && node browser-test/logic.mjs
```
Expected: FAIL — cannot find `../dist/esm/track/registry.js`.

- [ ] **Step 3: Write minimal implementation**

Create `src/track/port.ts`:

```typescript
/* How you talk to a track, whichever kind it is.
 *
 * Every consumer in src/ goes through this interface, so adding movy-hosted
 * tracks later means adding one implementation rather than revisiting ~62 call
 * sites. The method set is deliberately narrow: it is what the UI actually
 * needs, not a mirror of the schwung API. */

import type { TrackRef } from './ref.js';

export interface TrackPort {
    readonly track: TrackRef;

    getParam(key: string): string | null;
    setParam(key: string, value: string): boolean;
    setParamTimeout(key: string, value: string, timeoutMs: number): boolean;

    /** Read several keys at once. Results are positional: one entry per key, in
     *  the order asked. A host track loops; a movy chain collapses these into a
     *  single bulk round trip, which is why the batch shape exists at all. */
    getMany(keys: string[]): (string | null)[];
    setMany(pairs: [string, string][]): boolean;

    /** `statusType` is the type nibble alone (0x90, 0x80, 0xB0). The port adds
     *  the channel — a host track is addressed BY its channel, so leaving that
     *  to callers is how notes end up on the wrong track. */
    sendMidi(statusType: number, d1: number, d2: number): void;
}
```

Create `src/track/host-port.ts`:

```typescript
/* A track backed by a schwung shadow slot: index === slot number.
 *
 * Every method here is exactly what its call sites did inline before this
 * existed. The value is not in the code, it is in there being one place that
 * knows a host track is a slot. */

import type { TrackPort } from './port.js';
import { trackRef, type TrackRef } from './ref.js';

export class HostSlotPort implements TrackPort {
    readonly track: TrackRef;

    constructor(index: number) {
        this.track = trackRef(index);
    }

    getParam(key: string): string | null {
        if (typeof shadow_get_param !== 'function') return null;
        return shadow_get_param(this.track.index, key);
    }

    setParam(key: string, value: string): boolean {
        if (typeof shadow_set_param !== 'function') return false;
        return shadow_set_param(this.track.index, key, value);
    }

    setParamTimeout(key: string, value: string, timeoutMs: number): boolean {
        if (typeof shadow_set_param_timeout !== 'function') return this.setParam(key, value);
        return shadow_set_param_timeout(this.track.index, key, value, timeoutMs);
    }

    getMany(keys: string[]): (string | null)[] {
        const out: (string | null)[] = [];
        for (const k of keys) out.push(this.getParam(k));
        return out;
    }

    setMany(pairs: [string, string][]): boolean {
        let ok = true;
        for (const [k, v] of pairs) if (!this.setParam(k, v)) ok = false;
        return ok;
    }

    sendMidi(statusType: number, d1: number, d2: number): void {
        if (typeof shadow_send_midi_to_dsp !== 'function') return;
        shadow_send_midi_to_dsp([statusType | this.track.index, d1, d2]);
    }
}
```

Create `src/track/registry.ts`:

```typescript
/* Index -> port, cached.
 *
 * Ports are looked up on every param read, and reads happen per tick — building
 * one per call would allocate in the hot path. */

import { HostSlotPort } from './host-port.js';
import type { TrackPort } from './port.js';
import { trackKind } from './ref.js';

const ports: (TrackPort | undefined)[] = [];

export function portFor(index: number): TrackPort {
    let p = ports[index];
    if (!p) {
        /* Stage 1 is host-only. Stage 3 adds MovyChainPort here; until then a
         * movy index would silently address a slot that does not exist, so it
         * is refused loudly instead. */
        if (trackKind(index) !== 'host') {
            throw new Error('movy-hosted tracks are not implemented yet: track ' + index);
        }
        p = new HostSlotPort(index);
        ports[index] = p;
    }
    return p;
}

/** Drop cached ports. Tests use this to swap the ambient shadow_* globals. */
export function resetPorts(): void {
    ports.length = 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run build:browser && node browser-test/logic.mjs && npm run typecheck
```
Expected: PASS, 0 failures, zero type errors.

- [ ] **Step 5: Commit**

```bash
git add src/track/port.ts src/track/host-port.ts src/track/registry.ts browser-test/logic.mjs
git commit -m "feat(track): add TrackPort interface and HostSlotPort"
```

---

### Task 3: Thread the port through `ModelState`

**Files:**
- Modify: `src/model/state.ts` (add `port`, keep `activeSlot`), `src/model/index.ts:69-70` (`createModel` signature), `src/app/init.ts:36-38`, `src/lfo/model.ts` (its `createLfoModel(slot)` call site)
- Modify: `src/model/store.ts` (11 read sites listed below)
- Test: `browser-test/logic.mjs`

**Interfaces:**
- Consumes: `portFor` (Task 2).
- Produces: `ModelState.port: TrackPort`. `createModel(port: TrackPort, componentKey?: string)` and `createModelState(port: TrackPort, componentKey: string)` — both now take a port where they took a slot number.

`ModelState.activeSlot` stays for this task so the diff is bounded; Task 7 removes it. Both are present and must agree — `activeSlot === port.track.index`.

- [ ] **Step 1: Write the failing test**

Append to `browser-test/logic.mjs`:

```javascript
{
  _log('\nmodel state — reads go through the port:');
  const { createModelState } = await import('../dist/esm/model/state.js');
  const { portFor, resetPorts } = await import('../dist/esm/track/registry.js');

  const gets = [];
  const origGet = globalThis.shadow_get_param;
  globalThis.shadow_get_param = (slot, key) => { gets.push([slot, key]); return '0.25'; };

  resetPorts();
  const s = createModelState(portFor(1), 'synth');
  eq('state carries the port', s.port.track.index, 1);
  eq('activeSlot still agrees with the port', s.activeSlot, 1);

  /* The point of the refactor: a read names a key, not a slot. */
  eq('port read reaches the right slot', s.port.getParam('synth:cutoff'), '0.25');
  eq('the slot came from the port', gets[0][0], 1);

  globalThis.shadow_get_param = origGet;
  resetPorts();
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run build:browser && node browser-test/logic.mjs
```
Expected: FAIL — `createModelState` takes a number; `s.port` is undefined.

- [ ] **Step 3: Write minimal implementation**

In `src/model/state.ts`, add to the `ModelState` interface, directly above `activeSlot`:

```typescript
    /* How this model talks to its track. Everything below that used to take
     * `activeSlot` as a slot number now asks the port instead — that is what
     * lets a movy-hosted track reuse this whole layer unchanged. */
    port:                TrackPort;
```

Add the import at the top of `src/model/state.ts`:

```typescript
import type { TrackPort } from '../track/port.js';
```

Change `createModelState`'s signature and the two fields it sets:

```typescript
export function createModelState(port: TrackPort, componentKey: string): ModelState {
    return {
        port,
        activeSlot: port.track.index,
        componentKey,
        // ...everything else unchanged
```

In `src/model/index.ts:69-70`:

```typescript
export function createModel(port: TrackPort, componentKey = 'synth') {
    const s = createModelState(port, componentKey);
```

...with `import type { TrackPort } from '../track/port.js';` added to its imports.

In `src/app/init.ts:36-38`, replace the slot numbers with ports:

```typescript
        CHAIN_SLOTS.map((s, i) => isLfoSlot(i)
            ? createLfoModel(slot)
            : createModel(portFor(slot), s.componentKey))
    );
    appState.masterFxModels  = MASTER_FX_SLOTS.map(s => createModel(portFor(0), s.componentKey));
```

...with `import { portFor } from '../track/registry.js';` added.

Then in `src/model/store.ts`, replace each of these reads. The pattern is identical at every site: `shadow_get_param(s.activeSlot, X)` becomes `s.port.getParam(X)`.

- `:77` — `s.enumFmt[gi] = enumUsesIndex(p.options, s.port.getParam(s.componentKey + ':' + ioKey));`
- `:147` — `const raw = s.port.getParam(s.componentKey + ':' + ioKey);`
- `:219` — `const raw = s.port.getParam(s.componentKey + ':' + ioKey);`
- `:293` — `const path = s.port.getParam(s.componentKey + ':' + ioKey);`
- `:301` — `const raw = s.port.getParam(s.componentKey + ':' + ioKey);`
- `:323-324` — `const name = s.port.getParam(s.componentKey + ':name') || s.port.getParam(moduleReadKey(s.componentKey))`
- `:341-342` — `if (s.port.getParam('lfo' + i + ':target') === s.componentKey) { const tp = s.port.getParam('lfo' + i + ':target_param');`

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run build:browser && node browser-test/logic.mjs && npm run typecheck
```
Expected: PASS, 0 failures. `typecheck` will still report errors in files not yet migrated — that is expected only if they reference the old `createModel(number, …)` signature; fix those call sites now, do not leave the build red.

- [ ] **Step 5: Run the wider local suite**

```bash
node browser-test/app-loop.mjs && node browser-test/dump-replay.mjs
```
Expected: 0 failures in both. These replay real module metadata through `store.ts`, so they are what proves the read migration is behaviour-neutral.

- [ ] **Step 6: Commit**

```bash
git add src/model/state.ts src/model/index.ts src/model/store.ts src/app/init.ts browser-test/logic.mjs
git commit -m "refactor(model): read chain params through TrackPort"
```

---

### Task 4: Migrate the remaining model readers

**Files:**
- Modify: `src/model/viewmodel.ts:101,264`, `src/model/meta-retry.ts:38,48`, `src/model/preset-param.ts:14,19,21,24`, `src/model/hierarchy.ts:35,74,83,124`

**Interfaces:**
- Consumes: `ModelState.port` (Task 3).
- Produces: nothing new — this completes the read migration.

- [ ] **Step 1: Write the failing test**

Append to `browser-test/logic.mjs`:

```javascript
{
  _log('\nmodel readers — no direct slot reads remain in model/:');
  /* Guard, not a behaviour test. Once model/ reads through the port, a NEW
   * direct read is a regression that reintroduces the slot assumption — and it
   * would work fine on host tracks and fail only on movy ones, which is exactly
   * the bug that is expensive to find later. */
  const { readdirSync, readFileSync } = await import('fs');
  const ALLOWED_DIRECT_READ = {
    'src/model/hierarchy.ts': 'setOnLoad seeds run before the port is reachable',
  };
  const offenders = readdirSync('src/model')
    .filter((f) => f.endsWith('.ts'))
    .map((f) => 'src/model/' + f)
    .filter((f) => !(f in ALLOWED_DIRECT_READ))
    .filter((f) => readFileSync(f, 'utf8').includes('shadow_get_param('));
  eq('no model file reads params by slot: ' + offenders.join(','), offenders.length, 0);
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run build:browser && node browser-test/logic.mjs
```
Expected: FAIL, listing `viewmodel.ts`, `meta-retry.ts`, `preset-param.ts`.

- [ ] **Step 3: Write minimal implementation**

Same mechanical substitution as Task 3 — `shadow_get_param(s.activeSlot, X)` → `s.port.getParam(X)`:

- `viewmodel.ts:101` — `? (s.port.getParam(s.componentKey + ':' + p.nameKey) ?? formatValue(p, v))`
- `viewmodel.ts:264` — `tv = s.port.getParam(s.componentKey + ':' + p.nameKey) ?? formatValue(p, s.knobValues[gi]);`
- `meta-retry.ts:38` — `const raw = s.port.getParam(s.componentKey + ':preset_count');`
- `meta-retry.ts:48` — `const raw = s.port.getParam(s.componentKey + ':chain_params');`
- `preset-param.ts:14` — `const countRaw = s.port.getParam(s.componentKey + ':' + countParam);`
- `preset-param.ts:19` — `const namesRaw = s.port.getParam(s.componentKey + ':preset_names');`
- `preset-param.ts:21` — `if (!allNames && s.port.getParam(s.componentKey + ':preset_name_0') !== null) {`
- `preset-param.ts:24` — `allNames.push(s.port.getParam(s.componentKey + ':preset_name_' + i) ?? String(i));`

In `hierarchy.ts`, migrate the four reads at `:35`, `:74`, `:83` and `:124` the same way, but **leave the `setOnLoad` write at `:52`** — it is on the allowlist and Task 5 handles writes.

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run build:browser && node browser-test/logic.mjs && node browser-test/dump-replay.mjs && npm run typecheck
```
Expected: PASS, 0 failures in both suites, zero type errors.

- [ ] **Step 5: Commit**

```bash
git add src/model/ browser-test/logic.mjs
git commit -m "refactor(model): complete param read migration to TrackPort"
```

---

### Task 5: Route writes through the port

**Files:**
- Modify: `src/chain/set-param.ts` (both exported functions), all `setChainParam` / `setChainParamUntracked` call sites, `browser-test/logic.mjs:9878` (allowlist)

**Interfaces:**
- Consumes: `TrackPort` (Task 2).
- Produces: `setChainParam(port: TrackPort, key: string, value: string, oldVal: string | null): boolean` and `setChainParamUntracked(port: TrackPort, key: string, value: string): boolean` — both take a port where they took a slot number.

Undo still records `port.track.index`, which for a host track **is** the slot — so no undo-history format change and no persistence break.

- [ ] **Step 1: Write the failing test**

Append to `browser-test/logic.mjs`:

```javascript
{
  _log('\nchain writes — the chokepoint takes a port:');
  const { setChainParam } = await import('../dist/esm/chain/set-param.js');
  const { portFor, resetPorts } = await import('../dist/esm/track/registry.js');

  const sets = [];
  const origSet = globalThis.shadow_set_param;
  globalThis.shadow_set_param = (slot, key, val) => { sets.push([slot, key, val]); return true; };

  resetPorts();
  setChainParam(portFor(3), 'synth:cutoff', '0.8', '0.2');
  eq('write reached the port\'s slot', sets[0][0], 3);
  eq('write passed key', sets[0][1], 'synth:cutoff');
  eq('write passed value', sets[0][2], '0.8');

  globalThis.shadow_set_param = origSet;
  resetPorts();
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run build:browser && node browser-test/logic.mjs
```
Expected: FAIL — `setChainParam` receives an object where it expects a slot number, so `shadow_set_param` is called with `[object Object]` as the slot.

- [ ] **Step 3: Write minimal implementation**

Rewrite the two functions in `src/chain/set-param.ts`:

```typescript
export function setChainParam(port: TrackPort, key: string,
                              value: string, oldVal: string | null): boolean {
    /* Undo records the track INDEX, which for a host track is its slot number —
     * so existing undo history stays readable across this refactor. */
    if (oldVal !== null && oldVal !== value) recordParamOp(port.track.index, key, oldVal, value);
    return port.setParam(key, value);
}

export function setChainParamUntracked(port: TrackPort, key: string, value: string): boolean {
    return port.setParam(key, value);
}
```

...with `import type { TrackPort } from '../track/port.js';` added, and the now-unused `shadow_set_param` typeof guards dropped (the port owns them).

Then update every call site. Find them with:

```bash
grep -rn "setChainParam\|setChainParamUntracked" src --include=*.ts | grep -v "chain/set-param.ts"
```

At each one, replace the leading slot argument with a port: inside a model, `s.port`; elsewhere, `portFor(<the slot expression that was there>)`.

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run build:browser && node browser-test/logic.mjs && npm run typecheck
```
Expected: PASS, 0 failures, zero type errors.

- [ ] **Step 5: Shrink the allowlist**

Every file that now writes through the port has stopped calling `shadow_set_param(` directly, and the guard's staleness check turns that into a failure until the allowlist matches. Remove entries that no longer write, keeping only those that genuinely still do. Re-run:

```bash
node browser-test/logic.mjs
```
Expected: both `no unlisted file writes chain params directly` and `no stale allowlist entries` pass. **The shrunken allowlist is the evidence that the write migration is complete** — do not add entries back to make it pass.

- [ ] **Step 6: Commit**

```bash
git add src/ browser-test/logic.mjs
git commit -m "refactor(chain): route param writes through TrackPort"
```

---

### Task 6: Route live MIDI through the port

**Files:**
- Modify: `src/keyboard/release.ts` (`emitNoteOff`), `src/keyboard/handler.ts`, `src/keyboard/drum-handler.ts`, `src/seq/step-rec-preview.ts:45`
- Test: `browser-test/logic.mjs`, `browser-test/app-loop.mjs`

**Interfaces:**
- Consumes: `portFor` (Task 2), `TrackPort.sendMidi` (Task 2).
- Produces: nothing new.

**Do not change note-off semantics.** `emitNoteOff` derives its track from the held-note **ledger**, never from current state — deriving it at release time strands notes whenever the active track changed mid-hold. This task changes only *how* the message is sent, not where the track comes from.

- [ ] **Step 1: Write the failing test**

Append to `browser-test/logic.mjs`:

```javascript
{
  _log('\nlive MIDI — sent through the port, channel from the ledger:');
  const { readdirSync, readFileSync } = await import('fs');
  /* The ledger rule is what this guard protects: if a call site goes back to
   * building its own status byte, it is one step from deriving the track at
   * release time, which strands notes. */
  const offenders = ['src/keyboard', 'src/seq']
    .flatMap((d) => readdirSync(d).filter((f) => f.endsWith('.ts')).map((f) => d + '/' + f))
    .filter((f) => readFileSync(f, 'utf8').includes('shadow_send_midi_to_dsp('));
  eq('no file sends DSP MIDI directly: ' + offenders.join(','), offenders.length, 0);
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run build:browser && node browser-test/logic.mjs
```
Expected: FAIL, listing `src/keyboard/release.ts` and `src/seq/step-rec-preview.ts`.

- [ ] **Step 3: Write minimal implementation**

In `src/keyboard/release.ts`, `emitNoteOff` currently builds the status byte itself. The track still comes from the ledger entry; only the send changes:

```typescript
    portFor(track).sendMidi(MidiNoteOff, pitch, 0);
```

In `src/seq/step-rec-preview.ts:45`:

```typescript
        portFor(t).sendMidi(MidiNoteOn, pitch, vel);
```

Apply the same substitution in `handler.ts` and `drum-handler.ts`, adding `import { portFor } from '../track/registry.js';` to each.

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run build:browser && node browser-test/logic.mjs && node browser-test/app-loop.mjs
```
Expected: PASS, 0 failures. `app-loop.mjs` drives the full init/tick/MIDI loop, so it is what confirms notes still sound on the right channel.

- [ ] **Step 5: Commit**

```bash
git add src/keyboard/ src/seq/step-rec-preview.ts browser-test/logic.mjs
git commit -m "refactor(keyboard): send live notes through TrackPort"
```

---

### Task 7: `appState.activeTrack` replaces `activeSlot`

**Files:**
- Modify: `src/app/state.ts:33`, then every reader of `appState.activeSlot` (97 references across 16 files — see command below)
- Modify: `src/model/state.ts` (drop `activeSlot` from `ModelState`)
- Test: `browser-test/logic.mjs`

**Interfaces:**
- Consumes: `TrackRef`, `trackRef` (Task 1).
- Produces: `appState.activeTrack: TrackRef`. `appState.activeSlot` no longer exists.

- [ ] **Step 1: Write the failing test**

Append to `browser-test/logic.mjs`:

```javascript
{
  _log('\napp state — the active track is a TrackRef:');
  const { appState } = await import('../dist/esm/app/state.js');
  eq('activeTrack exists', typeof appState.activeTrack, 'object');
  eq('activeTrack has an index', appState.activeTrack.index, 0);
  eq('activeTrack has a kind', appState.activeTrack.kind, 'host');
  /* The old field must be GONE, not aliased: a lingering alias is how half the
   * codebase keeps the slot assumption alive through Stage 2. */
  eq('activeSlot is removed', 'activeSlot' in appState, false);
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run build:browser && node browser-test/logic.mjs
```
Expected: FAIL — `activeTrack` is undefined and `activeSlot` is still present.

- [ ] **Step 3: Write minimal implementation**

In `src/app/state.ts`, replace `activeSlot: 0,` with:

```typescript
    activeTrack:      trackRef(0),
```

...and add `import { trackRef } from '../track/registry.js';` — actually from `'../track/ref.js'`.

Enumerate the readers:

```bash
grep -rn "appState.activeSlot" src --include=*.ts
```

Migrate each by what it actually wants:

- **Wants a port** (param read/write): `portFor(appState.activeTrack.index)`, or the model's own `s.port`.
- **Wants an index** (array lookup like `trackModels[…]`, `trackChainIndex[…]`, engine commands): `appState.activeTrack.index`.
- **Wants the ref itself** (passing a track around): `appState.activeTrack`.

Then drop `activeSlot` from the `ModelState` interface and from `createModelState`, replacing its remaining readers with `s.port.track.index`.

- [ ] **Step 4: Run test to verify it passes**

```bash
npm run build:browser && node browser-test/logic.mjs && npm run typecheck
```
Expected: PASS, 0 failures, zero type errors. `typecheck` is the real safety net here — every missed reader is a compile error, not a runtime surprise.

- [ ] **Step 5: Commit**

```bash
git add src/ browser-test/logic.mjs
git commit -m "refactor(app): replace activeSlot with activeTrack TrackRef"
```

---

### Task 8: Full verification

**Files:** none — this task proves the refactor changed nothing.

**Interfaces:**
- Consumes: everything above.
- Produces: a verified branch ready for Stage 2.

- [ ] **Step 1: Run the whole local suite**

```bash
npm test
```
Expected: all six suites, 0 failures. If `screenshot.mjs` reports diffs, **do not** regenerate baselines — a pixel change means behaviour changed, which contradicts this stage's premise. Find the bug instead.

- [ ] **Step 2: Confirm the perf budget held**

```bash
node browser-test/perf.mjs
```
Expected: 0 failures. `getMany` on a host track is one `shadow_get_param` per key, exactly as before, so the per-tick IPC budget (2 gets, held by `store.ts:238`) must be unchanged. A regression here means a port is being constructed in the hot path rather than cached.

- [ ] **Step 3: Check device reachability**

```bash
ssh -o ConnectTimeout=3 ableton@move.local echo ok 2>/dev/null && echo REACHABLE || echo "DEVICE OFFLINE — SKIPPING DEVICE TESTS"
```

- [ ] **Step 4: Run the device suites (if reachable)**

```bash
./scripts/test.sh && ./scripts/test-seq.sh
```
Expected: PASS. These exercise real MIDI routing and IPC — the parts a local suite mocks, and therefore the only real check that `sendMidi`'s channel handling is right on hardware.

If the device is offline, **report that to the user in CAPS** so it is clear device verification was skipped.

- [ ] **Step 5: Push the branch**

```bash
git push -u origin feat/16-track-sequencer
```

---

## Self-Review

**Spec coverage (design §2):** `TrackRef`/`group`/`kind` arithmetic → Task 1. `TrackPort` interface with all six operations → Task 2. `HostSlotPort` mapping each row of the §2 table → Task 2. `appState.activeSlot` → `activeTrack` → Task 7. "~62 call sites route through the port" → Tasks 3-6, enforced by the guard tests rather than by inspection. `CHAIN_SLOTS` unchanged → no task touches it, by design.

**Deliberately out of scope for Stage 1**, per the design's staging table: `MovyChainPort` and bulk IPC (Stage 4), `TRACK_COUNT` → 16 (Stage 2), colours, group focus, session selector (Stage 2), the ABI-parity and palette guard tests (they guard Stage 3/2 code that does not exist yet).

**Known ordering constraint:** Task 5 must land before Task 7, because shrinking the write allowlist depends on call sites already taking ports.
