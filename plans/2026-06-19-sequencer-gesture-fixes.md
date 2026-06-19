# Sequencer Gesture & UX Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix six sequencer interaction issues: mute focus leak, unified Copy-held duplicate gesture (clip/step/bar, replace), Clear+clip delete, no autostart on note entry, flat toast duration, and Clear+automation-knob not deleting the clip.

**Architecture:** Targeted fixes plus a small shared-state cleanup — mute gating at the first-look router, a shared "Clear acted" flag, and a new `src/seq/duplicate.ts` that owns the Copy gesture across views. No gesture-arbiter rewrite.

**Tech Stack:** Rust (`seq-core`, `cargo test`); TypeScript UI (`src/seq`, `src/midi`), tested with `browser-test/*.mjs`.

**Spec:** `docs/superpowers/specs/2026-06-19-sequencer-gesture-fixes-design.md`

**Env note:** `cargo` is not on PATH; prefix engine commands with
`PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH"`.

---

## File Structure

- `engine/crates/seq-core/src/command.rs` — drop `maybe_autostart` from `tog`/`ltog`/`addp`.
- `engine/crates/seq-core/src/engine.rs` — `clipboard_span` field; `copy_steps` records it; `paste_steps` clears the destination span (replace). Possibly remove `maybe_autostart`.
- `engine/crates/movy-dsp/src/lib.rs` + `src/seq/constants.ts` — bump `ENGINE_VERSION`.
- `src/seq/router.ts` — mute gating; route Copy/clip/step/bar to `duplicate`; drop optimistic `playing=true`.
- `src/seq/duplicate.ts` — **new** unified duplicate gesture.
- `src/seq/edit-ops.ts` — export `markDeleteActed()`; remove old step copy/paste.
- `src/seq/session.ts` — remove old session copy/paste; route clip duplicate; keep Clear+clip delete.
- `src/midi/router.ts` — `markDeleteActed()` after `clearLaneForKnob`.
- `src/seq/render.ts` — flat `TOAST_TTL`.
- `browser-test/logic.mjs` — gesture tests.

---

## Task 1: Engine — note entry never auto-starts the transport (issue 4)

**Files:**
- Modify: `engine/crates/seq-core/src/command.rs` (`tog` ~69, `addp` ~222, `ltog` ~253)
- Modify: `engine/crates/seq-core/src/engine.rs` (`maybe_autostart` ~410-417)
- Test: `engine/crates/seq-core/src/command.rs` (replace `tog_autostarts_transport`)

- [ ] **Step 1: Update the failing test**

In `command.rs` find `fn tog_autostarts_transport()` and replace it with:

```rust
    #[test]
    fn tog_does_not_autostart_transport() {
        let mut e = Engine::new(RATE, 12000);
        let mut out = Vec::new();
        apply_batch(&mut e, "tog 0 0 60 100", &mut out);
        assert!(!e.playing, "entering a step while stopped must not start playback");
        assert!(e.tracks[0].active().exists(), "the clip is still created");
    }
```

(If the test module lacks `RATE`, reuse the constant already used by neighboring tests in that file.)

- [ ] **Step 2: Run it to verify it fails**

Run: `cd engine && PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" cargo test -p seq-core tog_does_not_autostart`
Expected: FAIL — `e.playing` is true (current code auto-starts).

- [ ] **Step 3: Remove the three autostart call sites**

In `command.rs`, delete the `engine.maybe_autostart(...)` line in each of `tog`, `addp`, and `ltog`. For `tog`:

```rust
                if (t as usize) < NUM_TRACKS {
                    engine.tracks[t as usize]
                        .active_mut()
                        .toggle_step(s.clamp(0, 255) as u16, &chord);
                }
```

For `ltog`:

```rust
                if (t as usize) < NUM_TRACKS && (0..128).contains(&p) {
                    engine.tracks[t as usize].active_mut().toggle_step_pitch(
                        s.clamp(0, 255) as u16,
                        p as u8,
                        v.clamp(1, 127) as u8,
                    );
                }
```

For `addp` (drop the `engine.maybe_autostart(added > 0);` line; keep the `add_pitch_range` call).

Then in `engine.rs` delete the now-unused `maybe_autostart` method (the `pub fn maybe_autostart` block ~410-417).

- [ ] **Step 4: Run the test (and the suite) to verify green**

