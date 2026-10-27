# Generator bench: algo (algorithmic engine)

42 cases, three options per request (best of three, as the model runs), 169 ms for all runs. Reference: `default-x3` gemini-3.1-flash-lite (cached, not re-run). Dev / holdout: alternate cases per source, fixed.

| run | alignment | quantize recovery | variation | gate | played-drum gate |
| --- | --- | --- | --- | --- | --- |
| AI reference, all | 0.57 | 0.78 | 0.36 | 67% | 72% |
| algorithmic BALANCED, all | 0.59 | 0.87 | 0.30 | 81% | 83% |
| AI reference, dev | 0.59 | 0.78 | 0.39 | 65% | 67% |
| algorithmic, dev | 0.63 | 0.96 | 0.30 | 76% | 67% |
| AI reference, holdout | 0.56 | 0.77 | 0.32 | 70% | 78% |
| algorithmic, holdout | 0.54 | 0.78 | 0.30 | 86% | 100% |
| algorithmic SAFE | 0.59 | 0.87 | 0.32 | 79% | 83% |
| algorithmic WILD | 0.58 | 0.86 | 0.29 | 83% | 83% |

Alignment case by case against the AI mean (±0.03 = tie): 16 better, 9 tied, 10 worse.

## Gate (design §8)

| metric | AI | algorithmic | gate | verdict |
| --- | --- | --- | --- | --- |
| alignment | 0.57 | 0.59 | >= 0.54 | pass |
| quantize recovery | 0.78 | 0.87 | >= 0.75 | pass |
| variation alignment | 0.36 | 0.30 | >= 0.33 | **FAIL** |
| gate | 67% | 81% | >= 62% | pass |
| played-drum gate | 72% | 83% | >= 67% | pass |

Overfitting check: the edge over the model is 0.05 on the dev half and -0.02 on the holdout half; a gap of 0.07 — **larger than the ±0.03 run spread**.


Variation best of six (BALANCED): alignment 0.39, gate 83%.

## Levels (idea kept per option, closest first; min pair difference)

| level | idea kept 1/2/3 | min pair diff |
| --- | --- | --- |
| SAFE | 0.80 / 0.67 / 0.57 | 0.31 |
| BALANCED | 0.80 / 0.66 / 0.57 | 0.35 |
| WILD | 0.79 / 0.64 / 0.56 | 0.36 |

## Case by case (BALANCED vs the AI reference mean)

