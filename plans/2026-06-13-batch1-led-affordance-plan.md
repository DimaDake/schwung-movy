# Batch 1 — LED color & affordance foundation: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make movy own and correctly paint every Move LED — one track-color source, "lit = pressable / full-bright = active" — including a read-only engine "active notes" field that makes "playing pad = green" faithful during sequencer playback.

**Architecture:** All painting goes through the existing cached LED helpers (`cachedSetLED` / `cachedSetButtonLED` in `seq/leds.ts`) so steady-state wire cost is zero. The engine gains a per-track sounding-notes bitmap serialized into the status poll; the UI mirrors it into a reused buffer and combines it with physically-held pads. New cached painters cover track buttons, step-icon LEDs (CC 16–31), and the affordance buttons. Startup init is extended from pads-only to every LED group, batched ≤8/frame.

**Tech Stack:** TypeScript (movy UI, esbuild → ui.js / dist/esm), Rust (`engine/crates/seq-core`, `movy-dsp` → dsp.so), Node browser tests (`browser-test/*.mjs`).

**Spec:** `movy/plans/2026-06-13-batch1-led-affordance.md`

---

## File structure

| File | Responsibility | Change |
|------|----------------|--------|
| `engine/crates/seq-core/src/engine.rs` | per-track sounding-notes bitmap + `act=` in `status()` | modify |
| `engine/crates/movy-dsp/src/lib.rs` | `ENGINE_VERSION` bump | modify |
| `src/seq/constants.ts` | `ENGINE_VERSION` bump (must match) | modify |
| `src/seq/state.ts` | `activeNotes` buffer + `activeFromStr` / `activeHasNote` | modify |
| `src/seq/engine.ts` | parse `act=` in `parseStatus` | modify |
| `src/seq/colors.ts` | brightness constants (`C_GREEN` already; add white-LED levels) | modify |
| `src/keyboard/leds.ts` | drum pad: track-color / white-selected / green-playing | modify |
| `src/seq/pads.ts` | chromatic pad: green-playing / white last-held-set | modify |
| `src/seq/held.ts` | per-track last-held pad set (new, shared by router + pads) | create |
| `src/seq/leds.ts` | transport recolor + track-button painter + step-icon painter + affordance painter + extend init invalidate | modify |
| `src/seq/buttons.ts` | pure affordance state functions (Back/arrows/sample/etc. → color) | create |
| `src/app/tick.ts` | extend progressive LED init to all groups | modify |
| `browser-test/logic.mjs` | assertions for every new pure function | modify |

**Conventions to follow** (already in the codebase):
- Pure color/state functions live in their own module and are unit-tested in `logic.mjs` (imported from `../dist/esm/...`).
- `seq/leds.ts` owns all cached LED emission; new painters add functions there but delegate color decisions to pure helpers.
- Hardware constants are defined locally in `seq/` (not via injected globals) so browser tests run unmodified — see `seq/colors.ts` / `seq/constants.ts`.
- Build before running `.mjs` tests: `npm run build:browser`.

---

## Task 1: Engine — per-track sounding-notes bitmap

**Files:**
- Modify: `engine/crates/seq-core/src/engine.rs`
- Test: `engine/crates/seq-core/src/engine.rs` (`#[cfg(test)] mod tests`)

**Background:** `advance_block` pushes `OutEvent::NoteOn { track, pitch, vel }` (around engine.rs:441) and `OutEvent::NoteOff { track, pitch }` (around engine.rs:284 and 417). We track which pitches are currently sounding per track in a `[u128; 4]` bitmap (bit `p` = pitch `p`). Live pad notes do **not** flow through these events (the UI sounds them directly), so this set is exactly the sequenced-playback notes — which is what we want.

- [ ] **Step 1: Write the failing test**

Add to `engine.rs` tests module (near `status_reports_watched_clip`):

```rust
#[test]
fn status_reports_active_notes_during_playback() {
    let mut e = engine();
    // One note on track 0 at step 0, then start playback.
    e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
    e.set_playing(true);
    // Advance just past the note's trigger so it is sounding (gate open).
    let _ = run_ticks(&mut e, 1);
    let s = e.status();
    let act = s.split("act=").nth(1).unwrap().split(' ').next().unwrap();
    // Format: 4 comma-separated tracks, dot-separated pitches; track 0 sounds 60.
    assert_eq!(act.split(',').next().unwrap(), "60");
}

#[test]
fn active_notes_clear_when_stopped() {
    let mut e = engine();
    e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
    e.set_playing(true);
    let _ = run_ticks(&mut e, 1);
    e.set_playing(false); // stop must silence + clear the active set
    let s = e.status();
    let act = s.split("act=").nth(1).unwrap().split(' ').next().unwrap();
    assert_eq!(act, ",,,"); // all four tracks empty
}
```

