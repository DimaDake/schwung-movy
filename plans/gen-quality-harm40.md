# Generator quality: harm40

42 cases; knobs 5743 ms, pieces 9406 ms, old bench 612 ms. Method and thresholds: plans/2026-10-29-generator-quality-metrics.md.

| metric | ext40 | harm40 | verdict |
| --- | --- | --- | --- |
| 1 knobs: dead clicks | 16% | 16% | same |
| 1 knobs: cliffs | 0% | 0% | same |
| 1 knobs: promise kept | 88% | 88% | same |
| 1 knobs: broken positions | 1% | 1% | same |
| 1 knobs: experimental positions | 9% | 9% |  |
| 1 knobs: duplicate knob pairs | 5 | 5 | same |
| 1 knobs: refused positions | 1% | 1% | same |
| 1 knobs: useful clicks | 45822 | 45990 | better |
| 1 knobs: register reach (semitones) | 16.74 | 16.65 | same |
| 2 space: musical | 82% | 82% | same |
| 2 space: broken | 1% | 1% | same |
| 2 space: refused (turn does nothing) | 3% | 3% | same |
| 2 space: default musical | 87% | 87% | same |
| 2 space: next to default broken | 1% | 1% | same |
| 4 piece: musical | 83% | 84% | same |
| 4 piece: broken | 3% | 3% | same |
| 4 piece: clash (strong beats) | 0% | 0% | same |
| 4 piece: chord fit | 0.94 | 0.94 | same |
| 4 piece: worst part fit | 0.88 | 0.87 | same |
| 4 piece: low-end mud scenes | 3 | 1 | better |
| 4 piece: role breaks | 0 | 0 | same |
| 4 piece: B copies A | 0 | 0 | same |
| 4 piece: A to B distance | 0.78 | 0.78 |  |
| 4 piece: chords in A' | 3.61 | 3.71 | same |
| old: alignment | 0.64 | 0.64 | same |
| old: gate | 88% | 88% | same |
| old: played-drum gate | 100% | 100% | same |
| old: variation best-of-six gate | 78% | 78% | same |
| old: variation novelty | 0.67 | 0.67 | same |
| old: variation coherence | 0.92 | 0.92 | same |
| old: double first part kept | 0.97 | 0.97 | same |
| old: double ending novelty | 0.71 | 0.71 | same |
| old: double coherence | 0.92 | 0.92 | same |
| old: new clip meaningful | 100% | 100% | same |
| old: new clip coherence | 0.99 | 0.99 | same |
| old: new clip with band | 0.68 | 0.68 | same |

## 1. Knobs that break their promise

| knob | kept | swept |
| --- | --- | --- |
| LIKENESS | 24% | 54 |
| AMOUNT | 65% | 155 |
| DYNAMICS | 67% | 412 |
| PITCH FIX | 71% | 59 |
| DRIFT | 86% | 495 |
| RANGE | 90% | 169 |
| VARY | 94% | 213 |
| TENSION | 94% | 207 |
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
| variation:v-harmonize TENSION | 90% | 20 | dead clicks |
| double:x-turn TENSION | 90% | 20 | dead clicks |
| variation:v-follow TENSION | 85% | 100 | dead clicks |
| double:x-evolve TENSION | 85% | 100 | dead clicks |
| variation:v-looper DENSITY | 84% | 70 | dead clicks |
| variation:v-walk AMOUNT | 83% | 60 | dead clicks |
| quantize:q-tidy CLEAN | 83% | 30 | dead clicks |
| variation:v-style DENSITY | 83% | 100 | dead clicks |
| double:x-turnaround TENSION | 83% | 210 | dead clicks |
| create:n-melody VARY | 82% | 280 | dead clicks |
| double:x-style DENSITY | 82% | 240 | dead clicks |
| variation:v-retro AMOUNT | 81% | 100 | dead clicks |
| variation:d-turn DENSITY | 77% | 30 | dead clicks |
| variation:d-grids SNARE | 77% | 30 | dead clicks |
| create:n-pad VARY | 75% | 20 | dead clicks |
| quantize:q-embellish AMOUNT | 75% | 240 | dead clicks |
| quantize:q-shaped VOICING | 74% | 150 | dead clicks |
| double:xd-fill DENSITY | 73% | 120 | dead clicks |
| create:n-pad-euclid DENSITY | 20% | 120 | cliffs |
| create:n-perc DENSITY | 20% | 120 | cliffs |
| variation:v-style LIKENESS | 13% | 150 | cliffs |
| create:n-chords SWING | 10% | 300 | cliffs |
| create:n-stabs SWING | 10% | 300 | cliffs |
| create:n-bass SWING | 10% | 300 | cliffs |
| create:n-pad-pattern DENSITY | 10% | 120 | cliffs |
| create:n-melody RANGE | 8% | 180 | cliffs |
| variation:v-style DENSITY | 6% | 100 | cliffs |
| variation:v-register RANGE | 6% | 120 | cliffs |
| quantize:q-answer PITCH FIX | 5% | 20 | cliffs |
| variation:v-revoice RANGE | 4% | 180 | cliffs |
| variation:v-form RANGE | 4% | 180 | cliffs |
| variation:v-retro RANGE | 4% | 120 | cliffs |
| variation:v-newline TENSION | 4% | 100 | cliffs |
| create:n-perc SWING | 3% | 120 | cliffs |
| variation:v-recombine AMOUNT | 3% | 140 | cliffs |
| variation:v-style RANGE | 2% | 180 | cliffs |
| variation:v-newline DENSITY | 2% | 100 | cliffs |
| variation:v-next RANGE | 2% | 180 | cliffs |
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

