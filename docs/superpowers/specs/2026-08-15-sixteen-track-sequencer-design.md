# Movy as a 16-track sequencer

**Date:** 2026-08-15
**Status:** design, approved for planning.
**Supersedes the open questions in:** `plans/2026-08-11-audio-tracks-fx-chain-feasibility.md`

Movy today sequences 4 tracks, and a track *is* a schwung shadow slot (0-3).
This design takes it to 16: the first 4 stay host-backed, and movy hosts the
other 12 as private schwung module chains of its own.

Source refs: `schwung` @ `120ba662` (origin/main), `movy` @ `b02e403`.

---

## 1. Decisions taken

| Question | Decision |
|---|---|
| Topology | 4 host tracks (schwung slots 0-3) + 12 movy-hosted chains |
| Audio | All movy tracks sum into movy's single overtake stereo bus; movy owns their gain/pan/mute |
| Chain shape | Full parity — `midi_fx1 / synth / fx1 / fx2 / lfo`, the existing `CHAIN_SLOTS` |
| CPU ceiling | Measured per synth (8-725 µs/track); no fixed cap — see `docs/chain-cpu-benchmarks.md` |
| Persistence | Full `state` blobs per movy track, per set |
| On close | Movy tracks stop, no warning (the sequencer already stops on close) |
| Session grid | Focused group only — 4 rows × 8 clip slots, unchanged semantics |
| Abstraction | A full `TrackPort` interface, not per-site branching |

---

## 2. The abstraction

```
TrackRef      = { index: 0..15, kind: 'host' | 'movy' }
group(t)      = t >> 2                indexInGroup(t) = t & 3
kind(t)       = t < 4 ? 'host' : 'movy'
chainInst(t)  = t - 4                 // movy tracks only
```

A new `src/track/` owns this. One interface, two implementations:

| Operation | `HostSlotPort(slot 0-3)` | `MovyChainPort(inst 0-11)` |
|---|---|---|
| `getParam` / `setParam` | `shadow_get_param(slot, key)` | bulk IPC to movy-dsp, key `ch<N>:fx1:wet` |
| `getMany` / `setMany` | loop (as today) | **one** `shadow_get_params` round trip |
| `sendMidi` | `shadow_send_midi_to_dsp` | audio-thread `on_midi` (§5.3) |
| `loadModule` | `shadow_set_param(slot, 'synth:module')` | worker-thread create + load |
| `dumpState` / `applyState` | existing `undo/module-dump.ts` path | same `state` blob contract |

`appState.activeSlot: number` becomes `appState.activeTrack: TrackRef`. The
~62 direct `shadow_*` call sites across 22 files route through the port.

`CHAIN_SLOTS` is **unchanged**: a movy track has the same five chain slots as a
host track, so `hierarchy.ts`, the module browser, the knob pages, the LFO page
and undo all operate on either kind without knowing which. That is the point of
paying for the refactor up front rather than branching per site — it is also
what makes "run every test on both kinds" a parameterization instead of a
duplicated suite.

### Why bulk IPC is not optional

A movy track's params do not live in the shadow slot SHM; they live inside
movy's own DSP. The naive route — one `host_module_get_param` per key — blocks
3-5 ms each on device, and `model/store.ts` refreshes 8 knob values regularly.
That is 40 ms per refresh, against a tick period that *is* movy's MIDI sampling
interval.

`shadow_get_params` / `shadow_set_params` (`shadow_ui.c:811`, BULK_GET/BULK_SET,
64 KB payload) already route straight to the overtake DSP
(`schwung_shim.c:3463`) and collapse N round trips into one. Movy does not use
them yet. `MovyChainPort` is built on them from the first commit.

---

## 3. Group focus and navigation

`appState.focusGroup: 0..3`. Track buttons (CC 40-43) address
`focusGroup * 4 + n`.

- **Session view: the 16 step buttons are the track selector.** The focused
  group's 4 steps show their track colour at full brightness; the other 12 show
  their dim variant. The bright quad's *position* is the group indicator —
  colour is a secondary cue, never the only one.
