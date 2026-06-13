# Batch 2 — View interaction & track control: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Track/Session/Loop buttons momentary-capable (down=switch, tap=latch, hold=temporary-return-on-release), recolor session & loop views, move view-switch announcements to the header, and add the mute gesture + dimmed track button.

**Architecture:** A small generic momentary helper (`seq/momentary.ts`) decides tap-vs-hold on release by comparing tick deltas, with a caller-supplied `restore()` closure so it works for the heterogeneous targets (sessionMode flag, loopMode flag, activeSlot/currentView). Pure color/state functions are unit-tested; router wiring is verified by typecheck + device e2e. The engine adds one read-only `mute=` status field.

**Tech Stack:** TypeScript (movy UI), Rust (`engine/crates/seq-core`, `movy-dsp`), Node browser tests.

**Spec:** `movy/plans/2026-06-13-batch2-view-interaction.md`

**Branch:** continue on `feat/seq-led-affordance` (Batch 1), or branch `feat/seq-view-interaction` off it. Use the same branch the controller is on.

---

## File structure

| File | Responsibility | Change |
|------|----------------|--------|
| `src/seq/momentary.ts` | generic tap-vs-hold momentary helper | create |
| `engine/crates/seq-core/src/engine.rs` | `mute=` in `status()` | modify |
| `engine/crates/movy-dsp/src/lib.rs` + `src/seq/constants.ts` | `ENGINE_VERSION` 0.10.0→0.11.0 | modify |
| `src/seq/state.ts` | `muted[4]` mirror + `muteFromStr` | modify |
| `src/seq/engine.ts` | parse `mute=` | modify |
| `src/seq/leds.ts` | `trackButtonColor` mute-dim; `paintLoopBars` recolor; painter passes muted | modify |
| `src/seq/session.ts` | grid recolor | modify |
| `src/seq/router.ts` | Session/Loop momentary, single-press bar select, `muteTrack`, mute-held state, drop Bar-N toast | modify |
| `src/midi/router.ts` | Track-button momentary + mute+track gesture | modify |
| `src/seq/render.ts` | header announcement + route switch messages there | modify |
| `src/app/tick.ts` | draw header announcement; pass muted to painter (via leds) | modify |
| `browser-test/logic.mjs` | unit tests for the pure pieces | modify |
| `build/browser.mjs` | add `seq/momentary.ts` entry point | modify |

**Conventions:** pure logic in its own module unit-tested in `logic.mjs` (imports from `../dist/esm/...`); `npm run build:browser` before `.mjs` tests; all LEDs through `cachedSet*`; comments explain WHY; ≤200-line files.

---

## Task 1: Momentary helper core

**Files:**
- Create: `src/seq/momentary.ts`
- Modify: `build/browser.mjs`
- Test: `browser-test/logic.mjs`

- [ ] **Step 1: Write the failing test**

Add to `logic.mjs`:

```js
import { momentaryDownAt, momentaryUpAt, resetMomentary } from '../dist/esm/seq/momentary.js';

function testMomentary() {
    _log('\nmomentary tap vs hold:');
    let restored = 0;
    const restore = () => { restored++; };

    // Quick tap (< 28 ticks elapsed) → latch, restore NOT called.
    resetMomentary();
    momentaryDownAt(40, 100, restore);
    momentaryUpAt(40, 110);          // 10 ticks → tap
    eq('tap does not restore', restored, 0);

    // Hold (>= 28 ticks) → restore called.
    resetMomentary();
    momentaryDownAt(40, 100, restore);
    momentaryUpAt(40, 140);          // 40 ticks → hold
    eq('hold restores', restored, 1);

    // Up for a different button is ignored.
    resetMomentary();
    momentaryDownAt(40, 100, restore);
    momentaryUpAt(58, 200);          // wrong button
    eq('other-button up ignored', restored, 1);
}
```

Invoke `testMomentary();` in the run sequence.

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL — module `seq/momentary.js` not found.

- [ ] **Step 3: Implement `src/seq/momentary.ts`**

