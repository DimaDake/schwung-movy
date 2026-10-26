# Stems: freeze tracks, export WAVs, stream over WiFi

Status: PLAN, nothing built. 2026-10-23.
Context: `docs/hardware-limits.md` (CM4 Lite, 4×A72, microSD, stock 64 GB),
`plans/2026-10-23-usb-audio-stems.md` (why USB audio is shelved: on the stock
kernel, sustained dwc2 iso traffic starves CPU-0 interrupt work — SD, WiFi).

Three features, one foundation. All three need the same thing: **each track's
audio, block by block, off the audio thread, stamped with where it is in the
song.** Build that once, then hang three consumers on it.

```
audio thread (core 3)                      engine threads (cores 0-2)
─────────────────────                      ───────────────────────────
chain render ─► [freeze tap: pre-fader]  ─┐
             ─► mixer (fader, pan, mute)  │  StemRing (SPSC, drop-on-full)
             ─► [stem tap: post-fader]  ──┼─► ├─► WavWriter  ─► /data/…/exports, freeze WAVs
                                          │   └─► NetSender  ─► UDP ─► Mac "Movy Receiver"
                                          └──  stamps: sample index, bar/beat, tempo
```

## Decisions taken (owner, 2026-10-23)

- Live monitoring on the Mac is wanted if possible; recording-only is
  acceptable. → the Mac copy will be 20–50 ms late over WiFi; **monitor on
  Move's own outputs**, use the Mac for recording and mixing. A "low latency"
  mode is a stretch goal, not a promise.
- First for the owner, then distributed with movy as a PR.
- Stem tap: **post-fader, post-mute, pre-master** (the track as heard).
  Freeze taps **pre-fader** (the chain's output; fader, pan, sends stay live,
  as in Live's Freeze).

## F0 — Foundation: stem tap + ring (engine, Rust)

- **Where:** `chain_slots.rs::render` already renders every chain into its
  own buffer and mixes after the join (`mixer.rs::mix_into`, post-fader and
  post-pan). The taps go there: one copy of `src` (freeze tap) and one of the
  gain-applied `src` (stem tap) per armed track. Nothing changes in
  `host/` (C): the stems never leave the engine.
- **StemRing:** lock-free SPSC, fixed capacity (~1 s), allocated when a
  consumer arms it, never on the audio thread. Each entry = one 128-frame
  block: header (u64 sample index, bar/beat, tempo, transport flags, a mask
  of which tracks it carries) + interleaved i16. **Full ring → the block is
  dropped and counted, the audio thread never waits.**
- **Zero cost when unarmed:** one atomic load per block.
- **Budget:** ≤ 5 µs/block with 16 tracks armed (16 × 128 × 2 i16 ≈ 8 KB
  of copy) against the ~1737 µs left for tracks. Proven by a `cargo bench`
  on the host and a device measurement (`scripts/measure-stem-tap.sh`, new),
  never by the vdev.
- **Consumer threads** use `threads::leave_audio_core()` like every engine
  thread, SCHED_OTHER, and are the only place I/O happens.
- **Tests:** seq-core/movy-dsp unit tests for the ring (wrap, drop count,
  header continuity), the tap's gains equal `mix_into`'s, and a golden test
  that the summed stems equal the master pre-master-chain.

## F1 — Export WAV stems (first consumer; proves F0 and the SD)

- **Gesture:** arm "Record stems" (a Global page item + a shortcut); it starts
  on the next bar with transport running, stops on stop or on disarm.
- **Output:** `/data/UserData/movy/exports/<set>-<yyyymmdd-hhmm>/`
  with `01 <track name>.wav` … `16 ….wav` (stereo, 16-bit, 44.1 kHz, all
  starting at the same sample), `master.wav` (optional), and
  `export.json` (tempo, time signature, start bar, track names/colours).
  Empty tracks are skipped.
- **Writer:** `WavWriter` thread, 256 KB batched writes, one `fsync` at the
  end, header patched on close (a crash leaves a valid WAV up to the last
  flush: write the RIFF sizes every N MB).
- **SD budget:** 16 stereo tracks = 2.8 MB/s (~170 MB/min). Before arming,
  check free space on `/data` and refuse below a margin; stop cleanly at a
  floor. Design for the **stock 64 GB** card. Device-measure sustained write
  with movy playing (does the SD hold 2.8 MB/s with the saver thread also
  writing?). Ring overflow → a visible "stems dropped N blocks" warning,
  never silence pretending to be audio.
- **Getting the files to the Mac:** schwung's web manager already serves
  `/data/UserData/` on port 7700 (`standalone/launch.sh`), plus scp. No new
  transport needed.
- **Live project (F1b):** generate `<set>.als` (gzipped XML) next to the WAVs:
  16 audio tracks, names, colours, tempo, clips at bar 1. Built from a
  **template saved from the owner's Live version** (the schema is not public
  and changes between versions); a golden test that the generated XML parses
  and references every WAV. Optional later: the tracks' MIDI clips too.

## F2 — Stream over WiFi (second consumer) + Mac receiver

