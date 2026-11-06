# Generator quality: bass40

42 cases; knobs 8431 ms, pieces 11341 ms, old bench 1991 ms. Method and thresholds: plans/2026-10-29-generator-quality-metrics.md.

| metric | pre-bass40 | bass40 | verdict |
| --- | --- | --- | --- |
| 1 knobs: dead clicks | 15% | 15% | same |
| 1 knobs: cliffs | 0% | 0% | same |
| 1 knobs: promise kept | 87% | 89% | same |
| 1 knobs: broken positions | 1% | 1% | same |
| 1 knobs: experimental positions | 10% | 10% |  |
| 1 knobs: duplicate knob pairs | 9 | 15 | **REGRESSED** |
| 1 knobs: refused positions | 1% | 1% | same |
| 1 knobs: useful clicks | 57371 | 57260 | **REGRESSED** |
| 1 knobs: register reach (semitones) | 20.12 | 20.15 | same |
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
| 3 maps: onset reach (per bar) | 10.02 | 9.84 | same |
| 5 phrase: SPACE positions | 1200 | 1200 |  |
| 5 phrase: silent positions | 0% | 0% | same |
| 5 phrase: room left | 53% | 51% |  |
| 5 phrase: rests that cut a gesture | 1% | 1% | same |
| 4 piece: musical | 63% | 65% | same |
| 4 piece: broken | 20% | 16% | better |
| 4 piece: clash (strong beats) | 0% | 1% | same |
| 4 piece: chord fit | 0.94 | 0.94 | same |
| 4 piece: worst part fit | 0.87 | 0.88 | same |
| 4 piece: low-end mud scenes | 0 | 2 | **REGRESSED** |
| 4 piece: role breaks | 13 | 11 | better |
| 4 piece: B copies A | 0 | 0 | same |
| 4 piece: A to B distance | 0.80 | 0.82 |  |
| 4 piece: chords in A' | 3.33 | 3.63 | better |
| 6 bass: chord arrivals on the keyboard's low note | - | 9% |  |
| 6 bass: metrics in the reference band | - | 91% |  |
| old: alignment | 0.63 | 0.63 | same |
| old: gate | 67% | 76% | better |
| old: played-drum gate | 100% | 100% | same |
| old: variation best-of-six gate | 50% | 67% | better |
| old: variation novelty | 0.67 | 0.65 | same |
| old: variation coherence | 0.93 | 0.92 | same |
| old: double first part kept | 0.98 | 0.98 | same |
| old: double ending novelty | 0.72 | 0.72 | same |
| old: double coherence | 0.92 | 0.91 | same |
| old: new clip meaningful | 100% | 100% | same |
| old: new clip coherence | 0.99 | 0.98 | same |
| old: new clip with band | 0.76 | 0.75 | same |

## 1. Knobs that break their promise

| knob | kept | swept |
| --- | --- | --- |
| LIKENESS | 24% | 54 |
| FIX NOTES | 67% | 45 |
| AMOUNT | 79% | 209 |
| DYNAMICS | 82% | 235 |
| RANGE | 83% | 155 |
| DRIFT | 87% | 799 |
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
| double:x-evolve COLOUR | 86% | 100 | dead clicks |
| variation:v-walk AMOUNT | 85% | 60 | dead clicks |
| create:n-looper SPREAD | 85% | 150 | dead clicks |
| variation:v-style DENSITY | 85% | 110 | dead clicks |
| variation:v-looper DENSITY | 84% | 70 | dead clicks |
| double:x-style DENSITY | 82% | 240 | dead clicks |
| double:x-turnaround COLOUR | 82% | 210 | dead clicks |
| variation:v-retro AMOUNT | 81% | 100 | dead clicks |
| create:n-follow COLOUR | 80% | 10 | dead clicks |
| quantize:q-tight CLEAN | 80% | 10 | dead clicks |
| double:xd-fill PADS | 80% | 60 | dead clicks |
| variation:d-grids SNARE | 77% | 30 | dead clicks |
| quantize:q-embellish AMOUNT | 75% | 240 | dead clicks |
| variation:v-comp RANGE | 75% | 60 | dead clicks |
| quantize:q-shaped VOICING | 73% | 150 | dead clicks |
| create:n-pad-euclid DENSITY | 20% | 120 | cliffs |
| create:n-perc DENSITY | 20% | 120 | cliffs |
| create:n-melody RANGE | 17% | 180 | cliffs |
| create:n-counter DENSITY | 13% | 300 | cliffs |
| variation:v-style LIKENESS | 13% | 150 | cliffs |
| create:n-pad-pattern DENSITY | 10% | 120 | cliffs |
| create:n-follow DRIFT | 8% | 140 | cliffs |
| create:n-harmonize AMOUNT | 7% | 70 | cliffs |
| quantize:q-shaped FIX NOTES | 7% | 29 | cliffs |
| variation:v-form RANGE | 6% | 180 | cliffs |
| variation:v-style DENSITY | 5% | 110 | cliffs |
| quantize:q-answer FIX NOTES | 4% | 23 | cliffs |
| variation:v-next RANGE | 4% | 168 | cliffs |
| variation:v-retro RANGE | 4% | 120 | cliffs |
| variation:v-style RANGE | 4% | 168 | cliffs |
| variation:v-revoice RANGE | 3% | 180 | cliffs |
| variation:v-recombine AMOUNT | 3% | 120 | cliffs |
| variation:v-newline COLOUR | 3% | 100 | cliffs |
| create:n-hold DRIFT | 3% | 600 | cliffs |
| variation:v-thin RANGE | 2% | 156 | cliffs |
| variation:v-bassline HARMONY | 80% | 4 | broken positions |
| variation:v-bassline CHORD RATE | 50% | 3 | broken positions |
| create:n-follow COLOUR | 36% | 10 | broken positions |
| variation:v-pulse CHORD RATE | 33% | 9 | broken positions |
| variation:v-bassline NOTES | 28% | 20 | broken positions |
| variation:v-bassline SHIFT | 25% | 15 | broken positions |
| variation:v-pulse LENGTH | 23% | 130 | broken positions |
| variation:v-pulse DYNAMICS | 23% | 130 | broken positions |
| variation:v-newline HARMONY | 22% | 11 | broken positions |
| quantize:qd-ghosts TIMING | 21% | 90 | broken positions |
| variation:v-bassline LENGTH | 20% | 50 | broken positions |
| variation:v-bassline DYNAMICS | 20% | 50 | broken positions |
| variation:v-pulse RHYTHM | 19% | 143 | broken positions |
| variation:v-pulse DENSITY | 17% | 130 | broken positions |
| variation:v-pulse HARMONY | 16% | 20 | broken positions |
| create:n-walk OCTAVE | 16% | 90 | broken positions |
| variation:v-bassline PATTERN | 16% | 65 | broken positions |
| create:n-harmonize AMOUNT | 13% | 70 | broken positions |
| variation:v-pulse NOTE | 12% | 28 | broken positions |
| quantize:qd-tight DENSITY | 11% | 90 | broken positions |