```ts
/* Generic momentary view-switch: a button-down switches the view immediately;
 * the tap-vs-hold decision is made on release by elapsed ticks. A quick tap
 * latches the switch; a hold (>= HOLD_TICKS) is a temporary peek and the
 * caller-supplied restore() returns the prior state. One active button at a
 * time. The *At variants take an explicit tick for testability; the plain
 * variants read uiTick(). */

import { uiTick } from './engine.js';

const HOLD_TICKS = 28; // ~300 ms at the ~94 Hz device tick rate

let active: { button: number; pressTick: number; restore: () => void } | null = null;

export function momentaryDownAt(button: number, now: number, restore: () => void): void {
    active = { button, pressTick: now, restore };
}

export function momentaryUpAt(button: number, now: number): void {
    if (!active || active.button !== button) return;
    const held = now - active.pressTick >= HOLD_TICKS;
    const restore = active.restore;
    active = null;
    if (held) restore();
}

export function momentaryDown(button: number, restore: () => void): void {
    momentaryDownAt(button, uiTick(), restore);
}

export function momentaryUp(button: number): void {
    momentaryUpAt(button, uiTick());
}

export function resetMomentary(): void {
    active = null;
}
```

Add to `build/browser.mjs` entryPoints array: `resolve(root, 'src/seq/momentary.ts'),`.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: PASS (momentary block green).

- [ ] **Step 5: Commit**

```bash
git add src/seq/momentary.ts build/browser.mjs browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
feat(seq): generic momentary view-switch helper (tap latches, hold returns)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Engine `mute=` status + version bump

**Files:**
- Modify: `engine/crates/seq-core/src/engine.rs`
- Modify: `engine/crates/movy-dsp/src/lib.rs`, `src/seq/constants.ts`
- Test: `engine.rs` tests

- [ ] **Step 1: Write the failing test**

Add to `engine.rs` tests:

```rust
#[test]
fn status_reports_mute_flags() {
    let mut e = engine();
    let mut out = Vec::new();
    apply_batch(&mut e, "mute 1 1", &mut out);
    let s = e.status();
    let m = s.split("mute=").nth(1).unwrap().split(' ').next().unwrap();
    assert_eq!(m, "0100"); // track 1 muted
}
```

> If `apply_batch` isn't the local test helper name, grep the tests module for how commands are applied (`command::apply` / `apply_batch`) and use it.

- [ ] **Step 2: Run to verify it fails**

Run: `cd engine && PATH="/Users/dake/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" cargo test -p seq-core status_reports_mute_flags`
Expected: FAIL — no `mute=` in status.

> Note: `cargo` lives under the rustup toolchain dir on this machine; prefix PATH as shown (it is not on the bare shell PATH).

- [ ] **Step 3: Implement**

Add a helper near `active_notes_state`:

```rust
/// `mute=` payload: one '0'/'1' per track (track 0 first).
fn mute_state(&self) -> String {
    let mut out = String::with_capacity(4);
    for t in &self.tracks {
        out.push(if t.muted { '1' } else { '0' });
    }
    out
}
```

Insert `mute={}` into the `status()` format (before `occ=`, after `act=`):

```rust
            "play={} tick={} bpm={} trk={} step={} len={} lstart={} rec={} cin={} metro={} dirty={} sess={} act={} mute={} occ={}",
            // ...existing args, then:
            self.active_notes_state(),
            self.mute_state(),
            clip.occupancy_hex_lane(self.watch_lane)
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd engine && PATH="/Users/dake/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" cargo test -p seq-core`
Expected: PASS (all).

- [ ] **Step 5: Bump version**

`engine/crates/movy-dsp/src/lib.rs`: `ENGINE_VERSION` `"0.10.0"` → `"0.11.0"`.
`src/seq/constants.ts`: `ENGINE_VERSION = '0.10.0'` → `'0.11.0'`.

- [ ] **Step 6: Commit**

```bash
git add engine/crates/seq-core/src/engine.rs engine/crates/movy-dsp/src/lib.rs src/seq/constants.ts
git commit -m "$(cat <<'EOF'
feat(seq-core): report per-track mute flags in status (mute=); bump to 0.11.0

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: UI mute mirror

**Files:**
- Modify: `src/seq/state.ts`, `src/seq/engine.ts`
- Test: `browser-test/logic.mjs`

- [ ] **Step 1: Write the failing test**

