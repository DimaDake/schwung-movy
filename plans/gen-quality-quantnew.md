# Generator quality: quantnew

42 cases; knobs 7957 ms, pieces 3081 ms, old bench 772 ms. Method and thresholds: plans/2026-10-29-generator-quality-metrics.md.

| metric | follownew | quantnew | verdict |
| --- | --- | --- | --- |
| 1 knobs: dead clicks | 16% | 15% | same |
| 1 knobs: cliffs | 0% | 0% | same |
| 1 knobs: promise kept | 87% | 87% | same |
| 1 knobs: broken positions | 1% | 1% | same |
| 1 knobs: experimental positions | 9% | 10% |  |
| 1 knobs: duplicate knob pairs | 6 | 7 | **REGRESSED** |
| 1 knobs: refused positions | 1% | 1% | same |
| 1 knobs: useful clicks | 47098 | 50054 | better |
| 1 knobs: register reach (semitones) | 17.45 | 17.45 | same |
| 2 space: musical | 82% | 81% | same |
| 2 space: broken | 1% | 1% | same |
| 2 space: refused (turn does nothing) | 3% | 3% | same |
| 2 space: default musical | 86% | 85% | **REGRESSED** |
| 2 space: next to default broken | 1% | 1% | same |
| 3 maps: positions played | 12381 | 12381 |  |
| 3 maps: gradual turns | 90% | 90% | same |
| 3 maps: mean turn | 1.23 | 1.23 | same |
| 3 maps: distinct positions | 91% | 91% | same |
| 3 maps: positions musical | 99% | 99% | same |
| 3 maps: positions broken | 0% | 0% | same |
| 3 maps: onset reach (per bar) | 8.36 | 8.36 | same |
| 4 piece: musical | 75% | 75% | same |
| 4 piece: broken | 0% | 0% | same |
| 4 piece: clash (strong beats) | 1% | 1% | same |
| 4 piece: chord fit | 0.94 | 0.94 | same |
| 4 piece: worst part fit | 0.87 | 0.87 | same |
| 4 piece: low-end mud scenes | 0 | 0 | same |
| 4 piece: role breaks | 0 | 0 | same |
| 4 piece: B copies A | 0 | 0 | same |
| 4 piece: A to B distance | 0.79 | 0.79 |  |
| 4 piece: chords in A' | 3.67 | 3.67 | same |
| old: alignment | 0.63 | 0.61 | same |
| old: gate | 88% | 86% | same |
| old: played-drum gate | 100% | 100% | same |
| old: variation best-of-six gate | 78% | 78% | same |
| old: variation novelty | 0.68 | 0.68 | same |
| old: variation coherence | 0.92 | 0.92 | same |
| old: double first part kept | 0.97 | 0.97 | same |
| old: double ending novelty | 0.71 | 0.71 | same |
| old: double coherence | 0.91 | 0.91 | same |
| old: new clip meaningful | 100% | 100% | same |
| old: new clip coherence | 0.98 | 0.98 | same |
| old: new clip with band | 0.67 | 0.67 | same |

## 1. Knobs that break their promise

| knob | kept | swept |
| --- | --- | --- |
| LIKENESS | 22% | 54 |
| DYNAMICS | 66% | 425 |
| PITCH FIX | 70% | 66 |
| AMOUNT | 71% | 208 |
| RANGE | 84% | 164 |
| DRIFT | 86% | 489 |
| LENGTH | 93% | 261 |
| TENSION | 94% | 200 |
| VARY | 94% | 224 |
| TIMING | 95% | 242 |
| DENSITY | 97% | 265 |
| SWING | 100% | 362 |
| GATE | 100% | 240 |
| GHOSTS | 100% | 24 |
| HUMAN | 100% | 84 |

## 1. Worst knobs

