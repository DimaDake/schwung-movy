# Generators: reply quality, a bench on real music, and a creativity setting

Follows `plans/2026-10-26-ai-midi-design.md` (Smart Quantize, Variation, the
preview). That feature works end to end against the real Gemini API (live check
2026-10-27, commit fd2ff5bf), but the replies are weak: on a sloppy lead and
sloppy drums option 1 left ~80% of notes off the grid, and two of three
variation options left the last half-bar empty. This round makes the replies
good and proves it with numbers.

## Intent

The generators are a creative tool, not a fixer: three takes on what the user
played, each **clearly different from the other two and each usable as it
stands** — none empty in places, none falling apart, none a copy of the
original. "Fits" means it fits what the other tracks actually play (the
harmony and the groove), not that it obeys a scale. Quality is judged on real
music, mostly electronic and what suits a groovebox, and the model is chosen by
measurement.

## Goals

1. **A bench** that runs the shipped generator code (context → prompt →
   request → validate) against real Gemini models on test cases cut from real
   MIDI, scores every option, and prints a comparison table.
2. **Model comparison** across the free, non-Pro models; the default model is
   picked from the bench's numbers.
3. **Better replies**: prompt and reply-format changes, kept only where the
   bench shows they help.
4. **Harmony over scale**: rules and scoring follow the sounding chords and the
   groove; chromatic passing and approach notes, borrowed chords and
   out-of-key colour are fine where they fit.
5. **A creativity setting on the device**: a GENERATORS row in Settings.
6. **Naming**: the user never sees "AI"; the features are "generators".

## Non-goals

- Pro models (user: "don't touch pro models"). No `*-pro*` model is called,
  not even once by the bench.
- Providers other than Gemini (removed in fd2ff5bf).
- New generator features (fills, add-a-part, ...). This round is quality only.
- Training or fine-tuning anything.

## Anti-goals

- **Dataset content in the source tree.** Any dataset may be used, including
  non-commercial ones (user, 2026-10-27), but MIDI from them never enters git:
  a script downloads it to a git-ignored folder and cuts cases locally.
  "Nothing suspicious in the source code."
- **The API key in code, in a commit, or in a bench report.** The bench reads it
  from a file path or env var given at run time.
- Three options that are the same idea three times, or that differ only by a
  few velocities.
- Rules that act as scale police (snapping every out-of-key note), or a bench
  that rewards that.
- A bench that burns the free quota: replies are cached, requests throttled.

## Decided with the user

- Compare models, never the Pro tier.
- Each option different **and** usable.
- Real, freely available MIDI for tests, covering different genres but
  **mostly electronic and groovebox-applicable**; non-commercial datasets are
  fine; their content stays out of the repo.
- Compare real B parts against Variation's output, and messy/unquantized takes
  against Smart Quantize's output.
- A creativity setting **on the device**, in Settings; three levels.
- Harmony rules, not artificial restrictions like scales.
- Call them **generators**; rename what is already on screen and in the docs.

## Design

### 1. Data (local only)

`scripts/gen-bench/fetch.mjs` downloads into `.gen-data/` (git-ignored):

| Source | Licence | What it gives |
| --- | --- | --- |
| Groove MIDI Dataset (Magenta) | CC BY 4.0 | Pro drummers on an e-kit to a click, unquantized, with style labels (funk, hiphop, dance, afrobeat, latin, reggae, ...). Messy drums, and real human timing to humanise other parts with. |
| MidiCaps (Lakh-based) | CC BY 4.0 captions; the MIDI are Lakh's | Full multi-track songs with genre, key, tempo and chord captions; electronic and pop are its largest genres. Real parts in context, A→B pairs. |
| GigaMIDI | CC BY-NC 4.0 | Curated style labels and expressive (played, not drawn) takes: messy melodic and bass input. |

Selection: at least 60% of cases electronic (house, techno, trance, electro,
drum & bass, dubstep, synth-pop, electronic hip-hop); the rest spread over
funk, hip-hop, pop, r&b, latin/afro, so the prompt is not tuned to one style.

**Our own patterns** (`scripts/gen-bench/patterns/*.json`, committed, written
for this project): canonical groovebox idioms the datasets are thin on —
four-on-the-floor techno, house with offbeat hats, a 303-style acid line,
dub-techno chord stabs, breakbeat, UK garage 2-step, trap hats, an arpeggio.
These are the only musical content in git.

### 2. Cases