Duplicate knobs: variation:v-pulse OCTAVE=RHYTHM; variation:v-hold AMOUNT=SEED; variation:v-displace HARMONY=COLOUR; variation:v-comp HARMONY=COLOUR; variation:v-develop HARMONY=COLOUR; variation:v-displace SEED=MODE,SEED=COLOUR,MODE=COLOUR; variation:v-retro AMOUNT=SEED; quantize:q-octaves AMOUNT=SEED; create:n-hold NOTE=DRIFT; double:xd-fill DENSITY=SEED; double:x-style LIKENESS=DENSITY; create:n-hold NOTE=DRIFT; variation:v-next RHYTHM=VOICES; variation:v-follow RHYTHM=VOICES; double:x-style LIKENESS=DENSITY.

## 2. Knob space by generator (worst first)

Broken reasons: register 69, empty 47, clash 32, wall 25, off harmony 11.

| generator | musical | broken | default broken | next to default broken | samples |
| --- | --- | --- | --- | --- | --- |
| create:n-harmonize | 43% | 24% | 0% | 0% | 84 |
| quantize:qd-tight | 40% | 9% | 0% | 0% | 108 |
| quantize:qd-ratchet | 28% | 7% | 0% | 0% | 108 |
| create:n-pad-pattern | 34% | 6% | 0% | 0% | 144 |
| create:n-perc | 30% | 6% | 0% | 0% | 144 |
| create:n-walk | 92% | 6% | 0% | 5% | 360 |
| quantize:q-mode | 80% | 6% | 0% | 2% | 132 |
| create:n-follow | 55% | 6% | 0% | 0% | 84 |
| quantize:qd-ghosts | 29% | 6% | 11% | 12% | 108 |
| quantize:q-answer | 83% | 5% | 0% | 1% | 132 |
| create:n-pad-euclid | 48% | 4% | 0% | 0% | 144 |
| variation:v-pulse | 63% | 3% | 20% | 15% | 180 |
| variation:v-bassline | 70% | 3% | 20% | 17% | 60 |
| variation:d-develop | 92% | 3% | 0% | 0% | 36 |
| variation:v-hold | 92% | 2% | 0% | 0% | 180 |
| double:x-turnaround | 83% | 2% | 5% | 4% | 252 |
| create:n-hold | 59% | 2% | 0% | 0% | 360 |
| variation:v-revoice | 86% | 2% | 0% | 0% | 180 |
| variation:v-comp | 73% | 2% | 0% | 0% | 60 |
| variation:v-newline | 95% | 2% | 0% | 3% | 120 |
| quantize:q-mutate | 89% | 2% | 0% | 0% | 180 |
| double:x-run | 87% | 2% | 0% | 2% | 252 |
| double:x-echo | 90% | 1% | 7% | 7% | 360 |
| variation:v-answer | 92% | 1% | 0% | 0% | 180 |
| variation:v-develop | 92% | 1% | 0% | 0% | 180 |

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
| scratch 0 | musical | M | M | M | 0%/0%/6% | 0 | 0 | 0.74 | 2/3 | A Drums: n-broken, A Bass: n-bass, A Chords: n-chords, A Lead: n-melody, B Drums: d-kick, B Bass: v-halftime, B Chords: n-stabs, B Lead: v-displace, A' Drums: xd-roll, A' Bass: x-turnaround, A' Chords: x-style, A' Lead: x-style |
| scratch 1 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.74 | 4/5 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, A Lead: n-riff, B Drums: d-shift, B Bass: n-bass, B Chords: v-displace, B Lead: v-halftime, A' Drums: xd-repeat, A' Bass: x-push, A' Chords: x-echo, A' Lead: x-run |
| scratch 2 | broken | M | M | M | 0%/0%/0% | 1 | 0 | 0.93 | 4/4 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, A Lead: n-arp, B Drums: n-drum-map, B Bass: v-next, B Chords: v-displace, B Lead: n-riff, A' Drums: xd-repeat, A' Bass: x-style, A' Chords: x-style, A' Lead: x-turnaround |
| scratch 3 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.79 | 4/5 | A Drums: n-broken, A Bass: n-bass, A Chords: n-chords, A Lead: n-counter, B Drums: d-develop, B Bass: v-style, B Chords: n-chords, B Lead: v-follow, A' Drums: xd-roll, A' Bass: x-run, A' Chords: x-cadence, A' Lead: x-cadence |
| scratch 4 | broken | M | B | M | 0%/38%/0% | 0 | 0 | 0.80 | 3/4 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, A Lead: n-melody, B Drums: d-hats, B Bass: n-walk, B Chords: v-follow, B Lead: v-follow, A' Drums: xd-fill, A' Bass: x-stop, A' Chords: x-cadence, A' Lead: x-turnaround |
| scratch 5 | broken | M | M | M | 0%/0%/8% | 1 | 0 | 0.84 | 4/6 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, A Lead: n-riff, B Drums: n-broken, B Bass: v-next, B Chords: v-comp, B Lead: n-melody, A' Drums: xd-repeat, A' Bass: x-stop, A' Chords: x-stop, A' Lead: x-cadence |
| scratch 6 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.72 | 4/6 | A Drums: n-broken, A Bass: n-bass, A Chords: n-chords, A Lead: n-arp, B Drums: d-kick, B Bass: v-thin, B Chords: n-stabs, B Lead: v-halftime, A' Drums: xd-repeat, A' Bass: x-push, A' Chords: x-stop, A' Lead: x-echo |
| scratch 7 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.82 | 4/4 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, A Lead: n-counter, B Drums: d-shift, B Bass: n-bass, B Chords: v-euclid, B Lead: v-style, A' Drums: xd-style, A' Bass: x-style, A' Chords: x-echo, A' Lead: x-run |
| scratch 8 | experimental | M | E | M | 0%/0%/0% | 0 | 0 | 0.88 | 4/4 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, A Lead: n-melody, B Drums: n-drum-map, B Bass: v-bassline, B Chords: v-displace, B Lead: n-counter, A' Drums: xd-break, A' Bass: x-push, A' Chords: x-style, A' Lead: x-echo |
| scratch 9 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.83 | 4/5 | A Drums: n-broken, A Bass: n-bass, A Chords: n-chords, A Lead: n-riff, B Drums: d-develop, B Bass: v-halftime, B Chords: n-chords, B Lead: v-thin, A' Drums: xd-roll, A' Bass: x-run, A' Chords: x-cadence, A' Lead: x-stop |
| scratch 10 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.75 | 2/4 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, A Lead: n-arp, B Drums: d-grids, B Bass: n-walk, B Chords: v-follow, B Lead: v-thin, A' Drums: xd-fill, A' Bass: x-stop, A' Chords: x-cadence, A' Lead: x-push |
| scratch 11 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.81 | 4/4 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, A Lead: n-counter, B Drums: n-broken, B Bass: v-develop, B Chords: v-develop, B Lead: n-melody, A' Drums: xd-repeat, A' Bass: x-stop, A' Chords: x-echo, A' Lead: x-push |
| scratch 12 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.76 | 3/5 | A Drums: n-broken, A Bass: n-bass, A Chords: n-chords, A Lead: n-melody, B Drums: d-kick, B Bass: v-thin, B Chords: n-stabs, B Lead: v-follow, A' Drums: xd-fill, A' Bass: x-cadence, A' Chords: x-cadence, A' Lead: x-style |
| scratch 13 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.79 | 3/4 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, A Lead: n-riff, B Drums: d-form, B Bass: n-bass, B Chords: v-euclid, B Lead: v-style, A' Drums: xd-break, A' Bass: x-echo, A' Chords: x-echo, A' Lead: x-run |
| scratch 14 | broken | M | E | M | 0%/0%/3% | 1 | 0 | 0.92 | 3/5 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, A Lead: n-arp, B Drums: n-drum-map, B Bass: v-bassline, B Chords: v-displace, B Lead: n-riff, A' Drums: xd-repeat, A' Bass: x-echo, A' Chords: x-style, A' Lead: x-turnaround |
| scratch 15 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.82 | 2/4 | A Drums: n-broken, A Bass: n-bass, A Chords: n-chords, A Lead: n-counter, B Drums: d-hats, B Bass: v-displace, B Chords: n-chords, B Lead: v-follow, A' Drums: xd-fill, A' Bass: x-run, A' Chords: x-cadence, A' Lead: x-turnaround |
| scratch 16 | experimental | M | E | M | 0%/0%/0% | 0 | 0 | 0.81 | 3/4 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, A Lead: n-melody, B Drums: d-style, B Bass: n-walk, B Chords: v-next, B Lead: v-thin, A' Drums: xd-fill, A' Bass: x-stop, A' Chords: x-stop, A' Lead: x-cadence |
| scratch 17 | experimental | M | E | M | 0%/0%/4% | 0 | 0 | 0.89 | 4/4 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, A Lead: n-riff, B Drums: n-broken, B Bass: v-next, B Chords: v-follow, B Lead: n-bass, A' Drums: xd-break, A' Bass: x-stop, A' Chords: x-stop, A' Lead: x-turnaround |
| scratch 18 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.73 | 3/5 | A Drums: n-broken, A Bass: n-bass, A Chords: n-chords, A Lead: n-arp, B Drums: d-kick, B Bass: v-next, B Chords: n-stabs, B Lead: v-thin, A' Drums: xd-repeat, A' Bass: x-echo, A' Chords: x-push, A' Lead: x-style |
| scratch 19 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.77 | 4/5 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, A Lead: n-counter, B Drums: d-shift, B Bass: n-bass, B Chords: v-next, B Lead: v-euclid, A' Drums: xd-fill, A' Bass: x-turnaround, A' Chords: x-echo, A' Lead: x-run |
| scratch 20 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.94 | 3/4 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, A Lead: n-melody, B Drums: n-drum-map, B Bass: v-thin, B Chords: v-displace, B Lead: n-counter, A' Drums: xd-style, A' Bass: x-echo, A' Chords: x-stop, A' Lead: x-echo |
| scratch 21 | experimental | E | M | M | 0%/0%/0% | 0 | 0 | 0.82 | 3/3 | A Drums: n-broken, A Bass: n-bass, A Chords: n-chords, A Lead: n-riff, B Drums: d-hats, B Bass: v-thin, B Chords: n-chords, B Lead: v-halftime, A' Drums: xd-roll, A' Bass: x-run, A' Chords: x-cadence, A' Lead: x-stop |
| scratch 22 | musical | M | M | M | 0%/0%/6% | 0 | 0 | 0.81 | 3/4 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, A Lead: n-arp, B Drums: d-develop, B Bass: n-walk, B Chords: v-follow, B Lead: v-develop, A' Drums: xd-fill, A' Bass: x-turnaround, A' Chords: x-cadence, A' Lead: x-push |
| scratch 23 | broken | M | M | M | 0%/0%/0% | 1 | 0 | 0.94 | 2/4 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, A Lead: n-counter, B Drums: n-broken, B Bass: v-next, B Chords: v-thin, B Lead: n-melody, A' Drums: xd-style, A' Bass: x-turnaround, A' Chords: x-stop, A' Lead: x-style |
| scratch 24 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.72 | 4/5 | A Drums: n-broken, A Bass: n-bass, A Chords: n-chords, A Lead: n-melody, B Drums: d-kick, B Bass: v-walk, B Chords: n-stabs, B Lead: v-newline, A' Drums: xd-style, A' Bass: x-cadence, A' Chords: x-echo, A' Lead: x-style |
| scratch 25 | musical | M | M | M | 6%/0%/6% | 0 | 0 | 0.82 | 4/6 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, A Lead: n-riff, B Drums: d-form, B Bass: n-bass, B Chords: v-comp, B Lead: v-style, A' Drums: xd-fill, A' Bass: x-echo, A' Chords: x-push, A' Lead: x-run |
| scratch 26 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.89 | 3/4 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, A Lead: n-arp, B Drums: n-drum-map, B Bass: v-pulse, B Chords: v-pulse, B Lead: n-riff, A' Drums: xd-repeat, A' Bass: x-style, A' Chords: x-push, A' Lead: x-turnaround |
| scratch 27 | musical | M | M | M | 0%/0%/6% | 0 | 0 | 0.83 | 4/4 | A Drums: n-broken, A Bass: n-bass, A Chords: n-chords, A Lead: n-counter, B Drums: d-hats, B Bass: v-halftime, B Chords: n-chords, B Lead: v-connect, A' Drums: xd-roll, A' Bass: x-run, A' Chords: x-cadence, A' Lead: x-turnaround |
| scratch 28 | broken | M | M | M | 0%/0%/0% | 1 | 0 | 0.77 | 3/4 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, A Lead: n-melody, B Drums: d-hats, B Bass: n-walk, B Chords: v-follow, B Lead: v-halftime, A' Drums: xd-fill, A' Bass: x-turnaround, A' Chords: x-cadence, A' Lead: x-cadence |
| scratch 29 | experimental | M | E | M | 0%/0%/0% | 0 | 0 | 0.90 | 4/5 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, A Lead: n-riff, B Drums: n-broken, B Bass: v-next, B Chords: v-follow, B Lead: n-bass, A' Drums: xd-fill, A' Bass: x-cadence, A' Chords: x-cadence, A' Lead: x-style |
| scratch 30 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.78 | 4/5 | A Drums: n-broken, A Bass: n-bass, A Chords: n-chords, A Lead: n-arp, B Drums: d-shift, B Bass: v-pulse, B Chords: n-stabs, B Lead: v-style, A' Drums: xd-repeat, A' Bass: x-cadence, A' Chords: x-style, A' Lead: x-echo |
| scratch 31 | broken | B | B | B | 0%/31%/0% | 0 | 0 | 0.73 | 4/4 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, A Lead: n-counter, B Drums: d-hats, B Bass: n-bass, B Chords: v-thin, B Lead: v-style, A' Drums: xd-style, A' Bass: x-stop, A' Chords: x-echo, A' Lead: x-run |
| scratch 32 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.89 | 3/4 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, A Lead: n-melody, B Drums: n-drum-map, B Bass: v-thin, B Chords: v-comp, B Lead: n-counter, A' Drums: xd-style, A' Bass: x-style, A' Chords: x-style, A' Lead: x-push |
| scratch 33 | broken | M | M | M | 0%/0%/0% | 1 | 0 | 0.80 | 4/4 | A Drums: n-broken, A Bass: n-bass, A Chords: n-chords, A Lead: n-riff, B Drums: d-grids, B Bass: v-style, B Chords: n-chords, B Lead: v-thin, A' Drums: xd-roll, A' Bass: x-run, A' Chords: x-cadence, A' Lead: x-stop |
| scratch 34 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.73 | 3/3 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, A Lead: n-arp, B Drums: d-develop, B Bass: n-walk, B Chords: v-follow, B Lead: v-thin, A' Drums: xd-fill, A' Bass: x-stop, A' Chords: x-cadence, A' Lead: x-cadence |
| scratch 35 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.88 | 3/4 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, A Lead: n-counter, B Drums: n-broken, B Bass: v-next, B Chords: v-follow, B Lead: n-melody, A' Drums: xd-fill, A' Bass: x-turnaround, A' Chords: x-cadence, A' Lead: x-echo |
| scratch 36 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.75 | 2/3 | A Drums: n-broken, A Bass: n-bass, A Chords: n-chords, A Lead: n-melody, B Drums: d-kick, B Bass: v-form, B Chords: n-stabs, B Lead: v-looper, A' Drums: xd-roll, A' Bass: x-cadence, A' Chords: x-stop, A' Lead: x-echo |
| scratch 37 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.74 | 3/5 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, A Lead: n-riff, B Drums: d-shift, B Bass: n-bass, B Chords: v-comp, B Lead: v-halftime, A' Drums: xd-repeat, A' Bass: x-style, A' Chords: x-style, A' Lead: x-run |
| scratch 38 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.96 | 4/5 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, A Lead: n-arp, B Drums: n-drum-map, B Bass: v-connect, B Chords: v-next, B Lead: n-riff, A' Drums: xd-style, A' Bass: x-style, A' Chords: x-echo, A' Lead: x-turnaround |
| scratch 39 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.81 | 4/5 | A Drums: n-broken, A Bass: n-bass, A Chords: n-chords, A Lead: n-counter, B Drums: d-hats, B Bass: v-displace, B Chords: n-chords, B Lead: v-follow, A' Drums: xd-roll, A' Bass: x-run, A' Chords: x-cadence, A' Lead: x-cadence |
| motif 0 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.74 | 1/1 | A Drums: n-broken, A Bass: n-bass, A Chords: n-chords, B Drums: d-kick, B Bass: v-halftime, B Chords: n-stabs, B Lead: v-thin, A' Drums: xd-roll, A' Bass: x-push, A' Chords: x-stop, A' Lead: x-cadence |
| motif 1 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.76 | 1/1 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, B Drums: d-shift, B Bass: n-bass, B Chords: v-comp, B Lead: v-develop, A' Drums: xd-repeat, A' Bass: x-push, A' Chords: x-stop, A' Lead: x-run |
| motif 2 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.92 | 2/3 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, B Drums: n-drum-map, B Bass: v-bassline, B Chords: v-develop, B Lead: n-counter, A' Drums: xd-repeat, A' Bass: x-push, A' Chords: x-evolve, A' Lead: x-cadence |
| motif 3 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.86 | 1/1 | A Drums: n-broken, A Bass: n-bass, A Chords: n-chords, B Drums: d-develop, B Bass: v-euclid, B Chords: n-chords, B Lead: v-follow, A' Drums: xd-roll, A' Bass: x-run, A' Chords: x-stop, A' Lead: x-push |
| motif 4 | experimental | E | E | E | 0%/0%/0% | 0 | 0 | 0.80 | 2/2 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, B Drums: d-hats, B Bass: n-walk, B Chords: v-comp, B Lead: v-next, A' Drums: xd-fill, A' Bass: x-push, A' Chords: x-push, A' Lead: x-push |
| motif 5 | musical | M | M | M | 0%/0%/6% | 0 | 0 | 0.87 | 2/3 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, B Drums: n-broken, B Bass: v-pulse, B Chords: v-thin, B Lead: n-melody, A' Drums: xd-repeat, A' Bass: x-turnaround, A' Chords: x-stop, A' Lead: x-style |
| motif 6 | broken | M | M | M | 0%/0%/0% | 1 | 0 | 0.77 | 1/3 | A Drums: n-broken, A Bass: n-bass, A Chords: n-chords, B Drums: d-kick, B Bass: v-next, B Chords: n-stabs, B Lead: v-displace, A' Drums: xd-repeat, A' Bass: x-turnaround, A' Chords: x-echo, A' Lead: x-turnaround |
| motif 7 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.78 | 2/3 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, B Drums: d-shift, B Bass: n-bass, B Chords: v-halftime, B Lead: v-develop, A' Drums: xd-style, A' Bass: x-stop, A' Chords: x-echo, A' Lead: x-run |
| motif 8 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.85 | 2/3 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, B Drums: n-drum-map, B Bass: v-newline, B Chords: v-style, B Lead: n-counter, A' Drums: xd-break, A' Bass: x-echo, A' Chords: x-push, A' Lead: x-style |
| motif 9 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.85 | 3/3 | A Drums: n-broken, A Bass: n-bass, A Chords: n-chords, B Drums: d-develop, B Bass: v-bassline, B Chords: n-chords, B Lead: v-follow, A' Drums: xd-roll, A' Bass: x-run, A' Chords: x-cadence, A' Lead: x-cadence |
| motif 10 | broken | M | E | M | 0%/0%/0% | 1 | 0 | 0.83 | 2/3 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, B Drums: d-grids, B Bass: n-walk, B Chords: v-follow, B Lead: v-next, A' Drums: xd-fill, A' Bass: x-turnaround, A' Chords: x-stop, A' Lead: x-push |
| motif 11 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.74 | 1/2 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, B Drums: n-broken, B Bass: v-next, B Chords: v-thin, B Lead: n-melody, A' Drums: xd-repeat, A' Bass: x-turnaround, A' Chords: x-echo, A' Lead: x-style |
| motif 12 | experimental | M | M | E | 0%/0%/0% | 0 | 0 | 0.76 | 2/5 | A Drums: n-broken, A Bass: n-bass, A Chords: n-chords, B Drums: d-kick, B Bass: v-next, B Chords: n-stabs, B Lead: v-walk, A' Drums: xd-fill, A' Bass: x-stop, A' Chords: x-stop, A' Lead: x-style |
| motif 13 | broken | M | M | M | 0%/0%/0% | 1 | 0 | 0.79 | 1/2 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, B Drums: d-form, B Bass: n-bass, B Chords: v-thin, B Lead: v-style, A' Drums: xd-break, A' Bass: x-cadence, A' Chords: x-echo, A' Lead: x-run |
| motif 14 | broken | M | M | M | 0%/0%/0% | 1 | 0 | 0.93 | 1/3 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, B Drums: n-drum-map, B Bass: v-pulse, B Chords: v-follow, B Lead: n-counter, A' Drums: xd-repeat, A' Bass: x-push, A' Chords: x-echo, A' Lead: x-cadence |
| motif 15 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.81 | 1/2 | A Drums: n-broken, A Bass: n-bass, A Chords: n-chords, B Drums: d-hats, B Bass: v-style, B Chords: n-chords, B Lead: v-halftime, A' Drums: xd-fill, A' Bass: x-run, A' Chords: x-cadence, A' Lead: x-push |
| motif 16 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.80 | 1/2 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, B Drums: d-style, B Bass: n-walk, B Chords: v-follow, B Lead: v-next, A' Drums: xd-fill, A' Bass: x-style, A' Chords: x-cadence, A' Lead: x-stop |
| motif 17 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.85 | 1/3 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, B Drums: n-broken, B Bass: v-next, B Chords: v-form, B Lead: n-melody, A' Drums: xd-break, A' Bass: x-stop, A' Chords: x-style, A' Lead: x-turnaround |
| motif 18 | musical | M | M | M | 0%/0%/7% | 0 | 0 | 0.69 | 1/2 | A Drums: n-broken, A Bass: n-bass, A Chords: n-chords, B Drums: d-kick, B Bass: v-thin, B Chords: n-stabs, B Lead: v-thin, A' Drums: xd-repeat, A' Bass: x-cadence, A' Chords: x-cadence, A' Lead: x-cadence |
| motif 19 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.77 | 1/4 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, B Drums: d-shift, B Bass: n-bass, B Chords: v-displace, B Lead: v-displace, A' Drums: xd-fill, A' Bass: x-style, A' Chords: x-echo, A' Lead: x-run |
| motif 20 | experimental | E | M | M | 0%/0%/0% | 0 | 0 | 0.93 | 2/2 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, B Drums: n-drum-map, B Bass: v-bassline, B Chords: v-comp, B Lead: n-counter, A' Drums: xd-style, A' Bass: x-style, A' Chords: x-stop, A' Lead: x-cadence |
| motif 21 | musical | M | M | M | 0%/0%/3% | 0 | 0 | 0.81 | 4/6 | A Drums: n-broken, A Bass: n-bass, A Chords: n-chords, B Drums: d-hats, B Bass: v-thin, B Chords: n-chords, B Lead: v-follow, A' Drums: xd-roll, A' Bass: x-run, A' Chords: x-cadence, A' Lead: x-stop |
| motif 22 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.81 | 3/2 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, B Drums: d-develop, B Bass: n-walk, B Chords: v-thin, B Lead: v-thin, A' Drums: xd-fill, A' Bass: x-stop, A' Chords: x-cadence, A' Lead: x-turnaround |
| motif 23 | experimental | M | E | M | 0%/0%/0% | 0 | 0 | 0.86 | 1/3 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, B Drums: n-broken, B Bass: v-motif, B Chords: v-thin, B Lead: n-melody, A' Drums: xd-style, A' Bass: x-stop, A' Chords: x-push, A' Lead: x-turnaround |
| motif 24 | musical | M | M | M | 0%/0%/4% | 0 | 0 | 0.75 | 3/3 | A Drums: n-broken, A Bass: n-bass, A Chords: n-chords, B Drums: d-kick, B Bass: v-halftime, B Chords: n-stabs, B Lead: v-displace, A' Drums: xd-style, A' Bass: x-cadence, A' Chords: x-push, A' Lead: x-stop |
| motif 25 | musical | M | M | M | 0%/0%/3% | 0 | 0 | 0.80 | 2/4 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, B Drums: d-form, B Bass: n-bass, B Chords: v-style, B Lead: v-develop, A' Drums: xd-fill, A' Bass: x-turnaround, A' Chords: x-echo, A' Lead: x-run |
| motif 26 | experimental | M | E | M | 0%/0%/0% | 0 | 0 | 0.84 | 1/1 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, B Drums: n-drum-map, B Bass: v-bassline, B Chords: v-develop, B Lead: n-counter, A' Drums: xd-repeat, A' Bass: x-push, A' Chords: x-push, A' Lead: x-push |
| motif 27 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.87 | 1/2 | A Drums: n-broken, A Bass: n-bass, A Chords: n-chords, B Drums: d-hats, B Bass: v-displace, B Chords: n-chords, B Lead: v-follow, A' Drums: xd-roll, A' Bass: x-run, A' Chords: x-cadence, A' Lead: x-push |
| motif 28 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.81 | 1/3 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, B Drums: d-hats, B Bass: n-walk, B Chords: v-follow, B Lead: v-next, A' Drums: xd-fill, A' Bass: x-stop, A' Chords: x-style, A' Lead: x-stop |
| motif 29 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.94 | 2/4 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, B Drums: n-broken, B Bass: v-next, B Chords: v-follow, B Lead: n-melody, A' Drums: xd-fill, A' Bass: x-stop, A' Chords: x-stop, A' Lead: x-echo |
| motif 30 | experimental | M | M | E | 0%/0%/14% | 0 | 0 | 0.78 | 1/2 | A Drums: n-broken, A Bass: n-bass, A Chords: n-chords, B Drums: d-shift, B Bass: v-next, B Chords: n-stabs, B Lead: v-displace, A' Drums: xd-repeat, A' Bass: x-cadence, A' Chords: x-cadence, A' Lead: x-style |
| motif 31 | experimental | M | E | M | 0%/13%/0% | 0 | 0 | 0.76 | 4/4 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, B Drums: d-hats, B Bass: n-bass, B Chords: v-displace, B Lead: v-develop, A' Drums: xd-style, A' Bass: x-push, A' Chords: x-echo, A' Lead: x-run |
| motif 32 | broken | M | B | M | 0%/0%/0% | 1 | 0 | 0.93 | 1/1 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, B Drums: n-drum-map, B Bass: v-euclid, B Chords: v-thin, B Lead: n-counter, A' Drums: xd-style, A' Bass: x-push, A' Chords: x-echo, A' Lead: x-cadence |
| motif 33 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.77 | 2/5 | A Drums: n-broken, A Bass: n-bass, A Chords: n-chords, B Drums: d-grids, B Bass: v-style, B Chords: n-chords, B Lead: v-follow, A' Drums: xd-roll, A' Bass: x-run, A' Chords: x-cadence, A' Lead: x-cadence |
| motif 34 | experimental | M | M | E | 0%/0%/13% | 0 | 0 | 0.82 | 3/4 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, B Drums: d-develop, B Bass: n-walk, B Chords: v-comp, B Lead: v-next, A' Drums: xd-fill, A' Bass: x-stop, A' Chords: x-cadence, A' Lead: x-turnaround |
| motif 35 | experimental | M | E | M | 0%/0%/0% | 0 | 0 | 0.78 | 1/3 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, B Drums: n-broken, B Bass: v-next, B Chords: v-comp, B Lead: n-melody, A' Drums: xd-fill, A' Bass: x-cadence, A' Chords: x-stop, A' Lead: x-turnaround |
| motif 36 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.71 | 2/3 | A Drums: n-broken, A Bass: n-bass, A Chords: n-chords, B Drums: d-kick, B Bass: v-develop, B Chords: n-stabs, B Lead: v-thin, A' Drums: xd-roll, A' Bass: x-style, A' Chords: x-style, A' Lead: x-turnaround |
| motif 37 | experimental | M | E | M | 0%/0%/0% | 0 | 0 | 0.73 | 3/5 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, B Drums: d-shift, B Bass: n-bass, B Chords: v-pulse, B Lead: v-displace, A' Drums: xd-repeat, A' Bass: x-style, A' Chords: x-echo, A' Lead: x-run |
| motif 38 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.97 | 3/6 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, B Drums: n-drum-map, B Bass: v-newline, B Chords: v-style, B Lead: n-counter, A' Drums: xd-style, A' Bass: x-style, A' Chords: x-evolve, A' Lead: x-cadence |
| motif 39 | musical | M | M | M | 0%/0%/3% | 0 | 0 | 0.79 | 1/1 | A Drums: n-broken, A Bass: n-bass, A Chords: n-chords, B Drums: d-hats, B Bass: v-bassline, B Chords: n-chords, B Lead: v-thin, A' Drums: xd-roll, A' Bass: x-run, A' Chords: x-cadence, A' Lead: x-push |