| generator knob | share | clicks | what |
| --- | --- | --- | --- |
| variation:d-form UNIT | 100% | 3 | dead clicks |
| variation:v-newline TENSION | 90% | 100 | dead clicks |
| variation:v-harmonize TENSION | 90% | 20 | dead clicks |
| double:x-turn TENSION | 90% | 20 | dead clicks |
| double:x-evolve TENSION | 86% | 100 | dead clicks |
| variation:v-follow TENSION | 85% | 100 | dead clicks |
| variation:v-style DENSITY | 85% | 110 | dead clicks |
| variation:v-looper DENSITY | 84% | 70 | dead clicks |
| variation:v-walk AMOUNT | 83% | 60 | dead clicks |
| quantize:q-tidy CLEAN | 83% | 30 | dead clicks |
| double:x-turnaround TENSION | 83% | 210 | dead clicks |
| create:n-melody VARY | 82% | 280 | dead clicks |
| double:x-style DENSITY | 82% | 240 | dead clicks |
| variation:v-retro AMOUNT | 81% | 100 | dead clicks |
| variation:v-spread TENSION | 80% | 40 | dead clicks |
| variation:v-comp RANGE | 77% | 60 | dead clicks |
| variation:d-turn DENSITY | 77% | 30 | dead clicks |
| variation:d-grids SNARE | 77% | 30 | dead clicks |
| create:n-pad VARY | 75% | 20 | dead clicks |
| quantize:q-embellish AMOUNT | 75% | 240 | dead clicks |
| create:n-pad-euclid DENSITY | 20% | 120 | cliffs |
| create:n-perc DENSITY | 20% | 120 | cliffs |
| create:n-melody RANGE | 17% | 180 | cliffs |
| variation:v-style LIKENESS | 13% | 150 | cliffs |
| create:n-chords SWING | 10% | 300 | cliffs |
| create:n-stabs SWING | 10% | 300 | cliffs |
| create:n-bass SWING | 10% | 300 | cliffs |
| create:n-pad-pattern DENSITY | 10% | 120 | cliffs |
| variation:v-register RANGE | 6% | 108 | cliffs |
| variation:v-form RANGE | 6% | 180 | cliffs |
| variation:v-style DENSITY | 5% | 110 | cliffs |
| variation:v-spread TENSION | 5% | 40 | cliffs |
| quantize:q-answer PITCH FIX | 5% | 20 | cliffs |
| variation:v-revoice RANGE | 4% | 180 | cliffs |
| variation:v-retro RANGE | 4% | 120 | cliffs |
| variation:v-newline TENSION | 4% | 100 | cliffs |
| create:n-perc SWING | 3% | 120 | cliffs |
| variation:v-recombine AMOUNT | 3% | 130 | cliffs |
| variation:v-style RANGE | 3% | 168 | cliffs |
| variation:v-next RANGE | 2% | 168 | cliffs |
| variation:v-bassline HARMONY | 60% | 4 | broken positions |
| variation:v-bassline CHANGES | 50% | 3 | broken positions |
| variation:v-newline HARMONY | 40% | 6 | broken positions |
| variation:v-pulse CHANGES | 33% | 9 | broken positions |
| variation:v-bassline NOTES | 25% | 12 | broken positions |
| variation:v-pulse HARMONY | 21% | 15 | broken positions |
| quantize:qd-ghosts TIMING | 21% | 90 | broken positions |
| variation:v-bassline LENGTH | 20% | 50 | broken positions |
| variation:v-bassline OCTAVE | 20% | 10 | broken positions |
| variation:v-bassline DYNAMICS | 20% | 50 | broken positions |
| variation:v-bassline SHIFT | 20% | 15 | broken positions |
| variation:d-euclid PULSES | 17% | 45 | broken positions |
| variation:v-bassline PATTERN | 16% | 40 | broken positions |
| quantize:qd-ghosts LEVEL | 11% | 27 | broken positions |
| quantize:qd-ghosts SEED | 11% | 99 | broken positions |
| variation:v-newline STEP | 10% | 54 | broken positions |
| variation:v-pulse NOTE | 10% | 28 | broken positions |
| create:n-pad-euclid DENSITY | 9% | 120 | broken positions |
| create:n-pad-pattern DENSITY | 9% | 120 | broken positions |
| create:n-perc DENSITY | 9% | 120 | broken positions |

Duplicate knobs: variation:v-spread HARMONY=TENSION; quantize:q-octaves AMOUNT=SEED; double:x-style LIKENESS=DENSITY; double:xd-fill DENSITY=SEED; variation:v-next RHYTHM=VOICES; variation:v-follow RHYTHM=VOICES; double:x-style LIKENESS=DENSITY.

## 2. Knob space by generator (worst first)

Broken reasons: empty 52, clash 46, register 39, off harmony 26, wall 20.

