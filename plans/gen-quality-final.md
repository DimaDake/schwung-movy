# Generator quality: final

42 cases; knobs 5770 ms, pieces 2831 ms, old bench 592 ms. Method and thresholds: plans/2026-10-29-generator-quality-metrics.md.

| metric | base | final | verdict |
| --- | --- | --- | --- |
| 1 knobs: dead clicks | 20% | 16% | better |
| 1 knobs: cliffs | 0% | 0% | same |
| 1 knobs: promise kept | 86% | 88% | same |
| 1 knobs: broken positions | 2% | 1% | same |
| 1 knobs: experimental positions | 12% | 10% |  |
| 1 knobs: duplicate knob pairs | 21 | 5 | better |
| 1 knobs: refused positions | 1% | 1% | same |
| 2 space: musical | 80% | 84% | better |
| 2 space: broken | 2% | 1% | same |
| 2 space: refused (turn does nothing) | 2% | 2% | same |
| 2 space: default musical | 85% | 87% | better |
| 2 space: next to default broken | 2% | 1% | same |
| 4 piece: musical | 17% | 79% | better |
| 4 piece: broken | 21% | 4% | better |
| 4 piece: clash (strong beats) | 6% | 1% | better |
| 4 piece: chord fit | 0.94 | 0.94 | same |
| 4 piece: worst part fit | 0.88 | 0.87 | same |
| 4 piece: low-end mud scenes | 11 | 1 | better |
| 4 piece: role breaks | 0 | 0 | same |
| 4 piece: B copies A | 0 | 0 | same |
| 4 piece: A to B distance | 0.77 | 0.79 |  |
| 4 piece: chords in A' | 3.54 | 3.67 | same |
| old: alignment | 0.64 | 0.63 | same |
| old: gate | 88% | 88% | same |
| old: played-drum gate | 100% | 100% | same |
| old: variation best-of-six gate | 72% | 72% | same |
| old: variation novelty | 0.66 | 0.67 | same |
| old: variation coherence | 0.91 | 0.92 | same |
| old: double first part kept | 0.97 | 0.97 | same |
| old: double ending novelty | 0.72 | 0.71 | same |
| old: double coherence | 0.92 | 0.92 | same |
| old: new clip meaningful | 100% | 100% | same |
| old: new clip coherence | 0.99 | 0.99 | same |
| old: new clip with band | 0.65 | 0.68 | better |

## 1. Knobs that break their promise

| knob | kept | swept |
| --- | --- | --- |
| LIKENESS | 24% | 54 |
| AMOUNT | 65% | 155 |
| DYNAMICS | 67% | 412 |
| PITCH FIX | 71% | 59 |
| RANGE | 86% | 159 |
| DRIFT | 86% | 495 |
| TENSION | 94% | 208 |
| VARY | 94% | 213 |
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
| double:x-turn TENSION | 90% | 30 | dead clicks |
| variation:v-harmonize TENSION | 90% | 20 | dead clicks |
| double:x-evolve TENSION | 85% | 100 | dead clicks |
| variation:v-looper DENSITY | 84% | 70 | dead clicks |
| variation:v-follow TENSION | 84% | 100 | dead clicks |
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
| create:n-melody RANGE | 50% | 60 | cliffs |
| create:n-pad-euclid DENSITY | 20% | 120 | cliffs |
| create:n-perc DENSITY | 20% | 120 | cliffs |
| variation:v-style LIKENESS | 13% | 150 | cliffs |
| create:n-chords SWING | 10% | 300 | cliffs |
| create:n-stabs SWING | 10% | 300 | cliffs |
| create:n-bass SWING | 10% | 300 | cliffs |
| create:n-pad-pattern DENSITY | 10% | 120 | cliffs |
| variation:v-style DENSITY | 6% | 100 | cliffs |
| quantize:q-answer PITCH FIX | 5% | 20 | cliffs |
| variation:v-newline TENSION | 4% | 100 | cliffs |
| create:n-perc SWING | 3% | 120 | cliffs |
| variation:v-recombine AMOUNT | 3% | 140 | cliffs |
| variation:v-newline DENSITY | 2% | 100 | cliffs |
| variation:v-style TENSION | 1% | 150 | cliffs |
| variation:v-walk TENSION | 1% | 80 | cliffs |
| variation:v-retro RANGE | 1% | 80 | cliffs |
| variation:v-develop AMOUNT | 1% | 130 | cliffs |
| variation:v-connect TENSION | 1% | 150 | cliffs |
| variation:v-develop DENSITY | 1% | 150 | cliffs |
| variation:v-bassline HARMONY | 60% | 4 | broken positions |
| variation:v-bassline CHANGES | 50% | 3 | broken positions |
| variation:v-newline HARMONY | 40% | 6 | broken positions |
| variation:v-pulse CHANGES | 33% | 9 | broken positions |
| create:n-arp RATE | 25% | 90 | broken positions |
| variation:v-bassline NOTES | 25% | 12 | broken positions |
| variation:v-arp RATE | 25% | 6 | broken positions |
| variation:v-pulse HARMONY | 23% | 14 | broken positions |
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

