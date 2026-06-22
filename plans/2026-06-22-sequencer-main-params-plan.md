# Sequencer Main Parameters Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global Main Parameters page (Tempo, Swing, Root note, Key/scale) to the movy sequencer, opened with Shift+Step 5/7/9 and exited with Back, behaving like the chain/module parameter pages (knob-touch → toast, big-font cells, scrollable enum overlay for the scale list).

**Architecture:** Tempo and Swing are engine-owned (Rust `seq-core`); Swing is a new feature that delays off-beat 16th steps in the scheduler. Root and Key are UI-owned keyboard state that drive the chromatic pad highlighting globally across all tracks; Root also transposes the pad layout. The page is a new `VIEW_MAIN_PARAMS` view rendered through the existing `renderKnobsView`, with a small state machine mirroring the existing step-parameter page.

**Tech Stack:** TypeScript (UI, bundled to `ui.js` via esbuild), Rust (`seq-core` pure logic + `movy-dsp` cdylib), Node-based browser test harnesses (`browser-test/*.mjs`), `cargo test`.

## Global Constraints

- **ENGINE_VERSION must match** between `engine/crates/movy-dsp/src/lib.rs` and `src/seq/constants.ts` — `build-dsp.sh` fails the build otherwise. This plan bumps it **`0.20.0` → `0.21.0`** (Task 3, both files in the same commit).
- **File size hard limit: 200 lines**; target 50–100, one responsibility per file.
- **`model/` never calls display functions**; `renderer/` is pure (no state); `src/types/` imports nothing from `src/`.
- **Engine param sets must be blocking** (already handled in `engine.ts`); never scp over a dlopen'd `.so` (handled by `deploy.sh`).
- **Swing range: 50–80** (clamp in the engine). **Tempo range: 20–300 BPM** (engine clamps `bpm_x100` to 2000–30000, exists). **Detent divisor: 8** raw delta units per value step (matches `STEP_ENUM_DIV` in `step-edit.ts`).
- **Scales: 13** entries (Major … Chromatic), defined once in `src/seq/scales.ts`.
- After every task: `cd movy && npm run build:browser` then run the relevant `browser-test/*.mjs` suite(s); for engine tasks `cd engine && cargo test`. Commit at the end of each task. Co-author trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: Engine — swing field + `swing` command

**Files:**
- Modify: `engine/crates/seq-core/src/engine.rs` (struct `Engine` ~line 34-75, `Engine::new` ~line 87-110)
- Modify: `engine/crates/seq-core/src/command.rs` (`apply_op` match, after the `"bpm"` arm ~line 34)
- Test: `engine/crates/seq-core/src/command.rs` (tests module at bottom)

**Interfaces:**
- Produces: `Engine.swing_pct: u32` (public field, default 50, clamped 50–80); command verb `swing <pct>`.

- [ ] **Step 1: Write the failing test**

In the `#[cfg(test)] mod tests` block at the bottom of `command.rs`, add:

```rust
    #[test]
    fn swing_command_sets_and_clamps() {
        let mut e = Engine::new(44100, 12000);
        let mut out = Vec::new();
        apply_batch(&mut e, "swing 70", &mut out);
        assert_eq!(e.swing_pct, 70);
        apply_batch(&mut e, "swing 90", &mut out); // above max
        assert_eq!(e.swing_pct, 80);
        apply_batch(&mut e, "swing 10", &mut out); // below min
        assert_eq!(e.swing_pct, 50);
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd engine && cargo test -p seq-core swing_command_sets_and_clamps`
Expected: FAIL — `no field swing_pct on type Engine`.

- [ ] **Step 3: Add the field + default + command**

In `engine.rs`, add to the `Engine` struct (after `rng_state` ~line 74):

```rust
    /// Off-beat shuffle amount, percent (50 = straight … 80 = max). Applied by
    /// the scheduler to odd-indexed 16th steps. UI-set via the `swing` command.
    pub swing_pct: u32,
```

In `Engine::new` (after `rng_state: 0x9E3779B97F4A7C15,` ~line 108):

```rust
            swing_pct: 50,
```

In `command.rs`, after the `"bpm"` arm (~line 34) add:

```rust
        "swing" => {
            if let Some(v) = next() {
                engine.swing_pct = v.clamp(50, 80) as u32;
            }
        }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd engine && cargo test -p seq-core swing_command_sets_and_clamps`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd engine
git add crates/seq-core/src/engine.rs crates/seq-core/src/command.rs
git commit -m "$(cat <<'EOF'
engine: swing_pct field + swing command (clamp 50-80)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Engine — swing scheduler offset

**Files:**
- Modify: `engine/crates/seq-core/src/engine.rs` (add `swing_delay` helper; `service_tick` note-fire check ~line 569-574)
- Test: `engine/crates/seq-core/src/engine.rs` (tests module)

**Interfaces:**
- Consumes: `Engine.swing_pct` (Task 1).
- Produces: `Engine::swing_delay(&self, step: u16) -> u32` — ticks an odd 16th step is delayed.

**Background:** `TICKS_PER_STEP = 24` (PPQN 96). A note fires in `service_tick` when its `tick` equals the track `pos`. Swing delays odd-indexed steps (the off-beats) by up to half a step (12 ticks at 80%): `(swing_pct − 50) * 24 / 60` → 0 at 50%, 12 at 80%. The delay is always `< 24`, so a swung note never crosses into the next step's cell.

- [ ] **Step 1: Write the failing test**

In `engine.rs` tests module, add (places a melodic note on step 0 and step 1, runs the clock, records the master tick each note-on fires):

```rust
    #[test]
    fn swing_delays_offbeat_steps_only() {
        // Returns the clip-position tick at which the note on `step` fires.
        // Advances in 8-frame chunks (≈0.03 ticks each, so ≤1 tick fires per
        // chunk) and reads the master tick from status. status `tick=` is
        // post-increment, and the note fires while pos == master_tick - 1, so
        // the firing position is (status tick − 1).
        fn fire_tick(swing: u32, step: u16) -> u64 {
            let mut e = Engine::new(44100, 12000);
            e.swing_pct = swing;
            let mut out = Vec::new();
            apply_batch(&mut e, &format!("tog 0 {step} 60 100"), &mut out);
            e.play();
            for _ in 0..5000 {
                out.clear();
                e.advance_block(8, &mut out);
                if out.iter().any(|ev| matches!(ev, OutEvent::NoteOn { pitch: 60, .. })) {
                    let st = e.status();
                    let tick = st.split_whitespace()
                        .find_map(|kv| kv.strip_prefix("tick="))
                        .and_then(|v| v.parse::<u64>().ok())
                        .expect("status has tick=");
                    return tick - 1;
                }
            }
            panic!("note on step {step} never fired (swing {swing})");
        }
        // Straight: step 0 at tick 0, step 1 at tick 24.
        assert_eq!(fire_tick(50, 0), 0);
        assert_eq!(fire_tick(50, 1), 24);
        // Swing 80: even step unchanged, odd step delayed 12 ticks.
        assert_eq!(fire_tick(80, 0), 0);
        assert_eq!(fire_tick(80, 1), 24 + 12);
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd engine && cargo test -p seq-core swing_delays_offbeat_steps_only`
Expected: FAIL — `no method swing_delay` is not yet referenced, but the odd-step assertion fails because swing is ignored (fires at 24, not 36).