```js
import { muteFromStr } from '../dist/esm/seq/state.js';
import { seqState } from '../dist/esm/seq/state.js';

function testMuteMirror() {
    _log('\nmute mirror:');
    muteFromStr('0100');
    eq('t0 unmuted', seqState.muted[0], false);
    eq('t1 muted',   seqState.muted[1], true);
    eq('t2 unmuted', seqState.muted[2], false);
    muteFromStr('1111');
    eq('all muted',  seqState.muted[3], true);
}
```

Invoke `testMuteMirror();`.

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL — `muteFromStr` not exported.

- [ ] **Step 3: Implement in `state.ts`**

Add to `SeqUiState` interface and `defaults()`:

```ts
    muted: boolean[];        // per-track mute, from `mute=`
```
```ts
        muted: [false, false, false, false],
```

Add the parser:

```ts
/* Parse the engine's `mute=` value (one '0'/'1' per track). */
export function muteFromStr(s: string): void {
    for (let t = 0; t < 4; t++) seqState.muted[t] = s[t] === '1';
}
```

- [ ] **Step 4: Wire into the poll**

In `src/seq/engine.ts` `parseStatus`, import `muteFromStr` and add:

```ts
        else if (key === 'mute') muteFromStr(val);
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/seq/state.ts src/seq/engine.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
feat(seq): mirror engine mute flags into seqState.muted

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Track-button mute dim

**Files:**
- Modify: `src/seq/leds.ts`
- Test: `browser-test/logic.mjs`

**Background:** Batch 1 left `trackButtonColor(track, active)`. Add a `muted` branch and have the painter read `seqState.muted`.

- [ ] **Step 1: Write the failing test**

```js
import { trackButtonColor } from '../dist/esm/seq/leds.js';
import { trackColor, trackColorDim } from '../dist/esm/seq/colors.js';

function testTrackButtonMute() {
    _log('\ntrack-button mute dim:');
    eq('unmuted base', trackButtonColor(2, false, false), trackColor(2));
    eq('active white',  trackButtonColor(2, true, false), 120);
    eq('muted dim',     trackButtonColor(2, false, true), trackColorDim(2));
    eq('muted+active still white', trackButtonColor(2, true, true), 120);
}
```

Replace the Batch-1 `testTrackButton` call if it conflicts (the signature now has a 3rd arg); update that earlier test's calls to pass `false` as the muted arg, or fold into this test.

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL — arity.

- [ ] **Step 3: Implement**

In `seq/leds.ts`, change `trackButtonColor` and the painter:

```ts
export function trackButtonColor(track: number, active: boolean, muted: boolean): number {
    if (active) return C_WHITE;          // sounding note wins (full brightness)
    return muted ? trackColorDim(track) : trackColor(track);
}

function paintTrackButtons(): void {
    for (let t = 0; t < 4; t++) {
        const cc = CC_TRACK_END - t; // CC 43 = track 0
        cachedSetButtonLED(cc, trackButtonColor(t, trackHasActiveNote(t), seqState.muted[t]));
    }
}
```

(`trackColorDim` is already imported in `leds.ts`.)

- [ ] **Step 4: Run to verify it passes**

Run: `npm run typecheck && npm run build:browser && node browser-test/logic.mjs`
Expected: PASS, zero new TS errors.

- [ ] **Step 5: Commit**

```bash
git add src/seq/leds.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
feat(seq): dim track button when its track is muted

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Mute gesture + mute-held state

**Files:**
- Modify: `src/seq/router.ts`
- Test: `browser-test/logic.mjs`

**Background:** Hold Mute (CC 88) + press a track → toggle that track's mute via the engine `mute` command, instead of switching views. Expose a pure-ish `muteTrack(track)` that queues the right command (testable by reading the engine command queue) and `setMuteHeld`/`muteHeld` state.

- [ ] **Step 1: Write the failing test**

