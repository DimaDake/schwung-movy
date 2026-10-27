# Generator bench: level-wild

Level WILD, 42 cases, 1 run(s) each. Missing sources: gigamidi (gated).

**Alignment** (headline) = best option's recovery of the clean part (messy quantize) or alignment with the real B (variation), 0-1. **Gate** = all three options usable and pairwise different. Fit/groove are diagnostics. Idea kept per option 1 / 2 / 3. Latency excludes cached replies.

## all

| model | n | fail | alignment | gate | fit | groove | idea kept 1/2/3 | min pair diff | ladder | p50 ms | p90 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gemini-3.1-flash-lite | 42 | 2% | 0.45 | 56% | 0.88 | 0.94 | 0.43 / 0.28 / 0.29 | 0.69 | 63% | 3526 | 6273 |

## variation

| model | n | fail | alignment | gate | fit | groove | idea kept 1/2/3 | min pair diff | ladder | p50 ms | p90 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gemini-3.1-flash-lite | 18 | 6% | 0.33 | 59% | 0.92 | 0.94 | 0.28 / 0.22 / 0.22 | 0.75 | 65% | 3983 | 7095 |

## quantize-messy

| model | n | fail | alignment | gate | fit | groove | idea kept 1/2/3 | min pair diff | ladder | p50 ms | p90 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gemini-3.1-flash-lite | 18 | 0% | 0.56 | 56% | 0.85 | 0.93 | 0.49 / 0.30 / 0.31 | 0.65 | 61% | 3227 | 6273 |

## quantize-played

| model | n | fail | alignment | gate | fit | groove | idea kept 1/2/3 | min pair diff | ladder | p50 ms | p90 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gemini-3.1-flash-lite | 6 | 0% | - | 50% | - | 0.96 | 0.65 / 0.43 / 0.43 | 0.63 | 67% | 3807 | 29935 |