Duplicate knobs: double:x-style LIKENESS=DENSITY; double:xd-fill DENSITY=SEED; variation:v-next RHYTHM=VOICES; variation:v-follow RHYTHM=VOICES; double:x-style LIKENESS=DENSITY.

## 2. Knob space by generator (worst first)

Broken reasons: wall 51, empty 48, clash 38, register 22, off harmony 21.

| generator | musical | broken | default broken | next to default broken | samples |
| --- | --- | --- | --- | --- | --- |
| variation:v-arp | 46% | 25% | 0% | 8% | 24 |
| create:n-pad-pattern | 46% | 17% | 0% | 0% | 144 |
| variation:d-euclid | 64% | 17% | 0% | 0% | 36 |
| variation:v-bassline | 53% | 12% | 20% | 17% | 60 |
| create:n-arp | 91% | 8% | 0% | 0% | 360 |
| create:n-pad-euclid | 42% | 8% | 0% | 0% | 144 |
| create:n-perc | 36% | 8% | 0% | 0% | 144 |
| quantize:q-answer | 81% | 6% | 0% | 1% | 132 |
| quantize:q-shaped | 83% | 6% | 0% | 0% | 180 |
| quantize:qd-ghosts | 29% | 6% | 11% | 12% | 108 |
| quantize:q-tight | 81% | 4% | 0% | 0% | 180 |
| double:x-turnaround | 79% | 3% | 5% | 4% | 252 |
| variation:d-develop | 92% | 3% | 0% | 0% | 36 |
| variation:v-newline | 93% | 3% | 0% | 3% | 120 |
| double:x-run | 87% | 2% | 0% | 3% | 252 |
| variation:v-pulse | 61% | 2% | 7% | 6% | 180 |
| quantize:q-full | 91% | 2% | 0% | 0% | 180 |
| double:x-echo | 90% | 1% | 7% | 7% | 360 |
| variation:v-next | 79% | 1% | 0% | 0% | 180 |
| double:x-push | 89% | 1% | 7% | 7% | 360 |
| double:x-style | 92% | 1% | 7% | 7% | 360 |
| double:x-stop | 86% | 1% | 7% | 7% | 360 |
| quantize:q-embellish | 87% | 1% | 0% | 0% | 180 |
| variation:v-thin | 84% | 1% | 0% | 0% | 180 |
| variation:v-pedal | 97% | 1% | 0% | 0% | 180 |

## 4. Pieces

