# Movy — YouTube video scenario

**Runtime:** ~10:40 · **Voice-over:** none · **Camera:** one fixed top-down shot, never moves

A single static overhead shot of the Move, plus a live inset of Movy's display
composited in post. All narration is carried by bold subtitle cards — see
[`SHOOTING-SCRIPT.md`](SHOOTING-SCRIPT.md), which pairs every card with the
action it belongs to, and [`subtitles.srt`](subtitles.srt).

**This document is the reasoning; the shooting script is what you shoot from.**
Rationale is kept out of there on purpose.

**Audience:** people who know Move's stock UI and have never heard of Schwung or
Movy. Non-technical, but fluent in synths — envelope, filter, LFO and p-lock need
no explaining; firmware, frameworks and parameter hierarchies do, and therefore
have no place in a subtitle.

Everything that matches stock Move behaviour is shown fast and without
explanation; the time goes to what Move cannot do.

### The rule for every card

**A card may say what the viewer sees, hears, or should press. It may not explain
how Movy works.** Cards that broke this and were cut:

| Cut | Why | Became |
| --- | --- | --- |
| MOVE RUNS ITS OWN FIRMWARE | Technical framing of a musical problem | MOVE ONLY PLAYS ITS OWN SOUNDS |
| MOVY BUILT THIS FROM THE SYNTH | About the software, not the sound | THE WHOLE SYNTH ON EIGHT KNOBS |
| NOBODY DREW IT BY HAND | Implementation trivia | *(cut)* |
| IT FOUND THE ATTACK AND DECAY | Narrates detection, not music | THERE'S THE ENVELOPE |
| TURN A KNOB — IT REDRAWS | Describes the screen updating | SHORTER DECAY, LONGER RELEASE |
| SHIFT + JOG SKIPS BY SECTION | A shortcut nobody needs on first contact | *(cut)* |

The pattern: the viewer does not care that the pages are generated. They care
that the synth is on the knobs and the envelope is right there. State the result;
the cleverness is implied by it working.

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

| Track | Module | Role | Introduced |
| --- | --- | --- | --- |
| 1 | **OB-Xd** | Bass | 1:41 |
| 2 | **Mr Drums** | Kick, clap, hats | 3:30 |
| 3 | **Weird Dreams** | Synth percussion, toms | 5:31 |
| 4 | **Helm** | Acid lead | 7:25 |

Dark, hypnotic techno, ~130 BPM. The genre earns its keep here: it is built on a
repeating loop, so every feature demo doubles as musical progress, and constant
knob movement is idiomatic rather than a distraction.

**Why a synth first, not the drums.** Movy is a screen-and-knobs tool, so the
first thing it should be seen doing is drawing a good screen. Mr Drums is the
worst possible opener for that: it loads empty, its Main page is `SAMPL VOL PAN
TUNE`, and the first feature the viewer would meet is a *file browser*. OB-Xd is
the opposite — Movy generates **three envelope graphics** for it, and its Main
page carries a full ADSR *and* cutoff/resonance together, so one page delivers a
live-redrawing envelope and a moving filter curve inside thirty seconds.

Track order is introduction order, so the viewer never has to track a mapping.

**Prepare before rolling:** the finished loop saved to a set for the cold open,
then a second empty set for the build. All four modules already downloaded on the
device, and the drum kit reachable in `UserLibrary/Track Presets`. Start the take
from the empty set.

---

## Segment map

| Time | Segment | Feature |
| --- | --- | --- |
| 0:00 | Cold open | Hook — the finished beat + flashes of the good stuff |
| 0:45 | What is this | Schwung, Movy, works with everything, install |
| 1:41 | Track 1 — OB-Xd | Knob pages, envelope, filter curve, piano pads, Capture, step automation |
| 3:30 | Track 2 — Mr Drums | Loading a drum rack, 4×4 rack, per-pad pages, live record |
| 4:42 | Beyond Move ① | Clip page — quantize + scale |
| 5:31 | Track 3 — Weird Dreams | Step recording |
| 6:26 | Beyond Move ② | Step parameters (p-locks) |
| 7:25 | Track 4 — Helm | 34 pages, generated automatically |
| 8:20 | LFO | Hold-to-assign on the bass |
| 9:00 | Automation | Filter sweep + undo/redo |
| 9:41 | Session | Clip launching, background mode, LINK |
| 10:01 | Outro | AI disclosure, Discord, links |

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