- [ ] **Step 3: Implement `swing_delay` and apply it**

In `engine.rs`, add a method on `impl Engine` (near `roll_pct`, ~line 112):

```rust
    /// Ticks to delay an odd-indexed 16th step (the off-beat) for swing.
    /// 0 at 50% (straight) … TICKS_PER_STEP/2 (12) at 80%. Even steps: 0.
    fn swing_delay(&self, step: u16) -> u32 {
        if self.swing_pct <= 50 || step % 2 == 0 {
            return 0;
        }
        (self.swing_pct - 50) * TICKS_PER_STEP / 60
    }
```

In `service_tick`, change the note-fire guard (currently `if n.tick != pos || n.suppress { continue; }` ~line 572):

```rust
                        // Swing shifts an off-beat step's note later within its
                        // own cell (delay < TICKS_PER_STEP, so it never collides
                        // with the next step). Recorded micro-timed notes keep
                        // their stored tick + the step-parity offset.
                        let fire_tick = n.tick + self.swing_delay(n.step);
                        if fire_tick != pos || n.suppress {
                            continue;
                        }
```

Make sure `OutEvent` is imported in the test module (it is via `use super::*;`).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd engine && cargo test -p seq-core`
Expected: PASS (all existing tests + the new one).

- [ ] **Step 5: Commit**

```bash
cd engine
git add crates/seq-core/src/engine.rs
git commit -m "$(cat <<'EOF'
engine: swing scheduler — delay off-beat 16th steps

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Engine — swing in status + persistence + ENGINE_VERSION bump

**Files:**
- Modify: `engine/crates/seq-core/src/engine.rs` (`status` format string ~line 866 + args)
- Modify: `engine/crates/seq-core/src/persist.rs` (`serialize` ~line 24, `load` match ~line 96)
- Modify: `engine/crates/movy-dsp/src/lib.rs` (`ENGINE_VERSION` constant)
- Modify: `src/seq/constants.ts` (`ENGINE_VERSION`)
- Test: `engine/crates/seq-core/src/persist.rs` (or its tests) + `engine.rs` status test

**Interfaces:**
- Consumes: `Engine.swing_pct` (Task 1).
- Produces: status field `swing=<pct>`; persist line `swing <pct>`; `ENGINE_VERSION = "0.21.0"`.

- [ ] **Step 1: Write the failing tests**

In `engine.rs` tests, add:

```rust
    #[test]
    fn status_reports_swing() {
        let mut e = Engine::new(44100, 12000);
        e.swing_pct = 66;
        assert!(e.status().contains("swing=66"));
    }
```

In `persist.rs` tests (find the existing `mod tests`; if none, add one with `use super::*; use crate::engine::Engine;`), add:

```rust
    #[test]
    fn swing_round_trips() {
        let mut e = Engine::new(44100, 12000);
        e.swing_pct = 72;
        let s = serialize(&e);
        let mut e2 = Engine::new(44100, 12000);
        assert!(load(&mut e2, &s));
        assert_eq!(e2.swing_pct, 72);
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd engine && cargo test -p seq-core status_reports_swing swing_round_trips`
Expected: FAIL — `swing=66` not in status; `e2.swing_pct` stays 50.

- [ ] **Step 3: Add status field, serialize, and load**

In `engine.rs` `status()`, append ` swing={}` to the format string (end of the literal, ~line 866) and add `self.swing_pct,` as the final argument (after `hlmax`):

```rust
            "... hinv={} hlmax={} swing={}",
```
```rust
            hlmax,
            self.swing_pct
```

In `persist.rs` `serialize`, after the `bpm` line (~line 24):

```rust
    s.push_str(&format!("swing {}\n", engine.swing_pct));
```

In `persist.rs` `load`, add a match arm alongside `Some("bpm")` (~line 97):

```rust
            Some("swing") => {
                if let Some(v) = it.next().and_then(|x| x.parse::<u32>().ok()) {
                    engine.swing_pct = v.clamp(50, 80);
                }
            }
```

- [ ] **Step 4: Bump ENGINE_VERSION in both files**

In `engine/crates/movy-dsp/src/lib.rs`, find `ENGINE_VERSION` and change `0.20.0` → `0.21.0`.
In `src/seq/constants.ts` line 22, change `'0.20.0'` → `'0.21.0'`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd engine && cargo test -p seq-core`
Expected: PASS.
Run: `grep -n "0.21.0" engine/crates/movy-dsp/src/lib.rs movy/src/seq/constants.ts` (from repo root, adjust paths) — both present.

- [ ] **Step 6: Commit**

```bash
# Run from the movy/ directory (the git repo root); engine/ lives inside it.
git add engine/crates/seq-core/src/engine.rs engine/crates/seq-core/src/persist.rs \
        engine/crates/movy-dsp/src/lib.rs src/seq/constants.ts
git commit -m "$(cat <<'EOF'
engine: swing in status + persistence; bump ENGINE_VERSION 0.21.0

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: UI — mirror swing from engine status

**Files:**
- Modify: `src/seq/state.ts` (`SeqUiState` interface + `defaults()`)
- Modify: `src/seq/engine.ts` (`parseStatus` ~line 158)
- Test: `browser-test/logic.mjs`

**Interfaces:**
- Consumes: status field `swing=` (Task 3).
- Produces: `seqState.swingPct: number` (default 50), updated on each status poll.

- [ ] **Step 1: Write the failing test**

In `browser-test/logic.mjs`, add a test that drives `parseStatusForTest` and checks the mirror. Find the existing import of `parseStatusForTest`/`seqState` (search the file); add:

```js
import { parseStatusForTest } from '../dist/esm/seq/engine.js';
import { seqState } from '../dist/esm/seq/state.js';
// ... within the test runner:
parseStatusForTest('play=1 bpm=12000 swing=66');
assertEqual(seqState.swingPct, 66, 'swing mirrored from status');
```

