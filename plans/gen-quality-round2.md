# Generator quality: round2

42 cases; knobs 8545 ms, pieces 3548 ms, old bench 2130 ms. Method and thresholds: plans/2026-10-29-generator-quality-metrics.md.

| metric | keyfix | round2 | verdict |
| --- | --- | --- | --- |
| 1 knobs: dead clicks | 15% | 12% | better |
| 1 knobs: cliffs | 0% | 0% | same |
| 1 knobs: promise kept | 89% | 90% | same |
| 1 knobs: broken positions | 1% | 1% | same |
| 1 knobs: experimental positions | 10% | 10% |  |
| 1 knobs: duplicate knob pairs | 15 | 13 | better |
| 1 knobs: refused positions | 1% | 1% | same |
| 1 knobs: useful clicks | 57273 | 59327 | better |
| 1 knobs: register reach (semitones) | 20.14 | 20.18 | same |
| 2 space: musical | 76% | 76% | same |
| 2 space: broken | 1% | 1% | same |
| 2 space: refused (turn does nothing) | 3% | 3% | same |
| 2 space: default musical | 87% | 87% | same |
| 2 space: next to default broken | 1% | 1% | same |
| 3 maps: positions played | 20193 | 20193 |  |
| 3 maps: gradual turns | 80% | 80% | same |
| 3 maps: mean turn | 1.45 | 1.45 | same |
| 3 maps: distinct positions | 94% | 94% | same |
| 3 maps: positions musical | 99% | 99% | same |
| 3 maps: positions broken | 0% | 0% | same |
| 3 maps: onset reach (per bar) | 9.84 | 9.84 | same |
| 5 phrase: SPACE positions | 1200 | 1200 |  |
| 5 phrase: silent positions | 0% | 0% | same |
| 5 phrase: room left | 51% | 50% |  |
| 5 phrase: rests that cut a gesture | 1% | 1% | same |
| 4 piece: musical | 71% | 75% | same |
| 4 piece: broken | 17% | 13% | better |
| 4 piece: clash (strong beats) | 1% | 0% | same |
| 4 piece: chord fit | 0.94 | 0.94 | same |
| 4 piece: worst part fit | 0.88 | 0.88 | same |
| 4 piece: low-end mud scenes | 0 | 0 | same |
| 4 piece: role breaks | 3 | 3 | same |
| 4 piece: B copies A | 0 | 0 | same |
| 4 piece: A to B distance | 0.80 | 0.80 |  |
| 4 piece: chords in A' | 3.54 | 3.46 | same |
| 6 bass: chord arrivals on the keyboard's low note | 9% | 9% | same |
| 6 bass: metrics in the reference band | 91% | 91% | same |
| old: alignment | 0.63 | 0.62 | same |
| old: gate | 76% | 79% | same |
| old: played-drum gate | 100% | 100% | same |
| old: variation best-of-six gate | 67% | 67% | same |
| old: variation novelty | 0.65 | 0.65 | same |
| old: variation coherence | 0.91 | 0.91 | same |
| old: double first part kept | 0.98 | 0.98 | same |
| old: double ending novelty | 0.72 | 0.72 | same |
| old: double coherence | 0.92 | 0.92 | same |
| old: new clip meaningful | 100% | 100% | same |
| old: new clip coherence | 0.98 | 0.98 | same |
| old: new clip with band | 0.75 | 0.77 | same |

## 1. Knobs that break their promise

| knob | kept | swept |
| --- | --- | --- |
| LIKENESS | 24% | 54 |
| FIX NOTES | 64% | 45 |
| AMOUNT | 78% | 209 |
| DYNAMICS | 82% | 235 |
| RANGE | 83% | 155 |
| DRIFT | 89% | 798 |
| LENGTH | 93% | 254 |
| TIMING | 95% | 168 |
| DENSITY | 95% | 473 |
| COLOUR | 96% | 248 |
| GATE | 100% | 374 |
| HUMAN | 100% | 72 |
| GHOSTS | 100% | 15 |

## 1. Worst knobs

