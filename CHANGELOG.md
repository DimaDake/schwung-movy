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

### Fixed

- **A pattern started on a brand-new set is no longer thrown away.** Move calls
  a set `__pending-…` until it saves it, and Movy correctly refuses to treat
  that as a set — but the pads, steps and transport work meanwhile, so a whole
  pattern could exist before Movy learned which set it was in. Resolving the set
  then pushed that set's (nonexistent) state into the engine, on top of the
  pattern: the sequence vanished mid-session, the clip went back to zero steps,
  Play ran an empty clip, and reopening Movy showed nothing at all. Movy now
  adopts what the engine is already holding — the pattern belongs to the set it
  just learned about. A set that has state of its own still restores it.
  (Reported on Discord: new set, drum module, pattern entered, Play does
  nothing — [#4](https://github.com/DimaDake/schwung-movy/issues/4),
  [#5](https://github.com/DimaDake/schwung-movy/issues/5).)
- **The keyboard settings chosen before that survive too.** The same window
  reset scale, mode, layout and octaves back to chromatic/4th the moment the set
  resolved — picking In Key + Inline is exactly what you do before the first
  note. They are now kept and saved under the set just learned about.
  ([#6](https://github.com/DimaDake/schwung-movy/issues/6))

## [0.28.0] — 2026-08-16

### Added — sixteen tracks

Movy sequences **16 tracks** instead of 4. Tracks 1-4 are the same four Schwung
tracks as before and behave exactly as they always have; tracks 5-16 are chains
**Movy hosts itself**, summed into its single stereo output. Nothing about the
first four changed, so an existing set opens and plays as it did.

- **Four groups of four.** The four track buttons and the Session clip grid
  always address one group. In Session view the **octave + / −** buttons move
  between groups — **+** towards tracks 1-4, **−** towards 13-16, the direction
  the grid reads on screen.
- **The Session step row is a track selector.** Each of the 16 steps is one
  track, in that track's colour. The focused group pulses; hold **Note/Session**
  and the track you are on lights solid white. Press a step to open that
  track — tap to stay, hold to peek.
- **Shortcut: hold Session + press a step.** Jumps straight to that track from
  wherever you are, and the row stays a selector while you hold, so you can keep
  tapping through tracks and auditioning them.
- **Tracks 5-16 take modules like any other track.** Load through the same
  browser, edit through the same knob pages, LFOs and automation included. Their
  modules and settings are saved with the set.
- **Track colours are eight, in a Latin square.** A colour reappears in another
  group but never in the same row or column, so two tracks visible at once never
  share one. Chosen by hue separation (≥ 58°) after a 16-distinct table shipped
  pairs that measured far apart in CIELAB and read identical on the hardware.

### Added — engine and hosting

- `movy-dsp` hosts its own module chains: private `dlopen`, a serialised load
  queue that never blocks the SPI callback, a saturating summing mixer, and
  per-chain state blobs persisted with the set. `NUM_TRACKS` 4 → 16
  (**ENGINE_VERSION 0.33.0**).
- A `TrackPort` abstraction replaces `activeSlot` everywhere, so the whole UI
  works on either kind of track without branching per call site. Movy-hosted
  params ride schwung's **bulk** get/set channel — one round trip per page,
  not one per key.

### Changed — performance

Sixteen tracks meant the pad path had to be measured properly, and the
measurement moved several things:

- **Live pads are answered by the engine on the audio thread**, not routed
  through the UI tick.
- **Port reads are batched** and a knob page no longer pays a round trip per
  tick — the chain refresh that dominated the pad path is now on the bulk
  channel. On a movy track, measured tick rate 110 → 144-147 Hz, and the tick
  period *is* the pad sampling interval.
- Status parsing is bounded, so 16 tracks parse in 0.011 ms (1.4× the 4-track
  cost, not 4×).

Per-synth CPU is documented in `docs/chain-cpu-benchmarks.md` and
`docs/track-performance.md`, measured on device.

### Known limitations

- **The CPU runs out long before the tracks do.** Expect ~6-7 tracks of ordinary
  synths playing notes. Cheap modules go much further: 16 tracks of **dexed** at
  2-4 notes each, with mverb on half of them, runs.
- **Track + volume needs Shift on tracks 5-16.** The plain gesture works by
  telling Move which track is held, and Move has only four track buttons — so on
  a Movy-hosted track the knob stays on Move's master volume. Use
  **Shift + track + volume** there.
- **Tracks 5-16 are silent while Movy is closed** (Background mode keeps them
  playing). Tracks 1-4 are unaffected — they are Schwung's.

## [0.27.0] — 2026-08-14

### Added — parameter visualisations

Movy already drew filter curves, envelopes and LFO shapes. This release extends
that to the rest of a synth's page: a control now shows **what it is** in its own
cell, so a page can be read at a glance instead of one five-character label at a
time. Everything below is detected from what the module reports — no per-module
configuration, and a control that does not genuinely qualify keeps its knob.

- **Waveform selectors draw their wave.** A knob that picks an oscillator or LFO
  shape draws the shape itself — sine, triangle, saw, square, pulse, ring,
  wavetable, noise — rather than abbreviating its name. 22 selectors across the
  79-module fleet qualify:

  ![Waveform knob cells](docs/assets/wave_cells.png)

  The full-screen list shows the same glyph beside every name, so choosing a
  shape is a matter of recognising it:

  ![The waveform list](docs/assets/wave_overlay.png)

  Where a module's shapes are *stepped* — Helm's stepped ramp and pyramid — the
  drawing carries the level count, so a 4-step ramp reads as four steps and a
  16-step one as a slope:

  ![Helm's stepped waveforms](docs/assets/wave_helm.png)

  And where a module offers its waves as separate on/off switches instead of one
  selector (9 placements), each draws solid when on, dotted when off:

  ![Waveform on/off toggles](docs/assets/wave_toggles.png)

- **A sampler shows its sample.** A playback **position** next to the file it
  plays draws them as one graphic: the waveform of the sample, with the position
  marked. The marker is **inverted over the wave** — a bright line through a
  quiet passage, a dark notch through a loud one — so it stays the
  highest-contrast thing on the line wherever it sits. The waveform is
  normalised to the full cell height, so a quiet recording is still readable:

  ![Sample waveform with position](docs/assets/wav_sample.png)

  WAV (8/16/24-bit and float) and **AIFF** are both read, a block at a time in
  the background so a long sample fills in over a moment instead of stalling the
  knobs, and the result is kept until the file changes.

- **Loop points draw as brackets on the sample.** A sampler's loop start and end
  are drawn where they fall in the file, so the loop is visible as a span rather
  than as two percentages:

  ![Loop brackets on the waveform](docs/assets/wav_loop.png)

  Parameters a module says do not currently apply are now **hidden** rather than
  shown dead: switching the loop off takes its start/end away and the waveform
  takes back the room:

  ![The same page with the loop off](docs/assets/wav_loop_off.png)

- **A granular sampler sprays visibly.** Grain **spray** is drawn as the span of
  file it can reach around the play position, dotted at its edges — so you can
  see it widen, and see it saturate once it covers the whole sample:

  ![Granular spray across the sample](docs/assets/spray_saturated.png)

- **Band gains draw an EQ curve.** Two or three band gains on a page (low / mid /
  high, or a module's own names such as *Body* and *Air*) are placed in frequency
  order and drawn as one response curve. The dotted line is 0 dB, so a cut reads
  as clearly as a boost — shelves at the ends, a bell in the middle. 5 modules
  qualify:

  ![EQ band curve](docs/assets/eq_bands.png)

- **Low cut and high cut draw the band they leave.** A cut pair on one page is
  drawn as the band that survives it, each corner following its own knob; a cut
  with no partner keeps its cell and shows just its corner, rising for a low cut
  and falling for a high cut. 8 pairs and 8 lone cuts across the fleet:

  ![Low and high cut curves](docs/assets/cut_filters.png)

- **A lone attack or decay draws as a ramp.** An envelope stage with no ADSR
  partners to group with is drawn as the ramp it is — a rise for an attack, a
  fall for a decay — instead of an arc that says nothing about its shape. 21
  placements, Plaits' `DECAY` among them. An attack/decay pair on one line is
  drawn as the single shape it makes:

  ![Lone attack and decay stages](docs/assets/env_stages.png)
  ![A lone decay on Plaits' main page](docs/assets/plaits.png)

- **Loudness knobs are faders.** A control that sets a level — a volume, a gain,
  an oscillator or send level — is drawn as a fader: a filled bar between two
  dotted rails with a head at the value. It fills from the bottom in every case,
  so one glance across a page finds the levels. 140 parameters across 53 modules:

  ![Loudness knobs drawn as faders](docs/assets/faders.png)

  Only a genuine output level qualifies — an envelope's *Level*, a key-follow
  amount, a compressor *Threshold* and anything measured in dB-per-something keep
  their knobs, because each is an amount of something else.

- **Booleans are on/off switches.** An on/off parameter is drawn as a switch,
  filled with its knob to the right when on and hollow with the knob to the left
  when off, so its state reads from across the desk. 222 parameters across 44
  modules, plus Movy's own Retrigger and Play Link:

  ![Boolean knobs drawn as switches](docs/assets/switches.png)

Several of these share a page routinely — here a drum pad's sample, its level,
its attack and its mode, each drawn as what it is:

  ![Graphics sharing one page](docs/assets/drum-mrdrums-pad5.png)

### Changed

- **Loop-view bars breathe, together.** The bar selector fades each bar in and out
  against black — green for the bar playing, white for the one you are viewing,
  the track colour for the rest of the loop, near-black for everything outside it
  — with every pulsing bar on one animation channel, so the row breathes as a
  single movement instead of drifting apart. The hardware does the fade, so it
  stays smooth and no longer freezes while the transport is stopped, which is
  precisely when you are reading these. An idle Loop view now sends no LED
  traffic at all, where the old blink sent the whole row four times a second.
  Whether a bar holds notes is deliberately no longer shown: in this view a bar's
  job is to tell you whether it plays.
- **Loop mode says which window you are editing.** Entering it flashed `Loop` for
  a third of a second and then left nothing on screen. A band now stays up naming
  the window and the bar you are on — `LOOP 3-4  BAR 3` — and follows you as you
  navigate.

  ![The Loop view](docs/assets/loop_header.png)

- **A handful of values no longer means a hair trigger.** Any parameter with
  eight discrete values or fewer now takes four clicks per step — the rate
  Movy's enum knobs already used — so OB-Xd's five-position octave takes a
  deliberate turn instead of crossing its whole range in four clicks. 86
  parameters across 23 modules are affected, Dexed's operator settings and
  OB-Xd's `voice_count` and `legato` among them. On/off switches are untouched
  and still flip on a single click. A turn that doesn't cross a step now writes
  nothing at all, so it costs no undo entry either.
- **Octave offsets and voice counts read as numbers, not arcs.** 41 parameters
  across 24 modules — every `octave`/`octave_transpose`, Moog's four oscillator
  ranges, and every voice count from `obxd voice_count` to `sfz voices` — are
  drawn as a framed value, with a sign on the 26 that are offsets. An arc shows a
  position in a range, which is the wrong reading for a value you think of by
  name; the cell otherwise showed the parameter's name and revealed the number
  only while the knob was touched.

  ![Step cells](docs/assets/test_steps.png)

### Fixed

- **Two graphics side by side no longer merge into one.** A curve or waveform
  that ran to the very edge of its cell touched whatever was drawn next to it,
  reading as a single shape. Every span graphic is now inset by the same amount
  on both sides — but only where it meets a neighbour, never against the screen
  edge, where there is nothing to separate from and the pixels were wasted:

  ![Graphics that meet, kept apart](docs/assets/wav_beside_filter.png)

- **A sample position no longer jumps to the start when you let go.** A sampler's
  position is a fractional value the module reports as an integer type, so
  releasing the knob wrote back a rounded 0 and the sound snapped to the top of
  the file. Movy now keeps the value the knob is actually holding.

- **The browse hint appears on the chain page too.** The prompt that tells you a
  long jog press opens the module browser only showed on parameter pages, which
  is not where you go looking to change a module.

- **Watching a parameter's visibility costs nothing.** Deciding whether a control
  applies was polled from the host every tick, then on a throttle; it is now read
  from the value the ordinary refresh already caches, so it makes no host call at
  all. Sample peaks also survive a resize — toggling a loop used to widen the
  graphic and re-read the whole file, which is exactly when the stall was felt.

- **A loop set in the middle of a part now works at all.** Pressing two bars to
  loop, say, bars 3–4 left every view wrong, because the engine stores an
  absolute window while the display read the loop's *length* as if it always
  started at bar 1. The step row went completely dark, hiding the notes and
  making step editing blind; the bar strip drew its segments on bars 1–2 and
  marked bar 3 — selected and playing — as an out-of-loop bar; the play line sat
  pinned to the right edge for the whole loop; the arrows could not reach the
  loop's own last bar but could wander below its first; and Loop view gave no
  indication of the window at all, so a bar holding leftover notes outside the
  loop looked exactly like one inside it.

  ![A loop on bars 3-4](docs/assets/loop_strip_midclip.png)

- **Opening Movy shows the bars that play, not bar 1.** On a fresh start the bar
  indicator led with the clip's *first* bars as inactive `+` markers whenever the
  loop began later — the view was parked on bar 1 while the engine looped, say,
  bars 3–5. The view now adopts the window as soon as the engine reports it, and
  again whenever that window moves under it (switching tracks, launching a clip,
  undo). Deliberately selecting a bar outside the loop in Loop view still sticks.
- **Setting a loop no longer strands the view outside it.** Pressing two bars, or
  shrinking with Loop + jog, left the viewed bar where it was — which could be a
  bar that had just stopped playing, so edits went somewhere you could not hear.
  Navigating out of the loop deliberately still works, and the strip says so:

  ![Navigated past the loop](docs/assets/loop_strip_outside.png)
- **A bar double-tap is a consistent length now.** The window counted engine
  ticks, and the tick rate moves with load (63–205 Hz observed), so the same
  double-tap was anywhere from 0.29 s to 0.95 s depending on what the UI was
  busy with. It is 450 ms of wall clock.
- **Knobs keep up on a big synth's busiest page.** Turning a knob on Helm's Main
  page lagged the hardware badly, while the same page on OB-Xd was fine. Two
  causes, both paid on every tick: the app read `drumPadCount` and
  `drumCurrentPad` through `getViewModel()`, building the entire page — layout,
  envelope and filter graphics — and discarding all but one number, up to three
  times per tick and even on frames that did not repaint; and a filter pair with
  no mode enum on its own page re-scanned all of the module's parameters, with a
  regex per enum, to find one elsewhere. Both now use cheap accessors and a cache
  keyed on the loaded parameter list. On device, Helm's Main page went from 52 ms
  to 8 ms per tick and its tick rate from ~18 Hz to ~105 Hz; of 150 injected
  detents it registered 136 where it had registered 14. The tick period is also
  how often Movy samples knob MIDI, which is why the dropped detents felt like
  lag. Every module benefits — Helm was simply the one dense enough to show it.
- **An empty track no longer slows every knob down.** Movy asks the host what
  module a track holds so the engine knows whether to transpose its clip. An
  *empty* slot never answers, so the question was asked again on the very next
  tick — forever. Each ask is a blocking round-trip the audio shim only services
  once per SPI frame (~2.7 ms), and the tick period is also how often Movy samples
  knob MIDI, so a set with three empty tracks spent most of every tick waiting and
  the knobs felt heavy. Unanswered slots are now retried on the same ~1 s cadence
  as the module-name poll, so a module loaded from outside Movy is still picked
  up. On a set with one empty track this cut host round-trips per tick from 2.6 to
  1.7 and the tick period from 13.1 ms to ~11.9 ms; the effect grows with the
  number of empty tracks.
- **A negative value in a boxed cell no longer loses its minus sign.** The box
  splits a label across two lines on `_` and `-` so `LOW_PASS` reads `LOW`/`PAS`,
  but it applied that to numbers too: `-3` drew as `3`, identical to the positive
  `3` that Surge publishes as the very next octave option. Affected every enum
  with signed numeric options (Surge's four octave selectors, Essaim's `v_octave`,
  Eucalypso's and SuperArp's octave ranges) as well as the new octave cells.
- **Fixed three glyphs in the small font**, checked against `5x3-font.otf`: `+`
  sat two pixels above the digits beside it, `=` had the same slip, and `1` was
  mirrored — its flag pointed right off a left-hand stem, so `12` read oddly in
  cells like the filter's `SLOPE`. The normal and large fonts were already correct.
- **An automated parameter now shows its value before you touch it.** A parameter
  with an automation lane, or one an LFO targets, deliberately stops reading its
  value back so the page keeps showing the base you set. But that base was only
  ever filled in by turning the knob, so a parameter automated before it was
  first touched had no value at all: its arc sat pinned at the bottom of its
  range (on an octave −3..3 that looks like a real −3), and assigning automation
  used the range minimum as the base rather than the real value. It is now read
  once, then left alone as before.
- **A knob now moves the same distance in both directions.** On any parameter
  with discrete values and a range of 200 or less — which is most of them, 257
  of the 464 in the surveyed module fleet, including every knob on OB-Xd's
  Global and Filter pages — one click clockwise moved the value by one while one
  click counter-clockwise moved it by nothing at all. The arc sensitivity scale
  put those parameters on a half-unit step, which the rounding that stores an
  integer resolved upward in one direction and swallowed in the other. Discrete
  parameters now step whole units, so counter-clockwise matches the clockwise
  feel that was already correct.
- **Turning a knob faster no longer covers less ground.** The same fractional
  step also lost the remainder each time the host batched several clicks into one
  tick, so a quick sweep advanced roughly half as far as the same clicks made
  slowly — the "clockwise is smoother" half of the report above. A turn now
  moves in proportion to how far it is turned, at any speed.

## [0.26.0] — 2026-08-10

### Added

- **Non-destructive quantization.** Quantization is now a per-clip value from
  0 to 100 %, applied as notes are emitted rather than by rewriting them, so
  recorded timing survives and can be dialled back at any time. **Shift +
  Step 16** cycles the clip through 0 % / the set default / 100 % and shows the
  choices for 1.2 s, with the jog picking between them while the panel is up.
  **QUANT** on the Clip page sets one clip; **QUANT** on the Set page sets the
  default new clips are created with. The default lives in a machine-level
  `prefs.json`, so it follows you into sets you have never opened.

- **Undo & redo.** **Undo** takes back the last edit and **Shift + Undo**
  redoes it, with an overlay naming what changed. Covers every musical edit —
  notes and steps, clip and bar operations, automation, tempo/swing/root/key,
  mute and volume, synth and LFO parameters, LFO assignments, and module or
  preset loads — while leaving navigation, transport and keyboard layout alone.

  One gesture is one undo rather than one per detent: a whole knob turn is a
  single entry, and each pass of live recording is its own, so two recorded
  loops take two presses to remove. An edit that changes nothing costs no
  press.

  The engine keeps snapshots addressed by id, so no state crosses IPC; chain
  parameters record their inverse at the write; module swaps dump the outgoing
  module's parameters and replay them once it is back. History is in memory,
  64 deep, per set. Engine `0.29.0` → `0.30.0`.

- **Capture.** Play freely, then press **Capture** to keep what you just played
  — Move's retroactive capture, notes only. Movy buffers live pad input
  whenever the track isn't recording; a capture while the transport runs lands
  the phrase where you heard it, and one made while stopped reads a tempo off
  your playing, sizes the clip, and starts the transport so you hear the take at
  once. Captured while the transport runs, a first take keeps the transport's
  tempo, keeps the beat it was played on, and launches on the bar like any
  other clip; an overdub joins the pass
  already running. Three tempo candidates are offered on screen in the big Set-page font
  and the jog applies each as you pass it. When the tempo isn't ours to set —
  Move is clocking us, or the clip already has notes — the take is fitted to the
  existing tempo through whichever reading is closest, so the stretch is the
  smallest one available. The buffer holds what you were *just* playing: replaying
  a spot the loop has already carried you past, every deliberate edit (arming, step entry, clip and
  automation edits), a track button, a transport edge, Session, two bars of
  silence and an 8-bar ceiling all clear it. Engine `0.29.0`.

  Hold **Clear** and press **Capture** to throw the buffer away by hand. Move
  puts that on Shift + Capture, but schwung's shim claims that combo for its
  skip-back recorder and never forwards it.

  *Prior art: schwung-davebox shipped capture on Schwung first. Movy's
  implementation is its own — davebox is PolyForm Noncommercial and Movy is MIT,
  so no code is shared; the behaviour follows Move's manual (§14.3) and the
  tempo estimator was written and tuned here.*

- **Step recording.** Hold **Rec** while the transport is stopped and play the
  pads to enter notes step by step, on melodic and drum tracks. Notes that
  overlap land on the same step, so chords need no modifier; the head advances
  when the last pad lifts. **Right** leaves a rest or ties the held chord into
  the next step, **Left** steps back and plays what is there ready to be
  replaced, and a step button jumps the head (clearing that step). An empty clip
  grows to exactly what you play, rests included; an existing one wraps at its
  end and overwrites. Melodic entry replaces the step, drum entry only adds its
  own lane, so kit patterns can be built up one pass at a time. A quick tap of
  Rec still arms live recording.

  ![Step recording](docs/assets/step_rec_header.png)

### Changed

- **Quantize (Shift + Step 16) no longer destroys recorded timing.** It sets a
  strength instead; 100 % reproduces the old behaviour exactly. The `quant`
  engine command is replaced by `cq` / `dq`.
- Clips saved before this release load at 0 % quantization, so existing sets
  play back exactly as they did.
- **A note added to an occupied step now joins what is already there.** Holding
  a step and pressing a pad used to place the new note hard on the grid with a
  one-step length, so a voice added to a chord played behind the beat and held
  for three steps started early and stopped short. It now takes the earliest
  start and the latest end of the step's notes — an exact copy when they agree —
  capped at the next note of the same pitch and at the clip end. Melodic view
  only: drum hits sharing a step are separate voices, not a chord. Also applies
  to the Loop-mode "add a pitch across a bar" gesture, per step.
- **Long lists no longer drag the UI.** An enum's options were re-classified by
  the shape/filter detectors on every frame — three full scans of the list per
  rebuild — so Surge's 274-option modulation pickers made the page behind the
  knob crawl. The classification is cached on the parameter now (a module swap
  rebuilds it, so nothing goes stale): a 1024-option page rebuilds ~50× faster.
  Opening the **file overlay** on a big sample folder ran five chained passes
  and an `os.stat` per entry; it is one pass now, and an entry matching the
  parameter's own extension filter is taken as a file unstatted — 1024 entries
  went from 8.7 ms and 1024 syscalls to 0.17 ms and none.

### Fixed

- **A pad still held when recording stopped was erased.** Ending a take on a
  sustained note — press Rec while the pad is down — discarded that note
  outright rather than shortening it, and stopping the transport mid-note did
  the same. Held notes now survive the stop and are written with the length
  they were actually played for, ending at the release or at the clip end,
  whichever comes first — so a long hold cannot wrap round the loop and drone
  on every pass. Recording itself still stops immediately: nothing played after
  the stop is captured. A note whose pad is never released is written when it
  reaches the clip end, and one held as Movy closes is finalized before the set
  is saved. The kept note also **sounds on the very next loop**: it is written
  on the same tick the wrap clears every note's play-once-later guard, so
  marking it like a freshly recorded note left it correct in the clip but
  silent for a whole pass.
- **Recording or capturing against swing lost the upbeats.** A note's step
  anchor was rounded against the straight grid, but swing moves an off-beat
  16th later inside its own cell — so on swing 70 there were only 4 ticks
  (~21 ms at 120 BPM) of late tolerance before an upbeat anchored to the
  following on-beat step. Quantization then snapped it onto the downbeat and
  the upbeat vanished. Anchors now round against the swung grid, at live
  recording and at both capture paths. (The mis-anchoring predates
  non-destructive quantization; it was inaudible while playback used the raw
  tick, showing only as a note on the wrong step LED.)
- **Note anchors are stored rather than re-derived on load.** The `cl` line is
  parsed before `cp` says what the clip's playback scale is, so a saved swung
  anchor could not be recomputed correctly. Notes gain a fifth `step` field;
  four-field notes from older saves fall back to the rounding that wrote them.
- **A note played just before the count-in ended was lost.** Live recording
  only began capturing when the count-in reached zero, so leaning into the
  first downbeat dropped the note entirely rather than misplacing it. Notes
  within half a step of the start are now recorded on the downbeat, keeping
  their true length.
- **The knobs no longer lock up.** After a while of ordinary use — adding and
  removing modules, editing steps — the encoders would stop changing anything
  Movy owns (tempo, clip length, step length) until Movy was closed and
  reopened. A step-button release that never reached Movy left it believing the
  step was still held, which routed every knob turn into step automation
  instead of the parameter under it, forever. The Leave-Movy menu no longer
  swallows releases, opening it forgets whatever was held, and pressing a step
  again recovers a release the host dropped. The Set and Clip parameter pages
  also now own their knobs ahead of a step hold, and an enum list left open by
  a missing release is dropped instead of blocking page changes.
- **The sequencer no longer gives up on its engine for good.** Three engine
  losses over a session — another tool can claim the device's single overtake
  DSP slot — each recovered at the time, added up to a permanent stop: every
  sequencer command silently dropped while the pattern kept playing. The
  retry budget is now per outage, and the back-off retries.
- **Track volume is usable at quiet settings.** Holding a track button and
  turning the volume encoder stepped a linear amplitude, so the fader ran out
  of resolution around −9 dB and the next detent cut to silence. One detent is
  now one dB across the whole range, and the slider reads out in dB as well as
  percent.

## [0.25.0] — 2026-08-01

### Added

- **Every parameter a module lists is now reachable.** A Schwung module gives
  each section both the eight parameters it binds to the encoders and the full
  list of parameters that section contains; Movy rendered only the former.
  Sections now continue onto `- 2` / `- 3` pages carrying the rest, and a
  section that binds no encoders at all gets a page instead of being skipped.
  That is **601 parameters across 43 modules** that previously existed only in
  Move's own module UI — including Osirus's ROM/model selector, OB-Xd's voice
  count and Surge's per-oscillator detail. Parameters a module reports as
  unturnable (one possible value) are left out rather than drawn as a dead knob.
- **Shift + jog wheel jumps between sections**, skipping a section's overflow
  pages — paging one at a time is slow on a 20-page module.
- **Asynchronous preset lists and option names are picked up.** Osirus scans its
  ROM after loading and reports an empty preset list and a `(loading)` option
  set until it finishes; Movy read those once and kept the placeholder for the
  session. It now re-checks for a few seconds and redraws as soon as the real
  names arrive.

### Changed

- **Parameter values on screen track the device faster.** The value read-back
  swept the whole parameter array one entry per tick, so a value's lag grew with
  the module's page count. It now interleaves the current page with that sweep —
  the same one read per tick, but what you are looking at converges in ~16 ticks
  instead of ~200 on a 25-page module.
- The first page of a multi-page section keeps its plain name (`Oscillators`
  rather than `Oscillators - 1`); overflow pages number from `- 2`.

- **Scales & pad layouts** — two new Set-page knobs shape the melodic grid.
  **MODE** picks Chromatic or **In Key** (the grid folds to the scale, so every
  pad is in key); **LAYOUT** picks the geometry, and its options follow MODE:
  *4ths* or *Piano* when chromatic, *4ths* (three scale degrees per row,
  Push-style) or *Inline* (one scale octave per row) when in key. The piano
  layout puts the white keys on rows 1 and 3 with the black keys offset right
  above them; its three gap pads per black row are dark and silent, and in-scale
  black keys take a dimmer tint so the keyboard shape reads.
- **Per-track octave** — **+ / −** now shifts only the active track's octave.
  Each track keeps its own, saved with the set, so it survives a device restart.

- **Action knobs** — a parameter a module marks as a one-shot action is drawn as
  a **circle in a box** rather than a knob. Firing blinks the circle and flashes
  that knob's LED; while spent the box goes dashed and a bar drains along the top
  showing when it re-arms on its own. The name under the icon highlights on touch
  like every other control. Previously these rendered as an ordinary enum cell
  reading `IDLE` forever, with no sign that anything had happened.
- **Module interaction metadata** — generic parameter pages recognise
  `idle`/`trigger` enums as one-shot actions (clockwise fires once,
  counter-clockwise returns to idle and re-arms) and respect
  `knob_acceleration: "wide"` for controls such as Smack's 1–9999 Seed.
- **Release contract fixtures** for Smack, Smack In, Belt, Belt In and Mono
  Voice. These replace older fleet-dump entries during regression tests, so a
  green suite covers the currently published parameter pages rather than stale
  module versions.

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
  solos that one; press again to un-solo. Solo is exclusive — soloing another
  track moves it. Solo overrides mute, so soloing a muted track makes it audible; the
  user's own mutes are captured when a solo engages and restored when the last
  one drops. Implemented entirely in Movy on the engine's per-track mute
  (nothing touches Schwung), so it gates sequenced notes — live pads on a
  silenced track still sound. The bookkeeping is saved per set, so a reopen
  cannot strand the derived mutes. Shift counts whether it goes down before or
  after Mute. Inactive in Session view, which has no current track.

- **Mute / solo toasts** — every mute or solo names the track (`T2 MUTED`) and,
  for solo, the resulting set (`T1 SOLO`, `SOLO T1 T3`, `SOLO OFF`).

- **The piano layout lights out-of-key pads dimly** instead of leaving them dark,
  so they can be told apart from the gap pads that play nothing at all. Which row
  a pad is in already says white key or black key, so the separate black-key tint
  is gone.
- **The chromatic 4ths layout's root moved to the 4th pad of the bottom row**,
  leaving three pads below the tonic instead of pinning it to the bottom-left
  corner.
- **The Set parameters page was rearranged** to TEMPO / SWING / LINK over
  ROOT / KEY / MODE / LAYOUT, grouping the four musical params on one row.
  LINK moved from knob 4 to knob 3, ROOT from knob 3 to knob 5, KEY from knob 4
  to knob 6.
- Sets saved before this change are migrated on load: the old absolute root note
  becomes a tonic plus an octave, and every track starts on that octave.

### Fixed

- **Move's own LEDs no longer bleed through Movy.** Movy declared a capability
  (`skip_led_clear`) dating from its first release, when it drew highlights on
  top of Move's clip colours. It has painted every pad itself for a long time,
  but the flag was still telling the host to let Move's LED writes reach the
  hardware — pads, step buttons, knob rings and RGB clip colours all repainted
  underneath Movy, and stuck, because Movy only sends colours that changed. It
  also made Movy's existing "suppress Move's RGB sysex" request a no-op, so
  that earlier fix never actually did anything.

  Movy now takes the LEDs outright. Two visible consequences: opening Movy
  briefly shows *Loading…* while the surface is cleared (~330 ms on current
  firmware), and leaving Movy hands Move its own LEDs back.

  > **Restart your Move after updating.** The host reads a module's
  > capabilities once per session and caches them, so this fix only takes
  > effect after a restart. Everything else in Movy updates normally.

- **LED ownership was lost after backgrounding.** Parking Movy with **Back**
  and returning to it left Move's RGB repaints fighting Movy's again: the host
  clears the suppression when a tool parks and never restores it, and Movy only
  asked for it at startup. Movy now re-claims it every time it comes back.

- **Knob-ring LEDs are no longer redrawn every tick.** They were force-written
  16 packets per tick to out-shout Move's repaints — with those repaints now
  stripped, an unchanged page costs nothing, freeing a quarter of the LED
  budget for the sequencer.

- **Switching tracks no longer floods the drum grid.** Movy re-sent all 32 drum
  pads every tick for 40 ticks after each track switch — about 1150 LED
  messages — so its grid would win the race against Move repainting the native
  pad layout. Movy owns those pads now, so one repaint does it: 66 messages.

- **Sets could be silently lost.** Movy's per-set autosave had five separate
  ways to throw work away, and the persistence layer has been rewritten around
  them.

  - *A screen freeze wiped the set.* When the sequencer engine stopped
    answering, Movy reloaded it — and a reloaded engine comes up **empty**.
    Nothing put the set back into it, so the next edit saved that blank engine
    straight over the file: reopen Movy and the set is a blank template. Movy
    now tracks which engine instance it restored and refuses to save one it did
    not, restoring from disk instead.
  - *Closing Movy dropped the last few seconds of edits.* The autosave runs on a
    timer and teardown did not flush, so anything done since the last tick was
    gone. Movy now saves on exit, after releasing any sounding notes.
  - *A crash or power-cut could truncate the state file.* The write was a plain
    truncate-and-rewrite with no rename and no `fsync`, and a half-written file
    still looked loadable — so it would come back as a *partial* set, or as a
    blank one. State files now carry a generation marker and a
    length + checksum trailer, and each save also goes to one of two rotating
    shadow copies, so a torn write costs at most the save being written. Files
    written by older Movy builds still load, and older builds can still read the
    new ones.
  - *A failed write vanished.* The engine clears its own "unsaved" flag as a
    side effect of Movy reading the state, so a write that failed was one
    nothing would ever ask for again. Writes are now confirmed by reading them
    back, and a failure stays pending until it succeeds.
  - *Edits could land in the wrong set.* If the file naming the active Move set
    was briefly unreadable — or named one of Move's transient placeholders while
    a set was being created — Movy treated that as a different set, saved into a
    scratch location, and discarded the work when the real set reappeared. An
    unreadable or placeholder set id now means "keep the current set".

- **Move's sequencer left stuck green step LEDs.** Move paints its RGB pads,
  steps and grid with cable-0 LED *sysex*, and full overtake does not strip that
  by default — only Move's note and CC LED writes. With the Play link on Movy
  keeps Move's sequencer running, so its repaints landed on top of Movy's and
  stayed: the LED layer only sends colours that changed, so a step Move painted
  was never corrected and its playhead green stuck there. Movy now opts into
  `shadow_set_overtake_suppress_sysex(1)`, which takes cable-0 sysex away from
  Move for the duration (schwung `docs/CORUN.md`); the framework clears it on
  overtake exit. Resending Movy's own colours cannot fix this — a peer that
  repaints continuously always wins the race.
- **A track could load silent and stay silent.** A clip selection persists even
  when it names an empty slot (launching an empty Session cell selects it), and
  Play starts a track only if its *selected* clip exists — so a set could restore
  with a track holding perfectly good clips that never sounded, and pressing Play
  again just repeated the result. On load, a selection pointing at an empty slot
  now falls back to that track's lowest real clip. A track with no clips at all
  keeps its selection, since there is nothing to fall back to and it is the right
  slot for the next recording. Live Session behaviour is unchanged — selecting an
  empty cell still stops the track.
- **A module could re-enable automation on a parameter the host cannot reach.**
  Global-bank parameters aren't addressable as chain `target:params`, so they
  can't be automated; module-supplied `automatable` metadata was overriding that
  guard and drawing a misleading automation dot. Only Movy's own config may
  override it now.
- **A fast knob sweep crossed a wide range in one flick.** The host accumulates
  knob detents and flushes one message per tick, so `knob_acceleration: "wide"`
  was multiplying an already-accumulated count — a quick spin moved Smack's Seed
  by 3000 of its 9999 range in about two ticks, putting the middle of the range
  out of reach. Acceleration now scales a single step.
- **A one-shot action could fire twice.** A hierarchy reload lands about a second
  after a module loads — exactly when you first reach for the knob — and it was
  clearing the gesture that keeps one turn to one fire. Gesture state now
  survives a reload of the same module.
- Module-owned `movy_config.json` layouts are now found beside audio FX and
  MIDI FX as well as sound generators, including audio FX loaded as Master FX.

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