```js
import { muteTrack, setMuteHeld, muteHeld } from '../dist/esm/seq/router.js';
import { seqState } from '../dist/esm/seq/state.js';
import { peekSeqCmdQueue, resetSeqEngine } from '../dist/esm/seq/engine.js';

function testMuteGesture() {
    _log('\nmute gesture:');
    setMuteHeld(true);
    eq('mute held', muteHeld(), true);
    resetSeqEngine();
    seqState.muted[2] = false;
    muteTrack(2);
    eq('queues mute on', peekSeqCmdQueue().some(c => c === 'mute 2 1'), true);
    resetSeqEngine();
    seqState.muted[2] = true;
    muteTrack(2);
    eq('queues mute off', peekSeqCmdQueue().some(c => c === 'mute 2 0'), true);
    setMuteHeld(false);
}
```

This needs a `peekSeqCmdQueue` test hook in `engine.ts`.

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL — `muteTrack`/`peekSeqCmdQueue` not exported.

- [ ] **Step 3: Add the engine test hook**

In `src/seq/engine.ts`, add near `resetSeqEngine`:

```ts
/* Test hook: inspect the pending command queue. */
export function peekSeqCmdQueue(): string[] {
    return cmdQueue.slice();
}
```

- [ ] **Step 4: Implement in `seq/router.ts`**

```ts
let muteHeldState = false;
export function setMuteHeld(down: boolean): void { muteHeldState = down; }
export function muteHeld(): boolean { return muteHeldState; }

/* Toggle a track's mute via the engine (mirror flips optimistically so the
 * track button dims this tick). */
export function muteTrack(track: number): void {
    if (track < 0 || track > 3) return;
    const next = seqState.muted[track] ? 0 : 1;
    seqState.muted[track] = next === 1;
    seqCmd('mute ' + track + ' ' + next);
}
```

Handle CC 88 (Mute) in `seqHandleMidi` (add `const CC_MUTE = 88;` and a branch in the `0xB0` section):

```ts
    if (d1 === CC_MUTE) {
        setMuteHeld(d2 > 0);
        return true;
    }
```

> Track-button presses are routed in `midi/router.ts`, not here — Task 6 calls `muteTrack` from there when `muteHeld()` is true.

- [ ] **Step 5: Run to verify it passes**

Run: `npm run typecheck && npm run build:browser && node browser-test/logic.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/seq/router.ts src/seq/engine.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
feat(seq): mute+track gesture toggles track mute via engine

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Track button — momentary + mute precedence

**Files:**
- Modify: `src/midi/router.ts`
- Test: device (router wiring; not unit-tested — mutates appState + host fns)

**Background:** The track-button block (`midi/router.ts:92`) currently switches on down only. Make it: mute-gesture first; else momentary down (capture restore, apply target = exit session/loop + activeSlot=track + currentView=VIEW_KEYS), and handle button-up to decide tap/hold.

- [ ] **Step 1: Implement the down path**

Replace the track-button block. Import at top: `import { momentaryDown, momentaryUp } from '../seq/momentary.js';` and `import { muteHeld, muteTrack } from '../seq/router.js';` (seq/router) and `seqState` (already imported).

```ts
    /* Track buttons (CC 40–43): CC43=slot0 … CC40=slot3. */
    if (d1 >= TRACK_CC_START && d1 <= TRACK_CC_END) {
        const track = TRACK_CC_END - d1;
        if (d2 > 0) {
            if (muteHeld()) { muteTrack(track); appState.dirty = true; return; }
            // Momentary: snapshot prior state, then open this track's note layout.
            const prevSlot = appState.activeSlot;
            const prevView = appState.currentView === VIEW_BROWSE ? appState.browseOrigin : appState.currentView;
            const prevSession = seqState.sessionMode;
            const prevLoop = seqState.loopMode;
            momentaryDown(d1, () => {
                seqState.sessionMode = prevSession;
                seqState.loopMode = prevLoop;
                appState.activeSlot = prevSlot;
                appState.currentView = prevView;
                appState.initLedsDone = false; appState.initLedIndex = 0;
                appState.dirty = true;
            });
            appState.trackView[appState.activeSlot] = prevView;
            seqState.sessionMode = false;
            seqState.loopMode = false;
            appState.activeSlot = track;
            appState.currentView = VIEW_KEYS;      // drum / chromatic note layout
            appState.jogTouched = false;
            appState.initLedsDone = false; appState.initLedIndex = 0;
            appState.dirty = true;
        } else {
            momentaryUp(d1);
            appState.dirty = true;
        }
        return;
    }