Run: `cd engine && PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" cargo test -p seq-core`
Expected: PASS, no unused-function warning for `maybe_autostart`.

- [ ] **Step 5: Commit**

```bash
git add engine/crates/seq-core/src/command.rs engine/crates/seq-core/src/engine.rs
git commit -m "$(cat <<'EOF'
feat(engine): note entry no longer auto-starts the transport

Entering a step/note while stopped creates the clip but leaves playback
stopped. Removes maybe_autostart from tog/ltog/addp.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Engine — paste_steps replaces the destination span (issue 2)

**Files:**
- Modify: `engine/crates/seq-core/src/engine.rs` — `clipboard_span` field (~49/91), `copy_steps` (~177), `paste_steps` (~204)
- Test: `engine/crates/seq-core/src/engine.rs` tests

- [ ] **Step 1: Write the failing tests**

Add to the engine `mod tests`:

```rust
    #[test]
    fn paste_steps_replaces_destination() {
        let mut e = engine();
        // Source: note at step 0. Destination step 4 already has a note.
        e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
        e.tracks[0].active_mut().toggle_step(4, &[(62, 100)]);
        e.copy_steps(0, 0, 0);          // copy one step
        e.paste_steps(0, 4);            // paste-replace at step 4
        // Step 4 now holds ONLY the source's pitch (62 replaced by 60), not both.
        let at4: Vec<u8> = e.tracks[0].active().notes.iter()
            .filter(|n| n.step == 4).map(|n| n.pitch).collect();
        assert_eq!(at4, vec![60], "destination replaced, not merged");
    }

    #[test]
    fn paste_steps_empty_source_clears_destination() {
        let mut e = engine();
        e.tracks[0].active_mut().toggle_step(2, &[(62, 100)]); // dest has a note
        e.copy_steps(0, 0, 0);          // step 0 is empty → empty clipboard
        e.paste_steps(0, 2);            // replace step 2 with empty
        assert!(!e.tracks[0].active().step_has_notes(2), "empty source clears the dest step");
    }
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd engine && PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" cargo test -p seq-core paste_steps_`
Expected: FAIL — current `paste_steps` merges (step 4 has both pitches) and early-returns on an empty clipboard (step 2 keeps its note).

- [ ] **Step 3: Add `clipboard_span`, record it on copy, clear-then-paste on paste**

In `engine.rs` struct (after the `lock_clipboard` field, ~48):

```rust
    lock_clipboard: Vec<Lock>,
    /// Width in steps of the last `copy_steps` source range (so paste replaces
    /// the destination span even when the source had no notes).
    clipboard_span: u16,
```

In `Engine::new()` (after `lock_clipboard: Vec::new(),` ~90):

```rust
            lock_clipboard: Vec::new(),
            clipboard_span: 0,
```

In `copy_steps`, set the span (add right before the `self.clipboard = ...` assignment, ~181):

```rust
        self.clipboard_span = s1 - s0 + 1;
```

Replace `paste_steps` (~204-225) with a version that clears first and no longer early-returns on an empty clipboard:

```rust
    pub fn paste_steps(&mut self, track: usize, dest_step: u16) {
        if track >= NUM_TRACKS || self.clipboard_span == 0 {
            return;
        }
        let span = self.clipboard_span;
        // Replace, not merge: clear the destination span (notes + locks) first.
        {
            let clip = self.tracks[track].active_mut();
            clip.delete_range(dest_step, dest_step + span - 1, None);
            for s in dest_step..dest_step + span {
                clip.clear_step_locks(s);
            }
        }
        let base_tick = dest_step as u32 * TICKS_PER_STEP;
        let cb = self.clipboard.clone();
        let clip = self.tracks[track].active_mut();
        for cn in cb {
            clip.add_note_raw(
                dest_step + cn.rel_step,
                base_tick + cn.rel_tick,
                cn.gate,
                cn.pitch,
                cn.vel,
            );
        }
        let lb = self.lock_clipboard.clone();
        let clip = self.tracks[track].active_mut();
        for l in lb {
            clip.set_lock(l.lane, dest_step + l.step, l.val);
        }
    }
```

- [ ] **Step 4: Run to verify green (and the existing copy/paste tests still pass)**

Run: `cd engine && PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" cargo test -p seq-core`
Expected: PASS, including the pre-existing `copy_paste_carries_locks_even_without_notes` (it pastes at an empty destination, so replace is equivalent).

