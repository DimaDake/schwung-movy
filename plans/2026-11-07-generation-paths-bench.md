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

## Round 1 results (2026-11-07)

Built: `ref-sources.mjs` (the set and MidiCaps readers, shared with
`bass-refs.mjs`, whose output is byte-identical), `refs.mjs` (143 public + 151
user reference scenes with every role), `relations.mjs` (the rules above as
metrics, `browser-test/logic/gen-paths.mjs`), `paths.mjs` (24 orders × seeds,
the scene measured after every step too), `paths-score.mjs` / `paths-run.mjs`
(bands, order gap, first-step table, the Set's key, rolls and MIDI per run in
`.gen-data/paths/<label>/`). 144 scenes run in ~5 s.

What the references say (P10–P90 / median, public · user): bass under a lead
never rubs (`lb.rub` 0); a chord note a semitone over the bass's pitch class
almost never (`bc.rub` P90 0.06 · 0); the user's bass lines vary their phrase
ends far more than public ones (`bass.phraseEnd` median 0.25 · 0.00) and the
user's pads strike under once a bar (0.75). "Neither lock nor complement"
kick/bass happens in 9 · 14% of real scenes, so it is rare, not forbidden.

### Fixed: key finding left the Set's key on a sparse part

Reading the rolls of the scenes out of band found chords made **after a bass**
playing Cmaj7 (E natural) over a C minor bass that plays Eb, and D major / B
naturals over a D minor bass on Bb. Cause: `keyFor` took the Krumhansl key with
the Set's key only as a 0.03 tie-break, and a 5-8 note bass correlates better
with a key a fifth away (D minor riff → G major). Every one of its notes was in
D minor. Fix (`theory/key.ts` HOLDS): while ≥ 95% of the sounding duration
sits in the Set's scale (minor with its raised 7th), only keys with the Set's
key signature can win; the notes still choose the tonic (an A minor riff in a C
major Set reads A minor) and notes off the scale still move the key.

| | before | after |
|---|---|---|
| bass / chords / lead scenes < 90% in the Set's key (of 72 each, made after their partner) | 6 / 4 / 2 | 0 / 0 / 0 |
| bass in the chord at chord changes, chords made after the bass (median) | 0.54 | 0.60 |
| quality bench: pieces broken / role breaks | 21% / 4 | 17% / 3 |

Everything else on the quality bench is unchanged (`plans/gen-quality-keyfix.md`).
One merge-baseline fixture moved with it: the messy pad (A harmonic minor in an
A minor Set) was recorded while it read as F major.

### Open after round 1 (all taken in round 2, below)