**Wire protocol "movy-stream v1"** (spec in `docs/movy-stream-protocol.md`,
host-agnostic on purpose — see *Schwung* below):
- Control: a tiny TCP session on the Move (subscribe, channel selection,
  start/stop, stats). Move sends **only to a subscriber, unicast**, and only
  while the opt-in setting is on. Discovery: mDNS `_movy-stream._udp`, or
  type `move.local`.
- Audio: UDP, ~20 frames per packet for 34 ch (≤ 1400 B, no IP fragmentation
  on WiFi), header = magic, version, seq, u64 sample index, channels, frames,
  bar/beat + tempo every packet. ~2200 packets/s at 34 ch; fewer channels →
  fewer packets.
- **NetSender** (engine thread, Rust `std::net`): reads the StemRing, packs,
  sends; never blocks the ring (a slow network drops at the sender, counted).
- **Device risk check before building the Mac side:** measure CPU and the
  WiFi interrupt load at 2 / 16 / 34 ch (the USB lesson: CPU 0 carries all
  hardware interrupts). Gate: no audio dropouts, no UI stalls, SD writes
  unaffected. Optionally prototype with JackTrip on the Mac first (zero Mac
  code) to validate the sender alone.

**Mac app "Movy Receiver"** (new dir `mac/movy-receiver/`, Swift + Core Audio):
- Menu-bar app: finds the Move, subscribes, shows per-channel meters, drops,
  latency.
- Writes into a **virtual audio device** (BlackHole 64ch, free/open source;
  Loopback and Pro Tools Audio Bridge also work) → in Live each audio track
  takes input "Movy 1/2", "3/4", …
- **Jitter buffer** (20–60 ms, adaptive) and **clock-drift correction**
  (Move's audio clock vs. the Mac's: a slow adaptive resampler driven by the
  buffer fill — speexdsp/libsamplerate, BSD-licensed).
- **"Record to WAVs" button:** writes stems straight on the Mac from the
  sample index, gaps filled with silence AND logged — F1's output without
  touching the SD.
- Later: a Core Audio Server Plugin ("Movy" as a real 34-in device, no
  BlackHole), or a VST3/AU — only if the app proves the transport.
- Distribution: for the owner, an unsigned build. For the PR, a Developer ID
  signature + notarization is needed (owner's/maintainer's Apple account) —
  open.

## F3 — Freeze tracks (third consumer; most invasive)

Why: `MANUAL.md` — "the CPU runs out … around 6-7 tracks". Freezing trades a
chain's CPU for a WAV in RAM.

- **Freeze:** for each non-empty clip of the track, the engine plays it for
  **two passes** and keeps the second (so reverb/delay tails wrap into a
  seamless loop), from the **pre-fader** tap. While it renders, the track is
  silent in the master and the UI shows progress (real time: Σ 2×clip length).
- Then the chain is **unloaded** (its state is already in `chains.json`) and
  the track plays a **FrozenPlayer**: loops the clip's WAV, locked to the
  clip position from seq-core's clock; fader, pan, mute and sends stay live.
- **Unfreeze:** reload the chain from its saved state, drop the WAVs.
- While frozen, editing notes is refused with a toast (as Live does),
  or unfreezes first — owner's choice.
- **Persistence:** the ENGINE owns it (CLAUDE.md: the engine writes the Set
  files). Freeze WAVs live in the Set's directory; `seq-state.json` records
  which clips are frozen; version history references them, never copies
  (`set_gc.rs`, `version_store.rs`); `docs/persistence-hazards.md` read first.
- **RAM:** a 16-bar clip at 120 BPM ≈ 5.6 MB stereo i16. Cap per track and
  per Set, state it in the UI; 1.85 GB total, no swap.
- **Proof it is worth it:** device measurement of a track's µs before/after
  freeze (`bench-chain-cpu.sh`), e.g. obxd 4 notes vs. its FrozenPlayer.

## Schwung: can it use the same system?

**The Mac side and the protocol: yes, unchanged.** The receiver does not care
who sends. **The sender: not as-is** — schwung's audio lives in its C shim
inside Move's process, not in movy's Rust engine. So:
- `docs/movy-stream-protocol.md` is written host-neutral, plus a small
  header-only **C reference sender** (`ring + UDP`) with no movy dependency.
- Offered upstream as a schwung PR, per CLAUDE.md rule 2 (never a local
  patch). Under schwung it could stream its slots and the whole mix; per-track
  audio of Move's NATIVE tracks is not reachable (Link Audio ring, see
  `plans/2026-08-11-audio-tracks-fx-chain-feasibility.md`).

## Order, gates, docs

| phase | what | gate |
| --- | --- | --- |
| F0 | tap + ring, tests, µs | `npm test`, cargo tests/bench, **device tier** (audio thread) |
| F1 | WAV export | device tier (SD I/O, perf); 30-min soak at 16 tracks |
| F1b | `.als` | golden test + opens in the owner's Live |
| F2a | NetSender + device load test | device tier; 30-min soak, no dropouts |
| F2b | Mac receiver | manual: Live records 16 stems aligned with F1's WAVs (null test) |
| F3 | freeze | device tier + measured CPU win |