- [ ] **Step 5: Commit**

```bash
git add engine/crates/seq-core/src/engine.rs
git commit -m "$(cat <<'EOF'
feat(engine): paste_steps replaces the destination span

Records the source span width so a step/bar paste clears the destination
(notes + locks) before pasting, replacing rather than merging — even when
the source was empty.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Bump ENGINE_VERSION

**Files:**
- Modify: `engine/crates/movy-dsp/src/lib.rs:18`
- Modify: `src/seq/constants.ts:22`

- [ ] **Step 1: Bump both constants to `0.17.0`**

`engine/crates/movy-dsp/src/lib.rs`:

```rust
const ENGINE_VERSION: &str = "0.17.0";
```

`src/seq/constants.ts`:

```typescript
export const ENGINE_VERSION = '0.17.0';
```

- [ ] **Step 2: Verify they match**

Run: `grep -h "0.17.0" engine/crates/movy-dsp/src/lib.rs src/seq/constants.ts`
Expected: two matching lines.

- [ ] **Step 3: Commit**

```bash
git add engine/crates/movy-dsp/src/lib.rs src/seq/constants.ts
git commit -m "$(cat <<'EOF'
chore: bump ENGINE_VERSION to 0.17.0

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: UI — mute held suppresses the focus retarget (issue 1)

**Files:**
- Modify: `src/seq/router.ts` — track-button observer (~231-239)
- Test: `browser-test/logic.mjs` — seq router block

- [ ] **Step 1: Write the failing test**

In `browser-test/logic.mjs`, inside the "seq router" block (which imports `seqHandleMidi`, `seqState`, `setMuteHeld`), add — first extend the import to include `setMuteHeld`:

```javascript
    const { seqHandleMidi, seqNotePadPlayed, seqNotePadReleased, seqSetLane, setMuteHeld } =
        await import('../dist/esm/seq/router.js');
```

Then append a case:

```javascript
    // Mute held: a track-button press must NOT retarget the watched track.
    resetSeqState(); engine.reset(); resetSeqEngine(); seqEngineTick();
    seqState.watchTrack = 0;
    setMuteHeld(true);
    seqHandleMidi([0xB0, 42, 127], false);   // track button for track 1 (CC 43 = track 0)
    eq('mute+track keeps watchTrack', seqState.watchTrack, 0);
    eq('mute+track emits no watch cmd', engine.ops.some((o) => o.startsWith('watch ')), false);
    setMuteHeld(false);
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /Users/dake/git/cld/movy && npm run build:browser >/dev/null 2>&1 && node browser-test/logic.mjs 2>&1 | grep -i "mute+track"`
Expected: FAIL — `watchTrack` became 1 and a `watch 1` was emitted.

- [ ] **Step 3: Gate the retarget on `!muteHeld()`**

In `src/seq/router.ts`, the track-button branch (~231-239) becomes:

```typescript
    /* Track buttons: observe only — retarget the watched clip and let the
     * existing param-page track switching run unchanged. While Mute is held a
     * track press is purely a mute (handled in midi/router.ts), so do not
     * retarget the step-view focus. */
    if (d1 >= CC_TRACK_START && d1 <= CC_TRACK_END && d2 > 0) {
        const track = CC_TRACK_END - d1;
        if (!muteHeld() && track !== seqState.watchTrack) {
            seqState.watchTrack = track;
            seqState.barOffset = 0;
            seqCmd('watch ' + track);
        }
        return false;
    }
```

(`muteHeld` is already defined in this file.)

- [ ] **Step 4: Run to verify green**

Run: `cd /Users/dake/git/cld/movy && npm run build:browser >/dev/null 2>&1 && node browser-test/logic.mjs 2>&1 | tail -1`
Expected: `ALL LOGIC CHECKS PASSED`.

- [ ] **Step 5: Commit**

