# Generator bench: abl-ticks

Level BALANCED, 42 cases, 1 run(s) each. Missing sources: gigamidi (gated).

**Alignment** (headline) = best option's recovery of the clean part (messy quantize) or alignment with the real B (variation), 0-1. **Gate** = all three options usable and pairwise different. Fit/groove are diagnostics. Idea kept per option 1 / 2 / 3. Latency excludes cached replies.

## all

| model | n | fail | alignment | gate | fit | groove | idea kept 1/2/3 | min pair diff | ladder | p50 ms | p90 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gemini-flash-lite-latest | 42 | 0% | 0.31 | 38% | 0.88 | 0.84 | 0.29 / 0.26 / 0.25 | 0.60 | 62% | 2563 | 5040 |

## variation

| model | n | fail | alignment | gate | fit | groove | idea kept 1/2/3 | min pair diff | ladder | p50 ms | p90 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gemini-flash-lite-latest | 18 | 0% | 0.28 | 67% | 0.90 | 0.81 | 0.24 / 0.24 / 0.22 | 0.69 | 72% | 2926 | 5040 |

## quantize-messy

| model | n | fail | alignment | gate | fit | groove | idea kept 1/2/3 | min pair diff | ladder | p50 ms | p90 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gemini-flash-lite-latest | 18 | 0% | 0.34 | 17% | 0.87 | 0.90 | 0.25 / 0.20 / 0.20 | 0.67 | 44% | 2249 | 3647 |

## quantize-played

| model | n | fail | alignment | gate | fit | groove | idea kept 1/2/3 | min pair diff | ladder | p50 ms | p90 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gemini-flash-lite-latest | 6 | 0% | - | 17% | - | 0.75 | 0.55 / 0.52 / 0.51 | 0.15 | 83% | 5177 | 8834 |