| case | half | kind | AI align | algo align | AI gate | algo gate | presets | failed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| caps-electronic-0-v | dev | variation | 0.09 | 0.00 | 67% | pass | v-follow v-comp v-spread | 2 |
| caps-electronic-1-v | holdout | variation | 0.00 | 0.00 | 100% | pass | v-follow v-next v-walk | 0 |
| caps-electronic-10-q | dev | quantize-messy | 0.89 | 1.00 | 0% | FAIL gap@1|gap@1|gap@1 | q-tight q-groove q-shaped | 0 |
| caps-electronic-11-q | holdout | quantize-messy | 0.75 | 0.96 | 33% | pass | q-tight q-answer q-shaped | 0 |
| caps-electronic-12-q | dev | quantize-messy | 0.81 | 0.92 | 100% | pass | q-tight q-shaped q-answer | 0 |
| caps-electronic-13-q | holdout | quantize-messy | 0.80 | 0.91 | 0% | FAIL gap@1|gap@1|gap@1 | q-tight q-embellish q-answer | 0 |
| caps-electronic-2-v | dev | variation | 0.02 | 0.00 | 67% | pass | v-follow v-next v-octave | 0 |
| caps-electronic-3-v | holdout | variation | 0.23 | 0.39 | 100% | pass | v-next v-follow v-comp | 0 |
| caps-electronic-4-v | dev | variation | 0.88 | 0.84 | 33% | pass | v-connect v-next v-follow | 1 |
| caps-electronic-5-v | holdout | variation | 0.39 | 0.00 | 100% | pass | v-next v-anticipate v-follow | 3 |
| caps-electronic-6-v | dev | variation | 0.05 | 0.00 | 100% | pass | v-anticipate v-answer v-pulse | 2 |
| caps-electronic-7-q | dev | quantize-messy | 0.67 | 1.00 | 0% | FAIL gap@2|gap@2|gap@2 | q-tight q-embellish q-shaped | 0 |
| caps-electronic-8-q | holdout | quantize-messy | 0.79 | 0.36 | 100% | pass | q-tight q-shaped q-answer | 0 |
| caps-electronic-9-q | dev | quantize-messy | 0.94 | 0.94 | 100% | FAIL ok|ok|ok | q-tight q-groove q-answer | 0 |
| caps-pop-0-v | holdout | variation | 0.73 | 1.00 | 33% | pass | v-follow v-next v-connect | 0 |
| caps-pop-1-v | dev | variation | 0.10 | 0.00 | 100% | pass | v-follow v-next v-octave | 0 |
| caps-pop-2-v | holdout | variation | 0.53 | 0.07 | 100% | pass | v-next v-follow v-comp | 0 |
| caps-pop-3-q | holdout | quantize-messy | 0.92 | 0.90 | 100% | pass | q-tight q-shaped q-answer | 0 |
| caps-pop-4-q | dev | quantize-messy | 0.77 | 0.93 | 100% | FAIL ok|ok|ok | q-tight q-groove q-shaped | 0 |
| caps-pop-5-q | holdout | quantize-messy | 0.93 | 0.80 | 33% | pass | q-tight q-full q-embellish | 0 |
| gmd-funk | dev | quantize-played | - | - | 0% | pass | qd-tight qd-ghosts qd-fill | 0 |
| gmd-hiphop | holdout | quantize-played | - | - | 100% | pass | qd-tight qd-ghosts qd-full | 0 |
| gmd-neworleans | dev | quantize-played | - | - | 100% | FAIL ok|ok|ok | qd-tight qd-tidy qd-ghosts | 0 |
| gmd-pop | holdout | quantize-played | - | - | 67% | pass | qd-tight qd-ghosts qd-fill | 0 |
| gmd-rock | dev | quantize-played | - | - | 100% | pass | qd-tight qd-ghosts qd-fill | 0 |
| gmd-soul | holdout | quantize-played | - | - | 67% | pass | qd-tight qd-ghosts qd-fill | 0 |
| pat-2step-q | dev | quantize-messy | 0.66 | 1.00 | 100% | pass | qd-tight qd-ghosts qd-fill | 0 |
| pat-2step-v | dev | variation | 0.51 | 0.57 | 33% | pass | v-pulse v-follow v-octave | 0 |
| pat-acid-q | holdout | quantize-messy | 0.80 | 0.80 | 67% | pass | q-tight q-shaped q-answer | 0 |
| pat-acid-v | holdout | variation | - | 0.35 | 0% | FAIL ok|ok|density | d-kick d-turn d-hats | 0 |
| pat-arp-q | dev | quantize-messy | 0.88 | 0.92 | 100% | pass | q-tight q-answer q-shaped | 0 |
| pat-arp-v | dev | variation | 0.24 | 0.24 | 67% | pass | d-kick d-turn d-fill | 0 |
| pat-breaks-q | holdout | quantize-messy | 0.74 | 0.97 | 33% | pass | qd-tight qd-ghosts qd-fill | 0 |
| pat-breaks-v | holdout | variation | 0.14 | 0.28 | 100% | pass | v-next v-octave v-follow | 0 |
| pat-dubchords-q | dev | quantize-messy | 0.48 | 1.00 | 100% | pass | q-tight q-full q-answer | 0 |
| pat-dubchords-v | dev | variation | 0.85 | 0.84 | 0% | pass | v-follow v-next v-comp | 1 |
| pat-house-q | holdout | quantize-messy | 0.79 | 0.92 | 100% | FAIL ok|ok|ok | q-tight q-groove q-shaped | 0 |
| pat-house-v | holdout | variation | 0.17 | 0.00 | 67% | pass | d-turn d-fill d-hats | 2 |
| pat-techno-q | dev | quantize-messy | 0.95 | 0.95 | 67% | pass | qd-tight qd-ghosts qd-fill | 0 |
| pat-techno-v | dev | variation | 0.75 | 0.25 | 33% | pass | v-follow v-next v-displace | 2 |
| pat-trap-q | holdout | quantize-messy | 0.44 | 0.44 | 100% | pass | q-groove q-tight q-embellish | 0 |
| pat-trap-v | holdout | variation | 0.41 | 0.58 | 67% | pass | v-next v-displace v-follow | 0 |
