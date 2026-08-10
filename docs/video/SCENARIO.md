# Movy — YouTube video scenario

**Runtime:** ~10:04 · **Voice-over:** none · **Camera:** one fixed top-down shot, never moves

A single static overhead shot of the Move, plus a live inset of Movy's display
composited in post. All narration is carried by bold subtitle cards — see
[`SHOOTING-SCRIPT.md`](SHOOTING-SCRIPT.md), which pairs every card with the
action it belongs to, and [`subtitles.srt`](subtitles.srt).

**This document is the reasoning; the shooting script is what you shoot from.**
Rationale is kept out of there on purpose.

**Audience:** people who know Move's stock UI and have never heard of Schwung or
Movy. Everything that matches stock Move behaviour is shown fast and without
explanation; the time goes to what Move cannot do.

---

## Production setup

### The shot

Fixed overhead, Move filling most of the frame, hands entering from the bottom.
No zooms, no cuts, no reframing for the whole runtime. The beat is being built
live and in order, so the take is essentially continuous.

### The display inset (PiP)

Move's screen is 128×64 px and unreadable from overhead, but Movy *is* a screen
UI — the envelope graphics, the enum overlays, the `~` modulation mark are the
whole pitch. So a crisp upscaled feed of the actual display sits in a corner of
the frame, added in post.

Record it with **`scripts/capture-screen.mjs`**, which streams the display
straight to a lossless video file:

```bash
node scripts/capture-screen.mjs --stats          # measure first, no file
node scripts/capture-screen.mjs screen.mp4 --fps 30 --scale 6
```

Start it just before the take, stop it with Ctrl-C after, and sync it to the
camera on the first Play. Output is 768×384 and pixel-exact — nearest-neighbour
only, because the display is 1-bit and smooth interpolation turns crisp pixels
into grey mush.

**It does not cost the device anything measurable.** Measured on hardware
(idle ticks per 10 s, 4000 = four fully idle cores):

| Condition | Idle | CPU used | Rate achieved |
| --- | --- | --- | --- |
| Baseline | 3178 / 3180 | — | — |
| Streaming at 30 fps | 3133 | 4.5 % of one core | 29.2 fps |
| Per-frame `scp` | 2837 | 34 % of one core | ~2.3 fps |

That is ~0.15 vs ~14.8 CPU ticks per frame — about 100× cheaper. The script holds
one SSH connection open for the whole capture precisely for this reason: a
per-frame `scp` (the way `grab-screen.mjs` grabs single stills) pays an SSH
handshake and an sshd fork every frame, needs 13 s to fetch one second of
30 fps video, and since Movy's tick period doubles as its MIDI input sampling
interval, that load would surface as worse pad latency in the very video meant to
sell the instrument.

A 55-second soak held 29.8 fps with one repeated and one superseded frame.
Output is lossless — a frame pulled back out of the MP4 is pure black and white
with no interpolated values.

`--stats` reports the achieved rate without writing a file; run it once before
committing to a ten-minute take. Rates are timed from the first frame, so the
figure reflects the link rather than SSH startup.

Requires `ffmpeg` on the recording machine (`brew install ffmpeg`).

### The kit

| Track | Module | Role |
| --- | --- | --- |
| 1 | **Mr Drums** | Kick, clap, hats |
| 2 | **Weird Dreams** | Synth percussion, toms |
| 3 | **OB-Xd** | Bass |
| 4 | **Helm** | Acid lead |

Dark, hypnotic techno, ~130 BPM. The genre earns its keep here: it is built on a
repeating loop, so every feature demo doubles as musical progress, and constant
knob movement is idiomatic rather than a distraction.

**Prepare before rolling:** the finished loop saved to a set for the cold open,
then a second empty set for the build. All four modules already downloaded on the
device. Start the take from the empty set.

---

## Segment map