```

> The seq router still observes track buttons for watch-clip retarget (`seq/router.ts` track block). That runs first via `seqHandleMidi`; it returns false (does not consume), so this block still executes. Keep both — they are complementary (watch retarget + view switch).

- [ ] **Step 2: Typecheck + build**

Run: `npm run typecheck && npm run build:browser && node browser-test/logic.mjs`
Expected: zero new TS errors; logic still 0 failures.

- [ ] **Step 3: Commit**

```bash
git add src/midi/router.ts
git commit -m "$(cat <<'EOF'
feat(seq): track button is momentary — opens track note layout, mute+track mutes

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Session & Loop buttons — momentary + single-press bar select

**Files:**
- Modify: `src/seq/router.ts`, `src/seq/loop-mode.ts`
- Test: `browser-test/logic.mjs` (single-press-select is unit-testable)

**Background:** Session (CC 50) and Loop (CC 58) become momentary. `sessionToggle`/`loopButton` currently latch on a clean tap. Wrap each in the momentary helper. In loop mode, a single step press selects the bar (`barOffset`).

- [ ] **Step 1: Session momentary — `seq/router.ts`**

Replace the `CC_NOTE_SESSION` handler:

```ts
    if (d1 === CC_NOTE_SESSION) {
        if (d2 > 0) {
            const prev = seqState.sessionMode;
            momentaryDown(d1, () => { seqState.sessionMode = prev; seqHeaderAnnounce(prev ? 'Session' : 'Note'); });
            seqState.sessionMode = true;
            seqHeaderAnnounce('Session');
        } else {
            momentaryUp(d1);
        }
        return true;
    }
```

Import `momentaryDown, momentaryUp` from `./momentary.js` and `seqHeaderAnnounce` from `./render.js` (Task 9 adds it; if doing tasks in order, add a temporary `export function seqHeaderAnnounce(){}` stub in render.ts now and flesh it out in Task 9 — but Task 9 lands first if you follow order; this task assumes Task 9's `seqHeaderAnnounce` exists, so **do Task 9 before this step's build**, or stub it).

- [ ] **Step 2: Loop momentary — `seq/loop-mode.ts`**

Rewrite `loopButton`:

```ts
export function loopButton(down: boolean): void {
    if (down) {
        held = true;
        gestured = false;
        const prev = seqState.loopMode;
        momentaryDown(CC_LOOP_BTN, () => { seqState.loopMode = prev; seqHeaderAnnounce(prev ? 'Loop' : 'Note'); });
        seqState.loopMode = true;
        seqHeaderAnnounce('Loop');
    } else {
        held = false;
        momentaryUp(CC_LOOP_BTN);
    }
}
```

Add `const CC_LOOP_BTN = 58;`, import `momentaryDown, momentaryUp` from `./momentary.js`, `seqHeaderAnnounce` from `./render.js`. Keep `held`/`gestured`/`loopWheel`/`loopHeld` as-is (Loop+wheel resize still works while held).

- [ ] **Step 3: Single-press selects bar — `seq/loop-mode.ts`**

In `loopStepOn`, make a lone press select the bar (set `barOffset`), keeping two-press window + double-tap-1-bar:

```ts
export function loopStepOn(bar: number): void {
    heldBars.add(bar);
    gestured = true;
    if (heldBars.size >= 2) {
        const bars = [...heldBars];
        setLoopBars(Math.min(...bars), Math.max(...bars));
        heldBars.clear();
        return;
    }
    if (bar === lastTapBar && uiTick() - lastTapTick <= DOUBLE_TAP_TICKS) {
        setLoopBars(bar, bar);
    } else {
        seqState.barOffset = bar;   // single press selects the viewed bar
    }
    lastTapBar = bar;
    lastTapTick = uiTick();
}
```

- [ ] **Step 4: Unit-test single-press select**

```js
import { loopStepOn, resetLoopMode } from '../dist/esm/seq/loop-mode.js';
import { seqState } from '../dist/esm/seq/state.js';

function testLoopSelect() {
    _log('\nloop single-press selects bar:');
    resetLoopMode();
    seqState.barOffset = 0;
    loopStepOn(3);
    eq('barOffset follows press', seqState.barOffset, 3);
}
```

