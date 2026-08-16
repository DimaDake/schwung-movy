# 16 Tracks: Engine + Group UI Implementation Plan (Stage 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Movy sequences 16 tracks. Tracks 5-16 have clips, notes, mutes, automation and session slots, and are reachable through a group-focus UI — but are **silent**, because nothing hosts their audio until Stage 3.

**Architecture:** `NUM_TRACKS` 4→16 in the Rust engine and `TRACK_COUNT` 4→16 in the UI, in the same change so the two never disagree. Movy tracks get an `UnbackedPort` that reads null and drops writes, so every chain/knob page degrades gracefully instead of throwing. The 16 step buttons become a track selector in Session view, octave up/down move the focused group of 4.

**Tech Stack:** Rust (`seq-core`, host-tested with `cargo test`), TypeScript → esbuild, node ESM test suites.

Design doc: `docs/superpowers/specs/2026-08-15-sixteen-track-sequencer-design.md` §3, §4, §5.1, §5.2.
Builds on: `plans/2026-08-15-track-port-abstraction.md` (Stage 1, complete).

## Global Constraints

- **File size:** hard limit 200 lines, target 50-100.
- **Comments explain WHY**, never WHAT.
- **Branch:** `feat/16-track-sequencer`. Never `git add -A`.
- **Every task ends green:** `npm run typecheck` + `node browser-test/logic.mjs`, plus `cargo test` for any task touching `engine/`.
- **cargo is not on PATH.** Use `PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" cargo test`.
- **`ENGINE_VERSION` must match** between `engine/crates/movy-dsp/src/lib.rs` and `src/seq/constants.ts` — `build-dsp.sh` fails the build otherwise. Bump both when the engine's protocol changes.
- **Persistence stays backward compatible.** The `tk`/`cl` line format is track-indexed and guarded by `track < engine.tracks.len()`, so a 4-track save loads into a 16-track engine unchanged. Do not bump `FORMAT_TAG`.

---

### Task 1: Engine — `NUM_TRACKS` 4 → 16

**Files:**
- Modify: `engine/crates/seq-core/src/track.rs:6`
- Test: `engine/crates/seq-core/src/engine.rs` (test module at the bottom)

**Interfaces:**
- Consumes: nothing.
- Produces: `NUM_TRACKS == 16`. `Engine::tracks` is a 16-element `Vec<Track>`.

- [ ] **Step 1: Write the failing test**

Add to the test module in `engine.rs`:

```rust
#[test]
fn engine_has_sixteen_tracks() {
    let e = Engine::new();
    assert_eq!(e.tracks.len(), 16, "engine must expose 16 tracks");
}

#[test]
fn status_reports_every_track() {
    let e = Engine::new();
    let s = e.status();
    let mute = s.split("mute=").nth(1).unwrap().split(' ').next().unwrap();
    assert_eq!(mute.len(), 16, "mute= carries one flag per track");
    let sess = s.split("sess=").nth(1).unwrap().split(' ').next().unwrap();
    assert_eq!(sess.split(',').count(), 16, "sess= carries one group per track");
    let act = s.split("act=").nth(1).unwrap().split(' ').next().unwrap();
    assert_eq!(act.split(',').count(), 16, "act= carries one group per track");
}
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd engine && PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" cargo test
```
Expected: FAIL — `assertion failed: left == 4, right == 16`.

- [ ] **Step 3: Implement**

`track.rs:6`:

```rust
pub const NUM_TRACKS: usize = 16;
```

Then fix every test in `engine.rs` that hardcodes 4 tracks in an expected status string. Find them:

```bash
grep -n '"0000"\|split(.,.).count(), 4\|len(), 4' crates/seq-core/src/*.rs
```

Each is an expectation about width, not about behaviour — widen the literal rather than weakening the assertion.

- [ ] **Step 4: Run to verify it passes**