| Time | Segment | Feature |
| --- | --- | --- |
| 0:00 | Cold open | Hook — the finished beat + flashes of the good stuff |
| 0:45 | What is this | Schwung, Movy, install |
| 1:30 | Track 1 | Mr Drums, **loading a drum rack preset**, 4×4 rack, per-pad pages, live record |
| 3:05 | Track 2 | Weird Dreams, step recording |
| 4:00 | Beyond Move ① | Step parameters (p-locks) |
| 5:00 | Track 3 | OB-Xd, in-key pads, live record |
| 5:45 | Beyond Move ② | Clip page — quantize + scale |
| 6:30 | Track 4 | Helm, deep pages, envelope + filter graphics |
| 7:30 | LFO | Hold-to-assign on the bass |
| 8:15 | Automation | Filter sweep + undo/redo |
| 9:00 | Session | Clip launching, background mode, LINK |
| 9:20 | Outro | AI disclosure, Discord, links |

---

## 0:00–0:45 — Cold open

**Playing:** the finished loop, full arrangement, from the prepared set.

Hands move over the pads and knobs with intent — playing the loop, not
explaining it. No gesture needs to be legible here; this is a mood shot.

**PiP:** cycles fast through the strongest screens, roughly one every 3–4
seconds, timed to the subtitle cards that name them:

1. The chain view
2. A dual envelope graphic (`env_dual`)
3. A filter response curve (`filter_lp_reso`)
4. The step parameter page (`step_page_knobs`)
5. An LFO waveform (`lfo_lfo1`)

**Why this order:** the four flashes are, in order, the four things a Move owner
cannot get anywhere else. The viewer decides whether to keep watching inside the
first 20 seconds, so the differentiators go first and the explanation waits.

The loop keeps playing under the last cards, then drops out on the cut to the
empty set.

---

## 0:45–1:30 — What is this

**Playing:** nothing. Empty set, chain view showing four empty slots.

Hands rest. This is the only passive stretch in the video and it is kept to 45
seconds for exactly that reason.

**PiP:** the empty chain view, then two still cards composited full-inset for the
install steps — Schwung's web UI module store with Movy in the list, and Movy's
entry in Schwung's Tools menu on the device.

**The three facts, in this order:**

1. Move runs its own firmware. Schwung is a free community framework that runs
   custom synths and effects on it.
2. Movy is a *tool* inside Schwung: every module gets **Elektron-style knob
   pages**, and it adds a 4-track sequencer.
3. Install Schwung, then install Movy from Schwung's own module store. Two steps,
   no building, no terminal.

**Why so compressed:** the install genuinely is two steps now that Movy is in the
public catalog. Spending more than 45 seconds on it would cost a feature segment
and tell the viewer this is complicated when it isn't. The details live in
[`GETTING-STARTED.md`](GETTING-STARTED.md), linked in the description.

**"Knob pages", never "UI".** The cards say *Elektron-style knob pages* because
"UI" names a category where the viewer needs to picture a thing — and "knob
pages" is both literally what's on screen and Elektron's own vocabulary, so it
lands for people who know those boxes without losing anyone who doesn't. The
same reason "behind Move's screens" replaced "behind Move's UI" at 9:00.

Naming Elektron here also sets up the callback at 4:00, where the step page is
introduced as "ELEKTRON CALLS THESE P-LOCKS" — by then the comparison has already
been made, so that card confirms a promise instead of making a new claim.

---

## 1:30–3:05 — Track 1: Mr Drums, and loading a kit

**Mr Drums loads empty.** It is a sample player, so until a kit is loaded the
pads are silent — the demo cannot skip this, and a video whose first minute of
"playing" makes no sound is dead on arrival. So the kit load is staged as the
first real feature rather than as setup.

That turns out to be lucky, because it is genuinely reassuring material for this
audience: the presets it loads are **native Move drum racks** (`.ablpreset` files
under `UserLibrary/Track Presets`, filtered to drum racks), so a Move owner's
existing kits work untouched — including kits converted from elsewhere.

**Gesture sequence:**

1. Jog-click the empty slot → module browser opens
2. Turn jog to Mr Drums → jog-click to load
3. Pads switch to the 4×4 drum rack — and are silent
4. Jog to **page 4, Preset**
5. **Hold the PRSET knob, then click the jog** → the file browser opens
6. Jog through the kits, jog-click to load one
7. Play the pads — now they sound
8. Press the kick pad → knobs re-read that voice (per-pad page)
9. Tune the kick
10. Shift + Step 6 → metronome on
11. Rec (tap) → one-bar count-in → play kick, then clap

**PiP:** browser list → the empty rack → the Preset page → the file browser
listing kits → `drum-mrdrums-global` with the pad icon in the header tracking
the selection.