> If `set_playing` is not the exact method name, grep `engine.rs` for the play setter (`grep -n "fn set_playing\|self.playing =" engine.rs`) and use the real one; the contract (start → sounding note appears, stop → cleared) is what matters.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd engine && cargo test -p seq-core status_reports_active_notes_during_playback active_notes_clear_when_stopped`
Expected: FAIL — `act=` not present / field missing.

- [ ] **Step 3: Add the bitmap field**

In the `Engine` struct add:

```rust
/// Pitches currently sounding per track (bit p = pitch p), from the
/// sequenced-playback NoteOn/NoteOff events. Live pad notes are sounded by
/// the UI directly and are intentionally excluded.
active_notes: [u128; 4],
```

Initialize it to `[0; 4]` in `Engine::new` (alongside the other fields).

- [ ] **Step 4: Maintain the bitmap at every event site**

At the `OutEvent::NoteOn { track, pitch, .. }` push site (~engine.rs:441):

```rust
self.active_notes[ti & 3] |= 1u128 << (n.pitch & 127);
out.push(OutEvent::NoteOn { track: ti as u8, pitch: n.pitch, vel: n.vel });
```

At each `OutEvent::NoteOff { track, pitch }` push site (~engine.rs:284 and ~417), immediately before/after the push set:

```rust
self.active_notes[(track as usize) & 3] &= !(1u128 << (pitch & 127));
```

(Use the `track`/`pitch` values already in scope at each site.)

In the play setter, when transitioning to **stopped**, clear it:

```rust
self.active_notes = [0; 4];
```

- [ ] **Step 5: Serialize into `status()`**

Add a helper:

```rust
/// `act=` payload: 4 comma-separated tracks; each is dot-separated sounding
/// pitches (ascending), empty when silent. e.g. "60.64,,38," .
fn active_notes_state(&self) -> String {
    let mut out = String::with_capacity(48);
    for (i, bits) in self.active_notes.iter().enumerate() {
        if i > 0 { out.push(','); }
        let mut first = true;
        for p in 0u8..128 {
            if bits & (1u128 << p) != 0 {
                if !first { out.push('.'); }
                out.push_str(&p.to_string());
                first = false;
            }
        }
    }
    out
}
```

Append `act={}` to the `status()` format string and pass `self.active_notes_state()`:

```rust
            "play={} tick={} bpm={} trk={} step={} len={} lstart={} rec={} cin={} metro={} dirty={} sess={} act={} occ={}",
            // ...existing args...,
            self.active_notes_state(),
            clip.occupancy_hex_lane(self.watch_lane)
```

> Keep `occ=` last (the UI splits `occ=` to end-of-string in a test); insert `act=` before it.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd engine && cargo test -p seq-core`
Expected: PASS (all, including the two new tests).

- [ ] **Step 7: Commit**

```bash
git add engine/crates/seq-core/src/engine.rs
git commit -m "$(cat <<'EOF'
feat(seq-core): report per-track sounding notes in status (act=)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Engine version bump (UI ⇄ engine must match)

**Files:**
- Modify: `engine/crates/movy-dsp/src/lib.rs` (`ENGINE_VERSION`)
- Modify: `src/seq/constants.ts` (`ENGINE_VERSION`)

**Background:** `build-dsp.sh` fails if these diverge; the UI re-issues the DSP load until `ping` returns this version. The status format changed, so bump both.

- [ ] **Step 1: Bump the Rust constant**

In `engine/crates/movy-dsp/src/lib.rs`, change `ENGINE_VERSION` from `"0.9.0"` to `"0.10.0"`.

- [ ] **Step 2: Bump the TS constant**

In `src/seq/constants.ts`, change `export const ENGINE_VERSION = '0.9.0';` to `'0.10.0'`.

- [ ] **Step 3: Verify they match**

Run: `grep -rn "0.10.0" engine/crates/movy-dsp/src/lib.rs src/seq/constants.ts`
Expected: both files print the new version.

- [ ] **Step 4: Commit**

```bash
git add engine/crates/movy-dsp/src/lib.rs src/seq/constants.ts
git commit -m "$(cat <<'EOF'
chore(seq): bump ENGINE_VERSION to 0.10.0 (active-notes status field)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: UI mirror — `activeNotes` buffer + accessors

**Files:**
- Modify: `src/seq/state.ts`
- Test: `browser-test/logic.mjs`

**Background:** Parse `act=` once per poll into a reused `Uint8Array(512)` (`track*128 + pitch`), so the per-tick paint path only reads — no allocation per frame (LED performance rule).

- [ ] **Step 1: Write the failing test**

Add to `browser-test/logic.mjs` (after the existing seq-state imports add `activeFromStr, activeHasNote` to the import from `../dist/esm/seq/state.js`, creating that import line if absent):

```js
import { activeFromStr, activeHasNote } from '../dist/esm/seq/state.js';

function testActiveNotes() {
    _log('\nactive-notes mirror:');
    activeFromStr('60.64,,38,');
    eq('track0 has 60',  activeHasNote(0, 60), true);
    eq('track0 has 64',  activeHasNote(0, 64), true);
    eq('track0 lacks 38', activeHasNote(0, 38), false);
    eq('track1 empty',   activeHasNote(1, 60), false);
    eq('track2 has 38',  activeHasNote(2, 38), true);
    activeFromStr(',,,'); // all clear
    eq('cleared',        activeHasNote(2, 38), false);
}
```

Call `testActiveNotes();` in the file's run sequence (near the other test invocations).

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL — `activeFromStr` is not exported.

- [ ] **Step 3: Implement in `state.ts`**

Add the field to `SeqUiState` (interface) and `defaults()`:

```ts
    activeNotes: Uint8Array; // track*128 + pitch, 1 = sounding (from `act=`)
```
```ts
        activeNotes: new Uint8Array(512),
```

Add the parser + accessor (reuse the buffer; no allocation in the accessor):

```ts
/* Parse the engine's `act=` value (4 comma-separated tracks, dot-separated
 * pitches) into the reused activeNotes buffer. Called once per status poll. */
export function activeFromStr(s: string): void {
    seqState.activeNotes.fill(0);
    const tracks = s.split(',');
    for (let t = 0; t < 4; t++) {
        const g = tracks[t];
        if (!g) continue;
        for (const ps of g.split('.')) {
            const p = Number(ps);
            if (p >= 0 && p < 128) seqState.activeNotes[t * 128 + p] = 1;
        }
    }
}

export function activeHasNote(track: number, pitch: number): boolean {
    if (track < 0 || track > 3 || pitch < 0 || pitch > 127) return false;
    return seqState.activeNotes[track * 128 + pitch] === 1;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: PASS (active-notes mirror block all green).

- [ ] **Step 5: Wire the parser into the poll**

In `src/seq/engine.ts` `parseStatus`, add the import `activeFromStr` and a branch:

```ts
        else if (key === 'act') activeFromStr(val);
