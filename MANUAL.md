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
   - [The MIX page](#the-mix-page)
   - [Send FX](#send-fx)
4. [Keyboard & drums](#4-keyboard--drums)
   - [Muting one voice](#muting-one-voice)
5. [The sequencer (aligned with Move)](#5-the-sequencer-aligned-with-move)
6. [Beyond Move: Step, Clip & Set parameters](#6-beyond-move-step-clip--set-parameters)
   - [CPU meter](#cpu-meter--shift--step-12)
   - [Sets](#sets--shift--step-1)
   - [Settings](#settings--shift--step-2)
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
four, all of them chains Movy hosts itself
([Tracks and groups](#tracks-and-groups)). A track is a chain of up to four
module slots, plus a per-track **LFO** page:

```
MIDI FX  →  SYNTH  →  FX 1  →  FX 2  →  LFO
```

### Movy runs on its own

Movy is a **standalone** Schwung tool: while it is open it runs in place of
Move's own software, not on top of it. Move's screens are not running
underneath, so there is nothing to switch back to while Movy plays — Movy owns
the pads, knobs, screen, audio, master volume and the power button. (Movy
0.35 and earlier ran beside Move; see *What changed from the Move-side Movy*
below.)

There are two ways in:

- **From the Tools menu**, like any tool. Move's software stops while Movy
  runs and starts again when you leave, so opening and closing take a few
  seconds each way.
- **Straight from power-on.** Installing Movy adds a **Movy** row to Schwung's
  boot picker. At power-on the screen shows `Loading <name> — press Back to
  change` for about two seconds: press **Back** there, turn the jog to
  **Movy** and click. Movy is then the default and opens at every power-on, in
  a few seconds and with no Move in between. To go back to Schwung, press
  **Back** in that window again and pick **Schwung**. Installing or updating
  Movy never makes it the default by itself.

**Leaving.** **Back** at the top level opens **Leave Movy?** with one choice,
**Close Movy**: turn the jog wheel to it and click. Movy saves the Set first.
Either way you land in Move with Schwung, never straight back in Movy, even
when Movy is your power-on default. Opened from the Tools menu, the screen shows
`Loading Movy` for about 2 seconds on the way out, then Move starts.

![Leave Movy](docs/assets/leave_modal.png)

**If Movy ever stops responding:** hold **Shift**, touch the **volume knob**,
and click the **jog wheel**. Movy closes and saves as usual; if it cannot (for
example a stuck script), it closes anyway after two seconds, without saving,
so the device always comes back.

**Master volume.** The **volume knob** on its own is the master volume. Touch
it to see the **MASTER VOLUME** slider; each detent is 1 dB, from silence up to
0 dB (full scale). Movy remembers the level across Sets and restarts; the
first time it opens it starts at −12 dB. Holding a **track button** and
turning the knob still sets that track's volume, on any of the 16 tracks.

![Master volume](docs/assets/master_volume.png)

**Powering off.** Tap the **power button** and Movy asks **Power off?**: click
the jog wheel to confirm, or turn to **Cancel** (or press **Back**) to carry
on. On confirm Movy saves the Set first, then the device shuts down: until the
power goes, the screen reads **Powering off...**, a rainbow slowly drifts
across the pads and every other light is dark. Nothing powers off from the button alone.

![Power off](docs/assets/power_modal.png)

**Your Sets.** Movy keeps its own Sets (see [Sets](#sets--shift--step-1)).
The first time it opens it copies every Set the Move-side Movy kept into that
library; the originals are left exactly where they were. If the library
folder cannot be written, Movy says **SETS FOLDER NOT WRITABLE** and does not
start a Set, rather than letting you play into something it cannot keep.

#### What changed from the Move-side Movy

Movy 0.35 and earlier opened on top of Move. Running on its own retires the
things that only existed to share the device with Move: **Background** mode
(parking Movy under Move's screens), **LINK** to Move's transport, Sets tied to
Move's Set pads, Move's own master volume and master FX slots, and tracks
played on Schwung's slots. Your existing Sets come across (above), and so does
the master chain of each Set, the first time that Set opens. Nothing of the
old install is deleted, so going back to an older Movy finds it as it was.

**Known limitations.** Move shapes the sound of its built-in speaker with its
own EQ; Movy does not yet, so the speaker sounds different from the same Set
under Move. Headphones and line out are unaffected.

### Opening Movy

For the first few seconds Movy shows **STARTING ENGINE**, then **LOADING SET**:

![Starting up](docs/assets/session_booting.png)

Reading the Set is only the first half. Its instruments are loaded one at a time
— a full Set is twelve of them — so the screen then counts them in with
**LOADING MODULES**:

![Loading the Set's modules](docs/assets/session_modules.png)

and finishes on **PREPARING SET** while the Set's last pieces settle.

![Preparing the Set](docs/assets/session_preparing.png)

The pads, knobs and buttons are inert until all of that is done, and that is
deliberate. Everything you play or enter after that point belongs to the Set,
and to the instruments the Set actually loaded; nothing you do before it can be
lost or land on the wrong module. (**Back** always works, so a Movy that cannot
start is never a trap.)

Switching Sets shows the same screens again — the incoming Set's instruments
have to be loaded just like the first one's — and the screen stays up until the
module page underneath it is showing the new Set's own modules, not an empty
slot or the Set you just left.

If a module never loads, Movy gives up waiting after ten seconds and starts
anyway: what did load still plays.

If a Set's saved sequence cannot be read, Movy says so instead of starting
empty and letting you discover it later:

![Cannot load this Set](docs/assets/session_failed.png)

**Jog click** then starts that Set with an empty sequence. Movy does not do this
on its own — the unreadable file is left untouched, so it can still be recovered
from the device by hand. Your modules and their settings are Schwung's and are
not affected either way.

A different screen means a different problem, and there is no jog click on it:

![Engine mismatch](docs/assets/session_failed_mismatch.png)

This one is about the install, not your Set: Movy's engine comes from a
different build than the rest of Movy, which only a partial install or update
leaves behind. **Reinstall Movy** from the Module Store. Your Sets are
untouched: Movy never became live, so it never wrote anything.

`ENGINE DID NOT START` on the same screen means the engine did not load at all.
The remedy is the same reinstall.

### Backups

Movy keeps older versions of every Set and can put one back without a computer.
Open **Settings** (Shift + Step 2) and scroll to the **BACKUPS** row:

![Backups](docs/assets/versions_list.png)

Each row is one saved version: how long ago it was kept, why it was kept, and
how many clips are in it — the clip count is the quickest way to spot the one
that still has your work. **Jog** scrolls; **Shift + jog** jumps eight rows at a
time. A `*` after the count means *sequence only*: that version restores your
notes and leaves your instruments exactly as they are.

A version is kept when you **open** a Set, roughly every ten minutes while you
work, when you **leave**, and always **before** anything that would wipe the
Set. Up to 32 are kept per Set, thinned so you get the last hour in detail,
today by the hour, this week by the day, and older ones by the week.

**Jog click** on a row asks to confirm, because restoring replaces what you have
now:

![Restoring](docs/assets/versions_confirm.png)

**Jog click** again restores it; **Back** cancels. Restoring is itself
undoable — the state you had is kept as a version first, so a mis-press costs
you nothing.

A Set's versions belong to that Set and go with it when you delete it on the
[Sets](#sets--shift--step-1) page — into
`/data/UserData/UserLibrary/Movy/Trash/`, from where it can still be recovered
by hand.

### Which Set your sequence belongs to

Each Set on Movy's [Sets](#sets--shift--step-1) page is one whole Movy project:
its sequence, its instruments and their settings, and its master chain. The
Set that was open when you left reopens next time.

The **screen** is the 128×64 OLED. A typical parameter page looks like this:

![Synth parameter page](docs/assets/page_body.png)

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

Every module's parameter pages are **Schwung's own**: Schwung's page planner
reads the module's declared hierarchy and draws the eight knob cells, exactly as
Schwung's Slot Settings would. Movy keeps three bands around them — the header,
the page indicator under it, and the hint row at the bottom — and writes your
edits to the module, its automation lanes and the undo history. You don't
configure anything for most modules.

![A module's parameter page](docs/assets/page_body.png)

The cells are drawn as what they are: an arc for a continuous value, a switch
for on/off, the option name for a list, a framed number for an octave or a voice
count, a fader for a level, and grouped graphics where a module declares them —
an envelope across its stages, a filter response across cutoff and resonance, a
sample's waveform with its playback position:

![A sample drawn with its position marker](docs/assets/page_sample.png)

**While a module is loading** its knob rows stay blank and the knobs do nothing
— there is nothing to edit yet. The page appears as soon as the module has
published it; heavy modules (Osirus, MiniJV) take longer to get there.

**Multiple pages.** A module with more than eight parameters is split into pages
under its own section names. Scroll them with the jog wheel (or Left/Right when
the sequencer isn't using those buttons); the line under the header is the page
indicator, the current page drawn taller:

![The second page of a module](docs/assets/page_body_p2.png)

**Jumping between sections.** Hold **Shift** and click the jog for Schwung's
section list, and pick the section to jump to. (Shift + jog turns one page at a
time, like a plain jog.)

**Lists.** Turning a list knob steps through its options and shows them in a
pop-up while you turn; click the jog on it for the whole list as a menu:

![A list opened from its knob](docs/assets/page_enum_list.png)

**The header and the hint row.** **While a knob is under your hand** the header
becomes that parameter — its full name on the left, its current value on the
right, drawn inverted:

![A held knob takes the header](docs/assets/page_chrome_held.png)

Let go and Movy's own header comes back — the track, the module and, on a drum
module, the pad grid. The bottom row stays the Loop strip unless the page has
something to say there.

**Files.** A parameter that points at a file — a sample, a wavetable, a
soundfont, an SFZ — cannot be turned, so the click is the only way in, and it
is the one knob that gets a hint. Hold it and the header names the parameter
and the file it is set to, and the bottom row reads `CLK BROWSE`:

![A held file knob offers the browser](docs/assets/page_chrome_file.png)

Click the jog and **Movy's file browser** opens in that parameter's folder, on
the file it is set to:

![The file browser a file parameter opens](docs/assets/file_browse.png)

Turn the jog to move the highlight, click to load the highlighted file, **Back**
to cancel. Folders come first and are marked with a `>`, so you can walk down
into a library and back out through the `..` row. The folder you last used for a
parameter is remembered, so the second visit starts where the first one ended —
per parameter rather than per module, because a drum module has one of these for
every pad.

**Preview.** Some modules ask to be heard while you browse — mrdrums' and
MrSample's samples, granny's, tablor's wavetables. There, the file under the
cursor loads once the cursor rests, so you hear it before you choose; **Back**
puts back what was loaded before you opened the browser. A module can also ask
for something to change while it is open — mrdrums stops a pad you hit from
moving the selected pad, so you can audition other pads without losing the one
you are filling — and that is put back when you leave.

Loading is **one undo step**, named after the parameter it went into. When a
module says what a valid file contains — a drum-rack preset as opposed to a
synth one, say — a file that fails that test is refused with a toast instead of
loaded, and the browser stays open so you can pick another.

**Module screens.** Some modules draw a whole screen of their own for one knob —
DR32's **ENGN** knob opens its engine picker (Sample, Simian, Urchin, 9W9…, each
with its own list), and its **Resample** knob its resampler. Hold the knob and
click the jog, exactly as for a file. The module then owns the jog, the click and
the eight knobs; the pads still play, and a pad you hit is the pad the screen
fills. **Back** climbs out one level at a time and leaves from the top;
**Shift + jog** always leaves at once. Some modules close the screen themselves
when you pick something.

**Pages a module draws itself.** A module can ship a page it draws itself, as
MonkSynth does with its singing face. It sits in the jog rotation like any
other page, and the eight knobs keep editing that section while you watch it. If
the module lets you *enter* the page, click to go in: from then on the jog and
the click belong to the module, and Back steps up one level inside it until the
module has nowhere left to go, then leaves the page.

**Pages that follow a setting.** A module can hide pages that do not apply right
now — DR32 shows only the pages of the engine the selected pad runs (a sample
pad's Shape, a 9W9 kick's Voice), not every engine's at once. Pick a different
engine, or hit a pad that runs one, and the pages change with it.

**Curated layouts.** A few older drum modules play better from a hand-tuned page
layout that Movy ships for them (*mrdrums*, *Forge*, *Weird Dreams*, *Signal*,
*libpo32*, and the *6W6* / *8W8* / *9W9* / *CW78* kits): Movy hands that layout
to Schwung's planner in place of the module's own, so their pages are grouped
and named by voice:

![A curated drum page](docs/assets/page_config_pad.png)

---

## 3. The module chain

In **Chain** view you see the slots of the current track:

![Chain view](docs/assets/chain_synth.png)

- **Jog wheel** scrolls between slots (MIDI FX, Synth, FX 1, FX 2, the LFO page
  and the MIX page).
- **Jog click** on a loaded slot **drills into** that module's parameter pages.
- **Jog click** on an empty slot — or **Shift + jog click** on any slot — opens
  the **module browser** to load/swap the module in that slot:

  ![Module browser](docs/assets/browse_view.png)

  Scroll with the jog wheel; click to load; Back to cancel. Choosing **NONE**
  empties the slot and always lands you on the chain view, even when you opened
  the browser from the module's pages.

- **Back** returns from a module's pages to the chain, and from the chain it
  exits Movy.

In **Session** view, the same navigation applies to the **master chain**: three
**send FX** slots, then **MFX 1–4** processing the whole mix, then an **LFO**
page — see [Send FX](#send-fx) and
[The master chain's LFOs](#the-master-chains-lfos).

**The master chain is Movy's own**: MFX 1–4 and the LFO page, then master
volume and a safety limiter at −1 dBFS. It is saved with the Set's chains. The
first time a Set made by Movy 0.35 or earlier opens, Movy copies that Set's
Schwung master FX into it; Schwung's own files are only read, never changed.

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
Move which track is held, and Move only has four track buttons — beyond them it
has nothing to be told, so the knob stays on Move's *master* volume. Known
limitation, not by design.

The value belongs to the track — Movy's own mixer, for every track — and it is
**saved with the Set**, so it survives leaving Movy, a power cycle, and
switching to another Set and back. A track's level is saved alongside its
chain, so a chain with nothing loaded in it has no level to keep.

### The MIX page

The last slot in every track's chain is **MIX** — Movy's own mixer for that
track.

![MIX page](docs/assets/mix_page_chain.png)

| Knob | What it does |
| --- | --- |
| **VOL** | Track level, drawn as a fader. Silence to +12 dB, on the same dB curve as **track + volume**. |
| **PAN** | Position in the stereo field, shown as `C`, `L50`, `R100`. |
| **SEND1** | How much of this track goes to send FX 1. Full right is 0 dB. |
| **SEND2** | How much of this track goes to send FX 2. |
| **SEND3** | How much of this track goes to send FX 3. |

VOL and PAN sit on the top row; the three sends are together on the bottom row,
under encoders 5–7.

Every knob here turns at the same rate as a module's — a full sweep is a full
sweep, wherever you are on the fader — and lands on the round numbers: `0.0 dB`
and centre pan are always reachable, whatever the value started at. The header
shows the knob under your hand, as on any page.

All five are **automatable** like any module parameter: hold a step and turn, or
turn while recording. See [Step parameters](#step-parameters--per-trig-locks).
Automation follows the same fader curve the knob does, so an automated level
moves where you expect it to rather than crowding into one end of the travel.

The sends are **post-fader and post-pan**: pulling a track's level down takes its
reverb with it, and a hard-panned track arrives in the return where you left it.
Muting a track mutes its sends too.

### Send FX

The master chain starts with three **send FX** slots, to the left of MFX 1.

![Send FX slot](docs/assets/master_send_slot.png)

Load one the way you load any module — jog to the slot, jog click, pick from the
browser — and then raise **SEND1**, **SEND2** or **SEND3** on the MIX page of
whichever tracks should feed it. Each send holds **one audio FX**. Its output is
added back at unity; the send amount on each track is the level control.

The buses render **in parallel** when it pays for itself. Three heavy reverbs
cost 847 µs of a 2902 µs audio block one after another and 423 µs spread across
Movy's render lanes — a saving of about 15% of the frame. Movy checks the
arithmetic per block and stays serial when overlapping would cost more than it
saves, which is what happens when only one bus is working.

They sit left of the master FX on screen because they sit left of them in the
signal path: a send's output joins Movy's own output, which the master FX then
process.

**Why bother.** One reverb shared by eight tracks costs a fraction of eight
reverbs — and a send is never more expensive than putting the same effect on the
track itself, however few tracks feed it. That used not to be true: a bus had to
wait for every track to finish and then ran on its own, so below about four
tracks a send cost more than an FX slot did. Movy now renders a bus on the same
render lane as the tracks feeding it whenever that shortens the block, which on
a twelve-track set with one heavy delay is worth about 250 µs — 9% of the audio
frame. Nothing is delayed to do it, so short effects behave normally on a send.

Sends are still for *wet* effects — reverb, delay, chorus. An effect that
replaces the dry signal (distortion, compression, EQ) belongs in the track's own
FX slot, where it will sound like you intended: that is a question of what it
does to the sound, not of what it costs.

Sends are **saved with the Set**, module and preset alike.

#### Per-pad sends from drum modules

A drum module with its own per-pad **Send A** / **Send B** knobs feeds the same
buses, one pad at a time: **Send A goes to SEND 1, Send B to SEND 2**. Turn up
the snare's Send A on the module's own pad page and only the snare reaches
the reverb on SEND 1, even with the track's SND1 at zero. SEND 3 has no per-pad
source; it is fed from the MIX page only.

- A pad's send is added to whatever the track's own SND1/SND2 already sends.
- It follows the **track's** volume, pan and mute, like the track's own send.
  It is taken from the pad's dry sound, before the track's FX.
- The levels belong to the module and are saved in its preset, like any other
  module parameter.

Two modules support this today: **Simian** (Send A/B on each of its ten drums)
and **DR32** (on each of its 32 pads). Other modules' "send" knobs (Surge,
Weird Dreams, Forge, MiniJV, Mono Voice, Osirus) drive effects built into the
module itself and never reach Movy's sends.

### The LFO page

The last page in the chain is **LFO** — two low-frequency oscillators that can
modulate any automatable parameter in the track's chain. Jog-click it to drill
in; the jog then scrolls between **LFO 1** and **LFO 2**.

These are Schwung's own LFO pages — the same LFO 1 / LFO 2 pages its Slot
Settings and Master FX Settings show, so a patch reads the same in both places:

![LFO page](docs/assets/page_lfo.png)

- **Top row:** **TARG** (what it modulates), **MODE** (uni/bipolar),
  **SYNC** (free/synced), **RTG** (retrigger on each new note).
- **Bottom row:** **SHAPE**, **DEPTH** and **PHASE**, drawn as one live
  waveform, then **RATE** in a cell of its own — in Hz when free-running, a
  musical division (`1/4`, `8T`, `2b`) when synced. The waveform still follows
  it, and a synced rate draws at the speed it plays (1/4 looks like 2 Hz).
- **Target:** **turn its knob** like any other list — every parameter the LFO
  can reach pops up while you turn, and the routing is made when you let go
  (scrolling past other parameters does not modulate them). Click the jog on it
  for the same list as a menu. **None** is the first entry.
- **There is no On switch:** choosing a target turns the LFO on, and **None**
  turns it off. A newly routed LFO starts at **100%** depth.

**Synced LFOs phase-lock to the transport.** With **Sync** on, a running
transport drives the LFO's phase directly from song position — the cycle is
bar-aligned and stays drift-free no matter how long it plays. It follows
Movy's own sequencer. **Phase** then
becomes a musical offset against the bar. When the transport **stops**, the LFO
keeps breathing — it free-runs from where it was, at Movy's tempo, and a tempo
change while stopped changes its rate straight away.

You can pick an LFO's Target here, but the easy way is to assign it from the
parameter itself:

### Modulating a parameter with an LFO

On any module's parameter page, **hold an (automatable) knob** for about a second
without turning it. A prompt appears at the bottom. On a page Schwung draws,
this works on ordinary number knobs only: an option, a switch, an action or a
file knob already uses the click, so holding one never takes it over (point an
LFO at those from the LFO page's **Target** instead).

![Assign an LFO](docs/assets/lfo_assign_toast.png)

- **Turn the jog** to choose `LFO1` or `LFO2`.
- **Click the jog** to assign — that LFO now modulates the parameter, and you
  jump to its LFO page to set rate, shape, and depth.

Hold the same knob again to **remove** the modulation (or, from the other LFO,
add a second one to the same parameter). A modulated parameter wears a
modulation mark on its cell:

![Modulation mark](docs/assets/page_mod_cell.png)

Both work on **every track** alike.

The prompt only appears on knobs an LFO can actually reach — a module's own
parameters. It is not offered on the **MIX** page or on a **send FX** slot: those
live in Movy's own audio engine, while the LFOs belong to Schwung's chain host,
so it has no way to drive them. Automate those with a parameter lane instead.

### The master chain's LFOs

The master FX chain has an LFO page of its own, in the same place: the **fifth
slot**, after MFX 4. Jog to it in Session view and click to drill in.

![Master LFO page](docs/assets/page_lfo_master.png)

It works exactly like a track's, with two differences:

- **Targets are the four master FX slots** (and the other master LFO) rather
  than a track's chain — so an LFO here sweeps the whole mix's reverb or filter.
- **There is no Retrigger.** Nothing plays notes on the master bus.

Hold-to-assign works here too: hold any automatable knob on an MFX slot's page
and click to modulate it.

These settings are saved with the Set's chains, so they survive a power cycle.

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

![Set parameters](docs/assets/page_setparams.png)

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
page that controls just the selected drum voice — marked with a pad icon).
A kit with **more than 16 voices** (dr32 has 32) uses **all 32 pads**: voices
1–16 fill the left 4×4 exactly as on any other kit, and voices 17–32 fill the
right 4×4 the same way, each half numbered from its bottom-left pad upwards:

![A drum module's voice page](docs/assets/page_voice_pad.png)

**Press a pad to pick which voice you're editing.** A kit that declares its
voices — or one Movy ships a curated layout for — has a page per voice, and a
pad press shows that voice's page, the header naming the voice and the pad icon
lighting the pad. **Shift + pad** picks a voice without sounding it. Pages that
belong to the whole kit — Reverb, Delay, Master — carry no pad icon, and a pad
press does not drag you off them:

![A kit-wide page: no pad icon](docs/assets/page_voice_global.png)

On a drum track the page follows the pad **you** press and
nothing else. A playing pattern never turns the page, even on a drum machine
that moves its own selection with every hit (6W6, 8W8, 9W9, CW-78, mrdrums,
Forge). The per-pad knobs always edit the pad you last pressed.

The **pad's own pages come first**. On a drum machine with one page per voice
(6W6, 8W8, 9W9, CW-78) those pages fold into a single **pad page**, which shows the
pad you last pressed. The jog then reaches the module's other pages (Main,
Reverb, Delay…). On a rack whose pages edit the selected pad (simian, dr32,
sophie, Forge's voice pages) the pad pages are all of those. A drum module opens
on its pad page.

A module needs no Movy config file to be played as a drum rack here. One that
says it is a drum kit, or whose pages switch between instances by their own
"selected pad" parameter, gets a rack of its own: its pads start at C1 (note 36)
unless it names the notes itself. When a module does ship a Movy config, or
Movy ships one for it (6W6, 8W8, 9W9, CW-78), the config decides the pads and
their notes.

![Simian's pad page, first of five in the bank bar](docs/assets/page_held_drum.png)

How a pad press moves the page:

- **On a pad page**, a press switches to that pad and stays on the same pad
  page: the second page of one voice becomes the second page of the next. A
  voice with fewer pages lands on its last one.
- **On any other page** (Main, Reverb…), a press leaves the page where it is.
  It still selects the pad, so jogging back to the pad page shows the pad you
  hit last.

Switching pads does not wait on the module. Every pad's values are read in the
background, so the knobs show the new pad on the press itself.

*Sample Slicer* is a slice player rather than a kit: its **32 pads are the 32
slices** the module can trigger (pad 1 = slice 1). Its Main page carries the
**Sample** browser — hold that knob and click the jog to browse
`UserLibrary/Samples` — and a **Scan Slices** action next to it, which is what
turns a freshly loaded sample into slices. The **Slice** page then edits
whichever slice you last hit: start, end, attack, decay, pitch, gain, mode and
loop. Those per-slice knobs are not automatable — the module points them at the
slice it is playing, so a lane would land on whatever the sequencer triggered
last.

*Forge* takes it further: its **16 pads are a Kit A↔B performance grid** (lower
two rows = Kit A, upper two = Kit B; the *Morph* knob crossfades them), and
tapping any pad selects that voice for deep editing across six pages —
**Osc, Filter, Env, Mod, Setup, Send**:

![Forge per-voice Osc page](docs/assets/page_config_pad.png)

The **Send** page holds the selected voice's mixer strip — **Reverb Send**,
**Delay Send** and **Pan**. On Kit A pads these are automatable like any other
per-voice parameter (classic per-step delay throws); Kit B pads can still be
edited, just not automated:

![Forge's mixer page](docs/assets/page_config_mix.png)

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

An older drum module follows its Movy template: **Forge, Mr Drums, Weird
Dreams, Signal and Libpo32** show the template's pages, in the template's
order. The knobs on them edit the pad you last pressed. A page that edits the
selected pad shows the **pad icon** next to its name (Forge's Osc to Send pages,
Mr Drums' Main and Rand, Weird Dreams' Voice). Global pages such as Mix or
Master don't show it. The template's graphics carry over too, wherever Schwung can draw them: Forge's
Filter page shows a filter curve, its Mix page eight faders, and its Mod page an
LFO wave. When another knob sits inside a graphic's group (Forge's LFO Sync
between Rate and Depth), the picture covers the knobs before it. The ones after
it keep their own knob and still shape the picture: Depth sets the wave's
height. A drum module that
describes its pads itself (Simian, DR32, Sophie, and the 6W6/9W9 kits) shows its
own pages. On Forge, a pad press does not jump to a voice page; it picks the
voice the page edits.

#### Muting one voice

A drum track's voices can be silenced one at a time, with the same gesture that
mutes a whole track: **hold Mute and press a pad** to silence that voice,
**Shift + Mute + pad** to solo it. It is the track gesture one voice down, and it
follows the track rules throughout: every form is a **latch** (press again to
unmute, or to clear the solo), solo is **exclusive** (soloing another voice moves
the solo rather than adding to it), and **solo overrides mute** — the voices you
muted are remembered underneath and come back exactly as they were when the solo
drops.

Like a track mute, it silences the **sequencer**: it applies to the whole track,
in every clip, and a pad you play by hand still sounds. **The press that works the
gesture does not, though** — for as long as Mute is down the pads belong to the
gesture, so a press neither sounds nor moves the pad the lane is editing. Let Mute
go and they play as usual. It lasts as long as the
Set does — the mutes and the solo are saved with the tracks' own — and both are
**undoable**, with the Undo record naming the voice. A voice outside the rack
(no pad in the drum layout maps to it) is not a voice: the gesture does nothing.

Each press shows a **toast naming the voice** — the rack's own name where the
module declares one (`KICK MUTED`), otherwise its pad number (`PAD 2 SOLO`).

**Seeing what is silenced.** A silenced voice rests **grey** on the pads
themselves instead of its track colour. Two states outrank the grey, because both
would otherwise become invisible: a voice **whose gate is open stays green**
while it sounds, and the pad the drum lane is **editing stays white**. So a grey
pad is exactly a voice the sequencer is not going to play — the difference
between a mute you can read off the grid and one you have to remember.

---

## 5. The sequencer (aligned with Move)

Movy's sequencer is built to **feel like Move's**, across **16 tracks**. The
following all work essentially as they do on Move — refer to the
[Move manual](https://cdn-resources.ableton.com/resources/pdfs/move-manual/1/2024-10-04/move1-manual-en.pdf)
for the concepts:

- **Clips** — one clip per track slot; steps entered on the 16 step buttons.
- **Session view & clip launching** — press **Note/Session** to see the clip
  grid; pads launch clips. Launching a clip also **selects its track**, so the
  knobs, screen and step row all move to the clip you just started. Hold
  Note/Session for a momentary peek; tap to latch.
- **16 tracks in four groups** — see [Tracks and groups](#tracks-and-groups)
  below.
- **Live recording** — **Rec** arms recording with a one-bar **count-in**; play
  the pads to record. Clips start only after the count-in. Pressing **Rec**
  while the transport is *already running* punches in instead: onto a clip that
  already has notes it records from where you are, and into an **empty slot** it
  waits for the next bar — the Rec button flashes until then — so the new clip
  starts on the beat, in sync with everything already playing. Tapping Rec again
  while it flashes cancels. A note played slightly *ahead* of the final beat
  still lands on the downbeat rather than being dropped, so leaning into the
  first hit does not cost you the note.
  A pad still **held when you press Rec to stop** (or when you stop the
  transport) is kept, not discarded: recording stops there, but the note you
  are sounding is written with the length you actually play it for, so ending a
  take on a sustained chord keeps that chord. It ends at your release or at the
  **end of the clip**, whichever comes first — so however long you lean on the
  pad, it never wraps round the loop into a drone.
- **Metronome** — toggle with **Shift + Step 6**.
- **Full velocity** — **Shift + Step 10** makes every pad note leave at
  127, whatever you actually hit the pad with. It is a way of playing
  rather than part of a piece of music, so it stays where you left it: in
  every set, and after closing and reopening Movy.
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

  A step or bar copy carries **everything on the step**: the notes with their
  velocity and length, the step page's probability, condition and invert, and
  the step's automation. A paste replaces all of it at the destination — a
  plain source step resets the destination's probability and condition too.

  On a **drum track**, copying a step or a bar copies **only the selected pad**:
  its notes, its probability/condition/invert, and the automation on that
  pad's own parameters, the way Move does
  it. A paste replaces only that pad at the destination, and every other pad's
  notes and locks there stay as they were. This needs a drum module that
  declares its pads to Schwung (6W6, 8W8, 9W9, CW-78, simian, dr32, sophie) and Schwung
  1.6.0 or newer. On any other module, or an older Schwung, a step copy takes
  the whole step as before.
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
- **Per-voice mute and solo** (drum tracks) — **hold Mute and press a pad** to
  silence that one voice; **Shift + Mute + pad** solos it. The track gesture,
  one voice down, and it follows the track rules: latch, exclusive solo,
  solo-overrides-mute, a toast naming the voice, saved with the Set, undoable.
  See [Muting one voice](#muting-one-voice).
- **Automation** — turn a module knob while recording (or while holding a step)
  to record parameter automation; the cell follows the automation.

  ![An automated parameter's lane mark](docs/assets/page_lane_mark.png)

Because Movy keeps the module's parameters on screen during sequencing, some of
Move's full-screen sequencer displays are replaced by **LED feedback on the pads
and step buttons** plus a bar/position indicator and brief on-screen
announcements. The lighting follows Move's conventions (play = green, record =
red, only actionable buttons lit, the playhead sweeps the step row, etc.).

> **Note:** Movy's sequencer intentionally does **not** copy Davebox's timing
> where Davebox deviates from Move — the goal is to match native Move.

### Scenes & Song mode

A **scene** is a column of the clip grid — the same clip slot on all 16 tracks,
not just the four you can see. **Hold Loop in Session view** and the step row
becomes the scene launcher: the eight buttons printed **1, 3, 5 … 15** are
scenes 1-8, and the ones between them are dark because they do nothing.

Loop, not Shift: Shift keeps the [shifted step
shortcuts](#shift--step-shortcuts) here, exactly as in Track view. Loop has
nothing else to do in Session view — there are no bars on the row to select —
so holding it there is a pure modifier and never latches the Loop view.

Pressing a scene launches that whole column. Tracks with a clip there start it
(on the next bar, like any clip launch); **tracks with an empty slot stop** — a
scene is a snapshot of what plays, so what is not in the column goes quiet.

**Building a song.** Keep holding Loop and press more scenes. The first press
of a hold starts a new song; every press after it adds to the end. Press the
same scene twice and it plays twice as long. Let Loop go and the song is what
you pressed — it plays through in order and then **loops**.

Each scene lasts as long as its longest clip, rounded up to whole bars.

**Ending a song deliberately.** A scene with no clips on any track is the **end
of the song**: there is no clip to take a length from, so the arrangement stops
there. Everything goes quiet and the screen adds `END` after the scene numbers —
but the **transport keeps running**, so you are still in time and can launch
straight back in. Put an empty scene at the end of a song and it plays once
through instead of looping. One bar
before a switch the next scene's clips start flashing in the grid, the same way
a clip you have just launched flashes while it waits for the bar. Every scene
the song uses pulses on the step row, so you can see the whole arrangement at a
glance.

The bottom of the screen shows `SONG` and the scene numbers, with the one
playing boxed. It appears as soon as you press Loop in Session view and stays
up while a song is running. A song too long for the row scrolls, keeping the
scene you are on and what comes next in view.

**Ending a song.** Launch any clip by hand and the song is gone — what is
playing keeps playing, it just stops moving on by itself. Pressing Loop and a
scene again starts a fresh song.

Stop and Play restarts the song from the beginning. The song is saved with your
Set.

You can record while a song plays, and the take follows the song into whichever
clip ends up playing on the track you are recording. The one exception is a
take started on an **empty** clip: that is itself a clip launch, so it holds
its own track for that scene while the rest of the song carries on.

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

**Every track hosts its own instrument.** Load a module onto one exactly as you
would on a track button track, and movy hosts the whole chain itself.

Two things worth knowing:

- **Move's mixer sees every track as one channel.** Movy sums them into a
  single stereo output, so their levels are movy's own — the Move fader does
  not reach them individually, and Movy saves them in the set itself. Set them
  with **Shift + hold track + volume encoder** — ⚠️ on tracks 5-16 the plain
  gesture *without* Shift does not work yet and moves Move's master volume
  instead, so use Shift there; tracks 1-4 take either.
- **They sound only while movy is open** — movy is what renders them.

Their modules and settings are saved with the set, so a track comes back the
way you left it.

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

![Clip parameters](docs/assets/page_clipparams.png)

**QUANT** on the [Set page](#set-parameters--shift--step-5--7--9) sets the
**default** — the strength new clips are created with, so a take you record gets
your preferred tightness immediately. Changing it never re-times clips that
already exist; each clip owns its own value from the moment it is created.


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
mode, layout, per-track octave, mutes) are stored **per Set**, so every Set
recalls its own Movy project.

Saving happens a few seconds after you stop changing things, when you switch to
another set, and when you close Movy — so leaving immediately after an edit
keeps it. Nothing is written when nothing has changed.

Each set keeps a couple of rotating backup copies of its sequence alongside the
main file. If the Move loses power or a crash interrupts a save, Movy detects
the damaged file on the next load and falls back to the newest intact copy
rather than opening a blank template. Sets saved by older Movy versions load
normally.

The instruments on each track, their settings and the master chain are saved
with the Set too.

---

## 6. Beyond Move: Step, Clip & Set parameters

These three pages add control Move doesn't expose on-device. Each opens with a
**Shift + Step** combination (or, for step parameters, by holding a step).

### Step parameters — per-trig locks

**Hold a step** that has a note. While held, **page 0** becomes the **Step**
page, showing that trig's intrinsic properties on the knobs:

![Step parameters](docs/assets/page_stepparams.png)

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

Turning a module knob while a step is held **writes a lock for that step only**:
the sound you hear now does not change. The locked value plays when the
sequencer reaches that step, with the transport running. The cell shows the
step's locked value, including any graphic (envelope, filter) that covers it.
Recording automation live (Rec + Play) is different: there you hear the turn as
you make it.

**Choices and switches can be locked too** — a filter type, a waveform, an
on/off. On a held step each knob detent moves **one option**, and the cell shows
the option the step will play:

![A held step locking an enum](docs/assets/page_held_enum.png)

Each track has **32 automation lanes**, one per parameter you lock or record.
When all 32 are taken, a held step only offers the parameters that already have
a lane, and says `32 AUTOMATION LANES — FULL`. A step's locks are applied before
its note — also for a note nudged early and for the first step after Play — so a
drum voice that takes its sound at the hit plays the locked value on that hit.

**On a drum track a lock belongs to the pad you locked it on.** A knob on a
pad's page is that pad's parameter, even on a rack whose page edits "the
selected pad": the lock plays on that pad only, and its value and lane mark show
on that pad's page, whichever pad you press next.

**Hold Clear and touch a knob** to delete that parameter's whole automation
lane. A `<param> lane cleared` prompt confirms it, and the lane's mark next to
the label goes away.

### Clip parameters — Shift + Step 3

In Track view, **Shift + Step 3** opens the **Clip** page for the active clip:

![Clip parameters](docs/assets/page_clipparams.png)

| Knob | Parameter |
| --- | --- |
| 1 | **SCALE** — the clip's musical scale. |
| 2 | **LEN** — clip length in steps. |
| 3 | **TRANS** — transpose. Reads `n/a` on a drum track (see below). |
| 4 | **QUANT** — [quantization strength](#quantization) for this clip, 0–100 %. |

(Clip parameters apply to a single clip, so this page is Track-view only.)

On a **drum track**, transpose is unavailable — the cell reads `n/a` and the knob
does nothing.

A drum module's pitches are pad addresses, not notes, so shifting them fires a
different pad — or, if the shift lands outside the module's pad range, nothing at
all. The sequencer ignores clip transpose on those tracks, including for a clip
that already carried one from before a drum module was loaded onto the track.

### Set parameters — Shift + Step 5 / 7 / 9

**Shift + Step 5, 7, or 9** opens the global **Set** page:

![Set parameters](docs/assets/page_setparams.png)

| Knob | Parameter |
| --- | --- |
| 1 | **TEMPO** |
| 2 | **SWING** |
| 3 | — (LINK to Move's transport, in Movy 0.35 and earlier) |
| 4 | **QUANT** — the [quantization](#quantization) new clips are created with |
| 5 | **ROOT** — the tonic's pitch class |
| 6 | **KEY** — scale |
| 7 | **MODE** — Chromatic or In Key |
| 8 | **LAYOUT** — the pad grid's shape |

KEY, MODE and LAYOUT are lists: turning shows the options as you go, and a jog
click opens the whole list as a menu.

MODE and LAYOUT are covered in [Pad layouts](#pad-layouts).

These are set-wide (they affect all tracks).

Press **Back** to close any of these pages and return to where you were.

The Clip and Set pages sit **side by side, not stacked**: opening one while the
other is up *replaces* it, so a single **Back** always leaves for the view you
started from — never for the other page. Switching tracks or going to Session
view closes them as well, so neither page follows you around.

### CPU meter — Shift + Step 12

**Shift + Step 12** opens the **CPU meter**: one column per track over a bar for
Movy's share of the audio block. **Back** closes it. Pressing **Shift + Step 12** again
while it is open clears the held peaks and starts a fresh observation. Like the
other page shortcuts, step 12 lights dim while Shift is held and full bright
while the page is up.

![CPU meter](docs/assets/cpu-movy-tracks.png)

The bar under the header is Movy's **budget** for one audio block. The fill is
how much of it Movy used; the notch above the bar is the worst single block
since the page opened, held for as long as the page stays open. The percentage
in the header is the same number, and it is *not* capped.

**100 % is the edge, not the ceiling.** It is calibrated against what actually
happens on the device: dropouts set in at around 70 % of the raw 2.9 ms block,
so that is what the bar calls full. Two things account for the rest. Move's own
engine takes about 240 µs of the same block. And this bar is an *average* over
blocks, while a dropout is one block missing its deadline — so an average
sitting at the raw block length would have been glitching for a long time
already. The notch is the block that gets there first; if it is near the end of
the bar, listen for it.

Practically: **under 80 % is comfortable, near 100 % you are at the edge, over
it you are hearing it.**

Each column is one track. The scale starts at **1 ms per block** and stays
there for any normal set, so a column means the same thing from one session to
the next — but if a track goes past it the whole plot re-scales to fit, and the
number at the bottom right tells you what a full-height column is now worth. It
only ever grows while the page is open; re-press **Shift + Step 12** to start
over. The row of dots across the plot marks **1 ms**: it sits at the very top
while the scale is at its floor, and drops as the scale grows, so the gap above
it shows at a glance how far the plot has been squashed. Tracks 1, 5, 9 and 13
are labelled; the rest count across from them.

The scale follows the **bars**, not the peak lines. Loading an instrument costs
several milliseconds in one block, and letting that single spike set the scale
would flatten every real column for the rest of the viewing. A peak taller than
the plot therefore clips, and its column is capped with a detached line to say
so — the same bargain any level meter makes.

| What you see | What it means |
| --- | --- |
| A solid bar | The instrument |
| Checkered on top of it | The effects after it |
| A solid bar with no checkering, even with FX loaded | A module that can't be split into a synth stage and an effects stage — it draws as one undivided bar |
| A dotted line above the bar | The worst block that track has had since you opened the page |
| A solid line across the top with a gap under it | Something on that column is off the top of the plot — usually a one-off spike in its peak, which the scale deliberately ignores (see below) |
| A short dash just above the baseline | Loaded, but silent right now, so Movy is skipping it entirely. Its peak line is still drawn — a track that spiked and then went quiet is exactly what you came here to find |
| Just the baseline | Nothing loaded |

#### Send buses

![CPU meter with send buses](docs/assets/cpu-sends.png)

As soon as any **send bus** holds an effect, three more columns appear at the
right of the plot under **SND**, one per send. The track columns narrow to make
room, and the tracks lose their `13` label — the scale, which moves to the right
of the track columns, is the more useful number of the two. A set that uses no
sends draws exactly the plot it always did.

The send columns are always all three, in bus order, whether or not each one has
an effect in it — so a bus keeps its place as you load and clear its neighbours.
They read on the same scale as the tracks, so you can compare a reverb against
the instrument feeding it directly, and a heavy send lifts the whole plot the
same way a heavy track does.

A send is an effect pass over a buffer every track has already contributed to,
so its column is checkered all the way up: there is no instrument stage to
draw. And because a bus only runs when something is feeding it or its tail is
still ringing, a send you have stopped playing into drops to a **dash** —
loaded, costing nothing this block — with its peak line still showing what it
cost when it was working.

The send phase has always counted towards the bar and the percentage at the top;
these columns just show you which bus the time went to.

#### A module that reads as free

A few modules do their synthesis in a **separate process** and hand Movy
finished audio through a shared buffer — **Virus** is the one instrument that
works this way, and the streaming modules (Radio Garden, AirPlay, Web Stream,
StreamRTSP) do too. Their column shows almost nothing, because copying that
audio out really does cost Movy almost nothing.

They are not free. The work is happening on another core, in another process,
where Movy cannot see it — so a set of six Virus tracks can run the device out
of CPU while every column on this page still looks empty. Treat a
suspiciously-empty column on a module you know is heavy as "measured elsewhere",
not as "costs nothing".

#### Chains rendering side by side

Expect an individual track to read **higher** than it would rendering alone —
around a quarter higher — while the bar at the top reads much *lower*. That is
not a bug: several chains rendering at once cost each other a little, and the
whole point is that they are running side by side instead of one after another.
The bar is the number that decides whether you get dropouts; the columns are for
finding which track is expensive.

---

### Sets — Shift + Step 1

Movy keeps **its own Sets**, separate from Move's Set pads.

![Sets](docs/assets/sets_list.png)

**Shift + Step 1** opens the list. **[NEW]** comes first, then your Sets,
newest first. A duplicate sits directly under the Set it was copied from. The
number on the right is the Set's clip count (it is left out when the name needs
the room), and the **dot** marks the Set that is open.

| Control | Action |
| --- | --- |
| **Jog** | Move the cursor. **Shift + jog** jumps eight rows. |
| **Jog click on [NEW]** | Make a new, empty Set named for today (`2026-10-10_01`, `_02`, …) and open it. |
| **Jog click on a Set** | Open it. The page closes and the Set loads. |
| **Capture** | Rename the Set under the cursor, with Schwung's on-screen keyboard. A Set still named for its date opens the keyboard on a suggested name instead (*Velvet Echo*, *Paper Moon*, …), never one another Set already has: **OK** keeps it, or edit it first. **Back** leaves the name as it was. |
| **Copy** | Duplicate the Set under the cursor as "*name* Copy". The copy carries the Set as it is right now, not its backups. |
| **Delete** | Delete the Set under the cursor. It asks first: **jog click** deletes, **Back** cancels. |
| **Back** | Close the page. |

Capture, Copy and Delete are lit dim while the cursor is on a Set, and dark on
**[NEW]** or while a delete is waiting to be confirmed. While the keyboard is
up only **Back** stays lit: the keyboard takes every other control.

![Delete confirm](docs/assets/sets_confirm.png)

Deleting the open Set opens the one below it first (or a new one, if it was
your only Set). A deleted Set is moved to
`/data/UserData/UserLibrary/Movy/Trash/`, not erased, so it can still be
recovered by hand.

**Your existing Sets come with you.** The first time Movy opens as a
standalone app it migrates every Set from Move into its library, once:

- **Every set page.** Sets parked on any of Schwung's eight set pages come
  across, not just the page Move was showing. Each keeps its Move name
  ("Set 1", "Set 2", …). When two pages each have a "Set 1", the one on the
  lowest page keeps the plain name and the others say their page: `Set 1 P3`.
- **Schwung tracks become Movy tracks.** Instruments and effects that tracks
  1–4 held in Schwung's slots, with their level and LFOs, land on Movy's
  tracks 1–4. A Set whose tracks a Schwung-era Movy had already moved, or a
  track Movy already holds, keeps what Movy has. Schwung's master chain becomes
  Movy's master. A Schwung effect that was **bypassed** is left out, so the Set
  sounds the same. The same goes for a third audio effect, which has no place on
  a Movy track. An effect with no saved preset comes up at its defaults.
- **Older Movy storage** — Sets from every earlier Movy, including those that
  kept their tracks in their UI file — is converted to the current format.
- Sets that only ever existed on an unsaved Move pad come across as
  **Recovered** *date*. A Set you deleted in Move is not brought back, and
  neither is one with nothing in it (no clip and no module).

Nothing is taken away: the originals stay where they were, so Move and
Schwung still open them exactly as you left them (edits made since then live
only in Movy's library). The migration runs **once**; Sets added to Move later
are not picked up on their own, and one you delete in Movy does not come back.
To run it again, see **MIGRATE FROM MOVE** under [Settings](#settings--shift--step-2).

**Empty Sets are not kept.** A Set with no clip and no module is never saved,
and when you switch to another Set it disappears from the list (into
`Movy/Trash/`). Tempo, scale and other settings on their own don't make a Set
worth keeping. While an empty Set is open it stays listed, so if you turn Move
off on it, Movy opens it again next time.

The library lives in `/data/UserData/UserLibrary/Movy/`, outside Movy's
module folder, so reinstalling Movy keeps it. The Set that was open when you
left reopens next time.

### Settings — Shift + Step 2

**Shift + Step 2** opens **Settings**, a scrolling list rather than a knob page:
the **jog** moves the selection, **knob 1** changes the selected row's value,
**Back** closes it. The line at the bottom explains whichever row is selected.
Step 2 lights dim under Shift and full bright while the page is open.

![Settings](docs/assets/flags-release.png)

**MIGRATE FROM MOVE**, the last row, runs the migration from Move again. The
first jog click arms it (the row reads **CONFIRM?**, and moving off disarms
it), the second runs it. The hint below shows when the migration last ran. It
**replaces every Set that came from Move** with a fresh copy, under its Move
name, and brings back one you had deleted. Each replaced Set's previous state
is kept in its **BACKUPS** first, so a mistaken run can be undone Set by Set.
Sets you made in Movy, including copies of migrated Sets, are never touched.
If the open Set is replaced, it reloads. A Set from Move that now has nothing
in it is moved to Trash instead, unless it is the one open.

Movy always renders its chains on several threads and always skips chains that
are silent. Together those are worth roughly 2× on a heavy set — the difference
between a big set staying inside the audio frame and crackling. There is
nothing to turn on or tune; the **CPU meter** (Shift + Step 12) is where you
see what it buys you.

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
parameters (master FX included),
LFO assignments, and module or preset loads.

**What isn't.** Anything that only changes what you're looking at — selecting a
track or clip, moving between bars or pages, Session mode, the browser — plus
Play, Rec, the metronome, and the keyboard layout. Undo is for edits,
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
- **The oldest edits fall off.** History holds 64 entries (and a memory budget);
  past that the oldest are discarded, and undoing that far back does nothing.
- **A no-op costs nothing.** Quantising an already-quantised clip, or a knob
  turned back to where it started, records no entry — so Undo will name the edit
  before it. That's deliberate.

**Limits.** History lives in memory and is cleared when you switch sets or
close Movy. It holds the last 64 edits. Undoing a module load restores the old
module and its parameters, but anything Movy never sees — a loaded sample's
contents, a parameter the module doesn't publish — can't come back.

![Undo unavailable](docs/assets/undo_unavailable.png)

---

## 7. Limitations vs Move

Movy aims to match Move, but it's an early prototype and several things are
missing or simplified. **All of these are candidates for future work — and
[contributions are welcome](CONTRIBUTING.md).**

- **No automation capture.** [Capture](#capture--keep-what-you-just-played)
  keeps notes; knob moves made before you press it are not captured. Record
  automation live instead.
- **Schwung modules only.** Movy sequences its own 16 chains — not Move's native
  instruments, drum racks, or sampler.
- **The CPU runs out long before 16 tracks do.** Move will typically give up
  somewhere around 6-7 tracks of ordinary synth modules playing notes. Pick
  cheap modules and it goes much further — 16 tracks of Dexed playing 2-4 notes
  each, with mverb on half of them, does run. Treat 16 as a ceiling to explore,
  not a promise.
- **Track + volume needs Shift on tracks 5-16** (see
  [Track volume](#track-volume)).
- **Tracks are silent while Movy is closed.** Every track needs Movy open to
  sound — Movy is what renders them.
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
| **Knobs 1–8** | Edit the current page's parameters. Touch (no turn) shows the full name and value in the header. |
| **Hold a file knob, then jog-click** | Open the file browser for a sample / wavetable / preset parameter (the header names the file, the bottom row reads `CLK BROWSE`). Turn to move, click to load, Back to cancel. |
| **Hold a module-screen knob, then jog-click** | Open the module's own screen (DR32's ENGN engine picker). Back climbs out a level at a time; Shift + jog leaves at once. |
| **Hold a knob (~1 s)** | Assign that parameter as an **LFO target**: jog picks LFO 1/2, jog-click assigns (hold again to remove). Automatable parameters only — and on a Schwung-drawn page, number knobs only. |
| **Jog wheel — turn** | Scroll chain slots (Chain view) or module pages (Knobs view) / browser list. On either LFO page — a track's or the master chain's — scroll between LFO 1 and LFO 2. |
| **Jog wheel — click** | Drill Chain → module pages; on Knobs (or an empty slot) open the module browser; in a browser, load the selection. |
| **Shift + jog wheel — turn** | Knobs view: one page, like a plain turn. |
| **Hold the jog (~1 s)** | Touch without turning: a bottom prompt spells out what a click does on this page. A turn or release clears it. |
| **Shift + jog click** | Chain view: open the module browser to swap the slot's module. Knobs view: Schwung's section list, to jump to a section. |
| **Back** | Module pages → Chain; browser → cancel; **at the root (Chain) → open the Leave Movy menu** (Close Movy). |
| **Shift + touch volume + jog click** | Close Movy from anywhere, even when it has stopped responding (hard close after 2 s). |
| **Volume knob** | Master volume (MASTER VOLUME slider, 1 dB per detent). |
| **Power button** | Asks **Power off?**; jog click confirms, Back cancels. |
| **Anything** (Leave menu up) | Dismisses the menu *and* does its normal job — pads, steps, Track, Clear, Capture, octave, Copy/Delete/Mute/Loop, arrows. |
| **Shift / Play / Rec** (Leave menu up) | Run normally *without* closing the menu. |
| **Parameter knobs** (Leave menu up) | Inert — the menu covers the screen, so the edit would be invisible. |
| **Hold track + volume encoder** | Set that track's volume (0–400%, 100% = unity, 1 dB per detent). Add **Shift** to see Movy's slider instead of Move's native overlay. |
| **MIX page knobs 1–2, 5–7** | VOL / PAN on the top row, SEND1 / SEND2 / SEND3 on the bottom, for the current track. All five automate like any parameter (see [The MIX page](#the-mix-page)). |
| **Jog to the master chain's first three slots** | The three **send FX**. Load one like any module; feed it with SEND1 / SEND2 / SEND3 on each track's MIX page (see [Send FX](#send-fx)). |
| **+ / −** (Up/Down) | Shift the **active track's** octave (melodic tracks only). Each track remembers its own, saved with the set. In **Session** view they step the focused **track group** instead (**+** towards tracks 1-4, **−** towards 13-16). |

### Sequencer

| Control | Action |
| --- | --- |
| **Step buttons 1–16** | Toggle a note on/off at that step. In **Session** view they select one of the 16 tracks and open it — tap to stay, hold to peek. |
| **Hold a step** | Edit that step; opens its **Step parameters** (page 0). |
| **Hold step A + press step B** | Set step A's note length up to B. |
| **Hold a step + pad** | Edit that step's notes from the keyboard. An added note takes the step's existing start and length (melodic only). |
| **Play** | Start / stop the transport. |
| **Rec** (tap) | Arm recording — one-bar count-in from stopped; while playing, punch in now (overdub) or at the next bar (new clip, Rec flashes). Tapping again stops or cancels; a pad still held is kept and gets its full played length. |
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
| **Loop + Step 1 / 3 / 5 / 7 / 9 / 11 / 13 / 15** | *(Session view)* **Scenes 1-8** — launch a whole clip column, or build a song. Loop is a modifier only there: it does not latch the bar selector. |
| **Left / Right** | Navigate bars — the loop's own bars plus one empty bar past its end (or nudge held steps). |
| **Copy** | Duplicate a step / clip / bar (context-dependent). |
| **Delete (Clear)** | Delete a step / clip / bar; in Session, delete a clip. Hold + knob-touch clears that knob's automation lane — and touching a knob is always a knob gesture, so a knob with nothing under it clears nothing and the clip is left alone. |
| **Hold Clear + pad** | Clear every note of that pad's pitch from the clip — a whole drum lane at once. |
| **Undo** | Undo the last edit. |
| **Shift + Undo** | Redo it. |
| **Mute** | Mute / unmute the current track (Track view only — Session view has no current track). Bright while anything is muted or soloed. |
| **Mute + track** | Mute that track instead; suppresses the current-track toggle on release. Addresses the focused group of four. |
| **Mute + step** | The step row becomes a 16-track mute map, in any view — mute that track directly, all 16, no group scrolling. Does not switch tracks or enter a note. |
| **Shift + Mute** | Solo / un-solo the current track (Track view only). Exclusive — soloing another moves it. |
| **Shift + Mute + track** | Solo that track instead. |
| **Shift + Mute + step** | Solo that track from the mute map. |
| **Mute + pad** (drum track) | Mute / unmute that drum voice in the sequencer — the whole track, every clip. Live pad playing is unaffected, but the press itself is silent (no note, no pad select). Latch. |
| **Shift + Mute + pad** (drum track) | Solo that drum voice instead — exclusive, press again to clear. |
| **Track buttons 1–4** | Select a track within the focused group of four (hold = momentary peek). |
| **Volume encoder** | Adjust held steps' velocity. With a track button held instead, sets that track's volume (**add Shift on tracks 5-16** — see [Track volume](#track-volume)); otherwise it is the master volume. |
| **TEMPO knob** (Set page) | Set the tempo. |

### Shift + Step shortcuts

These work **in Session view too** — the step row's own meanings there (the
track selector, and the scene launcher under Loop) leave Shift free. The one
exception is Clip Params, which needs a single clip and so stays Track-view
only.

| Combo | Action |
| --- | --- |
| **Shift + Step 1** | Open **Sets** — Movy's own Sets. |
| **Shift + Step 2** | Open **Settings** (older versions of this set, migrate Sets from Move again). |
| **Shift + Step 3** | Open **Clip parameters** (scale, length, transpose, quantize; Track view). |
| **Shift + Step 5 / 7 / 9** | Open **Set parameters** (tempo/swing/quantize, root/key/mode/layout). |
| **Shift + Step 6** | Toggle the **metronome**. |
| **Shift + Step 10** | Toggle **full velocity** — every pad note at 127. Kept across sets and restarts. |
| **Shift + Step 12** | Open the **CPU meter** (per-track and per-send cost, block usage). Press again to clear the held peaks. |
| **Shift + Step 15** | **Double** the loop. |
| **Shift + Step 16** | Cycle the current clip's **quantization** (0 / default / 100 %). |

---

## 9. Troubleshooting & recovery

- **Movy looks frozen or the screen is stale.** Hold **Shift**, touch the
  **volume knob** and click the **jog wheel**: Movy closes (saving if it can),
  then open it again.
- **Movy opens at power-on and you want Schwung.** Press **Back** in the
  two-second `Loading Movy` window at power-on and pick **Schwung**.
- **A set opens as a blank template.** Movy keeps rotating backup copies and
  falls back to the newest intact one, so this should no longer follow a freeze
  or a power-cut. If it still happens, the set's files are under
  `/data/UserData/UserLibrary/Movy/Sets/<set-id>/` (Movy 0.35 and earlier:
  `schwung/modules/tools/movy/sets/<set-uuid>/`) — `seq-state.json` plus
  `seq-state.1.json` / `seq-state.2.json`. Attach all of them to a bug report;
  each carries a generation number, which says which was written last.
- **A set went blank, or you want an earlier version of it.** Open
  **Settings → BACKUPS** (Shift + Step 2, then scroll to the last row) and pick
  one — see [Backups](#backups) below. Every Set keeps up to 32 older versions,
  and a Set that predates this feature has its existing backup copies adopted
  into the list the first time you open it.
- **A set went blank on an OLDER build, before backups existed.** Those builds
  offered `JOG CLICK = START EMPTY` on every failure, including ones where the
  Set was fine — and taking that offer blanked the Set. The previous save is
  usually still in one of the rotating copies, so it can be put back:

  ```bash
  node scripts/recover-sets.mjs move.local            # report what is recoverable
  node scripts/recover-sets.mjs move.local --apply    # put it back
  ```

  **Do it with Movy closed, and before reopening the Set** — the rescue copy
  lives in the shadow slot the next autosave writes to.

  Without a checkout of this repo, the same thing over plain SSH. First find
  which Set is affected and which copy still has the music:

  ```bash
  ssh ableton@move.local 'S=/data/UserData/schwung/modules/tools/movy/sets
  for d in "$S"/*/; do
    c=$(grep -c "^cl " "$d/seq-state.json" 2>/dev/null); c=${c:-0}
    [ "$c" != "0" ] && continue
    for n in 1 2; do
      s=$(grep -c "^cl " "$d/seq-state.$n.json" 2>/dev/null); s=${s:-0}
      [ "$s" != "0" ] && echo "$(basename $d) -> seq-state.$n.json holds $s clip(s)"
    done
  done'
  ```

  Then copy that file over **both** the canonical file and the other shadow,
  using the folder and number it printed:

  ```bash
  ssh ableton@move.local 'D=/data/UserData/schwung/modules/tools/movy/sets/<uuid>
  cp $D/seq-state.2.json $D/seq-state.json
  cp $D/seq-state.2.json $D/seq-state.1.json'
  ```

  Overwriting the other shadow is not optional. Each copy carries a generation
  number and Movy loads the highest one it can read, so a blank left in the
  other slot is newer than the rescue and still wins — restoring only
  `seq-state.json` looks right and loads empty.
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