## 6. Bass over chords (84 user, 144 public reference parts)

| option | n | perBar | gate | legato | silence | steps | repeats | rhythms | root | voicingLow | third | onKick | pitch | in band |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| REF user | | 3.50 | 2.67 | 0.97 | 0.28 | 0.25 | 0.19 | 0.50 | 0.36 | 0.00 | 0.19 | - | 42.00 | |
| REF public | | 5.63 | 1.96 | 0.89 | 0.23 | 0.15 | 0.39 | 0.38 | 0.49 | 0.00 | 0.03 | 0.52 | 35.00 | |
| dbl:x-cadence | 24 | 3.50 | 3.92 | 0.73 | 0.21 | 0.22 | 0.08 | 0.50 | 0.32 | 0.00 | 0.14 | 0.25 | 43.00 | 92% |
| dbl:x-echo | 13 | 4.25 | 3.29 | 0.73 | 0.27 | 0.26 | 0.18 | 0.25 | 0.30 | 0.00 | 0.13 | 0.18 | 43.00 | 92% |
| dbl:x-push | 16 | 4.50 | 4.92 | 0.73 | 0.27 | 0.23 | 0.14 | 0.50 | 0.32 | 0.00 | 0.17 | 0.18 | 44.00 | 83% |
| dbl:x-run | 24 | 7.25 | 1.00 | 1.00 | 0.20 | 0.24 | 0.14 | 0.38 | 0.25 | 0.00 | 0.17 | 0.12 | 45.00 | 83% |
| dbl:x-stop | 19 | 4.00 | 3.92 | 0.73 | 0.24 | 0.28 | 0.12 | 0.50 | 0.26 | 0.00 | 0.11 | 0.19 | 42.00 | 92% |
| dbl:x-style | 24 | 4.63 | 3.29 | 0.73 | 0.27 | 0.25 | 0.08 | 0.50 | 0.31 | 0.00 | 0.19 | 0.19 | 43.00 | 92% |
| dbl:x-turnaround | 24 | 4.50 | 3.92 | 0.73 | 0.24 | 0.24 | 0.12 | 0.25 | 0.28 | 0.00 | 0.15 | 0.20 | 43.00 | 92% |
| new:n-bass | 24 | 4.50 | 3.92 | 0.73 | 0.27 | 0.24 | 0.11 | 0.50 | 0.40 | 0.00 | 0.17 | 0.40 | 43.00 | 100% |
| new:n-pulse | 24 | 6.00 | 2.21 | 0.74 | 0.27 | 0.02 | 0.80 | 0.25 | 1.00 | 0.00 | 0.00 | 0.40 | 36.00 | 75% |
| new:n-walk | 24 | 5.00 | 3.63 | 0.91 | 0.13 | 0.33 | 0.38 | 0.75 | 0.70 | 0.00 | 0.05 | 0.33 | 41.00 | 92% |
| qnt:q-answer | 24 | 3.13 | 2.75 | 0.70 | 0.52 | 0.20 | 0.17 | 0.88 | 0.20 | 0.00 | 0.15 | 0.44 | 45.00 | 75% |
| qnt:q-embellish | 15 | 4.00 | 2.00 | 0.69 | 0.34 | 0.36 | 0.13 | 1.00 | 0.25 | 0.00 | 0.13 | 0.38 | 43.00 | 92% |
| qnt:q-humanize | 1 | 2.38 | 4.88 | 0.69 | 0.34 | 0.22 | 0.00 | 0.38 | 0.37 | 0.00 | 0.11 | - | 43.00 | 82% |
| qnt:q-mode | 5 | 2.25 | 4.88 | 0.75 | 0.30 | 0.33 | 0.13 | 0.75 | 0.44 | 0.00 | 0.11 | 0.33 | 46.00 | 83% |
| qnt:q-mutate | 10 | 5.50 | 2.25 | 0.69 | 0.36 | 0.21 | 0.15 | 0.75 | 0.31 | 0.00 | 0.24 | 0.43 | 47.00 | 92% |
| qnt:q-octaves | 3 | 4.50 | 2.50 | 0.65 | 0.36 | 0.29 | 0.00 | 0.75 | 0.16 | 0.00 | 0.00 | 0.25 | 47.00 | 83% |
| qnt:q-ratchet | 18 | 6.50 | 1.00 | 1.00 | 0.33 | 0.14 | 0.46 | 1.00 | 0.45 | 0.00 | 0.14 | 0.44 | 44.00 | 83% |
| qnt:q-shaped | 22 | 4.00 | 1.92 | 0.90 | 0.13 | 0.50 | 0.19 | 0.75 | 0.38 | 0.00 | 0.12 | 0.42 | 47.00 | 92% |
| qnt:q-shift | 22 | 3.13 | 2.33 | 0.54 | 0.53 | 0.20 | 0.08 | 0.75 | 0.33 | 0.00 | 0.12 | 0.27 | 44.00 | 75% |
| qnt:q-tight | 24 | 4.38 | 3.71 | 0.69 | 0.36 | 0.25 | 0.09 | 0.75 | 0.38 | 0.00 | 0.13 | 0.34 | 43.00 | 100% |
| var:n-bass | 24 | 4.50 | 3.63 | 0.82 | 0.13 | 0.24 | 0.06 | 0.50 | 0.33 | 0.00 | 0.17 | 0.40 | 42.00 | 100% |
| var:n-walk | 24 | 5.00 | 2.92 | 0.81 | 0.16 | 0.33 | 0.42 | 0.75 | 0.75 | 0.00 | 0.04 | 0.40 | 41.00 | 100% |
| var:v-answer | 24 | 4.50 | 3.29 | 0.82 | 0.25 | 0.21 | 0.19 | 0.50 | 0.42 | 0.00 | 0.22 | 0.40 | 44.00 | 92% |
| var:v-bassline | 24 | 4.50 | 3.88 | 0.96 | 0.06 | 0.25 | 0.10 | 0.50 | 0.50 | 0.00 | 0.10 | 0.86 | 40.00 | 83% |
| var:v-connect | 24 | 4.50 | 3.58 | 0.97 | 0.17 | 0.33 | 0.15 | 1.00 | 0.29 | 0.00 | 0.12 | 0.41 | 43.00 | 92% |
| var:v-develop | 24 | 4.50 | 3.92 | 0.73 | 0.28 | 0.25 | 0.14 | 1.00 | 0.33 | 0.00 | 0.15 | 0.33 | 43.00 | 83% |
| var:v-displace | 24 | 4.00 | 3.08 | 0.64 | 0.41 | 0.18 | 0.14 | 1.00 | 0.43 | 0.00 | 0.19 | 0.42 | 43.00 | 92% |
| var:v-euclid | 24 | 6.00 | 2.67 | 0.96 | 0.09 | 0.19 | 0.13 | 0.25 | 0.31 | 0.00 | 0.17 | 0.33 | 44.00 | 92% |
| var:v-follow | 24 | 3.50 | 3.29 | 0.64 | 0.31 | 0.12 | 0.21 | 0.50 | 0.57 | 0.00 | 0.20 | 0.40 | 43.00 | 100% |
| var:v-form | 24 | 4.00 | 3.29 | 0.72 | 0.27 | 0.16 | 0.16 | 0.50 | 0.38 | 0.00 | 0.19 | 0.40 | 45.00 | 100% |
| var:v-halftime | 24 | 2.00 | 7.88 | 0.78 | 0.25 | 0.13 | 0.11 | 0.50 | 0.55 | 0.00 | 0.11 | 0.31 | 45.00 | 83% |
| var:v-hold | 24 | 4.50 | 3.54 | 0.77 | 0.28 | 0.08 | 0.10 | 0.50 | 0.43 | 0.00 | 0.15 | 0.40 | 41.00 | 100% |
| var:v-looper | 24 | 2.50 | 3.83 | 0.72 | 0.39 | 0.06 | 0.13 | 0.50 | 0.45 | 0.00 | 0.17 | 0.43 | 45.00 | 100% |
| var:v-motif | 24 | 4.00 | 3.92 | 0.73 | 0.25 | 0.19 | 0.20 | 0.25 | 0.34 | 0.00 | 0.17 | 0.50 | 48.00 | 92% |
| var:v-newline | 24 | 4.50 | 3.29 | 0.82 | 0.27 | 0.11 | 0.19 | 0.50 | 0.50 | 0.00 | 0.18 | 0.35 | 48.00 | 92% |
| var:v-next | 24 | 3.75 | 3.29 | 0.60 | 0.47 | 0.13 | 0.17 | 0.75 | 0.38 | 0.00 | 0.15 | 0.38 | 43.00 | 92% |
| var:v-pulse | 24 | 4.50 | 3.29 | 0.82 | 0.26 | 0.11 | 0.62 | 0.75 | 1.00 | 0.00 | 0.00 | 0.44 | 38.00 | 92% |
| var:v-recombine | 24 | 4.50 | 3.92 | 0.73 | 0.27 | 0.21 | 0.17 | 0.50 | 0.40 | 0.00 | 0.12 | 0.40 | 43.00 | 100% |
| var:v-retro | 24 | 4.50 | 3.92 | 0.73 | 0.27 | 0.14 | 0.16 | 0.50 | 0.44 | 0.00 | 0.19 | 0.40 | 43.00 | 100% |
| var:v-revoice | 24 | 4.50 | 3.92 | 0.73 | 0.27 | 0.21 | 0.10 | 0.50 | 0.33 | 0.00 | 0.17 | 0.40 | 45.00 | 100% |
| var:v-style | 24 | 4.25 | 3.29 | 0.73 | 0.28 | 0.12 | 0.13 | 1.00 | 0.24 | 0.00 | 0.19 | 0.38 | 45.00 | 83% |
| var:v-thin | 24 | 2.50 | 5.50 | 0.78 | 0.28 | 0.13 | 0.00 | 0.50 | 0.60 | 0.00 | 0.09 | 0.40 | 43.00 | 83% |
| var:v-walk | 24 | 4.00 | 2.54 | 0.73 | 0.27 | 0.30 | 0.07 | 0.50 | 0.42 | 0.00 | 0.13 | 0.47 | 43.00 | 100% |