Duplicate knobs: double:x-style LIKENESS=DENSITY; double:xd-fill DENSITY=SEED; variation:v-next RHYTHM=VOICES; variation:v-follow RHYTHM=VOICES; double:x-style LIKENESS=DENSITY.

## 2. Knob space by generator (worst first)

Broken reasons: empty 48, clash 41, register 23, off harmony 21, wall 13.

| generator | musical | broken | default broken | next to default broken | samples |
| --- | --- | --- | --- | --- | --- |
| create:n-pad-pattern | 46% | 17% | 0% | 0% | 144 |
| variation:d-euclid | 64% | 17% | 0% | 0% | 36 |
| variation:v-bassline | 53% | 12% | 20% | 17% | 60 |
| create:n-pad-euclid | 42% | 8% | 0% | 0% | 144 |
| create:n-perc | 36% | 8% | 0% | 0% | 144 |
| quantize:q-answer | 81% | 6% | 0% | 1% | 132 |
| quantize:q-shaped | 83% | 6% | 0% | 0% | 180 |
| quantize:qd-ghosts | 29% | 6% | 11% | 12% | 108 |
| quantize:q-tight | 81% | 4% | 0% | 0% | 180 |
| double:x-turnaround | 79% | 3% | 5% | 4% | 252 |
| variation:d-develop | 92% | 3% | 0% | 0% | 36 |
| variation:v-newline | 93% | 3% | 0% | 3% | 120 |
| variation:v-pulse | 60% | 2% | 7% | 6% | 180 |
| quantize:q-full | 91% | 2% | 0% | 0% | 180 |
| double:x-run | 87% | 2% | 0% | 2% | 252 |
| double:x-echo | 90% | 1% | 7% | 7% | 360 |
| variation:v-next | 74% | 1% | 0% | 0% | 180 |
| variation:v-pedal | 88% | 1% | 0% | 0% | 180 |
| double:x-push | 89% | 1% | 7% | 7% | 360 |
| double:x-style | 92% | 1% | 7% | 7% | 360 |
| double:x-stop | 86% | 1% | 7% | 7% | 360 |
| quantize:q-embellish | 87% | 1% | 0% | 0% | 180 |
| create:n-riff | 99% | 1% | 0% | 0% | 360 |
| double:x-evolve | 88% | 1% | 0% | 0% | 120 |
| double:x-cadence | 84% | 1% | 7% | 7% | 360 |

## 4. Pieces