Invoke `testLoopSelect();`.

- [ ] **Step 5: Build + test**

Run: `npm run typecheck && npm run build:browser && node browser-test/logic.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/seq/router.ts src/seq/loop-mode.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
feat(seq): Session/Loop buttons momentary; loop single-press selects bar

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Session-grid recolor

**Files:**
- Modify: `src/seq/session.ts`
- Test: `browser-test/logic.mjs`

**Background:** Spec colors — content = track color; empty = off; selected+content = blink white/track; selected-empty = dark grey. Extract the per-cell decision into a pure `sessionCellColor` so it's testable.

- [ ] **Step 1: Write the failing test**

```js
import { sessionCellColor } from '../dist/esm/seq/session.js';
import { trackColor, C_DARKGREY, C_WHITE, C_BLACK } from '../dist/esm/seq/colors.js';

function testSessionColor() {
    _log('\nsession cell color:');
    const base = { exists:false, isSel:false, isPlaying:false, isQueued:false, blink:true, track:1 };
    eq('empty unselected = off', sessionCellColor({ ...base }), 0);
    eq('content unselected = track', sessionCellColor({ ...base, exists:true }), trackColor(1));
    eq('selected empty = dark grey', sessionCellColor({ ...base, isSel:true }), 124);
    eq('selected content blink on = white', sessionCellColor({ ...base, exists:true, isSel:true, blink:true }), 120);
    eq('selected content blink off = track', sessionCellColor({ ...base, exists:true, isSel:true, blink:false }), trackColor(1));
}
```

Invoke `testSessionColor();`.

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL — `sessionCellColor` not exported.

- [ ] **Step 3: Implement in `session.ts`**

Add the pure helper and use it in `sessionPaintGrid`:

```ts
export interface CellCtx {
    exists: boolean; isSel: boolean; isPlaying: boolean; isQueued: boolean;
    blink: boolean; track: number;
}

export function sessionCellColor(c: CellCtx): number {
    if (c.isQueued)               return c.blink ? C_GREEN : C_BLACK;     // queued for launch
    if (c.isPlaying && c.isSel)   return c.blink ? C_WHITE : C_BLACK;     // playing+selected pulse
    if (c.isPlaying)              return C_WHITE;                          // playing (solid)
    if (c.isSel && c.exists)      return c.blink ? C_WHITE : trackColor(c.track); // selected w/ content
    if (c.isSel)                  return C_DARKGREY;                       // selected empty
    if (c.exists)                 return trackColor(c.track);              // has content
    return C_BLACK;                                                        // empty
}
```

In `sessionPaintGrid`, replace the inline `let color …` block with:

```ts
        const color = sessionCellColor({
            exists, isSel, isPlaying, isQueued: isQueued, blink, track,
        });
```

Import `C_DARKGREY` (add to the colors import). Keep the existing `blink = pulseOn()` and per-cell `exists/isSel/isPlaying/isQueued` derivations.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run typecheck && npm run build:browser && node browser-test/logic.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/seq/session.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
feat(seq): session grid uses track palette (content/empty/selected semantics)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Header announcements (and drop Bar-N toasts)

**Files:**
- Modify: `src/seq/render.ts`, `src/app/tick.ts`, `src/seq/router.ts`, `src/seq/loop-mode.ts`
- Test: `screenshot.mjs` (rendering); `logic.mjs` (TTL behavior)

**Background:** Switch announcements (Note/Session/Loop) render at the top so they don't cover the bottom loop/bar strip. Remove "Bar N" navigation toasts.

- [ ] **Step 1: Implement `seqHeaderAnnounce` in `render.ts`**

```ts
let headerText = '';
let headerTtl = 0;

/* A short top-of-screen announcement for view switches (Note/Session/Loop),
 * placed in the header so it never covers the bottom bar/loop strip. */
export function seqHeaderAnnounce(msg: string, ttlTicks: number = DEFAULT_TTL): void {
    headerText = msg;
    headerTtl = ttlTicks;
}

export function seqHeaderActive(): boolean { return headerTtl > 0; }

