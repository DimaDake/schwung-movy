# Generator quality: base

42 cases; knobs 4984 ms, pieces 2828 ms, old bench 576 ms. Method and thresholds: plans/2026-10-29-generator-quality-metrics.md.

| metric | base | 
| --- | --- |
| 1 knobs: dead clicks | 20% | 
| 1 knobs: cliffs | 0% | 
| 1 knobs: promise kept | 86% | 
| 1 knobs: broken positions | 2% | 
| 1 knobs: experimental positions | 12% | 
| 1 knobs: duplicate knob pairs | 21 | 
| 1 knobs: refused positions | 1% | 
| 2 space: musical | 80% | 
| 2 space: broken | 2% | 
| 2 space: refused (turn does nothing) | 2% | 
| 2 space: default musical | 85% | 
| 2 space: next to default broken | 2% | 
| 4 piece: musical | 17% | 
| 4 piece: broken | 21% | 
| 4 piece: clash (strong beats) | 6% | 
| 4 piece: chord fit | 0.94 | 
| 4 piece: worst part fit | 0.88 | 
| 4 piece: low-end mud scenes | 11 | 
| 4 piece: role breaks | 0 | 
| 4 piece: B copies A | 0 | 
| 4 piece: A to B distance | 0.77 | 
| 4 piece: chords in A' | 3.54 | 
| old: alignment | 0.64 | 
| old: gate | 88% | 
| old: played-drum gate | 100% | 
| old: variation best-of-six gate | 72% | 
| old: variation novelty | 0.66 | 
| old: variation coherence | 0.91 | 
| old: double first part kept | 0.97 | 
| old: double ending novelty | 0.72 | 
| old: double coherence | 0.92 | 
| old: new clip meaningful | 100% | 
| old: new clip coherence | 0.99 | 
| old: new clip with band | 0.65 | 

## 1. Knobs that break their promise

| knob | kept | swept |
| --- | --- | --- |
| PITCH FIX | 5% | 61 |
| LIKENESS | 24% | 54 |
| AMOUNT | 63% | 155 |
| DYNAMICS | 67% | 412 |
| TENSION | 88% | 188 |
| RANGE | 88% | 159 |
| DRIFT | 88% | 494 |
| VARY | 95% | 194 |
| TIMING | 95% | 155 |
| DENSITY | 97% | 266 |
| LENGTH | 100% | 228 |
| SWING | 100% | 350 |
| GATE | 100% | 240 |
| GHOSTS | 100% | 24 |
| HUMAN | 100% | 72 |

## 1. Worst knobs

| generator knob | share | clicks | what |
| --- | --- | --- | --- |
| variation:d-form UNIT | 100% | 3 | dead clicks |
| variation:v-newline TENSION | 90% | 100 | dead clicks |
| create:n-pad VARY | 90% | 20 | dead clicks |
| double:x-turn TENSION | 90% | 30 | dead clicks |
| variation:v-harmonize TENSION | 90% | 20 | dead clicks |
| variation:v-spread TENSION | 88% | 50 | dead clicks |
| variation:v-ornament TENSION | 88% | 90 | dead clicks |
| variation:v-next TENSION | 88% | 90 | dead clicks |
| variation:v-anticipate TENSION | 88% | 90 | dead clicks |
| variation:v-walk TENSION | 88% | 80 | dead clicks |
| create:n-melody VARY | 87% | 190 | dead clicks |
| variation:v-connect TENSION | 86% | 140 | dead clicks |
| quantize:q-shaped PITCH FIX | 86% | 110 | dead clicks |
| variation:v-comp TENSION | 86% | 50 | dead clicks |
| variation:v-looper TENSION | 86% | 70 | dead clicks |
| create:n-counter VARY | 86% | 90 | dead clicks |
| quantize:q-tight PITCH FIX | 85% | 130 | dead clicks |
| quantize:q-embellish PITCH FIX | 85% | 130 | dead clicks |
| quantize:q-full PITCH FIX | 85% | 130 | dead clicks |
| variation:v-follow TENSION | 85% | 100 | dead clicks |
| create:n-melody RANGE | 50% | 60 | cliffs |
| create:n-pad-euclid DENSITY | 20% | 120 | cliffs |
| create:n-perc DENSITY | 20% | 120 | cliffs |
| variation:v-style LIKENESS | 13% | 150 | cliffs |
| create:n-chords SWING | 10% | 300 | cliffs |
| create:n-stabs SWING | 10% | 300 | cliffs |
| create:n-bass SWING | 10% | 300 | cliffs |
| create:n-pad-pattern DENSITY | 10% | 120 | cliffs |
| variation:v-style DENSITY | 7% | 100 | cliffs |
| variation:v-newline TENSION | 4% | 100 | cliffs |
| create:n-perc SWING | 3% | 120 | cliffs |
| variation:v-recombine AMOUNT | 3% | 140 | cliffs |
| variation:v-newline DENSITY | 2% | 100 | cliffs |
| variation:v-style TENSION | 1% | 150 | cliffs |
| variation:v-walk TENSION | 1% | 80 | cliffs |
| variation:v-retro RANGE | 1% | 80 | cliffs |
| quantize:q-answer PITCH FIX | 1% | 110 | cliffs |
| variation:v-answer TENSION | 1% | 120 | cliffs |
| variation:v-develop AMOUNT | 1% | 130 | cliffs |
| variation:v-connect TENSION | 1% | 140 | cliffs |
| variation:v-bassline HARMONY | 60% | 4 | broken positions |
| variation:v-bassline CHANGES | 50% | 3 | broken positions |
| variation:v-newline HARMONY | 40% | 6 | broken positions |
| variation:v-pulse CHANGES | 33% | 9 | broken positions |
| create:n-arp RATE | 27% | 90 | broken positions |
| variation:v-bassline NOTES | 25% | 12 | broken positions |
| variation:v-arp RATE | 25% | 6 | broken positions |
| variation:v-pulse HARMONY | 23% | 14 | broken positions |
| quantize:qd-ghosts TIMING | 21% | 90 | broken positions |
| variation:v-develop RANGE | 20% | 130 | broken positions |
| variation:v-develop DENSITY | 20% | 150 | broken positions |
| variation:v-bassline LENGTH | 20% | 50 | broken positions |
| variation:v-bassline OCTAVE | 20% | 10 | broken positions |
| variation:v-bassline DYNAMICS | 20% | 50 | broken positions |
| variation:v-bassline SHIFT | 20% | 15 | broken positions |
| variation:v-octave DRIFT | 19% | 100 | broken positions |
| variation:v-develop HARMONY | 18% | 59 | broken positions |
| variation:d-euclid PULSES | 17% | 45 | broken positions |
| variation:v-bassline PATTERN | 16% | 40 | broken positions |
| variation:v-develop TENSION | 14% | 150 | broken positions |