| generator knob | share | clicks | what |
| --- | --- | --- | --- |
| variation:d-form UNIT | 100% | 3 | dead clicks |
| variation:v-newline COLOUR | 90% | 100 | dead clicks |
| create:n-harmonize COLOUR | 90% | 60 | dead clicks |
| variation:v-harmonize COLOUR | 90% | 20 | dead clicks |
| variation:v-follow COLOUR | 88% | 120 | dead clicks |
| variation:v-walk AMOUNT | 85% | 60 | dead clicks |
| double:x-evolve COLOUR | 85% | 100 | dead clicks |
| create:n-looper SPREAD | 85% | 150 | dead clicks |
| variation:v-style DENSITY | 85% | 110 | dead clicks |
| variation:v-looper DENSITY | 84% | 70 | dead clicks |
| double:x-style DENSITY | 82% | 240 | dead clicks |
| double:x-turnaround COLOUR | 81% | 210 | dead clicks |
| variation:v-retro AMOUNT | 81% | 100 | dead clicks |
| create:n-follow COLOUR | 80% | 10 | dead clicks |
| quantize:q-tight CLEAN | 80% | 10 | dead clicks |
| double:xd-fill PADS | 80% | 60 | dead clicks |
| variation:d-grids SNARE | 77% | 30 | dead clicks |
| quantize:q-embellish AMOUNT | 75% | 240 | dead clicks |
| variation:v-comp RANGE | 75% | 60 | dead clicks |
| quantize:q-shaped VOICING | 73% | 150 | dead clicks |
| create:n-follow DRIFT | 29% | 140 | cliffs |
| create:n-pad-euclid DENSITY | 20% | 120 | cliffs |
| create:n-perc DENSITY | 20% | 120 | cliffs |
| create:n-melody RANGE | 14% | 180 | cliffs |
| create:n-counter DENSITY | 13% | 300 | cliffs |
| variation:v-style LIKENESS | 13% | 150 | cliffs |
| create:n-pad-pattern DENSITY | 10% | 120 | cliffs |
| create:n-harmonize AMOUNT | 7% | 70 | cliffs |
| quantize:q-shaped FIX NOTES | 7% | 29 | cliffs |
| create:n-hold DRIFT | 7% | 600 | cliffs |
| variation:v-style DENSITY | 5% | 110 | cliffs |
| variation:v-form RANGE | 4% | 180 | cliffs |
| quantize:q-answer FIX NOTES | 4% | 23 | cliffs |
| variation:v-retro RANGE | 4% | 120 | cliffs |
| variation:v-next RANGE | 4% | 168 | cliffs |
| variation:v-style RANGE | 4% | 168 | cliffs |
| variation:v-revoice RANGE | 3% | 180 | cliffs |
| variation:v-recombine AMOUNT | 3% | 120 | cliffs |
| variation:v-newline COLOUR | 3% | 100 | cliffs |
| variation:v-thin RANGE | 2% | 156 | cliffs |
| variation:v-bassline CHORD RATE | 50% | 3 | broken positions |
| variation:v-bassline HARMONY | 40% | 9 | broken positions |
| create:n-follow COLOUR | 36% | 10 | broken positions |
| variation:v-pulse CHORD RATE | 33% | 9 | broken positions |
| variation:v-bassline NOTES | 28% | 20 | broken positions |
| variation:v-bassline SHIFT | 25% | 15 | broken positions |
| variation:v-pulse LENGTH | 23% | 130 | broken positions |
| variation:v-pulse DYNAMICS | 23% | 130 | broken positions |
| quantize:qd-ghosts TIMING | 21% | 90 | broken positions |
| variation:v-bassline LENGTH | 20% | 50 | broken positions |
| variation:v-bassline DYNAMICS | 20% | 50 | broken positions |
| variation:v-pulse RHYTHM | 19% | 143 | broken positions |
| variation:v-pulse DENSITY | 17% | 130 | broken positions |
| create:n-walk OCTAVE | 16% | 90 | broken positions |
| variation:v-bassline PATTERN | 16% | 65 | broken positions |
| variation:v-pulse HARMONY | 14% | 25 | broken positions |
| create:n-harmonize AMOUNT | 13% | 70 | broken positions |
| variation:v-pulse NOTE | 12% | 28 | broken positions |
| variation:v-newline HARMONY | 11% | 16 | broken positions |
| quantize:qd-tight DENSITY | 11% | 90 | broken positions |