(Use the file's existing assertion helper and registration style — match the surrounding tests.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd movy && npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL — `swingPct` is `undefined`.

- [ ] **Step 3: Add the field + parse**

In `src/seq/state.ts`, add to `SeqUiState` (after `bpmX100`):

```ts
    swingPct: number;        // engine swing %, 50..80 (from `swing=`)
```

In `defaults()` (after `bpmX100: 12000,`):

```ts
        swingPct: 50,
```

In `src/seq/engine.ts` `parseStatus`, after the `bpm` arm (~line 158):

```ts
        else if (key === 'swing') seqState.swingPct = Number(val) || seqState.swingPct;
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd movy && npm run build:browser && node browser-test/logic.mjs`
Expected: PASS (0 failures).

- [ ] **Step 5: Commit**

```bash
git add src/seq/state.ts src/seq/engine.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
ui: mirror engine swing into seqState

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: UI — scales data module

**Files:**
- Create: `src/seq/scales.ts`
- Test: `browser-test/logic.mjs`

**Interfaces:**
- Produces:
  - `interface Scale { name: string; degrees: number[] }`
  - `SCALES: Scale[]` (13 entries)
  - `SCALE_NAMES: string[]`
  - `inScaleFor(pitch: number, root: number, scaleIdx: number): boolean`

- [ ] **Step 1: Write the failing test**

In `browser-test/logic.mjs`:

```js
import { SCALES, SCALE_NAMES, inScaleFor } from '../dist/esm/seq/scales.js';
// ...
assertEqual(SCALES.length, 13, 'thirteen scales');
assertEqual(SCALE_NAMES[0], 'Major', 'first scale is Major');
// Major anchored to D (root 2): D E F# G A B C# in scale; F natural (5) out.
assertEqual(inScaleFor(2, 2, 0), true, 'root in scale');     // D
assertEqual(inScaleFor(6, 2, 0), true, 'F# in D major');     // F#
assertEqual(inScaleFor(5, 2, 0), false, 'F natural out of D major');
// Chromatic (index 12): everything in scale.
assertEqual(inScaleFor(5, 2, 12), true, 'chromatic admits all');
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd movy && npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the module**

`src/seq/scales.ts`:

```ts
/* Selectable musical scales for the Main Params "Key" knob. Degrees are
 * semitone offsets from the root (0..11). Global across all chromatic tracks;
 * drives in-scale pad highlighting only — never folds the chromatic layout. */

export interface Scale {
    name:    string;
    degrees: number[];
}

export const SCALES: Scale[] = [
    { name: 'Major',      degrees: [0, 2, 4, 5, 7, 9, 11] },
    { name: 'Minor',      degrees: [0, 2, 3, 5, 7, 8, 10] },
    { name: 'Dorian',     degrees: [0, 2, 3, 5, 7, 9, 10] },
    { name: 'Phrygian',   degrees: [0, 1, 3, 5, 7, 8, 10] },
    { name: 'Lydian',     degrees: [0, 2, 4, 6, 7, 9, 11] },
    { name: 'Mixolydian', degrees: [0, 2, 4, 5, 7, 9, 10] },
    { name: 'Locrian',    degrees: [0, 1, 3, 5, 6, 8, 10] },
    { name: 'Harm Min',   degrees: [0, 2, 3, 5, 7, 8, 11] },
    { name: 'Mel Min',    degrees: [0, 2, 3, 5, 7, 9, 11] },
    { name: 'Maj Penta',  degrees: [0, 2, 4, 7, 9] },
    { name: 'Min Penta',  degrees: [0, 3, 5, 7, 10] },
    { name: 'Blues',      degrees: [0, 3, 5, 6, 7, 10] },
    { name: 'Chromatic',  degrees: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
];

export const SCALE_NAMES: string[] = SCALES.map((s) => s.name);

/** True if `pitch` is in `scaleIdx` anchored to `root` (any octave of root). */
export function inScaleFor(pitch: number, root: number, scaleIdx: number): boolean {
    const s = SCALES[scaleIdx] ?? SCALES[0];
    const deg = (((pitch - root) % 12) + 12) % 12;
    return s.degrees.includes(deg);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd movy && npm run build:browser && node browser-test/logic.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/seq/scales.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
ui: scales data module (13 scales, inScaleFor)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: UI — anchor pad highlighting to root + selected scale

**Files:**
- Modify: `src/keyboard/state.ts` (add `scale`)
- Modify: `src/seq/pads.ts` (`inScale`, `chromaticPadColor` root highlight + scale)
- Modify: `src/app/tick.ts` (3 `chromaticPadColor` call sites: ~line 194, ~line 361; the init batch and per-tick update)
- Modify: `src/keyboard/handler.ts` (`noteOff` ~line 22, `changeRoot` ~line 37 `chromaticPadColor` calls)
- Test: `browser-test/logic.mjs`

**Interfaces:**
- Consumes: `inScaleFor` (Task 5).
- Produces: `keyboardState.scale: number`; `chromaticPadColor(..., scaleIdx = 0)` — root highlight when `pitch ≡ baseNote (mod 12)`, in-scale uses `scaleIdx`.

- [ ] **Step 1: Write the failing test**

In `browser-test/logic.mjs`:

```js
import { chromaticPadColor } from '../dist/esm/seq/pads.js';
// PAD_MIN=68, baseNote=48 (C). Bottom-left pad (68) plays pitch 48 (C) → root.
// With baseNote=50 (D), pad 68 plays 50 (D) → root color; old code keyed on C only.
const ROOT_T0 = chromaticPadColor(68, 68, 50, 0, false, null, 0); // D major, root pad
const trackCol = chromaticPadColor(68, 68, 48, 0, false, null, 0); // C major, root pad
assertEqual(ROOT_T0, trackCol, 'root highlight follows baseNote pitch class');
```

(Use the file's assertion helpers; the key point is that the bottom-left pad — pitch == baseNote — is the root color regardless of which note baseNote is.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd movy && npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL — current `chromaticPadColor` takes no `scaleIdx` arg / keys root on `semitone === 0`.

- [ ] **Step 3: Add `scale` to keyboard state**

In `src/keyboard/state.ts`:

```ts
export const keyboardState = {
    rootNote: 48,
    scale:    0,                              /* index into SCALES (0 = Major) */
    held:     {} as Record<number, number>,
    lastPlayedNote: 60,
};
```

- [ ] **Step 4: Rework `pads.ts`**

Replace the `MAJOR` constant + `inScale` + the root test in `chromaticPadColor`:

```ts
import { inScaleFor } from './scales.js';
// (remove: const MAJOR = [0, 2, 4, 5, 7, 9, 11];)

export function inScale(pitch: number, baseNote: number, scaleIdx: number): boolean {
    return inScaleFor(pitch, baseNote, scaleIdx);
}

export function chromaticPadColor(
    padNote: number,
    padMin: number,
    baseNote: number,
    track: number,
    isPlaying: boolean,
    holdNotes: number[] | null = null,
    scaleIdx = 0,
): number {
    const pitch = chromaticPitch(padNote, padMin, baseNote);
    if (pitch < 0 || pitch > 127) return C_BLACK;
    if (isPlaying) return C_GREEN;
    const white = holdNotes !== null ? holdNotes.includes(pitch) : noteHeld(track, pitch);
    if (white) return C_WHITE;
    // Root = any pitch sharing the layout base note's pitch class (the musical
    // tonic; root transposes the layout, so base == tonic).
    if ((((pitch - baseNote) % 12) + 12) % 12 === 0) return trackColor(track);
    return inScale(pitch, baseNote, scaleIdx) ? C_LIGHTGREY : C_BLACK;
}
```

- [ ] **Step 5: Pass `keyboardState.scale` at every call site**

In `src/app/tick.ts`:
- init batch (~line 194):
  `const color = chromaticPadColor(p, PAD_MIN, base, appState.activeSlot, false, null, keyboardState.scale);`
- per-tick update (~line 361):
  `const color = chromaticPadColor(p, PAD_MIN, base, track, isPlaying, holdNotes, keyboardState.scale);`

In `src/keyboard/handler.ts`:
- `noteOff` (~line 22):
  `setLED(padNote, chromaticPadColor(padNote, padMin, keyboardState.rootNote, track, false, null, keyboardState.scale), true);`
- `changeRoot` (~line 37):
  `setLED(pad, chromaticPadColor(pad, padMin, keyboardState.rootNote, track, false, null, keyboardState.scale), true);`

- [ ] **Step 6: Run to verify it passes**

Run: `cd movy && npm run build:browser && npm run typecheck && node browser-test/logic.mjs`
Expected: PASS, zero TS errors.

- [ ] **Step 7: Commit**

```bash
git add src/keyboard/state.ts src/seq/pads.ts src/app/tick.ts src/keyboard/handler.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
ui: anchor chromatic pad highlight to root note + selected scale

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: UI — Main Params page state + knob/touch/release handlers

**Files:**
- Create: `src/seq/main-page.ts`
- Test: `browser-test/logic.mjs`

**Interfaces:**
- Consumes: `seqState.bpmX100`, `seqState.swingPct`; `keyboardState.rootNote`, `keyboardState.scale`; `changeRoot` (handler.ts); `SCALE_NAMES` (scales.ts); `seqCmd` (engine.ts); `PAD_MIN`, `PAD_MAX` (constants.ts).
- Produces:
  - `mainPageState` `{ active, origin, touchedKnob, scaleOverlay, scaleSel }`
  - `mainPageActive(): boolean`
  - `openMainPage(origin: number): void`
  - `closeMainPage(): number` (returns origin view to restore)
  - `mainPageKnob(k: number, delta: number, track: number): void`
  - `mainPageTouch(k: number, down: boolean): void`
  - `mainPageRelease(k: number): void`
  - `resetMainPage(): void`

**Knob map:** 0 = Tempo (±1 BPM, clamp 20–300 → `bpm <x100>`), 1 = Swing (±1%, clamp 50–80 → `swing <pct>`), 2 = Root (±1 semitone via `changeRoot`), 3 = Key (touch opens overlay; turn scrolls `scaleSel`; release commits to `keyboardState.scale`). Detent divisor 8.

- [ ] **Step 1: Write the failing test**

In `browser-test/logic.mjs`:

```js
import {
    mainPageState, openMainPage, closeMainPage, mainPageActive,
    mainPageKnob, mainPageTouch, mainPageRelease, resetMainPage,
} from '../dist/esm/seq/main-page.js';
import { peekSeqCmdQueue, resetSeqEngine } from '../dist/esm/seq/engine.js';
import { keyboardState } from '../dist/esm/keyboard/state.js';

resetMainPage(); resetSeqEngine();
openMainPage(3);
assertEqual(mainPageActive(), true, 'page active after open');
// Tempo: 8 raw delta units = 1 detent = +1 BPM. seqState.bpmX100 starts 12000.
mainPageKnob(0, 8, 0);
assert(peekSeqCmdQueue().some((c) => c.startsWith('bpm 12100')), 'tempo +1 BPM emits bpm 12100');
// Swing: +1 detent → swing 51.
mainPageKnob(1, 8, 0);
assert(peekSeqCmdQueue().some((c) => c === 'swing 51'), 'swing +1 emits swing 51');
// Key overlay: touch opens, turn scrolls, release commits.
mainPageTouch(3, true);
assertEqual(mainPageState.scaleOverlay, true, 'overlay opens on key touch');
mainPageKnob(3, 8, 0);                 // scroll to scale index 1
assertEqual(mainPageState.scaleSel, 1, 'overlay scrolled');
mainPageRelease(3);
assertEqual(keyboardState.scale, 1, 'scale committed on release');
assertEqual(mainPageState.scaleOverlay, false, 'overlay closed on release');
// Close returns origin.
assertEqual(closeMainPage(), 3, 'close returns origin view');
assertEqual(mainPageActive(), false, 'page inactive after close');
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd movy && npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the module**

`src/seq/main-page.ts`:

```ts
/* Main Parameters page: a global sequencer settings view (Tempo, Swing, Root,
 * Key) opened with Shift+Step 5/7/9 and exited with Back. Built to host more
 * pages later. Knob 0 tempo, 1 swing, 2 root, 3 key (scrollable scale overlay).
 * Mirrors the step-parameter page's structure; rendering reads main-page-vm. */

import { seqState } from './state.js';
import { seqCmd } from './engine.js';
import { SCALE_NAMES } from './scales.js';
import { keyboardState } from '../keyboard/state.js';
import { changeRoot } from '../keyboard/handler.js';
import { PAD_MIN, PAD_MAX } from './constants.js';

const DETENT = 8;                       // raw delta units per value step
const BPM_MIN_X100 = 2000, BPM_MAX_X100 = 30000;
const SWING_MIN = 50, SWING_MAX = 80;

export const mainPageState = {
    active: false,
    origin: 0,                          // view to restore on Back
    touchedKnob: -1,                    // 0..3 drives the top toast; -1 none
    scaleOverlay: false,                // Key list open
    scaleSel: 0,                        // highlighted scale while the list is open
};

const accum = [0, 0, 0, 0];

/** Raw delta → number of detents (±), keeping the remainder. */
function detents(k: number, delta: number): number {
    accum[k] += delta;
    let n = 0;
    while (accum[k] >= DETENT)  { accum[k] -= DETENT; n++; }
    while (accum[k] <= -DETENT) { accum[k] += DETENT; n--; }
    return n;
}

export function mainPageActive(): boolean { return mainPageState.active; }

export function openMainPage(origin: number): void {
    mainPageState.active = true;
    mainPageState.origin = origin;
    mainPageState.touchedKnob = -1;
    mainPageState.scaleOverlay = false;
    accum.fill(0);
}

/** Close the page; returns the origin view the caller should restore. */
export function closeMainPage(): number {
    mainPageState.active = false;
    mainPageState.touchedKnob = -1;
    mainPageState.scaleOverlay = false;
    return mainPageState.origin;
}

export function mainPageTouch(k: number, down: boolean): void {
    mainPageState.touchedKnob = down ? k : -1;
    if (k === 3 && down) {
        mainPageState.scaleOverlay = true;
        mainPageState.scaleSel = keyboardState.scale;
        accum[3] = 0;
    }
}

export function mainPageRelease(k: number): void {
    if (k === 3 && mainPageState.scaleOverlay) {
        keyboardState.scale = mainPageState.scaleSel;
        mainPageState.scaleOverlay = false;
    }
    if (mainPageState.touchedKnob === k) mainPageState.touchedKnob = -1;
}

export function mainPageKnob(k: number, delta: number, track: number): void {
    mainPageState.touchedKnob = k;
    const n = detents(k, delta);
    if (n === 0) return;
    if (k === 0) {
        const next = Math.max(BPM_MIN_X100, Math.min(BPM_MAX_X100, seqState.bpmX100 + n * 100));
        if (next !== seqState.bpmX100) { seqState.bpmX100 = next; seqCmd('bpm ' + next); }
    } else if (k === 1) {
        const next = Math.max(SWING_MIN, Math.min(SWING_MAX, seqState.swingPct + n));
        if (next !== seqState.swingPct) { seqState.swingPct = next; seqCmd('swing ' + next); }
    } else if (k === 2) {
        // Root knob transposes the layout by n semitones (changeRoot clamps to
        // 0..103 and repaints the pads); octave buttons remain ±12.
        changeRoot(n, track, PAD_MIN, PAD_MAX);
    } else if (k === 3 && mainPageState.scaleOverlay) {
        mainPageState.scaleSel = Math.max(0, Math.min(SCALE_NAMES.length - 1, mainPageState.scaleSel + n));
    }
}

export function resetMainPage(): void {
    mainPageState.active = false;
    mainPageState.origin = 0;
    mainPageState.touchedKnob = -1;
    mainPageState.scaleOverlay = false;
    mainPageState.scaleSel = 0;
    accum.fill(0);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd movy && npm run build:browser && npm run typecheck && node browser-test/logic.mjs`
Expected: PASS, zero TS errors.

- [ ] **Step 5: Commit**

```bash
git add src/seq/main-page.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
ui: main params page state + knob/touch/release handlers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: UI — Main Params page ViewModel

**Files:**
- Create: `src/seq/main-page-vm.ts`
- Test: `browser-test/logic.mjs`

**Interfaces:**
- Consumes: `mainPageState` (Task 7), `seqState.bpmX100`, `seqState.swingPct`, `keyboardState.rootNote/scale`, `SCALE_NAMES`, `midiNoteName`.
- Produces: `buildMainPageVM(): ViewModel`.

**Cells:** knob 0 Tempo (`renderStyle 'preset'`, e.g. `120`), 1 Swing (`'preset'`, `50%`), 2 Root (`'preset'`, note name without octave, e.g. `C`), 3 Key (`type 'enum'`, `isLongEnum`, scale name). Toast for the touched knob: Tempo→`120 bpm`, Swing→`50%`, Root→`C`, Key→scale name. Overlay set when `scaleOverlay`.

- [ ] **Step 1: Write the failing test**

In `browser-test/logic.mjs`:

```js
import { buildMainPageVM } from '../dist/esm/seq/main-page-vm.js';
import { mainPageState, resetMainPage } from '../dist/esm/seq/main-page.js';
import { seqState } from '../dist/esm/seq/state.js';
import { keyboardState } from '../dist/esm/keyboard/state.js';

resetMainPage();
seqState.bpmX100 = 12000; seqState.swingPct = 50;
keyboardState.rootNote = 48; keyboardState.scale = 0; // C, Major
mainPageState.active = true; mainPageState.touchedKnob = 0;
let vm = buildMainPageVM();
assertEqual(vm.rows[0][0].displayValue, '120', 'tempo cell shows 120');
assertEqual(vm.rows[0][2].displayValue, 'C', 'root cell shows C');
assertEqual(vm.rows[0][3].displayValue, 'Major', 'key cell shows Major');
assertEqual(vm.toast.fullName, 'Tempo', 'toast names tempo');
assertEqual(vm.toast.value, '120 bpm', 'tempo toast value');
// Overlay present when scale list open.
mainPageState.scaleOverlay = true; mainPageState.scaleSel = 1; mainPageState.touchedKnob = 3;
vm = buildMainPageVM();
assert(vm.overlay && vm.overlay.options.length === 13, 'overlay carries 13 scales');
assertEqual(vm.overlay.selected, 1, 'overlay selection from scaleSel');
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd movy && npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the module**

`src/seq/main-page-vm.ts`:

```ts
/* Builds the Main Params page ViewModel. Knob 0 tempo, 1 swing, 2 root, 3 key.
 * Big-font 'preset' cells for tempo/swing/root; key is an enum that opens the
 * scrollable scale overlay. Mirrors step-page-vm's cell/toast conventions. */

import type { ViewModel, ParamVM } from '../types/viewmodel.js';
import { mainPageState } from './main-page.js';
import { seqState } from './state.js';
import { keyboardState } from '../keyboard/state.js';
import { SCALE_NAMES } from './scales.js';
import { midiNoteName } from '../keyboard/notes.js';

/* Root note name without the octave (the layout tonic's pitch class). */
function rootName(): string {
    return midiNoteName(keyboardState.rootNote).replace(/-?\d+$/, '');
}

function cell(p: Partial<ParamVM>): ParamVM {
    return {
        shortName: '', fullName: '', type: 'float', normalizedValue: 0,
        displayValue: '', touched: false, isLongEnum: false, options: null,
        enumIndex: 0, renderStyle: 'arc', automated: false, automatable: false,
        assigned: false, ...p,
    };
}

export function buildMainPageVM(): ViewModel {
    const bpm   = Math.round(seqState.bpmX100 / 100);
    const swing = seqState.swingPct;
    const scale = keyboardState.scale;

    const tempo = cell({
        shortName: 'TEMPO', fullName: 'Tempo', renderStyle: 'preset',
        displayValue: String(bpm),
    });
    const sw = cell({
        shortName: 'SWING', fullName: 'Swing', renderStyle: 'preset',
        displayValue: swing + '%',
    });
    const root = cell({
        shortName: 'ROOT', fullName: 'Root', renderStyle: 'preset',
        displayValue: rootName(),
    });
    const key = cell({
        shortName: 'KEY', fullName: 'Key', type: 'enum',
        options: SCALE_NAMES, isLongEnum: true,
        enumIndex: scale, displayValue: SCALE_NAMES[scale],
    });

    const cells = [tempo, sw, root, key];
    const tk = mainPageState.touchedKnob;
    let toast = null;
    if (tk >= 0 && tk < cells.length) {
        cells[tk].touched = true;
        // Tempo's toast carries the unit; the others mirror the cell value.
        const value = tk === 0 ? bpm + ' bpm' : cells[tk].displayValue;
        toast = { fullName: cells[tk].fullName, value, browseHint: false };
    }

    const overlay = mainPageState.scaleOverlay
        ? { slot: 3, options: SCALE_NAMES, selected: mainPageState.scaleSel }
        : null;

    return {
        moduleName: 'MAIN', bankName: '', bankIndex: 0, bankCount: 1,
        rows: [[tempo, sw, root, key], [null, null, null, null]],
        touchedSlot: null, toast, overlay, isEmpty: false,
        drumPadCount: 0, drumCurrentPad: 0, drumCurrentPhysPad: 0, isPadSpecific: false,
        automationHeld: false, automationPoolFull: false,
        stepPagePresent: false, stepPageSelected: false,
    };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd movy && npm run build:browser && npm run typecheck && node browser-test/logic.mjs`
Expected: PASS, zero TS errors.

- [ ] **Step 5: Commit**

```bash
git add src/seq/main-page-vm.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
ui: main params page ViewModel (tempo/swing/root/key + scale overlay)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: UI — wire entry, knob/touch routing, Back exit, render dispatch

**Files:**
- Modify: `src/app/state.ts` (add `VIEW_MAIN_PARAMS`)
- Modify: `src/seq/router.ts` (`shiftStepFunction` — open on steps 5/7/9)
- Modify: `src/midi/router.ts` (touch block ~line 59, knob-CC block ~line 130, Back handler ~line 191)
- Modify: `src/app/tick.ts` (render dispatch + repaint signature)
- Test: `browser-test/app-loop.mjs`

**Interfaces:**
- Consumes: all of Task 7/8 (`mainPageActive`, `openMainPage`, `closeMainPage`, `mainPageKnob`, `mainPageTouch`, `mainPageRelease`, `buildMainPageVM`).
- Produces: `VIEW_MAIN_PARAMS` constant; Shift+Step 5/7/9 opens the page; Back closes it; the page renders via `renderKnobsView`.

- [ ] **Step 1: Write the failing test**

In `browser-test/app-loop.mjs`, add a scenario (match the harness's existing MIDI-injection + assertion helpers — it already drives `onMidiMessageInternal` and inspects the seq command queue / framebuffer). Pseudocode to adapt:

```js
// Shift+Step 5 opens the Main Params page.
setShift(true);
sendNoteOn(STEP_NOTE_BASE + 4, 127);  // step 5 (0-indexed button 4)
sendNoteOff(STEP_NOTE_BASE + 4);
setShift(false);
assertEqual(appState.currentView, VIEW_MAIN_PARAMS, 'shift+step 5 opens main params');
// Knob 1 turn raises tempo (emits a bpm command).
sendKnobCC(0, /* CW delta encoded */ 8);
assert(peekSeqCmdQueue().some((c) => c.startsWith('bpm ')), 'knob edits tempo on main page');
// Back closes the page, restoring origin.
sendCC(MoveBack, 127);
assert(appState.currentView !== VIEW_MAIN_PARAMS, 'Back exits main params');
```

(Use the file's real helpers and the encoded-delta convention it already uses for knob CCs. `STEP_NOTE_BASE` and `MoveBack` come from constants/globals the harness sets up.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd movy && npm run build:browser && node browser-test/app-loop.mjs`
Expected: FAIL — `VIEW_MAIN_PARAMS` undefined / page never opens.

- [ ] **Step 3: Add the view constant**

In `src/app/state.ts` (after `VIEW_FILE_BROWSE = 4;`):

```ts
export const VIEW_MAIN_PARAMS = 6;
```

- [ ] **Step 4: Open the page from Shift+Step 5/7/9**

In `src/seq/router.ts`, add imports at the top:

```ts
import { openMainPage } from './main-page.js';
import { appState, VIEW_MAIN_PARAMS } from '../app/state.js';
```

Add the step constants near the others (~line 62):

```ts
/* Shift+Step 5/7/9 all open the Main Params page (page 0). The map keeps room
 * for future pages — point a step at a different page index here. */
const MAIN_PAGE_STEPS: Record<number, number> = { 4: 0, 6: 0, 8: 0 };
```

In `shiftStepFunction(step)`, add at the top of the function body:

```ts
    if (step in MAIN_PAGE_STEPS) {
        if (appState.currentView !== VIEW_MAIN_PARAMS) openMainPage(appState.currentView);
        appState.dirty = true;
        return;
    }
```

(If importing `appState` into `src/seq/router.ts` creates a circular import that breaks the build, instead expose a thin setter: have `shiftStepFunction` call a new `requestOpenMainPage()` in `main-page.ts` that records intent, and open it in `app/tick.ts`. Verify with `npm run build:device` — if it builds, the direct import is fine.)

- [ ] **Step 5: Route touch + knob CC + Back to the page**

In `src/midi/router.ts`, add imports:

```ts
import {
    mainPageActive, mainPageKnob, mainPageTouch, mainPageRelease, closeMainPage,
} from '../seq/main-page.js';
import { VIEW_MAIN_PARAMS } from '../app/state.js';
```

In the capacitive-touch block (after the step-page intercept, ~line 66):

```ts
        if (mainPageActive()) {
            if (d1 < 4) {
                if (d2 > 0) mainPageTouch(d1, true);
                else mainPageRelease(d1);
            }
            appState.dirty = true;
            return;
        }
```

In the knob-CC block (after the step-page intercept, ~line 133):

```ts
        if (mainPageActive()) {
            if (k < 4) mainPageKnob(k, delta, appState.activeSlot);
            appState.dirty = true;
            return;
        }
```

In the Back handler (`if (d1 === MoveBack && d2 > 0)`, ~line 191), add as the first branch inside:

```ts
        if (mainPageActive()) {
            appState.currentView = closeMainPage();
            appState.dirty = true;
            return;
        }
```

- [ ] **Step 6: Render the page + repaint on change**

In `src/app/tick.ts`, add imports:

```ts
import { mainPageActive } from '../seq/main-page.js';
import { buildMainPageVM } from '../seq/main-page-vm.js';
import { mainPageState } from '../seq/main-page.js';
import { VIEW_MAIN_PARAMS } from './state.js';
```

Add a repaint signature near `stepTrigSig` (so value/touch/overlay changes force a frame):

```ts
let lastMainSig = '';
function mainSig(): string {
    return [mainPageState.active, mainPageState.touchedKnob, mainPageState.scaleOverlay,
        mainPageState.scaleSel, seqState.bpmX100, seqState.swingPct,
        keyboardState.rootNote, keyboardState.scale].join(',');
}
```

In `tick()`, beside the existing step-page dirty check (~line 133):

```ts
    if (mainSig() !== lastMainSig) { lastMainSig = mainSig(); appState.dirty = true; }
```

In the render dispatch chain (the `if (appState.currentView === VIEW_BROWSE) … else if …` block ~line 241), add a branch BEFORE the `VIEW_KEYS`/`VIEW_KNOBS` ones (so it wins when active):

```ts
        } else if (appState.currentView === VIEW_MAIN_PARAMS) {
            renderKnobsView(buildMainPageVM(), false, appState.activeSlot);
```

- [ ] **Step 7: Run all local suites**

Run:
```bash
cd movy && npm run build:browser && npm run typecheck \
  && node browser-test/logic.mjs && node browser-test/app-loop.mjs
```
Expected: PASS, zero TS errors. (Device build sanity: `npm run build:device` succeeds.)

- [ ] **Step 8: Commit**

```bash
git add src/app/state.ts src/seq/router.ts src/midi/router.ts src/app/tick.ts browser-test/app-loop.mjs
git commit -m "$(cat <<'EOF'
ui: wire main params page — shift+step entry, knob/touch routing, Back exit, render

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: UI — persist Root + Scale across sessions

**Files:**
- Modify: `src/seq/persist.ts` (companion UI-state file)
- Modify: `src/seq/main-page.ts` (mark UI state dirty on root/scale change)
- Modify: `src/keyboard/handler.ts` (`changeRoot` marks UI state dirty)
- Test: `browser-test/logic.mjs`

**Interfaces:**
- Produces: `markUiStateDirty(): void`, `loadUiState(): void`, `saveUiStateNow(): string` (serialized `{root,scale}`) — exact names below; called from `seqPersistTick`.

**Rationale:** Tempo and Swing persist through the engine state blob already ferried by `seqPersistTick`. Root and Scale are UI-only, so they persist to a tiny companion file `movy-ui.json` next to `seq-state.json`, written when changed and read once on load — keeping the engine boundary clean (engine stores no UI state).

- [ ] **Step 1: Write the failing test**

In `browser-test/logic.mjs` (the harness stubs `host_read_file`/`host_write_file` — match its existing file-mock pattern; if none exists, assert the serialize/parse helpers directly):

```js
import { serializeUiState, applyUiState } from '../dist/esm/seq/persist.js';
import { keyboardState } from '../dist/esm/keyboard/state.js';

keyboardState.rootNote = 50; keyboardState.scale = 2;
const blob = serializeUiState();
keyboardState.rootNote = 48; keyboardState.scale = 0;
applyUiState(blob);
assertEqual(keyboardState.rootNote, 50, 'root restored');
assertEqual(keyboardState.scale, 2, 'scale restored');
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd movy && npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL — exports missing.

- [ ] **Step 3: Implement companion persistence**

In `src/seq/persist.ts`, add near the top:

```ts
import { keyboardState } from '../keyboard/state.js';

const UI_STATE_PATH = '/data/UserData/schwung/modules/tools/movy/movy-ui.json';
let uiDirty = false;
let uiLoaded = false;

export function markUiStateDirty(): void { uiDirty = true; }

/** `{root,scale}` JSON of the persisted UI keyboard state. */
export function serializeUiState(): string {
    return JSON.stringify({ root: keyboardState.rootNote, scale: keyboardState.scale });
}

/** Apply a serialized UI-state blob (tolerant of missing/invalid fields). */
export function applyUiState(blob: string): void {
    try {
        const o = JSON.parse(blob);
        if (typeof o.root === 'number') keyboardState.rootNote = Math.max(0, Math.min(103, o.root | 0));
        if (typeof o.scale === 'number') keyboardState.scale = Math.max(0, o.scale | 0);
    } catch { /* corrupt file → keep defaults */ }
}
```

In `seqPersistTick`, after the engine load-once block restores engine state, add a UI load-once (runs whether or not files are available is gated already):

```ts
    if (!uiLoaded) {
        uiLoaded = true;
        const ui = host_read_file(UI_STATE_PATH);
        if (ui && ui.length > 0) applyUiState(ui);
    }
```

And in the save section, after the engine autosave, add:

```ts
    if (uiDirty) {
        uiDirty = false;
        host_write_file(UI_STATE_PATH, serializeUiState());
    }
```

In `resetSeqPersist`, add `uiLoaded = false; uiDirty = false;`.

- [ ] **Step 4: Mark dirty on edits**

In `src/seq/main-page.ts`, import `markUiStateDirty` and call it in `mainPageKnob` for knob 2 (root) and in `mainPageRelease` for the committed scale:

```ts
import { markUiStateDirty } from './persist.js';
// in mainPageKnob, k === 2 branch, after changeRoot(...):
markUiStateDirty();
// in mainPageRelease, after keyboardState.scale = mainPageState.scaleSel:
markUiStateDirty();
```

In `src/keyboard/handler.ts`, import and call `markUiStateDirty()` at the end of `changeRoot` (covers the +/- octave buttons too):

```ts
import { markUiStateDirty } from '../seq/persist.js';
// last line of changeRoot:
markUiStateDirty();
```

(If `handler.ts` importing `seq/persist.ts` creates a cycle — `persist.ts` imports `keyboardState` from `keyboard/state.ts`, not `handler.ts`, so it should be fine. Confirm with `npm run build:device`.)

- [ ] **Step 5: Run to verify it passes**

Run: `cd movy && npm run build:browser && npm run typecheck && node browser-test/logic.mjs`
Expected: PASS, zero TS errors.

- [ ] **Step 6: Commit**

```bash
git add src/seq/persist.ts src/seq/main-page.ts src/keyboard/handler.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
ui: persist root note + scale across sessions (movy-ui.json)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Screenshot baselines for the Main Params page

**Files:**
- Modify: `browser-test/screenshot.mjs` (add states)
- Create: baseline framebuffers (generated by `--update`)
- Test: `browser-test/screenshot.mjs`

**Interfaces:**
- Consumes: `buildMainPageVM`, `renderKnobsView`.

- [ ] **Step 1: Add the render states**

In `browser-test/screenshot.mjs`, following the existing pattern that renders a ViewModel to the framebuffer and diffs it, add cases that call `renderKnobsView(buildMainPageVM(), false, 0)` with `mainPageState`/`seqState`/`keyboardState` configured for:
- `main-default` — nothing touched (Tempo 120, Swing 50%, Root C, Key Major).
- `main-tempo-touched` — `touchedKnob = 0` (toast `120 bpm`, tempo cell inverted).
- `main-swing-touched` — `touchedKnob = 1`.
- `main-root-touched` — `touchedKnob = 2`, `rootNote = 51` (D#).
- `main-key-overlay` — `scaleOverlay = true`, `scaleSel = 1` (scale list open).

Match the harness's case-registration and naming conventions exactly.

- [ ] **Step 2: Generate baselines**

Run: `cd movy && npm run build:browser && node browser-test/screenshot.mjs --update`
Expected: writes the 5 new baseline files; reports them as created.

- [ ] **Step 3: Verify the diff passes**

Run: `node browser-test/screenshot.mjs`
Expected: 0 failures.

- [ ] **Step 4: Eyeball the baselines**

Open the generated baseline images (or the harness's PNG/preview output) and confirm: big-font tempo/swing/root values, the inverted touched cell + top toast, and the scrollable scale list overlay look correct. Fix the VM/render only if something is visually wrong, then re-run `--update`.

- [ ] **Step 5: Commit**

```bash
git add browser-test/screenshot.mjs browser-test/screenshots/baseline
git commit -m "$(cat <<'EOF'
test: screenshot baselines for main params page (+ scale overlay)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Performance check

**Files:**
- Modify: `browser-test/perf.mjs` (add the page to the measured views, if it enumerates views)
- Test: `browser-test/perf.mjs`

**Interfaces:**
- Consumes: the rendered Main Params view.

- [ ] **Step 1: Add the view to the perf harness**

If `perf.mjs` iterates views/ViewModels and asserts `fill_rect` count / IPC calls / render time budgets, add the Main Params view (default + overlay-open) to that set, following the existing pattern. If it only measures the live tick loop, no code change is needed — proceed to Step 2.

- [ ] **Step 2: Run the perf suite**

Run: `cd movy && npm run build:browser && node browser-test/perf.mjs`
Expected: 0 regressions — the static 4-knob page must be within the existing render/IPC budgets (it draws fewer cells than a full 8-knob module page). The page issues `bpm`/`swing` commands only on detents (interaction rate), never per tick, and reads no engine params on render.

- [ ] **Step 3: Commit (only if perf.mjs changed)**

```bash
git add browser-test/perf.mjs
git commit -m "$(cat <<'EOF'
test: include main params page in perf budget checks

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: Device end-to-end verification

**Files:**
- None (verification + final wrap-up). Optionally extend `scripts/test-seq.sh` if it already exercises tempo/persistence.

**Interfaces:**
- Consumes: the deployed `ui.js` + `dsp.so` (ENGINE_VERSION 0.21.0).

- [ ] **Step 1: Check device reachability**

Run:
```bash
ssh -o ConnectTimeout=3 ableton@move.local echo ok 2>/dev/null && echo ONLINE || echo "DEVICE OFFLINE — SKIPPING DEVICE TESTS"
```
If OFFLINE: report to the user **in CAPS** that device verification was skipped, and stop here (the feature is locally verified).

- [ ] **Step 2: Deploy engine + UI**

Run: `cd movy && ./scripts/deploy.sh` (builds `ui.js` + `dsp.so`, atomic `.so` swap; the UI re-issues the DSP load until `ping` returns `0.21.0`).

- [ ] **Step 3: Run sequencer e2e**

Run: `./scripts/test-seq.sh`
Expected: PASS (transport, steps, record, session, persistence). This deploys `dsp.so` too, exercising the new engine version.

- [ ] **Step 4: Manual device smoke (the parts the harness can't assert)**

On the device: Shift+Step 5 opens the page; knob 1 changes tempo (toast `… bpm`, transport audibly follows); knob 2 raises swing and the groove shuffles; knob 3 transposes the chromatic pads and moves the highlighted root; knob 4 opens the scale list and changing it re-highlights in-scale pads; Back returns to the prior view; power-cycle/relaunch restores root + scale (and tempo/swing from engine state).

- [ ] **Step 5: Run the full local suite once more + final commit**

Run:
```bash
cd movy && npm test && (cd engine && cargo test)
```
Expected: all suites 0 failures.

```bash
git add -A   # only if Step 4 surfaced a fix; otherwise nothing to commit
git commit -m "$(cat <<'EOF'
feat: sequencer main parameters page (tempo/swing/root/key) — device verified

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)" 2>/dev/null || echo "nothing to commit"
git push
```

---

## Notes for the implementer

- **Read `movy/CLAUDE.md`** for build/deploy/test specifics and the hard-won device rules (blocking sets, atomic `.so`, never `kill -9` shadow_ui).
- **Circular imports:** `src/seq/` importing `src/app/state.ts` and `src/keyboard/handler.ts` is the one risk area (Tasks 9–10). esbuild will surface a cycle as a build break; each such task notes the fallback (intent-flag indirection). Always run `npm run build:device` before considering a wiring task done.
- **`midiNoteName`** returns e.g. `C3`/`F#3`; `rootName()` strips the trailing octave to show just the pitch class on the Root cell.
- **Swing on recorded micro-timed notes** uses the stored tick plus the step-parity offset; this is intentional and acceptable (step-grid notes are the common case). Parameter automation stays on the straight grid.
