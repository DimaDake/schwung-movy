# Generator bench: level-safe-t1

Level SAFE, 42 cases, 1 run(s) each. Missing sources: gigamidi (gated).

**Alignment** (headline) = best option's recovery of the clean part (messy quantize) or alignment with the real B (variation), 0-1. **Gate** = all three options usable and pairwise different. Fit/groove are diagnostics. Idea kept per option 1 / 2 / 3. Latency excludes cached replies.

## all

| model | n | fail | alignment | gate | fit | groove | idea kept 1/2/3 | min pair diff | ladder | p50 ms | p90 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gemini-3.1-flash-lite | 42 | 0% | 0.58 | 64% | 0.90 | 0.90 | 0.64 / 0.46 / 0.40 | 0.44 | 81% | 3736 | 10855 |

## variation

| model | n | fail | alignment | gate | fit | groove | idea kept 1/2/3 | min pair diff | ladder | p50 ms | p90 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gemini-3.1-flash-lite | 18 | 0% | 0.34 | 83% | 0.94 | 0.88 | 0.35 / 0.27 / 0.24 | 0.68 | 78% | 4062 | 16751 |

## quantize-messy

| model | n | fail | alignment | gate | fit | groove | idea kept 1/2/3 | min pair diff | ladder | p50 ms | p90 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gemini-3.1-flash-lite | 18 | 0% | 0.80 | 56% | 0.85 | 0.95 | 0.84 / 0.60 / 0.47 | 0.25 | 89% | 3447 | 10855 |

## quantize-played

| model | n | fail | alignment | gate | fit | groove | idea kept 1/2/3 | min pair diff | ladder | p50 ms | p90 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gemini-3.1-flash-lite | 6 | 0% | - | 33% | - | 0.80 | 0.86 / 0.59 / 0.61 | 0.27 | 67% | 4313 | 7293 |