Duplicate knobs: variation:v-pulse OCTAVE=RHYTHM; variation:v-hold AMOUNT=SEED; variation:v-displace HARMONY=COLOUR; variation:v-comp HARMONY=COLOUR; variation:v-develop HARMONY=COLOUR; variation:v-displace SEED=MODE,SEED=COLOUR,MODE=COLOUR; variation:v-retro AMOUNT=SEED; quantize:q-octaves AMOUNT=SEED; double:xd-fill DENSITY=SEED; double:x-style LIKENESS=DENSITY; variation:v-next RHYTHM=VOICES; variation:v-follow RHYTHM=VOICES; double:x-style LIKENESS=DENSITY.

## 2. Knob space by generator (worst first)

Broken reasons: register 69, empty 47, clash 32, wall 25, off harmony 11.

| generator | musical | broken | default broken | next to default broken | samples |
| --- | --- | --- | --- | --- | --- |
| create:n-harmonize | 43% | 23% | 0% | 0% | 84 |
| quantize:qd-tight | 40% | 9% | 0% | 0% | 108 |
| quantize:qd-ratchet | 28% | 7% | 0% | 0% | 108 |
| create:n-pad-pattern | 34% | 6% | 0% | 0% | 144 |
| create:n-perc | 30% | 6% | 0% | 0% | 144 |
| quantize:q-mode | 85% | 6% | 0% | 2% | 132 |
| create:n-follow | 54% | 6% | 0% | 0% | 84 |
| create:n-walk | 92% | 6% | 0% | 5% | 360 |
| quantize:qd-ghosts | 29% | 6% | 11% | 12% | 108 |
| quantize:q-answer | 81% | 5% | 0% | 1% | 132 |
| variation:v-bassline | 70% | 5% | 20% | 17% | 60 |
| create:n-pad-euclid | 48% | 4% | 0% | 0% | 144 |
| variation:d-develop | 92% | 3% | 0% | 0% | 36 |
| variation:v-revoice | 86% | 2% | 0% | 0% | 180 |
| double:x-turnaround | 83% | 2% | 5% | 4% | 252 |
| double:x-run | 86% | 2% | 0% | 2% | 252 |
| variation:v-pulse | 64% | 2% | 20% | 15% | 180 |
| variation:v-hold | 92% | 2% | 0% | 0% | 180 |
| variation:v-comp | 73% | 2% | 0% | 0% | 60 |
| quantize:q-mutate | 89% | 2% | 0% | 0% | 180 |
| double:x-echo | 91% | 1% | 7% | 7% | 360 |
| variation:v-answer | 92% | 1% | 0% | 0% | 180 |
| variation:v-displace | 94% | 1% | 0% | 0% | 180 |
| variation:v-develop | 92% | 1% | 0% | 0% | 180 |
| variation:v-style | 90% | 1% | 0% | 0% | 180 |

## 3. Map knobs (every position played)

| generator knob | gradual turns | broken positions | requests |
| --- | --- | --- | --- |
| n-walk PATTERN | 41% | 0% | 30 |
| n-chords HARMONY | 83% | 0% | 3 |
| n-bass PATTERN | 88% | 0% | 30 |
| n-stabs PATTERN | 89% | 0% | 30 |
| n-chords PATTERN | 89% | 0% | 30 |
| n-pulse PATTERN | 90% | 0% | 30 |
| v-comp PATTERN | 90% | 0% | 5 |
| n-drum-map GROOVE | 96% | 0% | 12 |

## 4. Pieces