```bash
cd engine && PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" cargo test
```
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add engine/crates/seq-core/src/
git commit -m "feat(engine): widen NUM_TRACKS to 16"
```

---

### Task 2: UI state — parsers and arrays follow `TRACK_COUNT`

**Files:**
- Modify: `src/track/ref.ts:13` (`TRACK_COUNT` 4→16), `src/seq/state.ts:89,118,119,135,147,154,269`, `src/seq/automation.ts:31`, `src/seq/drum-sync.ts:19`, `src/seq/ui-state.ts:38,47,75`, `src/app/unload.ts:27`, `src/seq/leds.ts:139`
- Test: `browser-test/logic.mjs`

**Interfaces:**
- Consumes: `TRACK_COUNT` (Stage 1).
- Produces: `seqState.muted`, `.lastPitch`, `.lastVel`, `.session` all `TRACK_COUNT` long; `muteFromStr`, `sessionFromStr`, `activeFromStr` parse all 16.

- [ ] **Step 1: Write the failing test**

```javascript
{
  _log('\nseq state — 16 tracks:');
  const { seqState, resetSeqState, muteFromStr, sessionFromStr, activeFromStr, activeHasNote } =
    await import('../dist/esm/seq/state.js');
  const { TRACK_COUNT } = await import('../dist/esm/track/ref.js');
  resetSeqState();

  eq('TRACK_COUNT is 16', TRACK_COUNT, 16);
  eq('mute mirror sized per track', seqState.muted.length, 16);
  eq('session mirror sized per track', seqState.session.length, 16);
  eq('lastPitch sized per track', seqState.lastPitch.length, 16);

  muteFromStr('0000000000000001');
  eq('mute parses the last track', seqState.muted[15], true);
  eq('mute leaves track 0 alone', seqState.muted[0], false);

  /* 16 comma groups; only the last one carries a clip, so a parser that stops
   * at 4 silently reports an empty grid for three quarters of the song. */
  sessionFromStr(new Array(15).fill('0.-.-.0').join(',') + ',ff.2.-.3');
  eq('session parses the last track exist bitmap', seqState.session[15].exist, 0xff);
  eq('session parses the last track playing slot', seqState.session[15].playing, 2);
  eq('session parses the last track selected slot', seqState.session[15].selected, 3);

  activeFromStr(new Array(15).fill('').join(',') + ',60.64');
  eq('active notes parse on the last track', activeHasNote(15, 60), true);
  eq('active notes bounded by track', activeHasNote(14, 60), false);
  resetSeqState();
}
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm run build:browser && node browser-test/logic.mjs
```
Expected: FAIL — `TRACK_COUNT is 16: expected 16, got 4`.

- [ ] **Step 3: Implement**

`src/track/ref.ts`: `TRACK_COUNT = 16`, and delete the "Stage 2 raises it" comment — it has happened.

`src/seq/state.ts`: replace each hardcoded 4 with `TRACK_COUNT`, and build the arrays from it:

```typescript
function emptySession(): SessionTrack[] {
    return Array.from({ length: TRACK_COUNT },
        () => ({ exist: 0, playing: -1, queued: -1, selected: 0 }));
}
```

...with `lastPitch: new Array(TRACK_COUNT).fill(60)`, `lastVel: new Array(TRACK_COUNT).fill(100)`, `muted: new Array(TRACK_COUNT).fill(false)`, and `activeNotes: new Uint8Array(TRACK_COUNT * 128)`.

Each `for (let t = 0; t < 4; t++)` in `state.ts`, `ui-state.ts`, `unload.ts` and `automation.ts:31` becomes `TRACK_COUNT`. `drum-sync.ts:19` becomes `new Array(TRACK_COUNT).fill(false)`.

**Leave `src/seq/leds.ts:139` at 4** — that loop paints the four physical track buttons, not tracks. Add a comment saying so, because it now looks like a bug.

- [ ] **Step 4: Run to verify it passes**

```bash
npm run build:browser && node browser-test/logic.mjs && node browser-test/app-loop.mjs && npm run typecheck
```
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add src/ browser-test/logic.mjs
git commit -m "feat(seq): widen UI track state to 16"
```

---

### Task 3: `UnbackedPort` — movy tracks degrade instead of throwing

**Files:**
- Create: `src/track/unbacked-port.ts`
- Modify: `src/track/registry.ts`
- Test: `browser-test/logic.mjs`

**Interfaces:**
- Consumes: `TrackPort`, `trackRef`.
- Produces: `UnbackedPort` class; `portFor(index)` returns one for any movy track instead of throwing.