## 0:45–1:40 — What is this

**Playing:** nothing. Empty set, chain view showing four empty slots.

Hands rest. This is the only passive stretch in the video, which is why it is
kept under a minute.

**PiP:** the empty chain view, then two still cards composited full-inset for the
install steps — Schwung's web UI module store with Movy in the list, and Movy's
entry in Schwung's Tools menu on the device.

**The four facts, in this order:**

1. Move only plays its own sounds. Schwung adds new ones — free, community built.
2. Movy is a *tool* inside Schwung: every module gets **Elektron-style knob
   pages**, and it adds a 4-track sequencer.
3. **It works with everything in the Schwung store** — synths, drums and effects
   alike, with no setup per module.
4. Install Schwung, then install Movy from Schwung's own module store. Two steps,
   no building, no terminal.

**Fact 3 is the one that converts.** A viewer who likes what they see will
immediately wonder whether it works with the module *they* already installed, and
the answer is yes — Movy reads each module's own parameter list, so it does not
need to have heard of it. The claim is made here and then paid off at 7:25, where
Helm's 34 pages are the evidence. Two cards early, one card late; never argued.

**No "firmware", no "framework".** An earlier draft opened with "MOVE RUNS ITS
OWN FIRMWARE", which is both true and useless to someone who wants to make a
beat. "Move only plays its own sounds / Schwung adds new ones" says the same
thing in the viewer's terms.

**Why so compressed:** the install genuinely is two steps now that Movy is in the
public catalog. Spending more than 45 seconds on it would cost a feature segment
and tell the viewer this is complicated when it isn't. The details live in
[`GETTING-STARTED.md`](GETTING-STARTED.md), linked in the description.

**"Knob pages", never "UI".** The cards say *Elektron-style knob pages* because
"UI" names a category where the viewer needs to picture a thing — and "knob
pages" is both literally what's on screen and Elektron's own vocabulary, so it
lands for people who know those boxes without losing anyone who doesn't. The
same reason "behind Move's screens" replaced "behind Move's UI" at 9:41.

Naming Elektron here also sets up the callback at 6:26, where the step page is
introduced as "ELEKTRON CALLS THESE P-LOCKS" — by then the comparison has already
been made, so that card confirms a promise instead of making a new claim.

---

## 1:41–3:29 — Track 1: OB-Xd

The opener, and the segment that has to earn the next nine minutes. Movy is a
screen-and-knobs tool, so the first thing it is seen doing is drawing a screen
worth looking at.

**Gesture sequence:**

1. Jog-click the empty slot → module browser opens
2. Turn jog to OB-Xd → jog-click to load
3. Play chords — it sounds immediately, with no setup
4. Hands off; hold on the **Main** page
5. Turn DECAY, then RELEASE — the envelope graphic reshapes live
6. Turn CUTOFF — the filter curve slides
7. Turn RESONANCE — the peak grows
8. Play a chord: the sound you just designed
9. **Shift + Step 5** → Set page; knob 8 **LAYOUT** → **Piano**
10. Pads relight as two octaves of piano; run a hand up them
11. Transport already running — **just play** the bass line, a little behind
12. Press **Capture** — the take lands in the clip and loops
13. **Hold one step**, and turn CUTOFF while holding it
14. Release — that one note now plays brighter than the rest

**PiP:** module browser → OB-Xd Main page → `env_dual` → `filter_lp` →
`filter_lp_reso` → `main-default` → `main-layout-overlay` → keyboard view →
`auto_live`.