| generator | musical | broken | default broken | next to default broken | samples |
| --- | --- | --- | --- | --- | --- |
| create:n-pad-pattern | 46% | 17% | 0% | 0% | 144 |
| variation:d-euclid | 64% | 17% | 0% | 0% | 36 |
| variation:v-bassline | 53% | 12% | 20% | 17% | 60 |
| quantize:q-invert | 80% | 11% | 0% | 3% | 132 |
| create:n-pad-euclid | 42% | 8% | 0% | 0% | 144 |
| create:n-perc | 36% | 8% | 0% | 0% | 144 |
| quantize:qd-ratchet | 28% | 6% | 0% | 0% | 108 |
| quantize:q-answer | 81% | 6% | 0% | 1% | 132 |
| quantize:q-shaped | 83% | 6% | 0% | 0% | 180 |
| quantize:qd-ghosts | 29% | 6% | 11% | 12% | 108 |
| quantize:q-tight | 81% | 4% | 0% | 0% | 180 |
| double:x-turnaround | 79% | 3% | 5% | 4% | 252 |
| variation:d-develop | 92% | 3% | 0% | 0% | 36 |
| variation:v-newline | 93% | 3% | 0% | 3% | 120 |
| variation:v-pulse | 60% | 2% | 7% | 6% | 180 |
| variation:v-comp | 72% | 2% | 0% | 0% | 60 |
| quantize:q-full | 91% | 2% | 0% | 0% | 180 |
| double:x-run | 87% | 2% | 0% | 2% | 252 |
| double:x-echo | 90% | 1% | 7% | 7% | 360 |
| variation:v-answer | 92% | 1% | 0% | 0% | 180 |
| variation:v-pedal | 91% | 1% | 0% | 0% | 180 |
| variation:v-style | 92% | 1% | 0% | 0% | 180 |
| variation:v-form | 86% | 1% | 0% | 0% | 180 |
| double:x-push | 89% | 1% | 7% | 7% | 360 |
| double:x-style | 92% | 1% | 7% | 7% | 360 |

## 3. Map knobs (every position played)

| generator knob | gradual turns | broken positions | requests |
| --- | --- | --- | --- |
| n-stabs PATTERN | 89% | 0% | 30 |
| n-chords PATTERN | 89% | 0% | 30 |
| n-bass PATTERN | 90% | 0% | 30 |
| v-comp PATTERN | 90% | 0% | 5 |
| n-chords HARMONY | 91% | 0% | 3 |
| n-drum-map GROOVE | 96% | 0% | 12 |

## 4. Pieces

