# Generator bench: abl-nopart

Level BALANCED, 42 cases, 1 run(s) each. Missing sources: gigamidi (gated).

**Alignment** (headline) = best option's recovery of the clean part (messy quantize) or alignment with the real B (variation), 0-1. **Gate** = all three options usable and pairwise different. Fit/groove are diagnostics. Idea kept per option 1 / 2 / 3. Latency excludes cached replies.

## all

| model | n | fail | alignment | gate | fit | groove | idea kept 1/2/3 | min pair diff | ladder | p50 ms | p90 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gemini-3.1-flash-lite | 42 | 0% | 0.62 | 60% | 0.89 | 0.94 | 0.64 / 0.39 / 0.35 | 0.52 | 76% | 3479 | 7269 |

## variation

| model | n | fail | alignment | gate | fit | groove | idea kept 1/2/3 | min pair diff | ladder | p50 ms | p90 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gemini-3.1-flash-lite | 18 | 0% | 0.39 | 67% | 0.94 | 0.95 | 0.37 / 0.22 / 0.25 | 0.68 | 56% | 3260 | 7678 |

## quantize-messy

| model | n | fail | alignment | gate | fit | groove | idea kept 1/2/3 | min pair diff | ladder | p50 ms | p90 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gemini-3.1-flash-lite | 18 | 0% | 0.86 | 61% | 0.83 | 0.94 | 0.87 / 0.51 / 0.38 | 0.46 | 89% | 3073 | 7986 |

## quantize-played

| model | n | fail | alignment | gate | fit | groove | idea kept 1/2/3 | min pair diff | ladder | p50 ms | p90 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gemini-3.1-flash-lite | 6 | 0% | - | 33% | - | 0.90 | 0.77 / 0.54 / 0.59 | 0.19 | 100% | 4967 | 7024 |