- **Octave up / down** move the focus group. Dim when a move is available, off
  at the ends — the rule `arrowLedColor` already applies to bar navigation.
- **Session held + step** selects a track without latching into Session view.
  The momentary tap/hold/revert machinery in `router-buttons.ts` already
  distinguishes these; this is one more consumer of it.
- **Selecting a track sets `activeTrack` *and* `focusGroup`**, so the track
  buttons and the clip grid refocus together.
- The 32 pads keep their meaning: 4 rows × 8 clip slots for the focused group.

In Session view the step row is currently painted black (`leds.ts:206`). That
branch becomes the track selector.

---

## 4. Track colours

| | track 1 | track 2 | track 3 | track 4 |
|---|---|---|---|---|
| **G1** | Bright Orange `3` | Rust Red `27` | Neon Pink `23` | Electric Violet `20` |
| **G2** | Light Magenta `26` | Royal Blue `16` | Light Yellow `5` | Dull Green `10` |
| **G3** | Pure Blue `125` | Vivid Yellow `7` | Burnt Orange `28` | Hot Magenta `21` |
| **G4** | Dark Grass Green `85` | Bright Pink `25` | Blue-Violet `18` | Ochre `6` |

```
TRACK_COLOR     = [3,27,23,20, 26,16,5,10, 125,7,28,21, 85,25,18,6]
TRACK_COLOR_DIM = [65,111,105,99, 19,95,78,77, 107,83,75,22, 87,35,17,73]
```

The requirement is not that all 16 brights are mutually distinct — it is that
**every row and every column is pairwise distinct**: four tracks within a group,
and the same track index across groups.

Chosen by search and verified numerically (`browser-test/track-colors.mjs`,
§7): worst required pair **33.8**, under normal vision **and** protanopia **and**
deuteranopia, with lightness de-weighted (×0.35) so a pale blue and a royal blue
do not count as "far apart" — on a 3 mm LED they read the same. No two members
of one hue family share a row or column, with blue and violet counted as **one**
family; CIELAB puts pure blue at 306° and electric violet at 311°, which is
exactly why they look alike on this hardware.

### 4.1 The root-pad constraint (revision, 2026-08-16)

The first matrix kept Move's own colours in G1 and scored 13.9. It was wrong in
a way the numbers could not show. A track colour does not only paint step and
clip LEDs — it paints the **chromatic root pad**, whose neighbours are grey
in-scale pads (`C_LIGHTGREY`) and white held pads. On device, the accents for
tracks 5, 7 and 9 (Azure Blue, Mint Green, Cyan) were indistinguishable from a
lit in-scale pad.

Two causes, and only one of them was numeric:

- The reserved-colour check reused the **lightness-de-weighted** metric from the
  track-vs-track checks. Against an achromatic reference that is simply the
  wrong metric — lightness is one of only two cues left there, not a weak one.
  At full weight Cyan sits 12 from white and Teal Green 15. Sky Blue `47` and
  Teal Green `12` were equally bad and had not been reached in use yet.
- **Azure Blue passes every numeric test** — 80 from white — and still failed on
  hardware. The reference hex table is derived from the rnbo.move.control docs
  and describes the palette approximately; Move's LEDs wash out cool hues at
  brightness in a way no CIELAB figure predicts.

So the guard now carries two rules that are *empirical, not derived*, and the
comment in `colors.ts` says so:

1. no cool hue (LAB 145°–310°) above L 45;
2. no pastel (L > 65 with chroma below 0.7·L) at any hue.

Rule 2 was added after the search's first answer put Pale Green `#AEFF99` at
track 10 — the same washed-out failure on the warm side of rule 1's cutoff.

Move parity for G1 was dropped deliberately. Pinning G1 to Move's colours was
measured and still reaches 20.7, so parity remains available at that cost if it
is ever wanted back; the free search reaches 33.8.