export function seqHeaderTick(): void {
    if (headerTtl > 0) headerTtl--;
}

export function drawSeqHeader(): void {
    if (headerTtl <= 0) return;
    fill_rect(0, 0, W, 9, 1);              // inverted header band
    fontPrint(2, 1, headerText, 0);
}

export function resetSeqHeader(): void { headerText = ''; headerTtl = 0; }
```

Import `fontPrint` (`import { fontPrint } from '../font/index.js';`) at the top of `render.ts` if not present.

- [ ] **Step 2: Draw it from `app/tick.ts`**

Add `import { drawSeqHeader, seqHeaderActive, seqHeaderTick } from '../seq/render.js';`. In `tick()`, call `seqHeaderTick();` next to `seqToastTick();`, and after the view render add:

```ts
    if (seqHeaderActive()) drawSeqHeader();
```

Place this AFTER the main view render and BEFORE/independent of `drawLoopStrip()` so the header (top) and strip (bottom) coexist. Ensure the frame stays dirty while the header is active (mirror how `toastShowing` keeps the frame alive): include `seqHeaderActive()` in the redraw condition.

- [ ] **Step 3: Drop Bar-N toasts**

In `seq/router.ts` `navigateBar`, remove the `seqToast('Bar ' + …)` line (keep the `barOffset` update). In `seq/loop-mode.ts` `setLoopBars`, change the `seqToast(...)` loop announcement to `seqHeaderAnnounce(...)` (loop window changes are view-switch-adjacent).

- [ ] **Step 4: Logic test for TTL**

```js
import { seqHeaderAnnounce, seqHeaderActive, seqHeaderTick, resetSeqHeader } from '../dist/esm/seq/render.js';

function testHeaderAnnounce() {
    _log('\nheader announce TTL:');
    resetSeqHeader();
    eq('inactive initially', seqHeaderActive(), false);
    seqHeaderAnnounce('Session', 2);
    eq('active after announce', seqHeaderActive(), true);
    seqHeaderTick(); seqHeaderTick();
    eq('expires after ttl', seqHeaderActive(), false);
}
```

Invoke `testHeaderAnnounce();`.

- [ ] **Step 5: Build + tests + baselines**

```bash
npm run typecheck && npm run build:browser
node browser-test/logic.mjs        # 0 failures
node browser-test/screenshot.mjs   # new header states will diff
```
If (and only if) new diffs are the intended header banner, refresh: `node browser-test/screenshot.mjs --update`. (Pre-existing unrelated baseline failures from Batch 1 remain; do not bless those — inspect names to be sure you only update header-announcement frames.)

- [ ] **Step 6: Commit**

```bash
git add src/seq/render.ts src/app/tick.ts src/seq/router.ts src/seq/loop-mode.ts browser-test/logic.mjs browser-test/baseline* 2>/dev/null
git commit -m "$(cat <<'EOF'
feat(seq): header-style view-switch announcements; drop Bar-N toasts

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Loop-bars recolor

**Files:**
- Modify: `src/seq/leds.ts` (`paintLoopBars`)
- Test: `browser-test/logic.mjs`

**Background:** Spec — bars with content blink; selected bar white/off; other bars track-color/off; playhead bar green while playing. Extract a pure `loopBarColor`.

- [ ] **Step 1: Write the failing test**

```js
import { loopBarColor } from '../dist/esm/seq/leds.js';
import { trackColor } from '../dist/esm/seq/colors.js';

function testLoopBarColor() {
    _log('\nloop bar color:');
    const base = { isPlayhead:false, selected:false, hasContent:false, inLoop:false, blink:true, track:1 };
    eq('playhead green', loopBarColor({ ...base, isPlayhead:true }), 11);
    eq('selected white', loopBarColor({ ...base, selected:true }), 120);
    eq('content blink on = track', loopBarColor({ ...base, hasContent:true, blink:true }), trackColor(1));
    eq('content blink off = off', loopBarColor({ ...base, hasContent:true, blink:false }), 0);
    eq('empty = off', loopBarColor({ ...base }), 0);
}
```

Invoke `testLoopBarColor();`.

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL — `loopBarColor` not exported.

- [ ] **Step 3: Implement in `leds.ts`**

