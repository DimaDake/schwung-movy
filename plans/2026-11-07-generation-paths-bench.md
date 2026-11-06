# Generation paths: measuring generators in the order a user meets them (2026-11-07)

## Why

The bass-over-chords evaluation (`2026-11-06-bass-over-chords-evaluation.md`)
found the worst bass lines in a path the bench never ran: the bench's scripted
piece always builds drums → bass → chords → lead, so "bass under chords a user
already has" was never measured. It was also found by comparing *relations*
(bass ↔ chord root, bass ↔ kick) with real parts, not by grading a part alone.

Generalise both: run generators in every order and in chains (X then Y then Z),
and score how parts relate, against ranges taken from real music. Goal: a Set
can be started *and evolved* with generators only, and every order a user
might take sounds as good as the order we designed for.

One defect of this class is already visible in the code: only BASS and
Variation BASSLINE read the kick (`create/kick.ts`); no drum generator reads
the bass. "Bass after drums" locks; "drums after bass" ignores the bass.

## The rules to measure, from theory and research

Each rule names how strong the evidence is. A metric is scored as the share of
generated parts inside the **reference band** (P10–P90 of real parts in the
same role/pair), never as distance to one target number, because the evidence
for "optimal" values (e.g. the syncopation inverted U) is contested.

### Rhythm and groove

| # | Rule | Evidence | Metric |
|---|---|---|---|
| R1 | Kick and bass are one unit. Two idioms: **lock** (bass onsets on kicks: funk, pop, techno rumble) and **complement** (bass in the gaps: house/trance offbeat bass, tech-house sidechain). A bass that is neither sounds random. | Practitioner consensus (MusicRadar, Attack "Beat dissected"); groove studies on low end (Duncan & Orgs 2024; Van Dyck 2013). Public parts: 50–70% on kick. | `kickLock` (bass onsets on a kick), `kickGap` (bass onsets strictly between kicks, on 8th/16th offbeats); the pair is classed lock / complement / neither, and **neither** is the red flag. |
| R2 | Moderate syncopation drives groove; too little is stiff, too much loses the beat. | Witek et al. 2014 (inverted U); contested by Senn et al. 2024. Use the band, not a peak. | LHL syncopation per part and for the **ensemble** (onsets of all parts merged, weighted by part). |
| R3 | The metre needs an anchor: something on the downbeat (kick or bass on beat 1), backbeat (clap/snare on 2 and 4) in house/techno; offbeat open hats. | Genre conventions (Attack, MusicRadar, Loopmasters). | `anchor`: share of bars whose beat 1 has a kick or bass onset; drums: backbeat present when a snare/clap role exists. |
| R4 | Layers of different periods (3-against-4 riffs) are idiomatic, but they realign at phrase boundaries. | Butler 2006/2001 (metrical dissonance as coexisting layers, displacement dissonance). | `realign`: every part's loop length divides the scene length, and each part restarts on a 1-, 2- or 4-bar boundary. |
| R5 | Parts interlock rather than double. Density stratifies with register: hats densest, bass medium, pads sparsest. | Layering approach (Butler); arrangement practice. | `interlock`: share of 16ths covered by the union of onsets ÷ share covered by their sum (1 = no doubled onsets); `stratify`: onset density ordered hats ≥ bass ≥ chords. |
| R6 | Loops repeat, and phrases vary at their ends (AAAB: the 4th or 8th bar answers). | MusPy "groove consistency"; Middleton's musematic vs discursive repetition; the user's own 2-bar answers. | `phraseEnd`: bar-to-bar onset similarity inside a phrase vs at its last bar (the last bar should differ more, not less). |

### Harmony and pitch

| # | Rule | Evidence | Metric |
|---|---|---|---|
| H1 | EDM-pop chord loops are mostly triads from one diatonic collection; modal and ambivalent tonality is normal, so don't force major/minor. | Park 2025 (diatonic chord loops); Faraldo 2017 (EDM key is modal/ambivalent). | `scaleConsistency` (share of notes in the best-fitting 7-note collection); no penalty for which mode. |
| H2 | The bass defines the harmony: on each chord change the bass plays the root (or a deliberate pedal); passing tones sit on weak positions. | Common practice and pop theory; our own corpora (0–4% inversions). | `rootOnChange`, `voicingLow` (from `bass-metrics.mjs`), `pedal` (one pitch through ≥2 changes counts as a pedal, judged on its own). |
| H3 | Melody puts chord tones on strong beats; minor 2nds against the harmony are rare. | Already calibrated: real parts rub 0%. | Existing rub and fit metrics, now measured per **pair** (lead ↔ chords, lead ↔ bass). |
| H4 | Each part owns a register band; two melodic parts in one band with similar rhythm mask each other. | Mixing practice; the bench's mud rule. | `mud` per pair: median gap < 7 st **and** onset overlap > 50%. |
| H5 | Pitch-class entropy stays near real music; erratic pitch use reads as random. | Dong et al. / MusPy pitch-class entropy. | `pcEntropy` per part, inside the role's band. |

### Form and evolution (chains and scenes)