Dim variants were re-searched too, and the earlier "dim variants collide"
limitation is **resolved**: all 16 are now distinct, each sharing its bright
partner's hue family, separated by at least 9.8 within any row or column. The
Session step row shows all 16 tracks at once with unfocused groups dimmed, so
they are compared against each other on screen and duplicates were never as
harmless as the original note claimed.

### 4.2 A third tier for the Session selector (2026-08-16)

`sessionStepColor` is the only place that puts twelve dim colours on screen at
once, and the bright quad has to win against them. Everywhere else `dim` is
either one track's colour (the watched track's empty in-loop steps, where it
marks the **loop window** and must stay legible) or four muted track buttons —
so those keep the `dim` tier and only the selector moves to `TRACK_COLOR_DIMMER`.

The fix is not a uniform step down, and the measurements are why. The dim tier
ranged L 9 to L 33, and a row reads as bright as its brightest members: Violet
33, Mauve 33, Olive 32, Dull Yellow 31. So each dimmer entry is capped at its
own dim partner's lightness — the ten already sitting low are unchanged, the six
outliers come down to meet them. Mean 21.3 → 15.7, spread 8.3 → 4.6, all 16
still distinct, worst row/column pair 7.6.

Going further was tried and rejected with evidence. This palette has few dark
chromatic entries: a uniform band at L ≤ 20 cannot produce 16 distinct hue-
faithful colours at all, and at L ≤ 18 the best available collapses to 6 distinct
colours with a worst pair of 1.8. Roughly L 15 is the floor for a tier that still
reads as sixteen colours.

One honest limitation remains:

- **Under deuteranopia, yellows collapse onto the playhead's neon green.** The
  playhead is disambiguated by *motion*: it moves, track colour does not.

An attempt at 16 *mutually*-distinct hues — every cell far from every other,
not just within its row and column — was abandoned with evidence: once the
playhead green and the achromatic pads are reserved and the two hardware rules
above are applied, the pool is 31 usable colours, and the search is forced into
pairs like tan-vs-rust at ΔE 8. Row-and-column distinctness is what the UI
actually needs, and it is what is asserted.

---

## 5. Engine and DSP

### 5.1 `NUM_TRACKS` 4 → 16

`seq-core/src/track.rs:6`. Track output becomes a sink:

```rust
enum TrackOut { HostMidi(u8), LocalChain(usize) }   // 0-3 -> ch, 4-15 -> inst
```

That enum in `drain_out()` (`movy-dsp/src/lib.rs:100`) is the whole
audio-routing change. Host tracks keep emitting `midi_send_internal(0x90|track)`
exactly as today.

### 5.2 Status protocol — predicted risk, measured away

**This section predicted wrong, and the measurement is kept here rather than the
prediction.** The concern was that `sess=`, `mute=` and `act=` grow 4× and are
parsed in QuickJS on every poll, so status should carry only the focused group
with the other 12 tracks on a separate low-cadence poll.

Measured (`browser-test/perf.mjs`, "status parse cost, 4 vs 16 tracks"):

| tracks | parse |
|---|---|
| 4 | 0.0081 ms |
| 16 | 0.0117 ms |

**1.46×, not 4×** — sublinear, because the fixed part of the status string
dominates the per-track part. Against the poll's own ~0.3 ms IPC round trip and
a 5-15 ms tick, parsing is noise.

So the **full 16-track status ships**, and the split is not built. It would have
bought nothing and cost staleness in the off-screen groups plus a second
protocol path to keep correct. The perf test stays as the guard: if a future
change makes the parse superlinear in track count, it fails.

### 5.3 Chain hosting in `movy-dsp`

- **dlopen a movy-private copy of `chain/dsp.so`** — a separate mapping, so
  `move_plugin_init_v2` cannot clobber the `g_host` shared by schwung's own 4
  slot instances (feasibility §5.1). A symlink does **not** work: dlopen
  resolves to the same realpath and shares the mapping. The copy is a *cache*,
  not a fork — see §6.