**Use a converted Maschine kit here.** "These are Move drum racks — and this one
came from Maschine" is a stronger line than either half alone: it says the kits
you own already work, *and* that the door is open to kits from elsewhere. Pick
one with an obviously characterful kick so the payoff at step 7 is audible.

**Teach the gesture once, use it twice.** Hold-knob-plus-jog-click is the same
gesture that swaps an individual pad's sample on page 1 (`SAMPL`), so the
subtitles name that immediately after the per-pad page appears. It is also a
third kind of browser after the module browser and the enum overlay — the cards
keep it concrete ("HOLD THE KNOB — CLICK THE JOG") rather than naming it.

**Why the per-pad page:** it is where Movy's drum handling visibly differs from a
plain knob grid — the header's pad icon following your pad press is a two-second
idea that lands without explanation.

**Production notes:**

- **Check the preset loads instantly.** If loading a kit takes a beat, that is
  dead air on a static shot; the "CLICK TO LOAD" card is placed to cover it, but
  time the real thing before the take and widen that gap if needed.
- The kit must be on the device and reachable from
  `/data/UserData/UserLibrary/Track Presets` before rolling.
- Step editing is no longer demoed here — it now appears in the step-recording
  and step-parameter segments, which do it better.

---

## 3:05–4:00 — Track 2: Weird Dreams (step recording)

**Setup:** load Weird Dreams on track 2, audition two or three voices. Keep it
brief — the module is the excuse, step recording is the subject.

**Gesture sequence:**

1. Transport **stopped**
2. Hold **Rec** — the head appears, blinking red on the step row
3. Play a fast percussion figure, one pad per step
4. Press **Right** to leave a rest
5. Press **Left** to step back — that step's note plays and its pad lights
6. Replay it
7. Release Rec

**PiP:** `step_rec_header` — the head position and the notes under it, with the
module's parameters still visible underneath.

**The point to make:** nothing is timed. A phrase nobody could play in real time
goes in as fast as you can find the notes. And on an empty clip, the clip grows
to exactly what you played — seven notes gives a seven-step clip, which is a
genuinely different mental model from "16 steps, fill some in".

**Why Weird Dreams:** synth drums have more character than sampled ones on a
static shot where you cannot see a waveform, and it is one of the drum modules
that ships a Movy layout template, so the demo works out of the box.

It also makes sound the moment it loads, which is the useful contrast after
Mr Drums — the card "NOTHING TO LOAD — IT JUST PLAYS" both explains the
difference and quietly tells the viewer that the previous segment's kit-loading
step was about Mr Drums being a sampler, not about Movy being fiddly.

⚠️ **Verify this before the take.** That card assumes Weird Dreams is audible on
load with no preset. It is a synthesis module rather than a sample player so it
should be, but Mr Drums was expected to be too. Load it on a clean slot and hit a
pad; if it also needs a preset, drop the card and fold the load into the same
gesture the viewer just learned — it costs about eight seconds and the segment
has the room.

---

## 4:00–5:00 — Beyond Move ①: Step parameters

The pivot of the video. The percussion loop from the previous segment repeats
identically every bar, and the subtitles name that as the problem before showing
the fix.

**Gesture sequence:**

1. **Hold a step** that has a note → page 0 becomes the Step page
2. Knob 1 **VEL** — accent it
3. Knob 3 **PROB** → 60% — "fires 6 times in 10"
4. Knob 4 **COND** → `2:3` — "fires on the 2nd of every 3 bars"
5. Knob 5 **INV** — flip it
6. Release, let the loop run four bars

**PiP:** `step_page_knobs`, held long enough to actually read the five cells.

**Why this is the centrepiece:** it is Elektron-style parameter locks on a Move,
it is audible within four bars, and it needs exactly one gesture to reach. Let
the loop play for a good 8–10 seconds after the edits with no new subtitle card —
the viewer needs to *hear* the pattern stop repeating, and a card would compete
with that.

---

## 5:00–5:45 — Track 3: OB-Xd (in-key pads, live record)

**Gesture sequence:**