| piece | verdict | A | B | A' | clash A/B/A' | role breaks | B copies | A→B | chords A/A' | generators |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| scratch 0 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.73 | 3/4 | A Drums: n-groove, A Bass: n-bass, A Chords: n-chords, A Lead: n-melody, B Drums: d-kick, B Bass: v-next, B Chords: v-comp, B Lead: v-looper, A' Drums: xd-fill, A' Bass: x-stop, A' Chords: x-echo, A' Lead: x-style |
| scratch 1 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.77 | 4/5 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, A Lead: n-riff, B Drums: d-turn, B Bass: v-answer, B Chords: v-halftime, B Lead: v-follow, A' Drums: xd-fill, A' Bass: x-cadence, A' Chords: x-style, A' Lead: x-run |
| scratch 2 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.86 | 4/5 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, A Lead: n-arp, B Drums: d-develop, B Bass: v-pulse, B Chords: v-follow, B Lead: v-form, A' Drums: xd-style, A' Bass: x-push, A' Chords: x-style, A' Lead: x-turnaround |
| scratch 3 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.82 | 4/4 | A Drums: n-groove, A Bass: n-bass, A Chords: n-chords, A Lead: n-counter, B Drums: d-form, B Bass: v-euclid, B Chords: v-style, B Lead: v-thin, A' Drums: xd-break, A' Bass: x-run, A' Chords: x-push, A' Lead: x-turnaround |
| scratch 4 | experimental | M | M | E | 0%/0%/8% | 0 | 0 | 0.79 | 3/3 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, A Lead: n-melody, B Drums: d-grids, B Bass: v-halftime, B Chords: v-comp, B Lead: v-arp, A' Drums: xd-roll, A' Bass: x-echo, A' Chords: x-push, A' Lead: x-push |
| scratch 5 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.83 | 4/5 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, A Lead: n-riff, B Drums: d-style, B Bass: v-form, B Chords: v-answer, B Lead: v-halftime, A' Drums: xd-pickup, A' Bass: x-turnaround, A' Chords: x-cadence, A' Lead: x-push |
| scratch 6 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.72 | 4/5 | A Drums: n-groove, A Bass: n-bass, A Chords: n-chords, A Lead: n-arp, B Drums: d-kick, B Bass: v-style, B Chords: v-thin, B Lead: v-form, A' Drums: xd-repeat, A' Bass: x-cadence, A' Chords: x-push, A' Lead: x-style |
| scratch 7 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.79 | 3/4 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, A Lead: n-counter, B Drums: d-hats, B Bass: v-pulse, B Chords: v-spread, B Lead: v-style, A' Drums: xd-break, A' Bass: x-style, A' Chords: x-push, A' Lead: x-run |
| scratch 8 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.83 | 4/4 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, A Lead: n-melody, B Drums: d-form, B Bass: v-style, B Chords: v-anticipate, B Lead: v-halftime, A' Drums: xd-fill, A' Bass: x-style, A' Chords: x-stop, A' Lead: x-stop |
| scratch 9 | experimental | E | M | M | 0%/0%/0% | 0 | 0 | 0.85 | 4/5 | A Drums: n-groove, A Bass: n-bass, A Chords: n-chords, A Lead: n-riff, B Drums: d-style, B Bass: v-pulse, B Chords: v-spread, B Lead: v-thin, A' Drums: xd-break, A' Bass: x-run, A' Chords: x-cadence, A' Lead: x-turnaround |
| scratch 10 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.85 | 2/4 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, A Lead: n-arp, B Drums: d-grids, B Bass: v-style, B Chords: v-thin, B Lead: v-follow, A' Drums: xd-roll, A' Bass: x-stop, A' Chords: x-stop, A' Lead: x-push |
| scratch 11 | experimental | M | E | M | 0%/11%/0% | 0 | 0 | 0.75 | 3/4 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, A Lead: n-counter, B Drums: d-style, B Bass: v-next, B Chords: v-answer, B Lead: v-next, A' Drums: xd-pickup, A' Bass: x-push, A' Chords: x-push, A' Lead: x-cadence |
| motif 0 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.68 | 1/2 | A Drums: n-groove, A Bass: n-bass, A Chords: n-chords, B Drums: d-kick, B Bass: v-develop, B Chords: v-thin, B Lead: v-follow, A' Drums: xd-repeat, A' Bass: x-cadence, A' Chords: x-echo, A' Lead: x-style |
| motif 1 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.76 | 1/2 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, B Drums: d-shift, B Bass: v-style, B Chords: v-comp, B Lead: v-euclid, A' Drums: xd-fill, A' Bass: x-style, A' Chords: x-echo, A' Lead: x-run |
| motif 2 | experimental | M | E | M | 0%/0%/0% | 0 | 0 | 0.86 | 2/5 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, B Drums: d-hats, B Bass: v-anticipate, B Chords: v-euclid, B Lead: v-style, A' Drums: xd-break, A' Bass: x-stop, A' Chords: x-echo, A' Lead: x-style |
| motif 3 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.79 | 1/2 | A Drums: n-groove, A Bass: n-bass, A Chords: n-chords, B Drums: d-form, B Bass: v-style, B Chords: v-pulse, B Lead: v-ornament, A' Drums: xd-break, A' Bass: x-run, A' Chords: x-cadence, A' Lead: x-push |
| motif 4 | experimental | M | M | E | 0%/0%/17% | 0 | 0 | 0.79 | 2/2 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, B Drums: d-grids, B Bass: v-thin, B Chords: v-thin, B Lead: v-displace, A' Drums: xd-roll, A' Bass: x-stop, A' Chords: x-push, A' Lead: x-stop |
| motif 5 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.76 | 3/4 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, B Drums: d-style, B Bass: v-thin, B Chords: v-halftime, B Lead: v-displace, A' Drums: xd-pickup, A' Bass: x-turnaround, A' Chords: x-stop, A' Lead: x-style |
| motif 6 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.72 | 1/1 | A Drums: n-groove, A Bass: n-bass, A Chords: n-chords, B Drums: d-kick, B Bass: v-bassline, B Chords: v-comp, B Lead: v-answer, A' Drums: xd-repeat, A' Bass: x-cadence, A' Chords: x-stop, A' Lead: x-turnaround |
| motif 7 | musical | M | M | M | 0%/6%/0% | 0 | 0 | 0.79 | 2/3 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, B Drums: d-hats, B Bass: v-next, B Chords: v-euclid, B Lead: v-register, A' Drums: xd-break, A' Bass: x-echo, A' Chords: x-echo, A' Lead: x-run |
| motif 8 | musical | M | M | M | 0%/0%/2% | 0 | 0 | 0.81 | 2/3 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, B Drums: d-form, B Bass: v-bassline, B Chords: v-thin, B Lead: v-form, A' Drums: xd-break, A' Bass: x-style, A' Chords: x-evolve, A' Lead: x-style |
| motif 9 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.88 | 3/5 | A Drums: n-groove, A Bass: n-bass, A Chords: n-chords, B Drums: d-hats, B Bass: v-newline, B Chords: v-style, B Lead: v-follow, A' Drums: xd-break, A' Bass: x-run, A' Chords: x-cadence, A' Lead: x-cadence |
| motif 10 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.77 | 2/4 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, B Drums: d-grids, B Bass: v-anticipate, B Chords: v-form, B Lead: v-euclid, A' Drums: xd-roll, A' Bass: x-turnaround, A' Chords: x-stop, A' Lead: x-stop |
| motif 11 | experimental | E | M | M | 0%/0%/0% | 0 | 0 | 0.78 | 1/3 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, B Drums: d-develop, B Bass: v-thin, B Chords: v-comp, B Lead: v-next, A' Drums: xd-pickup, A' Bass: x-stop, A' Chords: x-echo, A' Lead: x-stop |