**Why this exists:** Stage 2 lets the user select track 5. Nothing hosts its chain until Stage 3, so every param read must answer "nothing loaded" rather than crash the UI.

- [ ] **Step 1: Write the failing test**

```javascript
{
  _log('\nunbacked port — movy tracks before Stage 3:');
  const { portFor, resetPorts } = await import('../dist/esm/track/registry.js');
  resetPorts();
  const p = portFor(7);
  eq('movy track gets a port', p.track.kind, 'movy');
  eq('reads answer empty', p.getParam('synth:cutoff'), null);
  eq('batch reads answer empty', p.getMany(['a', 'b']).join(','), ',');
  eq('writes are refused, not thrown', p.setParam('synth:cutoff', '1'), false);
  /* Must not throw: the tick loop sends note-offs to every track on teardown. */
  p.sendMidi(0x80, 60, 0);
  eq('host tracks still get a real port', portFor(0).track.kind, 'host');
  resetPorts();
}
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm run build:browser && node browser-test/logic.mjs
```
Expected: FAIL — throws "movy-hosted tracks are not implemented yet: track 7".

- [ ] **Step 3: Implement**

Create `src/track/unbacked-port.ts`:

```typescript
/* A movy track with nothing hosting it yet.
 *
 * Stage 2 gives movy tracks clips, notes and mutes but no chain — that arrives
 * in Stage 3. Every param read therefore has to answer "nothing loaded" rather
 * than throw, because the chain and knob pages run for whichever track is
 * selected and must not care which stage we are in. */

import type { TrackPort } from './port.js';
import { trackRef, type TrackRef } from './ref.js';

export class UnbackedPort implements TrackPort {
    readonly track: TrackRef;

    constructor(index: number) {
        this.track = trackRef(index);
    }

    getParam(_key: string): string | null { return null; }
    setParam(_key: string, _value: string): boolean { return false; }
    setParamTimeout(_key: string, _value: string, _timeoutMs: number): boolean { return false; }
    getMany(keys: string[]): (string | null)[] { return keys.map(() => null); }
    setMany(_pairs: [string, string][]): boolean { return false; }
    sendMidi(_statusType: number, _d1: number, _d2: number): void { /* nothing to sound yet */ }
}
```

In `registry.ts`, replace the throw:

```typescript
        p = trackKind(index) === 'host' ? new HostSlotPort(index) : new UnbackedPort(index);
```

- [ ] **Step 4: Run to verify it passes**

```bash
npm run build:browser && node browser-test/logic.mjs && npm run typecheck
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/track/ browser-test/logic.mjs build/browser.mjs
git commit -m "feat(track): add UnbackedPort so movy tracks degrade gracefully"
```

---

### Task 4: 16 track colours

**Files:**
- Modify: `src/seq/colors.ts:19-20`
- Create: `browser-test/track-colors.mjs`
- Modify: `package.json` (add the suite to `npm test`)

**Interfaces:**
- Consumes: nothing.
- Produces: `TRACK_COLOR` / `TRACK_COLOR_DIM` as 16-entry tables; `trackColor(t)` / `trackColorDim(t)` index them modulo 16.

- [ ] **Step 1: Write the failing test**

Create `browser-test/track-colors.mjs`. It is the guardrail from design §6.3: it reads schwung's palette directly, so a renumbering upstream fails here instead of silently repainting movy. Port the scoring from `docs/superpowers/specs/2026-08-15-track-palette-search.mjs` — the CIELAB + dichromat simulation, `L_WEIGHT = 0.35`, and these assertions:

```javascript
/* Index -> hex must still hold upstream. */
const EXPECTED = {
  127: 'FF0000', 7: 'FFFF00', 25: 'FF4DC4', 125: '0000FF',
  15: '0074FC', 3: 'FF9900', 44: '7CDD9F', 21: 'E657E3',
  14: '00FFFF', 23: 'FF0099', 6: 'C19D08', 9: '2C8403',
  12: '159573', 47: '7ACEFC', 27: 'A63421', 5: 'EDF95A',
};
for (const [idx, hex] of Object.entries(EXPECTED)) {
  eq(`palette index ${idx} still ${hex}`, PAL.get(+idx)?.hex.toUpperCase(), hex);
}

/* Within a group and across groups, every pair stays apart under normal
 * vision AND both common red-green deficiencies. 13 is the measured floor. */
const MIN = 13;
for (let r = 0; r < 4; r++)
  for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++)
    ok(`G${r + 1}: ${name(M[r][a])} vs ${name(M[r][b])}`, dist(M[r][a], M[r][b]) >= MIN);
for (let c = 0; c < 4; c++)
  for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++)
    ok(`track ${c + 1}: ${name(M[a][c])} vs ${name(M[b][c])}`, dist(M[a][c], M[b][c]) >= MIN);

/* Clear of the colours the step row already uses, in normal vision. Under
 * deuteranopia yellows collapse onto the playhead green — unavoidable with
 * Move's parity colours, and the playhead is told apart by moving. */
for (const t of M.flat())
  for (const [res, label] of [[11, 'playhead green'], [120, 'note white'], [118, 'light grey']])
    ok(`${name(t)} clear of ${label}`, dE(t, res, 'normal') >= 18);
```

- [ ] **Step 2: Run to verify it fails**

```bash
node browser-test/track-colors.mjs
```
Expected: FAIL — `colors.ts` still has 4 entries, so `M` cannot be built.

- [ ] **Step 3: Implement**

`src/seq/colors.ts`:

```typescript
/* Track colours: 4 groups of 4. Every row (a group's tracks) and every column
 * (the same track index across groups) is pairwise distinct under normal
 * vision and both common red-green deficiencies — browser-test/track-colors.mjs
 * holds that, and also checks these indices still mean what they mean in
 * schwung's palette. Group 1 keeps Move's own track colours. */
export const TRACK_COLOR = [
    127, 7, 25, 125,      // G1 host: Red, Vivid Yellow, Bright Pink, Pure Blue
    15, 3, 44, 21,        // G2: Azure Blue, Bright Orange, Mint Green, Hot Magenta
    14, 23, 6, 9,         // G3: Cyan, Neon Pink, Ochre, Forest Green
    12, 47, 27, 5,        // G4: Teal Green, Sky Blue, Rust Red, Light Yellow
];
export const TRACK_COLOR_DIM = [
    67, 77, 113, 99,
    93, 75, 89, 105,
    89, 109, 75, 81,
    87, 17, 67, 77,
];

export function trackColor(track: number): number {
    return TRACK_COLOR[track & 15];
}

export function trackColorDim(track: number): number {
    return TRACK_COLOR_DIM[track & 15];
}
```

Add `node browser-test/track-colors.mjs` to the `test` script in `package.json`.

- [ ] **Step 4: Run to verify it passes**

```bash
node browser-test/track-colors.mjs && node browser-test/screenshot.mjs
```
Expected: colour suite passes. **`screenshot.mjs` will report diffs** for any scene showing a track colour — inspect them, confirm the change is the intended recolour and nothing else, then `node browser-test/screenshot.mjs --update`.

- [ ] **Step 5: Commit**

```bash
git add src/seq/colors.ts browser-test/track-colors.mjs browser-test/screenshots/baseline package.json
git commit -m "feat(seq): 16 track colours, verified for colour-blind separation"
```

---

### Task 5: Group focus state

**Files:**
- Modify: `src/app/state.ts` (add `focusGroup`), `src/app/init.ts`, `src/midi/router.ts` (track buttons at `TRACK_CC_START`)
- Test: `browser-test/logic.mjs`

**Interfaces:**
- Consumes: `trackGroup`, `GROUP_SIZE`, `trackRef`.
- Produces: `appState.focusGroup: number`; `selectTrack(index: number): void` exported from `src/track/focus.ts`, which sets both `activeTrack` and `focusGroup`.

- [ ] **Step 1: Write the failing test**