Duplicate knobs: variation:v-spread HARMONY=TENSION; variation:v-connect HARMONY=TENSION; variation:v-comp HARMONY=TENSION; variation:v-ornament HARMONY=TENSION; variation:v-style HARMONY=TENSION; variation:v-form HARMONY=TENSION; variation:v-answer HARMONY=TENSION; variation:v-style HARMONY=TENSION; variation:v-form HARMONY=TENSION; variation:v-next HARMONY=TENSION; variation:v-answer HARMONY=TENSION; variation:v-spread HARMONY=TENSION; variation:v-anticipate HARMONY=TENSION; variation:v-comp HARMONY=TENSION; variation:v-style HARMONY=TENSION; variation:v-form HARMONY=TENSION; double:x-style LIKENESS=DENSITY; double:xd-fill DENSITY=SEED; variation:v-next RHYTHM=VOICES; variation:v-follow RHYTHM=VOICES.

## 2. Knob space by generator (worst first)

Broken reasons: clash 165, wall 51, empty 45, off harmony 22, register 21.

| generator | musical | broken | default broken | next to default broken | samples |
| --- | --- | --- | --- | --- | --- |
| variation:v-arp | 46% | 25% | 0% | 8% | 24 |
| variation:v-octave | 73% | 17% | 0% | 3% | 60 |
| create:n-pad-pattern | 46% | 17% | 0% | 0% | 144 |
| variation:d-euclid | 64% | 17% | 0% | 0% | 36 |
| variation:v-bassline | 53% | 12% | 20% | 17% | 60 |
| create:n-arp | 85% | 10% | 0% | 1% | 360 |
| variation:v-walk | 86% | 8% | 0% | 1% | 96 |
| create:n-pad-euclid | 42% | 8% | 0% | 0% | 144 |
| variation:v-newline | 82% | 8% | 0% | 3% | 120 |
| create:n-perc | 36% | 6% | 0% | 0% | 144 |
| quantize:qd-ghosts | 29% | 6% | 11% | 12% | 108 |
| quantize:q-answer | 84% | 5% | 0% | 1% | 132 |
| variation:v-retro | 90% | 4% | 0% | 1% | 120 |
| variation:v-pulse | 58% | 4% | 7% | 6% | 180 |
| variation:v-halftime | 83% | 4% | 0% | 1% | 180 |
| quantize:q-shaped | 87% | 4% | 0% | 0% | 180 |
| variation:v-anticipate | 89% | 3% | 0% | 0% | 180 |
| variation:v-euclid | 68% | 3% | 0% | 0% | 180 |
| variation:v-develop | 82% | 3% | 20% | 13% | 180 |
| variation:v-motif | 90% | 3% | 0% | 0% | 120 |
| variation:v-connect | 91% | 3% | 0% | 1% | 180 |
| variation:v-style | 83% | 3% | 0% | 1% | 180 |
| create:n-riff | 96% | 3% | 0% | 0% | 360 |
| double:x-turnaround | 78% | 3% | 5% | 4% | 252 |
| double:x-run | 81% | 3% | 0% | 5% | 252 |