| # | Rule | Evidence | Metric |
|---|---|---|---|
| F1 | EDM sections differ by texture, density and low end, not by harmony; a breakdown drops kick and bass, a build-up raises density, a drop brings everything back. | Osborn (sonic formal function); EDM-98 (arXiv 2603.08759); Solberg on build-up/drop. | `energy` per scene: active layers, onset density, low-end presence (kick + bass), register span; the song's scenes must span a range of energy. |
| F2 | Sections are 8, 16 or 32 bars and change at phrase boundaries. | EDM arrangement practice. | Generated lengths and seams on 2^n bars. |
| F3 | Accumulative form: layers enter one at a time, and later sections reuse earlier material. | Spicer 2004; Middleton. | `identity` of a part along a chain (A → var → var of var): similarity to A should decay slowly and stop above a floor. |
| F4 | Repeated variation must not converge on one cliché. | Observed: the 8th-note pump dominates bass take pools. | `collapse`: diversity of parts at chain depth N across seeds vs depth 1. |

Sources: [Duncan & Orgs 2024](https://discovery.ucl.ac.uk/10204599/1/Move%20your%20Body.pdf),
[Butler 2001, MTO](https://mtosmt.org/issues/mto.01.7.6/mto.01.7.6.butler.html),
[Witek et al. 2014](https://ora.ox.ac.uk/objects/uuid:b74266b2-0504-4162-ad68-746f90527ace/files/m5624bf4c214b975af91691ba5c0693c2),
[Senn et al. 2024](https://doaj.org/article/80b7e08cac2d4344916b360d7696a983),
[MusPy metrics](https://muspy.readthedocs.io/en/latest/metrics.html),
[EDM-98](https://arxiv.org/html/2603.08759v1),
[Osborn](https://esm.rochester.edu/integral/?p=6372),
[Park 2025 dissertation](https://mtosmt.org/docs/diss-index.php?id=635),
[Faraldo 2017](https://zenodo.org/records/1154586),
[Toussaint, rhythm complexity](https://journal.iftawm.org/previous/vol2no2/toussaint/),
[Attack "Beat dissected"](https://www.attackmagazine.com/technique/beat-dissected/deep-tech-house/),
[MusicRadar on kick and bass](https://www.musicradar.com/tutorials/music-production-tutorials/how-close-listening-to-chic-and-a-selection-of-other-artists-can-teach-us-about-the-integral-relationship-between-the-kick-and-bass).

## The headline number: the order gap

For each relation metric and each pair of roles (X, Y), compare the share of
values inside the reference band when X is generated **after** Y and when Y
is generated after X. A large gap means the later generator ignores the
earlier part. The bass-over-chords bug was a gap of this kind, and the gap
finds the next ones without anyone having to guess them.

## Experience measures (beyond musicality)

- **Keepable first take:** share of default takes inside the band on every
  relation metric that applies.
- **Clicks to keepable:** a scripted user turns the knobs one click at a time
  until an option is keepable; fewer clicks means less hunting.
- **Knob promise in context:** the existing promise metric, measured with a
  full scene around the target instead of an empty Set.
- **How far a set evolves:** chain depth before identity falls under its floor
  or a part breaks a band.
- **Missing operations:** paths the scripted user cannot complete with
  generators alone (breakdown by subtraction, fill or transition clip,
  build-up, ending). These are reported as product gaps.

## Reading the notes, and listening

Metrics only measure what someone already thought to measure. Every run
writes a text piano roll per 16th (kick, snare/clap, hats, bass with root
letters, chord symbols, lead) for the worst case per metric and a few random
ones (`.gen-data/paths/<label>/rolls/`). Claude reads them each round, and
every finding becomes a metric or a fixture test. The paths' MIDI goes beside
them for blind old-vs-new listening by the user.

## The bass bench is the template, not something to redo

Bench method 6 (`bass-refs.mjs`, `bass-metrics.mjs`, `bass.mjs`) already checks
the bass in detail: 12 metrics (density, gate, legato, silence, steps,
repeats, rhythms, root, voicing low note, 3rds, on-kick, register) against
bands from the user's sets and 144 public parts. It stays as it is and keeps
gating bass changes. This plan gives the other sections the same depth and
adds what no single-part bench can see: pairs of parts and order.

- **Drums** (R1 from the drum side, R2, R3, R5): kick/backbeat/hat roles,
  syncopation, anchor, density per voice, and whether the kick answers a bass
  that already exists.
- **Chords** (H1, H2 from the chord side): do chords written over an existing
  bass take its notes as roots (the "partial" scene), voicing register vs the
  bass, harmonic rhythm against the bass's changes.
- **Lead** (H3, H4, H5, R6): strong-beat chord tones, register vs chords,
  phrase ends.

## Steps

1. **References for every role** (`quality/refs.mjs`, built on `bass-refs.mjs`'s
   extractors, which it imports rather than copies): MidiCaps electronic + pop
   windows and the user's Move/Live sets, split into roles (kick, snare/clap,
   hats, other drums, bass, chords, lead) with their scene partners. Written to
   `.gen-data/refs.json` (git-ignored); `bass-refs.json` keeps its shape.
2. **Relation metrics** (`quality/relations.mjs`): pure functions on parts in
   beats, R1–R6, H2–H5, unit-tested on hand-written fixtures. `bass-metrics.mjs`
   is untouched; where a relation already exists there (on-kick, root, voicing
   low note) relations.mjs imports it rather than redefining it.
3. **Paths** (`quality/paths.mjs`): a path is a list of steps
   `{ task, track, pick }`; orders (each role first and last), chains (depth 5)
   and mixed paths, run through `dist/esm/gen` like `piece.mjs`.
4. **Report**: per metric the share in band, per order; the order-gap table;
   rolls and MIDI written per run; `--compare <label>`.
5. **First fixes from evidence**, starting with drums after bass (R1), each with
   a test that fails without the fix.
6. Chains and form (F3, F4, energy), then clicks-to-keepable and missing
   operations.
