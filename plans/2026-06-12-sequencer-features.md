# Movy Sequencer — Feature / Functionality List (v1)

Goal: a fully fledged Move-style sequencer inside movy, driving the **4 schwung tracks**.
Sequencing logic replicates the **native Move sequencer** (manual `move1-manual-en.pdf`,
release notes PDF in repo root). Interaction is **pads / buttons / LEDs only**; the module
parameter pages stay on screen throughout. The only screen additions are the Loop Overview
strip at the bottom and short overlay toasts where native firmware shows them.

Technical reference: schwung-davebox (algorithms, native-engine split, LED batching), but
**native Move behavior wins** wherever davebox deviates.

Decisions from clarification round:
- Engine in **Rust** (cdylib, plugin_api_v2 C ABI, aarch64), UI in TypeScript (existing movy).
- **Auto-save persistence** of all sequencer content.
- Pads replicate **Move chromatic layout** for melodic modules.
- **Count-in + audible metronome click** rendered by the engine.
- Step property editing: **all native gestures** in scope.
- **Real pad velocity** + Full Velocity toggle.
- Undo: **deferred** (not in v1).
- Session: scene = pressing the column's pads (no special slide handling on Move hardware);
  pressing an **empty slot stops that track's clip with launch quantization**.

---

## 1. Transport

- **Play (CC 85)**: toggles transport. Stops also end recording. LED: bright while playing,
  dim when stopped.
- **Auto-start**: adding the first note to an empty clip while transport is stopped starts
  the transport (manual §9.5).
- Tempo: engine `bpm` param, initialized from the project BPM schwung passes at tool load
  (`overtake_dsp:project_bpm`). No tempo UI in v1 (future: movy param pages).
- Fixed step grid **1/16**, 16 steps/bar, max **16 bars** per clip (grid-resolution menu out
  of scope).

## 2. Tracks (4)

- Track selection: existing track buttons (CC 40–43) — selects the sequencer track *and*
  movy's param-page track together.
- **Mute (CC 88)**: hold Mute + track button mutes/unmutes that track (engine suppresses its
  note output). Muted track button LED dimmed.
- Per-track note routing: engine emits channel-addressed MIDI (`0x90|track`) so each of the
  4 schwung chain slots (default channel = slot index) receives its own notes.
- 4 fixed track colors for LEDs (used in session pads, step LEDs, chromatic root pads).

## 3. Note input (pads, Note mode)

- **Chromatic layout** (melodic modules, manual §9.1): guitar-fretboard rows — +5 semitones
  per row up, +1 semitone per column right. Root note = track color LED, in-scale notes =
  light gray, out-of-scale = unlit. Fixed C-Major coloring (scale/key menu out of scope).
- **Octave switching** via +/− buttons (CC 55/54).
- **Real velocity** captured from pad note-on and forwarded to synths + recorded.
- **Full Velocity toggle**: Shift+Step 10 — all notes at 127 (manual §9.3).
- Drum modules: keep movy's existing drum pad grids; the sequencer records the drum notes
  the grid emits. Step buttons show **only the selected drum pad's notes** (lane view,
  manual §9.5); melodic modules show all notes.
- Live pad notes route through the engine (davebox pattern) for sample-accurate timestamps
  and recording.

## 4. Step sequencing (step buttons, notes 16–31)

- Place a note: press pad(s) then a step button, or hold step then press pad(s). Chords =
  multiple pads + one step.
- Remove: briefly press a step containing notes (removes all its notes).
- **Step LED semantics** (manual §9.5):
  - white = step contains note(s)
  - dim track color = empty step inside the loop
  - dim gray = empty clip, or bar outside the loop
  - green = playhead position while playing
- Bar navigation: left/right arrows (CC 62/63); **"Bar X" toast** on the display.
- Navigating past the loop end shows an empty bar (plus icon in Loop Overview); adding
  notes there extends the loop (manual §12.1).
- Sequencing into the selected clip slot; first note creates the clip implicitly in the
  track's first empty slot (or the slot selected in Session mode).

## 5. Step / note property editing (hold step + …) — manual §11

- **Velocity**: hold step + turn Volume encoder (CC 79).
- **Note length**: hold step + turn wheel; ±10% of a step per click; covered steps' LEDs
  brighten; capped at next occupied step for same-pitch/drum notes.
- **Nudge**: hold step + left/right arrow; 10%/click, Shift = 1%, long-press = full step.
- **Transpose** (melodic): hold step + plus/minus = ±1 semitone, long-press = ±1 octave.
- **Multi-step hold**: all gestures apply to all held steps simultaneously.
- **Hold step shows its notes on the pads** (white LEDs); pressing pads while holding adds/
  removes notes in that step (manual §11.9).
- Value toasts on display (range shown when multiple lengths differ), matching native.

## 6. Loop Mode (Loop button, CC 58) — manual §11.5/§12.1

- Press Loop: step buttons become **bars** (up to 16). LEDs: white = selected bar, track
  color = bar in clip, dim = empty bar outside loop.
- Set loop length: press start+end steps together, or hold start then press end;
  double-press a step = 1-bar loop.
- **Hold Loop + wheel**: lengthen/shorten loop; Shift = fine increments.
- Per-bar editing: hold a bar's step + wheel (lengths), + Volume (velocities), + plus/minus
  (transpose), + arrows (nudge) — applies to all notes in the bar.