**Why OB-Xd specifically.** Movy's replay snapshot records `envelopeLines: 3` for
it — three separate envelope graphics across its pages — and its **Main** page
carries `ATTACK DECAY SUSTAIN RELEASE CUTOFF RESONANCE` together. One page,
without navigating anywhere, gives a live-redrawing envelope and a moving filter
curve. It is also a sound a Move owner recognises instantly, and it needs no
preset to make noise.

**Piano layout, not In Key.** Move already has scales and an in-key pad mode, so
selling that back to a Move owner spends time on something they have. The **piano
layout** is the one Move does not offer — two octaves with black keys and white
keys where you expect them — so that is what the cards name, framed as
"Move has scales too, but not a piano layout".

**Capture, not Rec.** Capture is the better story for an opener: no arming, no
count-in, no committing before you know whether the take is any good. Play until
something works, then keep it. It also leaves the take exactly as played, which
is what the quantize demo at 4:42 needs.

**Then step automation, in three cards.** Holding a step and turning a module
knob locks that value to that step — an Elektron p-lock, reached with a gesture
the viewer has already seen. It goes here rather than in the automation segment
because it is the cheapest possible demonstration that the knob pages and the
sequencer are the same instrument, not two features side by side.

**Play the bass loose on purpose.** It sets up the quantize demo at 4:42, and the
card "MY TIMING IS HUMAN. THAT'S FINE." tells the viewer the sloppiness is
deliberate — otherwise it reads as bad playing for two minutes.

**Depth note:** OB-Xd's other 14 pages are not toured. Helm carries scale; this
segment carries *quality*.

---

## 3:30–4:41 — Track 2: Mr Drums, and loading a kit

**Mr Drums loads empty.** It is a sample player, so until a kit is loaded the
pads are silent. That is why it is no longer the opener — but it lands fine here,
because the viewer has already seen Movy draw a good screen and now has bass
playing underneath.

The presets are **native Move drum racks** (`.ablpreset` files under
`UserLibrary/Track Presets`, filtered to drum racks), so a Move owner's existing
kits work untouched — including kits converted from elsewhere.

**Gesture sequence:**

1. Track 2, jog-click, load Mr Drums
2. Pads switch to the 4×4 drum rack — and are silent
3. Jog to **page 4, Preset**
4. **Hold the PRSET knob, then click the jog** → the file browser opens
5. Jog through the kits, jog-click to load one
6. Play the pads over the bass — now they sound
7. Press the kick pad → knobs re-read that voice (per-pad page)
8. Jog to page 1 and **turn** the `SAMPL` knob — samples scroll inline
9. **Rec** → count-in → play kick, then clap

**PiP:** the empty rack → the Preset page → the file browser listing kits →
`drum-mrdrums-global` with the pad icon in the header tracking the selection.

**Use a converted Maschine kit here.** "These are Move drum racks — and this one
came from Maschine" says the kits you own already work, *and* that the door is
open to kits from elsewhere. Pick one with a characterful kick.

**Two file pickers, and the segment uses the easy one twice over.** Movy has
both: *turning* a file knob scans the current folder and scrolls it inline, like
an enum; *holding* it and clicking the jog opens the full directory browser. The
kit needs the browser because it navigates to `Track Presets`. Swapping one pad's
sample does not — you just turn the knob — so that is what the cards show. It
lands as "turn it to swap the sample", which needs no explaining at all.

**Production notes:**

- **Time the preset load before the take.** If it takes a beat, that is dead air;
  the "CLICK TO LOAD" card is placed to cover it. Widen the gap if needed.
- The module browser is not re-explained here — it was taught at 1:45.

---

## 4:42–5:30 — Beyond Move ①: Clip page

**Shift + Step 3** opens the clip page. SCALE, LEN, TRANS and QUANT all live on
this one page, so two features cost one page visit.

**Gesture sequence:**

1. Press track 1 (the bass), then Shift + Step 3
2. Knob 4 **QUANT** → 0% — the bass sits exactly where it was played
3. Turn to 100% — it locks to the kick
4. Turn to ~40% — the original feel is still there
5. Turn back to 0
6. Knob 1 **SCALE** → minor to phrygian, over the playing loop

**PiP:** `clip-default`, then `clip-quant`.

