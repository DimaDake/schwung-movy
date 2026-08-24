# Tracks 1-4 on movy chains — design + plan

**Goal:** a flag that makes movy's first four tracks use movy's own chains
instead of schwung's four shadow slots, so they join the parallel render.

**Status:** design settled 2026-08-24 (re-address semantics, debug-only flag).

---

## Why

With `chparallel` on by default, movy's twelve chains render across three lanes
while schwung's four slots render serially on the audio thread — which is also
lane 0. Moving those four into movy shortens the critical path.

**Expect ~20-25%, not "four tracks become free".** Twelve chains on three lanes
plus four serial is a critical path of ~8 chain-units; sixteen chains on three
lanes is ~5.3. The host tracks were never on a separate thread, so what is won
is packing, not a core.

This is worth stating up front because the naive version of this argument —
"four serial renders become parallel, so we save four renders" — is wrong by
about a factor of three, and it is the argument that motivated the whole
question.

## What a track loses in movy mode

Not free. Tracks 1-4 in movy mode give up:

- **Move's own mixer fader.** A host track's level is `slot:volume`, a
  chain-host param Move's mixer also sees. A movy track has no Move fader; its
  level lives in movy's summing mixer (`mix`). `volumeKey()` already switches on
  the kind, so this needs no code — but it is a behaviour change.
- **Per-slot Link Audio publish.** `shadow_pub_audio_shm->slots[s]` is indexed
  over the shim's four slots (`schwung_shim.c:1924, 2485`). Movy chains reach
  Link Audio only through the master bus.
- **Cheap param reads.** Host-slot reads are served from schwung's cache — one
  `shadow_get_param` per tick. Movy chain reads block 3-5 ms each and survive
  only by being batched into one bulk round trip per page. Movy's tick period
  IS its MIDI sampling interval, so this is felt at the pad.

## Semantics: re-address, do not migrate

The flag chooses **which host movy addresses**. Nothing moves.

- Schwung's slot keeps its module, untouched. It goes silent because movy stops
  sending it notes, and the shim's own idle gate stops rendering it.
- Movy's chain for that track (0-3) starts empty; the user loads into it.
- Flipping back finds the schwung slot exactly as it was.

Rejected: migrating the module and preset blob across on flip. A module load
blocks the audio callback ~1986 µs, blobs are opaque, and a partial migration
leaves a track half-configured on a live audio path.

## Chain numbering: a track's chain IS its index

Track N is chain N, for all sixteen. Chains 0-3 sit empty until the flag turns
them on.

This was first built the other way — tracks 0-3 appended as chains 12-15, so the
twelve existing movy tracks kept the numbers they had. That was reversed on the
grounds that a mapping with an offset in it is a mapping someone gets wrong, and
`index - HOST_TRACKS` had already produced exactly that class of bug.

**The renumbering needs no state migration, because nothing persisted holds a
chain index.** Checked rather than assumed:

- The saved blob (`ui-state.ts` → `chain-persist.ts`) records a **track** in its
  `t` field. An old set restores `{t: 4}` into chain 4 where it used to restore
  into chain 0 — same module, same track, same sound.
- Automation lanes are keyed by track and store `shortName`/`targetParam`; the
  mapping is applied through a port (`automation.ts`).
- LFO targets are port-mediated too (`lfo-persist.ts`).
- `oct` and `mutes` are per-track arrays.

What DID need updating is device scripts that wrote `ch0:` while driving the UI
on track index 4 — correct under the offset, wrong without it. `test-lfo.sh`,
`test-chains.sh` and `measure-pad-latency.sh` now use `ch4:`. The chain-direct
benchmarks (`measure-chain-idle.sh`, `bench-chain-cpu.sh`) are unaffected: they
address a chain as a chain and never involve a track.

## Tasks

### Task 1: engine capacity

- `chain_slots.rs`: `MOVY_CHAINS` 12 → 16. Every use is a `vec![.. ; N]`, a
  `0..N` loop, or a const-sized array in `midi_out.rs`, so this is the only
  edit. Cost: 4 × 512 B scratch, 4 × 16 `Msg` queue slots.
- Test: `ch15:` parses and `ch16:` does not (`parse_chain_key`).
- Test: any existing test asserting 12 loaded chains still means what it says.

### Task 2: the flag, UI-only

- `flags-def.ts`: `chtracks` / "Movy Tracks 1-4", `min 0 max 1 def 0 bool`.
- `FlagDef` gains `uiOnly?: boolean`. `applyFlagsToEngine` skips those: the
  engine does not care which track addresses a chain, and writing an unknown
  key to it is noise.
- Test: the flag is not among the keys pushed to the engine.

### Task 3: the mapping

- `ref.ts`: `trackKind()` returns `'movy'` for `index < HOST_TRACKS` when the
  flag is on; `chainInstance()` returns the index itself for any movy track.
- `MOVY_CHAINS = 16` beside `HOST_TRACKS`, compared against the Rust constant in
  a test — a track addressing a chain the engine does not have is rejected by
  `parse_chain_key` in silence, and simply never makes a sound.
- Tests: both flag states; no two tracks share a chain in either state; flipping
  off restores every mapping exactly.

### Task 4: flipping at runtime

`src/track/host-mode.ts` owns the transition, in this order:

1. Release every held note **through the ports as they are now** — the ledger
   resolves a track to a port at release time, so a flip mid-hold would send the
   note-off to the wrong host and strand the note on the old one.
2. `resetPorts()`.
3. Re-push the pad route (`syncPadRoute`) — it carries the chain index.
4. Request a label/value refresh so the param page stops showing the other
   host's values.

- Test: a held note flipped across is released on the OLD port, not the new one.

### Task 5: persistence

- `chain-persist.ts`: capture/restore loop from 0, not `HOST_TRACKS`. The guards
  are already `trackKind(t) !== 'movy'` and `chainInstance(t) < 0`, and the
  stored record already carries `t` explicitly.
- Test: a set saved with the flag on restores tracks 1-4's chains.

### Task 6: verification

- Screenshot baselines: the flags page gains a row, and the `flags-scrolled`
  scene selects `FLAGS.length - 1`, so both change. Regenerate and eyeball the
  diff before updating.
- Device: load modules into the chains that only exist because of the capacity
  bump, assert they sound (`chpeaklog`) and that the cost report shows them
  rendering.
- Docs: `docs/track-performance.md` §3 currently says "Tracks 1-4 are schwung's
  own slots" as a flat fact.
