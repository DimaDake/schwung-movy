# Generator bench: v-new

Level BALANCED, 42 cases, 1 run(s) each. Missing sources: gigamidi (gated).

**Alignment** (headline) = best option's recovery of the clean part (messy quantize) or alignment with the real B (variation), 0-1. **Gate** = all three options usable and pairwise different. Fit/groove are diagnostics. Idea kept per option 1 / 2 / 3. Latency excludes cached replies.

## all

| model | n | fail | alignment | gate | fit | groove | idea kept 1/2/3 | min pair diff | ladder | p50 ms | p90 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gemini-flash-lite-latest | 42 | 0% | 0.53 | 57% | 0.87 | 0.88 | 0.75 / 0.42 / 0.41 | 0.61 | 71% | 2620 | 4665 |
| gemini-3.1-flash-lite | 42 | 0% | 0.54 | 71% | 0.86 | 0.92 | 0.63 / 0.34 / 0.31 | 0.66 | 76% | 3928 | 6644 |

## variation

| model | n | fail | alignment | gate | fit | groove | idea kept 1/2/3 | min pair diff | ladder | p50 ms | p90 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gemini-flash-lite-latest | 18 | 0% | 0.22 | 67% | 0.90 | 0.88 | 0.52 / 0.25 / 0.32 | 0.77 | 56% | 2620 | 4928 |
| gemini-3.1-flash-lite | 18 | 0% | 0.26 | 83% | 0.88 | 0.96 | 0.33 / 0.18 / 0.22 | 0.82 | 56% | 3822 | 6620 |

## quantize-messy

| model | n | fail | alignment | gate | fit | groove | idea kept 1/2/3 | min pair diff | ladder | p50 ms | p90 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gemini-flash-lite-latest | 18 | 0% | 0.85 | 61% | 0.84 | 0.94 | 0.90 / 0.45 / 0.40 | 0.59 | 78% | 2271 | 3924 |
| gemini-3.1-flash-lite | 18 | 0% | 0.83 | 56% | 0.83 | 0.93 | 0.82 / 0.42 / 0.36 | 0.58 | 89% | 3875 | 11195 |

## quantize-played

| model | n | fail | alignment | gate | fit | groove | idea kept 1/2/3 | min pair diff | ladder | p50 ms | p90 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gemini-flash-lite-latest | 6 | 0% | - | 17% | - | 0.71 | 0.94 / 0.85 / 0.79 | 0.19 | 100% | 4306 | 5996 |
| gemini-3.1-flash-lite | 6 | 0% | - | 83% | - | 0.76 | 0.90 / 0.63 / 0.46 | 0.41 | 100% | 4404 | 5777 |