**This is why the clip page moved after the drums.** Quantization is a timing
feature, and timing is only audible against a reference. A loose bass on its own
sounds like a choice; the same bass against a four-on-the-floor kick sounds
*wrong*, and fixing it is instantly satisfying. Sequencing this segment before
the drums would have thrown away the whole demonstration.

The idea worth landing is that quantization is a **value the clip carries**, not
an action performed on it — turning it back down restores the timing, because
nothing was ever rewritten.

Then scale, on the same page. Per-clip, not per-set, is the part to stress.

---

## 5:31–6:25 — Track 3: Weird Dreams (step recording)

**Setup:** load Weird Dreams on track 3, audition two or three voices. Keep it
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
to exactly what you played — seven notes gives a seven-step clip.

**Why Weird Dreams:** synth drums have more character than sampled ones on a
static shot, and it makes sound the moment it loads — the useful contrast after
Mr Drums.

⚠️ **Verify before the take.** The card "NOTHING TO LOAD — IT JUST PLAYS" assumes
Weird Dreams is audible on load with no preset. It is a synthesis module so it
should be, but Mr Drums was expected to be too. Load it on a clean slot and hit a
pad; if it also needs a preset, drop the card and reuse the gesture from 3:30.

---

## 6:26–7:24 — Beyond Move ②: Step parameters

The percussion loop from the previous segment repeats identically every bar, and
the subtitles name that as the problem before showing the fix.

**Gesture sequence:**

1. **Hold a step** that has a note → page 0 becomes the Step page
2. Knob 1 **VEL** — accent it
3. Knob 3 **PROB** → 60%
4. Knob 4 **COND** → `2:3`
5. Knob 5 **INV** — flip it
6. Release, let the loop run four bars

**PiP:** `step_page_knobs`, held long enough to actually read the five cells.

**Why this is the centrepiece:** Elektron-style parameter locks on a Move,
audible within four bars, one gesture to reach. Let the loop play for 8–10
seconds after the edits with no new subtitle card — the viewer needs to *hear*
the pattern stop repeating, and a card would compete with that.

---

## 7:25–8:19 — Track 4: Helm

**Gesture sequence:**

1. Load Helm on track 4
2. Play a lead line
3. Turn the jog to walk pages
4. Land on an envelope page, then the step sequencer pages
5. Open an enum parameter → the overlay scrolls
6. Land on one of Helm's own LFO pages
7. Play the lead over the running loop

**PiP:** `deep_page`, `env_dual`, `enum_overlay`, `lfo_helm_pyramid`.

**Helm's job is scale, not beauty.** OB-Xd already proved the pages look good, so
repeating "look, an envelope" here would be a flat second helping. The claim now
is *how much* Movy generates unattended: OB-Xd had 16 pages, Helm has 34 — three
envelopes, two LFOs, a step sequencer and an arpeggiator — and Movy was never
told anything about either synth. It read them.

⚠️ **Check the page count on the device.** 34 comes from Movy's replay snapshot
(`browser-test/dump-expect.json`); the README still says 30. If the device
disagrees, fix the card rather than the device.

**The nod that matters:** Helm has its own internal LFOs and Movy lays them out
like any other page. Naming that here prevents confusion in the next segment —
otherwise "hold a knob to assign an LFO" reads as a Helm feature.

---

## 8:20–8:59 — LFO: hold to assign

Deliberately performed on **OB-Xd**, not Helm.

**Gesture sequence:**

1. Track 1, navigate to OB-Xd's filter cutoff
2. **Hold the knob** ~1 second without turning → prompt appears
3. Turn jog → `LFO1`; jog-click → assigned, view jumps to the LFO page
4. Turn **SHAPE** — the waveform preview morphs; **PHASE** — it slides
5. Turn **SYNC** on; set **DEPTH**
6. Back to the module page — the `~` mark sits by the parameter label

**PiP:** `lfo_assign_toast` → `lfo_lfo1` → `lfo_mod_and_auto`.