| piece | verdict | A | B | A' | clash A/B/A' | role breaks | B copies | A→B | chords A/A' | generators |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| scratch 0 | experimental | M | E | M | 0%/0%/0% | 0 | 0 | 0.74 | 2/3 | A Drums: n-broken, A Bass: n-bass, A Chords: n-chords, A Lead: n-melody, B Drums: d-kick, B Bass: v-next, B Chords: n-stabs, B Lead: v-follow, A' Drums: xd-roll, A' Bass: x-turnaround, A' Chords: x-style, A' Lead: x-push |
| scratch 1 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.75 | 4/5 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, A Lead: n-riff, B Drums: d-shift, B Bass: n-bass, B Chords: v-displace, B Lead: v-newline, A' Drums: xd-repeat, A' Bass: x-push, A' Chords: x-echo, A' Lead: x-run |
| scratch 2 | broken | M | M | M | 0%/0%/0% | 1 | 0 | 0.93 | 4/4 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, A Lead: n-arp, B Drums: n-drum-map, B Bass: v-next, B Chords: v-displace, B Lead: n-riff, A' Drums: xd-repeat, A' Bass: x-style, A' Chords: x-style, A' Lead: x-turnaround |
| scratch 3 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.78 | 4/5 | A Drums: n-broken, A Bass: n-bass, A Chords: n-chords, A Lead: n-counter, B Drums: d-develop, B Bass: v-style, B Chords: n-chords, B Lead: v-follow, A' Drums: xd-roll, A' Bass: x-run, A' Chords: x-cadence, A' Lead: x-cadence |
| scratch 4 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.77 | 3/3 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, A Lead: n-melody, B Drums: d-hats, B Bass: n-walk, B Chords: v-comp, B Lead: v-thin, A' Drums: xd-fill, A' Bass: x-stop, A' Chords: x-push, A' Lead: x-turnaround |
| scratch 5 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.80 | 4/5 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, A Lead: n-riff, B Drums: n-broken, B Bass: v-thin, B Chords: v-comp, B Lead: n-melody, A' Drums: xd-repeat, A' Bass: x-cadence, A' Chords: x-echo, A' Lead: x-turnaround |
| scratch 6 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.72 | 4/6 | A Drums: n-broken, A Bass: n-bass, A Chords: n-chords, A Lead: n-arp, B Drums: d-kick, B Bass: v-thin, B Chords: n-stabs, B Lead: v-halftime, A' Drums: xd-repeat, A' Bass: x-push, A' Chords: x-stop, A' Lead: x-echo |
| scratch 7 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.81 | 3/4 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, A Lead: n-counter, B Drums: d-shift, B Bass: n-bass, B Chords: v-style, B Lead: v-displace, A' Drums: xd-style, A' Bass: x-style, A' Chords: x-push, A' Lead: x-run |
| scratch 8 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.89 | 4/4 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, A Lead: n-melody, B Drums: n-drum-map, B Bass: v-bassline, B Chords: v-displace, B Lead: n-counter, A' Drums: xd-break, A' Bass: x-push, A' Chords: x-push, A' Lead: x-echo |
| scratch 9 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.84 | 3/4 | A Drums: n-broken, A Bass: n-bass, A Chords: n-chords, A Lead: n-riff, B Drums: d-develop, B Bass: v-halftime, B Chords: n-chords, B Lead: v-thin, A' Drums: xd-roll, A' Bass: x-run, A' Chords: x-cadence, A' Lead: x-stop |
| scratch 10 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.78 | 2/5 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, A Lead: n-arp, B Drums: d-grids, B Bass: n-walk, B Chords: v-follow, B Lead: v-thin, A' Drums: xd-fill, A' Bass: x-stop, A' Chords: x-style, A' Lead: x-push |
| scratch 11 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.81 | 4/4 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, A Lead: n-counter, B Drums: n-broken, B Bass: v-develop, B Chords: v-develop, B Lead: n-melody, A' Drums: xd-repeat, A' Bass: x-stop, A' Chords: x-echo, A' Lead: x-push |
| motif 0 | musical | M | M | M | 0%/0%/3% | 0 | 0 | 0.73 | 1/3 | A Drums: n-broken, A Bass: n-bass, A Chords: n-chords, B Drums: d-kick, B Bass: v-next, B Chords: n-stabs, B Lead: v-thin, A' Drums: xd-roll, A' Bass: x-push, A' Chords: x-cadence, A' Lead: x-echo |
| motif 1 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.76 | 1/1 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, B Drums: d-shift, B Bass: n-bass, B Chords: v-comp, B Lead: v-develop, A' Drums: xd-repeat, A' Bass: x-push, A' Chords: x-stop, A' Lead: x-run |
| motif 2 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.92 | 2/3 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, B Drums: n-drum-map, B Bass: v-bassline, B Chords: v-develop, B Lead: n-counter, A' Drums: xd-repeat, A' Bass: x-push, A' Chords: x-evolve, A' Lead: x-cadence |
| motif 3 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.78 | 1/1 | A Drums: n-broken, A Bass: n-bass, A Chords: n-chords, B Drums: d-develop, B Bass: v-style, B Chords: n-chords, B Lead: v-form, A' Drums: xd-roll, A' Bass: x-run, A' Chords: x-stop, A' Lead: x-stop |
| motif 4 | experimental | E | E | E | 0%/0%/0% | 0 | 0 | 0.80 | 2/2 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, B Drums: d-hats, B Bass: n-walk, B Chords: v-comp, B Lead: v-next, A' Drums: xd-fill, A' Bass: x-push, A' Chords: x-push, A' Lead: x-push |
| motif 5 | musical | M | M | M | 0%/0%/6% | 0 | 0 | 0.87 | 2/3 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, B Drums: n-broken, B Bass: v-pulse, B Chords: v-thin, B Lead: n-melody, A' Drums: xd-repeat, A' Bass: x-turnaround, A' Chords: x-stop, A' Lead: x-style |
| motif 6 | broken | M | M | M | 0%/0%/0% | 1 | 0 | 0.77 | 1/3 | A Drums: n-broken, A Bass: n-bass, A Chords: n-chords, B Drums: d-kick, B Bass: v-next, B Chords: n-stabs, B Lead: v-displace, A' Drums: xd-repeat, A' Bass: x-turnaround, A' Chords: x-echo, A' Lead: x-turnaround |
| motif 7 | experimental | M | E | M | 0%/17%/0% | 0 | 0 | 0.75 | 1/3 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, B Drums: d-shift, B Bass: n-bass, B Chords: v-comp, B Lead: v-next, A' Drums: xd-style, A' Bass: x-stop, A' Chords: x-push, A' Lead: x-run |
| motif 8 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.85 | 2/3 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, B Drums: n-drum-map, B Bass: v-newline, B Chords: v-style, B Lead: n-counter, A' Drums: xd-break, A' Bass: x-echo, A' Chords: x-push, A' Lead: x-style |
| motif 9 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.85 | 3/4 | A Drums: n-broken, A Bass: n-bass, A Chords: n-chords, B Drums: d-develop, B Bass: v-bassline, B Chords: n-chords, B Lead: v-follow, A' Drums: xd-roll, A' Bass: x-run, A' Chords: x-cadence, A' Lead: x-echo |
| motif 10 | broken | E | M | M | 0%/0%/6% | 1 | 0 | 0.78 | 2/3 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, B Drums: d-grids, B Bass: n-walk, B Chords: v-follow, B Lead: v-next, A' Drums: xd-fill, A' Bass: x-turnaround, A' Chords: x-cadence, A' Lead: x-style |
| motif 11 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.74 | 1/2 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, B Drums: n-broken, B Bass: v-next, B Chords: v-thin, B Lead: n-melody, A' Drums: xd-repeat, A' Bass: x-turnaround, A' Chords: x-echo, A' Lead: x-style |

