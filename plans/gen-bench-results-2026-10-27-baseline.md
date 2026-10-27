# Generator bench: baseline

Level BALANCED, 42 cases, 1 run(s) each. Missing sources: gigamidi (gated).

**Alignment** (headline) = best option's recovery of the clean part (messy quantize) or alignment with the real B (variation), 0-1. **Gate** = all three options usable and pairwise different. Fit/groove are diagnostics. Idea kept per option 1 / 2 / 3. Latency excludes cached replies.

## all

| model | n | fail | alignment | gate | fit | groove | idea kept 1/2/3 | min pair diff | ladder | p50 ms | p90 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gemini-2.5-flash-lite | 42 | 100% | - | - | - | - | - / - / - | - | - | 161 | 411 |
| gemini-flash-lite-latest | 42 | 0% | 0.36 | 50% | 0.83 | 0.90 | 0.33 / 0.28 / 0.28 | 0.51 | 67% | 2787 | 4679 |
| gemini-3.1-flash-lite | 42 | 0% | 0.23 | 26% | 0.82 | 0.94 | 0.27 / 0.22 / 0.21 | 0.52 | 79% | 2827 | 5020 |
| gemini-3.5-flash | 42 | 67% | 0.49 | 57% | 0.90 | 0.99 | 0.59 / 0.41 / 0.36 | 0.64 | 71% | 13656 | 24349 |
| gemma-4-26b-a4b-it | 42 | 48% | 0.19 | 23% | 0.85 | 0.76 | 0.27 / 0.25 / 0.21 | 0.44 | 91% | 38493 | 60002 |
| gemma-4-31b-it | 42 | 100% | - | - | - | - | - / - / - | - | - | 459 | 60001 |
| gemini-flash-latest | 42 | 100% | - | - | - | - | - / - / - | - | - | 60000 | 60002 |
| gemini-3.8-flash | 42 | 100% | - | - | - | - | - / - / - | - | - | 60000 | 60002 |

## variation

| model | n | fail | alignment | gate | fit | groove | idea kept 1/2/3 | min pair diff | ladder | p50 ms | p90 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gemini-2.5-flash-lite | 18 | 100% | - | - | - | - | - / - / - | - | - | 411 | 411 |
| gemini-flash-lite-latest | 18 | 0% | 0.31 | 83% | 0.84 | 0.88 | 0.30 / 0.21 / 0.26 | 0.73 | 50% | 2855 | 4847 |
| gemini-3.1-flash-lite | 18 | 0% | 0.13 | 39% | 0.84 | 0.94 | 0.23 / 0.16 / 0.18 | 0.73 | 67% | 2591 | 3749 |
| gemini-3.5-flash | 18 | 56% | 0.27 | 75% | 0.95 | 0.98 | 0.52 / 0.31 / 0.33 | 0.74 | 63% | 17958 | 46561 |
| gemma-4-26b-a4b-it | 18 | 39% | 0.06 | 45% | 0.88 | 0.81 | 0.26 / 0.22 / 0.18 | 0.74 | 82% | 38493 | 60001 |
| gemma-4-31b-it | 18 | 100% | - | - | - | - | - / - / - | - | - | 459 | 459 |
| gemini-flash-latest | 18 | 100% | - | - | - | - | - / - / - | - | - | 60002 | 60002 |
| gemini-3.8-flash | 18 | 100% | - | - | - | - | - / - / - | - | - | 60002 | 60002 |

## quantize-messy

| model | n | fail | alignment | gate | fit | groove | idea kept 1/2/3 | min pair diff | ladder | p50 ms | p90 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gemini-2.5-flash-lite | 18 | 100% | - | - | - | - | - / - / - | - | - | 146 | 161 |
| gemini-flash-lite-latest | 18 | 0% | 0.42 | 22% | 0.82 | 0.93 | 0.32 / 0.30 / 0.28 | 0.42 | 72% | 2438 | 3648 |
| gemini-3.1-flash-lite | 18 | 0% | 0.33 | 11% | 0.80 | 0.98 | 0.25 / 0.24 / 0.20 | 0.40 | 83% | 2668 | 13343 |
| gemini-3.5-flash | 18 | 67% | 0.78 | 33% | 0.83 | 1.00 | 0.68 / 0.53 / 0.39 | 0.49 | 83% | 13571 | 17047 |
| gemma-4-26b-a4b-it | 18 | 56% | 0.37 | 0% | 0.79 | 0.75 | 0.30 / 0.27 / 0.24 | 0.21 | 100% | 23727 | 60002 |
| gemma-4-31b-it | 18 | 100% | - | - | - | - | - / - / - | - | - | 60000 | 60001 |
| gemini-flash-latest | 18 | 100% | - | - | - | - | - / - / - | - | - | 60000 | 60000 |
| gemini-3.8-flash | 18 | 100% | - | - | - | - | - / - / - | - | - | 140 | 60000 |

## quantize-played

| model | n | fail | alignment | gate | fit | groove | idea kept 1/2/3 | min pair diff | ladder | p50 ms | p90 ms |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gemini-2.5-flash-lite | 6 | 100% | - | - | - | - | - / - / - | - | - | - | - |
| gemini-flash-lite-latest | 6 | 0% | - | 33% | - | 0.88 | 0.45 / 0.41 / 0.38 | 0.11 | 100% | 4679 | 7432 |
| gemini-3.1-flash-lite | 6 | 0% | - | 33% | - | 0.87 | 0.44 / 0.37 / 0.29 | 0.25 | 100% | 3610 | 6327 |
| gemini-3.5-flash | 6 | 100% | - | - | - | - | - / - / - | - | - | 184 | 184 |
| gemma-4-26b-a4b-it | 6 | 50% | - | 0% | - | 0.62 | 0.26 / 0.26 / 0.23 | 0.00 | 100% | 60000 | 60002 |
| gemma-4-31b-it | 6 | 100% | - | - | - | - | - / - / - | - | - | - | - |
| gemini-flash-latest | 6 | 100% | - | - | - | - | - / - / - | - | - | - | - |
| gemini-3.8-flash | 6 | 100% | - | - | - | - | - / - / - | - | - | - | - |
