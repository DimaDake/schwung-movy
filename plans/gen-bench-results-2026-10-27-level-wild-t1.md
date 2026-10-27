# Generator bench: level-wild-t1

Level WILD, 42 cases, 1 run(s) each. Missing sources: gigamidi (gated).

**Alignment** (headline) = best option's recovery of the clean part (messy quantize) or alignment with the real B (variation), 0-1. **Gate** = all three options usable and pairwise different. Fit/groove are diagnostics. Idea kept per option 1 / 2 / 3. Latency excludes cached replies.

## all

| model | n | fail | alignment | gate | fit | groove | idea kept 1/2/3 | min pair diff | ladder | p50 ms | p90 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gemini-3.1-flash-lite | 42 | 0% | 0.49 | 60% | 0.88 | 0.92 | 0.46 / 0.30 / 0.30 | 0.66 | 76% | 3085 | 7174 |

## variation

| model | n | fail | alignment | gate | fit | groove | idea kept 1/2/3 | min pair diff | ladder | p50 ms | p90 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gemini-3.1-flash-lite | 18 | 0% | 0.31 | 61% | 0.91 | 0.93 | 0.28 / 0.22 / 0.24 | 0.69 | 83% | 2892 | 7422 |

## quantize-messy

| model | n | fail | alignment | gate | fit | groove | idea kept 1/2/3 | min pair diff | ladder | p50 ms | p90 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gemini-3.1-flash-lite | 18 | 0% | 0.67 | 61% | 0.84 | 0.93 | 0.60 / 0.33 / 0.31 | 0.66 | 72% | 3372 | 6888 |

## quantize-played

| model | n | fail | alignment | gate | fit | groove | idea kept 1/2/3 | min pair diff | ladder | p50 ms | p90 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gemini-3.1-flash-lite | 6 | 0% | - | 50% | - | 0.89 | 0.58 / 0.44 / 0.42 | 0.56 | 67% | 4670 | 9054 |
