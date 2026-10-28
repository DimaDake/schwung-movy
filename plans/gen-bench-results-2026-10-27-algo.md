# Generator bench: algo (algorithmic engine)

42 cases, three options per request (best of three, as the model runs), 454 ms for all runs. Reference: `default-x3` gemini-3.1-flash-lite (cached, not re-run). Dev / holdout: alternate cases per source, fixed.

| run | alignment | quantize recovery | variation | gate | played-drum gate |
| --- | --- | --- | --- | --- | --- |
| AI reference, all | 0.57 | 0.78 | 0.36 | 67% | 72% |
| algorithmic BALANCED, all | 0.66 | 0.90 | 0.42 | 79% | 100% |
| AI reference, dev | 0.59 | 0.78 | 0.39 | 65% | 67% |
| algorithmic, dev | 0.69 | 0.97 | 0.41 | 81% | 100% |
| AI reference, holdout | 0.56 | 0.77 | 0.32 | 70% | 78% |
| algorithmic, holdout | 0.64 | 0.84 | 0.44 | 76% | 100% |
| algorithmic SAFE | 0.66 | 0.91 | 0.40 | 81% | 100% |
| algorithmic WILD | 0.64 | 0.87 | 0.42 | 76% | 100% |

Alignment case by case against the AI mean (±0.03 = tie): 24 better, 4 tied, 7 worse.

## Gate (design §8)

| metric | AI | algorithmic | gate | verdict |
| --- | --- | --- | --- | --- |
| alignment | 0.57 | 0.66 | >= 0.54 | pass |
| quantize recovery | 0.78 | 0.90 | >= 0.75 | pass |
| variation alignment | 0.36 | 0.42 | >= 0.33 | pass |
| gate | 67% | 79% | >= 62% | pass |
| played-drum gate | 72% | 100% | >= 67% | pass |

Overfitting check: the edge over the model is 0.10 on the dev half and 0.08 on the holdout half; a gap of 0.03, within the ±0.03 run spread.


Variation best of six (BALANCED): alignment 0.49, gate 72%.

## Levels (idea kept per option, closest first; min pair difference)

| level | idea kept 1/2/3 | min pair diff |
| --- | --- | --- |
| SAFE | 0.73 / 0.58 / 0.40 | 0.51 |
| BALANCED | 0.73 / 0.54 / 0.39 | 0.55 |
| WILD | 0.75 / 0.48 / 0.32 | 0.54 |

## Variability between the options of one request

Mean over option pairs, then over requests. Rhythm, notes, pitches and harmony are distances 0-1; range and register in semitones; density a share; lengths in steps; velocity in velocity units. Higher = the options differ more.

| options | requests | rhythm | notes | pitches | harmony | range | register | density | lengths | velocity |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AI (gemini-3.1-flash-lite, cached) | 494 | 0.46 | 0.71 | 0.33 | 0.28 | 2.81 | 2.92 | 0.23 | 1.09 | 7.77 |
| algorithmic, three | 42 | 0.43 | 0.69 | 0.44 | 0.35 | 3.71 | 2.87 | 0.34 | 1.20 | 10.42 |
| algorithmic, six (device) | 18 | 0.60 | 0.82 | 0.47 | 0.39 | 5.59 | 3.55 | 0.39 | 1.43 | 6.92 |
| AI, variation | 38 | 0.47 | 0.75 | 0.28 | 0.28 | 2.09 | 2.51 | 0.23 | 0.58 | 7.44 |
| algorithmic, variation | 18 | 0.53 | 0.78 | 0.53 | 0.39 | 5.89 | 3.89 | 0.43 | 1.80 | 8.51 |
| AI, quantize-messy | 194 | 0.43 | 0.63 | 0.33 | 0.25 | 2.78 | 2.60 | 0.21 | 1.22 | 5.85 |
| algorithmic, quantize-messy | 18 | 0.40 | 0.68 | 0.45 | 0.37 | 2.52 | 2.22 | 0.26 | 0.97 | 11.03 |
| AI, quantize-played | 65 | 0.29 | 0.51 | 0.12 | 0.20 | 0.97 | 0.91 | 0.28 | 0.06 | 13.25 |
| algorithmic, quantize-played | 6 | 0.25 | 0.48 | 0.14 | 0.20 | 0.78 | 1.78 | 0.30 | 0.07 | 14.31 |

A cached reply is matched to the case whose input its options share the most notes with; one matching none is left out of the per-task rows.

## Case by case (BALANCED vs the AI reference mean)