- Hold a bar + press pad(s): add the note(s) to **every step in that bar** (manual §11.9).
- Delete in Loop Mode: Delete button = delete current clip; hold Delete + step = delete all
  notes in that bar.
- Copy bars within Loop Mode; copy notes from Note-mode steps into Loop-mode bars
  (manual §11.8).

## 7. Loop doubling & clip operations

- **Double loop**: Shift+Step 15 — duplicates notes (and loop length ×2, max 16 bars);
  confirmation on display (manual §12.2).
- **Duplicate clip**: Copy (CC 60) in Note mode duplicates the selected clip to the next
  slot; "Clip duplicated"-style toast; duplicate becomes selected (manual §12.3).
- **Delete clip**: Delete (CC 119) in Note mode deletes the selected clip (manual §12.4).
- Hold Delete + drum pad: delete all notes of that drum sample.
- **Copy notes / step ranges** (manual §11.8): hold Copy + step = copy; release, press
  target step = paste. Hold Copy + hold start + press end = copy range; paste places the
  range sequentially. Works across bars, tracks, and clips. Press Copy again before pasting
  to clear the clipboard.

## 8. Live recording (manual §14.1)

- **Rec (CC 86)**: tracks are always armed in Note mode. Press Rec → 1-bar **count-in**
  (Rec LED flashes for a new clip, stays solid red when overdubbing), then recording
  starts and transport runs.
- Rec LED: solid red = recording; dim = available; unlit = disabled.
- **Metronome**: engine renders an audible click. Count-in always clicks; Shift+Step 6
  toggles the metronome during play/record; count-in on/off itself stays default-on
  (workflow-settings menu out of scope).
- Recording into an empty slot **extends the clip** until stopped; last bar kept only when
  stopping in its second half. Loop Overview shows the growing bars.
- Fixed-length record: select empty slot in Session, set loop length in Loop Mode first.
- **Overdub** into existing clips (select in Session, Rec in Note mode).
- Stop recording: Rec again, or switch track (recording stops, transport continues), or
  Play (stops transport too).
- Notes recorded un-quantized; **Shift+Step 16 quantizes** the clip afterward with the
  default quantize amount (quantize-amount menu out of scope) (manual §11.7).

## 9. Session mode (Note/Session toggle, CC 50) — manual §17

- Toggle switches Note ↔ Session. Pads become the clip grid: **each row = a track's 8 clip
  slots, each column = a scene** (4 rows × 8 columns).
- **Pad LED semantics** (manual §17.1):
  - unlit = empty slot
  - track color = existing clip
  - white = selected empty slot
  - pulsing white = selected existing clip (playing or not)
  - pulsing track color = clip about to stop (another clip launched / empty slot selected)
  - pulsing green = clip queued for launch (transport running)
- **Launch**: press a clip pad — immediate when transport stopped (starts transport),
  quantized to the **next bar** when running.
- **Stop**: pressing an **empty slot** in a track stops that track's playing clip at the
  launch-quantization boundary.
- Scene play: pressing a column's pads launches all clips in the scene (plain pad presses;
  no special gesture handling).
- Selecting an empty slot then entering Note mode targets new notes/recording at that slot
  (clip created on first content).
- **Copy clip**: Copy + source pad → toast → press destination pad to paste (can overwrite).
- **Delete clip**: hold Delete + clip pad — immediate.
- Track buttons still select track; pressing the selected track's button jumps to Note mode
  (manual §17.1.1).

## 10. Screen additions (minimal, on top of param pages)

- **Loop Overview strip** at the bottom of the display (manual §12.1): one line segment per
  bar — thick = selected bar (thin if single-bar loop), thin = in-loop bar, plus icon =
  bar outside loop; a vertical position line sweeps across bars during playback.
- **Toasts/overlays** where native shows messages: "Bar X" on bar navigation, clip
  duplicated/copied/pasted confirmations, value toasts for step edits, count-in indicator,
  metronome on/off, full-velocity on/off. Reuses movy's existing toast/overlay renderer.
- Module parameter pages remain rendered and fully functional at all times.

## 11. Persistence

- Engine state (all tracks, clips, notes, loop lengths, mutes, octave, toggles) auto-saved
  to a JSON file on device (davebox pattern: dirty flag + deferred save), reloaded when
  movy starts.

## 12. Performance & testing

- Engine: Rust unit tests (clock math, scheduler, recording, loop ops, launch quantization)
  run on the host machine (`cargo test`).
- UI: existing browser-test harness extended — logic tests for the sequencer UI state
  machine (mocked `overtake_dsp` params), screenshot tests for Loop Overview + toasts,
  perf tests for LED-update counts and render cost.
- LED updates cached (`lastSent` per LED) + batched, davebox-style, with periodic resync.
- Device e2e: `scripts/test.sh` extended to drive transport/steps via MIDI inject and
  assert engine state from logs.

---

## Out of scope (v1)

- Parameter locks / automation (incl. per-step automation), Capture button
- Key/scale selection menu, In-Key layout, 16 Pitches layout for drum tracks
- Tempo / groove (swing) / step-grid-resolution / quantize-amount / count-in-toggle menus
  (engine has the params; editing UI comes later via movy param pages)
- Undo/redo
- Shift+Play retrigger
- Sampling, arpeggiator/repeat menu, Move-native set interop, MIDI clock sync/Link