```

- [ ] **Step 6: Commit**

```bash
git add src/seq/state.ts src/seq/engine.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
feat(seq): mirror engine active-notes into a reused buffer

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Last-held pad set (selection memory)

**Files:**
- Create: `src/seq/held.ts`
- Modify: `src/seq/router.ts` (record the set on chord entry; reuse in `seqNotePadPlayed`/`seqNotePadReleased`)
- Test: `browser-test/logic.mjs`

**Background:** The chromatic pads light **white** for the pads held together at the last chord entry. The router has a live `heldChord`; we add a per-track *persisted* set that survives release. Putting it in its own module lets both `router.ts` and `pads.ts` use it without a cycle.

- [ ] **Step 1: Write the failing test**

Add to `logic.mjs`:

```js
import { noteHeld, setHeldSet, clearHeldSet } from '../dist/esm/seq/held.js';

function testHeldSet() {
    _log('\nlast-held set:');
    clearHeldSet(0);
    eq('empty initially', noteHeld(0, 60), false);
    setHeldSet(0, [60, 64, 67]);
    eq('60 held',  noteHeld(0, 60), true);
    eq('64 held',  noteHeld(0, 64), true);
    eq('62 not',   noteHeld(0, 62), false);
    eq('track1 unaffected', noteHeld(1, 60), false);
    setHeldSet(0, [72]);                 // replaces
    eq('replaced: 60 gone', noteHeld(0, 60), false);
    eq('replaced: 72 in',   noteHeld(0, 72), true);
}
```

Invoke `testHeldSet();`.

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL — module `seq/held.js` not found.

- [ ] **Step 3: Implement `src/seq/held.ts`**

```ts
/* Per-track "last held" pad set: the MIDI pitches that were held together at
 * the most recent chord entry. Persists after release so the chromatic view
 * can light those pads white (selection memory) and a step press can write the
 * whole set. Kept tiny and allocation-light: one Set per track, reused. */

const lastHeld: Set<number>[] = [new Set(), new Set(), new Set(), new Set()];

export function setHeldSet(track: number, pitches: number[]): void {
    if (track < 0 || track > 3) return;
    const s = lastHeld[track];
    s.clear();
    for (const p of pitches) s.add(p);
}

export function noteHeld(track: number, pitch: number): boolean {
    return track >= 0 && track <= 3 && lastHeld[track].has(pitch);
}

export function clearHeldSet(track: number): void {
    if (track >= 0 && track <= 3) lastHeld[track].clear();
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: PASS.

- [ ] **Step 5: Record the set from the router**

In `src/seq/router.ts`, import `setHeldSet`. In `seqNotePadReleased`, when the last pad of a chord is released, snapshot the chord before clearing. Simplest: in `seqNotePadPlayed`, after `heldChord.set(...)`, update the set to the current chord:

```ts
    heldChord.set(padNote, midiNote);
    setHeldSet(track, [...heldChord.values()]);
```

This keeps `lastHeld[track]` equal to the most recent held combination (it only grows while pads go down and is replaced on the next chord's first press — acceptable: the "last held together" set is the high-water mark of the current gesture).

> Note: replacement on the *next* gesture's first press is desired. If a test later shows we want the set frozen only at full release, revisit; for Batch 1 the high-water-mark behavior matches "all pads held together last time".

- [ ] **Step 6: Commit**

```bash
git add src/seq/held.ts src/seq/router.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
feat(seq): persist per-track last-held pad set for selection memory

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Drum pads — track color / white-selected / green-playing

**Files:**
- Modify: `src/keyboard/leds.ts` (`drumPadLedColor`)
- Modify: `src/app/tick.ts` (call site passes the new args)
- Test: `browser-test/logic.mjs`

**Background:** Today drum pads are `White` (unselected) / `NeonGreen` (selected). New rule: unselected = **track color**, selected pad = **white**, sounding = **green**. `drumPadLedColor` currently takes `(padNote, padMin, drumConfig, rootNote, currentPhysPad)`; add `track` and an `isPlaying` predicate result (computed by the caller from `activeHasNote` OR physically-held). Keep the function pure and import the track palette from `seq/colors.ts`.

- [ ] **Step 1: Write the failing test**

`drumPadLedColor` uses injected globals (`Black`, `White`, `NeonGreen`); the harness already defines some. Add `globalThis.White`, `globalThis.NeonGreen`, `globalThis.Black` near the other mock globals in `logic.mjs` if not present:

```js
globalThis.Black     = 0;
globalThis.White     = 120;
globalThis.NeonGreen = 11;
```

Then the test:

```js
import { drumPadLedColor } from '../dist/esm/keyboard/leds.js';
import { trackColor } from '../dist/esm/seq/colors.js';

function testDrumPadColor() {
    _log('\ndrum pad LED color:');
    const cfg = { rawMidi: false, padNoteStart: 36, padCount: 16 };
    const padMin = 68;
    // pad index 0 => drumPad 1 => note 36; selected when currentPhysPad === pad.
    const unselNotPlaying = drumPadLedColor(68, padMin, cfg, 36, /*phys*/-1, /*track*/2, /*playing*/false);
    eq('unselected = track color', unselNotPlaying, trackColor(2));
    const selected = drumPadLedColor(68, padMin, cfg, 36, /*phys*/68, 2, false);
    eq('selected = white', selected, 120);
    const playing = drumPadLedColor(68, padMin, cfg, 36, -1, 2, /*playing*/true);
    eq('playing = green', playing, 11);
    const off = drumPadLedColor(72, padMin, cfg, 36, -1, 2, false); // col>=4 => off
    eq('right half = off', off, 0);
}
```