`scripts/gen-bench/cases.mjs` cuts cases deterministically (fixed seed) into
`.gen-data/cases/*.json`, each a movy Set as the generator code sees it
(`AiContextInput` tracks with `AiClip`s: 2–4 bars, 2–6 tracks, drum tracks
flagged with pad names) plus the task, the target, and a reference:

- **quantize-messy** — a clean real part (Lakh/MidiCaps, or ours) messed up the
  way people mess up: timing drift taken from a Groove MIDI performance's
  deviation from the grid (real human timing, not uniform noise), a few
  mis-hits to a neighbouring key, uneven velocity, a dropped or doubled note.
  Reference: the clean part.
- **quantize-played** — a played take with no clean version (Groove MIDI drums,
  GigaMIDI expressive parts). No reference; scored on fit, groove and idea.
- **variation** — scene 1 is a song's A section (all its tracks); the target
  track's scene 2 is empty. Reference: that track's real next section (B), found
  where the bar-level harmony or pattern changes. Variation is not meant to
  reproduce the real B; the reference tells us whether the option moves in a
  direction a real musician moved (scored loosely, see §3).

Target size: about 40 cases (enough to separate models, small enough for the
free quota): ~15 quantize-messy, ~10 quantize-played, ~15 variation; about a
third drums.

### 3. Scores

All scores are computed in the bench from note data; none is a model's
opinion of itself. Per option:

- **Harmonic fit** — over the option's note-time, the share on chord tones or
  common tensions of the harmony the OTHER tracks sound at that moment (movy's
  `sceneHarmony`), with a penalty for strong-beat clashes (minor 2nd / major 7th
  / tritone against a held chord or bass note). A chromatic note on a weak
  position resolving by step costs nothing. Key membership is reported for
  information only and never scored.
- **Groove** — onset alignment with the scene's rhythmic grid (the onsets of
  the other tracks, the drums first), so a deliberate swing or push is not
  punished for leaving the straight 16th grid.
- **Recovery** (quantize-messy only) — note match against the clean reference
  (onset ±1/2 step, same pitch class).
- **Idea kept** (quantize) — rhythm and contour similarity to the input.
  Expected to fall from option 1 to option 3.
- **Usable** — notes cover the whole clip (no empty last half-bar or bar where
  the input or source had notes), density within a sane range of the input,
  sane register, no option empty, no copy of the input.
- **Difference** — pairwise distance between the three options and from ORIG,
  on (step, pitch) sets plus rhythm; near-duplicates flagged.
- **B-likeness** (variation) — similarity of density, register and harmonic
  motion to the real B, compared with the same measure against the A.

Headline per model and setting: **% of replies where all three options are
usable and pairwise different**, then mean fit, groove, recovery, and
latency p50/p90 and failure rate (503/429/timeout).

### 4. Runner and report

`scripts/gen-bench/run.mjs --models a,b --cases <glob> --level SAFE|BALANCED|WILD`:

- Builds prompts with the shipped code (`dist/esm/ai`), so the bench measures
  what the Move would send.
- Key from `GEMINI_KEY_FILE` (path) only; refuses a model name containing `pro`.
- Caches replies in `.gen-data/cache/` by hash(model, prompt) so re-scoring and
  prompt-independent changes cost no quota; throttles per model; retries 503
  with backoff, counting each failure.
- Writes `plans/gen-bench-results-<date>.md`: tables of numbers and model
  names only — no notes, no song names, no key.

Models (free tier, non-Pro): the gemini Flash and Flash-Lite generations the key
lists (`gemini-flash-latest`, `gemini-flash-lite-latest`, `gemini-3.8-flash`,
`gemini-3.5-flash`, `gemini-3.1-flash-lite`, `gemini-2.5-flash-lite`), and Gemma
4 (`gemma-4-26b-a4b-it`, `gemma-4-31b-it`). Overloaded ones are reported as such,
not dropped silently.

### 5. Prompt and reply changes (each kept only if the bench shows a gain)

- **One time language.** The context shows positions as `bar.beat.16th+ticks`
  but the reply asks for raw ticks; the Lite model's empty half-bars look like
  failed arithmetic. Variant: replies in steps (16ths, fractions allowed for
  feel, e.g. `12.25`), lengths in steps; `validate.ts` converts to ticks.
- **Harmony rules** replace scale wording: "fit the chords the other tracks
  sound at that moment; chromatic passing and approach notes on weak positions
  are welcome; a borrowed chord is fine in a variation if the other tracks
  allow it; the Set's key is a hint, not a rule". Option 1 of Smart Quantize
  moves a note only when it clashes with the sounding harmony, not because it
  is outside the key.
