# Batch 1 — LED color & affordance foundation

Status: design (awaiting review)
Date: 2026-06-13
Part of: the movy sequencer LED/UX refinement epic (8 themes, batched). This is
batch 1 of 4. See "Deferred" for what later batches cover.

## Goal

Every LED on the Move reflects two invariants:

1. **One color source.** Track color comes from a single palette; drum pads,
   chromatic root, track buttons and (later) session clips all read it, so they
   can never disagree.
2. **Lit = pressable, full brightness = active.** A control is dark when it
   does nothing in the current context, dim when it is available, and full
   brightness when it is active/pressed. No control is left lit by stale
   firmware state.

This batch is **painting + initialization only**. It adds no new input
gestures — those land in later batches. The one engine change is a read-only
status field (active notes).

## Hardware LED facts (from schwung `docs/MODULES.md`, `src/shared/`)

Two addressing schemes, both via the cached helpers in `input_filter.mjs`:

- `setLED(note, color)` — note-addressed RGB LEDs:
  - Pads = notes 68–99
  - Step **buttons** = notes 16–31
- `setButtonLED(cc, color)` — CC-addressed LEDs:
  - Step **icons** (printed icons *under* each step) = **CCs 16–31** — a fully
    separate LED row from the step buttons
  - Track buttons = CCs 40–43 (RGB)
  - Play/Rec = CCs 85/86 (RGB), Sample/Record = CC 118 (RGB), Delete = 119
  - White-brightness buttons (value `WhiteLedOff/Dim/Medium/Bright` = 0/16/64/124):
    Back 51, Capture 52, Undo 56, Loop 58, Copy 60, Left 62, Right 63, Mute 88,
    Shift 49, Menu 50, Up 55, Down 54

Track colors live in `src/seq/colors.ts` (`TRACK_COLOR[]` / `TRACK_COLOR_DIM[]`).
The chromatic root already uses `TRACK_COLOR[track]`, so matching the track
buttons to it is by construction once movy paints them.

## Components

### 1. Track-color source of truth — `seq/colors.ts`
Keep `TRACK_COLOR[]` / `TRACK_COLOR_DIM[]` as the only palette. Drum pads,
chromatic root, and track buttons all read it. No second palette anywhere.

### 2. Engine active-note reporting — `engine/crates/seq-core` + `seq/state.ts`
The only engine change in this batch. The engine status poll gains, per track,
the set of MIDI notes currently sounding (sequenced playback **and** live
input). The UI mirrors it (e.g. `activeNotes: number[][]` or a small bitmap per
track in `seqState`). Drives "playing pad = green" faithfully during playback,
not just while a pad is physically held.

- seq-core: track active notes already implied by the scheduler; expose them in
  the status string. Add `cargo test` coverage for the new field's
  serialization.
- `ENGINE_VERSION` bumps (constants.ts + movy-dsp lib.rs must match).

### 3. Drum pads — `keyboard/leds.ts` (`drumPadLedColor`)
- Unselected pad → **track color** (was White)
- Selected pad in the rack → **White**
- Sounding pad (active note for this track, or physically held) → **Green**
- Out-of-range → off

Needs the active track and the active-note set threaded in.

### 4. Chromatic pads — `seq/pads.ts` (`chromaticPadColor`)
- Root / in-scale coloring unchanged (root = track color, in-scale = light grey,
  out-of-scale = off)
- Sounding pad (active note, or held) → **Green** (replaces the current
  `BrightRed` held color)
- Pads in the **last-held set** → **White** — the selection memory a step write
  reads (the set of pads held together at the last chord entry, persisted after
  release). The router keeps `heldChord` live; add a per-track `lastHeldSet`
  that survives release.

### 5. Transport LEDs — `seq/leds.ts` (`paintTransport`)
- Play: dark grey when stopped → **Green** when playing
- Rec: dark grey when not recording → **Red** when recording
- Count-in blink behavior deferred to Batch 4.

### 6. Track-button LEDs (CCs 40–43) — new cached painter
movy owns these in overtake mode.
- Base → `TRACK_COLOR[track]` (matches chromatic root by construction)
- Full-brightness pulse when that track has an active note (brief; ~one beat or
  a short fixed decay — tune on device)
- **Mute-dimming is deferred to Batch 2** (coupled to the mute+track gesture).

### 7. Static button affordances — new cached painter
- Sample (118, RGB) → **off**
- Capture (52, white) → **off** (no bound action in movy yet)
- Undo (56, white) → **off** (no bound action in movy yet)
- Back (51, white) → `WhiteLedDim` in module-param views (Knobs/Keys),
  `WhiteLedOff` in chain-param view (`VIEW_CHAIN`)
- Left/Right (62/63, white) → `WhiteLedDim` only when that direction is
  navigable (Left off at bar 0, Right off at `maxBarOffset`); brief
  `WhiteLedBright` pulse on press
- Always-available functional buttons — Loop (58), Copy (60), Delete (119),
  Mute (88), all white → `WhiteLedDim` (available); `WhiteLedBright` while held
  or while their mode is active (Loop bright in Loop Mode). Their *gestures*
  already exist or are added later (mute+track in Batch 2); this batch only sets
  their LED affordance.