1. Load OB-Xd on track 3
2. **Shift + Step 5** → Set page
3. Knob 5 **ROOT**, knob 6 **KEY** → set the key
4. Knob 7 **MODE** → **In Key** (enum overlay opens and scrolls)
5. Knob 8 **LAYOUT** → 4th
6. Back → pads are now folded to the scale
7. **Rec** → count-in → play the bass line by hand, slightly loose

**PiP:** `main-default` → `main-mode-overlay` → `main-layout-overlay` → the
keyboard view.

**Why deliberately loose:** the sloppy take is the setup for the next segment.
Play it a little behind the beat on purpose and let the subtitles admit it.

**This segment paid for the kit load.** It lost 15 seconds so Track 1 could gain
them, and the cut came from here because the Set page is the most Move-adjacent
idea left — Move owners already understand scales and root notes. Steps 3–5 now
run as one continuous move with a single card ("SET MODE TO IN KEY") rather than
a card per knob. Keep turning ROOT and LAYOUT on camera; just don't wait for the
subtitles to catch up.

**Depth note:** OB-Xd's own parameter pages are *not* toured here — Helm carries
the deep-synth segment. OB-Xd stays a bass sound until it comes back as the LFO
target at 7:30, which gives it a second appearance without a second tour.

---

## 5:45–6:30 — Beyond Move ②: Clip page

**Shift + Step 3** opens the clip page. SCALE, LEN, TRANS and QUANT are all on
this one page, so two separate features cost one page visit.

**Gesture sequence:**

1. Shift + Step 3
2. Knob 4 **QUANT** → 0% — the bass sits exactly where it was played
3. Turn to 100% — snaps to the grid
4. Turn back to ~40% — and the original feel is still there
5. Knob 1 **SCALE** → minor to phrygian, over the playing loop

**PiP:** `clip-default`, then `clip-quant`.

**Why this order:** quantize first, because the loose take is fresh in the ear.
The idea worth landing is that quantization is a *value the clip carries*, not
an action performed on it — turning it back down restores the timing, because
nothing was ever rewritten. That is a real conceptual difference from Move and it
is provable in eight seconds of knob turning.

Then scale, on the same page, with bass and lead already recorded — so turning
SCALE re-maps notes the viewer can already hear rather than changing an abstract
setting before anything exists. Per-clip, not per-set, is the part to stress.

---

## 6:30–7:30 — Track 4: Helm

**Gesture sequence:**

1. Load Helm on track 4
2. Turn the jog to walk pages
3. **Shift + jog** to jump by section
4. Land on an amp envelope page — the ADSR is drawn as one envelope
5. Land on a filter page — the response curve is drawn
6. Open an enum parameter → the overlay scrolls
7. Land on one of Helm's own LFO pages, briefly

**PiP:** the deep pages in sequence — `deep_page`, `env_dual`, `filter_lp_reso`,
`enum_overlay`, `lfo_helm_pyramid`.

**Why Helm:** 30 pages generated automatically from what the module publishes,
with no hand-written layout. The claim that lands is "nobody drew this by hand —
Movy found the ADSR and drew the envelope, found the filter and drew the curve".
That is the argument for why *every* Schwung module gets a usable UI, made
concrete on the deepest one available.

**The 8-second nod:** Helm has its own internal LFOs and Movy lays those out like
any other pages. Naming that here prevents the confusion in the next segment —
otherwise "hold a knob to assign an LFO" reads as a Helm feature rather than a
Movy one.

---

## 7:30–8:15 — LFO: hold to assign

Deliberately performed on **OB-Xd**, not Helm.

**Gesture sequence:**

1. Track 3, navigate to OB-Xd's filter cutoff
2. **Hold the knob** ~1 second without turning → prompt appears
3. Turn jog → `LFO1`
4. Jog-click → assigned, and the view jumps to the LFO page
5. Turn **SHAPE** — the waveform preview morphs live
6. Turn **PHASE** — the wave slides
7. Turn **SYNC** on
8. Set **DEPTH**
9. Back to the module page — the `~` mark sits by the parameter label

**PiP:** `lfo_assign_toast` → `lfo_lfo1` → `lfo_mod_and_auto`.

**Why OB-Xd:** a moving filter on a techno bass is instantly audible on a
top-down shot with no scope, and using a module that has *no* LFOs of its own
makes it unambiguous that the two LFOs came from Movy, per track, assignable to
any automatable parameter in the chain.