Invoke `testDrumPadColor();`.

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL — `drumPadLedColor` arity/colors wrong.

- [ ] **Step 3: Implement**

Rewrite `src/keyboard/leds.ts`:

```ts
import type { DrumConfig } from '../types/param.js';
import { trackColor } from '../seq/colors.js';

export function drumPadLedColor(
    padNote:        number,
    padMin:         number,
    drumConfig:     DrumConfig,
    rootNote:       number,
    currentPhysPad: number,
    track:          number,
    isPlaying:      boolean,
): number {
    let drumPad: number;
    if (drumConfig.rawMidi) {
        drumPad = padNote - drumConfig.padNoteStart + 1;
    } else {
        const padIdx = padNote - padMin;
        const col    = padIdx % 8;
        const row    = Math.floor(padIdx / 8);
        if (col >= 4) return Black;
        drumPad = row * 4 + col + 1;
    }
    if (drumPad < 1 || drumPad > drumConfig.padCount) return Black;
    if (isPlaying)                    return NeonGreen; // sounding (seq or held)
    if (padNote === currentPhysPad)   return White;     // selected pad in rack
    return trackColor(track);
}
```

- [ ] **Step 4: Update the call site in `app/tick.ts`**

Where `drumPadLedColor(...)` is called (tick.ts ~line 102), compute `isPlaying` and pass `track`:

```ts
            const drumCfg = activeModel!.getDrumConfig()!;
            const track   = seqState.watchTrack;
            for (let i = 0; i <= PAD_MAX - PAD_MIN; i++) {
                const p = PAD_MIN + i;
                // The pad's MIDI note (mirrors drumPadLedColor's mapping).
                const idx = p - PAD_MIN, col = idx % 8, row = Math.floor(idx / 8);
                const dp  = drumCfg.rawMidi ? p - drumCfg.padNoteStart + 1 : row * 4 + col + 1;
                const note = drumCfg.rawMidi ? p : drumCfg.padNoteStart + dp - 1;
                const playing = activeHasNote(track, note); // held pads already lit green elsewhere
                setLED(p, drumPadLedColor(p, PAD_MIN, drumCfg, keyboardState.rootNote, dvm!.drumCurrentPhysPad, track, playing), true);
            }
```

Add `import { activeHasNote } from '../seq/state.js';` to `tick.ts` (it already imports `seqState`).

> Physically-held drum pads are sounded directly by `drum-handler.ts` and are momentary; the engine `act=` set does not include them. If device testing shows held drum pads should also turn green, OR the held-pad note into `playing` here using the keyboard held state. Track this as a device-tuning follow-up; functionally the green-on-playback requirement is met by `activeHasNote`.

- [ ] **Step 5: Run logic tests + typecheck**

Run: `npm run typecheck && npm run build:browser && node browser-test/logic.mjs`
Expected: PASS, zero TS errors.

- [ ] **Step 6: Commit**

```bash
git add src/keyboard/leds.ts src/app/tick.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
feat(seq): drum pads use track color, white selected, green sounding

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Chromatic pads — green-playing / white last-held-set

**Files:**
- Modify: `src/seq/pads.ts` (`chromaticPadColor`)
- Modify: `src/app/tick.ts` and `src/keyboard/handler.ts` (call sites)
- Test: `browser-test/logic.mjs`

**Background:** Replace the red "held" color with: sounding pad (active note OR physically held) = **green**; pad in the last-held set = **white**; otherwise the existing root/in-scale coloring. `chromaticPadColor(padNote, padMin, baseNote, track, held)` → add `isPlaying`; read the last-held set via `noteHeld`.

- [ ] **Step 1: Write the failing test**

```js
import { chromaticPadColor, chromaticPitch } from '../dist/esm/seq/pads.js';