| piece | verdict | A | B | A' | clash A/B/A' | role breaks | B copies | A→B | chords A/A' | generators |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| scratch 0 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.76 | 4/5 | A Drums: n-groove, A Bass: n-bass, A Chords: n-chords, A Lead: n-melody, B Drums: d-kick, B Bass: v-pulse, B Chords: v-halftime, B Lead: v-euclid, A' Drums: xd-fill, A' Bass: x-cadence, A' Chords: x-echo, A' Lead: x-style |
| scratch 1 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.78 | 3/4 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, A Lead: n-riff, B Drums: d-turn, B Bass: v-pulse, B Chords: v-pulse, B Lead: v-euclid, A' Drums: xd-fill, A' Bass: x-cadence, A' Chords: x-push, A' Lead: x-run |
| scratch 2 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.86 | 4/6 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, A Lead: n-arp, B Drums: d-develop, B Bass: v-pulse, B Chords: v-style, B Lead: v-displace, A' Drums: xd-style, A' Bass: x-echo, A' Chords: x-style, A' Lead: x-turnaround |
| scratch 3 | experimental | E | M | M | 0%/0%/6% | 0 | 0 | 0.85 | 4/4 | A Drums: n-groove, A Bass: n-bass, A Chords: n-chords, A Lead: n-counter, B Drums: d-form, B Bass: v-octave, B Chords: v-spread, B Lead: v-follow, A' Drums: xd-break, A' Bass: x-run, A' Chords: x-cadence, A' Lead: x-turnaround |
| scratch 4 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.81 | 3/3 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, A Lead: n-melody, B Drums: d-grids, B Bass: v-style, B Chords: v-follow, B Lead: v-anticipate, A' Drums: xd-roll, A' Bass: x-push, A' Chords: x-style, A' Lead: x-cadence |
| scratch 5 | experimental | E | M | M | 0%/0%/0% | 0 | 0 | 0.69 | 3/5 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, A Lead: n-riff, B Drums: d-style, B Bass: v-next, B Chords: v-form, B Lead: v-thin, A' Drums: xd-pickup, A' Bass: x-turnaround, A' Chords: x-echo, A' Lead: x-push |
| scratch 6 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.66 | 4/6 | A Drums: n-groove, A Bass: n-bass, A Chords: n-chords, A Lead: n-arp, B Drums: d-kick, B Bass: v-next, B Chords: v-develop, B Lead: v-halftime, A' Drums: xd-repeat, A' Bass: x-cadence, A' Chords: x-echo, A' Lead: x-run |
| scratch 7 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.76 | 3/4 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, A Lead: n-counter, B Drums: d-hats, B Bass: v-next, B Chords: v-style, B Lead: v-style, A' Drums: xd-break, A' Bass: x-style, A' Chords: x-echo, A' Lead: x-run |
| scratch 8 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.81 | 4/5 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, A Lead: n-melody, B Drums: d-form, B Bass: v-pulse, B Chords: v-style, B Lead: v-euclid, A' Drums: xd-fill, A' Bass: x-style, A' Chords: x-stop, A' Lead: x-stop |
| scratch 9 | experimental | E | M | M | 0%/0%/0% | 0 | 0 | 0.80 | 4/5 | A Drums: n-groove, A Bass: n-bass, A Chords: n-chords, A Lead: n-riff, B Drums: d-style, B Bass: v-style, B Chords: v-pulse, B Lead: v-follow, A' Drums: xd-break, A' Bass: x-run, A' Chords: x-cadence, A' Lead: x-turnaround |
| scratch 10 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.83 | 4/5 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, A Lead: n-arp, B Drums: d-grids, B Bass: v-style, B Chords: v-thin, B Lead: v-arp, A' Drums: xd-roll, A' Bass: x-push, A' Chords: x-cadence, A' Lead: x-cadence |
| scratch 11 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.80 | 3/5 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, A Lead: n-counter, B Drums: d-style, B Bass: v-walk, B Chords: v-form, B Lead: v-answer, A' Drums: xd-pickup, A' Bass: x-turnaround, A' Chords: x-push, A' Lead: x-stop |
| scratch 12 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.72 | 4/5 | A Drums: n-groove, A Bass: n-bass, A Chords: n-chords, A Lead: n-melody, B Drums: d-kick, B Bass: v-next, B Chords: v-comp, B Lead: v-halftime, A' Drums: xd-roll, A' Bass: x-cadence, A' Chords: x-stop, A' Lead: x-style |
| scratch 13 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.76 | 4/6 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, A Lead: n-riff, B Drums: d-turn, B Bass: v-connect, B Chords: v-style, B Lead: v-halftime, A' Drums: xd-repeat, A' Bass: x-echo, A' Chords: x-echo, A' Lead: x-run |
| scratch 14 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.79 | 4/4 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, A Lead: n-arp, B Drums: d-shift, B Bass: v-pulse, B Chords: v-next, B Lead: v-displace, A' Drums: xd-fill, A' Bass: x-style, A' Chords: x-stop, A' Lead: x-turnaround |
| scratch 15 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.82 | 2/3 | A Drums: n-groove, A Bass: n-bass, A Chords: n-chords, A Lead: n-counter, B Drums: d-hats, B Bass: v-anticipate, B Chords: v-halftime, B Lead: v-euclid, A' Drums: xd-roll, A' Bass: x-run, A' Chords: x-cadence, A' Lead: x-turnaround |
| scratch 16 | musical | M | M | M | 0%/0%/3% | 0 | 0 | 0.80 | 3/4 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, A Lead: n-melody, B Drums: d-develop, B Bass: v-style, B Chords: v-follow, B Lead: v-form, A' Drums: xd-repeat, A' Bass: x-push, A' Chords: x-cadence, A' Lead: x-cadence |
| scratch 17 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.88 | 4/5 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, A Lead: n-riff, B Drums: d-style, B Bass: v-pedal, B Chords: v-follow, B Lead: v-anticipate, A' Drums: xd-pickup, A' Bass: x-stop, A' Chords: x-push, A' Lead: x-cadence |
| scratch 18 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.74 | 3/5 | A Drums: n-groove, A Bass: n-bass, A Chords: n-chords, A Lead: n-arp, B Drums: d-kick, B Bass: v-develop, B Chords: v-halftime, B Lead: v-thin, A' Drums: xd-repeat, A' Bass: x-cadence, A' Chords: x-stop, A' Lead: x-echo |
| scratch 19 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.74 | 3/5 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, A Lead: n-counter, B Drums: d-shift, B Bass: v-halftime, B Chords: v-develop, B Lead: v-displace, A' Drums: xd-fill, A' Bass: x-turnaround, A' Chords: x-push, A' Lead: x-run |
| scratch 20 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.83 | 2/4 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, A Lead: n-melody, B Drums: d-euclid, B Bass: v-thin, B Chords: v-follow, B Lead: v-halftime, A' Drums: xd-repeat, A' Bass: x-style, A' Chords: x-style, A' Lead: x-turnaround |
| scratch 21 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.80 | 4/6 | A Drums: n-groove, A Bass: n-bass, A Chords: n-chords, A Lead: n-riff, B Drums: d-hats, B Bass: v-pulse, B Chords: v-style, B Lead: v-halftime, A' Drums: xd-roll, A' Bass: x-run, A' Chords: x-cadence, A' Lead: x-turnaround |
| scratch 22 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.85 | 4/5 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, A Lead: n-arp, B Drums: d-grids, B Bass: v-pedal, B Chords: v-follow, B Lead: v-displace, A' Drums: xd-fill, A' Bass: x-stop, A' Chords: x-stop, A' Lead: x-push |
| scratch 23 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.76 | 3/5 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, A Lead: n-counter, B Drums: d-grids, B Bass: v-next, B Chords: v-spread, B Lead: v-walk, A' Drums: xd-pickup, A' Bass: x-stop, A' Chords: x-echo, A' Lead: x-cadence |
| scratch 24 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.72 | 2/4 | A Drums: n-groove, A Bass: n-bass, A Chords: n-chords, A Lead: n-melody, B Drums: d-turn, B Bass: v-pedal, B Chords: v-thin, B Lead: v-euclid, A' Drums: xd-repeat, A' Bass: x-style, A' Chords: x-echo, A' Lead: x-style |
| scratch 25 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.75 | 4/5 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, A Lead: n-riff, B Drums: d-shift, B Bass: v-displace, B Chords: v-comp, B Lead: v-halftime, A' Drums: xd-break, A' Bass: x-style, A' Chords: x-style, A' Lead: x-run |
| scratch 26 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.82 | 4/6 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, A Lead: n-arp, B Drums: d-form, B Bass: v-style, B Chords: v-style, B Lead: v-arp, A' Drums: xd-repeat, A' Bass: x-style, A' Chords: x-stop, A' Lead: x-turnaround |
| scratch 27 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.78 | 3/3 | A Drums: n-groove, A Bass: n-bass, A Chords: n-chords, A Lead: n-counter, B Drums: d-grids, B Bass: v-style, B Chords: v-pulse, B Lead: v-anticipate, A' Drums: xd-style, A' Bass: x-run, A' Chords: x-cadence, A' Lead: x-stop |
| scratch 28 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.79 | 4/6 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, A Lead: n-melody, B Drums: d-grids, B Bass: v-style, B Chords: v-follow, B Lead: v-thin, A' Drums: xd-roll, A' Bass: x-turnaround, A' Chords: x-stop, A' Lead: x-turnaround |
| scratch 29 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.82 | 4/5 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, A Lead: n-riff, B Drums: d-style, B Bass: v-halftime, B Chords: v-thin, B Lead: v-next, A' Drums: xd-pickup, A' Bass: x-turnaround, A' Chords: x-stop, A' Lead: x-style |
| scratch 30 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.72 | 4/5 | A Drums: n-groove, A Bass: n-bass, A Chords: n-chords, A Lead: n-arp, B Drums: d-kick, B Bass: v-form, B Chords: v-euclid, B Lead: v-develop, A' Drums: xd-roll, A' Bass: x-style, A' Chords: x-echo, A' Lead: x-echo |
| scratch 31 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.78 | 4/4 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, A Lead: n-counter, B Drums: d-turn, B Bass: v-bassline, B Chords: v-form, B Lead: v-style, A' Drums: xd-fill, A' Bass: x-push, A' Chords: x-echo, A' Lead: x-echo |
| scratch 32 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.83 | 4/5 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, A Lead: n-melody, B Drums: d-hats, B Bass: v-pulse, B Chords: v-follow, B Lead: v-form, A' Drums: xd-fill, A' Bass: x-style, A' Chords: x-echo, A' Lead: x-cadence |
| scratch 33 | experimental | M | E | M | 0%/0%/0% | 0 | 0 | 0.84 | 4/4 | A Drums: n-groove, A Bass: n-bass, A Chords: n-chords, A Lead: n-riff, B Drums: d-hats, B Bass: v-halftime, B Chords: v-halftime, B Lead: v-connect, A' Drums: xd-style, A' Bass: x-run, A' Chords: x-cadence, A' Lead: x-turnaround |
| scratch 34 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.81 | 4/4 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, A Lead: n-arp, B Drums: d-style, B Bass: v-style, B Chords: v-follow, B Lead: v-displace, A' Drums: xd-roll, A' Bass: x-turnaround, A' Chords: x-push, A' Lead: x-cadence |
| scratch 35 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.91 | 4/5 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, A Lead: n-counter, B Drums: d-grids, B Bass: v-style, B Chords: v-anticipate, B Lead: v-style, A' Drums: xd-pickup, A' Bass: x-cadence, A' Chords: x-echo, A' Lead: x-echo |
| scratch 36 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.71 | 3/4 | A Drums: n-groove, A Bass: n-bass, A Chords: n-chords, A Lead: n-melody, B Drums: d-kick, B Bass: v-style, B Chords: v-spread, B Lead: v-looper, A' Drums: xd-repeat, A' Bass: x-cadence, A' Chords: x-stop, A' Lead: x-push |
| scratch 37 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.74 | 4/6 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, A Lead: n-riff, B Drums: d-shift, B Bass: v-pulse, B Chords: v-spread, B Lead: v-style, A' Drums: xd-repeat, A' Bass: x-cadence, A' Chords: x-style, A' Lead: x-run |
| scratch 38 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.78 | 2/4 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, A Lead: n-arp, B Drums: d-shift, B Bass: v-looper, B Chords: v-style, B Lead: v-style, A' Drums: xd-repeat, A' Bass: x-echo, A' Chords: x-stop, A' Lead: x-turnaround |
| scratch 39 | experimental | M | E | M | 0%/0%/0% | 0 | 0 | 0.80 | 4/5 | A Drums: n-groove, A Bass: n-bass, A Chords: n-chords, A Lead: n-counter, B Drums: d-hats, B Bass: v-walk, B Chords: v-style, B Lead: v-follow, A' Drums: xd-repeat, A' Bass: x-run, A' Chords: x-cadence, A' Lead: x-echo |
| motif 0 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.73 | 1/2 | A Drums: n-groove, A Bass: n-bass, A Chords: n-chords, B Drums: d-kick, B Bass: v-develop, B Chords: v-halftime, B Lead: v-follow, A' Drums: xd-repeat, A' Bass: x-cadence, A' Chords: x-style, A' Lead: x-style |
| motif 1 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.75 | 1/1 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, B Drums: d-shift, B Bass: v-euclid, B Chords: v-comp, B Lead: v-develop, A' Drums: xd-fill, A' Bass: x-push, A' Chords: x-push, A' Lead: x-run |
| motif 2 | broken | M | B | M | 0%/0%/0% | 0 | 0 | 0.84 | 2/4 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, B Drums: d-hats, B Bass: v-anticipate, B Chords: v-comp, B Lead: v-style, A' Drums: xd-break, A' Bass: x-stop, A' Chords: x-push, A' Lead: x-style |
| motif 3 | experimental | E | M | M | 0%/0%/0% | 0 | 0 | 0.79 | 1/2 | A Drums: n-groove, A Bass: n-bass, A Chords: n-chords, B Drums: d-form, B Bass: v-style, B Chords: v-style, B Lead: v-ornament, A' Drums: xd-break, A' Bass: x-run, A' Chords: x-cadence, A' Lead: x-push |
| motif 4 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.79 | 2/3 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, B Drums: d-grids, B Bass: v-connect, B Chords: v-connect, B Lead: v-next, A' Drums: xd-roll, A' Bass: x-push, A' Chords: x-style, A' Lead: x-stop |
| motif 5 | experimental | M | E | M | 0%/0%/0% | 0 | 0 | 0.70 | 3/4 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, B Drums: d-style, B Bass: v-thin, B Chords: v-thin, B Lead: v-thin, A' Drums: xd-pickup, A' Bass: x-turnaround, A' Chords: x-echo, A' Lead: x-style |
| motif 6 | experimental | M | E | M | 0%/0%/0% | 0 | 0 | 0.65 | 1/2 | A Drums: n-groove, A Bass: n-bass, A Chords: n-chords, B Drums: d-kick, B Bass: v-pulse, B Chords: v-next, B Lead: v-looper, A' Drums: xd-repeat, A' Bass: x-turnaround, A' Chords: x-echo, A' Lead: x-turnaround |
| motif 7 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.75 | 2/3 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, B Drums: d-hats, B Bass: v-pulse, B Chords: v-spread, B Lead: v-develop, A' Drums: xd-break, A' Bass: x-echo, A' Chords: x-style, A' Lead: x-run |
| motif 8 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.82 | 2/3 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, B Drums: d-form, B Bass: v-bassline, B Chords: v-spread, B Lead: v-develop, A' Drums: xd-break, A' Bass: x-style, A' Chords: x-evolve, A' Lead: x-style |
| motif 9 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.88 | 3/5 | A Drums: n-groove, A Bass: n-bass, A Chords: n-chords, B Drums: d-hats, B Bass: v-newline, B Chords: v-halftime, B Lead: v-follow, A' Drums: xd-break, A' Bass: x-run, A' Chords: x-cadence, A' Lead: x-cadence |
| motif 10 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.75 | 2/3 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, B Drums: d-grids, B Bass: v-style, B Chords: v-follow, B Lead: v-thin, A' Drums: xd-roll, A' Bass: x-turnaround, A' Chords: x-style, A' Lead: x-push |
| motif 11 | broken | B | M | M | 0%/0%/0% | 0 | 0 | 0.79 | 1/2 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, B Drums: d-develop, B Bass: v-thin, B Chords: v-answer, B Lead: v-follow, A' Drums: xd-pickup, A' Bass: x-stop, A' Chords: x-stop, A' Lead: x-stop |
| motif 12 | experimental | M | E | M | 0%/0%/0% | 0 | 0 | 0.70 | 1/1 | A Drums: n-groove, A Bass: n-bass, A Chords: n-chords, B Drums: d-kick, B Bass: v-halftime, B Chords: v-halftime, B Lead: v-pulse, A' Drums: xd-style, A' Bass: x-turnaround, A' Chords: x-stop, A' Lead: x-style |
| motif 13 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.80 | 1/2 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, B Drums: d-shift, B Bass: v-pulse, B Chords: v-halftime, B Lead: v-displace, A' Drums: xd-break, A' Bass: x-turnaround, A' Chords: x-style, A' Lead: x-run |
| motif 14 | experimental | E | M | E | 0%/0%/0% | 0 | 0 | 0.80 | 1/4 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, B Drums: d-shift, B Bass: v-pulse, B Chords: v-style, B Lead: v-style, A' Drums: xd-fill, A' Bass: x-style, A' Chords: x-evolve, A' Lead: x-cadence |
| motif 15 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.78 | 3/1 | A Drums: n-groove, A Bass: n-bass, A Chords: n-chords, B Drums: d-euclid, B Bass: v-anticipate, B Chords: v-style, B Lead: v-develop, A' Drums: xd-fill, A' Bass: x-run, A' Chords: x-cadence, A' Lead: x-stop |
| motif 16 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.77 | 2/2 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, B Drums: d-develop, B Bass: v-form, B Chords: v-follow, B Lead: v-walk, A' Drums: xd-roll, A' Bass: x-push, A' Chords: x-style, A' Lead: x-stop |
| motif 17 | experimental | E | M | M | 0%/0%/0% | 0 | 0 | 0.70 | 1/2 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, B Drums: d-style, B Bass: v-next, B Chords: v-spread, B Lead: v-displace, A' Drums: xd-pickup, A' Bass: x-turnaround, A' Chords: x-echo, A' Lead: x-turnaround |
| motif 18 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.64 | 1/3 | A Drums: n-groove, A Bass: n-bass, A Chords: n-chords, B Drums: d-kick, B Bass: v-next, B Chords: v-form, B Lead: v-newline, A' Drums: xd-repeat, A' Bass: x-cadence, A' Chords: x-echo, A' Lead: x-stop |
| motif 19 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.78 | 2/3 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, B Drums: d-form, B Bass: v-style, B Chords: v-thin, B Lead: v-develop, A' Drums: xd-break, A' Bass: x-echo, A' Chords: x-echo, A' Lead: x-run |
| motif 20 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.78 | 3/5 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, B Drums: d-turn, B Bass: v-bassline, B Chords: v-form, B Lead: v-develop, A' Drums: xd-repeat, A' Bass: x-style, A' Chords: x-stop, A' Lead: x-cadence |
| motif 21 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.77 | 4/5 | A Drums: n-groove, A Bass: n-bass, A Chords: n-chords, B Drums: d-hats, B Bass: v-thin, B Chords: v-style, B Lead: v-develop, A' Drums: xd-style, A' Bass: x-run, A' Chords: x-cadence, A' Lead: x-push |
| motif 22 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.83 | 3/4 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, B Drums: d-develop, B Bass: v-thin, B Chords: v-comp, B Lead: v-follow, A' Drums: xd-repeat, A' Bass: x-turnaround, A' Chords: x-stop, A' Lead: x-push |
| motif 23 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.80 | 1/4 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, B Drums: d-grids, B Bass: v-next, B Chords: v-connect, B Lead: v-next, A' Drums: xd-pickup, A' Bass: x-stop, A' Chords: x-echo, A' Lead: x-turnaround |
| motif 24 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.71 | 2/4 | A Drums: n-groove, A Bass: n-bass, A Chords: n-chords, B Drums: d-kick, B Bass: v-anticipate, B Chords: v-next, B Lead: v-displace, A' Drums: xd-repeat, A' Bass: x-echo, A' Chords: x-stop, A' Lead: x-stop |
| motif 25 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.76 | 3/4 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, B Drums: d-shift, B Bass: v-next, B Chords: v-spread, B Lead: v-style, A' Drums: xd-break, A' Bass: x-stop, A' Chords: x-push, A' Lead: x-run |
| motif 26 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.80 | 1/2 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, B Drums: d-hats, B Bass: v-bassline, B Chords: v-anticipate, B Lead: v-develop, A' Drums: xd-style, A' Bass: x-style, A' Chords: x-evolve, A' Lead: x-push |
| motif 27 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.75 | 1/2 | A Drums: n-groove, A Bass: n-bass, A Chords: n-chords, B Drums: d-hats, B Bass: v-pulse, B Chords: v-style, B Lead: v-pedal, A' Drums: xd-roll, A' Bass: x-run, A' Chords: x-cadence, A' Lead: x-push |
| motif 28 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.81 | 1/3 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, B Drums: d-grids, B Bass: v-bassline, B Chords: v-thin, B Lead: v-style, A' Drums: xd-roll, A' Bass: x-stop, A' Chords: x-cadence, A' Lead: x-style |
| motif 29 | musical | M | M | M | 0%/0%/4% | 0 | 0 | 0.85 | 3/3 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, B Drums: d-grids, B Bass: v-develop, B Chords: v-next, B Lead: v-style, A' Drums: xd-pickup, A' Bass: x-cadence, A' Chords: x-stop, A' Lead: x-turnaround |
| motif 30 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.74 | 1/1 | A Drums: n-groove, A Bass: n-bass, A Chords: n-chords, B Drums: d-kick, B Bass: v-next, B Chords: v-next, B Lead: v-next, A' Drums: xd-repeat, A' Bass: x-push, A' Chords: x-style, A' Lead: x-style |
| motif 31 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.82 | 2/3 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, B Drums: d-hats, B Bass: v-pulse, B Chords: v-thin, B Lead: v-develop, A' Drums: xd-fill, A' Bass: x-cadence, A' Chords: x-stop, A' Lead: x-run |
| motif 32 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.79 | 1/2 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, B Drums: d-shift, B Bass: v-style, B Chords: v-euclid, B Lead: v-develop, A' Drums: xd-fill, A' Bass: x-echo, A' Chords: x-echo, A' Lead: x-cadence |
| motif 33 | musical | M | M | M | 0%/0%/2% | 0 | 0 | 0.63 | 1/3 | A Drums: n-groove, A Bass: n-bass, A Chords: n-chords, B Drums: d-form, B Bass: v-halftime, B Chords: v-style, B Lead: v-looper, A' Drums: xd-break, A' Bass: x-run, A' Chords: x-cadence, A' Lead: x-style |
| motif 34 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.83 | 1/1 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, B Drums: d-style, B Bass: v-style, B Chords: v-follow, B Lead: v-follow, A' Drums: xd-roll, A' Bass: x-push, A' Chords: x-stop, A' Lead: x-cadence |
| motif 35 | musical | M | M | M | 0%/0%/3% | 0 | 0 | 0.78 | 1/2 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, B Drums: d-grids, B Bass: v-next, B Chords: v-style, B Lead: v-develop, A' Drums: xd-pickup, A' Bass: x-cadence, A' Chords: x-stop, A' Lead: x-turnaround |
| motif 36 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.73 | 2/2 | A Drums: n-groove, A Bass: n-bass, A Chords: n-chords, B Drums: d-kick, B Bass: v-next, B Chords: v-comp, B Lead: v-thin, A' Drums: xd-repeat, A' Bass: x-echo, A' Chords: x-stop, A' Lead: x-stop |
| motif 37 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.78 | 2/3 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, B Drums: d-shift, B Bass: v-style, B Chords: v-style, B Lead: v-style, A' Drums: xd-repeat, A' Bass: x-push, A' Chords: x-push, A' Lead: x-run |
| motif 38 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.82 | 1/2 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, B Drums: d-shift, B Bass: v-pulse, B Chords: v-next, B Lead: v-register, A' Drums: xd-repeat, A' Bass: x-echo, A' Chords: x-stop, A' Lead: x-cadence |
| motif 39 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.77 | 1/1 | A Drums: n-groove, A Bass: n-bass, A Chords: n-chords, B Drums: d-hats, B Bass: v-style, B Chords: v-style, B Lead: v-thin, A' Drums: xd-repeat, A' Bass: x-run, A' Chords: x-cadence, A' Lead: x-push |