- **The `.so` is loaded from movy's copy, but `create_instance` is passed
  schwung's own chain module dir** (`/data/UserData/schwung/modules/chain`).
  These are deliberately different paths. The chain host resolves FX as
  `<module_dir>/../audio_fx/<name>/<name>.so` (`chain_host.c:245`), so passing
  movy's directory would resolve against movy's parent and find no FX at all,
  while passing schwung's gives movy every audio FX the user has installed from
  the store — with no movy-side registry.
- **Lazy instantiation.** No instance exists until a module is loaded on that
  track. The render loop walks a compact active list, not 12 slots, so an empty
  chain costs one branch. This is the "empty chains must not affect performance"
  requirement, and it is enforced by a perf test, not by inspection.
- **Worker thread** for `create_instance`, module loads and state restore.
  `render_block` runs on the SPI thread (SCHED_FIFO 90, core 3, ~900 µs budget):
  no filesystem access, ever.
- **CPU: measured, and no cap is needed.** `scripts/measure-chain-cpu.sh` loads
  chains one at a time and reads the shim's own `render=avg/max` counter (the
  `Post(us)` half of `spi_timing`, which times
  `shadow_inprocess_render_to_buffer` — the call that invokes movy's
  `render_block`; `mix_audio` does NOT move with movy chains and reads a flat
  7 µs).

  | chains | render avg | per-chain |
  |---|---|---|
  | 0 | 27 µs | — |
  | 1 | 60 µs | +33 |
  | 3 | 111 µs | +25 |
  | 6 | 189 µs | +26 |

  **~26 µs per Plaits chain, linear.** Twelve extrapolates to ~340 µs average
  against the ~900 µs SPI section budget, inside a 2900 µs frame. So the cap the
  design reserved the right to add is **not built**: it would refuse loads the
  hardware handles comfortably.

  **Full per-synth data: `docs/chain-cpu-benchmarks.md`.** Seven synths at 1-4
  held notes, plus the ramp that establishes the work budget (~2000 µs, of which
  ~1737 µs is available to chains). The spread is 90×: dexed costs 8 µs/track and
  fills all twelve, helm costs 725 µs/track at four notes and fits two. So a
  fixed cap would be wrong in both directions — it is the synth and its polyphony
  that decide, not a track count.

  Loading still dominates anyway (1986 µs for a single module load, §5.2).

Live pad input needs no new IPC: `schwung_shim.c:6950` already delivers internal
cable-0 note events to the overtake DSP's `on_midi` on the audio thread,
explicitly so overtake tools can handle pads without the JS round trip. Movy
tracks are therefore playable at *lower* latency than the current host-track
path. Movy-dsp needs to know the live target track — one cheap param, not a
per-note message.

### 5.4 What movy tracks do not get

They sum into one stereo bus, so Move's mixer sees a single channel: no per-track
Move fader, no Move display presence, no separate ME channels
(`overtake_dsp_gen` is a single global, `schwung_shim.c:418`). Level, pan and
mute for these tracks are movy's own (stage 6).

---

## 6. Divergence guardrails

Four copies exist in this design. Three are made self-checking; one is
eliminated.

**6.1 `chain/dsp.so` — eliminated as a fork.** Do not vendor a build into
movy's repo. Copy it *at movy startup* from the installed
`/data/UserData/schwung/modules/chain/dsp.so`, keyed by source hash: matching
hash → reuse, otherwise re-copy. The copy then tracks whatever schwung version
the user has and divergence is structurally impossible. The only thing the copy
buys is a separate dlopen mapping, which same-content satisfies. Copy to temp +
rename for a fresh inode, and only before any instance exists — **never write
over a mapped `.so`** (it corrupts its pages and crashes MoveOriginal).

**6.2 The C ABI mirrored in Rust — the dangerous one.** `movy-dsp/src/ffi.rs`
already hand-mirrors `host_api_v1_t` ("Field order mirrors host_api_v1_t —
NEVER reorder or skip"). Hosting chains adds a mirror of `plugin_api_v2_t`. A
reordered field means calling the wrong function pointer *inside MoveOriginal*.
Three layers:

- **Runtime**: `plugin_api_v2_t`'s first field is `api_version`
  (`plugin_api_v1.h:205`). Assert `== 2` before touching any other field; refuse
  to host chains otherwise.
- **dlsym**: the chain host's extra entry points (`chain_process_fx`,
  `chain_set_inject_audio`, …) are name-resolved, so a rename surfaces as a NULL
  symbol. Check each and degrade with a log line rather than segfault.