Every phase: perf test (`perf.mjs` for any UI), `MANUAL.md` section + controls
table, README bullet when it lands, commit says which tier gated it. Files
≤ 200 lines (src) as usual.

## Owner's answers (2026-10-23)

1. **Live 12 Suite** — the `.als` template is saved from Live 12.
2. **Order after F0: freeze (F3) → export (F1/F1b) → WiFi (F2).** So F3 is
   built on F0 directly; F1's WavWriter is then the second user of the
   freeze path's writer, not the first.
3. **A frozen track must be unfrozen before its notes can be edited**
   (refuse with a toast, as Live does). No auto-unfreeze.
4. Signing the Mac app is movy's (the maintainers') responsibility for the
   PR; the owner has an Apple Developer account for testing.
5. USB spike removed from the box (done).

## Freeze semantics (owner, 2026-10-23)

1. **Tempo change on a frozen track: never blocked.** The loop plays like
   tape at `rate = tempo now / tempo captured` — faster and higher, slower and
   lower, always on the grid (linear interpolation; at the captured tempo the
   captured frames bit for bit). A pitch-keeping time-stretch, as Live's warp
   does, is a later improvement.
2. **Variation (probability, A:B conditions, free LFOs):** one realisation is
   captured (the second pass); freezing warns when the clip has probability
   or conditions. Capturing a whole condition cycle is a later improvement.
3. **Several clips:** only the ACTIVE clip is frozen; launching another clip
   of a frozen track is refused until it is unfrozen. Freezing every clip in
   turn is a later improvement.
4. Editing a frozen track's notes is refused until it is unfrozen (above).

**Built so far (uncommitted, branch feature/stems-freeze):**

- `movy-dsp/src/freeze.rs` — `LoopMap`, `Capture` (two passes, restarts on a
  position jump, silence for idle-gated blocks), `Frozen`, `Player`
  (sample-exact, drift-free, tape varispeed clamped 0.25-4x).
- `movy-dsp/src/freeze_bank.rs` — per-track stages Idle -> Capturing ->
  Frozen -> Thawing -> Idle, the param snapshot, the status mask.
- `seq-core` `Engine::loop_position` (exact to 1e-6 tick over 2000 blocks)
  and `Engine::play_alone` (the silent pass).
- `chain_slots.rs` wiring: a frozen/thawing chain gets `Work::NONE` (that is
  the CPU win) and its loop is mixed/metered/sent like a chain's block (no
  co-located lane skip for it); the capture taps `scratch` after render,
  before the mix; at two passes the chain's `<comp>:state` and LFO params are
  snapshotted and its modules unloaded through the LoadQueue, `desired`
  untouched, so `get_param` (hence a save) answers from the snapshot; a thaw
  re-queues every component WITH its preset, keeps the loop until the
  track's loads are through, then re-applies the LFOs. A whole-Set replace
  clears it all.
- `lib.rs`: `frz` / `unfrz` / `frzx` <track>; refusals `noclip`,
  `notplaying`, `nochain`, `busy`; per-block positions; the silent pass (the
  output zeroed, the transport stopped when the capture ends); status
  ` frz=<hex mask> frzc=<track>:<pct>|- frze=<seq>:<track>:<code>`.
  **ENGINE_VERSION 0.104.0** (both sides).
- Tests: freeze 11, freeze_bank 6, chain_slots 2, seq-core 2. movy-dsp
  447/447, seq-core 313/313.

**Not yet:** the UI (Shift + double tap, the FREEZE/UNFREEZE dialog,
FREEZING n%, refusal toasts, the blocks on note edits / clip launch / chain
edits of a frozen track, cancelling a capture on an edit to its track),
persistence (frozen flag + WAV beside the Set; until then a reopened Set
simply comes back unfrozen with its chain — safe), and the device run.
Known edge to handle in the UI: pressing Play during a silent pass restarts
the capture (position jump) and the output stays muted until it ends.

## Side-by-side dev install ("Movy Dev")

The owner keeps the store's movy untouched and tries this branch as a second
tool:

- `MOVY_ID=movy-dev ./scripts/deploy.sh` → `tools/movy-dev/`, module.json
  id `movy-dev`, name "Movy Dev", **no `boot_target`** (Tools menu only; it
  can never be what the box boots into). `src/platform/variant.ts` derives
  the install dir and the Set library from the build-time id; the library is
  `UserLibrary/Movy-dev` (seeded once as a copy of `UserLibrary/Movy`, the
  original never written).
- Only one movy-host runs at a time (each takes over the device), so the two
  do not race; schwung-heal blesses `tools/*/bin/heal`, so RT works for both.
- **CAUTION — the gates still target `tools/movy`.** `npm run test:device`,
  `run-gate.sh device` and the vdev tier deploy to `tools/movy`, i.e. they
  would replace the owner's normal movy with this branch. Until the harness
  honours `MOVY_ID` (an F0 task), after any device-tier run on this branch
  redeploy main to `tools/movy` (or run the device tier only with the
  owner's OK).
