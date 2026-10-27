# Generator bench, 2026-10-27: summary

Design: `plans/2026-10-27-generators-quality-design.md`. The per-run tables are
the sibling `gen-bench-results-2026-10-27-*.md` files. 42 cases: 18 messy
quantize (clean real parts messed up with real drummer timing), 6 played
drums (Groove MIDI, no clean version), 18 variations (real A → real B).
71% electronic. GigaMIDI was not used (gated).

**Alignment** is the headline: the best option's recovery of the clean part
(messy quantize) or alignment with the real B (variation), 0-1. **Gate** is
the share of replies whose three options are all usable and pairwise
different. Run-to-run spread, measured with 3 runs per case: ±0.03 alignment,
±5 points gate.

## Models (old prompt, BALANCED, 1 run)

| model | answered | alignment | gate | p50 | verdict |
| --- | --- | --- | --- | --- | --- |
| gemini-flash-lite-latest | 100% | 0.36 | 50% | 2.8 s | reliable, fast |
| gemini-3.1-flash-lite | 100% | 0.23 | 26% | 2.8 s | reliable, fast |
| gemini-3.5-flash | 33% | 0.49 | 57% | 14 s | best when it answers; 67% busy, then out of daily free quota |
| gemma-4-26b-a4b-it | 52% | 0.19 | 23% | 38 s | slow and unreliable |
| gemini-flash-latest, gemini-3.8-flash | 0% | - | - | 60 s | overloaded: no answer |
| gemini-2.5-flash-lite, gemma-4-31b-it | 0% | - | - | - | 404 for this key |

Pro models were not called (user rule; the runner refuses them).

## Prompt changes (each kept only if it beat the spread)

| change | model | alignment | gate | kept |
| --- | --- | --- | --- | --- |
| old prompt | flash-lite-latest / 3.1-flash-lite | 0.36 / 0.23 | 50% / 26% | - |
| steps + harmony rules + part rules | same | 0.53 / 0.54 | 57% / 71% | yes |
| ...back to ticks (ablation) | flash-lite-latest | 0.31 (quantize recovery 0.85 → 0.34) | 38% | steps kept: the big win |
| ...without part rules (ablation) | 3.1-flash-lite | 0.62 | 60% | part rules kept: the gate is a requirement |
| + HARMONY marks [TARGET]/[SOURCE] | both | variation 0.22 → 0.31, 0.26 → 0.30 | ~same | yes |

## Final default (BALANCED, 3 runs per case)

| model | alignment | quantize recovery | variation | gate | played-drum gate | p50 / p90 |
| --- | --- | --- | --- | --- | --- | --- |
| gemini-3.1-flash-lite | 0.57 | 0.78 | 0.36 | 67% | 72% | 3.3 / 6.2 s |
| gemini-flash-lite-latest | 0.57 | 0.82 | 0.32 | 62% | 6% | 2.7 / 4.8 s |

Chosen: **gemini-3.1-flash-lite first** (same alignment, better gate, and its
played-drum options are actually different), **gemini-flash-lite-latest as the
fallback** (fastest, and an alias that survives model retirements).

## Levels (3.1-flash-lite, 1 run each)

| level, temperature | alignment | gate | idea kept 1/2/3 | min pair diff |
| --- | --- | --- | --- | --- |
| SAFE 0.7 | 0.60 | 57% | 0.61 / 0.42 / 0.38 | 0.45 |
| SAFE 1.0 | 0.58 | 64% | 0.64 / 0.46 / 0.40 | 0.44 |
| BALANCED 1.0 (×3) | 0.57 | 67% | 0.58 / 0.36 / 0.33 | 0.60 |
| WILD 1.0 | 0.49 | 60% | 0.46 / 0.30 / 0.30 | 0.66 |
| WILD 1.3 | 0.45 | 56% | 0.43 / 0.28 / 0.29 | 0.69 |

The levels move the options as intended (idea kept falls, difference rises
from SAFE to WILD). Temperature did not help either end, so every level
sends 1.0; the ladder wording does the work.

## Known limits

- Variation alignment tops out near 0.35 on average: where the real B moved in
  a way the other tracks do not imply (a bass moving to a new root over the
  same chord), no option can be expected to find it.
- SAFE's options are closer together (pair difference 0.44), so its gate is
  lower on played drums (17-33%).
- The free tier's bigger models (Flash, 3.5/3.8) were busy, slow or out of
  quota on the day; the fallback exists for exactly that.