| piece | verdict | A | B | A' | clash A/B/A' | role breaks | B copies | A→B | chords A/A' | generators |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| scratch 0 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.75 | 2/4 | A Drums: n-groove, A Bass: n-bass, A Chords: n-chords, A Lead: n-melody, B Drums: d-kick, B Bass: v-next, B Chords: v-spread, B Lead: v-displace, A' Drums: xd-fill, A' Bass: x-cadence, A' Chords: x-style, A' Lead: x-echo |
| scratch 1 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.75 | 4/6 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, A Lead: n-riff, B Drums: d-turn, B Bass: v-next, B Chords: v-comp, B Lead: v-thin, A' Drums: xd-fill, A' Bass: x-cadence, A' Chords: x-style, A' Lead: x-run |
| scratch 2 | musical | M | M | M | 0%/0%/4% | 0 | 0 | 0.86 | 2/4 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, A Lead: n-arp, B Drums: d-develop, B Bass: v-euclid, B Chords: v-style, B Lead: v-displace, A' Drums: xd-style, A' Bass: x-push, A' Chords: x-push, A' Lead: x-turnaround |
| scratch 3 | experimental | M | E | E | 0%/0%/11% | 0 | 0 | 0.83 | 3/4 | A Drums: n-groove, A Bass: n-bass, A Chords: n-chords, A Lead: n-counter, B Drums: d-form, B Bass: v-halftime, B Chords: v-style, B Lead: v-answer, A' Drums: xd-break, A' Bass: x-run, A' Chords: x-cadence, A' Lead: x-stop |
| scratch 4 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.84 | 3/5 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, A Lead: n-melody, B Drums: d-grids, B Bass: v-bassline, B Chords: v-follow, B Lead: v-next, A' Drums: xd-roll, A' Bass: x-push, A' Chords: x-push, A' Lead: x-cadence |
| scratch 5 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.87 | 4/6 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, A Lead: n-riff, B Drums: d-style, B Bass: v-walk, B Chords: v-form, B Lead: v-looper, A' Drums: xd-pickup, A' Bass: x-turnaround, A' Chords: x-echo, A' Lead: x-push |
| scratch 6 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.71 | 3/3 | A Drums: n-groove, A Bass: n-bass, A Chords: n-chords, A Lead: n-arp, B Drums: d-kick, B Bass: v-bassline, B Chords: v-develop, B Lead: v-style, A' Drums: xd-repeat, A' Bass: x-echo, A' Chords: x-echo, A' Lead: x-echo |
| scratch 7 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.77 | 4/5 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, A Lead: n-counter, B Drums: d-hats, B Bass: v-next, B Chords: v-comp, B Lead: v-connect, A' Drums: xd-break, A' Bass: x-run, A' Chords: x-push, A' Lead: x-run |
| scratch 8 | musical | M | M | M | 0%/0%/7% | 0 | 0 | 0.82 | 3/6 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, A Lead: n-melody, B Drums: d-form, B Bass: v-bassline, B Chords: v-displace, B Lead: v-looper, A' Drums: xd-fill, A' Bass: x-style, A' Chords: x-evolve, A' Lead: x-stop |
| scratch 9 | experimental | E | E | M | 0%/0%/0% | 0 | 0 | 0.84 | 4/5 | A Drums: n-groove, A Bass: n-bass, A Chords: n-chords, A Lead: n-riff, B Drums: d-style, B Bass: v-pulse, B Chords: v-halftime, B Lead: v-thin, A' Drums: xd-break, A' Bass: x-run, A' Chords: x-cadence, A' Lead: x-turnaround |
| scratch 10 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.84 | 3/4 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, A Lead: n-arp, B Drums: d-grids, B Bass: v-style, B Chords: v-thin, B Lead: v-develop, A' Drums: xd-roll, A' Bass: x-push, A' Chords: x-push, A' Lead: x-push |
| scratch 11 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.81 | 4/6 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, A Lead: n-counter, B Drums: d-style, B Bass: v-walk, B Chords: v-next, B Lead: v-follow, A' Drums: xd-pickup, A' Bass: x-turnaround, A' Chords: x-push, A' Lead: x-cadence |
| motif 0 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.67 | 1/2 | A Drums: n-groove, A Bass: n-bass, A Chords: n-chords, B Drums: d-kick, B Bass: v-next, B Chords: v-thin, B Lead: v-develop, A' Drums: xd-repeat, A' Bass: x-cadence, A' Chords: x-style, A' Lead: x-style |
| motif 1 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.75 | 1/1 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, B Drums: d-shift, B Bass: v-euclid, B Chords: v-comp, B Lead: v-develop, A' Drums: xd-fill, A' Bass: x-push, A' Chords: x-push, A' Lead: x-run |
| motif 2 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.85 | 2/4 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, B Drums: d-hats, B Bass: v-anticipate, B Chords: v-spread, B Lead: v-develop, A' Drums: xd-break, A' Bass: x-stop, A' Chords: x-push, A' Lead: x-style |
| motif 3 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.75 | 1/2 | A Drums: n-groove, A Bass: n-bass, A Chords: n-chords, B Drums: d-form, B Bass: v-style, B Chords: v-spread, B Lead: v-ornament, A' Drums: xd-break, A' Bass: x-run, A' Chords: x-cadence, A' Lead: x-push |
| motif 4 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.84 | 2/2 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, B Drums: d-grids, B Bass: v-bassline, B Chords: v-follow, B Lead: v-next, A' Drums: xd-roll, A' Bass: x-turnaround, A' Chords: x-push, A' Lead: x-turnaround |
| motif 5 | experimental | M | M | E | 0%/0%/16% | 0 | 0 | 0.85 | 2/2 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, B Drums: d-style, B Bass: v-develop, B Chords: v-form, B Lead: v-displace, A' Drums: xd-pickup, A' Bass: x-stop, A' Chords: x-cadence, A' Lead: x-style |
| motif 6 | musical | M | M | M | 0%/0%/3% | 0 | 0 | 0.69 | 1/2 | A Drums: n-groove, A Bass: n-bass, A Chords: n-chords, B Drums: d-kick, B Bass: v-develop, B Chords: v-thin, B Lead: v-follow, A' Drums: xd-repeat, A' Bass: x-turnaround, A' Chords: x-stop, A' Lead: x-turnaround |
| motif 7 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.79 | 2/3 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, B Drums: d-hats, B Bass: v-style, B Chords: v-next, B Lead: v-develop, A' Drums: xd-break, A' Bass: x-style, A' Chords: x-echo, A' Lead: x-run |
| motif 8 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.82 | 2/3 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, B Drums: d-form, B Bass: v-bassline, B Chords: v-style, B Lead: v-develop, A' Drums: xd-break, A' Bass: x-style, A' Chords: x-push, A' Lead: x-style |
| motif 9 | experimental | M | E | M | 0%/0%/0% | 0 | 0 | 0.87 | 4/5 | A Drums: n-groove, A Bass: n-bass, A Chords: n-chords, B Drums: d-hats, B Bass: v-thin, B Chords: v-thin, B Lead: v-follow, A' Drums: xd-break, A' Bass: x-run, A' Chords: x-cadence, A' Lead: x-cadence |
| motif 10 | musical | M | M | M | 0%/0%/0% | 0 | 0 | 0.70 | 1/2 | A Drums: n-broken, A Bass: n-bass, A Chords: n-stabs, B Drums: d-grids, B Bass: v-style, B Chords: v-follow, B Lead: v-register, A' Drums: xd-roll, A' Bass: x-cadence, A' Chords: x-stop, A' Lead: x-stop |
| motif 11 | broken | E | B | M | 0%/0%/0% | 0 | 0 | 0.70 | 1/2 | A Drums: n-euclid-kit, A Bass: n-bass, A Chords: n-pad, B Drums: d-develop, B Bass: v-thin, B Chords: v-thin, B Lead: v-style, A' Drums: xd-pickup, A' Bass: x-stop, A' Chords: x-stop, A' Lead: x-stop |