function testChromaticColor() {
    _log('\nchromatic pad LED color:');
    const padMin = 68, base = 60; // bottom-left = C4
    // bottom-left pad is the root C => track color, unless playing/held.
    eq('root = track color', chromaticPadColor(68, padMin, base, 0, false, false), trackColor(0));
    eq('playing = green',    chromaticPadColor(68, padMin, base, 0, false, /*playing*/true), 11);
    // mark the held set: pitch at pad 69 = C#4 = 61.
    setHeldSet(0, [chromaticPitch(69, padMin, base)]);
    eq('held-set = white',   chromaticPadColor(69, padMin, base, 0, false, false), 120);
    clearHeldSet(0);
}
```

Invoke `testChromaticColor();` (after `testHeldSet` so imports exist).

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL — arity/colors.

- [ ] **Step 3: Implement**

In `src/seq/pads.ts`, add the import `import { noteHeld } from './held.js';` and the green constant (reuse `C_GREEN` from colors):

```ts
import { C_BLACK, C_GREEN, trackColor } from './colors.js';
```

Rewrite `chromaticPadColor`:

```ts
export function chromaticPadColor(
    padNote: number,
    padMin: number,
    baseNote: number,
    track: number,
    held: boolean,
    isPlaying: boolean,
): number {
    const pitch = chromaticPitch(padNote, padMin, baseNote);
    if (pitch < 0 || pitch > 127) return C_BLACK;
    if (isPlaying || held)   return C_GREEN;          // sounding
    if (noteHeld(track, pitch)) return C_WHITE;       // last-held selection
    const semitone = ((pitch % 12) + 12) % 12;
    if (semitone === 0) return trackColor(track);     // root
    return inScale(pitch) ? C_LIGHTGREY : C_BLACK;
}
```

Add `C_WHITE` to the colors import: `import { C_BLACK, C_GREEN, C_WHITE, trackColor } from './colors.js';`. Remove the now-unused `C_HELD` constant.

- [ ] **Step 4: Update call sites**

`chromaticPadColor` is called in `app/tick.ts` (init batch) and `keyboard/handler.ts` (3 sites). Each must pass `isPlaying`:
- In `app/tick.ts` init batch (line ~47): the init paint is a cold repaint; pass `false` (no notes sounding at init):
  ```ts
            setLED(p, chromaticPadColor(p, PAD_MIN, base, appState.activeSlot, false, false), true);
  ```
- In `keyboard/handler.ts`, the note-on path already lights the pressed pad red via `setLED(padNote, BrightRed, true)`. Change that to green and pass through: simplest is to keep the per-pad repaint but pass `isPlaying`. For the three `chromaticPadColor(...)` calls add a trailing `false` argument (these are the release/refresh repaints; sounding pads are repainted green by the per-tick painter):
  ```ts
        setLED(pad, chromaticPadColor(pad, padMin, keyboardState.rootNote, track, false, false), true);
  ```
  And change `setLED(padNote, BrightRed, true);` (note-on) to `setLED(padNote, C_GREEN, true);` — import `C_GREEN` from `../seq/colors.js`.

> The authoritative per-tick green comes from the chromatic painter reading `activeHasNote`; the immediate green on press is for zero-latency feedback before the next poll.

- [ ] **Step 5: Run logic + typecheck**

Run: `npm run typecheck && npm run build:browser && node browser-test/logic.mjs`
Expected: PASS, zero TS errors.

- [ ] **Step 6: Commit**

```bash
git add src/seq/pads.ts src/app/tick.ts src/keyboard/handler.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
feat(seq): chromatic pads green when sounding, white for last-held set

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Transport LEDs — Play green / Rec red

**Files:**
- Modify: `src/seq/leds.ts` (`paintTransport`)
- Test: `browser-test/logic.mjs`

**Background:** Make the color decision a pure helper so it is testable; the painter just calls it. Play: dark grey → green when playing. Rec: dark grey → red when recording. (Count-in blink is Batch 4; for now Rec is plain red while recording, dark grey otherwise.)

- [ ] **Step 1: Write the failing test**

```js
import { transportPlayColor, transportRecColor } from '../dist/esm/seq/leds.js';

function testTransport() {
    _log('\ntransport LEDs:');
    eq('play stopped = dark grey', transportPlayColor(false), 124);
    eq('play running = green',     transportPlayColor(true), 11);
    eq('rec idle = dark grey',     transportRecColor(false), 124);
    eq('rec recording = red',      transportRecColor(true), 1);
}
```

Invoke `testTransport();`.

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement in `seq/leds.ts`**

Add exported pure helpers and use them in `paintTransport`:

```ts
export function transportPlayColor(playing: boolean): number {
    return playing ? C_GREEN : C_DARKGREY;
}

export function transportRecColor(recording: boolean): number {
    return recording ? C_RED : C_DARKGREY;
}
```

Replace the body of `paintTransport`:

```ts
function paintTransport(): void {
    cachedSetButtonLED(CC_PLAY, transportPlayColor(seqState.playing));
    cachedSetButtonLED(CC_REC, transportRecColor(seqState.recording));
}
```

(`C_RED = 1` is already defined at the top of the file.)

- [ ] **Step 4: Run to verify it passes**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/seq/leds.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
feat(seq): transport LEDs — Play green when playing, Rec red when recording

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Affordance state functions (pure) — `seq/buttons.ts`

**Files:**
- Create: `src/seq/buttons.ts`
- Modify: `src/seq/colors.ts` (white-LED brightness constants)
- Test: `browser-test/logic.mjs`

**Background:** Pure functions mapping context → LED value for Back, Left/Right, Sample, Capture, Undo, and the always-available white buttons. White LEDs use brightness (`WhiteLedOff/Dim/Bright` = 0/16/124); Sample is RGB so "off" = `C_BLACK` (0). View ids come from `app/state.ts` (`VIEW_CHAIN`, `VIEW_KNOBS`, `VIEW_KEYS`).

- [ ] **Step 1: Add white-LED constants to `seq/colors.ts`**

```ts
/* White-LED brightness levels (Back/arrows/etc. are not RGB). */
export const WHITE_OFF = 0;
export const WHITE_DIM = 16;
export const WHITE_BRIGHT = 124;
```

- [ ] **Step 2: Write the failing test**

```js
import {
    backLedColor, arrowLedColor, sampleLedColor, captureLedColor, undoLedColor,
} from '../dist/esm/seq/buttons.js';
import { VIEW_CHAIN, VIEW_KNOBS } from '../dist/esm/app/state.js';

function testAffordance() {
    _log('\naffordance LEDs:');
    eq('back off in chain view',  backLedColor(VIEW_CHAIN), 0);
    eq('back dim in module view', backLedColor(VIEW_KNOBS), 16);
    eq('left off at bar 0',  arrowLedColor(-1, 0, 3, false), 0);
    eq('left dim mid',       arrowLedColor(-1, 1, 3, false), 16);
    eq('left bright pressed', arrowLedColor(-1, 1, 3, true), 124);
    eq('right off at max',   arrowLedColor(+1, 3, 3, false), 0);
    eq('right dim mid',      arrowLedColor(+1, 1, 3, false), 16);
    eq('sample always off',  sampleLedColor(), 0);
    eq('capture off',        captureLedColor(), 0);
    eq('undo off',           undoLedColor(), 0);
}
```