## 6. Bass over chords (84 user, 144 public reference parts)

| option | n | perBar | gate | legato | silence | steps | repeats | rhythms | root | voicingLow | third | onKick | pitch | in band |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| REF user | | 3.50 | 2.67 | 0.97 | 0.28 | 0.25 | 0.19 | 0.50 | 0.36 | 0.00 | 0.19 | - | 42.00 | |
| REF public | | 5.63 | 1.96 | 0.89 | 0.23 | 0.15 | 0.39 | 0.38 | 0.49 | 0.00 | 0.03 | 0.52 | 35.00 | |
| dbl:x-cadence | 24 | 3.50 | 3.92 | 0.73 | 0.21 | 0.21 | 0.21 | 0.50 | 0.33 | 0.00 | 0.13 | 0.29 | 45.00 | 92% |
| dbl:x-echo | 9 | 4.25 | 2.54 | 0.64 | 0.26 | 0.20 | 0.18 | 0.13 | 0.30 | 0.00 | 0.12 | 0.18 | 45.00 | 83% |
| dbl:x-evolve | 2 | 4.50 | 3.29 | 0.82 | 0.27 | 0.25 | 0.58 | 0.38 | 0.29 | 1.00 | 0.18 | 0.47 | 43.00 | 92% |
| dbl:x-push | 20 | 3.75 | 5.13 | 0.73 | 0.25 | 0.25 | 0.16 | 0.50 | 0.29 | 0.00 | 0.10 | 0.19 | 45.00 | 75% |
| dbl:x-run | 24 | 6.50 | 1.29 | 1.00 | 0.20 | 0.27 | 0.14 | 0.38 | 0.26 | 0.00 | 0.12 | 0.14 | 45.00 | 83% |
| dbl:x-stop | 18 | 4.00 | 4.92 | 0.73 | 0.24 | 0.27 | 0.20 | 0.50 | 0.26 | 0.00 | 0.13 | 0.24 | 42.00 | 83% |
| dbl:x-style | 23 | 4.25 | 3.92 | 0.73 | 0.26 | 0.21 | 0.14 | 0.50 | 0.26 | 0.00 | 0.12 | 0.21 | 45.00 | 92% |
| dbl:x-turnaround | 24 | 4.50 | 3.92 | 0.73 | 0.24 | 0.26 | 0.19 | 0.25 | 0.27 | 0.00 | 0.13 | 0.22 | 44.00 | 92% |
| new:n-bass | 24 | 4.50 | 3.92 | 0.73 | 0.26 | 0.20 | 0.14 | 0.50 | 0.40 | 0.00 | 0.14 | 0.44 | 44.00 | 100% |
| new:n-pulse | 24 | 6.00 | 2.21 | 0.74 | 0.27 | 0.04 | 0.82 | 0.25 | 0.91 | 0.00 | 0.00 | 0.40 | 36.00 | 83% |
| new:n-walk | 24 | 5.00 | 2.54 | 0.82 | 0.13 | 0.34 | 0.44 | 0.75 | 0.60 | 0.00 | 0.05 | 0.36 | 42.00 | 100% |
| qnt:q-answer | 24 | 3.13 | 2.46 | 0.61 | 0.50 | 0.33 | 0.18 | 1.00 | 0.26 | 0.00 | 0.12 | 0.50 | 45.00 | 83% |
| qnt:q-embellish | 14 | 3.75 | 2.00 | 0.79 | 0.33 | 0.54 | 0.13 | 1.00 | 0.32 | 0.00 | 0.20 | 0.40 | 45.00 | 83% |
| qnt:q-mode | 8 | 2.50 | 4.63 | 0.72 | 0.38 | 0.28 | 0.22 | 0.75 | 0.40 | 0.00 | 0.11 | 0.83 | 47.00 | 83% |
| qnt:q-mutate | 8 | 5.25 | 2.17 | 0.67 | 0.36 | 0.25 | 0.08 | 0.50 | 0.25 | 0.00 | 0.15 | 0.34 | 47.00 | 100% |
| qnt:q-octaves | 3 | 4.50 | 3.71 | 0.83 | 0.22 | 0.12 | 0.11 | 0.75 | 0.16 | 0.00 | 0.00 | 0.84 | 47.00 | 83% |
| qnt:q-ratchet | 17 | 6.50 | 1.00 | 0.94 | 0.31 | 0.14 | 0.43 | 1.00 | 0.42 | 0.00 | 0.23 | 0.45 | 43.00 | 75% |
| qnt:q-shaped | 23 | 4.00 | 1.92 | 0.89 | 0.11 | 0.50 | 0.21 | 0.75 | 0.34 | 0.00 | 0.11 | 0.50 | 47.00 | 92% |
| qnt:q-shift | 23 | 3.13 | 2.50 | 0.78 | 0.47 | 0.40 | 0.12 | 0.75 | 0.33 | 0.00 | 0.13 | 0.25 | 44.00 | 92% |
| qnt:q-tight | 24 | 4.25 | 4.04 | 0.72 | 0.34 | 0.22 | 0.13 | 0.75 | 0.40 | 0.00 | 0.14 | 0.43 | 44.00 | 100% |
| var:n-bass | 24 | 4.50 | 3.29 | 0.82 | 0.19 | 0.25 | 0.06 | 0.50 | 0.40 | 0.00 | 0.10 | 0.46 | 45.00 | 92% |
| var:n-walk | 24 | 5.00 | 2.54 | 0.82 | 0.16 | 0.32 | 0.39 | 0.75 | 0.66 | 0.00 | 0.07 | 0.40 | 43.00 | 100% |
| var:v-answer | 24 | 4.50 | 3.54 | 0.73 | 0.26 | 0.31 | 0.24 | 0.50 | 0.43 | 0.00 | 0.17 | 0.44 | 45.00 | 100% |
| var:v-bassline | 24 | 4.50 | 3.88 | 0.96 | 0.06 | 0.32 | 0.10 | 0.50 | 0.50 | 0.00 | 0.07 | 0.86 | 41.00 | 92% |
| var:v-connect | 23 | 4.50 | 3.58 | 0.89 | 0.17 | 0.41 | 0.14 | 1.00 | 0.29 | 0.00 | 0.10 | 0.44 | 43.00 | 75% |
| var:v-develop | 24 | 4.50 | 3.92 | 0.73 | 0.26 | 0.21 | 0.14 | 1.00 | 0.35 | 0.00 | 0.17 | 0.40 | 44.00 | 92% |
| var:v-displace | 24 | 4.50 | 3.58 | 0.60 | 0.47 | 0.22 | 0.17 | 1.00 | 0.46 | 0.00 | 0.14 | 0.33 | 43.00 | 75% |
| var:v-euclid | 24 | 6.00 | 2.75 | 0.96 | 0.09 | 0.19 | 0.14 | 0.25 | 0.31 | 0.00 | 0.11 | 0.33 | 44.00 | 92% |
| var:v-follow | 24 | 4.25 | 3.29 | 0.64 | 0.44 | 0.13 | 0.50 | 0.50 | 0.38 | 0.00 | 0.13 | 0.47 | 44.00 | 100% |
| var:v-form | 24 | 4.00 | 3.92 | 0.64 | 0.38 | 0.16 | 0.21 | 0.50 | 0.30 | 0.00 | 0.19 | 0.50 | 43.00 | 100% |
| var:v-halftime | 24 | 2.00 | 7.88 | 0.78 | 0.19 | 0.22 | 0.11 | 0.50 | 0.60 | 0.00 | 0.04 | 0.31 | 45.00 | 83% |
| var:v-hold | 24 | 4.50 | 3.75 | 0.77 | 0.28 | 0.08 | 0.14 | 0.50 | 0.38 | 0.00 | 0.14 | 0.44 | 41.00 | 100% |
| var:v-looper | 24 | 2.50 | 3.83 | 0.81 | 0.38 | 0.11 | 0.13 | 0.63 | 0.45 | 0.00 | 0.17 | 0.48 | 45.00 | 100% |
| var:v-motif | 24 | 4.00 | 3.92 | 0.73 | 0.25 | 0.17 | 0.20 | 0.25 | 0.38 | 0.00 | 0.13 | 0.50 | 48.00 | 92% |
| var:v-newline | 24 | 4.50 | 3.92 | 0.82 | 0.26 | 0.11 | 0.17 | 0.50 | 0.45 | 0.00 | 0.05 | 0.40 | 45.00 | 100% |
| var:v-next | 24 | 4.25 | 2.92 | 0.68 | 0.47 | 0.17 | 0.24 | 0.88 | 0.43 | 0.00 | 0.17 | 0.52 | 43.00 | 92% |
| var:v-pulse | 24 | 4.50 | 2.92 | 0.82 | 0.22 | 0.22 | 0.58 | 0.75 | 0.78 | 0.00 | 0.00 | 0.50 | 38.00 | 92% |
| var:v-recombine | 24 | 4.50 | 3.92 | 0.73 | 0.26 | 0.17 | 0.14 | 0.50 | 0.33 | 0.00 | 0.11 | 0.44 | 43.00 | 100% |
| var:v-retro | 24 | 4.50 | 3.92 | 0.73 | 0.26 | 0.18 | 0.22 | 0.50 | 0.50 | 0.00 | 0.10 | 0.44 | 43.00 | 92% |
| var:v-revoice | 24 | 4.50 | 3.92 | 0.73 | 0.26 | 0.21 | 0.13 | 0.50 | 0.33 | 0.00 | 0.14 | 0.44 | 45.00 | 100% |
| var:v-style | 24 | 4.00 | 3.92 | 0.73 | 0.27 | 0.22 | 0.13 | 1.00 | 0.27 | 0.00 | 0.11 | 0.33 | 45.00 | 83% |
| var:v-thin | 24 | 2.50 | 6.25 | 0.77 | 0.31 | 0.15 | 0.00 | 0.50 | 0.57 | 0.00 | 0.00 | 0.67 | 43.00 | 92% |
| var:v-walk | 24 | 4.00 | 2.92 | 0.73 | 0.27 | 0.29 | 0.10 | 0.50 | 0.38 | 0.00 | 0.13 | 0.50 | 43.00 | 100% |