```bash
git add src/seq/router.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
fix(seq): mute-held track press does not switch the step-view focus

The first-look router retargeted watchTrack before the param layer recognized
the mute gesture, leaking focus + colors to the muted track. Skip the retarget
while Mute is held.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: UI — Clear+automation-knob marks the gesture acted (issue 6)

**Files:**
- Modify: `src/seq/edit-ops.ts` — add `markDeleteActed()`
- Modify: `src/midi/router.ts:58` — call it after `clearLaneForKnob`
- Test: `browser-test/logic.mjs`

- [ ] **Step 1: Write the failing test**

In `browser-test/logic.mjs`, in a block that imports `deleteButton`, `markDeleteActed` from edit-ops and `seqState`/engine ops (the edit-ops/automation block near the existing Delete tests), add:

```javascript
    // Clear held + automation-knob clear (markDeleteActed) → Clear release must
    // NOT delete the clip.
    {
        const { deleteButton, markDeleteActed, resetEditOps } =
            await import('../dist/esm/seq/edit-ops.js');
        resetEditOps(); resetSeqEngine();
        deleteButton(true);            // hold Clear
        markDeleteActed();             // automation-knob clear acted
        deleteButton(false);           // release Clear
        eq('clear+automation-knob does not delete clip',
            peekSeqCmdQueue().some((o) => o.startsWith('clipdel')), false);
    }
```

(Use the same `peekSeqCmdQueue`/`resetSeqEngine` imports the surrounding block already uses.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd /Users/dake/git/cld/movy && npm run build:browser >/dev/null 2>&1 && node browser-test/logic.mjs 2>&1 | grep -i "clear+automation-knob"`
Expected: FAIL — `markDeleteActed` is not exported (import error / undefined), or `clipdel` was queued.

- [ ] **Step 3: Export `markDeleteActed` and call it from the knob-clear path**

In `src/seq/edit-ops.ts`, add after `deleteActive()` (~34):

```typescript
/* Mark the in-progress Clear gesture as having acted, so its release does not
 * fall through to deleting the active clip. Used by the automation-knob clear
 * (and any other Clear-modified action). */
export function markDeleteActed(): void {
    delActed = true;
}
```

In `src/midi/router.ts:58`, change:

```typescript
            if (deleteActive() && info) { clearLaneForKnob(appState.activeSlot, info); return; }
```

to:

```typescript
            if (deleteActive() && info) {
                clearLaneForKnob(appState.activeSlot, info);
                markDeleteActed();   // Clear release must not also delete the clip
                return;
            }
```

and add `markDeleteActed` to the existing edit-ops import in `src/midi/router.ts` (line 13: `import { deleteActive } from '../seq/edit-ops.js';` → `import { deleteActive, markDeleteActed } from '../seq/edit-ops.js';`).

- [ ] **Step 4: Run to verify green + typecheck**

Run: `cd /Users/dake/git/cld/movy && npm run typecheck && npm run build:browser >/dev/null 2>&1 && node browser-test/logic.mjs 2>&1 | tail -1`
Expected: typecheck clean; `ALL LOGIC CHECKS PASSED`.

- [ ] **Step 5: Commit**

