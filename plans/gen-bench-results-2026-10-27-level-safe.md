# Generator bench: level-safe

Level SAFE, 42 cases, 1 run(s) each. Missing sources: gigamidi (gated).

**Alignment** (headline) = best option's recovery of the clean part (messy quantize) or alignment with the real B (variation), 0-1. **Gate** = all three options usable and pairwise different. Fit/groove are diagnostics. Idea kept per option 1 / 2 / 3. Latency excludes cached replies.

## all

| model | n | fail | alignment | gate | fit | groove | idea kept 1/2/3 | min pair diff | ladder | p50 ms | p90 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gemini-3.1-flash-lite | 42 | 0% | 0.60 | 57% | 0.87 | 0.94 | 0.61 / 0.42 / 0.38 | 0.45 | 74% | 4239 | 13919 |

## variation

| model | n | fail | alignment | gate | fit | groove | idea kept 1/2/3 | min pair diff | ladder | p50 ms | p90 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gemini-3.1-flash-lite | 18 | 0% | 0.41 | 61% | 0.89 | 0.92 | 0.38 / 0.29 / 0.26 | 0.63 | 72% | 4072 | 13919 |

## quantize-messy

| model | n | fail | alignment | gate | fit | groove | idea kept 1/2/3 | min pair diff | ladder | p50 ms | p90 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gemini-3.1-flash-lite | 18 | 0% | 0.77 | 67% | 0.85 | 0.97 | 0.80 / 0.50 / 0.43 | 0.34 | 78% | 4239 | 25155 |

## quantize-played

| model | n | fail | alignment | gate | fit | groove | idea kept 1/2/3 | min pair diff | ladder | p50 ms | p90 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gemini-3.1-flash-lite | 6 | 0% | - | 17% | - | 0.94 | 0.67 / 0.54 / 0.54 | 0.23 | 67% | 6762 | 24963 |
