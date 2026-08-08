# Non-destructive quantization — design

Date: 2026-08-08

## Problem

Quantization in movy is destructive. `Shift + Step 16` calls `Clip::quantize()`
(clip.rs:389), which rewrites every note's `tick` to its step anchor. The
recorded feel is gone; only undo brings it back, and only until the undo stack
is cleared. There is no strength control, no per-clip setting, and nothing
applies to a new recording automatically.

## Goal

Quantization becomes a **value**, not an action:

- Every clip carries a quantization strength, 0–100%, applied at note emission.
  Stored ticks are never modified.
- A set carries a **default** strength, stamped onto clips when they are
  created. New sets inherit the default from a machine-level prefs file, so the
  preference survives moving between sets.
- The default is edited on the Main Params page; the clip value on the Clip
  Params page. Both use the note-probability cell UI.
- `Shift + Step 16` cycles the active clip through `0% / DEF / 100%` and shows a
  transient panel with the candidates, jog-selectable while it is up.

The point: a live take gets the user's preferred tightness immediately, and any
take can be dialled back to the timing that was actually played.

## Decisions taken during design

| question | decision |
|---|---|
| where the set default lives | new machine-level `prefs.json`, outside `sets/` |
| swing vs partial quantization | quantize toward the **swung** grid |
| shortcut cycle from an off-cycle value | advance to next higher candidate, wrapping |
| overlay interactivity | transient (1200 ms), but jog selects while up |
| inputs that dismiss the overlay | only those that repaint the screen or toast |
| legacy clip quantization | 0% — existing sets sound bit-identical after upgrade |
| factory default when no prefs exist | 0% — upgrade changes nothing until chosen |

## 1. Engine

### Data

```rust
// clip.rs
pub struct Clip  { …, pub quant: u8 }      // 0..=100
pub struct Note  { …, pub fired: bool }    // runtime only, never serialized
// engine.rs
pub struct Engine { …, pub default_quant: u8 }
```

**Seeding, without threading a parameter.** An empty clip's `quant` is
meaningless until the clip exists, so the engine simply keeps the pending
default *in* every empty clip:

```rust
fn reseed_empty_clips(&mut self) {
    for t in &mut self.tracks {
        for c in &mut t.clips { if !c.exists() { c.quant = self.default_quant; } }
    }
}
```

A clip is then born already holding the right value and `ensure_exists()` needs
no change. This matters because `ensure_exists` is reached through
`extend_to_step` from `record_note`, `add_note_raw` and `push_note` — giving it
a parameter would cascade through four `Clip` methods and every command that
enters a note.

The sweep is 32 checks and runs where creation can follow: after `dq`, at the
end of `persist::load`, and once at the end of `command::dispatch` (which also
covers clip deletes, so a cleared slot re-seeds).

The clip owns a **copy**, not a link. Changing the set default never re-times an
existing clip.

### Emission (engine.rs, `step_tick`)

Replaces `let fire_tick = n.tick + self.swing_delay(n.step, snum, sden);`

```rust
let anchor = n.step as u32 * TICKS_PER_STEP;
let dev    = n.tick as i64 - anchor as i64;                          // human deviation
let half   = if dev >= 0 { 50 } else { -50 };                        // round half away
let pulled = dev - (dev * quant as i64 + half) / 100;
let mut fire = (anchor as i64 + pulled + swing_delay(n.step) as i64) as u32;
if fire >= end { fire -= length_ticks; }        // wrap a pre-bar-line note to loop start
```

`n.step` is already the quantize target — it is what the destructive
`quantize()` computes, and `record_note` derives it with the same nearest-step
rounding. So quantization scales a deviation between two numbers the note
already carries: **no new per-note storage**.

**Quantization scales the deviation; swing is added at full weight either way.**
100% lands the note on the swung grid, exactly reproducing the destructive
`quantize()` plus swing. 0% is bit-identical to today's emit line.