```javascript
{
  _log('\ngroup focus:');
  const { appState } = await import('../dist/esm/app/state.js');
  const { selectTrack, focusedTrack } = await import('../dist/esm/track/focus.js');

  selectTrack(0);
  eq('selecting track 0 focuses group 0', appState.focusGroup, 0);

  /* Selecting a track must refocus the group, or the four track buttons would
   * keep addressing a different quartet than the one on screen. */
  selectTrack(9);
  eq('selecting track 9 sets it active', appState.activeTrack.index, 9);
  eq('selecting track 9 refocuses group 2', appState.focusGroup, 2);

  /* Track buttons address within the focused group. */
  eq('button 0 in group 2 is track 8', focusedTrack(0), 8);
  eq('button 3 in group 2 is track 11', focusedTrack(3), 11);
  selectTrack(0);
}
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm run build:browser && node browser-test/logic.mjs
```
Expected: FAIL — cannot find `track/focus.js`.

- [ ] **Step 3: Implement**

Create `src/track/focus.ts`:

```typescript
/* Which track is being edited, and which quartet the four track buttons and the
 * session grid address.
 *
 * These two always move together: selecting a track from the step-row selector
 * has to refocus the group, otherwise the track buttons keep addressing a
 * different quartet than the one on screen. */

import { appState } from '../app/state.js';
import { GROUP_SIZE, trackGroup, trackRef } from './ref.js';

export function selectTrack(index: number): void {
    appState.activeTrack = trackRef(index);
    appState.focusGroup  = trackGroup(index);
}

/** Track addressed by track button `n` (0-3) in the focused group. */
export function focusedTrack(n: number): number {
    return appState.focusGroup * GROUP_SIZE + n;
}
```

Add `focusGroup: 0,` to `appState`, and route the track-button branch in `midi/router.ts` through `selectTrack(focusedTrack(d1 - TRACK_CC_END))` — note the existing mapping is **reversed** (`TRACK_CC_START = 40` is slot 3, `TRACK_CC_END = 43` is slot 0), so keep that arithmetic and only change what it feeds.

- [ ] **Step 4: Run to verify it passes**

```bash
npm run build:browser && node browser-test/logic.mjs && node browser-test/app-loop.mjs && npm run typecheck
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ browser-test/logic.mjs build/browser.mjs
git commit -m "feat(track): add group focus and selectTrack"
```

---

### Task 6: Session view — the step row becomes the track selector

**Files:**
- Modify: `src/seq/leds.ts:206-215` (the session branch), `src/seq/router-steps.ts` (step press in session mode)
- Test: `browser-test/logic.mjs`, `browser-test/screenshot.mjs`

**Interfaces:**
- Consumes: `selectTrack`, `trackColor`, `trackColorDim`, `appState.focusGroup`.
- Produces: `sessionStepColor(step: number, focusGroup: number, activeIndex: number): number` exported from `src/seq/track-select.ts`, and `sessionStepPress(step: number): void`.

- [ ] **Step 1: Write the failing test**

```javascript
{
  _log('\nsession track selector:');
  const { sessionStepColor } = await import('../dist/esm/seq/track-select.js');
  const { TRACK_COLOR, TRACK_COLOR_DIM } = await import('../dist/esm/seq/colors.js');

  /* The focused quad is full brightness; everything else is that track's own
   * dim colour. The BRIGHT QUAD'S POSITION is what identifies the group —
   * colour is the backup cue, not the only one. */
  eq('focused group step is bright', sessionStepColor(4, 1, 4), TRACK_COLOR[4]);
  eq('focused group last step is bright', sessionStepColor(7, 1, 4), TRACK_COLOR[7]);
  eq('unfocused step is dim', sessionStepColor(0, 1, 4), TRACK_COLOR_DIM[0]);
  eq('unfocused far step is dim', sessionStepColor(15, 1, 4), TRACK_COLOR_DIM[15]);
}
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm run build:browser && node browser-test/logic.mjs
```
Expected: FAIL — cannot find `seq/track-select.js`.

- [ ] **Step 3: Implement**

Create `src/seq/track-select.ts`:

```typescript
/* Session view turns the 16 step buttons into a track selector.
 *
 * The focused group's four steps burn at full track colour and the other twelve
 * sit at their own dim colour, so the group is read from WHERE the bright quad
 * is — position, not hue. That matters because four of the sixteen colours have
 * to be told apart by someone with a red-green deficiency, and position is the
 * cue that never fails. */

import { appState } from '../app/state.js';
import { GROUP_SIZE, TRACK_COUNT, trackGroup } from '../track/ref.js';
import { selectTrack } from '../track/focus.js';
import { trackColor, trackColorDim } from './colors.js';

export function sessionStepColor(step: number, focusGroup: number, _activeIndex: number): number {
    if (step < 0 || step >= TRACK_COUNT) return 0;
    return trackGroup(step) === focusGroup ? trackColor(step) : trackColorDim(step);
}

export function sessionStepPress(step: number): void {
    if (step < 0 || step >= TRACK_COUNT) return;
    selectTrack(step);
    appState.dirty = true;
}

/** First track of the group `dir` steps away, or -1 when there is none. */
export function groupStep(dir: number): number {
    const g = appState.focusGroup + dir;
    if (g < 0 || g * GROUP_SIZE >= TRACK_COUNT) return -1;
    return g * GROUP_SIZE;
}
```

In `leds.ts`, replace the "paint the step row black" loop in the session branch with `cachedSetLED(STEP_NOTE_BASE + i, sessionStepColor(i, appState.focusGroup, appState.activeTrack.index))`.

In `router-steps.ts`, a step press while `seqState.sessionMode` calls `sessionStepPress(step)` and returns before any note-entry handling.

- [ ] **Step 4: Run to verify it passes**

```bash
npm run build:browser && node browser-test/logic.mjs && node browser-test/app-loop.mjs
```
Expected: PASS.

- [ ] **Step 5: Add a screenshot scene**

Add a `screenshot.mjs` scene rendering Session view with group 2 focused, so the selector's appearance is pinned. Then:

```bash
node browser-test/screenshot.mjs --update && node browser-test/screenshot.mjs
```

- [ ] **Step 6: Commit**

```bash
git add src/seq/ browser-test/ build/browser.mjs
git commit -m "feat(seq): session step row selects tracks"
```

---

### Task 7: Octave up/down switch groups; Session-held + step selects

**Files:**
- Modify: `src/midi/router.ts` (octave buttons, Session-held branch), `src/seq/buttons.ts` (LED affordance)
- Test: `browser-test/logic.mjs`, `browser-test/app-loop.mjs`

**Interfaces:**
- Consumes: `groupStep`, `selectTrack`, `sessionActive`.
- Produces: `groupArrowColor(dir: number): number` in `src/seq/buttons.ts`.

- [ ] **Step 1: Write the failing test**

```javascript
{
  _log('\ngroup navigation affordances:');
  const { groupArrowColor } = await import('../dist/esm/seq/buttons.js');
  const { WHITE_DIM, WHITE_OFF } = await import('../dist/esm/seq/colors.js');
  const { appState } = await import('../dist/esm/app/state.js');
  const { selectTrack } = await import('../dist/esm/track/focus.js');

  /* Same rule the bar arrows use: dim means pressable, off means travel limit. */
  selectTrack(0);
  eq('at the first group, down is off', groupArrowColor(-1), WHITE_OFF);
  eq('at the first group, up is dim', groupArrowColor(1), WHITE_DIM);
  selectTrack(15);
  eq('at the last group, up is off', groupArrowColor(1), WHITE_OFF);
  eq('at the last group, down is dim', groupArrowColor(-1), WHITE_DIM);
  selectTrack(0);
}
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm run build:browser && node browser-test/logic.mjs
```
Expected: FAIL — `groupArrowColor` is not exported.

- [ ] **Step 3: Implement**

In `src/seq/buttons.ts`:

```typescript
/** Octave up/down move the focused group in Session view. Off at the travel
 *  limit, dim when a move exists — the same affordance rule as the bar arrows,
 *  so "lit means pressable" stays true everywhere. */
export function groupArrowColor(dir: number): number {
    return groupStep(dir) >= 0 ? WHITE_DIM : WHITE_OFF;
}
```

In `midi/router.ts`, the octave-button branch checks `sessionActive()` first: in Session view it calls `selectTrack(groupStep(dir))` when that is `>= 0`; otherwise it falls through to the existing `changeOctave` behaviour untouched.

The Session-held + step gesture: `router-steps.ts` already sees the press. Route it to `sessionStepPress(step)` when the Note/Session button is physically held, which `momentaryDown` already records — this is one more consumer of that state, not a new mechanism.

- [ ] **Step 4: Run to verify it passes**