1. **Chords made first are busier than chords in context and than real pads.**
   Alone, CHORDS strikes 3-3-4-3-3 and PAD a dotted rhythm three times a bar
   (`chords.sync` 6 vs 2 in context; the user's pads 0.75 strikes a bar).
   Starting a Set from chords is a common way in.
2. **Chords made last can skip every downbeat** (CHORDS 3, 6, 11, 14).
3. **Bass in the chord at changes, chords after the bass: 0.60 vs 0.80** when
   the chords lead; read the rolls after the key fix before deciding.
4. **Bass first, on an empty Set**: offbeat (2, 6, 10, 14) or 3-3-2 takes
   that never touch beat 1 with nothing yet to anchor them.
5. **Lead after chords shares few of their onsets** (0.33 vs real 0.79): a
   counter-rhythm; judge by ear before treating it as a fault.
6. Drums after bass: kick on bass 0.50 vs 0.67 — drums still never read the bass.

## Round 2 results (2026-11-07)

Bench: `paths-run.mjs --label round2 --compare base3` (base3 = round 1's code with
the new `chords.onOne` metric). Quality bench: `plans/gen-quality-round2.md`
against `keyfix`: nothing regressed; pieces broken 17% → 13%, knob dead clicks
15% → 12%, DRIFT's promise 87% → 89%.

| open item | what the evidence was | fix | before → after (in band) |
|---|---|---|---|
| 1. chords made first busy | a lone part rolled offbeat / SYNC 16 figures: nothing else plays, so an offbeat is heard as a displaced downbeat (LHL is relative to a felt metre) | `pattern-knob.ts unpulsed`: New Clip on an empty scene takes figures that strike beat 1 and, where the part has them, beat 3; a lone PAD holds (HELD / BAR / HALVES), as the user's pads do | `chords.sync` made first 33% → 100% |
| 2. chords made last skip downbeats | new metric `chords.onOne` (harmony sounding on beat 1, a push held across it counts): public scenes skip it in 2%, user's in 9%; made last was already 98% | none needed: the misses were chords made first (item 1) | `chords.onOne` 90% → 99% |
| 3. bass in the chord, chords after bass | rolls: STABS' thin voicing E4-G4 over a C bass is C major with the root left to the bass (shell / rootless voicing), counted as "not in chord" | metric: under a dyad the bass is in the chord when it completes a triad (`bassFits`, shared `isTriad`); plus item 4's anchored bass | `bc.inChord` after 75% → 100% (median 0.60 → 0.80; real 0.67-0.75) |
| 4. bass first never anchors | OFFBEAT / 3-3-2 takes alone | item 1's rule (beats 1 and 3) | `bass.sync` made first 50% → 100%, anchor 50% → 100% |
| 5. lead after chords | MELODY and RIFF drew their rhythm without the band; COUNTER answers it on purpose | `common.ts bandLean`: the band's four strongest accents add 0.4 to a step's pull (BROKEN's kick already did; now shared), in MELODY's rhythm, its phrased onsets and RIFF's cell | `lc.coincide` 68% → 96%, gap -53 → -6 |
| 6. drums never read the bass | the gap came from item 4: an offbeat bass first, a four-on-the-floor kick never meets it | none needed (BROKEN leans on the band) | `bk.kickOnBass` 96% → 100%, gap 0 |

Found on the way:

- **Lead inside the chords** (`lc.mud`, H4): ARP and RIFF sat in a pad's octave.
  `band-pitch.ts lineFloor`: a new line over chords puts its middle a fifth over
  theirs (RIFF's register take, ARP's window), as `chordFloor` keeps chords over
  the bass. A track that already plays in another scene keeps its own register
  (`ownMiddle`; a Variation's New Clip options, where RIFF also takes the
  register nearest it). `lc.mud` 64% → 74%.
- **DRIFT did nothing to a line of roots on the beats**: a strong-beat note was
  held to chord tones within one scale step. It now moves to the next chord tone
  that way, and a voice keeps the direction it first drifted, so turning further
  never walks it home.
- **WALK's passing note was a whole step whatever the scale**, so a Set in a
  named mode heard notes outside it. It is now the scale's neighbour (chromatic
  stays at high TENSION).

### Open after round 2

1. **Chords made after the lead land in its octave** (`lc.mud` 60% in band when
   the lead came first, 88% the other way): a chord ceiling under a lead, the
   mirror of `lineFloor`.
2. **A lead made first is busy** (`lead.perBar` 8 alone, 67% in band).
3. `bk.offbeat` order gap (-15): a bass made after drums is more offbeat (0.31
   vs 0.20), still inside the real band (≤ 0.52); house convention, by ear.
4. Step 6 of the plan: chains and form (Variation / Double depth, identity
   decay, collapse, energy arc), clicks-to-keepable, missing operations.

## Round 3: chains, scene B, leave one out, options (2026-11-07)

### What is measured now

- **Chains** (`quality/chains.mjs`, `chains-run.mjs`, ~75 s): scene A by New
  Clip; **scene B by Variation, track by track, in all 24 orders** (the tracks
  already varied are B's band); one part varied 5 times in a row; every track
  Smart Doubled; a loosely played part (gen-fixtures `messy`) Smart Quantized.
  Report: `.gen-data/chains/<label>/report.md`.
- **Leave one out** (`quality/loo.mjs`): each part of 294 real scenes (the
  user's scene rows and public windows) taken away and New Clip asked for it
  there. Judged "as good as the real part": no more than one metric out of
  band that the real part had in band.
- **Options and clicks** (`quality/keep.mjs`), on every request of every
  bench: options usable of those shown, rank of the first usable, how
  different they are, whether the kept one is usable, and knob clicks (one knob,
  up to 3) from it to a usable one.
- **Usable, calibrated on real parts**: at most one metric out of band.
  Real parts in the user's scenes have none out 42-49% of the time and at most
  one 74-82% (P10-P90 bands over ~15 metrics), so "all in band" failed half of
  real music.
- **New rule metrics** (`relations-texture.mjs`): `interlock` (R5, doubled
  onsets), `stratify` (R5, density thins upwards; flag, user band),
  `chords.changes` (harmonic rhythm: a new chord is neither inside nor around
  the last, user band 0.38-1 a bar), `bc.pedal` (H2), `accent` (pitched
  accents with the drums), `bass.seam` / `lead.seam` (the loop's wrap leap,
  user loops only), `realign` (R4: loop lengths divide the scene).
- Measurement fixes found by reading notes: a strum's late voices count as one
  strike (`unstrum`), a revoiced 7th chord is no change, a per-pad drum option
  is not judged as a whole kit, rhythm likeness beside note likeness.

### Fixed from the evidence

| finding | cause | fix | effect |
|---|---|---|---|
| chords made after a bass or a lead changed 1.5-2 times a bar (user's scenes 0.4-1) | a single line spelling C-E-G inside a half-bar made the scene **locked**, so chords were read off the line every half-bar, passing notes included (Em7b5, Gsus4) | `context.ts`: locked needs a part that strikes chords (2+ notes together, within a 32nd, on half its onsets); a line pins the harmony | `chords.changes` in band 44% → 99% |
| ... and in partial scenes too | `fits()` chose a chord per half-bar | `plan.ts fits`: one chord per span of the progression, holding what sounds where it arrives, one passing note per later half-bar | |
| comps made after others took offbeat figures (HOUSE, OFFBEATS: LHL above 90% of real comps) | `harmFit` judged every take on the HOME plan, so a take on another HARMONY lost on its strong beats | `select.ts`: a New Clip take is judged on its own HARMONY where it sets the harmony (not locked; Variation unchanged: its B scenes broke more) | `chords.sync` 90% → 100%, `bc.rub` 88% → 99% (vs round 2) |
| role breaks in the piece bench | Variation's Step 14 New Clip options have no source role to keep | `engine.ts`: takes that break the track's role give way to the preset's others | role breaks 3 → 0, best-of-six gate 67% → 83%, pieces broken 13% → 8% |
| bench: `KEYS` spelled 'Bb', which `keyHint` does not read (the app sends sharps) | | `piece.mjs` spells sharps, one root table (`scene.mjs PC`) | |

Quality bench (`plans/gen-quality-round3.md` vs round2): nothing regressed.

### Results

- **New Clip, every order** (`paths-run --label round3`): the kept take is
  usable 69-100% (real parts 74-82%). Weakest: a lead made last (69%), chords,
  bass or drums made last (75%), mostly one metric past the slack.
- **Scene B by Variation**: drums 88%, bass 67%, chords 54%, lead 37% usable in
  the finished B (A: 50/67/100/83%). Each part was usable when made (chords
  63%, lead 65%), so **later Variations break earlier ones**: `lc.coincide`,
  `lc.mud`. Variation keeps rhythm 0.33-0.80 of A and almost no note cells (its
  default HARMONY moves a new section, by design). Order gaps: chords varied
  after the bass share fewer of its onsets (`bc.coincide` -18); a bass varied
  before the chords sits on their root less (79% in band vs 100%).
- **Variation 5 deep**: no collapse (rhythm spread across seeds flat at
  0.5-0.9); each step moves far (distance 0.8-0.95 for melodic parts, rhythm
  identity 0.3-0.5 after one), so there is no small-step evolution. Chords
  fall from 100% usable to 43-67% by depth 2-4 (`chords.sync`, `onOne`,
  `changes`).
- **Smart Double**: 17% of fully doubled scenes usable for every part; the 6
  options are alike (diversity 0.23-0.36).
- **Smart Quantize** option 1: melodic parts come back toward the clean take
  (bass 0.64 → 0.84, lead → 0.89), **drums do not** (0.66 → 0.66); chords
  usable 33%.
- **Leave one out**: some option is as good as the real part in 83-100% of real
  scenes. Per generator on the user's scenes: BASS 85%, PULSE 54%, WALK 57%,
  CHORDS 56%, STABS 47%, PAD 75%, ARP 64%, MELODY 96%, RIFF 94%. Generated
  leads are busier than real ones (`lead.perBar` the top fail), basses more
  syncopated (`bass.sync`).

### Open after round 3, by weight

1. **Variation does not hear the band** (`ctx.band` is New Clip's and
   Double's only): in B a varied part does not lean on, or keep its register
   from, the parts varied before it, and the next Variation breaks it (chords
   and lead usable 100/83% in A → 54/37% in B).
2. **Variation moves far in one step**: no "a little" (each step 0.8-0.95 away);
   a Set evolves by jumps.
3. **Smart Quantize drums**: option 1 brings nothing back; chords 33% usable.
4. **STABS, CHORDS, PULSE, WALK, ARP over real scenes** at 47-64%; leads busy
   over real parts.
5. `harmFit` forgives weak beats, so offbeat takes win (`bk.offbeat` gap -29:
   bass after drums takes OFFBEAT).
6. Double: options alike; 17% of doubled scenes usable throughout.
7. `stratify` rests on 25 user scenes; treat as a hint.

## Round 4: the five open items (2026-11-07)

| # | item | what the evidence said | change | result |
|---|---|---|---|---|
| 1 | Variation does not hear the band | `ctx.band` was New Clip's and Double's only; in scene B a line varied after the chords landed in their octave, hitting with them | `context.ts`: Variation gets the band's hits; `select.ts bandFit`: options that hit the band's accents and keep a fifth from the other parts rank higher; `band-pitch.ts clearMud`: a varied line in a chord part's octave, hitting with it (or chords on a line so), moves an octave away, never into the bass register (two chord parts, a drone and a bass are left) | lead usable in the finished B 47% → 76%, lc.mud flags 48 → 38 (re-judged like for like); chords 65% → 63% |
| 2 | Variation moves far per step | every Variation re-harmonises or re-writes: 0.8-0.95 from the last step | **NUDGE** (`presets/var-nudge.ts`), always option 1: the part with a few notes moved by DRIFT's walk, on its own harmony; AMOUNT, BARS (every / even / last), DIRECTION (any / up / down), SEED. `drift.ts` takes where and which way | kept every time: identity 0.66 → 0.48 → 0.37 → 0.25 → 0.19 over 5 presses, rhythm kept, usable 83-100% at every depth (the rotation chain's chords: 43-67%) |
| 3 | Smart Quantize drums brought nothing back | CLEAN kept grazes (floor a share of the whole part's median) and nothing repaired a slip onto the next pad | `shape/drums.ts clean`: grazes against their own pad's level; slips repaired where most other bars play the neighbour pad, the slip is isolated, the bar plays the loop, and the neighbour pad is used far more | grazes gone, isolated slips repaired, fills kept (gen-evolve.mjs). The bench's messy fixture slips one hit in five at repeating places, which the guards leave (by design) |
| 4 | weak generators over real music | PULSE/WALK met neither the kick nor its gaps; CHORDS/STABS missed the band and beat 1; ARP 16 notes a bar | take pools: PULSE and WALK draw the kick lock a third of the time, CHORDS and STABS the band's accents a third, ARP eighths (defaults unchanged) | as good as the real part (user scenes): ARP 64 → 84%, WALK 57 → 72%, STABS 47 → 78%, CHORDS 56 → 65%, PAD 75 → 82%, PULSE 54 → 58% |
| 5 | harmFit's weak-beat bias | wrong premise: the bass takes score within 0.03 of each other; the "offbeat" bass sits on a broken kick (the lock idiom) | measurement: `bk.offbeat` counts offbeat 8ths off the kick only (R1's complement) | the order gap is gone |

Also: `stratify` is reported but no longer judged (25 user scenes; `'info'`).

Quality bench (`plans/gen-quality-round4.md` vs round 3): pieces broken 8% →
0%, New Clip with band 0.76 → 0.80. Lower: Variation best-of-six gate 83% →
72% (one option thinner than 0.4x its source: WALK's kick lock under a busy
bass, NEXT CHORDS displaced by NUDGE, one each), coherence 0.91 → 0.88
(NUDGE's moved notes are passing tones by design), alignment 0.63 → 0.61.

### Open after round 4

1. **Chords varied in B change too often** (`chords.changes` the top miss: 48
   of 144 B scenes); chords in B usable 63%.
2. Lead vs chords onsets in B (`lc.coincide`), 35 scenes.
3. PULSE over real scenes stays at 58%.
4. The best-of-six gate's density rule against Step 14's New Clip options.

## Round 5: variety (2026-11-07)

`quality/variety.mjs`, `variety-run.mjs` (~20 s): do the metrics tell scenes
apart, and do the generators give a different part each time?

- **Metrics**: per metric, generated against real: distinct values, the
  commonest's share, the P10-P90 width. "generators constant / narrow" means
  the generators never go where real music does; "measures nothing" would be
  a dead metric (none is). `accent` and `ens.sync` are near-automatic
  wherever hats play every 8th: weak.
- **New Clip pressed 10 times** (history on, as on the device), per
  generator, empty and in a band: distance between takes, rhythms, the
  commonest rhythm's share, knob settings. Across scenes: the first press in
  each.
- **Variation, Smart Double, Smart Quantize**: the six apart, a second
  press, SEED turned 0-5 on every option that has it.

### Found and fixed

| finding | cause | fix | before → after |
|---|---|---|---|
| a second press of Variation or Double gave the same six | only New Clip carried a per-press nonce | `ai/job-algo.ts`: every press but Smart Quantize's is its own run (a quantize fixes the take as played) | same on a second press 100% → 0% |
| HARMONIZE, FOLLOW: one line every press; LOOPER: one rhythm | adopted Variation knobs (`custom`, `count`, `K.*`) are never drawn by a take | `common.ts drawn(knob, pool)` (pool[0] = the default): their musical knobs drawn | rhythms in 10 presses: HARMONIZE 1 → 8.7, FOLLOW 1 → 9.3, LOOPER 1 → 6.6 |
| a bass alone came back on one figure 7 presses in 10 | take choice by score ties to one figure; history compared notes, not rhythm | `takes.ts`: among takes within 0.01 of the best, one whose rhythm was not offered lately | commonest rhythm 70% → 48% (empty), 39% → 34% (in a band) |
| MELODY's SEED gave 3.7 takes in 6 | phrased, its pitches followed the contour alone | the seed bends the contour by up to 2 semitones a note | 5.7 of 6 |
| DECORATE's SEED gave one take in 6 | with no more candidates than AMOUNT, every seed chose them all | the seed also places each passing note in its room | 6 of 6 |
| WALK's SEED gave one take in 6 (New Clip's, on a bass track) | the walk was set by where the line was | the seed sets each walk's length and one in four comes from the other side | 4.5 of 6 (the rest: figures with nothing to walk) |

Not taken: PULSE's DENSITY and OCTAVE drawn (as good as the real bass 58% →
48% with them; its rhythm varies through PATTERN, 10 of 10), WALK's densest
take. Quality bench (`plans/gen-quality-round5.md` vs round 4): nothing
moved but Variation's best-of-six gate 72% → 67%, its density rule (under
0.4x the source) failing THIN, which thins by design, and Step 14's New Clip
options (open item 4 of round 4).

### What variety is by design

- ARP's rhythm is its rate, HOLD a drone, PAD alone holds: few rhythms,
  their notes 0.88-0.96 apart press to press.
- GRIDS's randomness is CHAOS's (default 2), FILL's a beat or a bar, FEEL
  at AMOUNT 100% changes every hit: SEED moves little there.
- Smart Quantize repeats: a fix, not a search.

### Open: where generators lack real music's range

`kick.perBar` 3-4 (real 2-5.5), `interlock` 0.43-0.58 (real to 0.86: parts
double each other's hits more), no pedal bass (`bc.pedal`), no passing
dissonance against chords (`lc.rub`), never chromatic (`ens.scale`), harmony
always on beat 1 and the anchor always there.