**Why OB-Xd:** a moving filter on a techno bass is instantly audible, and Movy
draws **no** LFO waveform for OB-Xd's own LFO pages (`lfoViz: 0` in the snapshot)
— so every LFO graphic on screen in this segment unambiguously belongs to Movy,
not to the module.

**The fact worth a card:** with Sync on, the LFO phase-locks to song position —
bar-aligned and drift-free however long it runs.

---

## 9:00–9:40 — Automation and undo

**Gesture sequence:**

1. Track 4 (Helm), **Rec**, count-in
2. Sweep the filter cutoff across two bars
3. Stop — the arc now follows playback on its own
4. **Undo** → overlay names what was undone
5. **Shift + Undo** → redo

**PiP:** `auto_live` → `undo_toast` → `redo_toast`.

**Why pair them:** automation is the risky-feeling edit, so following it
immediately with undo answers the anxiety it creates. One gesture is one undo — a
whole knob turn, or one pass of recording — covering notes, clips, automation,
parameters and module loads alike.

---

## 9:41–10:00 — Session view and the fast flashes

**Gesture sequence:**

1. **Note/Session** → clip grid, pads launch clips
2. Launch a couple of clips over the running loop
3. Three-second flash: Back at the root → Leave menu → Background
4. Three-second flash: Set page with **LINK** on

**PiP:** the session grid, `leave_modal`, `main-link-on`.

Background mode and Move-transport LINK get a card each and no more. Their payoff
is that nothing visibly changes, which a top-down shot cannot sell.

---

## 10:01–10:40 — Outro

**Playing:** the full loop, all four tracks, running out under the closing cards.

Hands perform: mutes, a filter sweep, a clip launch. No new features — this is
the "you could be doing this" shot, and it should look effortless.

**The cards, in order:**

1. Four tracks, one Move, no computer in the chain
2. Movy is an early prototype — expect rough edges, it's free
3. **Everything here was built with AI — the code, and this video's script**
4. **Every idea came from a human**
5. Join **#movy** in the Schwung Discord
6. Links below

**On the AI disclosure:** it goes near the end, stated plainly and without
hedging, immediately followed by the human-authorship card. Putting it up front
would reframe the whole video as an AI demo rather than an instrument demo;
burying it entirely would be worse. Two adjacent cards, no apology.

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
| **Step editing on the drum track** | Tapping steps on/off. Step entry is covered better by the step-recording and step-parameter segments, and it was the least informative beat in the video — the one an earlier draft admitted was "nothing new". |
| **OB-Xd's other 14 pages** | The opener shows the Main page and stops. Helm carries breadth; showing it twice halves the impact of both. |
| **A second envelope/filter reveal on Helm** | OB-Xd already proved the pages look good. Helm's segment argues *scale* instead — 16 pages versus 34, all generated unattended. |

**On the running order.** An earlier draft opened on Mr Drums and it was wrong:
a screen-and-knobs tool whose first demonstrated feature is a *file browser*, on
a module whose Main page is `SAMPL VOL PAN TUNE`, with silent pads until a kit
loads. OB-Xd opens instead, and three things fell into place as a result:

- The kit load stopped being an obstacle — by 3:30 the viewer is sold and has
  bass playing underneath, so a file browser is just another gesture.
- Quantize got its reference. Moving the clip page after the drums means the
  loose bass is heard against a kick, where drift is obvious, instead of alone,
  where it sounds like a choice.
- Helm stopped repeating the opener and got its own argument.

Runtime went 10:04 → 10:20 to pay for it.

---

## Deliverables

| File | What it is |
| --- | --- |
| [`SCENARIO.md`](SCENARIO.md) | This document |
| [`SHOOTING-SCRIPT.md`](SHOOTING-SCRIPT.md) | **Shoot from this** — every subtitle beside what happens on screen, in order |
| [`subtitles.srt`](subtitles.srt) | The same cards as a timed SRT, ready to import |
| [`GETTING-STARTED.md`](GETTING-STARTED.md) | Short install guide to link from the description |
| [`DESCRIPTION.md`](DESCRIPTION.md) | YouTube description with chapters and links |
