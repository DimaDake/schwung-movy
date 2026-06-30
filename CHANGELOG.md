# Changelog

All notable changes to Movy are documented here. The format is loosely based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

Movy is an early prototype and was developed rapidly without tagged releases, so
`0.21.0` is the **first documented release** — it bundles everything built so
far. Earlier work is summarised in the timeline below for context.

> **Note on versions:** the app/tool version (`module.json`) and the Rust
> sequencer engine's `ENGINE_VERSION` are tracked separately. Versions below
> refer to the app unless noted.

## [Unreleased]

- _Nothing yet._

## [0.21.0] — 2026-06-30

First documented release. Highlights of everything built to date:

### Added — parameter UI
- Automatic parameter pages for any Schwung module (reads the module's hierarchy).
- Arc knobs, enum knobs, and a full-screen scrollable **enum overlay**.
- **ADSR envelope graphics** — A/D/S/R groups auto-detected and drawn as one
  envelope shape instead of four knobs.
- Multi-page modules; full chain navigation (MIDI FX → Synth → FX 1 → FX 2) and a
  master FX chain in Session view.
- Module browser to load/swap modules per slot.

### Added — sequencer (4 Schwung tracks, aligned with Move)
- Rust sequencer engine (`seq-core` + `dsp.so`) with transport, clips, recording,
  sessions, and persistence.
- Clip step entry/editing, Session view & clip launching, live recording with
  count-in and metronome, loop/bar editing, duplicate/delete, quantize, mute.
- **Parameter automation** — record knob moves live or per-step; values latch to
  their end trigger; on-screen knob arc follows automation; per-lane clearing.

### Added — beyond Move
- **Step parameters** — per-trig velocity, length, probability, A:B condition,
  invert (Elektron-style parameter locks).
- **Clip parameters** — scale, length, transpose (Shift + Step 3).
- **Set parameters** — tempo, swing, root, key (Shift + Step 5 / 7 / 9).

### Added — keyboard & drums
- Two-octave chromatic keyboard per track with octave shifting.
- Drum modules switch the pads to a 4×4 rack with per-voice parameter pages;
  layout templates for Mr Drums and Weird Dreams.

### Added — docs & project
- README, MANUAL, CONTRIBUTING, MIT LICENSE, and UI screenshots.

### Known limitations
- No undo, no capture, chromatic keyboard only (no scale-aware pad layouts),
  four Schwung tracks only, simplified clip model. See the
  [manual](MANUAL.md#7-limitations-vs-move).

---

## Development milestones

A condensed timeline of how Movy got here (pre-`0.21.0`):

- **2026-06-30** — ADSR envelope UI (auto-detect → envelope graphic).
- **2026-06-23** — Clip parameters (scale / length / transpose; Shift + Step 3).
- **2026-06-22** — Set/Main parameters page (tempo / swing / root / key).
- **2026-06-21** — Step parameters (per-trig velocity / length / probability /
  condition / invert); free unused automation lanes.
- **2026-06-20** — Per-voice drum scoping (Mr Drums, Weird Dreams); selected slot
  always the playing slot.
- **2026-06-18 → 19** — Automation latch playback; unified duplicate gesture.
- **2026-06-16** — Parameter automation (tap-vs-hold step gesture → step-auto
  mode, automation dot, per-step/per-bar locks, knob arc).
- **2026-06-12 → 15** — Sequencer core: transport, recording, Session, Loop, step
  editing; LED affordances; count-in/metronome.
- **2026-06-12 → 20** — Drum support: 4×4 rack, drum detection, LED grid, preset
  browser.
- **2026-06-07 → 08** — Module chain view, multi-track, render performance work.
- **2026-06-06** — Initial release: chromatic keyboard + module host for Schwung.

[Unreleased]: https://github.com/DimaDake/schwung-movy/compare/main...HEAD