This corrects the composition chosen during design ("interpolate raw → swung
grid"), which was wrong for *programmed* notes: they sit exactly on the anchor,
so interpolating toward `anchor + swing` would scale the swing offset itself and
leave a step-entered pattern unswung at 0% strength — silently disabling the
SWING knob for anyone on the factory default. The existing test
`swing_delays_offbeat_steps_only` catches it. Swing and quantize are orthogonal
groove controls; only the human deviation is quantization's business.

Interpolating toward the *unwrapped* grid and wrapping only the result is what
keeps the pre-bar-line case sane. A downbeat played 4 ticks early (raw 380, grid
384) moves 380 → 382 → 384 as strength rises, and only the final value wraps to
the loop start. Interpolating toward a pre-wrapped target would sweep the note
backwards through the whole bar at 50%.

### Firing rule: `fired`

Firing stays exact equality (`fire == pos`). The added `fired` flag, set at the
moment a note reaches its fire tick and cleared on wrap alongside `suppress`,
exists for one case: a strength change that moves a note's target *ahead* of the
playhead after it already sounded would otherwise trigger it twice in one pass.

`fired` is set **before** the probability/condition branch, not after — a note
that rolls "skip" has still had its turn this pass.

`release_suppressed()` becomes `release_pass_flags()` and clears both. It must
also run when a queued launch resets `pos_tick` (engine.rs:1380), or stale flags
from the previous pass silence the first bar.

Rejected: firing on `pos >= fire`. It makes a note whose target moved behind the
playhead sound *immediately*, at an off-grid moment — worse than missing the
pass — and it breaks notes outside the loop window, which satisfy `pos >= fire`
on every tick. Accepted cost: a mid-pass strength increase can skip one note.

### Count-in pre-roll capture (folded in)

Today a note played shortly before the count-in ends is **lost entirely**, not
misplaced: `live_note_on` (engine.rs:1143) gates on `self.recording`, which
flips true only when `count_in_left` reaches 0 (engine.rs:1413), so the note-on
never reaches `rec_pending` and nothing downstream can recover it.

During the count-in `pos_tick` never advances (all of `step_tick` is gated at
engine.rs:1422), so it sits at `loop_start` — and `count_in_left` *is* the
note's distance before recording start, in ticks, for free.

- `RecPending.start_tick` becomes `i32`.
- `live_note_on` also accepts notes while
  `count_in_left > 0 && count_in_left <= TICKS_PER_STEP / 2`, storing
  `start_tick = -(count_in_left as i32)`.
- `live_note_off` widens its early return identically, so a note played *and*
  released inside the pre-roll still resolves.
- `record_note` receives `start_tick.max(0)`, but **gate is computed from the
  signed value**, so a note held from before the downbeat keeps its true length.
- Cancelling record during the count-in already drains `rec_pending`
  (`toggle_record`, engine.rs:669) — no change needed, but it is load-bearing
  now that the list can be non-empty there.

Half a step is the window because `record_note` already rounds at
`TICKS_PER_STEP / 2` — this does not invent a rule, it removes an artificial
floor at zero, so time before the downbeat rounds like time after it.
Everything inside the window anchors unambiguously to step 0. At PPQN 96 that
is ≈62 ms at 120 BPM: wider than human push, narrow enough not to swallow a
deliberate pickup, and it scales with tempo automatically.

The note anchors at `tick = 0`, so the push itself is not preserved. Doing that
would need notes that sit *before* their anchor — a signed micro-offset on
`Note`, dragging in the persistence format, dump/replay and undo snapshots. Not
worth it for the first downbeat of a counted-in take, which nobody pushes on
purpose. It stays additive if we ever want it.

### Commands

- `cq <track> <pct>` — active clip quantization.
- `dq <pct>` — set default (stamped onto future clips).
- `quant <track>` and `Clip::quantize()` are **deleted**. 100% is equivalent.

Status gains the active clip's `quant` so the UI cell can mirror it.

### Untouched by design

Locks, trigs, occupancy, LEDs, step editing, note-length editing and the
automation latch are all keyed on `step`, never on `tick`, so none of them can
observe quantization. Step-entered notes have `tick == step*24`, making
quantization provably inert on programmed patterns. The blast radius is one
expression in `step_tick` plus one bool.

Cost: one multiply and divide per note per tick in the emit scan. At the 512-note
cap and ~205 Hz that is noise in Rust; no caching until a perf test says
otherwise.

## 2. UI

### Cells

| | page | knob | shortName | fullName |
|---|---|---|---|---|
| clip | Clip Params (Shift+Step 3) | 4 | `QUANT` | Clip Quantize |
| default | Main Params (Shift+Step 5/7/9) | 3 | `QUANT` | Default Quantize |

Both slots are `null` today (clip-page-vm.ts:62, main-page-vm.ts:78) — a
fill-in, not a re-layout. Both pages already wrap each knob in its own undo
gesture, so the new cells inherit correct undo for free.

Cell shape copies PROB: `type: 'enum'` with a label list, rendered as the enum
square.

```ts
export const QUANT_VALUES: number[] = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
```

Ascending, unlike `PROB_VALUES` (which descends because full probability is the
resting state) — clockwise should tighten. The two lists are never on screen
together.

The clip-page knob gate in `midi/router.ts` is `if (d1 < 3)` and becomes
`if (d1 < 4)`.

### Shortcut

`router.ts:366` currently fires a snapshot-backed destructive edit and a
`'Quantized'` toast. It becomes: build `[0, DEF, 100]`, dedupe (DEF at 0 or 100
collapses to two), pick the smallest candidate strictly greater than the clip's
current value with wraparound, send `cq`, arm the overlay. Target stays the
watched track's active clip.

Undo: the snapshot edit is replaced by the knob pages' gesture pattern, keyed so
repeated presses **collapse into one entry** — auditioning 0 → 70 → 100 is one
undo back to the start. `label.ts:95` `valueChange(from, to)` makes it read
`QUANT 0% → 100%` instead of the opaque `QUANTIZE`.

### Overlay

Capture's visual language (values in a row, selection knocked out of a solid
box) but not its modality: `drawCaptureOverlay` calls `clear_screen()` and owns
the display (tick.ts:481), which is right for a blocking decision and wrong for
a confirmation you glance at mid-take.

