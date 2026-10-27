# Generator bench: names-device

Level BALANCED, 42 cases, 3 run(s) each. Missing sources: gigamidi (gated).

**Alignment** (headline) = best option's recovery of the clean part (messy quantize) or alignment with the real B (variation), 0-1. **Gate** = all three options usable and pairwise different. Fit/groove are diagnostics. Idea kept per option 1 / 2 / 3. Latency excludes cached replies.

## all

| model | n | fail | alignment | gate | fit | groove | idea kept 1/2/3 | min pair diff | ladder | p50 ms | p90 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gemini-3.1-flash-lite | 126 | 40% | 0.59 | 59% | 0.89 | 0.93 | 0.61 / 0.38 / 0.34 | 0.58 | 71% | 4377 | 6141 |

## variation

| model | n | fail | alignment | gate | fit | groove | idea kept 1/2/3 | min pair diff | ladder | p50 ms | p90 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gemini-3.1-flash-lite | 54 | 41% | 0.35 | 63% | 0.94 | 0.95 | 0.34 / 0.23 / 0.23 | 0.69 | 69% | 4140 | 5684 |

## quantize-messy

| model | n | fail | alignment | gate | fit | groove | idea kept 1/2/3 | min pair diff | ladder | p50 ms | p90 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gemini-3.1-flash-lite | 54 | 41% | 0.81 | 53% | 0.84 | 0.94 | 0.83 / 0.46 / 0.37 | 0.56 | 72% | 4244 | 5200 |

## quantize-played

| model | n | fail | alignment | gate | fit | groove | idea kept 1/2/3 | min pair diff | ladder | p50 ms | p90 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gemini-3.1-flash-lite | 18 | 33% | - | 67% | - | 0.86 | 0.72 / 0.54 / 0.53 | 0.33 | 75% | 5764 | 7330 |

## Note: read with the paired comparison

Run 3 of 3 never ran: gemini-3.1-flash-lite hit its daily free quota (instant
429s) and the runner gave up, so the 40% "fail" above is quota, not the model.
The fair reading is paired: the same case and run, answered in both this run
and `default-x3`. See the summary's "Track names" section.