**The fact worth a card:** with Sync on, the LFO phase-locks to song position —
bar-aligned and drift-free however long it runs. It is the sort of detail that
tells a viewer the thing was built by someone who cared.

---

## 8:15–9:00 — Automation and undo

**Gesture sequence:**

1. Track 4 (Helm), **Rec**, count-in
2. Sweep the filter cutoff across two bars
3. Stop — the arc now follows playback on its own
4. **Undo** → overlay names what was undone
5. **Shift + Undo** → redo
6. Let it play

**PiP:** `auto_live` → `undo_toast` → `redo_toast`.

**Why pair them:** automation is the risky-feeling edit, so following it
immediately with undo answers the anxiety it creates. The specific claim is that
one gesture is one undo — a whole knob turn, or one pass of recording, not 200
tiny steps — and that it covers notes, clips, automation, parameters and module
loads alike.

---

## 9:00–9:20 — Session view and the fast flashes

**Gesture sequence:**

1. **Note/Session** → clip grid, pads launch clips
2. Launch a couple of clips over the running loop
3. Three-second flash: Back at the root → Leave menu → Background
4. Three-second flash: Set page with **LINK** on

**PiP:** the session grid, `leave_modal`, `main-link-on`.

Background mode and Move-transport LINK get a card each and no more. They are
strong features but they are hard to *show* in a top-down shot — the payoff is
that nothing visibly changes — and the video has already spent its budget on
things the camera can prove.

---

## 9:20–10:05 — Outro

**Playing:** the full loop, all four tracks, running out under the closing cards.

Hands perform: mutes, a filter sweep, a clip launch. No new features introduced —
this is the "you could be doing this" shot, and it should look effortless.

**The cards, in order:**

1. Four tracks, one Move, no computer in the chain
2. Movy is an early prototype — expect rough edges, it's free
3. **Everything here was built with AI — the code, and this video's script**
4. **Every idea came from a human**
5. Join **#movy** in the Schwung Discord
6. Links below

**On the AI disclosure:** it goes near the end, stated plainly and without
hedging, and it is immediately followed by the human-authorship card. Putting it
up front would reframe the whole video as an AI demo rather than an instrument
demo; burying it entirely would be worse. Two adjacent cards, no apology.

---

## What was cut, and why

| Cut | Reason |
| --- | --- |
| **Capture** | Overlaps live recording for a newcomer; costs ~60s to explain the tempo-detection payoff properly. Worth its own short video. |
| **Track volume** | Hold track + volume encoder is a great gesture but invisible on camera. |
| **FX slots 1 & 2** | The chain walk implies them; a dedicated FX segment adds no new *kind* of idea. |
| **Clip LEN / TRANS** | On screen during the clip-page segment, never named — the page visit already earns its time via QUANT and SCALE. |
| **Mute / solo, loop editing, copy/delete** | All match Move closely. Visible in passing, never explained. |
| **Forge / Libpo32 per-voice pages** | Excellent material, but a second drum module is one too many for a 10-minute first-contact video. |
| **Background mode, LINK** | Reduced to 3-second flashes — genuinely useful, but their payoff is the *absence* of visible change. |
| **Step editing in Track 1** | Tapping steps on/off was cut when the kit load moved in. Step entry is covered better by the step-recording and step-parameter segments, and it was the segment's least informative beat — the one the old subtitles admitted was "nothing new". |

**Where the 25 seconds for the kit load came from:** OB-Xd −15 s (the Set page
runs as one move instead of a card per knob), Weird Dreams −5 s, Session −5 s
(one card fewer), Outro −5 s. Spread thin on purpose — gutting one segment to
fund another would have cost more than trimming four.

---

## Deliverables

| File | What it is |
| --- | --- |
| [`SCENARIO.md`](SCENARIO.md) | This document |
| [`SHOOTING-SCRIPT.md`](SHOOTING-SCRIPT.md) | **Shoot from this** — every subtitle beside what happens on screen, in order |
| [`subtitles.srt`](subtitles.srt) | The same cards as a timed SRT, ready to import |
| [`GETTING-STARTED.md`](GETTING-STARTED.md) | Short install guide to link from the description |
| [`DESCRIPTION.md`](DESCRIPTION.md) | YouTube description with chapters and links |