```ts
interface BarCtx {
    isPlayhead: boolean; selected: boolean; hasContent: boolean;
    inLoop: boolean; blink: boolean; track: number;
}

export function loopBarColor(c: BarCtx): number {
    if (c.isPlayhead)  return C_GREEN;                                   // playhead while playing
    if (c.selected)    return C_WHITE;                                   // selected bar
    if (c.hasContent)  return c.blink ? trackColor(c.track) : C_BLACK;   // existing bars blink track color
    return C_BLACK;                                                      // empty/out-of-loop
}
```

Rewrite `paintLoopBars` to feed it (it already computes `start`/`end`/`playBar`/`barHasContent`):

```ts
function paintLoopBars(): void {
    const start = loopStartBar();
    const end = loopEndBar();
    const playBar = seqState.playing ? Math.floor(seqState.curStep / NUM_STEP_BUTTONS) : -1;
    const blink = blinkPhase();
    for (let bar = 0; bar < NUM_STEP_BUTTONS; bar++) {
        cachedSetLED(STEP_NOTE_BASE + bar, loopBarColor({
            isPlayhead: bar === playBar,
            selected: bar === seqState.barOffset,
            hasContent: barHasContent(bar),
            inLoop: bar >= start && bar <= end,
            blink, track: seqState.watchTrack,
        }));
    }
}
```

Add a small `blinkPhase()` (the file's `blinkOn` was removed in Batch 1; reintroduce a local one used only here):

```ts
function blinkPhase(): boolean { return Math.floor(seqState.engineTick / 24) % 2 === 0; }
```

Add `C_BLACK` to the colors import in `leds.ts` if not present.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run typecheck && npm run build:browser && node browser-test/logic.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/seq/leds.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
feat(seq): loop bars blink track color, selected white, playhead green

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Build + local + device verification

**Files:** none (verification)

- [ ] **Step 1: Engine build**

Run: `cd engine && PATH="/Users/dake/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" cargo test && cd ..`
Expected: all pass.

- [ ] **Step 2: Full local suite**

```bash
npm run typecheck                 # only the pre-existing file-handler.ts error
npm run build:browser
node browser-test/logic.mjs       # 0 failures
node browser-test/perf.mjs        # within budget, idle LED sends ~0
node browser-test/screenshot.mjs  # only header-announcement frames (intended) + pre-existing diffs
```

- [ ] **Step 3: Device tests (if reachable)**

```bash
ssh -o ConnectTimeout=3 ableton@move.local echo ok 2>/dev/null \
  && PATH="/Users/dake/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" ./scripts/test-seq.sh && ./scripts/test.sh \
  || echo "DEVICE OFFLINE — SKIPPING DEVICE TESTS"
```
If offline, report **DEVICE OFFLINE** in CAPS. On device, eyeball: tap Session latches the grid; hold Session peeks and releases back to note view; track button opens that track's note layout; Mute+track dims the track button; loop bars blink with selected white; switch announcements appear at the top, not over the bottom strip.

- [ ] **Step 4: Push**

```bash
git push
```

---

## Self-review notes

- **Spec coverage:** momentary core (T1) · mute status+version (T2) · mute mirror (T3) · track-button dim (T4) · mute gesture (T5) · track momentary+mute precedence (T6) · session/loop momentary + single-press select (T7) · session recolor (T8) · header announcements + drop Bar-N (T9) · loop-bars recolor (T10) · verification (T11). All 8 spec components covered.
- **Ordering note:** Task 7 references `seqHeaderAnnounce` from Task 9 — **do Task 9 before Task 7's build step**, or add the `seqHeaderAnnounce` export stub when starting Task 7. Implementer: build Task 9's `render.ts` additions first if you hit a missing-export error.
- **Type consistency:** `trackButtonColor` gains a 3rd `muted` arg (T4) — the Batch-1 `testTrackButton` call must be updated to pass it (noted in T4 Step 1). `momentaryDown/Up` signatures consistent across T1/T6/T7. `seqHeaderAnnounce` signature consistent T9/T7. `sessionCellColor`/`loopBarColor` ctx objects defined once.
- **Deferred:** exit/background parity (Batch 2.5).
```