## 4. Pieces

| piece | verdict | A | B | A' | clash A/B/A' | role breaks | B copies | A→B | chords A/A' | generators |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| scratch 0 | experimental | M | E | M | 0%/20%/0% | 0 | 0 | 0.73 | 2/3 | A Drums: n-groove, A Bass: n-bass, A Chords: n-chords, A Lead: n-melody, B Drums: d-kick, B Bass: v-pulse, B Chords: v-comp, B Lead: v-euclid, A' Drums: xd-repeat, A' Bass: x-cadence, A' Chords: x-echo, A' Lead: x-style |
| scratch 1 | experimental | M | E | M | 0%/17%/0% | 0 | 0 | 0.78 | 4/4 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, A Lead: n-riff, B Drums: d-turn, B Bass: v-pulse, B Chords: v-form, B Lead: v-follow, A' Drums: xd-style, A' Bass: x-run, A' Chords: x-echo, A' Lead: x-run |
| scratch 2 | experimental | M | E | E | 0%/8%/20% | 0 | 0 | 0.84 | 2/4 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, A Lead: n-arp, B Drums: d-hats, B Bass: v-euclid, B Chords: v-comp, B Lead: v-displace, A' Drums: xd-style, A' Bass: x-style, A' Chords: x-stop, A' Lead: x-style |
| scratch 3 | experimental | M | E | M | 0%/0%/7% | 0 | 0 | 0.76 | 4/5 | A Drums: n-groove, A Bass: n-bass, A Chords: n-chords, A Lead: n-counter, B Drums: d-form, B Bass: v-halftime, B Chords: v-style, B Lead: v-thin, A' Drums: xd-break, A' Bass: x-run, A' Chords: x-cadence, A' Lead: x-stop |
| scratch 4 | experimental | M | M | E | 0%/0%/8% | 0 | 0 | 0.82 | 3/3 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, A Lead: n-melody, B Drums: d-grids, B Bass: v-style, B Chords: v-follow, B Lead: v-displace, A' Drums: xd-roll, A' Bass: x-turnaround, A' Chords: x-push, A' Lead: x-push |
| scratch 5 | broken | M | B | M | 0%/25%/0% | 0 | 0 | 0.86 | 4/6 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, A Lead: n-riff, B Drums: d-style, B Bass: v-develop, B Chords: v-develop, B Lead: v-next, A' Drums: xd-pickup, A' Bass: x-turnaround, A' Chords: x-echo, A' Lead: x-cadence |
| scratch 6 | experimental | M | E | M | 0%/13%/0% | 0 | 0 | 0.72 | 3/5 | A Drums: n-groove, A Bass: n-bass, A Chords: n-chords, A Lead: n-arp, B Drums: d-kick, B Bass: v-euclid, B Chords: v-answer, B Lead: v-pulse, A' Drums: xd-repeat, A' Bass: x-turnaround, A' Chords: x-echo, A' Lead: x-style |
| scratch 7 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.79 | 4/6 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, A Lead: n-counter, B Drums: d-shift, B Bass: v-answer, B Chords: v-comp, B Lead: v-halftime, A' Drums: xd-fill, A' Bass: x-echo, A' Chords: x-echo, A' Lead: x-run |
| scratch 8 | experimental | E | E | E | 0%/8%/0% | 0 | 0 | 0.81 | 3/4 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, A Lead: n-melody, B Drums: d-form, B Bass: v-next, B Chords: v-form, B Lead: v-follow, A' Drums: xd-style, A' Bass: x-style, A' Chords: x-stop, A' Lead: x-stop |
| scratch 9 | experimental | E | M | M | 0%/0%/0% | 0 | 0 | 0.84 | 4/4 | A Drums: n-groove, A Bass: n-bass, A Chords: n-chords, A Lead: n-riff, B Drums: d-hats, B Bass: v-bassline, B Chords: v-halftime, B Lead: v-thin, A' Drums: xd-roll, A' Bass: x-run, A' Chords: x-cadence, A' Lead: x-turnaround |
| scratch 10 | experimental | M | E | M | 0%/13%/0% | 0 | 0 | 0.81 | 3/5 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, A Lead: n-arp, B Drums: d-grids, B Bass: v-style, B Chords: v-follow, B Lead: v-thin, A' Drums: xd-fill, A' Bass: x-turnaround, A' Chords: x-cadence, A' Lead: x-push |
| scratch 11 | experimental | M | E | M | 0%/0%/0% | 0 | 0 | 0.67 | 4/6 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, A Lead: n-counter, B Drums: d-grids, B Bass: v-thin, B Chords: v-develop, B Lead: v-form, A' Drums: xd-pickup, A' Bass: x-turnaround, A' Chords: x-push, A' Lead: x-style |
| motif 0 | experimental | E | E | E | 0%/0%/0% | 0 | 0 | 0.62 | 1/1 | A Drums: n-groove, A Bass: n-bass, A Chords: n-chords, B Drums: d-kick, B Bass: v-displace, B Chords: v-style, B Lead: v-thin, A' Drums: xd-repeat, A' Bass: x-push, A' Chords: x-stop, A' Lead: x-style |
| motif 1 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.77 | 1/2 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, B Drums: d-hats, B Bass: v-develop, B Chords: v-comp, B Lead: v-develop, A' Drums: xd-fill, A' Bass: x-echo, A' Chords: x-echo, A' Lead: x-run |
| motif 2 | experimental | M | E | M | 0%/0%/0% | 0 | 0 | 0.86 | 2/6 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, B Drums: d-hats, B Bass: v-anticipate, B Chords: v-pulse, B Lead: v-style, A' Drums: xd-style, A' Bass: x-stop, A' Chords: x-evolve, A' Lead: x-style |
| motif 3 | musical | M | M | M | 0%/7%/3% | 0 | 0 | 0.66 | 1/2 | A Drums: n-groove, A Bass: n-bass, A Chords: n-chords, B Drums: d-form, B Bass: v-looper, B Chords: v-style, B Lead: v-follow, A' Drums: xd-break, A' Bass: x-run, A' Chords: x-cadence, A' Lead: x-push |
| motif 4 | experimental | M | M | E | 0%/0%/8% | 0 | 0 | 0.79 | 2/2 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, B Drums: d-style, B Bass: v-style, B Chords: v-answer, B Lead: v-follow, A' Drums: xd-roll, A' Bass: x-push, A' Chords: x-push, A' Lead: x-turnaround |
| motif 5 | broken | B | B | E | 25%/25%/19% | 0 | 0 | 0.82 | 2/3 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, B Drums: d-style, B Bass: v-next, B Chords: v-develop, B Lead: v-thin, A' Drums: xd-pickup, A' Bass: x-turnaround, A' Chords: x-echo, A' Lead: x-style |
| motif 6 | broken | M | B | M | 0%/0%/3% | 0 | 0 | 0.62 | 1/2 | A Drums: n-groove, A Bass: n-bass, A Chords: n-chords, B Drums: d-kick, B Bass: v-next, B Chords: v-halftime, B Lead: v-displace, A' Drums: xd-repeat, A' Bass: x-turnaround, A' Chords: x-stop, A' Lead: x-turnaround |
| motif 7 | musical | M | M | M | 0%/3%/7% | 0 | 0 | 0.77 | 1/2 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, B Drums: d-shift, B Bass: v-euclid, B Chords: v-euclid, B Lead: v-next, A' Drums: xd-repeat, A' Bass: x-style, A' Chords: x-style, A' Lead: x-run |
| motif 8 | experimental | E | E | E | 0%/7%/9% | 0 | 0 | 0.82 | 2/2 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, B Drums: d-fill, B Bass: v-style, B Chords: v-comp, B Lead: v-style, A' Drums: xd-fill, A' Bass: x-push, A' Chords: x-push, A' Lead: x-style |
| motif 9 | broken | B | B | E | 25%/31%/15% | 0 | 0 | 0.82 | 2/3 | A Drums: n-groove, A Bass: n-bass, A Chords: n-chords, B Drums: d-hats, B Bass: v-style, B Chords: v-style, B Lead: v-walk, A' Drums: xd-fill, A' Bass: x-run, A' Chords: x-cadence, A' Lead: x-cadence |
| motif 10 | experimental | E | E | M | 0%/8%/0% | 0 | 0 | 0.71 | 1/2 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, B Drums: d-grids, B Bass: v-style, B Chords: v-follow, B Lead: v-register, A' Drums: xd-fill, A' Bass: x-turnaround, A' Chords: x-stop, A' Lead: x-style |
| motif 11 | broken | B | B | B | 25%/38%/21% | 0 | 0 | 0.84 | 1/3 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, B Drums: d-hats, B Bass: v-develop, B Chords: v-develop, B Lead: v-follow, A' Drums: xd-repeat, A' Bass: x-turnaround, A' Chords: x-echo, A' Lead: x-style |
