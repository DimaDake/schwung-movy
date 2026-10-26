# AI MIDI — Smart Quantize & Generate Variation (design)

Status: design, awaiting approval. Branch `feature/ai-midi`.
Brainstormed with the user 2026-10-26.

## 1. Intent

A **creative partner that starts from what you played**, not a correction tool
and not a generator. Movy sends the Set's existing MIDI to a language model and
gets back a few takes on *one clip*, each recognisably the user's idea, reworked
so it sits with the rest of the song. It is for the moment a recorded take
"sounds bad" (timing, wrong notes, harmonic clashes) and for the moment an A
part exists and the user wants a B.

Rules the user set:

- **Everything is derived from human input.** The AI never writes from an empty
  Set; every request carries the user's clips as its source.
- **Always three options**, graded by creativity, plus **ORIG** (keep the
  original). Three options must sound clearly different from one another.
- **Preview before commit**, with editing allowed inside the preview.

### Anti-goals (failure even if it "works")

- The result no longer sounds like the user's idea.
- The three options sound the same.
- A normal Shift+Step 16 tap fires the AI, or the hold flickers on a tap.
- Any freeze of the UI or audio while the AI request is in flight.
- The AI's output changes a clip without the user seeing a preview first.

### Non-goals (v1)

- Generating from nothing, or for a track with no clips at all.
- MIDI FX: neither feature reads or writes what a MIDI FX produces; the AI
  sees and writes only the notes stored in clips. No feature on MIDI-FX slots.
- Automation / p-locks / trig conditions: not sent, not generated. (What
  happens to existing ones: §6.4.)
- Audio, sound design, parameter changes.

## 2. Feature 1 — Smart Quantize (Shift + hold Step 16)

**Gesture.** Shift + **tap** Step 16 keeps today's quantize cycle (0 / default /
100 %), but fires on **release** so the hold can be told apart. Shift + **hold**
Step 16:

1. 0–300 ms: nothing visible (a tap must never blink).
2. 300 ms → ~1.3 s: a hold-progress bar fills on screen and the Step 16 LED
   brightens. Releasing at any point before full **cancels silently** — no AI,
   and *no* regular quantize either. The deliberate hold is the protection
   against accidents.
3. Full: the request is sent (§5 "Running").

No new LED hint for Step 16 (it is already lit under Shift).

**Target.** The currently selected clip on the active track. Must have notes;
otherwise the gesture shows a short `NOTHING TO QUANTIZE` and does nothing.