Invoke `testAffordance();`.

- [ ] **Step 3: Run to verify it fails**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `src/seq/buttons.ts`**

```ts
/* Pure LED-affordance decisions: context → LED value. "Lit only when
 * pressable; full brightness when active." White-LED buttons use brightness;
 * the Sample button is RGB so off = black. */

import { C_BLACK } from './colors.js';
import { WHITE_BRIGHT, WHITE_DIM, WHITE_OFF } from './colors.js';
import { VIEW_CHAIN } from '../app/state.js';

/** Back: off in the chain-param view, dim in module-param views. */
export function backLedColor(view: number): number {
    return view === VIEW_CHAIN ? WHITE_OFF : WHITE_DIM;
}

/** Left (dir -1) / Right (dir +1): off at the travel limit, dim when
 *  navigable, bright while pressed. */
export function arrowLedColor(dir: number, barOffset: number, maxOffset: number, pressed: boolean): number {
    const canGo = dir < 0 ? barOffset > 0 : barOffset < maxOffset;
    if (!canGo) return WHITE_OFF;
    return pressed ? WHITE_BRIGHT : WHITE_DIM;
}

/** Sample button has no movy action → off (RGB black). */
export function sampleLedColor(): number {
    return C_BLACK;
}

/** Capture / Undo have no movy action yet → off (white). */
export function captureLedColor(): number { return WHITE_OFF; }
export function undoLedColor(): number { return WHITE_OFF; }
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm run typecheck && npm run build:browser && node browser-test/logic.mjs`
Expected: PASS, zero TS errors.

- [ ] **Step 6: Commit**

```bash
git add src/seq/buttons.ts src/seq/colors.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
feat(seq): pure LED-affordance helpers (back, arrows, sample, capture, undo)

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Step-icon LEDs (CC 16–31) — latched + Shift affordance

**Files:**
- Modify: `src/seq/leds.ts` (new `paintStepIcons` painter + pure helper)
- Modify: `src/app/state.ts` is already imported in tick; `shiftHeld` lives on `appState`
- Test: `browser-test/logic.mjs`

**Background:** Step icons are CC 16–31 (separate from the step button RGB LEDs at notes 16–31). Latched state always lit: Metronome → step 6 (CC 21), Full-Velocity → step 10 (CC 25). While Shift is held, light all combinable shortcut icons (Metro 21, Full-Vel 25, Double-Loop step 15 = CC 30, Quantize step 16 = CC 31); active ones bright, available-but-inactive dim. Pure helper returns the value for a given step index.

- [ ] **Step 1: Write the failing test**

```js
import { stepIconColor } from '../dist/esm/seq/leds.js';

function testStepIcons() {
    _log('\nstep-icon LEDs:');
    // step indexes are 0-based: step 6 -> idx 5 (metro), step 10 -> idx 9 (full vel)
    const off = { shift: false, metro: false, fullVel: false };
    eq('metro idx dark when off+noshift', stepIconColor(5, off), 0);
    eq('metro idx lit when metro on',     stepIconColor(5, { shift: false, metro: true, fullVel: false }), 124);
    eq('fullvel idx lit when on',         stepIconColor(9, { shift: false, metro: false, fullVel: true }), 124);
    // Shift held: all shortcut icons show (dim if inactive, bright if active).
    eq('shift shows metro dim',  stepIconColor(5, { shift: true, metro: false, fullVel: false }), 16);
    eq('shift shows dbl-loop dim', stepIconColor(14, { shift: true, metro: false, fullVel: false }), 16);
    eq('shift shows quant dim',  stepIconColor(15, { shift: true, metro: false, fullVel: false }), 16);
    eq('non-shortcut idx dark',  stepIconColor(0, { shift: true, metro: false, fullVel: false }), 0);
}
```

Invoke `testStepIcons();`.

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL — `stepIconColor` not exported.

- [ ] **Step 3: Implement in `seq/leds.ts`**

```ts
/* Step-icon LEDs are CC 16..31 (the printed icons under each step), separate
 * from the step buttons' RGB LEDs at notes 16..31. They show latched feature
 * state, and — while Shift is held — the full set of combinable shortcuts. */
const ICON_METRO = 5;     // step 6
const ICON_FULLVEL = 9;   // step 10
const ICON_DBLLOOP = 14;  // step 15
const ICON_QUANT = 15;    // step 16

interface IconCtx { shift: boolean; metro: boolean; fullVel: boolean; }

export function stepIconColor(idx: number, c: IconCtx): number {
    const active = (idx === ICON_METRO && c.metro) || (idx === ICON_FULLVEL && c.fullVel);
    if (active) return WHITE_BRIGHT;
    if (c.shift && (idx === ICON_METRO || idx === ICON_FULLVEL
                    || idx === ICON_DBLLOOP || idx === ICON_QUANT)) {
        return WHITE_DIM;
    }
    return WHITE_OFF;
}
```

Add the painter (called from `seqLedsTick`):

```ts
function paintStepIcons(shift: boolean): void {
    const ctx = { shift, metro: seqState.metro, fullVel: seqState.fullVelocity };
    for (let i = 0; i < NUM_STEP_BUTTONS; i++) {
        cachedSetButtonLED(STEP_ICON_CC_BASE + i, stepIconColor(i, ctx));
    }
}
```

Add constant `const STEP_ICON_CC_BASE = 16;` and import `WHITE_BRIGHT, WHITE_DIM, WHITE_OFF` from `./colors.js`. Call `paintStepIcons(shiftHeld)` from `seqLedsTick` — thread `appState.shiftHeld` in (add a param to `seqLedsTick(shiftHeld: boolean)` and pass it from `app/tick.ts`'s `seqLedsTick()` call).

- [ ] **Step 4: Run to verify it passes**

Run: `npm run typecheck && npm run build:browser && node browser-test/logic.mjs`
Expected: PASS, zero TS errors.

- [ ] **Step 5: Commit**

```bash
git add src/seq/leds.ts src/app/tick.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
feat(seq): step-icon LEDs (CC16-31) show latched + Shift shortcut affordances

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Track-button LEDs (CC 40–43) + affordance painter wiring