> Note: if Undo/Capture should eventually *do* something (e.g. Undo = undo the
> last sequencer edit), that is its own feature item, not part of this batch.

### 8. Step-icon LEDs (CCs 16–31) — new cached painter
Independent of the step button RGB LEDs (notes 16–31).
- **Latched state, always lit:** Metronome on → step-6 icon (CC 21);
  Full-Velocity on → step-10 icon (CC 25)
- **Modifier affordance:** while Shift is held, light all combinable shortcut
  icons — Metro (21), Full-Vel (25), Double-Loop step-15 (30), Quantize
  step-16 (31) — with active ones brighter, so the user sees what is available
- Uses the same `setButtonLED` cached path as the transport LEDs

### 9. Complete LED ownership & startup reset — `app/tick.ts` + `seq/leds.ts`
On movy start (and on any full invalidate), movy drives **every** Move LED to a
known-correct state — nothing left stale from the firmware:
- Painted groups: pads (68–99), step buttons (16–31), step icons (CC 16–31),
  track buttons (40–43), transport (85/86), and the affordance buttons (51, 52,
  56, 58, 60, 62, 63, 88, 118).
- Everything movy does not use → off.
- Extend the existing progressive LED init (currently pads-only, ~8 LEDs/frame
  to respect the overtake output-buffer limit of <60/frame) to cover all
  groups. `seqLedsInvalidate()` plus a button-LED cache invalidate forces a
  full repaint on the next ticks.

Exit-side restore (firmware LEDs when leaving movy) is **Batch 2** — it rides
with the Back-button/exit + background-re-entry work; davebox's exact mechanism
will be matched there.

## Performance

Batch 1 multiplies the number of LEDs movy touches (track buttons, step icons,
affordance buttons on top of pads/steps). The cached LED layer is what keeps
this free, so the rules are non-negotiable:

- **Always paint through the cached helpers** (`cachedSetLED` /
  `cachedSetButtonLED`) — a color is only sent when it differs from the last
  value for that LED. Steady-state cost is therefore zero on the wire; only
  genuinely-changed LEDs cost an IPC packet.
- **Respect the overtake output-buffer limit (<60 LED packets/frame).** A full
  invalidate must never repaint everything in one tick. Keep the progressive
  init batched (~8 LEDs/frame) and let it span frames. The total LED count
  (~32 pads + 16 steps + 16 icons + ~13 buttons ≈ 77) crosses the limit, so
  one-shot repaints would overflow and drop LEDs.
- **No per-tick allocation in the paint path.** Active-note lookups, last-held
  sets, and affordance computations must reuse existing buffers/sets — no new
  arrays/objects per frame.
- **Pulses are state, not timers-in-the-paint.** Active-note / press-bright
  pulses derive their on/off from a tick counter compared against a stored
  start tick (like the existing `blinkOn()` / `pulseOn()`), so the paint stays
  a pure function of state and the cache suppresses unchanged frames.
- **Guard the perf budget in tests.** `perf.mjs` asserts IPC-call count per
  tick; the added painters must show ~0 steady-state IPC delta. If a painter
  sends every tick (cache miss), that is a bug to fix, not a budget to raise.

## Testing

- `browser-test/logic.mjs` — pure, table-driven assertions for every new
  color/affordance function: drum pad (track-color / white / green branches),
  chromatic pad (green / white-selection / root / in-scale), track-button color
  + active-note brightness, transport mapping, Back state by view, Left/Right
  state by `barOffset`, step-icon latched + Shift-affordance states.
- `browser-test/screenshot.mjs` — no new on-screen elements expected (the
  latched-state indicator is now physical icon LEDs, not the display); run to
  confirm no regression. Update baselines only if a view changed.
- `browser-test/perf.mjs` — confirm the added cached button/icon paints stay
  within the IPC/LED budget (they are cached: zero cost when unchanged).
- `engine/ && cargo test` — active-note status field.
- Device: `./scripts/test.sh` and `./scripts/test-seq.sh` when `move.local` is
  reachable; otherwise report DEVICE OFFLINE in caps.

## Deferred to later batches

- **Batch 2 (view-switching / interaction):** mute-dimming + mute+track gesture;
  momentary-vs-latching view switch (Track/Session/Loop on button-down, hold =
  temporary); session track-button opens the track layout; session-grid recolor
  (content = track color, empty = off, selected slot blink white/track,
  empty-selected = dark grey); loop-view blink + single-press select; header-
  style announcements + drop "Bar N" toast; **exit-to-firmware LED restore +
  background re-entry (davebox parity)**.
- **Batch 3 (playhead / step length):** smooth on-screen play head, hidden when
  not playing; hold-step shows length across pads in a dark track color;
  hold-step-A-then-press-step-B sets step A's length.
- **Batch 4 (recording / metronome):** no clip playback during count-in; never
  count-in when already playing; empty-clip visual metronome (cycling groups of
  4 steps).