- Extract the value-row-with-boxed-selection out of `renderer/capture-overlay.ts`
  into a shared renderer. Capture keeps full-screen framing; quantize gets a
  ~19 px panel over the current view. One drawing routine.
- Sizing: `glyphs-big.js` covers printable ASCII so `%` renders; `0%` / `70%` /
  `100%` at 11 px is ≈84 px plus gutters, inside `W = 128` — the same budget
  capture spends on three 3-digit tempos.
- The default marker is a small `DEF` in the 5 px font under the middle value.
  It needs its own channel because the inverted box is taken by the selection,
  and the two coincide constantly.
- No caption. Capture needs `JOG PICKS TEMPO` because it blocks with no default;
  here the value is already applied and the jog is optional refinement.

**Lifetime: 1200 ms wall-clock**, via the house `*At(nowMs)` convention
(`momentary.ts`, `step-rec-preview.ts`, `leds.ts`) — not a tick count.
`TOAST_TTL = 196` ticks is load-dependent: 0.96 s at 63 Hz, 3.1 s at 205 Hz.
1200 ms is above the ~700–800 ms needed to find the box among three values, with
margin for a late glance, and short enough never to feel in the way.

**Jog is live while the panel is up.** Consuming the jog was the expensive part
(the router gate); once captured, a jog turn that does nothing reads as a dead
control.

- Each detent moves the selection and **commits immediately** (`cq`), so the
  timing change is audible while dialling. Auto-dismiss is the commit; there is
  no confirm.
- Every turn **re-arms** the 1200 ms timer. Jog *touch* (the `JOG_TOUCH` note
  capture swallows at router.ts:163) re-arms without changing anything, so a
  resting finger holds the panel open.
