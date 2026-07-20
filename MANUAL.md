# Movy — Manual

This manual explains how to use **Movy**, an Elektron-style knob UI and 4-track
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
2. [Parameter pages](#2-parameter-pages)
3. [The module chain](#3-the-module-chain)
4. [Keyboard & drums](#4-keyboard--drums)
5. [The sequencer (aligned with Move)](#5-the-sequencer-aligned-with-move)
6. [Beyond Move: Step, Clip & Set parameters](#6-beyond-move-step-clip--set-parameters)
7. [Limitations vs Move](#7-limitations-vs-move)
8. [Controls reference](#8-controls-reference)
9. [Troubleshooting & recovery](#9-troubleshooting--recovery)

---

## 1. Concepts & screen layout

Movy runs as a Schwung **tool** on top of Move. While it's open, Move's firmware
and the Schwung audio chain keep running underneath — Movy just takes over the
screen, pads, knobs, and buttons.

You're always working with **one of four tracks** at a time. Each track is a
Schwung chain of up to four module slots, plus a per-track **LFO** page:

```
MIDI FX  →  SYNTH  →  FX 1  →  FX 2  →  LFO
```

The **screen** is the 128×64 OLED. A typical parameter page looks like this:

![Synth parameter page](docs/assets/obxd_main_page.png)

- **Header** (top): the track on the left (e.g. `T1`), the module/bank name on
  the right.
- **Knob row(s)**: up to 8 parameters, drawn as knobs with a value and a short
  label. The currently-touched knob shows its full value in an inverted style.
- **Page indicator**: a thin strip showing which page of the module you're on.

The general UI rule (borrowed from Move): **only controls that do something are
lit**, and a button glows at full brightness while it's actively doing its job.

### The views

| View | What it shows |
| --- | --- |
| **Chain** | The current track's module slots (MIDI FX, Synth, FX 1, FX 2) and the LFO page; jog scrolls them. |
| **Knobs** | One module's parameter page; jog scrolls that module's pages. |
| **Keys** | The chromatic keyboard (or a drum rack on drum tracks). |
| **Browse** | The module browser (pick a module to load into a slot). |
| **Session** | The clip grid for launching clips; also exposes the master FX chain. |

You move between Chain → Knobs by **clicking the jog wheel** to drill in, and
**Back** to step back out (and eventually out of Movy).

---

## 2. Parameter pages

Movy reads each module's parameter hierarchy from Schwung and renders it
automatically. You don't configure anything for most modules.

- **Knobs / arc knobs** — continuous parameters are drawn as a circular knob
  with a pointer; the on-screen arc follows the value (including when automation
  moves it).
- **Enum knobs & the enum overlay** — list-type parameters (waveforms, modes…)
  show the current choice in a square. Touching the knob opens a **full-screen
  scrollable list** so you can see all the options:

  ![Enum overlay](docs/assets/enum_overlay.png)

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

- **Multiple pages** — modules with more than 8 parameters split into pages
  (`MAIN`, `PAGE 1`, `PAGE 2`, …). Scroll them with the jog wheel (or Left/Right
  when the sequencer isn't using those buttons).

Even a module that publishes no parameter hierarchy still gets pages — Movy lays
its parameters out in the order the module exposes them (this is what brings
modules like *Branchage*, *Smack-in* and *Belt-in* to life). When a parameter
also ships no range information, Movy shows a best-guess control and refines it
(for example to a whole-number range) the first time it reads the real value.

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
(MFX 1–4) that processes the whole mix.

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

---

## 4. Keyboard & drums

### Chromatic keyboard

On a melodic track the 32 pads form a **two-octave chromatic keyboard** (a piano
layout across two rows of white keys with the black keys above):

![Keyboard view](docs/assets/keys_view.png)

- **+ / −** (Up/Down buttons) shift the layout by an octave.
- The root note is shown in the header.

> **Chromatic only.** Movy does not (yet) offer Move's scale-aware pad layouts
> (*In Key* / in-scale, or the guitar-style in-scale layout). See
> [Limitations](#7-limitations-vs-move).

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

Because there's no other way to choose a drum type on the device, drum modules
rely on Movy's **layout templates**. Mr Drums, Weird Dreams, KrautDrums and
Signal ship Movy templates; Forge and Libpo32 are **self-describing** — they
carry their own layout in the module. Other drum modules may need one
contributed (see [CONTRIBUTING.md](CONTRIBUTING.md)).

---

## 5. The sequencer (aligned with Move)

Movy's sequencer is built to **feel like Move's**, for four Schwung tracks. The
following all work essentially as they do on Move — refer to the
[Move manual](https://cdn-resources.ableton.com/resources/pdfs/move-manual/1/2024-10-04/move1-manual-en.pdf)
for the concepts:

- **Clips** — one clip per track slot; steps entered on the 16 step buttons.
- **Session view & clip launching** — press **Note/Session** to see the clip
  grid; pads launch clips. Hold it for a momentary peek; tap to latch.
- **Live recording** — **Rec** arms recording with a one-bar **count-in**; play
  the pads to record. Clips start only after the count-in.
- **Metronome** — toggle with **Shift + Step 6**.
- **Step entry & editing** — tap a step to toggle a note; **hold a step** to edit
  it (and to open its [step parameters](#6-beyond-move-step-clip--set-parameters)).
- **Note length** — **hold step A, then press step B** to set A's length up to B.
- **Loop / bars** — the **Loop** button shows the bar overview; **Left/Right**
  navigate bars. **Shift + Step 15** doubles the loop.
- **Duplicate / delete** — **Copy** and **Delete** (a.k.a. Clear) act on steps,
  clips, or bars depending on context.
- **Quantize** — **Shift + Step 16**.
- **Mute** — hold **Mute** and press a track button to mute that track.
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
mute Movy's four tracks individually. (The link propagates the Play/Stop
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
| 3 | **TRANS** — transpose. |

(Clip parameters apply to a single clip, so this page is Track-view only.)

### Set parameters — Shift + Step 5 / 7 / 9

**Shift + Step 5, 7, or 9** opens the global **Set** page:

![Set parameters](docs/assets/main-default.png)

| Knob | Parameter |
| --- | --- |
| 1 | **TEMPO** |
| 2 | **SWING** |
| 3 | **ROOT** |
| 4 | **KEY** |

The KEY knob opens a scale/mode list (the same scrollable enum overlay used
elsewhere):

![Set parameters — key overlay](docs/assets/main-key-overlay.png)

These are set-wide (they affect all tracks). **TEMPO** also sets Move's
device-wide tempo through Ableton Link, so a following Move tracks the knob;
the cell shows **EXT** while Movy is locked to Move's transport (see
[Syncing with Move's sequencer](#syncing-with-moves-sequencer)).

Press **Back** (or a track button) to close any of these pages and return to
where you were.

---

## 7. Limitations vs Move

Movy aims to match Move, but it's an early prototype and several things are
missing or simplified. **All of these are candidates for future work — and
[contributions are welcome](CONTRIBUTING.md).**

- **No undo.** There's no undo history; edits are immediate.
- **No capture.** Move's retroactive capture (play freely, then capture what you
  just played) is out of scope.
- **Chromatic keyboard only.** No scale-aware pad layouts (*In Key* / in-scale,
  or the guitar-style in-scale layout). The Set page's KEY/ROOT affect the
  sequencer's scale, but the pads stay chromatic.
- **Four Schwung tracks only.** Movy sequences four Schwung chains — not Move's
  native instruments, drum racks, or sampler.
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
| **Hold a knob (~1 s)** | Assign that parameter as an **LFO target**: jog picks LFO 1/2, jog-click assigns (hold again to remove). Automatable parameters only. |
| **Jog wheel — turn** | Scroll chain slots (Chain view) or module pages (Knobs view) / browser list. On the LFO page, scroll between LFO 1 and LFO 2. |
| **Jog wheel — click** | Drill Chain → module pages; on Knobs (or an empty slot) open the module browser; in a browser, load the selection. |
| **Shift + jog click** | Open the module browser to swap the current slot's module. |
| **Back** | Module pages → Chain; browser → cancel; **at the root (Chain) → open the Leave Movy menu** (Background / Close Movy). |
| **Back then jog-click** | From the root: background Movy (keeps playing under Move's UI). |
| **Shift + Back** | Fully exit Movy (unload), instantly, from anywhere. |
| **+ / −** (Up/Down) | Shift the chromatic keyboard by an octave (melodic tracks only). |

### Sequencer

| Control | Action |
| --- | --- |
| **Step buttons 1–16** | Toggle a note on/off at that step. |
| **Hold a step** | Edit that step; opens its **Step parameters** (page 0). |
| **Hold step A + press step B** | Set step A's note length up to B. |
| **Hold a step + pad** | Edit that step's notes from the keyboard. |
| **Play** | Start / stop the transport. When **LINK** is on, also starts / stops Move's native sequencer (a Movy-initiated start waits ~1 bar for Move's Link grid). |
| **Rec** | Arm recording (one-bar count-in). |
| **Note / Session** | Show the Session clip grid (momentary hold = peek, tap = latch). Pads launch clips. |
| **Loop** | Toggle the bar/loop overview; hold + jog resizes the loop. |
| **Left / Right** | Navigate bars (or nudge held steps). |
| **Copy** | Duplicate a step / clip / bar (context-dependent). |
| **Delete (Clear)** | Delete a step / clip / bar; in Session, delete a clip. Hold + knob-touch clears that knob's automation lane. |
| **Mute + track** | Mute that track. |
| **Track buttons 1–4** | Select a track (hold = momentary peek). |
| **Volume encoder** | Adjust held steps' velocity. |
| **TEMPO knob** (Set page) | Set the tempo; also sets Move's device-wide tempo via Link. **EXT** on the cell = locked to Move's transport. |
| **LINK knob** (Set page) | Turn right = ON, left = OFF. Enables the shared Play/Stop transport with Move (default OFF; saved per set). Clock/tempo follow works regardless. |

### Shift + Step shortcuts

| Combo | Action |
| --- | --- |
| **Shift + Step 3** | Open **Clip parameters** (Track view). |
| **Shift + Step 5 / 7 / 9** | Open **Set parameters** (tempo/swing/root/key). |
| **Shift + Step 6** | Toggle the **metronome**. |
| **Shift + Step 10** | Toggle **full velocity**. |
| **Shift + Step 15** | **Double** the loop. |
| **Shift + Step 16** | **Quantize** the current track. |

---

## 9. Troubleshooting & recovery

- **Movy looks frozen or the screen is stale.** Press **Back** to leave and
  re-open Movy from the Tools menu. Movy keeps running in the background; on most
  Schwung builds you can re-enter by holding **Shift + Step 13**.
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
