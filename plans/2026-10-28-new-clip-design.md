# New Clip: Shift + hold Step 14 with nothing to vary

User, 2026-10-28: "I want new clip generator to work without any content provided. It should still be aligned with
other tracks on the scene if they exist. It should give a broader range of presets (e.g. to allow chords, bass, arp,
melody). For drums first two presets should be per-pad and others are global. Per pad affects only selected pad as soon
as you press another pad it adds notes to another pad. To remove notes in per pad mode the first knob should control
the density and it should be set to 0. The density should be preserved between per-pad presets. The length of the clip
can be changed if you set it in advance or if you change it via loop mode which can be accessed without interrupting
the generator flow." Then: "We need to make sure that every time we generate default presets are unique and
meaningful." Answers: Step 14 with nothing to vary; one option per part, more algorithms welcome, 8 is enough; length
from the slot, else the scene, else a bar.

## Gesture

Shift + hold Step 14 on a track with **no other clip to vary from** starts task `create` (the hold bar says `NEW
CLIP`, the screen `NEW CLIP...`). With another clip on the track it is a Variation as before. Step 14 lights under
Shift whenever either can run. `create` is always algorithmic (no model prompt: there is nothing to vary).

## Target (`ai/job-target.ts`)

The selected slot. Length: the slot's own when it has one (a length set in advance on an empty slot is a clip with no
notes, which the engine dumps), else the longest loop in the target scene in master steps, else 16; at most 256.
Speed: the slot's, else 1/1. ORIG gives back what was there.

## Context (`analysis/context.ts`, `create/plans.ts`)

No source. The key comes from the other tracks in the scene, the Set's key setting breaking ties (a silent scene takes
the setting). Freedom as for a Variation. Harmony plans: locked = the scene's chords; partial = diatonic fits around
what the others pin, from each progression; free = a library of progressions in the key (pop, minor loop, cadence,
two-chord vamp, modal…), one chord per bar on clips of four bars or more, per half-bar below. The groove's swing and
the band's hits (`band.ts`) come from the other tracks, so new parts land with them.

## Unique and meaningful (`create/takes.ts`, `create/checks.ts`, `create/history.ts`)

- `ctx.seed` mixes a per-run nonce (the job's start time), so every run differs; a knob turn regenerates with the same
  seed, so turning a knob back gives the same notes.
- A take's knobs are **rolled** (`KnobDef.roll`) from the seed: pattern, contour, rate, register… each from its
  musical subset. A take that fails its part's checks is rolled again (up to 8 times), so a default is always
  reproducible from its knobs.
- Checks per part: density in range (bass ≥ 2 onsets/bar, melody 3–12, pad ≥ 1 chord per bar…), strong-beat notes in
  the chord or scale, a range of at least a third except drones and pads, more than one rhythmic value for lines;
  drums: a kick on the one, a backbeat or clear pulse, not every step; a per-pad default on at least 2 steps.
- Recent runs are remembered (RAM, last 3 per kind): a take within `MIN_PAIR` of one offered recently is passed over,
  and the options of one run differ from each other by `MIN_PAIR`.

## Options

Melodic, 8 in this order: CHORDS, PAD, STABS, BASS, ARP, MELODY, RIFF, COUNTER. Drums, 6: PAD EUCLID, PAD PATTERN
(per-pad), GROOVE, EUCLID KIT, BROKEN, PERC (whole kit). Four knobs of their own each, then the feel row.

## The feel row (`create/feel.ts`)

User, 2026-10-28: "chords not necessarily should be full length. we need a knob to control gate and in general have
more variety in the rhythm and note length across all generators". Every New Clip generator writes its idea on the
grid; `withFeel` lays knobs 5–8 over it. Melodic: GATE (share of the room to the next onset, 10% → held; each part's
takes drawn from its own range: stabs 0–3, pad 5–10…), VARY (per event: dropped, pushed a 16th, repeated half way,
held ×0.45 or ×1.8; band accents and the downbeat stay), SWING (off-16ths; a part with none swings its off-8ths
unless the scene swings its own 16ths; PAD has STRUM instead), DYNAMICS. Drums: VARY, SWING, DYNAMICS, HUMAN. The
generators no longer set their own lengths. Bench: with band 0.70 → 0.65 (swing taken in unswung scenes and strummed
pads move onsets off the accents), rhythm variability 0.72 → 0.74, re-run 0.81 → 0.79.

## Per-pad (`ai/preview-pads.ts`)

A per-pad option writes only the selected pad (`ctx.pad`). Pressing another pad while it shows adds that pad's notes
at the same knobs; the pads already written stay. Knob 1 is DENSITY; 0 removes the selected pad's notes. DENSITY is
kept per pad across the per-pad options: showing the other per-pad option writes every pad touched so far at its
DENSITY with that option's own knobs.

## Length during the preview

Loop Mode stays available. A loop length set while a `create` preview is open is taken by the preview
(`seq/loop-hook.ts`): every option is made again at the new length from its own knobs (per-pad options pad by pad),
the one showing is written at once, and the preview stays open.

## Tests

`browser-test/logic/gen-create.mjs`: an empty Set gives 8 / 6 options; parts follow a locked scene's chords; land
with the band; two runs differ; the same run twice still differs (history); no two options match; every default passes
its checks over 200 seeds in empty / locked / free scenes; per-pad: pads accumulate, DENSITY 0 clears, DENSITY carries
between options 1 and 2; a length change remakes the options.

## Bench (`scripts/gen-bench/create.mjs`)

Each cached case's target track emptied and a part written into its slot, two runs per case. BALANCED (the level does
not move New Clip): 42 requests, 7.43 options (8 melodic, 6 drums), meaningful 1.00, coherence 0.99, with band 0.65,
re-run difference 0.79, rhythm variability 0.74, notes 0.94. Perf (node): one take slice at 16 bars 0.82 ms, a knob
turn 0.46 ms.