- Detented via `countDetents` (`detent.ts`) — one physical click per candidate.
  Verify `DETENT_DIV = 8` against the jog on device; capture feeds `captureJog`
  the raw decoded delta and may be tuned differently.
- **Clamped, not wrapping.** With three candidates, wrapping means one click
  past 100% lands on 0% — raw timing, the most drastic jump — from what felt
  like a small overshoot.
- **Candidates only**, not all eleven values. The panel shows three, and the
  Clip Params knob is already the fine control.

### Input policy

A gate in `src/midi/router.ts`, sibling of the `captureOverlayActive()` block at
line 127 — same shape, different policy. Capture's gate runs first, so the panel
cannot arm underneath a screen-owning overlay.

| input | overlay | event |
|---|---|---|
| jog turn | move selection, commit, re-arm | consumed |
| jog touch | re-arm | consumed |
| jog press | dismiss | consumed |
| Back | dismiss | consumed |
| Shift + Step 16 | advance, re-arm | handled normally |
| Mute/Solo, page opens, Full Vel, Metronome | dismiss | consumed |
| steps, pads, bar nav, Play, Rec, tracks | **untouched** | passes through |
| any release (value 0) | untouched | passes through |
| 1200 ms idle | dismiss | — |

The rule generating the "noisy" list: **sets `appState.dirty` or raises a
toast**. In `seq/router.ts` that is exactly Mute/Solo (line 208), the
page-opening Shift+Steps (345, 355), and the Full Velocity / Metronome toasts.
Play, Rec, pads, steps, bar nav and track buttons are LED-only, so **transport
is never eaten** — that falls out of the criterion rather than needing an
exception. The list lives as one constant beside the classifier, commented with
the rule that produced it.

Three exemptions the feature does not work without:

1. **Shift-up must not dismiss.** The gesture is Shift+Step 16, so Shift comes
   up ~100 ms after arming. Releases falling through is already the house rule
   (router.ts:127: *"Releases fall through so no handler is left holding a
   button that never came up"*).
2. **Step 16 itself must not dismiss.** Capture's classifier returns `dismiss`
   for any `0x90`/`0xB0` with non-zero value, which would catch the second press
   of a double-tap. Check `shiftHeld && cc == Step16` before the generic branch.
3. **Silent inputs do not dismiss at all.** Nothing they do competes with the
   panel, so hitting pads or entering steps lets it live out its timeout.

## 3. Persistence and migration

### Clip quantization → engine blob

`persist.rs` is line-based and documents itself as growable (*"Unknown lines are
ignored so the format can grow"*), with a `cp` line already carrying exactly
this class of value under an *"omitted-on-legacy → defaults"* contract:

```
cp <track> <slot> <scale_num> <scale_den> <transpose>          # today
cp <track> <slot> <scale_num> <scale_den> <transpose> <quant>  # + one field
```

Parse positionally with a default for the missing sixth field. `FORMAT_TAG`
stays `movy1` — additive, not a version break. Undo is free: the snapshot ring
clones `Clip`.

**Load ordering:** `load_clip` does `*clip = Clip::new()` (quant 0) and the `cp`
line, which arrives after `cl`, overwrites it when present. A legacy save with
no `cp` therefore lands at 0 — the intended migration — and `reseed_empty_clips`
at the end of `load` touches only slots that stayed empty. Do **not** move the
seeding into clip creation, or legacy clips would silently adopt the current
default.

### Default quantization → UI blob + prefs

Not the engine blob, despite the engine consuming it. It is a preference, its
fallback logic belongs in TS beside the prefs file, and `main-page.ts` already
has the undo machinery for UI-owned fields (`recordUiOp` / `readUiField`) —
`ui-fields.ts` is a three-case enum a fourth slots into. `applyUiState` resolves
it on load and pushes `dq <pct>` to the engine.

Split: **clip quant is clip data** (travels with undo, dump/replay, set copy);
**default quant is a set setting** (travels with UI state).

### Prefs file

```
/data/UserData/schwung/modules/tools/movy/prefs.json
```

One level above `SETS_DIR`, so the filesystem shows that this is the one thing
movy owns that no set owns.

Durability is deliberately cheaper than state's: reuse `safeWrite` from
`persist-store.ts` (write, read back, compare) and stop — no shadow rotation, no
checksummed envelope, no generation counter. That apparatus exists because
losing `seq-state.json` loses music; losing `prefs.json` loses one number the
user retypes once. Written on **gesture end**, not per detent.

### Resolution order

| | source |
|---|---|
| clip quant | `cp` field → absent: **0%** |
| set default | UI blob → absent: prefs → absent/corrupt: **factory 0%** |

Legacy clips at 0% is the only value guaranteeing existing sets play back
bit-identically. An old set with no stored default is treated as new for the
*default* only — harmless, since the default reaches nothing but clips created
from then on.

Factory 0% is upgrade-safe: movy records raw today and quantize is a manual
press, so installing this release changes nothing until the user chooses. The
cost is that "new recordings get your default" waits for a one-time setting.

Set copy/paste needs no work: `set-inherit.ts` already seeds both blobs.

## 4. Testing

Match the test to the level that reproduces the behaviour; prove teeth by
removing the fix and watching it fail.

**Rust (`engine/crates/seq-core`)**

- `quant_100_matches_legacy_quantize` — 100% emits at the tick the deleted
  destructive `quantize()` produced.
- `quant_0_plays_raw_timing` — off-grid note fires at its recorded tick, and
  with `swing_pct > 50` **no swing is added** (the deliberate change).
- `quant_50_lands_midway` — including a note whose grid target is *below* its
  raw tick (rounding half away from zero in both directions).
- `quant_wraps_pre_bar_line_note` — raw 380 in a 1-bar clip: 382 at 50%, loop
  start at 100%.
- `quant_change_mid_pass_does_not_double_trigger` — fire at 100%, drop to 0%
  after the note sounded, assert one NoteOn. Remove `fired` → two.
- `pass_flags_cleared_on_launch` — queued launch mid-pass still plays bar 1.
- `new_clip_inherits_default_quant`; `default_change_does_not_retime_existing`.
- `preroll_note_is_captured` — note-on at `count_in_left = 6` lands at step 0.
  Remove the widened gate → note absent.
- `preroll_note_released_in_preroll_still_records`.
- `preroll_gate_spans_the_count_in` — gate measured from the signed start.
- `preroll_beyond_half_step_is_ignored`.
- `record_cancel_during_count_in_drains_pending`.
- `persist_roundtrips_clip_quant`; `legacy_cp_line_loads_quant_zero`;
  `legacy_load_does_not_pick_up_default`.

**`browser-test/logic.mjs`**

- Candidate list: dedupe when DEF is 0 or 100 (two entries, not three).
- Advance-to-next-higher with wraparound, from on- and off-cycle values.
- Jog selection clamps at both ends.
- Overlay classifier: each row of the input-policy table.
- Prefs resolution order, including corrupt-file fallback.

**`browser-test/screenshot.mjs`** — new baselines for: Clip Params with QUANT,
Main Params with QUANT, the overlay with three candidates (selection on DEF, so
box and `DEF` marker coincide), and with two candidates.

**Device** — `./scripts/test.sh` and `./scripts/test-seq.sh` unchanged; verify
`DETENT_DIV` against the jog by hand, and that the panel survives pad hits.

## 5. Documentation

- `MANUAL.md:495` and the shortcut table at `MANUAL.md:986` — Quantize is no
  longer an action. Add QUANT to the Clip Params and Main Params sections, and
  document the pre-roll capture window.
- `README.md` — headline mention.
- `CHANGELOG.md` — note the two behaviour changes: swing no longer applied to
  unquantized notes, and quantize is now non-destructive.

## Out of scope

- Quantize grid other than 1/16. A second field, and the panel has no room.
- Preserving pre-beat push (signed micro-offset on `Note`).
- Quantizing note ends; only starts move.
- Input quantization at record time — playback-time application makes it
  retroactive and reversible, which is the whole point.