**Files:**
- Modify: `src/seq/leds.ts` (track-button painter + affordance painter using `seq/buttons.ts`)
- Modify: `src/app/tick.ts` (pass `currentView`, `barOffset`, press state)
- Test: `browser-test/logic.mjs`

**Background:** Paint track buttons with `TRACK_COLOR[track]`, full-bright pulse when that track has an active note. Then paint the affordance buttons (Back/arrows/sample/capture/undo/loop/copy/delete/mute) via the `seq/buttons.ts` helpers and the always-available dim rule. CC numbers: tracks 40–43 = track 3..0 (CC 43 = track 0). Back 51, Capture 52, Undo 56, Loop 58, Copy 60, Left 62, Right 63, Mute 88, Sample 118.

- [ ] **Step 1: Write the failing test (track-button color helper)**

```js
import { trackButtonColor } from '../dist/esm/seq/leds.js';

function testTrackButton() {
    _log('\ntrack-button LEDs:');
    eq('base = track color', trackButtonColor(1, /*active*/false), trackColor(1));
    eq('active = white pulse', trackButtonColor(1, true), 120);
}
```

Invoke `testTrackButton();`.

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL — `trackButtonColor` not exported.

- [ ] **Step 3: Implement the helper + painters in `seq/leds.ts`**

```ts
/* Track buttons (CC 40..43; CC 43 = track 0). Base = the track color so they
 * match the chromatic root; a sounding note on that track flashes it white.
 * (Mute-dimming arrives with the mute gesture in Batch 2.) */
export function trackButtonColor(track: number, active: boolean): number {
    return active ? C_WHITE : trackColor(track);
}

function trackHasActiveNote(track: number): boolean {
    const base = track * 128;
    for (let p = 0; p < 128; p++) if (seqState.activeNotes[base + p]) return true;
    return false;
}

function paintTrackButtons(): void {
    for (let t = 0; t < 4; t++) {
        const cc = CC_TRACK_END - t; // CC 43 = track 0
        cachedSetButtonLED(cc, trackButtonColor(t, trackHasActiveNote(t)));
    }
}

function paintAffordances(view: number, barOffset: number, maxOffset: number,
                          leftPressed: boolean, rightPressed: boolean): void {
    cachedSetButtonLED(CC_BACK, backLedColor(view));
    cachedSetButtonLED(CC_LEFT, arrowLedColor(-1, barOffset, maxOffset, leftPressed));
    cachedSetButtonLED(CC_RIGHT, arrowLedColor(+1, barOffset, maxOffset, rightPressed));
    cachedSetButtonLED(CC_SAMPLE, sampleLedColor());
    cachedSetButtonLED(CC_CAPTURE, captureLedColor());
    cachedSetButtonLED(CC_UNDO, undoLedColor());
    // Always-available functional buttons: dim (bright-while-active handled by
    // their own modules where applicable; Loop bright in Loop Mode).
    cachedSetButtonLED(CC_LOOP, seqState.loopMode ? WHITE_BRIGHT : WHITE_DIM);
    cachedSetButtonLED(CC_COPY, WHITE_DIM);
    cachedSetButtonLED(CC_DELETE_BTN, WHITE_DIM);
    cachedSetButtonLED(CC_MUTE, WHITE_DIM);
}
```

Add CC constants at the top of `leds.ts` (import names exist in `constants.ts` for some; define the rest locally to match `MoveCCButtons`):

```ts
const CC_BACK = 51, CC_CAPTURE = 52, CC_UNDO = 56, CC_LOOP = 58,
      CC_COPY = 60, CC_LEFT = 62, CC_RIGHT = 63, CC_MUTE = 88,
      CC_SAMPLE = 118, CC_DELETE_BTN = 119;
```

Import the affordance helpers: `import { backLedColor, arrowLedColor, sampleLedColor, captureLedColor, undoLedColor } from './buttons.js';` and `maxBarOffset` from `./state.js`.

Extend `seqLedsTick` to call `paintTrackButtons()` and `paintAffordances(...)`. Thread the needed inputs (view, barOffset, maxOffset, press flags) from `app/tick.ts`. Press flags can start as `false` (the bright-on-press pulse is a nicety; the dim/off correctness is the requirement). Wire real press state in a follow-up if device feedback wants it — keep the signature ready.

- [ ] **Step 4: Wire `app/tick.ts`**

