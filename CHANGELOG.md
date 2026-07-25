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

### Added

- **Track volume gesture** — hold a track button and turn the volume encoder to
  set that track's Schwung slot volume (0–400%, unity marked). With Shift held
  Movy draws its own slider; without it Move keeps the screen and shows its
  native volume overlay, since the host hands the panel to Move for the duration
  of a volume-knob touch.

  Move firmware always receives CC 79 in overtake, so Movy injects the
  track-hold Move never sees (`move_midi_inject_to_move`) on track-button down —
  Move then routes the turn to its own track volume instead of master. The
  injection must precede the knob touch, since Move picks the knob's target at
  touch time; injecting on the touch moves both volumes at once. See
  `plans/2026-07-25-track-volume-gesture.md`.

- **Solo** — **Shift + Mute** solos the current track, **Shift + Mute + track**
  solos that one; press again to un-solo. Runs on the host's `slot:soloed`, the
  same param schwung's own Shift+Mute+Track drives, so it is exclusive (one solo
  at a time), beats mute, and silences everything else at the audio level —
  live pads and FX tails included. Tracks cut by a solo dim their track button
  like muted ones. Inactive in Session view, which has no current track.

### Fixed

- **Mute button ignored anything but a quick tap.** Pressing Mute mutes the
  current track, but the release ran through the momentary hold rule, so any
  press of 500 ms or more silently did nothing. Duration is not a different
  intent for Mute (its restore is a no-op), so the release is now ungated — only
  a Mute+track use suppresses the current-track toggle. Session view still keeps
  Mute as a pure modifier.
- Knob-touch note mapping: note 8 is the master (volume) knob and note 9 the jog
  wheel, not the other way round. `jogTouched` was being driven by volume-knob
  touch.

## [0.24.0] — 2026-07-25

A fix-focused release. The headline is **module coverage**: Movy now walks a
module's whole parameter menu instead of the first level or two, so synths with
deep menus (Helm, MiniJV, Dexed, Forge, Moog, Surge, Nusaw, Chiptune) expose
every page they publish. Also: Helm's and MiniJV's LFOs draw waveforms, clip
transpose leaves drum tracks alone (engine `0.26.0` → `0.27.0`), and step
automation survives a module reselect.

### Fixed

- **LFO waveform graphics now recognise Helm's and MiniJV's LFOs.** The name
  inference missed three things: shape lists using `Saw Up` / `Sample & Glide` /
  `N Step` / `N Pyramid` (Helm's list scored below the "is this a shape enum?"
  bar), rate and depth spelled `Frequency` and `Amp`, and keys that glue the
  role onto the LFO token (MiniJV's `lfo1form` / `lfo1rate`, which landed the
  shape and its rate in different groups). Helm's three LFO pages and MiniJV's
  eight per-tone LFO pages now draw a live waveform instead of plain knobs.
  Helm's stepped families get their own silhouettes rather than borrowing the
  step-sequencer glyph: **N Step** climbs in levels, **N Pyramid** climbs and
  falls. Verified across all 77 captured modules — no other module's graphics,
  envelopes or parameter names changed.

- **Modules with deep parameter menus show all of their pages.** Movy read a
  module's `ui_hierarchy` too narrowly: it took the section list from either the
  module's own menu *or* the section it delegates to (never both), stopped
  descending once a section had knobs of its own, and gave up below two levels.
  Modules that publish their real menu one level down therefore collapsed to a
  single page — **Helm** showed 1 of its 30 pages, hiding 152 parameters.
  Movy now walks the whole section graph: **Helm 2 → 30 pages**, **MiniJV
  7 → 49**, **Dexed 5 → 23**, and *Forge*, *Moog*, *Surge*, *Nusaw* and
  *Chiptune* reach sections that were previously unreachable. Nested sections
  are named `Parent/Child`, and a section that merely repeats another one's
  knobs is now shown once instead of twice (11 modules had such a duplicate
  page). No parameter that was reachable before became unreachable — the module
  regression suite asserts it for all 77 captured modules.

- **Clip transpose no longer shifts drum tracks.** A drum module's pitches are
  pad addresses, so a transposed step fired the wrong pad — or nothing at all,
  when the shift landed outside the module's pad range. The sequencer engine now
  ignores clip transpose on a drum track (playback, live recording and step
  entry alike, so stored pitches keep one meaning), including for clips that
  already carried a transpose from before the drum module was loaded. On the
  Clip page the TRANS cell reads `n/a` there instead of offering a control that
  could never be heard. Engine `0.26.0` → `0.27.0` (new `tdrum` command).