**What it does.** Keeps the recorded idea and aligns it with the song's rhythm
and harmony: the scene it plays in (other tracks' clips in the same scene) and,
when relevant, the track's own other clips (consistent groove across sections).
Three options, increasing creativity:

| Option | Melodic track | Drum track |
|---|---|---|
| 1 — closest | Timing locked to the scene's groove (sloppiness only; deliberate swing/push kept); wrong/clashing notes moved to the nearest note that fits scale + surrounding chords. | Timing + velocity cleanup only; pads unchanged. |
| 2 — shaped | Idea developed: re-voiced/filled-out chords, inversions, rhythm adjusted to lock with drums/bass, ghost notes / double hits removed. | Groove tightened to the other tracks, ghost notes added/removed, velocity accents shaped. |
| 3 — inspired | Idea as a seed: reharmonised within the scale, rhythmic ideas borrowed from other tracks, phrase answered or extended. | Bolder groove reinterpretation (accents, ghost notes, feel). |

**Drums: pads change only when it actually makes sense.** Smart quantize on
drums is mainly timing, velocity and ghost notes. Moving a hit to another pad
is allowed only where it clearly helps: an obvious mis-hit (one stray note on
a pad that otherwise doesn't take part in the pattern), or a deliberate groove
move in options 2–3. Option 1 never changes pads (the validator reverts it,
§6.3). User, 2026-10-26: first "no note changes on drums", then "we can allow
other notes on drum when it actually makes sense".

Length, loop window, playback scale, transpose: unchanged.

## 3. Feature 2 — Generate Variation (Shift + Step 14)

**Use case.** "I have the A part of the beat and want B": same style, but
something changes so the song can move on — harmony (chords) or something else.

**Gesture.** In Track view, with a clip slot selected, Shift + Step 14 (no
hold — the AI result is a preview, so nothing is lost). **Step 14 is lit dim
white while Shift is held, only when a variation is possible** (the track has
at least one other clip with notes); dark and inert otherwise.

**Target slot.** The selected slot.
- Empty → the variation is written there.
- Has a clip → the variation **replaces it, preserving that clip's length**
  (ORIG in the preview is the existing clip).

**Source clip.** Several clips may inform it, but **the previous one is the one
to switch from**: the nearest clip with notes on the same track *above* the
target scene (scene index lower), else the nearest below. All other clips of
the track are sent as context (the track's vocabulary), marked as such.

**New clip properties.** Empty target: length = source's length. Always:
playback scale (`scale_num/den`) = **the source clip's**; transpose 0;
quantize = the Set default; loop window = whole clip.

**Alignment with other tracks.** The variation fits what the other tracks have
in the **target scene**. If the target scene is empty apart from this track,
it uses the source clip's scene as harmonic/rhythmic reference, so B moves on
*from* A. This lets the user build a B section track by track: each later
variation follows the earlier ones.

**Three options**, increasing creativity. **At least one option must change the
harmony** (different chords within the same key) when the other tracks in the
reference scene allow it — the prompt says so and states which option. Others
may change rhythm, register, density, phrasing.

**Drums.** Keep kit and feel; change the pattern (fills, kick placement, hats
opening, half/double-time feel). No harmony. Moving hits between pads is
allowed here (it is a new pattern, not a fix).

## 4. Context sent to the AI

One request returns all three options (free-tier quota is per request).

Sent as readable text (exact wire format is the builder's — see §9), never raw
bytes:

- Set: tempo, swing, root/key/mode, time signature (4/4), steps per bar.
- Every track that has clips: track number, role hints (track name if any,
  loaded synth module id/name, drum vs melodic), and **all clips** as a note
  list on a beat grid (bar.beat.sixteenth + offset, duration, note name,
  velocity), with each clip's scene index, length, loop window and playback
  scale. The target scene and source clip are flagged.
- Drum tracks: each pad by its declared voice name (`drumPadNames`, from
  modules that declare pads — 6W6, 8W8, 9W9, CW-78, Simian, DR32, Sophie);
  undeclared → the Ableton Drum Rack / Move kit order (bottom-left = kick, then
  snare, closed hat, …), marked as *guessed* in the prompt.
- The task (quantize | variation), the target clip, the option creativity
  ladder (§2/§3), the hard constraints (§6.3), and the exact response schema.

Nothing else leaves the device: no Set names beyond track names, no audio, no
user/device identifiers.

## 5. The UI

### 5.1 Running (request in flight)

- Screen: progress animation + label `QUANTIZING…` / `VARIATION…`.
- **All input blocked, all LEDs off except Back.** Back cancels: request
  abandoned, nothing changes. Transport keeps running (so the user is in time
  when options arrive). Live audio unaffected.
- **Pads:** a slow drifting animation in the style of the Power-off rainbow —
  same drift speed and gradual colour fades — but a **different colour and
  pattern** so the two can never be confused (proposed: a narrow violet→white
  band sweeping like a scanner). Exact palette: builder's call within that.

### 5.2 Preview

- Screen: the clip's notes drawn like the **Loop-mode note view**
  (`src/seq/note-view.ts` / `note-layout.ts`), with a **bottom selector strip**
  like Song mode's (`AI  ORIG  1  2  3`, the active one boxed).
- Opens on **option 1** (you hear something new right away).
- **Jog turn** switches ORIG/1/2/3; the clip swaps in place and keeps playing
  in time. **Jog click commits** the shown option.
- **Editing works during preview** (pads, steps, held-step edits, Loop view).
  **Each option keeps its own edits**: tweak 2, look at 3, come back, 2 is as
  you left it. ORIG is editable too.
- **Implicit commit** of the shown option (with its edits): switching track,
  switching clip, or leaving the screen/view that hosts the preview.
- **Undo** after commit reverts the whole AI change to the original clip as it
  was *before* the AI ran, in one step (engine undo snapshot taken at request).

### 5.3 Errors

Short message, clip untouched, back to normal:
`NO API KEY — MOVE.LOCAL:7700`, `NO NETWORK`, `AI BUSY, TRY LATER` (quota /
429), `AI ERROR` (anything else, incl. an invalid reply after validation).
Details go to the log.

## 6. Architecture (constraints and decided pieces)

### 6.1 Key entry — Schwung per-module settings

Follow the existing pattern (Schwung `docs/MODULES.md` per-module config; the
store's **AI Manual** / **AI Assistant** modules do exactly this): movy ships a
`settings-schema.json` with

- `provider` enum — Gemini (default) | OpenAI,
- `gemini_api_key`, `openai_api_key` — `"type": "password"` (stored
  `secrets/<key>.txt`, 0600, never round-tripped to the browser), `help_url` to
  aistudio.google.com for the free Gemini key,
- `model` string with a sensible default (a current free-tier Flash model).

Edited at `move.local:7700/modules/movy`. Movy reads `config.json` and the
secret file with `host_read_file`. The tarball must not ship `config.json` or
`secrets/`. Verify the schwung-manager route serves a **standalone tool**
module's schema and that the files are readable by movy-host's uid.

### 6.2 HTTP — `host_http_request_background`

movy-host already compiles Schwung's `js_host_common.c` at the pinned v1.7.3,
which provides `host_http_request_background({url, method, headers,
body_path, response_path, status_path, timeout_seconds})` — curl in a child,
results to files. The UI writes the request body to a file, starts the call,
and **polls the status file from `tick`** (never blocks). Cancel = stop polling
and ignore the result (kill the child if the API allows; otherwise let it
finish into a discarded file). It must be added to movy's host-globals
manifest and `src/platform/standalone.ts` (the only file that names host
globals). Free-tier latency is seconds; timeout ~60 s.

### 6.3 Response contract and validation

The model returns JSON (provider's structured-output / JSON mode) with exactly
three options, each a note list in the target clip's grid. Movy **validates
and repairs** before preview; the model is never trusted:

- notes inside the clip length; gate ≥ 1 tick, clipped at clip end;
  pitch 0–127, velocity 1–127; note count cap;
- **drum quantize, option 1: every note keeps its original pad** (pad changes
  reverted). Options 2–3 may move hits, but only onto pads the kit has
  (declared voices or the track's existing pads). The prompt asks the model to
  give a one-line reason per moved hit (logged, not shown);
- melodic: optional scale check is advisory (option 3 may use passing notes),
  not a rejection;
- fewer than three valid options → show what is valid; zero → `AI ERROR`.

### 6.4 Applying options — engine

The engine has no "replace a clip's notes" command today. Add one (name is the
builder's) that atomically sets a clip's notes (tick, gate, pitch, vel; step
anchor derived) — and for a new clip, its length and playback scale. Preview
switching is just this command with another option's notes, so the engine
stays the single owner of clip truth; the UI holds the four candidate note
lists (each with its edits). Edits during preview go through the normal engine
edit path; on switch away the UI reads the clip's current notes back (the note
list get used by `note-view.ts`) into that option's slot.

Existing **locks / trig overrides** on a replaced clip: kept for ORIG; for AI
options cleared (their step anchors no longer mean the same notes). Builder may
choose to keep locks on drum quantize where pads/steps are unchanged — mark it.

Undo: `usnap` before the first preview write, `ucommit` on commit, so one undo
restores the pre-AI clip.

### 6.5 Module boundaries

New code under `src/ai/` (request building, provider adapters, response
validation, preview state) — pure functions where possible so `logic.mjs`
suites cover them without a device. Respect the 200-line file limit. No
display calls in model code.

## 7. Testing

- **Logic (cheapest, most coverage):** prompt serialization from fixture Sets
  (melodic + drum + multi-track scene); response validation (out-of-range,
  drum pad change, malformed JSON, <3 options); source-clip selection
  (above/below/none); target-slot rules (empty vs existing, length, scale);
  preview state machine (switch, per-option edits retained, implicit commits,
  Back cancel, jog commit); hold gesture timing (tap fires quantize on release,
  hold <300 ms shows nothing, release before full cancels).
- **Screenshots:** running screen, preview with selector on ORIG/1/2/3, each
  error message. Baselines + doc assets.
- **Engine:** `cargo test` for the replace-notes command and undo round trip.
- **Fake provider:** a local stub (fixture JSON) behind the same HTTP call, so
  vdev/device scenarios run without a key or network. Real-API smoke is
  manual/opt-in, never a gate.
- **Perf:** `perf.mjs` must show no extra per-tick cost when no AI request is
  active; polling only while running.
- Integration: vdev tier; device tier only if LED/pad animation or host
  globals change (they do — host global addition → device tier once).

## 8. Docs

MANUAL.md: new "AI" section (both gestures, preview controls, key setup at
`move.local:7700/modules/movy`, privacy note: what is sent where), Controls
reference rows for Shift+hold Step 16 and Shift+Step 14. README: headline
bullet with a preview screenshot.

## 9. Calls made in the design (not discussed with the user — check these)

- **Back during preview commits** the shown option (it "leaves the screen",
  which the user said commits). Only during *Running* does Back cancel.
- **Quantize strength:** AI options are written as played ticks with the clip's
  `quant` set to 0 %, so the AI's micro-timing plays as written instead of
  being re-snapped by a 100 % clip quantize; ORIG restores the original value.
- **Transport stopped:** preview does not auto-start playback; switching just
  redraws. The user presses Play to audition.
- **Song mode** moving the playing clip during a preview does not commit; only
  the user's own track/clip/screen change does.
- **Saves during preview** store the shown option (same as a commit); a power
  cut mid-preview keeps it. Undo still reaches the original.
- **Context = the whole Set, always** (user, 2026-10-26: the AI must
  understand the Set, at least its harmony). Every clip of every track goes as
  a full note list. Estimate: a busy Set (16 tracks × 8 scenes, ~64 notes per
  clip) is ~130 KB of text ≈ 40k tokens, far below Flash's context; a typical
  Set is a few k tokens. Movy also adds a locally computed **harmony summary
  per scene** (pitch classes / likely chord per bar, from melodic tracks), so
  the model gets the Set's harmonic map without inferring it. Only if a request
  would exceed a hard ceiling (~400 KB, a safety net, not a design target)
  do scenes other than the target and source scenes shrink to that summary
  form; they are never dropped.
- **Knobs during preview** are idle, like the Loop note view.
- Locks/trig overrides cleared on AI options (§6.4).

## 10. Left to the builder

- Exact prompt text and the text wire format of notes (§4 constraints apply).
- Engine command name/encoding for replace-notes (§6.4).
- Running animation palette within §5.1.
- Default model name; OpenAI adapter details.
- Hold timing fine-tuning around 300 ms / ~1 s.