```bash
git add src/seq/edit-ops.ts src/midi/router.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
fix(seq): clearing automation via Clear+knob no longer deletes the clip

The knob-clear path now marks the Clear gesture acted, so Clear release stops
falling through to clipdel.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: UI — flat toast duration (issue 5)

**Files:**
- Modify: `src/seq/render.ts` — `seqToast` / TTL
- Test: `browser-test/logic.mjs`

- [ ] **Step 1: Write the failing test**

In `browser-test/logic.mjs`, in a block importing from `render.js`:

```javascript
    {
        const { seqToast, seqToastActive, seqToastTick, resetSeqToast } =
            await import('../dist/esm/seq/render.js');
        resetSeqToast();
        seqToast('hi', 10);            // request a short ttl
        let ticks = 0;
        while (seqToastActive()) { seqToastTick(); ticks++; if (ticks > 1000) break; }
        eq('toast shows ~1.5s (>=250 ticks) regardless of requested ttl', ticks >= 250, true);
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /Users/dake/git/cld/movy && npm run build:browser >/dev/null 2>&1 && node browser-test/logic.mjs 2>&1 | grep -i "toast shows"`
Expected: FAIL — toast lasted only 10 ticks.

- [ ] **Step 3: Make `seqToast` use a flat TTL**

In `src/seq/render.ts`, add a constant and change `seqToast` to ignore the per-call ttl:

```typescript
/* Flat toast duration: ~1.5s at the device's ~196 ticks/s. Toasts were too
 * brief to read; every toast now shows for this fixed time. */
const TOAST_TTL = 294;

export function seqToast(msg: string): void {
    text = msg;
    ttl = TOAST_TTL;
}
```

(Remove the `ttlTicks` parameter. The header announcement `seqHeaderAnnounce` and its `DEFAULT_TTL` are unchanged.)

- [ ] **Step 4: Run to verify green + typecheck**

Run: `cd /Users/dake/git/cld/movy && npm run typecheck && npm run build:browser >/dev/null 2>&1 && node browser-test/logic.mjs 2>&1 | tail -1`
Expected: typecheck clean (no caller passes a 2nd arg that breaks — `seqToast` is called with one arg everywhere); `ALL LOGIC CHECKS PASSED`.

- [ ] **Step 5: Commit**

```bash
git add src/seq/render.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
fix(seq): toasts show a flat ~1.5s

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: UI — unified duplicate gesture module (issue 2)

**Files:**
- Create: `src/seq/duplicate.ts`
- Test: `browser-test/logic.mjs`

- [ ] **Step 1: Write the failing tests**

In `browser-test/logic.mjs` add a new block:

```javascript
/* ── duplicate gesture (Copy held → source → dest, replace) ──────────────── */
_log('\nduplicate gesture:');
{
    const { copyButton, onUnit, dupActive, resetDuplicate } =
        await import('../dist/esm/seq/duplicate.js');
    const { resetSeqEngine, peekSeqCmdQueue } = await import('../dist/esm/seq/engine.js');

    // Clip: copy source slot, paste-replace at dest (cross-track), source stays armed.
    resetDuplicate(); resetSeqEngine();
    copyButton(true);
    eq('dup active while held', dupActive(), true);
    onUnit({ kind: 'clip', track: 0, slot: 0 });
    onUnit({ kind: 'clip', track: 1, slot: 3 });
    onUnit({ kind: 'clip', track: 2, slot: 5 }); // second dest — source still armed
    const q = peekSeqCmdQueue();
    eq('clip copy emitted', q.includes('clipcopy 0 0'), true);
    eq('clip paste 1', q.includes('clippaste 1 3'), true);
    eq('clip paste 2 (armed)', q.includes('clippaste 2 5'), true);
    copyButton(false);
    eq('dup inactive after release', dupActive(), false);

    // Step: cpy single step, pst at dest.
    resetDuplicate(); resetSeqEngine();
    copyButton(true);
    onUnit({ kind: 'step', track: 0, step: 2 });
    onUnit({ kind: 'step', track: 0, step: 9 });
    const qs = peekSeqCmdQueue();
    eq('step copy', qs.includes('cpy 0 2 2'), true);
    eq('step paste', qs.includes('pst 0 9'), true);
    copyButton(false);

    // Bar: cpy the 16-step bar range, pst at dest bar start.
    resetDuplicate(); resetSeqEngine();
    copyButton(true);
    onUnit({ kind: 'bar', track: 0, bar: 0 });
    onUnit({ kind: 'bar', track: 0, bar: 2 });
    const qb = peekSeqCmdQueue();
    eq('bar copy', qb.includes('cpy 0 0 15'), true);
    eq('bar paste', qb.includes('pst 0 32'), true);
    copyButton(false);

    // No source captured yet → a press is the source, not a paste.
    resetDuplicate(); resetSeqEngine();
    copyButton(true);
    onUnit({ kind: 'clip', track: 0, slot: 1 });
    eq('first press is copy not paste',
        peekSeqCmdQueue().some((o) => o.startsWith('clippaste')), false);
    copyButton(false);

    // onUnit ignored when not held.
    resetDuplicate(); resetSeqEngine();
    onUnit({ kind: 'clip', track: 0, slot: 0 });
    eq('onUnit no-op when not held', peekSeqCmdQueue().length, 0);
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /Users/dake/git/cld/movy && npm run build:browser >/dev/null 2>&1 && node browser-test/logic.mjs 2>&1 | grep -i "duplicate\|Cannot find"`
Expected: FAIL — `../dist/esm/seq/duplicate.js` does not exist.

- [ ] **Step 3: Create `src/seq/duplicate.ts`**

```typescript
/* Unified duplicate gesture (Copy button, CC 60): hold → press source → press
 * destination, REPLACING the destination. One gesture across views — the unit
 * is a clip (Session), a step (Note view) or a bar (Loop view). The source
 * stays armed while Copy is held, so it can be stamped to several destinations.
 * The engine owns the clipboard; this module only emits commands + toasts. */

import { seqCmd } from './engine.js';
import { seqToast } from './render.js';

export type DupUnit =
    | { kind: 'clip'; track: number; slot: number }
    | { kind: 'step'; track: number; step: number }
    | { kind: 'bar'; track: number; bar: number };

let held = false;
let source: DupUnit | null = null;

export function dupActive(): boolean {
    return held;
}

/* Copy button down/up. Down begins a fresh gesture; up ends it. */
export function copyButton(down: boolean): void {
    held = down;
    source = null;
}

/* A unit (clip/step/bar) pressed while the Copy button is held. The first press
 * captures the source; later presses paste-replace at the destination, keeping
 * the source armed for more destinations. */
export function onUnit(u: DupUnit): void {
    if (!held) return;
    if (source === null) {
        source = u;
        copySource(u);
        seqToast('Copied');
    } else {
        pasteTo(u);
        seqToast('Pasted');
    }
}

function copySource(u: DupUnit): void {
    if (u.kind === 'clip') seqCmd(`clipcopy ${u.track} ${u.slot}`);
    else if (u.kind === 'step') seqCmd(`cpy ${u.track} ${u.step} ${u.step}`);
    else seqCmd(`cpy ${u.track} ${u.bar * 16} ${u.bar * 16 + 15}`);
}

function pasteTo(dest: DupUnit): void {
    if (dest.kind === 'clip') seqCmd(`clippaste ${dest.track} ${dest.slot}`);
    else if (dest.kind === 'step') seqCmd(`pst ${dest.track} ${dest.step}`);
    else seqCmd(`pst ${dest.track} ${dest.bar * 16}`);
}

export function resetDuplicate(): void {
    held = false;
    source = null;
}
```

- [ ] **Step 4: Run to verify green + typecheck**

Run: `cd /Users/dake/git/cld/movy && npm run typecheck && npm run build:browser >/dev/null 2>&1 && node browser-test/logic.mjs 2>&1 | tail -1`
Expected: typecheck clean; `ALL LOGIC CHECKS PASSED`.

- [ ] **Step 5: Commit**

```bash
git add src/seq/duplicate.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
feat(seq): unified duplicate gesture module (clip/step/bar)

Copy held → source → destination, replacing the destination; source stays
armed for multiple destinations.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: UI — wire duplicate into routing; remove old copy paths (issues 2, 3)

**Files:**
- Modify: `src/seq/router.ts` — Copy routing, step-button branch, drop optimistic `playing=true`
- Modify: `src/seq/session.ts` — clip duplicate routing; remove old session copy/paste
- Modify: `src/seq/edit-ops.ts` — remove `copyButton`/`copyMarkStep`/`pasteAtStep`/`copyActive`/`pasteArmed`
- Test: `browser-test/logic.mjs`

- [ ] **Step 1: Write the failing integration tests**

In `browser-test/logic.mjs` "seq router" block, add:

```javascript
    // Copy held + two step presses (note view) → cpy then pst, no note toggled.
    resetSeqState(); engine.reset(); resetSeqEngine(); seqEngineTick();
    {
        const { copyButton } = await import('../dist/esm/seq/duplicate.js');
        copyButton(true);
        seqHandleMidi([0x90, 16 + 2, 127], false); // source step 2
        seqHandleMidi([0x90, 16 + 9, 127], false); // dest step 9
        copyButton(false);
        eq('dup step copy via router', engine.ops.includes('cpy 0 2 2'), true);
        eq('dup step paste via router', engine.ops.includes('pst 0 9'), true);
        eq('dup step did not toggle a note', engine.ops.some((o) => o.startsWith('tog ')), false);
    }

    // Session: Copy held + two clip pads → clipcopy then clippaste, no launch.
    resetSeqState(); engine.reset(); resetSeqEngine(); seqEngineTick();
    seqState.sessionMode = true;
    {
        const { copyButton } = await import('../dist/esm/seq/duplicate.js');
        copyButton(true);
        seqHandleMidi([0x90, 68, 127], false);  // pad 68 = track 3 slot 0 (bottom-left)
        seqHandleMidi([0x90, 68 + 1, 127], false); // dest pad
        copyButton(false);
        eq('dup clip copy via router', engine.ops.some((o) => o.startsWith('clipcopy')), true);
        eq('dup clip paste via router', engine.ops.some((o) => o.startsWith('clippaste')), true);
        eq('dup clip did not launch', engine.ops.some((o) => o.startsWith('launch')), false);
    }
    seqState.sessionMode = false;

    // Session: Clear held + clip pad → clipdelat + toast; multiple while held.
    resetSeqState(); engine.reset(); resetSeqEngine(); resetSeqToast(); seqEngineTick();
    seqState.sessionMode = true;
    seqHandleMidi([0xB0, 119, 127], false);   // hold Clear
    seqHandleMidi([0x90, 68, 127], false);     // clip A
    seqHandleMidi([0x90, 68 + 1, 127], false); // clip B (still held)
    eq('clear+clip deletes A', engine.ops.includes('clipdelat 3 0'), true);
    eq('clear+clip deletes B', engine.ops.includes('clipdelat 3 1'), true);
    seqHandleMidi([0xB0, 119, 0], false);
    seqState.sessionMode = false;

    // Step entry while stopped does not start the transport (UI mirror).
    resetSeqState(); engine.reset(); resetSeqEngine(); seqEngineTick();
    seqState.playing = false;
    seqHandleMidi([0x90, 16 + 0, 127], false);
    seqHandleMidi([0x80, 16 + 0, 0], false);
    eq('step entry keeps playing false', seqState.playing, false);
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd /Users/dake/git/cld/movy && npm run build:browser >/dev/null 2>&1 && node browser-test/logic.mjs 2>&1 | grep -iE "dup .*via router|clear\+clip|keeps playing"`
Expected: FAIL — Copy still routes to the old two-step path; step entry sets `playing=true`.

- [ ] **Step 3: Route Copy/steps to duplicate; drop optimistic playing; remove old copy**

In `src/seq/router.ts`:

Update imports — remove `copyActive, copyButton, copyMarkStep, pasteArmed, pasteAtStep` from the edit-ops import, keep `deleteActive, deleteButton, deletePad, deleteStep`:

```typescript
import {
    deleteActive, deleteButton, deletePad, deleteStep,
} from './edit-ops.js';
```

Add a duplicate import near the others:

```typescript
import { copyButton as dupCopyButton, dupActive, onUnit as dupOnUnit } from './duplicate.js';
```

In the step-button branch, replace the `copyActive()` / `pasteArmed()` cases with a single duplicate case. The `on` cascade (~99-107) becomes:

```typescript
        if (on && dupActive()) {
            const absB = seqState.barOffset * NUM_STEP_BUTTONS + button;
            dupOnUnit(seqState.loopMode
                ? { kind: 'bar', track: seqState.watchTrack, bar: button }
                : { kind: 'step', track: seqState.watchTrack, step: absB });
        } else if (on && deleteActive()) {
            deleteStep(button);
        } else if (on && shiftHeld) {
            shiftStepFunction(button);
        } else if (on) {
```

In the Copy button handler (~174-178), route to duplicate for all views:

```typescript
    if (d1 === CC_COPY) {
        dupCopyButton(d2 > 0);
        return true;
    }
```

In `toggleStep` (~290-296), remove the optimistic auto-start line:

```typescript
    if (!wasSet) {
        if (seqState.lenSteps === 0) seqState.lenSteps = NUM_STEP_BUTTONS;
        if (step >= seqState.lenSteps) {
            seqState.lenSteps = (Math.floor(step / NUM_STEP_BUTTONS) + 1) * NUM_STEP_BUTTONS;
        }
    }
    occToggleStep(step);
```

In `src/seq/session.ts`:

Add a duplicate import:

```typescript
import { dupActive, onUnit as dupOnUnit } from './duplicate.js';
```

In `sessionPad`, route to duplicate before launch (keep the `deleteHeld` branch, remove the `copyHeld`/`pasteArmed` branches):

```typescript
export function sessionPad(padNote: number, padMin: number): void {
    const cell = padToCell(padNote, padMin);
    if (!cell) return;
    const { track, slot } = cell;

    if (deleteHeld) {
        seqCmd(`clipdelat ${track} ${slot}`);
        seqToast('Clip deleted');
        return;
    }
    if (dupActive()) {
        dupOnUnit({ kind: 'clip', track, slot });
        return;
    }
    // Launch the clip (or select-empty-stops). Also retarget the watched track.
    seqState.watchTrack = track;
    seqCmd(`launch ${track} ${slot}`);
}
```

Remove the now-dead `sessionCopyButton`, `copyHeld`, `copySrc`, `pasteArmed` and their reset lines in `resetSession` (keep `deleteHeld`). Remove `sessionCopyButton` from the router import (`src/seq/router.ts` imports `sessionCopyButton` — drop it; the Copy button no longer calls it). The router's `if (d1 === CC_COPY)` no longer references session.

In `src/seq/edit-ops.ts`: delete `copyButton`, `copyMarkStep`, `pasteAtStep`, `copyActive`, `pasteArmed`, and the `copyHeld`/`copySource`/`pasteArmedFlag` module vars and their lines in `resetEditOps`. Keep all Delete functions and `markDeleteActed`. Remove the now-unused `clearStepAllAutomation` import only if nothing else uses it (it is still used by `deleteStep`/`deleteButton` — keep it).

- [ ] **Step 4: Typecheck (catches every dangling reference), then run logic**

Run: `cd /Users/dake/git/cld/movy && npm run typecheck 2>&1 | tail -5`
Expected: clean. Fix any remaining import of a removed symbol (`copyActive`, `copyButton`, `copyMarkStep`, `pasteArmed`, `pasteAtStep`, `sessionCopyButton`) the compiler flags.

Run: `npm run build:browser >/dev/null 2>&1 && node browser-test/logic.mjs 2>&1 | tail -1`
Expected: `ALL LOGIC CHECKS PASSED`.

- [ ] **Step 5: Commit**

```bash
git add src/seq/router.ts src/seq/session.ts src/seq/edit-ops.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
feat(seq): route Copy to the duplicate gesture; remove two-step copy

Copy held now drives the clip/step/bar duplicate gesture across views; drops
the old edit-ops/session copy+paste. Step entry no longer optimistically marks
the transport playing.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Full verification (local + device)

**Files:** none (verification only)

- [ ] **Step 1: Full Rust suite**

Run: `cd /Users/dake/git/cld/movy/engine && PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" cargo test`
Expected: all crates pass.

- [ ] **Step 2: Full local JS suite**

Run:
```bash
cd /Users/dake/git/cld/movy
npm run build:browser
node browser-test/logic.mjs
node browser-test/app-loop.mjs
node browser-test/screenshot.mjs
node browser-test/perf.mjs
```
Expected: each `0 failures`. If `screenshot.mjs` reports a toast-frame diff caused by the longer toast, regenerate baselines: `node browser-test/screenshot.mjs --update`, eyeball the diff, and include the updated baselines in the final commit.

- [ ] **Step 3: Device e2e (if `move.local` reachable)**

Run:
```bash
cd /Users/dake/git/cld/movy
ssh -o ConnectTimeout=3 ableton@move.local echo ok 2>/dev/null \
  && PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" ./scripts/test-seq.sh \
  || echo "DEVICE OFFLINE — SKIPPING DEVICE TESTS"
```
Expected: PASS (deploys engine 0.17.0). Manually confirm on device: mute+track does not switch the step view; Copy-held clip→clip duplicates+replaces (also step and bar); hold Clear + clips deletes multiple with a toast; entering steps while stopped does not start playback; Clear+automation-knob clears the lane without deleting the clip; toasts linger ~1.5s. **If the device is offline, report DEVICE OFFLINE to the user in CAPS.**

- [ ] **Step 4: Commit any baseline updates**

```bash
git add browser-test/baselines    # only if screenshot baselines changed
git commit -m "$(cat <<'EOF'
test: refresh screenshot baselines for longer toast

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review notes

- **Spec coverage:** issue 1 → Task 4; issue 2 → Tasks 2 (engine replace), 7 (gesture), 8 (routing); issue 3 → Task 8 (Clear+clip test; reverse gesture intentionally omitted per spec); issue 4 → Task 1 + Task 8 (UI mirror); issue 5 → Task 6; issue 6 → Task 5; version bump → Task 3.
- **No reverse gesture / issue 7:** intentionally absent (deferred per spec §7).
- **Type consistency:** `DupUnit` kinds (`clip`/`step`/`bar`), `dupActive`/`onUnit`/`copyButton`/`resetDuplicate`, and `markDeleteActed` are used identically across Tasks 5, 7, 8.
- **Placeholder scan:** every code step shows complete code.