Update the `seqLedsTick(...)` call to pass `appState.shiftHeld`, `appState.currentView`, `seqState.barOffset`, `maxBarOffset()`. (Adjust `seqLedsTick`'s signature to accept these; keep it a single options-free positional call for simplicity.)

- [ ] **Step 5: Run logic + typecheck**

Run: `npm run typecheck && npm run build:browser && node browser-test/logic.mjs`
Expected: PASS, zero TS errors.

- [ ] **Step 6: Commit**

```bash
git add src/seq/leds.ts src/app/tick.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
feat(seq): paint track buttons (track color + active flash) and button affordances

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Full LED ownership — startup init covers every group

**Files:**
- Modify: `src/seq/leds.ts` (`seqLedsInvalidate` clears the button cache too — already does; ensure step-icon/track/affordance CCs are repainted next ticks)
- Modify: `src/app/tick.ts` (progressive init paints all groups, ≤8 LEDs/frame)
- Test: `browser-test/perf.mjs` (no steady-state IPC growth) + device

**Background:** Today progressive init (LED_INIT_BATCH = 8) paints only the 32 pads; steps/track/icons/affordances are painted by `seqLedsTick` on dirty frames. Because every painter is cached, the *first* `seqLedsTick` after `seqLedsInvalidate()` repaints all CC LEDs at once — which can exceed the ~60-packet/frame overtake buffer when combined with a pad init burst. Stagger them: keep pad init batched, and ensure the cached CC painters' first repaint does not coincide with a large pad burst.

- [ ] **Step 1: Confirm `seqLedsInvalidate` clears both caches**

In `seq/leds.ts`, `seqLedsInvalidate()` already does `lastNoteLed.clear(); lastButtonLed.clear();`. Verify; no change needed if so.

- [ ] **Step 2: Bound per-frame CC paints**

In `seqLedsTick`, the CC painters (transport, track buttons, step icons, affordances) together touch ~13 + 16 = ~29 CCs. On a cold frame (post-invalidate) all are cache misses → ~29 packets, plus up to 8 pad-init packets = ~37, under 60. **Verify the budget holds**: add a comment in `seqLedsTick` noting the worst-case packet count, and ensure the pad-init batch (`LED_INIT_BATCH`) stays at 8. No functional change expected; this step is a guard + comment.

```ts
/* Worst case (cold frame after seqLedsInvalidate): ~29 CC packets (transport +
 * 4 track + 16 icons + ~8 affordance) + up to LED_INIT_BATCH (8) pad packets
 * < 60-packet overtake buffer. Do not raise LED_INIT_BATCH past 8 without
 * re-checking this sum. */
```

- [ ] **Step 3: Drive unused/owned LEDs to a known state at init**

The CC painters already set every CC LED movy uses to its correct value on the first cold frame (off where unused: sample/capture/undo). Nothing is left to firmware. Confirm by reasoning: every CC in `MoveCCButtons` that movy cares about is assigned in `paintTransport`/`paintTrackButtons`/`paintStepIcons`/`paintAffordances`. Add any genuinely-unused-but-potentially-stale button (e.g. Menu 50, Up 55, Down 54, Shift 49) explicitly to off in `paintAffordances` if device testing shows stale lighting.

- [ ] **Step 4: Run perf + screenshot + logic locally**

```bash
npm run build:browser
node browser-test/logic.mjs        # 0 failures
node browser-test/screenshot.mjs   # 0 failures (no on-screen change expected)
node browser-test/perf.mjs         # IPC/LED budget within limits
```
Expected: all 0 failures; perf shows no steady-state IPC growth (cached LEDs).

- [ ] **Step 5: Commit**

```bash
git add src/app/tick.ts src/seq/leds.ts
git commit -m "$(cat <<'EOF'
feat(seq): movy owns every Move LED — full known-state init within buffer budget

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Engine build + device verification

**Files:** none (verification)

- [ ] **Step 1: Build the engine**

Run: `cd engine && cargo test && cd .. && ./scripts/build-dsp.sh`
Expected: tests pass; `dist/dsp.so` builds (version check passes — both ENGINE_VERSION = 0.10.0).

- [ ] **Step 2: Full local test suite**

```bash
npm run typecheck
npm run build:browser
node browser-test/logic.mjs        # 0 failures
node browser-test/screenshot.mjs   # 0 failures
node browser-test/perf.mjs         # within budget
```

- [ ] **Step 3: Device tests (if reachable)**

```bash
ssh -o ConnectTimeout=3 ableton@move.local echo ok 2>/dev/null \
  && (cd movy && ./scripts/test.sh && ./scripts/test-seq.sh) \
  || echo "DEVICE OFFLINE — SKIPPING DEVICE TESTS"
```
If offline, report **DEVICE OFFLINE** to the user in CAPS.

On device, eyeball: drum pads show track color (white selected, green when the sequence triggers them), chromatic root matches the track button color, Play green / Rec red, arrows dark at bar limits, Sample/Capture/Undo dark, Metro/Full-Vel step icons lit when latched, no stale LEDs on entry.

- [ ] **Step 4: Final commit (if any fixups)**

```bash
git add -p
git commit -m "$(cat <<'EOF'
test(seq): batch-1 LED affordance device verification fixups

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
git push
```

---

## Self-review notes

- **Spec coverage:** track-color SoT (Tasks 5,6,10) · engine active notes (1,3) · drum pads (5) · chromatic pads (6) · transport (7) · track buttons (10) · static affordances (8,10) · step-icon LEDs (9) · full LED ownership/init (11). All spec components map to a task.
- **Deferred (not in this plan, by design):** mute-dim + gesture, view-switching, session recolor, exit-restore (Batch 2); playhead + step-length (Batch 3); count-in + visual metronome (Batch 4).
- **Type consistency:** `activeFromStr`/`activeHasNote` (Task 3) reused in 5/6/10; `setHeldSet`/`noteHeld`/`clearHeldSet` (Task 4) reused in 6; `trackColor`/`C_WHITE`/`C_GREEN`/`C_DARKGREY`/`WHITE_*` constants consistent across 5–10; `drumPadLedColor` and `chromaticPadColor` new signatures applied at all call sites (5,6).
- **Open device-tuning items (flagged inline, not blockers):** held-drum-pad green, arrow bright-on-press wiring, explicit-off for Menu/Shift/Up/Down if stale. None affect the unit-tested contracts.
```