| case | half | kind | AI align | algo align | AI gate | algo gate | presets | failed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| caps-electronic-0-v | dev | variation | 0.09 | 0.15 | 67% | pass | v-follow v-thin v-pulse | 2 |
| caps-electronic-1-v | holdout | variation | 0.00 | 0.50 | 100% | pass | v-next v-follow v-thin | 0 |
| caps-electronic-10-q | dev | quantize-messy | 0.89 | 1.00 | 0% | FAIL gap@1|gap@1|ok | q-tight q-shaped q-full | 0 |
| caps-electronic-11-q | holdout | quantize-messy | 0.75 | 0.96 | 33% | pass | q-tight q-shaped q-full | 0 |
| caps-electronic-12-q | dev | quantize-messy | 0.81 | 0.92 | 100% | pass | q-tight q-shaped q-answer | 0 |
| caps-electronic-13-q | holdout | quantize-messy | 0.80 | 0.91 | 0% | FAIL gap@1|ok|gap@1 | q-tight q-full q-answer | 0 |
| caps-electronic-2-v | dev | variation | 0.02 | 0.21 | 67% | pass | v-next v-follow v-bassline | 0 |
| caps-electronic-3-v | holdout | variation | 0.23 | 0.48 | 100% | pass | v-follow v-spread v-comp | 0 |
| caps-electronic-4-v | dev | variation | 0.88 | 0.97 | 33% | pass | v-thin v-next v-follow | 1 |
| caps-electronic-5-v | holdout | variation | 0.39 | 0.61 | 100% | pass | v-follow v-walk v-answer | 4 |
| caps-electronic-6-v | dev | variation | 0.05 | 0.00 | 100% | pass | v-follow v-next v-octave | 2 |
| caps-electronic-7-q | dev | quantize-messy | 0.67 | 1.00 | 0% | FAIL gap@2|gap@2|ok | q-tight q-shaped q-full | 0 |
| caps-electronic-8-q | holdout | quantize-messy | 0.79 | 0.36 | 100% | pass | q-tight q-full q-shaped | 0 |
| caps-electronic-9-q | dev | quantize-messy | 0.94 | 0.94 | 100% | FAIL ok|ok|gap@1 | q-tight q-shaped q-answer | 0 |
| caps-pop-0-v | holdout | variation | 0.73 | 0.69 | 33% | pass | v-follow v-thin v-next | 0 |
| caps-pop-1-v | dev | variation | 0.10 | 0.05 | 100% | pass | v-follow v-bassline v-pulse | 0 |
| caps-pop-2-v | holdout | variation | 0.53 | 0.17 | 100% | FAIL ok|ok|density | v-follow v-comp v-next | 0 |
| caps-pop-3-q | holdout | quantize-messy | 0.92 | 0.97 | 100% | pass | q-tight q-shaped q-full | 0 |
| caps-pop-4-q | dev | quantize-messy | 0.77 | 0.93 | 100% | pass | q-tight q-groove q-full | 0 |
| caps-pop-5-q | holdout | quantize-messy | 0.93 | 0.93 | 33% | FAIL ok|ok|density | q-tight q-groove q-full | 0 |
| gmd-funk | dev | quantize-played | - | - | 0% | pass | qd-tight qd-ghosts qd-fill | 0 |
| gmd-hiphop | holdout | quantize-played | - | - | 100% | pass | qd-tight qd-ghosts qd-fill | 0 |
| gmd-neworleans | dev | quantize-played | - | - | 100% | pass | qd-tight qd-fill qd-ghosts | 0 |
| gmd-pop | holdout | quantize-played | - | - | 67% | pass | qd-tight qd-ghosts qd-fill | 0 |
| gmd-rock | dev | quantize-played | - | - | 100% | pass | qd-tight qd-ghosts qd-fill | 0 |
| gmd-soul | holdout | quantize-played | - | - | 67% | pass | qd-tight qd-ghosts qd-fill | 0 |
| pat-2step-q | dev | quantize-messy | 0.66 | 1.00 | 100% | pass | qd-tight qd-ghosts qd-fill | 0 |
| pat-2step-v | dev | variation | 0.51 | 0.71 | 33% | pass | v-follow v-pulse v-octave | 0 |
| pat-acid-q | holdout | quantize-messy | 0.80 | 0.84 | 67% | pass | q-tight q-shaped q-answer | 0 |
| pat-acid-v | holdout | variation | - | 0.10 | 0% | FAIL ok|ok|density | d-kick d-turn d-ghosts | 0 |
| pat-arp-q | dev | quantize-messy | 0.88 | 0.98 | 100% | pass | q-tight q-answer q-shaped | 0 |
| pat-arp-v | dev | variation | 0.24 | 0.51 | 67% | FAIL ok|ok|density | d-kick d-turn d-hats | 0 |
| pat-breaks-q | holdout | quantize-messy | 0.74 | 0.97 | 33% | pass | qd-tight qd-ghosts qd-fill | 0 |
| pat-breaks-v | holdout | variation | 0.14 | 0.81 | 100% | FAIL ok|ok|density | v-follow v-pulse v-thin | 0 |
| pat-dubchords-q | dev | quantize-messy | 0.48 | 1.00 | 100% | pass | q-tight q-full q-answer | 0 |
| pat-dubchords-v | dev | variation | 0.85 | 0.84 | 0% | pass | v-follow v-thin v-next | 1 |
| pat-house-q | holdout | quantize-messy | 0.79 | 0.95 | 100% | pass | q-tight q-shaped q-full | 0 |
| pat-house-v | holdout | variation | 0.17 | 0.00 | 67% | pass | d-kick d-turn d-fill | 2 |
| pat-techno-q | dev | quantize-messy | 0.95 | 0.95 | 67% | pass | qd-tight qd-ghosts qd-fill | 0 |
| pat-techno-v | dev | variation | 0.75 | 0.25 | 33% | pass | v-follow v-arp v-displace | 2 |
| pat-trap-q | holdout | quantize-messy | 0.44 | 0.67 | 100% | pass | q-tight q-tidy q-full | 0 |
| pat-trap-v | holdout | variation | 0.41 | 0.58 | 67% | pass | v-newline v-thin v-follow | 0 |