- **Step automation is audible again after reselecting a module.** Reselecting a
  self-describing module (OB-Xd, Weird Dreams, Noisemaker, …) hot-reloaded its
  chain host and left the host's static param cache empty, so automation
  playback was silently dropped while the UI still showed it — only a restart
  recovered it. Movy now refreshes that cache after a reselect, so recorded
  automation keeps playing without a restart.

## [0.23.0] — 2026-07-21

A large release focused on **synchronising Movy with Move's transport**, a new
**per-track LFO page**, **parameter visualisations** (envelopes, filters, LFO
waveforms), **per-voice drum editing**, and a fleet-wide pass over module
layouts. Engine bumped `0.22.0` → `0.26.0`.

### Added — one transport with Move
- **Automatic clock follow** — Movy's playhead locks to Move's transport
  (drift-free), captures its tempo, and shows an **EXT** indicator while
  following. The TEMPO knob writes tempo back to the device.
- **Background mode** — Back at the root view opens a **Leave** menu; choosing
  Background parks Movy under Move's own screens while the sequencer keeps
  running (render/LED work is skipped while parked; `onResume()` forces a full
  repaint on return). **Shift + Back** exits instantly.
- **LINK toggle** (Set page, knob 4) — opt in to a shared transport: Play/Stop
  on either Movy or Move starts and stops both. Gated behind a per-set
  `link_enabled` flag and persisted with the set.
- **MIDI transport emission** — the engine emits Start / 24 ppqn Clock / Stop
  while playing; synced LFOs phase-lock to the transport instead of free-running.

### Added — per-track LFO page
- A fifth chain slot exposing the track's **two Schwung slot LFOs** with a live
  **waveform display** (shape, rate/sync, depth, phase, retrigger dot; skew
  deformation and shapes 6–10).
- **Hold any knob (1 s)** to assign it as an LFO modulation target; modulated
  params are marked with a `~` and keep their base value underneath.

### Added — parameter visualisations
- **Envelope graphics** now cover **partial** envelopes — AD / AR / ASR / ADS
  render as 2- or 3-stage shapes, not just full ADSR.
- **Filter-response curves** — detect a cutoff+resonance pair, reorder them onto
  one line, and draw a mode-aware curve (LP/HP/BP/open) with a rounded corner
  and steep roll-off.
- **Module-LFO waveforms** on any module — shape detection by name inference,
  with rate (1–2 cycles) and depth encoded under the graphic.
- Visualisations track the **automation value** currently being edited.

### Added — per-voice drum editing
- **Forge** — 16-pad Kit A/B layout with full **per-voice editing**
  (playback-safe `pv<N>_` writes), a curated per-voice **automation** set
  (Kit A), and a per-voice **Send** page (reverb/delay/pan). Driven by a
  self-describing `movy_config.json` shipped with the module.
- **libpo32** — consumes the module's self-describing per-voice layout
  (`v<N>_` direct keys, dynamic `chain_params`).

### Changed — module layouts (fleet-wide dump pass)
- **Module metadata now wins over config** — `movy_config.json` only fills gaps
  the module's own hierarchy leaves.
- Curated layouts for chordism, sfz, 303, chiptune, hush1 (+ mrdrums choke);
  param pages for `chain_params`-only modules; one-page-per-bank alignment and
  named preset knobs.
- **Knob sensitivity normalised** to a consistent per-range sweep.
- Corrected param ranges to match DSP clamps (weird-dreams, essaim; mrdrums
  vol/attack/polyphony expanded to native range).
- On-screen short-name dedup overhaul; int type/range inferred for
  metadata-less params; preset knobs no longer render on two pages.

### Added — tooling
- **Module inventory dump** — a device collector plus a Movy layout snapshot,
  and a **dump-replay regression suite** over all 76 fleet modules wired into
  `npm test`.

## [0.22.0] — 2026-07-01

### Added
- **Per-set state** — the sequencer and UI state (root note + scale) are now
  stored per Ableton Move *set*, keyed by the active set's UUID (read from
  `active_set.txt`). Switching sets recalls an independent Movy project,
  aligned with how Schwung stores its tracks per set. Duplicating a set in Move
  (Copy/Paste) inherits the parent set's Movy state.

### Changed
- Movy no longer keeps a single global sequencer state. **Breaking:** the old
  global `seq-state.json` is abandoned and not migrated; each set starts from
  its own per-set state (blank unless inherited from a copied parent).

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