- **Parity test**: parse `schwung/src/host/plugin_api_v1.h`, extract the v2
  struct's fields in order, assert against the list pinned in movy. Fails with
  "mirror verified at schwung 120ba662, header now differs at field N".

**6.3 The LED palette.** Already copied into `colors.ts` today ("hardcoded here
so seq modules don't depend on injected globals"), and about to carry 16 entries
instead of 4. The colour verifier reads `schwung/src/shared/constants.mjs`
directly and asserts each index still maps to the expected hex *before* checking
distances — so a schwung renumbering fails the test instead of silently
repainting movy.

**6.4 Logic that must not be copied at all.** Param-metadata parsing, the
`state` blob format, FX path resolution
(`<module_dir>/../audio_fx/<name>/<name>.so`). These are reached through the
chain host's own `get_param`, never reimplemented. Stated as a rule so a later
stage does not "optimize" by inlining one.

Both tests are local and device-free. They **fail hard** when the schwung repo is
present and **skip with a loud warning** when it is absent — never silently pass.

---

## 7. Testing

Stage 1 is what makes this affordable: suites parameterize over `TrackRef`
instead of duplicating. `logic.mjs`, `app-loop.mjs` and `dump-replay.mjs` each
run their existing assertions against a host track and a movy track from one
body of code; the device suites take a track-kind argument.

New tests, at the cheapest level that reproduces the thing:

| Test | Level | Asserts |
|---|---|---|
| `track-colors.mjs` | logic | palette indices match schwung's table; row/column separation under 3 vision models |
| `abi-parity.mjs` | logic | Rust mirror matches `plugin_api_v1.h` field order |
| `track-port.mjs` | logic | both ports satisfy the same interface contract |
| group/session LEDs | screenshot + `app-loop` | selector brightness, focus quad, octave affordances |
| empty-chain cost | perf | 12 empty chains ≈ 0 added per-block work |
| status cadence | perf | per-tick IPC and parse cost do not regress vs 4 tracks |

Each new test proves it has teeth by removing the fix and watching it fail.

---

## 8. Stages

| | Stage | Delivers | Risk |
|---|---|---|---|
| 1 | `TrackPort` refactor, host-only | no visible change, all suites green | low — keystone |
| 2 | Engine 16 tracks + group/session/colour UI | full 16-track sequencing, **silent** on 5-16 | low — no DSP |
| 3 | movy-dsp chain hosting + audio | tracks 5-16 sound | **high** |
| 4 | Chain UI on movy tracks (bulk param IPC) | load/edit modules on any track | medium |
| 5 | Persistence of movy chains (state blobs) | sets survive reopen | medium |
| 6 | Mixer (gain/pan/mute) + CPU policy | balance, overload protection | medium |

Stage 2 being silent is deliberate: the UI, LEDs, engine, persistence and
dual-kind tests all land and are verifiable before any real-time audio risk is
taken.

**If stage 3 fails** — if 12 chains prove unaffordable even lazily — stages 1-2
and 4-6 still stand and movy tracks remain MIDI-only. The design is staged so
that outcome is a limitation, not a rewrite.

Each stage gets its own implementation plan in `movy/plans/`.

---

## 9. Open questions

Deferred deliberately; none block stage 1 or 2.

- **The CPU cap's actual number.** Comes from stage 3's measurements, not from
  guessing here.
- **Do movy tracks need their own volume gesture, or does the existing
  track-hold + volume encoder extend?** The current gesture diverts CC 79 from
  Move; a movy track has no Move counterpart to divert from.
- **Group-level operations** (mute a whole group, copy a group) — not requested,
  not designed. Listed so the omission is on purpose.
