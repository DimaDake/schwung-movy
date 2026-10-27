# Generator bench: default-x3

Level BALANCED, 42 cases, 3 run(s) each. Missing sources: gigamidi (gated).

**Alignment** (headline) = best option's recovery of the clean part (messy quantize) or alignment with the real B (variation), 0-1. **Gate** = all three options usable and pairwise different. Fit/groove are diagnostics. Idea kept per option 1 / 2 / 3. Latency excludes cached replies.

## all

| model | n | fail | alignment | gate | fit | groove | idea kept 1/2/3 | min pair diff | ladder | p50 ms | p90 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gemini-flash-lite-latest | 126 | 0% | 0.57 | 62% | 0.87 | 0.89 | 0.74 / 0.45 / 0.39 | 0.54 | 75% | 2703 | 4781 |
| gemini-3.1-flash-lite | 126 | 0% | 0.57 | 67% | 0.88 | 0.93 | 0.58 / 0.36 / 0.33 | 0.60 | 75% | 3303 | 6219 |

## variation

| model | n | fail | alignment | gate | fit | groove | idea kept 1/2/3 | min pair diff | ladder | p50 ms | p90 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gemini-flash-lite-latest | 54 | 0% | 0.32 | 81% | 0.90 | 0.89 | 0.55 / 0.30 / 0.29 | 0.68 | 57% | 2771 | 5146 |
| gemini-3.1-flash-lite | 54 | 0% | 0.36 | 65% | 0.92 | 0.95 | 0.31 / 0.22 / 0.25 | 0.71 | 70% | 3232 | 9723 |

## quantize-messy

| model | n | fail | alignment | gate | fit | groove | idea kept 1/2/3 | min pair diff | ladder | p50 ms | p90 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gemini-flash-lite-latest | 54 | 0% | 0.82 | 61% | 0.84 | 0.93 | 0.86 / 0.47 / 0.38 | 0.55 | 89% | 2420 | 3925 |
| gemini-3.1-flash-lite | 54 | 0% | 0.78 | 69% | 0.84 | 0.93 | 0.78 / 0.43 / 0.34 | 0.57 | 76% | 3179 | 5941 |

## quantize-played

| model | n | fail | alignment | gate | fit | groove | idea kept 1/2/3 | min pair diff | ladder | p50 ms | p90 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gemini-flash-lite-latest | 18 | 0% | - | 6% | - | 0.74 | 0.91 / 0.85 / 0.79 | 0.11 | 89% | 4506 | 6300 |
| gemini-3.1-flash-lite | 18 | 0% | - | 72% | - | 0.87 | 0.73 / 0.53 / 0.51 | 0.38 | 83% | 4038 | 6121 |
