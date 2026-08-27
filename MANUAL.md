# Movy — Manual

This manual explains how to use **Movy**, an Elektron-style knob UI and 16-track
sequencer for Schwung on Ableton Move. For an overview and screenshots, see the
[README](README.md).

> **Movy is an early prototype.** Behaviour may change, and some things described
> here are deliberately minimal. If something doesn't work as written, that's a
> [bug report](#reporting-bugs) waiting to happen.

### A note on Move

Movy's sequencer is **deliberately aligned with Ableton Move's own sequencer**.
Rather than re-document everything Move already explains well, this manual:

- **points you to the official Move manual** for the shared concepts, and
- **focuses on what's different** — the Movy-specific gestures, the three new
  parameter pages, and the current limitations.

If you're new to Move's clips, Session view, recording, and automation, read the
official docs first:

- [Move manual (PDF)](https://cdn-resources.ableton.com/resources/pdfs/move-manual/1/2024-10-04/move1-manual-en.pdf)
- [Move beta release notes](https://www.ableton.com/en/release-notes/move-1-beta/)

---

## Contents

1. [Concepts & screen layout](#1-concepts--screen-layout)
   - [Opening Movy](#opening-movy)
2. [Parameter pages](#2-parameter-pages)
3. [The module chain](#3-the-module-chain)
4. [Keyboard & drums](#4-keyboard--drums)
5. [The sequencer (aligned with Move)](#5-the-sequencer-aligned-with-move)
6. [Beyond Move: Step, Clip & Set parameters](#6-beyond-move-step-clip--set-parameters)
6a. [Undo & redo](#6a-undo--redo)
7. [Limitations vs Move](#7-limitations-vs-move)
8. [Controls reference](#8-controls-reference)
9. [Troubleshooting & recovery](#9-troubleshooting--recovery)

---

## 1. Concepts & screen layout

Movy runs as a Schwung **tool** on top of Move. While it's open, Move's firmware
and the Schwung audio chain keep running underneath — Movy just takes over the
screen, pads, knobs, and buttons.

You're always working with **one of sixteen tracks** at a time — four groups of
four, where the first four are Schwung's own tracks and the other twelve are
chains Movy hosts itself ([Tracks and groups](#tracks-and-groups)). Either way a
track is a chain of up to four module slots, plus a per-track **LFO** page:

```
MIDI FX  →  SYNTH  →  FX 1  →  FX 2  →  LFO
```

### Opening Movy

For the first few seconds Movy shows **STARTING ENGINE**, then **LOADING SET**:

![Starting up](docs/assets/session_booting.png)

The pads, knobs and buttons are inert until it is done, and that is deliberate.
Everything you play or enter after that point belongs to the Set; nothing you do
before it can be lost. (**Back** always works, so a Movy that cannot start is
never a trap.)

If a Set's saved sequence cannot be read, Movy says so instead of starting
empty and letting you discover it later:

![Cannot load this Set](docs/assets/session_failed.png)

**Jog click** then starts that Set with an empty sequence. Movy does not do this
on its own — the unreadable file is left untouched, so it can still be recovered
from the device by hand. Your modules and their settings are Schwung's and are
not affected either way.

### Which Set your sequence belongs to

Movy stores one sequence per Move Set, and follows Move: pick another Set and
you get that Set's sequence, or an empty one if it has never had a sequence.
Deleting a Set in Move takes its Movy sequence with it — the Set Move creates in
its place starts blank, the same way its instrument slots do. Movy also clears
out sequences whose Set has been deleted the next time you open it.

Set pads you have never saved anything into from Move itself are a special case
worth knowing about. Move only writes such a Set to disk once *Move* has
something to save in it, and if you work entirely inside Movy it never does — so
neither Schwung nor Movy has a Set to file your work under, and **what you record
there will not be waiting for you next time**. This affects your instruments the
same way it affects your sequence, and it is the same on Schwung and davebox.
Recording anything into the Set from Move itself makes it real, after which
everything persists normally — and only a real Set can be renamed, copied or
backed up. (`docs/pending-sets.md` has the detail.)

The **screen** is the 128×64 OLED. A typical parameter page looks like this:

![Synth parameter page](docs/assets/obxd_main_page.png)

- **Header** (top): the track on the left (e.g. `T1`), the module/bank name on
  the right.
- **Knob row(s)**: up to 8 parameters, drawn as knobs with a value and a short
  label. The currently-touched knob shows its full value in an inverted style.
- **Page indicator**: a thin strip showing which page of the module you're on.

The general UI rule (borrowed from Move): **only controls that do something are
lit**. A dark button does nothing where you are; a dim one is waiting to be
pressed; and a button goes to full brightness while it's actively doing its job
— or simply while you're holding it down.

### The views

| View | What it shows |
| --- | --- |
| **Chain** | The current track's module slots (MIDI FX, Synth, FX 1, FX 2) and the LFO page; jog scrolls them. |
| **Knobs** | One module's parameter page; jog scrolls that module's pages. |
| **Keys** | The melodic keyboard (or a drum rack on drum tracks). |
| **Browse** | The module browser (pick a module to load into a slot). |
| **Session** | The clip grid for launching clips; also exposes the master FX chain (MFX 1-4 plus an LFO page). |

You move between Chain → Knobs by **clicking the jog wheel** to drill in, and
**Back** to step back out (and eventually out of Movy).

Not sure what the jog does on the page you are on? **Rest a finger on it** for
about a second without turning: a prompt at the bottom tells you what a click
will do there. Turning it (or letting go) dismisses the prompt, so scrolling
never puts it in your way.

---

## 2. Parameter pages

Movy reads each module's parameter hierarchy from Schwung and renders it
automatically. You don't configure anything for most modules.

- **Knobs / arc knobs** — continuous parameters are drawn as a circular knob
  with a pointer; the on-screen arc follows the value (including when automation
  moves it).
- **On/off switches** — a parameter with exactly two states — silence or
  sound, bypassed or engaged — is drawn as a **switch** rather than a dial or a
  word in a box. Off is a hollow pill with the knob to the left; on fills the
  pill and the knob moves right, so a page tells you what is engaged without
  reading a single label:

  ![Boolean knobs drawn as switches](docs/assets/switches.png)

  It covers both spellings of a boolean: a plain 0/1 parameter, and a two-item
  list whose options read *Off/On*, *No/Yes*, *Disabled/Enabled*. The order
  matters — a list that puts "on" first keeps its box, because a switch would
  then show the knob left while the module reports on.

  Two-item lists that are a **choice** rather than a state keep their box:
  *Free/Sync*, *Poly/Mono*, *Saw/Square*, *Digital/Analog*. Neither option is
  "off", so a switch would say something untrue. A momentary **action** — a
  randomiser, an init, a save — gets the trigger badge instead, since a switch
  would sit stuck on after one use.

- **Enum knobs & the enum overlay** — list-type parameters (waveforms, modes…)
  show the current choice in a square. Touching the knob opens a **full-screen
  scrollable list** so you can see all the options:

  ![Enum overlay](docs/assets/enum_overlay.png)

- **Waveform silhouettes** — when a list is a *waveform* picker, Movy draws the
  shape instead of an abbreviation, so a glance tells you what the oscillator is
  doing. It applies to plain single-knob waveform parameters — an oscillator
  wave, a modulation shape — not just LFOs:

  ![Waveform knob cells](docs/assets/wave_cells.png)

  The overlay lists the names with the same silhouettes beside them, so the
  mapping is learnable at a glance:

  ![Waveform enum overlay](docs/assets/wave_overlay.png)

  Stepped shapes carry their level count, so Helm's *3 Step*, *4 Step* and
  *8 Step* are three different pictures — and a stepped climb stays tellable
  from the same list's smooth *Saw Up*:

  ![Helm stepped waveforms](docs/assets/wave_helm.png)

  Some synths don't use a list at all — OB-Xd gives each oscillator separate
  **Saw** and **Pulse** on/off switches. Those draw the waveform too: **solid
  when it is sounding, dotted when it is not**, so you can see which shape each
  switch controls instead of a bare on/off bar. A *Mute* switch reads the other
  way round and is drawn accordingly:

  ![Waveform on/off switches](docs/assets/wave_toggles.png)

  Movy only does this when **every** option in the list has its own distinct
  silhouette. A list where several entries would be drawn identically — an
  Osirus wavetable list of *Wave 3*…*Wave 64*, where the names carry no shape
  at all — keeps its text, because one picture standing for several different
  waveforms is worse than the abbreviation it replaced. Lists that aren't
  waveforms (*Gate/Envelope*, *Off/On*) are untouched.

- **Lone attack / decay ramps** — a synth with a single **Decay** knob and no
  matching attack (drum modules, Plaits, the 303) draws that stage as a ramp
  instead of an arc, so a click and a long tail are told apart at a glance. The
  ramp's length is the value. **Attack is the mirror**: the rise climbs to the
  right. The dotted edge is the side this knob does not control:

  ![Lone attack and decay stages](docs/assets/env_stages.png)

  When a real envelope exists — an attack *and* a decay that belong together —
  the full envelope graphic below wins instead; the ramp is only for stages
  standing on their own. Reverb "decay" is a room size rather than an
  amplitude stage, so it keeps its knob.

- **Envelope graphics** — when a page contains a recognisable
  Attack/Decay/Sustain/Release group, Movy draws it as a **single envelope
  shape** instead of four separate knobs, which is far easier to read:

  ![Envelope graphic](docs/assets/env_dual.png)

  Shorter envelopes are drawn too: a two-stage **Attack/Decay** (or Attack/
  Release) becomes a two-cell graphic, and a three-stage **Attack/Sustain/
  Release** a three-cell one, leaving the other knobs on the line untouched.

  ![Two-stage AD envelope](docs/assets/env_ad.png)
  ![Three-stage ASR envelope](docs/assets/env_asr.png)

- **LFO waveform graphics** — when a page carries a module's own LFO, Movy
  pairs its **Shape** with one neighbour and reorders them onto the same line,
  drawing the two cells as a live **waveform preview** — sine, triangle, saw,
  square, sample & hold, noise, and more. The partner shapes the drawing:
  **phase** offsets it, **rate** sets the cycle count (1–2 cycles, so it stays
  readable), and **depth** its height; the LFO's deform/symmetry skews it and
  uni/bipolar flips the baseline. The other LFO knobs stay put.

  ![Module LFO waveform](docs/assets/lfo_mod.png)

  Modules name these things differently, and Movy reads the common variants —
  a rate called *Frequency*, a depth called *Amp*, a shape list using *Saw Up*
  or *Sample & Glide*, and keys that run the two together (`lfo1rate`). Helm's
  stepped families get their own silhouettes, drawn with the number of levels
  the name gives: **N Step** climbs in levels, **N Pyramid** climbs and falls
  again.

  ![Stepped ramp LFO](docs/assets/lfo_helm_step.png)
  ![Stepped triangle LFO](docs/assets/lfo_helm_pyramid.png)

- **Filter graphics** — when a page carries a **cutoff + resonance** pair, Movy
  reorders them onto the same line (cutoff, then resonance) and draws a live
  **filter-response curve** across the two cells. Read it left-to-right as
  frequency: the **corner sits at the cutoff** and **resonance is the size of
  the bump** at that corner. The shape follows the filter type — a low-pass
  passes the left and rolls off after the corner; a high-pass mirrors it; band-
  pass is a hump; notch a dip:

  ![Low-pass filter curve](docs/assets/filter_lp.png)
  ![High-pass filter curve](docs/assets/filter_hp.png)
  ![Band-pass filter curve](docs/assets/filter_bp.png)

  The type is taken from a `MODE`/`TYPE` enum on the page (turning it re-shapes
  the curve immediately), or from a filter-type control elsewhere in the module,
  or inferred from the parameter's own name (`lpf_`/`hpf_` etc.). A `SLOPE`
  control (12/24 dB) steepens the roll-off. Pages with two filters — e.g. a
  separate low-pass and high-pass — draw one curve per line:

  ![Two filter curves on one page](docs/assets/filter_dual.png)

- **Sample waveform** — a sampler that exposes a playback **position** together
  with its sample file draws them as one graphic: the waveform of the file
  (first channel), with the position marked. The marker is **inverted over the
  sample** — a bright line through a quiet passage, a dark notch through a loud
  one — so it stays the highest-contrast thing on the line wherever it sits:

  ![Sample waveform with position](docs/assets/wav_sample.png)

  The file is read a little at a time in the background, so a long sample fills
  in over a moment rather than stalling the knobs, and the result is kept until
  the file or its size changes. WAV (8/16/24-bit and float) and AIFF are both
  read; the waveform is normalised to the full height of the cell, so a quiet
  recording is as readable as a loud one.

  **Loop points** are drawn on the same waveform as brackets, where they fall in
  the file — the loop is a span you can see rather than two percentages:

  ![Loop brackets on the waveform](docs/assets/wav_loop.png)

  **Grain spray** (on a granular sampler) is drawn as the stretch of file the
  grains can reach around the position, dotted at its edges, so you can watch it
  widen and see when it has saturated the whole sample:

  ![Granular spray across the sample](docs/assets/spray_saturated.png)

- **Parameters that do not apply are hidden** — when a module says a control is
  inactive in the current mode, Movy takes it off the page instead of showing a
  dead knob, and the remaining graphics take back the room. Switching a sampler's
  loop off removes its loop start and end:

  ![The same page with the loop off](docs/assets/wav_loop_off.png)

- **Low cut / high cut** — a **Low Cut** and a **High Cut** on the same page are
  reordered onto one line and drawn as the band they leave behind; each corner
  follows its own knob. A cut with no partner keeps its own cell and shows just
  its corner — rising for a low cut, falling for a high cut:

  ![Low and high cut curves](docs/assets/cut_filters.png)

  Only a corner **frequency** qualifies. A filter *slope* (dB per octave), or a
  modulation *amount* aimed at a filter, keeps its knob — it moves the corner
  rather than being it.

- **EQ graphics** — when a page carries two or three **band gains** (low / mid /
  high, or a module's own names like *Body* and *Air*), Movy reorders them onto
  one line in frequency order and draws the **response curve** across them. The
  dotted line is 0 dB, so a cut reads as clearly as a boost: low and high are
  shelves, mid is a bell:

  ![EQ band curve](docs/assets/eq_bands.png)

  Only genuine **boost/cut** controls qualify — a band gain swings either side
  of zero. A crossover *frequency*, a per-band *Q*, or a low/high pair that is
  really a random range all keep their own knobs, because drawing an EQ curve
  for them would say something untrue.

- **Faders** — a knob that sets a **loudness** — a volume, a gain, an
  oscillator or send level — is drawn as a **fader** instead of a dial: a
  filled bar between two dotted rails, with a head marking the value. It fills
  from the bottom in every case, including a gain that runs either side of
  0 dB, so a glance across a page finds the levels without reading the labels:

  ![Loudness knobs drawn as faders](docs/assets/faders.png)

  Only a genuine output level qualifies. A *Level KF* (key-follow), an
  envelope's *Level*, a randomiser's *Rdm Vol*, a mod-matrix row aimed at a
  level, a compressor *Threshold* and anything measured in dB-per-something all
  keep their knobs — each is an amount of something else that happens to say
  "level".

- **Multiple pages** — modules with more than 8 parameters split into pages
  (`MAIN`, `PAGE 1`, `PAGE 2`, …). Scroll them with the jog wheel (or Left/Right
  when the sequencer isn't using those buttons). The line under the title is the
  page indicator, and it maps the sections rather than just counting pages: the
  pages of one section sit flush together, a one-pixel gap marks where the next
  section starts, and the current page is drawn taller. So a wide block means a
  section that spans several pages, and you can see at a glance which one you
  are in — the same grouping Shift + jog steps through. It always spans the full
  width, even on a module with 70 pages across 51 sections:

  ![Page indicator on a 70-page module](docs/assets/bankbar-dense.png)

**Every page a module offers.** Movy builds one page per section the module
declares, following both its own menu and any section it delegates to, however
deeply they nest. Param-dense synths therefore have a lot of pages — *Helm* has
30, *MiniJV* 49, *Dexed* 23 — all reached by scrolling. Two details keep that
readable:

- A section nested inside another is named `Parent/Child`, with the parent
  shortened to fit the header, so sibling sections stay apart (*Dexed*'s six
  operator envelopes read `Oper1/Envelope`, `Oper2/Envelope`, …).

  ![A nested parameter page](docs/assets/deep_page.png)

- A section that merely repeats another one's knobs is shown once, so modules
  that publish the same eight knobs twice no longer waste a page on it.

**The whole section, not just its eight knobs.** A module gives each section two
things: the eight parameters it binds to the encoders, and the full list of
parameters that section contains. Movy shows the eight first, then continues the
rest onto `- 2`, `- 3` pages under the same section name. That is what makes
*Osirus*'s ROM/model selector, *OB-Xd*'s voice count and *Surge*'s per-oscillator
detail reachable — several hundred parameters that were previously visible only
in Move's own module UI:

  ![A section's overflow page](docs/assets/params-overflow-page.png)

A section that binds **no** encoders at all now gets a page too, instead of
being skipped:

  ![A settings section built from its parameter list](docs/assets/params-extras-settings.png)

Parameters the module reports as unturnable (a single possible value) are left
out — a knob that cannot move is noise. Some modules publish their preset list
and option names a moment *after* they load (Osirus scans its ROM); Movy keeps
looking for a few seconds and redraws the pages as soon as the real names
arrive.

**Bank, soundfont and model selectors.** Some modules keep their sounds in
*collections* rather than one flat preset list — Dexed loads DX7 `.syx` banks,
OB-Xd loads `.fxb` banks, the SF2 player loads soundfonts, NAM loads amp models
and cabinets. Movy shows the current collection as its own cell **immediately
left of the preset knob**, so you can see which bank you are in without leaving
the page:

  ![The bank selector beside the preset knob](docs/assets/items_cell.png)

**Touch that knob** and the full list opens, exactly like the enum overlay —
turn to scroll, release to load:

  ![Choosing a bank](docs/assets/items_overlay.png)

Nothing is loaded while you scroll; only the release commits, because switching
a bank reloads a whole set of patches and resets the preset to the first one. It
counts as one undo step, and undoing it brings the module back as it was.

The list is re-read each time you touch the knob, so a bank you upload from
Schwung's web interface while Movy is open shows up straight away.

**Jumping between sections.** With many pages, stepping one at a time is slow:
hold **Shift** and turn the jog wheel to jump straight to the previous/next
*section*, skipping its overflow pages. Turning the jog wheel without Shift
still moves one page at a time.

Even a module that publishes no parameter hierarchy still gets pages — Movy lays
its parameters out in the order the module exposes them (this is what brings
modules like *Branchage*, *Smack-in* and *Belt-in* to life). When a parameter
also ships no range information, Movy shows a best-guess control and refines it
(for example to a whole-number range) the first time it reads the real value.

**Action knobs.** A module can mark a parameter as a one-shot *action* rather
than a value — Smack's Capture, Arm and Reroll, for example. Movy draws these as
a **circle in a box** instead of a knob, because there is no value to set:

![Action knob, ready to fire](docs/assets/trigger_armed.png)

Turn the knob **clockwise** to fire. The circle blinks and the knob's own LED
flashes, so you know it happened without watching the screen:

![Action knob firing](docs/assets/trigger_fired.png)

One turn fires **once**, however far you keep turning — a whole sweep of the knob
is a single action, not a burst of them. While it is spent the box goes dashed and
a small bar drains along the top, showing when it re-arms by itself:

![Action knob cooling down](docs/assets/trigger_cooling.png)

So there are two ways to fire again: turn **counter-clockwise** to re-arm
immediately, or just stop and let the bar run out. The name under the icon
highlights while you are touching the knob, exactly like every other control.

Wide-range controls can also opt into slow single-step turns plus fast
acceleration through the module's `knob_acceleration` metadata, so a 1–9999 seed
moves one step at a time when you turn deliberately and travels quickly when you
sweep.

**Curated layouts.** A few modules get a hand-tuned page layout so their controls
are grouped and named clearly, and so useful parameters the automatic layout
would hide become reachable. These include *Plaits*, *Wurl*, *Chordism*, *SFZ*,
*303*, *Chiptune* and *Hush1* (plus the drum modules). For instance, Chordism's
**Chord Multi** mode now reaches **all twelve** pitch classes — the automatic
layout could only expose the lower eight, so chords using the top four notes
(G♯, A, A♯, B) were previously impossible to build:

  ![Chordism Chord Multi](docs/assets/chordism-chordb.png)

Turning a knob edits the parameter live. Touching a knob (without turning) shows
its exact value at the top of the screen.

Knobs are normalised so a full sweep feels the same on every parameter whatever
its units — about a hundred clicks from end to end — and a parameter with
discrete values (an octave, a voice count, a mode) moves in whole steps instead.
Either way a click moves the same distance clockwise and counter-clockwise, and
turning faster covers proportionally more ground rather than less.

A parameter with only a handful of values — eight or fewer — takes four clicks
per step, so a five-position octave is no longer a quarter of its range per
click. On/off switches are the exception and still flip on a single click.

Octave offsets and voice counts are drawn as a framed number rather than an arc,
because an arc shows a position in a range and these are values you think of by
name. An offset shows its sign, so you can read `+2` or `-1` without touching the
knob:

![Step cells](docs/assets/test_steps.png)

Here `OCT` and `RNG` are octave offsets, `ARPOC` and `VOICE` are counts, and the
neighbours keep their usual shapes — `LEGAT` is a four-value mode, `BEND` an
on/off switch, `DETUN` a wide amount and `CUT` continuous.

---

## 3. The module chain

In **Chain** view you see the slots of the current track:

![Chain view](docs/assets/chain_synth.png)

- **Jog wheel** scrolls between slots (MIDI FX, Synth, FX 1, FX 2, and the LFO
  page).
- **Jog click** on a loaded slot **drills into** that module's parameter pages.
- **Jog click** on an empty slot — or **Shift + jog click** on any slot — opens
  the **module browser** to load/swap the module in that slot:

  ![Module browser](docs/assets/browse_view.png)

  Scroll with the jog wheel; click to load; Back to cancel.

- **Back** returns from a module's pages to the chain, and from the chain it
  exits Movy.

In **Session** view, the same navigation applies to a **master FX chain**
(MFX 1–4) that processes the whole mix, followed by a fifth **LFO** page — see
[The master chain's LFOs](#the-master-chains-lfos).

### Track volume

**Hold a track button and turn the volume encoder** to set that track's volume.
The range runs 0–400%, where **100% is unity** — the tick under the bar. Above
that you are boosting, so watch for clipping.

![Track volume](docs/assets/track_volume_unity.png)

**One detent is one dB**, the whole way down. The readout shows both the
percentage Schwung stores and the gain in dB, so quiet settings are as easy to
place as loud ones — from −9 dB there are another 39 steps before the fader
reaches silence at the bottom of its travel.

![Track volume, quiet](docs/assets/track_volume_quiet.png)

Whether you see *this* slider depends on Shift. Move's firmware takes over the
screen for as long as you are touching the volume knob, so:

- **Track + volume** — Move draws its own volume overlay. The track volume still
  changes; you just see Move's display of it. **Tracks 1-4 only** — see below.
- **Shift + track + volume** — Movy keeps the screen and shows the slider above.
  Works on all 16 tracks.

⚠️ **On tracks 5-16, use the Shift variant.** The plain gesture leans on telling
Move which track is held, and Move only has four track buttons — on a Movy-hosted
track it has nothing to be told, so the knob stays on Move's *master* volume.
Known limitation, not by design.

The value belongs to the track — a Schwung slot for tracks 1-4, Movy's own mixer
for 5-16 — and it survives leaving and re-entering Movy.

### The LFO page

The last page in the chain is **LFO** — two low-frequency oscillators that can
modulate any automatable parameter in the track's chain. Jog-click it to drill
in; the jog then scrolls between **LFO 1** and **LFO 2**.

![LFO page](docs/assets/lfo_lfo1.png)

Each LFO has eight controls:

| Knob | Control | Notes |
| --- | --- | --- |
| **RATE** | Rate | Free-running Hz, or a musical division when **Sync** is on. |
| **SYNC** | Sync | Free-running vs tempo-synced. When synced, the LFO **phase-locks** to the playing transport (see below). |
| **MODE** | Mode | Unipolar (`UNI`) or bipolar (`BI`). |
| **TARGET** | Target | The parameter this LFO modulates (see below); `✕` = none. |
| **SHAPE** | Shape | Sine / Tri / Saw / Square / S&H / Swishy. |
| **PHASE** | Phase | Start-phase offset, in 15° steps. |
| **RETRIG** | Retrigger | Reset the LFO on each new note. |
| **DEPTH** | Depth | Modulation amount. |

**Shape** and **Phase** are drawn together as a live **waveform preview**: turn
Shape to morph the wave, Phase to slide it along. A dotted baseline shows the
mode (centred = bipolar, along the bottom = unipolar), and a bold dot marks the
start when Retrigger is on.

**Synced LFOs phase-lock to the transport.** With **Sync** on, a running
transport drives the LFO's phase directly from song position — the cycle is
bar-aligned and stays drift-free no matter how long it plays. It follows
whichever transport is playing: Movy's own sequencer, or Move's native
sequencer when that is running. **Phase** then becomes a musical offset against
the bar. When the transport **stops**, the LFO keeps breathing — it free-runs
from where it was, at the tempo it was last playing (it does not snap to a
different rate). One caveat: changing the tempo *while stopped* doesn't change a
free-running synced LFO's rate until you play again.

You can pick an LFO's Target here (an overlay lists every modulatable parameter
in the chain), but the easy way is to assign it from the parameter itself:

### Modulating a parameter with an LFO

On any module's parameter page, **hold an (automatable) knob** for about a second
without turning it. A prompt appears at the bottom:

![Assign an LFO](docs/assets/lfo_assign_toast.png)

- **Turn the jog** to choose `LFO1` or `LFO2`.
- **Click the jog** to assign — that LFO now modulates the parameter, and you
  jump to its LFO page to set rate, shape, and depth.

Hold the same knob again to **remove** the modulation (or, from the other LFO,
add a second one to the same parameter). A modulated parameter shows a small
**`~` mark** by its label — alongside the automation dot if it's also automated:

![Modulation mark](docs/assets/lfo_mod_and_auto.png)

While a parameter is modulated its on-screen knob stays at your **base value** —
the LFO moves the sound, not the displayed knob.

Both work on **every track**, Schwung-backed (1–4) and Movy-hosted (5–16) alike.

### The master chain's LFOs

The master FX chain has an LFO page of its own, in the same place: the **fifth
slot**, after MFX 4. Jog to it in Session view and click to drill in.

![Master LFO page](docs/assets/lfo_master.png)

It works exactly like a track's, with two differences:

- **Targets are the four master FX slots** (and the other master LFO) rather
  than a track's chain — so an LFO here sweeps the whole mix's reverb or filter.
- **There is no Retrigger.** Nothing plays notes on the master bus, so the
  seventh knob is blank.

Hold-to-assign works here too: hold any automatable knob on an MFX slot's page
and click to modulate it.

These settings are saved with the Set by Schwung itself, so they survive a power
cycle.

---

## 4. Keyboard & drums

### Melodic keyboard

On a melodic track the 32 pads form a playable keyboard whose shape you choose:

![Keyboard view](docs/assets/keys_view.png)

- **+ / −** (Up/Down buttons) shift **the active track's** octave (in Session
  view they move between track groups instead). Each track
  keeps its own octave, saved with the set — so a bass part stays low when you
  come back to it, even after a device restart.
- The root note is shown in the header.
- Pads are coloured by the current key: the tonic takes the track colour, other
  in-scale notes light grey, out-of-scale notes stay dark.

### Pad layouts

Two knobs on the [Set parameters](#set-parameters--shift--step-5--7--9) page
(**Shift + Step 5 / 7 / 9**) decide the grid's shape:

![Set parameters — layout overlay](docs/assets/main-layout-overlay.png)

**MODE** picks the note set:

- **Chromatic** — every semitone is reachable; the KEY setting only colours the
  pads.
- **In Key** — the grid folds to the scale, so every pad is in key and a wrong
  note is impossible.

**LAYOUT** picks the geometry, and its options follow MODE:

| MODE | LAYOUT | Grid |
| --- | --- | --- |
| Chromatic | **4th** | +1 semitone per pad to the right, +5 (a fourth) per row up. The root sits on the **4th pad of the bottom row**, leaving three pads below it. |
| Chromatic | **Piano** | Rows 1 and 3 are the white keys (C–C), the row above each holds the black keys, offset right so a black key sits above the white note it leads into. Three pads per black row have no key and stay dark and silent. Two octaves on the grid. |
| In Key | **4th** | Three scale degrees per row up (Push's *In Key*), root bottom-left — the same fingering transfers between rows. |
| In Key | **Inline** | One scale octave per row, root bottom-left: `1 2 3 4 5 6 7 1`, with the next row starting an octave higher. |

Two details worth knowing:

- **Piano still honours KEY**, with three brightness levels so you can tell the
  cases apart: a **gap** pad (no key above it) plays nothing and stays dark, an
  **out-of-key** pad does play so it is lit dimly, and an **in-key** pad is
  bright. Pick the **Chromatic** scale to bring the whole keyboard up.
- **In Key + Inline steps by the scale's own degree count.** A seven-note scale
  gives exactly one octave per row; a five-note pentatonic gives five per row, so
  rows overlap slightly.

MODE, LAYOUT, ROOT and KEY are set-wide. Only the octave is per-track.

### Held notes stop when the context changes

A note played on a pad is released when you switch tracks, enter Session mode,
load a different module into the slot, change the octave/root, or mute that
track — it never keeps ringing on a track you have left. Closing Movy releases
everything, including whatever the sequencer was playing.

Playing pads over a muted track still works: muting only stops notes that were
already sounding, so you can keep jamming on a silenced track.

### Drums

When a **drum module** is loaded, Movy switches the pads to a **4×4 drum rack**
and the screen to drum-oriented parameter pages, including **per-pad pages** (a
page that controls just the selected drum voice — marked with a pad icon):

![Drum module page](docs/assets/drum-mrdrums-global.png)

On a **per-pad** (or per-voice) page, **press a pad to pick which voice you're
editing** — the knobs re-read that voice's values, and the pad icon in the
header tracks the selection. This lets multi-voice synths expose compact voice
pages instead of a page per voice. *Signal* (4 voices) works this way:

![Pad-selected voice page](docs/assets/signal_voice.png)

*Forge* takes it further: its **16 pads are a Kit A↔B performance grid** (lower
two rows = Kit A, upper two = Kit B; the *Morph* knob crossfades them), and
tapping any pad selects that voice for deep editing across six pages —
**Osc, Filter, Env, Mod, Setup, Send**:

![Forge per-voice Osc page](docs/assets/forge_voice.png)

The **Send** page holds the selected voice's mixer strip — **Reverb Send**,
**Delay Send** and **Pan**. On Kit A pads these are automatable like any other
per-voice parameter (classic per-step delay throws); Kit B pads can still be
edited, just not automated:

![Forge per-voice Send page](docs/assets/forge_send.png)

*Libpo32* (a PO-32 / Microtonic-style engine) gives all **16 voices** the same
treatment across **Osc, Mod, Noise and Voice** pages: pitch, decay, noise mix,
distortion and level are per-voice automatable, and the Noise page draws the
noise filter's response curve. Each voice is addressed by a fixed index, so
per-voice automation is playback-safe regardless of which pad last played.

Per-pad pages are not only for sample players and voice-cloned engines:
an **analog-style drum machine**, where every voice is its own circuit with its
own knobs (a kick that has Sub and Tube, a sampled cymbal that has neither), can
have one too — its layout lists each pad's parameters by name.

Because there's no other way to choose a drum type on the device, drum modules
rely on Movy's **layout templates**. Mr Drums, Weird Dreams, KrautDrums and
Signal ship Movy templates; Forge and Libpo32 are **self-describing** — they
carry their own layout in the module. Other drum modules may need one
contributed (see [CONTRIBUTING.md](CONTRIBUTING.md)).

---

## 5. The sequencer (aligned with Move)

Movy's sequencer is built to **feel like Move's**, across **16 tracks**. The
following all work essentially as they do on Move — refer to the
[Move manual](https://cdn-resources.ableton.com/resources/pdfs/move-manual/1/2024-10-04/move1-manual-en.pdf)
for the concepts:

- **Clips** — one clip per track slot; steps entered on the 16 step buttons.
- **Session view & clip launching** — press **Note/Session** to see the clip
  grid; pads launch clips. Hold it for a momentary peek; tap to latch.
- **16 tracks in four groups** — see [Tracks and groups](#tracks-and-groups)
  below.
- **Live recording** — **Rec** arms recording with a one-bar **count-in**; play
  the pads to record. Clips start only after the count-in. A note played
  slightly *ahead* of the final beat still lands on the downbeat rather than
  being dropped, so leaning into the first hit does not cost you the note.
  A pad still **held when you press Rec to stop** (or when you stop the
  transport) is kept, not discarded: recording stops there, but the note you
  are sounding is written with the length you actually play it for, so ending a
  take on a sustained chord keeps that chord. It ends at your release or at the
  **end of the clip**, whichever comes first — so however long you lean on the
  pad, it never wraps round the loop into a drone.
- **Metronome** — toggle with **Shift + Step 6**.
- **Step recording** — hold **Rec** while stopped and play the pads to enter
  notes one step at a time; see [Step recording](#step-recording) below.
- **Capture** — play first, keep it after: see
  [Capture](#capture--keep-what-you-just-played) below.
- **Step entry & editing** — tap a step to toggle a note; **hold a step** to edit
  it (and to open its [step parameters](#6-beyond-move-step-clip--set-parameters)).
  Adding a pad to a step that already has notes **joins what is there**: the new
  note takes the earliest start and the latest end of the notes on that step, so
  a voice added to a chord you played behind the beat sounds with the chord
  instead of snapping to the grid. It stops at the next note of the same pitch,
  or at the clip end. Drum lanes are exempt — hits sharing a step are separate
  voices, not a chord, so they keep the grid.
- **Note length** — **hold step A, then press step B** to set A's length up to B.
- **Loop / bars** — the **Loop** button turns the step row into a bar selector;
  **Left/Right** navigate bars. See [The Loop view](#the-loop-view) below.
- **Duplicate / delete** — **Copy** and **Delete** (a.k.a. Clear) act on steps,
  clips, or bars depending on context. **Hold Clear + a drum pad** wipes that
  pad from the whole clip — one lane emptied without touching the others,
  wherever its notes fall. A pad that plays nothing (outside the drum grid, or
  a gap in a piano layout) clears nothing.
- **Quantize** — **Shift + Step 16**. See [Quantization](#quantization).
- **Mute** — press **Mute** on its own to mute the current track; or hold
  **Mute** and press a track button to mute that one instead. Using the
  track-button form suppresses the current-track toggle, so one press never
  mutes two things. In Session view there is no current track, so Mute stays a
  pure modifier there.

  Both forms reach **any of the 16 tracks**. The track buttons address the
  focused group, so **+ / −** scrolls that quartet to the one you want. To skip
  the scrolling, use the step row: **hold Mute and the 16 steps become a mute
  map** — step 1 is track 1, step 16 is track 16, each lit in its track colour
  and **dim while it is silenced**. Press a step to mute or unmute that track.

  The map appears **wherever you are**: on the melodic or drum pads, in Loop
  mode, while step recording, and in Session view. Whatever the row was showing
  comes back the moment you let Mute go, and a step press that belonged to the
  map never enters a note. In Session view it works whether you latched the view
  with a tap or are just holding **Note/Session** for a peek; muting inside a
  peek does not latch it, so the view still reverts when you let the button go.
  Every form is a **latch**: press again to unmute, and how long you hold the
  button makes no difference.
- **Solo** — the same gestures with **Shift**: **Shift + Mute** solos the
  current track, **Shift + Mute + track button** solos that one, and
  **Shift + Mute + step** solos it from the mute map. Press again to
  un-solo. Solo is **exclusive** — soloing another track moves the solo rather
  than adding to it. **Solo overrides mute**,
  so soloing a track you had muted makes it audible; your own mutes are
  remembered underneath and put back exactly as they were when the last solo
  drops. Solo works by muting everything else, so it silences their *sequenced
  notes* — pads you play by hand on a silenced track still sound. Silenced
  tracks dim their track button like muted ones, and every mute or solo shows a
  toast naming the track (and the whole solo set, e.g. `SOLO T1 T3`). Shift can
  go down before or after Mute — either order works.

  **Seeing what is silenced.** A muted track wears its **dim** colour wherever
  it is drawn: its track button, its step in the track selector and the mute
  map, and its cells in the clip grid. Solo needs no colour of its own — it
  silences the others by muting them, so the map already shows it: one track in
  full colour, the rest dim. In the selector, mute and focus stack rather than
  compete — a muted track in the focused group still pulses, just to its dim
  colour, so the motion reads as focus and the brightness as mute. Clips keep
  their white playing/queued pulse when muted: the track is still running, and
  the grid is where you watch it run. Because only four track buttons are
  visible at once, the **Mute button itself lights bright** whenever anything is
  muted or soloed — the one always-visible cue that something is silent two
  groups away.
- **Automation** — turn a module knob while recording (or while holding a step)
  to record parameter automation; the on-screen knob arc follows the automation.

  ![Live automation](docs/assets/auto_live.png)

Because Movy keeps the module's parameters on screen during sequencing, some of
Move's full-screen sequencer displays are replaced by **LED feedback on the pads
and step buttons** plus a bar/position indicator and brief on-screen
announcements. The lighting follows Move's conventions (play = green, record =
red, only actionable buttons lit, the playhead sweeps the step row, etc.).

> **Note:** Movy's sequencer intentionally does **not** copy Davebox's timing
> where Davebox deviates from Move — the goal is to match native Move.

### Tracks and groups

Movy sequences **16 tracks**, arranged as **four groups of four**. The four
track buttons and the Session clip grid always address one group at a time —
the **focused** group.

**Picking a track.** In Session view the 16 step buttons become a **track
selector**: each step is one track, lit in that track's own colour. Two markers
sit on top of that, and they can point at different tracks — the **+ / −**
buttons move the group without changing which track is open.

- The **focused group's** four **pulse** between black and their colour, so you
  can see at a glance which quarter of the song you are in. It is the *position*
  of the pulsing block that tells you the group, not just its colour.
- **While you hold Note/Session**, the track you are currently on lights **solid
  white** — still, where everything near it is moving. It is a read-out you ask
  for by holding the button rather than a permanent marker competing with the
  pulse, and it stays visible even after **+ / −** has scrolled its group away.
  Let go, or latch Session view with a tap, and the white goes away.
- **Muted tracks** show their **dim** colour, which is what makes this row the
  place to read mutes: it is the only surface showing all sixteen at once. It
  composes with the pulse rather than replacing it, so a muted track in the
  focused group pulses to its dim colour. Hold **Mute** and the whole row
  becomes a **mute map** — here and in any track view, so you never have to come
  to Session view to silence something. See **Mute** in
  [The sequencer](#5-the-sequencer-aligned-with-move) above.

Press any step to **open that track**: the pads, the screen and the knobs all
switch to it immediately, exactly as if you had pressed its track button. It
behaves like a track button too — a quick **tap** stays there, while **holding**
the step is a peek that returns to Session view when you let go.

**Switching without leaving what you were doing.** **Hold Note/Session** and tap
a step. Movy drops straight onto that track — pads, screen, knobs — but the step
row *stays* a track selector for as long as you hold the button, so you can keep
tapping through tracks and auditioning them. Let go and you stay on the last one
you picked.

**Moving between groups.** In Session view the **+ / −** buttons step the
focused group through the track list: **+** moves towards tracks 1-4, **−**
towards 13-16 — the direction the grid reads on screen, not the direction the
group numbers count. They are dim while there is a group to move to and
dark at either end, the same way the arrows behave elsewhere. Moving the group
does not change which track is open — it re-aims the four track buttons and the
clip grid so you can reach the next four.

**Track colours.** Colours are chosen so the four tracks within a group are easy
to tell apart *and* so the same position in different groups never looks alike.
That takes eight colours, not sixteen: a colour reappears in another group, but
never in the same row or the same column, so two tracks you can see at the same
time never share one. Eight well-separated colours is also all this hardware
offers — the pale and cool ones wash out to white next to the lit in-scale pads.

**Tracks 5-16 host their own instruments.** Tracks 1-4 are the four Schwung
tracks and behave as they always have — they are Move's, and Move's mixer sees
them. Tracks 5-16 are movy's own: load a module onto one exactly as you would on
a track button track, and movy hosts the whole chain itself.

Two differences worth knowing:

- **Move's mixer sees all twelve as one channel.** Movy sums them into a single
  stereo output, so their levels are movy's own and the Move fader does not reach
  them individually. Set them with **Shift + hold track + volume encoder** —
  ⚠️ on tracks 5-16 the plain gesture *without* Shift does not work yet and moves
  Move's master volume instead, so use Shift there. Tracks 1-4 take either.
- **They sound only while movy is open** (or parked in Background mode). The
  four Schwung tracks keep playing under Move's own UI; movy's twelve stop when
  movy closes, because movy is what renders them.

Their modules and settings are saved with the set, so a movy track comes back
the way you left it.

### The Loop view

A clip's **loop window** is the range of bars that actually plays. It does not
have to start at bar 1 — you can loop bars 3–4 of an eight-bar part and leave the
rest in place, untouched, ready to come back to.

**Loop** shows the window on the step buttons: tap it to latch the view, or hold
it for a momentary peek. While it is up, the step row is a bar selector:

| Gesture | Result |
|---|---|
| Press a bar | View that bar (the step row follows) |
| **Double-tap** a bar | Loop just that bar |
| Press **two bars** | Loop the range between them, inclusive |
| Hold **Loop** + jog | Grow or shrink the loop by whole bars |
| **Shift + Step 15** | Double the loop — notes and length |

Setting a window brings the view with it, so you are never left editing a bar
that has just stopped playing.

**What the bar LEDs mean.** Every bar that matters fades in and out against black,
all of them in step with each other, and the colour tells you which is which:

| Bar | Appearance |
|---|---|
| Playing now | Green, pulsing |
| Selected (the bar on the step row) | White, pulsing |
| In the loop | Track colour, pulsing |
| Outside the loop | Near-black, steady |

The pulse comes from the hardware, so it keeps breathing while the transport is
stopped — which is exactly when you are looking at these.

Whether a bar contains notes is deliberately *not* shown — in this view a bar's
job is to tell you whether it plays. Press it to see its notes on the step row.

**On screen**, a band names the window and the bar you are on, and the strip
along the bottom draws one segment per bar of the loop — thick for the selected
bar — with a line sweeping across at the play position:

![The Loop view](docs/assets/loop_header.png)

Navigating past the end of the loop shows a **`+`** for the empty bar you have
stepped into. Add a note there and it becomes part of the loop, so a part grows
by simply playing into the next bar:

![Navigated past the loop](docs/assets/loop_strip_outside.png)

### Quantization

Quantization in Movy is a **value, not an action**. Every clip carries a
strength from 0 to 100 %, applied as notes are played rather than by rewriting
them, so the timing you recorded is never destroyed and you can dial it back at
any time.

- **0 %** — the take plays exactly as you played it.
- **100 %** — every note lands dead on the step grid.
- In between, notes are pulled toward the grid by that fraction. 60–80 % tightens
  a take without flattening the feel out of it.

**Shift + Step 16** cycles the current clip through **0 % → the set default →
100 %**, and shows the choices for a moment. `DEF` marks the default:

![Quantize overlay](docs/assets/quant-overlay-three.png)

While the panel is up the **jog** picks between the same values, and **Back**
closes it. Playing pads or entering steps does not disturb it. When the default
is already 0 or 100 there are only two values to cycle.

For anything other than those three, **QUANT** on the
[Clip page](#clip-parameters--shift--step-3) sets the clip directly:

![Clip quantize](docs/assets/clip-quant.png)

**QUANT** on the [Set page](#set-parameters--shift--step-5--7--9) sets the
**default** — the strength new clips are created with, so a take you record gets
your preferred tightness immediately. Changing it never re-times clips that
already exist; each clip owns its own value from the moment it is created.

![Default quantize](docs/assets/main-quant.png)

The default follows you into **new sets**, so it is a preference you set once
rather than per project. Clips from sets made before this existed load at 0 %,
so an older set sounds exactly as it always did.

Notes entered on the step buttons are already on the grid, so quantization has
no effect on programmed patterns — only on what you play in. **Swing is
independent**: it applies at full strength whatever the quantization is.

### Step recording

Hold **Rec** while the transport is stopped and play the pads: each note lands
on the record head and the head moves on. Nothing is timed, so a phrase you
could never play in real time goes in as fast as you can find the notes. It
works the same on melodic and drum tracks.

Notes that overlap land on the **same step** — hold a chord and it is entered as
a chord; the head only advances when the last finger lifts. Tap notes one at a
time and each gets its own step.

While Rec is held:

| Control | Action |
| --- | --- |
| **Pads** | Enter notes at the head. |
| **Right** | Leave a rest — or, with pads held, **tie** the chord into the next step. |
| **Left** | Step back: the note there plays and its pads light, ready to be replaced. With pads held, **untie**. |
| **Step button** | Jump the head there; if that step had notes, it is cleared. |
| **Release Rec** | Done. |

The head blinks red on the step row and the screen shows the position and the
notes under it, with the module's parameters still visible underneath — so you
can keep tweaking the sound while you enter the part. The **Left/Right arrows
blink** while they are worth pressing: Right always, Left once there is a step
to go back to or a tie to undo.

![Step recording](docs/assets/step_rec_header.png)

On an **empty clip** the clip grows to exactly what you play, one step at a
time, rests included — play seven notes and you get a seven-step clip. On a clip
that already has notes the head **wraps** at the end and overwrites, leaving the
length alone.

Entering notes **replaces** what is on the step on a melodic track, so stepping
back and replaying overwrites cleanly. On a drum track pads only **add** their
own lane, so you can lay the kick down in one pass and the snare in the next.

A quick **tap** of Rec still arms live recording as before — only holding it
starts step recording.

### Capture — keep what you just played

Movy is always listening. Everything you play on the pads while that track
isn't recording goes into a buffer, so when something comes out right you can
keep it after the fact: press **Capture**. The Capture button is lit whenever
there is something buffered worth keeping.

Capture writes into the **current track's current clip**. What happens depends
on the transport:

| Transport | Clip | What you get |
| --- | --- | --- |
| Playing | empty | The phrase you just played, keeping the tempo and the beat you played it on, with the clip grown to whole bars around it. It falls in **on the bar**, like any other clip launch, so it lines up with your other tracks. |
| Playing | has notes | An overdub: each note lands where you heard it, and the clip keeps its length. |
| Stopped | empty | A new take — Movy reads a tempo off your playing, sizes the clip, and starts the transport so you hear it at once. With no transport running there is no beat to hold on to, so here the first note you played *is* the start of the clip. |
| Stopped | has notes | The take is fitted to the tempo you already have (see below). |

After a **stopped** capture the screen shows what happened and stays until you
press something:

![Capture tempo selector](docs/assets/capture_select.png)

Three tempos, the applied one boxed. **Turn the jog** to take another — it is
applied as you pass it, and the transport keeps rolling, so you can hear which
one fits. The bar count in the corner follows: the same performance is more bars
at a faster tempo, and it always plays back at the speed you played it. **Any
button, pad or knob closes the overlay.**

When the tempo isn't Movy's to set — because Move is clocking us, or because
you captured into a clip that already has notes — there is nothing to choose,
and the overlay explains the fit instead:

![Capture fitted to the set tempo](docs/assets/capture_fixed.png)

Movy still reads a tempo off your playing, then stretches the take onto the
tempo you have. It picks whichever reading is closest, including half and double
time, so the stretch is always the smallest one available — a phrase played at
58 BPM against a 120 BPM set is fitted through 116, not doubled.

**What clears the buffer.** Capture keeps what you played while you were *just
playing*, so anything that means you have moved on empties it — the Capture
button goes dark when it does:

- **Play or Stop**, and **pressing a track button**.
- **Playing over a spot you already covered**, once the loop has come round —
  that means you are redoing that part, so the earlier pass goes and Capture
  takes the one you just played. Notes that land somewhere new keep
  accumulating, so a phrase that runs across the loop end stays whole.
- **Any deliberate edit** — arming Rec, entering or editing steps, changing the
  clip length or loop, launching or deleting a clip, editing automation.
- **Switching to Session.**
- **Time**: a couple of bars of silence, and in any case only the last
  **8 bars** of playing are ever kept. Without that ceiling, playing without
  pausing for a minute would capture the whole minute.

To throw it away by hand, hold **Clear** and press **Capture**.

> **Not Shift + Capture.** Move clears the input that way, but on Schwung that
> combo belongs to the skip-back recorder and never reaches Movy — you would see
> "skipback saved" and the buffer would still be full. Hold **Clear** instead.

> **Not captured:** knob moves. Move captures automation too; Movy captures
> notes only. Record automation live instead (see the sequencer list above).

### Saving — there is no Save button

Movy saves by itself, and there is deliberately nothing to press. Your
sequence, tempo, swing, automation and the Set-page settings (tonic, scale,
mode, layout, per-track octave, mutes) are stored **per Move set**, so every set
recalls its own Movy project. Switch sets on Move and Movy follows.

Saving happens a few seconds after you stop changing things, when you switch to
another set, and when you close Movy — so leaving immediately after an edit
keeps it. Nothing is written when nothing has changed.

Each set keeps a couple of rotating backup copies of its sequence alongside the
main file. If the Move loses power or a crash interrupts a save, Movy detects
the damaged file on the next load and falls back to the newest intact copy
rather than opening a blank template. Sets saved by older Movy versions load
normally.

Movy stores only sequencer data. Which instrument is on each track and how it's
set up belongs to Schwung and the Move set, and is saved by them.

### Background mode — keep playing under Move's UI

Movy can drop into the background and keep sequencing while you use Move's own
screens (Session, Note, the mixer, etc.). Because the sequencer engine and its
clock keep running, tempo-synced LFOs stay phase-locked the whole time.

Pressing **Back** at the **root** view (the chain page) opens a **Leave Movy**
menu — it does *not* leave instantly, so you can't drop into the background by
accident:

![Leave Movy menu](docs/assets/leave_modal.png)

- **Background** (highlighted by default) — jog-**click** to park Movy: the
  screen returns to Move but Movy keeps playing. So backgrounding is **Back then
  jog-click**. Held pad notes are released when the menu opens so nothing hangs.
- **Close Movy** — jog-**turn** to it, then jog-click, to fully unload Movy.
- **Back** again **cancels** and returns you to Movy.

**The rest of the instrument keeps working while the menu is up.** Playing a
pad, hitting a step, changing track, Clear, Capture, octave up/down, Copy,
Delete, Mute, Loop, the arrows — all of them **dismiss the menu and still do
their job**, so a menu you opened by mistake never costs you a press. Two
deliberate exceptions:

- **Shift**, **Play** and **Rec** work *without* closing the menu. Shift is a
  modifier, so it has to stay one; and stopping the music before you park isn't
  a change of mind.
- The eight **parameter knobs** stay inert. The menu covers the screen, so a
  knob edit behind it would be one you couldn't see happen — and unlike a pad
  or a step, a knob gives you nothing else to notice it by.

(Back still steps *backwards* through Movy's own sub-views — the browser,
keyboard/knob pages, the master-FX detail, and the Step/Clip/Set pages — as
usual; the menu only appears when you press Back at the root.)

- **Return from background:** reopen Movy from the Tools menu (or the last-tool
  shortcut). The screen and LEDs repaint from the current state; the sequence
  never stopped.
- **Fully exit instantly:** **Shift + Back**, from anywhere, unloads Movy
  without the menu.

> **Host requirement:** the Background option needs a Schwung host that supports
> self-managed suspend. On an older host the menu shows **Close Movy** only.

### Syncing with Move's sequencer

Turn on **LINK** (the Set page's fifth cell — knob 4; **OFF** by default) and
Movy and Move share **one transport**: press Play (or Stop) on **either** and
both start (or stop) together, making Movy four extra tracks of your Move set.
This is what makes background mode musical: run Move's sequencer and Movy rides
along, locked. The setting is saved with each set.

![Set page — LINK on](docs/assets/main-link-on.png)

With **LINK on**:

- **Play in Move** starts Movy too (even while Movy is parked in the
  background); **Stop in Move** stops it.
- **Play in Movy** starts Move too. Because Move aligns its start to the Link
  bar grid, Movy waits — silently — up to about a bar for Move's downbeat, then
  both begin the bar together. (If Move never answers within ~2 bars, Movy
  starts on its own clock anyway.) **Stop in Movy** stops Move.

With **LINK off** (the default) each transport is independent — Movy's Play/Stop
never touches Move's, and Move's never starts or stops Movy. The tempo/grid
locking below still happens automatically whenever both are playing, LINK or not.

While both run, they lock as one grid:

- Movy rides Move's clock, so both grids stay **drift-free** — their downbeats
  line up and stay lined up. The Set page's **TEMPO** cell shows **EXT** and
  displays Move's tempo:

  ![Following Move — EXT](docs/assets/main-ext-sync.png)

- Pressing **Play in Move** re-anchors Movy to the bar — Movy restarts its
  pattern so both start the bar together.
- **Change Move's tempo** (from Move's screen) and Movy follows within about a
  second; the notes stay locked.
- **Turn Movy's TEMPO knob** and Move's tempo changes to match — Movy writes the
  device-wide tempo, and both stay locked. (The display may rubber-band briefly
  as the two converge — that's normal.)
- If Move's clock simply **drops out** (a glitch, not a Stop), Movy keeps
  playing at the captured tempo on its own clock; within a bar the synced LFOs
  re-lock to Movy's grid.

**Working with one transport (LINK on):** for **Movy-only** playback, keep the
native Move set silent (no clips playing). For **Move-only** playback, stop or
mute Movy's tracks individually. (The link propagates the Play/Stop
*buttons*; launching a Session clip does not reach across to Move.)

> **Tempo & Ableton Link:** Movy's TEMPO knob sets the device tempo through
> Move's Link connection, which only takes effect while Move is the sole Link
> peer. With Ableton Live (or another Link peer) connected, the session owns the
> tempo and Movy's knob won't override it — which is the correct behaviour. It
> also requires schwung's **Link Audio** to be enabled (Global Settings → Audio);
> with Link Audio off the knob can't reach Move's tempo, so set the tempo from
> Move instead. (Move → Movy tempo follow is unaffected — it always works.) See
> [docs/tempo-knob-move-override-not-applied.md](docs/tempo-knob-move-override-not-applied.md)
> for details.

---

## 6. Beyond Move: Step, Clip & Set parameters

These three pages add control Move doesn't expose on-device. Each opens with a
**Shift + Step** combination (or, for step parameters, by holding a step).

### Step parameters — per-trig locks

**Hold a step** that has a note. While held, **page 0** becomes the **Step**
page, showing that trig's intrinsic properties on the knobs:

![Step parameters](docs/assets/step_page_knobs.png)

| Knob | Parameter | Notes |
| --- | --- | --- |
| 1 | **VEL** | Velocity for this trig. |
| 2 | **LEN** | Note length. |
| 3 | **PROB** | Probability the trig fires (0–100%). |
| 4 | **COND** | Trig condition (e.g. `2:3` = fire on the 2nd of every 3 cycles). |
| 5 | **INV** | Invert — flips the condition. |

This is Movy's take on Elektron-style **parameter locks**: a per-step,
per-parameter override. (While a step is held, jog/Left/Right can still roam the
module pages so a single held step can automate across the chain.)

### Clip parameters — Shift + Step 3

In Track view, **Shift + Step 3** opens the **Clip** page for the active clip:

![Clip parameters](docs/assets/clip-default.png)

| Knob | Parameter |
| --- | --- |
| 1 | **SCALE** — the clip's musical scale. |
| 2 | **LEN** — clip length in steps. |
| 3 | **TRANS** — transpose. Reads `n/a` on a drum track (see below). |
| 4 | **QUANT** — [quantization strength](#quantization) for this clip, 0–100 %. |

(Clip parameters apply to a single clip, so this page is Track-view only.)

On a **drum track**, transpose is unavailable — the cell reads `n/a` and the knob
does nothing:

![Clip parameters on a drum track](docs/assets/clip-drum.png)

A drum module's pitches are pad addresses, not notes, so shifting them fires a
different pad — or, if the shift lands outside the module's pad range, nothing at
all. The sequencer ignores clip transpose on those tracks, including for a clip
that already carried one from before a drum module was loaded onto the track.

### Set parameters — Shift + Step 5 / 7 / 9

**Shift + Step 5, 7, or 9** opens the global **Set** page:

![Set parameters](docs/assets/main-default.png)

| Knob | Parameter |
| --- | --- |
| 1 | **TEMPO** |
| 2 | **SWING** |
| 3 | **LINK** — Play/Stop propagation to Move |
| 4 | **QUANT** — the [quantization](#quantization) new clips are created with |
| 5 | **ROOT** — the tonic's pitch class |
| 6 | **KEY** — scale |
| 7 | **MODE** — Chromatic or In Key |
| 8 | **LAYOUT** — the pad grid's shape |

KEY, MODE and LAYOUT each open a scrollable list (the same enum overlay used
elsewhere):

![Set parameters — key overlay](docs/assets/main-key-overlay.png)
![Set parameters — mode overlay](docs/assets/main-mode-overlay.png)

MODE and LAYOUT are covered in [Pad layouts](#pad-layouts).

These are set-wide (they affect all tracks). **TEMPO** also sets Move's
device-wide tempo through Ableton Link, so a following Move tracks the knob;
the cell shows **EXT** while Movy is locked to Move's transport (see
[Syncing with Move's sequencer](#syncing-with-moves-sequencer)).

Press **Back** to close any of these pages and return to where you were.

The Clip and Set pages sit **side by side, not stacked**: opening one while the
other is up *replaces* it, so a single **Back** always leaves for the view you
started from — never for the other page. Switching tracks or going to Session
view closes them as well, so neither page follows you around.

---

## 6a. Undo & redo

Press **Undo** to take back the last edit; **Shift + Undo** redoes it. An
overlay names what changed, where, and which way — the value on the right of
the arrow is what it is *now*, so the same reading works for both:

    UNDO                    REDO
    CUTOFF                  CUTOFF
    T1: 0.31 -> 0.42        T1: 0.42 -> 0.31

![Undo toast](docs/assets/undo_toast.png)

**What's undoable.** Everything that changes the music: notes and steps, clip
clear / delete / copy / paste / duplicate, clip scale, length and transpose
(each its own undo, committed when you let the knob go), loop length and start, per-step trig
properties, automation (locks, lane values, clearing a lane or a step),
tempo, swing, root and key, track mute, solo and volume, synth and LFO
parameters,
LFO assignments, and module or preset loads.

**What isn't.** Anything that only changes what you're looking at — selecting a
track or clip, moving between bars or pages, Session mode, the browser — plus
Play, Rec, the metronome, **LINK**, and the keyboard layout. Undo is for edits,
not for navigation or performance.

**How edits are grouped.** One gesture is one undo, not one undo per detent:

- Turning a knob is a single entry however far you turn it, from where the knob
  started to where you let go.
- Each pass of live recording is its own entry — record over two loops and it
  takes two presses to remove both.
- Everything else — a step press, a clear, a paste — is one entry each.

An edit that changes nothing costs no press: turn a knob up and back down
before releasing it and there is nothing to undo.

Undoing a module load brings the old module back **with its settings**, taken
from the module's own saved state — the same snapshot Schwung uses for its
module presets. Adding and removing a module are undoable the same way.

Changing a **preset** is undone the same way, so tweaks you made after loading
it are not lost: undoing returns the module exactly as it was, rather than
re-applying the old preset from scratch. Redoing picks the preset again, which
is what you did the first time.

**What Undo can't reach.** Worth knowing before you rely on it:

- **Octave** (the +/- buttons) isn't undoable — it's treated as a live
  performance control. Root, scale, mute and solo all are.
- **Parameters something else is driving** — one with an automation lane, or one
  a track LFO is modulating — are left out of a module restore. Their on-screen
  value belongs to Movy and the sounding value belongs to the engine, so there
  is no single number to put back. Undo restores everything around them.
- **A module's hidden state.** Undoing a module load restores what the module
  itself reports; anything it doesn't publish — a sample's contents, a parameter
  absent from its list — can't come back.
- **Parameters the module derives** rather than stores will not hold a restored
  value. Movy rewrites them a few times and then leaves them.
- **Nothing outside Movy.** Edits made in Move's own UI while Movy is parked in
  the background are invisible to it. If a module changed underneath, Movy drops
  its history rather than apply it to the wrong thing, and says so.
- **The oldest edits fall off.** History holds 64 entries (and a memory budget);
  past that the oldest are discarded, and undoing that far back does nothing.
- **A no-op costs nothing.** Quantising an already-quantised clip, or a knob
  turned back to where it started, records no entry — so Undo will name the edit
  before it. That's deliberate.

**Limits.** History lives in memory and is cleared when you switch sets or
close Movy. It holds the last 64 edits. Undoing a module load restores the old
module and its parameters, but anything Movy never sees — a loaded sample's
contents, a parameter the module doesn't publish — can't come back. If a module
is changed outside Movy while it's parked in the background, the history is
dropped rather than applied to the wrong thing, and the overlay says so.

![Undo unavailable](docs/assets/undo_unavailable.png)

---

## 7. Limitations vs Move

Movy aims to match Move, but it's an early prototype and several things are
missing or simplified. **All of these are candidates for future work — and
[contributions are welcome](CONTRIBUTING.md).**

- **No automation capture.** [Capture](#capture--keep-what-you-just-played)
  keeps notes; knob moves made before you press it are not captured. Record
  automation live instead.
- **Schwung tracks only.** Movy sequences its own 16 chains — not Move's native
  instruments, drum racks, or sampler.
- **The CPU runs out long before 16 tracks do.** Move will typically give up
  somewhere around 6-7 tracks of ordinary synth modules playing notes. Pick
  cheap modules and it goes much further — 16 tracks of Dexed playing 2-4 notes
  each, with mverb on half of them, does run. Treat 16 as a ceiling to explore,
  not a promise.
- **Track + volume needs Shift on tracks 5-16** (see
  [Track volume](#track-volume)).
- **Movy-hosted tracks are silent while Movy is closed.** Tracks 1-4 keep playing
  under Move's own UI; 5-16 need Movy open, or parked in
  [Background mode](#background-mode--keep-playing-under-moves-ui).
- **Simplified clip model.** Sequencer resolution and some clip-level features
  are reduced compared to Move.
- **Rough edges.** Expect occasional display glitches or, rarely, a crash that
  needs a [recovery](#9-troubleshooting--recovery).

If a missing feature matters to you, please open an issue describing the Move
behaviour you'd like — or, better, a PR.

---

## 8. Controls reference

### Parameter / chain views

| Control | Action |
| --- | --- |
| **Knobs 1–8** | Edit the current page's parameters. Touch (no turn) shows the exact value. |
| **Turn an action knob clockwise** | Fire a one-shot action (Capture, Reroll, …) once per turn, however far you keep turning. The circle blinks and the knob LED flashes. |
| **Turn an action knob counter-clockwise** | Re-arm it immediately instead of waiting for the drain bar to run out. |
| **Touch a bank / soundfont / model knob** | Open the collection list. Turn to scroll, release to load — scrolling on its own loads nothing. |
| **Hold a knob (~1 s)** | Assign that parameter as an **LFO target**: jog picks LFO 1/2, jog-click assigns (hold again to remove). Automatable parameters only. |
| **Jog wheel — turn** | Scroll chain slots (Chain view) or module pages (Knobs view) / browser list. On either LFO page — a track's or the master chain's — scroll between LFO 1 and LFO 2. |
| **Jog wheel — click** | Drill Chain → module pages; on Knobs (or an empty slot) open the module browser; in a browser, load the selection. |
| **Shift + jog wheel — turn** | Knobs view: jump to the previous/next **section**, skipping that section's overflow pages. |
| **Hold the jog (~1 s)** | Touch without turning: a bottom prompt spells out what a click does on this page. A turn or release clears it. |
| **Shift + jog click** | Open the module browser to swap the current slot's module. |
| **Back** | Module pages → Chain; browser → cancel; **at the root (Chain) → open the Leave Movy menu** (Background / Close Movy). |
| **Back then jog-click** | From the root: background Movy (keeps playing under Move's UI). |
| **Shift + Back** | Fully exit Movy (unload), instantly, from anywhere. |
| **Anything** (Leave menu up) | Dismisses the menu *and* does its normal job — pads, steps, Track, Clear, Capture, octave, Copy/Delete/Mute/Loop, arrows. |
| **Shift / Play / Rec** (Leave menu up) | Run normally *without* closing the menu. |
| **Parameter knobs** (Leave menu up) | Inert — the menu covers the screen, so the edit would be invisible. |
| **Hold track + volume encoder** | Set that track's volume (0–400%, 100% = unity, 1 dB per detent). Add **Shift** to see Movy's slider instead of Move's native overlay. |
| **+ / −** (Up/Down) | Shift the **active track's** octave (melodic tracks only). Each track remembers its own, saved with the set. In **Session** view they step the focused **track group** instead (**+** towards tracks 1-4, **−** towards 13-16). |

### Sequencer

| Control | Action |
| --- | --- |
| **Step buttons 1–16** | Toggle a note on/off at that step. In **Session** view they select one of the 16 tracks and open it — tap to stay, hold to peek. |
| **Hold a step** | Edit that step; opens its **Step parameters** (page 0). |
| **Hold step A + press step B** | Set step A's note length up to B. |
| **Hold a step + pad** | Edit that step's notes from the keyboard. An added note takes the step's existing start and length (melodic only). |
| **Play** | Start / stop the transport. When **LINK** is on, also starts / stops Move's native sequencer (a Movy-initiated start waits ~1 bar for Move's Link grid). |
| **Rec** (tap) | Arm recording (one-bar count-in). Tapping again stops; a pad still held is kept and gets its full played length. |
| **Hold Rec** (stopped) | **Step recording** — play the pads to enter notes step by step. |
| **Hold Rec + pads** | Enter a note or chord at the head; the head advances when the last pad lifts. |
| **Hold Rec + Right / Left** | Rest / step back — or tie / untie the chord being held. |
| **Hold Rec + step button** | Jump the head to that step, clearing it if it had notes. |
| **Capture** | Keep the notes you just played as clip data. Stopped → also reads a tempo and starts the transport. |
| **Clear + Capture** | Throw the buffered input away. (Not Shift + Capture — that belongs to schwung's skip-back and never reaches Movy.) |
| **Jog** (capture overlay) | Take another tempo — applied as you pass it. Any other press closes the overlay. |
| **Note / Session** | Show the Session clip grid (momentary hold = peek, tap = latch). Pads launch clips; step buttons select a track. Dim when idle, bright while Session view is up. |
| **Hold Note/Session + step** | Jump to that track (pads, screen, knobs) while the step row stays a track selector — keep tapping to keep switching. Releasing keeps the last track you picked. |
| **Loop** | Toggle the bar selector; hold + jog resizes the loop. See [The Loop view](#the-loop-view). |
| **Loop + bar** | Press one bar to view it, two to loop that range, double-tap for a 1-bar loop. |
| **Left / Right** | Navigate bars — the loop's own bars plus one empty bar past its end (or nudge held steps). |
| **Copy** | Duplicate a step / clip / bar (context-dependent). |
| **Delete (Clear)** | Delete a step / clip / bar; in Session, delete a clip. Hold + knob-touch clears that knob's automation lane. |
| **Hold Clear + pad** | Clear every note of that pad's pitch from the clip — a whole drum lane at once. |
| **Undo** | Undo the last edit. |
| **Shift + Undo** | Redo it. |
| **Mute** | Mute / unmute the current track (Track view only — Session view has no current track). Bright while anything is muted or soloed. |
| **Mute + track** | Mute that track instead; suppresses the current-track toggle on release. Addresses the focused group of four. |
| **Mute + step** | The step row becomes a 16-track mute map, in any view — mute that track directly, all 16, no group scrolling. Does not switch tracks or enter a note. |
| **Shift + Mute** | Solo / un-solo the current track (Track view only). Exclusive — soloing another moves it. |
| **Shift + Mute + track** | Solo that track instead. |
| **Shift + Mute + step** | Solo that track from the mute map. |
| **Track buttons 1–4** | Select a track within the focused group of four (hold = momentary peek). |
| **Volume encoder** | Adjust held steps' velocity. With a track button held instead, sets that track's volume (**add Shift on tracks 5-16** — see [Track volume](#track-volume)); otherwise it stays Move's master volume. |
| **TEMPO knob** (Set page) | Set the tempo; also sets Move's device-wide tempo via Link. **EXT** on the cell = locked to Move's transport. |
| **LINK knob** (Set page) | Turn right = ON, left = OFF. Enables the shared Play/Stop transport with Move (default OFF; saved per set). Clock/tempo follow works regardless. |

### Shift + Step shortcuts

| Combo | Action |
| --- | --- |
| **Shift + Step 3** | Open **Clip parameters** (scale, length, transpose, quantize; Track view). |
| **Shift + Step 5 / 7 / 9** | Open **Set parameters** (tempo/swing/link/quantize, root/key/mode/layout). |
| **Shift + Step 6** | Toggle the **metronome**. |
| **Shift + Step 10** | Toggle **full velocity**. |
| **Shift + Step 15** | **Double** the loop. |
| **Shift + Step 16** | Cycle the current clip's **quantization** (0 / default / 100 %). |

---

## 9. Troubleshooting & recovery

- **Movy looks frozen or the screen is stale.** Press **Back** to leave and
  re-open Movy from the Tools menu. Movy keeps running in the background; on most
  Schwung builds you can re-enter by holding **Shift + Step 13**.
- **A set opens as a blank template.** Movy keeps rotating backup copies and
  falls back to the newest intact one, so this should no longer follow a freeze
  or a power-cut. If it still happens, the set's files are under
  `schwung/modules/tools/movy/sets/<set-uuid>/` — `seq-state.json` plus
  `seq-state.1.json` / `seq-state.2.json`. Attach all of them to a bug report;
  each carries a generation number, which says which was written last.
- **The audio engine (MoveOriginal) crashed.** A sequencer engine bug should be
  caught before it can take down Move, but if audio dies, a full restart of the
  Schwung stack recovers it (see the build/test notes in
  [CONTRIBUTING.md](CONTRIBUTING.md) / the project's developer docs).
- **A module's parameters look wrong or empty.** It may need a layout template.
  Note the module and open an issue (or contribute a template).

### Reporting bugs

Movy is a prototype, so good bug reports really help. Please include:

1. **What you did** — a numbered list of steps.
2. **What you expected** to happen.
3. **What actually happened.**
4. **Which modules** were loaded in the chain (and on which track).
5. Anything from the device log if you can grab it.

A reproducible report (steps that reliably trigger the problem) is worth far
more than a screenshot of a broken screen. Thank you! 🙏