```bash
npm run build:browser && node browser-test/logic.mjs && node browser-test/app-loop.mjs && npm run typecheck
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ browser-test/
git commit -m "feat(seq): octave buttons switch track groups in Session view"
```

---

### Task 8: Status protocol cost — measure, then decide

**Files:**
- Modify: `browser-test/perf.mjs`
- Possibly modify: `src/seq/engine.ts`, `engine/crates/seq-core/src/engine.rs`

**Interfaces:**
- Consumes: the widened status string.
- Produces: a perf assertion bounding status-parse cost.

**The design (§5.2) assumed the 4× wider status must be split** — focused group in the normal poll, the rest on demand. That was a prediction, not a measurement. Measure first: if parsing 16 tracks costs no more than a fraction of a tick, the split is complexity buying nothing, and full freshness is strictly better.

- [ ] **Step 1: Write the measurement**

Add to `perf.mjs` a benchmark that calls `parseStatusForTest` with a realistic 16-track status string 1000 times and asserts a per-parse budget, plus a comparison against a 4-track string:

```javascript
{
  const s16 = buildStatus(16), s4 = buildStatus(4);
  const t16 = timeIt(() => parseStatusForTest(s16), 1000);
  const t4  = timeIt(() => parseStatusForTest(s4), 1000);
  log(`status parse: 4 tracks ${t4.toFixed(3)}ms, 16 tracks ${t16.toFixed(3)}ms`);
  ok('16-track status parse stays under 0.5ms', t16 < 0.5);
  ok('16-track parse is not more than 4x the 4-track cost', t16 < t4 * 4 + 0.05);
}
```

- [ ] **Step 2: Run it and read the numbers**

```bash
node browser-test/perf.mjs
```

- [ ] **Step 3: Decide from the measurement**

- **If both assertions pass:** keep the full-16 status. Record in the design doc that §5.2's split was measured unnecessary, with the numbers. This is the expected outcome — the poll is every 8 ticks and IPC (~0.3 ms) already dominates parsing.
- **If either fails:** implement §5.2 as designed — status carries the focused group + watched track, and a `sessall` command fetches the rest when `focusGroup` changes or Session view opens.

Do not skip the measurement and implement the split "to be safe": that is how a design's guess becomes permanent complexity.

- [ ] **Step 4: Commit**

```bash
git add browser-test/perf.mjs docs/superpowers/specs/
git commit -m "perf: bound 16-track status parse cost"
```

---

### Task 9: Full verification

- [ ] **Step 1: Local suite**

```bash
npm test
```
Expected: all suites green. Screenshot diffs are expected **only** from Task 4's recolour and Task 6's new scene; anything else is a regression.

- [ ] **Step 2: Engine tests**

```bash
cd engine && PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" cargo test
```

- [ ] **Step 3: Device**

```bash
ssh -o ConnectTimeout=3 ableton@move.local echo ok 2>/dev/null \
  && ./scripts/test.sh && ./scripts/test-seq.sh \
  || echo "DEVICE OFFLINE — SKIPPING DEVICE TESTS"
```
`test-seq.sh` deploys `dsp.so`, so it is the one that proves the widened engine actually runs on hardware. If the device is offline, report it in CAPS.

- [ ] **Step 4: Docs**

Update `MANUAL.md` — the track selector, group switching, and the fact that tracks 5-16 have no instrument yet. This is a user-facing change, so the doc edit is part of the task, not a follow-up.

- [ ] **Step 5: Push**

```bash
git push
```

---

## Self-Review

**Spec coverage (design §3, §4, §5.1, §5.2):** `NUM_TRACKS` 16 → Task 1. UI state → Task 2. 16 colours + the schwung-drift guardrail → Task 4. Step-row selector → Task 6. Octave group switching + Session-held+step → Task 7. Status cost → Task 8. Graceful movy tracks (not in the design, discovered while planning) → Task 3.

**Deferred to Stage 3+:** `MovyChainPort` and real audio, persistence of movy chains, the mixer, the ABI-parity guard.

**Ordering constraints:** Task 2 before 4 (colours index by track). Task 5 before 6 and 7 (both need `focusGroup`). Task 1 and 2 must land together in the same push — a 16-track UI against a 4-track engine parses garbage.