- **Difference and usability** stated as checkable rules: each option covers
  the whole clip; options differ in rhythm or pitch for a stated share of their
  notes; none repeats the input.
- **Per-option temperature is not available in one request**; the bench may try
  three single-option requests against one three-option request and report the
  cost (quota ×3, latency) against the gain. One request stays the default
  unless the gain is large.

### 5b. Fallback model (user, 2026-10-27)

The Move tries the better model first and falls back to the fast, reliable
one when the first answers 503/429 or nothing within a short wait; only when
both fail does it show `BUSY, TRY LATER`. Which two models fill those roles,
and the wait before falling back, come from the bench (latency p90 of the
fallback model sets the budget so the whole wait stays under the 60 s curl
timeout). The web page's Model field, when set, replaces the first model; the
fallback stays.

### 6. Creativity setting

A **GENERATORS** row on the Settings page (Shift + Step 2), between CLICK
VOLUME and BACKUPS (MIGRATE FROM MOVE must stay last), value **SAFE /
BALANCED / WILD**, turned with knob 1 like CLICK VOLUME, clamped, default
BALANCED. A device property in `prefs.json` (like the click volume), so it holds
across Sets and restarts, read when a request is built.

It moves all three options together; option 1 is always the most careful of
the three and option 3 the boldest:

- SAFE — 1: fix timing and clashes only; 2: tighten and tidy; 3: light development.
- BALANCED — today's ladder (closest / shaped / inspired).
- WILD — 1: develop the idea; 2: reshape rhythm and harmony; 3: reimagine from
  the seed.

Hint line: "How bold the generators are. Turn knob 1."

### 7. Naming

User-facing "AI" goes everywhere:

- Preview strip lead `AI` → `GEN` (`GEN ORIG 1 2 3`).
- Messages: `AI BUSY, TRY LATER` → `BUSY, TRY LATER`; `AI ERROR` → `GENERATOR
  ERROR`; `NO API KEY` stays (it is what the web page calls it).
- Web settings page label `Movy AI` → `Movy Generators`.
- MANUAL section "AI: Smart Quantize & Variation" → "Generators: Smart Quantize
  & Variation", README bullet, CHANGELOG entry, screenshots regenerated.

## My calls (check these)

- Code identifiers keep `ai` (`src/ai/`, `aiclip`, `ait:`): renaming the engine
  verbs means an ENGINE_VERSION bump and churn with no user-visible gain.
- Three named levels, default BALANCED, row placed second.
- About 40 cases, ≥60% electronic.
- Messy timing from real Groove MIDI deviations rather than random jitter.
- The bench lives in `scripts/gen-bench/`, is never part of `npm test` (it needs
  the network and a key), and its results go to `plans/`.
- A MIDI-file parser is added as a dev dependency for the bench only.

## Builder questions settled (my calls unless marked)

- **Key, network, model list:** answered. A working free-tier key is in the
  session scratchpad (outside the repo) and the model list in §4 came from the
  key's own `models.list` on 2026-10-27. The bench runs live; decisions that
  depend on it (default model, kept prompt variants) are made from its numbers.
- **Downloads:** multi-GB downloads to the Mac are fine. If a source fails or
  is gated (GigaMIDI may be), the bench runs on what it has (Groove MIDI, Lakh
  via MidiCaps, our patterns) and the report says which sources were missing.
- **Harmony:** `harmony.ts` gains a structured chord reader (pitch-class set per
  bar half, plus the bass note) that both the prompt text and the scorer use, so
  what the model is told and what it is scored against cannot drift apart. The
  prompt's chord text stays byte-identical (a test pins it). Chord tones = the
  detected set; tensions = 9th, 11th (minor chords), 13th; everything else is a
  non-chord tone scored by position and resolution.
- **Creativity and temperature:** the level moves the prompt ladder AND the
  temperature (SAFE 0.7, BALANCED 1.0, WILD 1.3 as the start); the bench checks
  that the temperature axis helps and drops it if not.
- **Noise:** each case runs once per model for the broad comparison; the
  finalists (top two models, best two prompt variants) run 3 times per case. A
  change counts as a gain only if it beats the old one by more than the spread
  between repeat runs.
- **Web settings:** the level is on the device only. Its `prefs.json` key is
  optional with BALANCED as the default, like the click volume's.

## Left to the builder

- Exact score formulas and the thresholds for "usable" and "different".
- How sections are detected for A→B pairs.
- Throttle rates per model (from the free-tier limits the API reports).
- Which prompt variants to try beyond §5, and in what order.
