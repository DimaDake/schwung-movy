# Generator bench: v-target

Level BALANCED, 18 cases, 1 run(s) each. Missing sources: gigamidi (gated).

**Alignment** (headline) = best option's recovery of the clean part (messy quantize) or alignment with the real B (variation), 0-1. **Gate** = all three options usable and pairwise different. Fit/groove are diagnostics. Idea kept per option 1 / 2 / 3. Latency excludes cached replies.

## all

| model | n | fail | alignment | gate | fit | groove | idea kept 1/2/3 | min pair diff | ladder | p50 ms | p90 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gemini-flash-lite-latest | 18 | 0% | 0.31 | 89% | 0.90 | 0.93 | 0.55 / 0.28 / 0.32 | 0.67 | 61% | 3382 | 5311 |
| gemini-3.1-flash-lite | 18 | 0% | 0.30 | 61% | 0.91 | 0.96 | 0.31 / 0.22 / 0.24 | 0.69 | 89% | 3632 | 7664 |

## variation

| model | n | fail | alignment | gate | fit | groove | idea kept 1/2/3 | min pair diff | ladder | p50 ms | p90 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gemini-flash-lite-latest | 18 | 0% | 0.31 | 89% | 0.90 | 0.93 | 0.55 / 0.28 / 0.32 | 0.67 | 61% | 3382 | 5311 |
| gemini-3.1-flash-lite | 18 | 0% | 0.30 | 61% | 0.91 | 0.96 | 0.31 / 0.22 / 0.24 | 0.69 | 89% | 3632 | 7664 |
