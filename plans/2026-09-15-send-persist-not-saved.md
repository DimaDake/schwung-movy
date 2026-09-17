# A send FX is never in the set the engine reports

**Status:** implementing 2026-09-15
**Bug:** a send FX bus does not survive a reopen. The module and its patch are
gone, and every Set file movy has ever written says `"sends":[]`.

## The failure

A send's module is stored in the engine, so the only way it reaches a Set file
is the document the engine answers with — `chain_set()`
(`engine/crates/movy-dsp/src/chain_slots.rs`), built by walking **`self.desired`**,
the "what was asked for" list that exists so a save taken mid-drain still
reports the whole set.

`desired` is sized to tracks:

```rust
desired: vec![Vec::new(); MOVY_CHAINS],   // 16 — RENDER_SLOTS is 19
```

And `request_send_load` deliberately bypasses it: it pushes a `LoadRequest`
onto the shared queue under `send_index(bus) = MOVY_CHAINS + bus` and touches
`desired` not at all. The live instance lives in its own array, `send_slots`.

So the document is send-blind, and so is everything derived from it:

| producer | source | result |
| --- | --- | --- |
| `chains` param GET → `readChainDoc()` | `desired` | no `16|fx1|…` triple |
| engine's `chains.json` (`engpersist` on) | same | same |
| `captureSends()` (`src/track/send-persist.ts:67`) | that doc | `[]` |
| `parseMirror()` (`src/track/chain-mirror.ts:51`) | chains.json | `[]` |

`serializeUiState` therefore writes `"sends":[]` forever.

**The restore direction is broken in the same place.** `restoreChains` does
append the sends to the document it writes (`chain-persist.ts:193`), but
`set_chain_set` routes every entry through `request_load`, which returns
immediately for `slot >= MOVY_CHAINS`. A send *named* in a Set file is dropped
at the door — silently, which is why nothing ever failed loudly. So a send
could not be saved, and would not have loaded if it had been.

## Evidence

Two host tests, added first and watched fail (`cargo test -p movy-dsp`, 328
pass / 2 fail):

```
a_send_bus_is_part_of_the_set_the_engine_reports
  left: Some([])   right: Some([Entry { slot: 17, component: "fx1", module: "mverb" }])
applying_a_set_queues_the_sends_it_names
  left: 0          right: 1
```

## Why it was never caught

Not the engpersist migration — the feature was born broken, two weeks earlier:

| date | commit | what it did |
| --- | --- | --- |
| 08-29 | `60adf95` | the chain set becomes one document; `desired` created at `MOVY_CHAINS`, `chain_set()` built from it |
| 09-05 | `3ff4f9a` | send FX buses render; `request_send_load` added — queue-only |
| 09-05 | `9db6096` | **same day** — send persistence lands, written against document slots `>= MOVY_CHAINS` |
| 09-12 | `59e0bcc`…`7b2d2c1` | `engpersist`; `chain-mirror.ts` grows a *second* send reader for a file that can never hold one |

`git log -S desired -- chain_slots.rs` returns two commits: the one that
created it, and an unrelated device-suite commit. No commit ever put a send
into `desired`. At `9db6096` the engine already answered `Some(self.chains.chain_set())`.

Its header comment appeals to "the engine already expects a bus at
`MOVY_CHAINS + n` (`send_queue_slot`)" — true of the LOAD path
(`snd<n>:module` → `request_send_load`), which is why sends are audible, and
false of the document path.

Three things kept it invisible:

- `browser-test/logic/mixer.mjs:310` feeds `sendsFromDoc` a **hand-built**
  doc. It pins the parser and can never see that the engine does not emit it.
- `tracks-chain.mjs:179` feeds `restoreChains` a hand-built `SendState[]` —
  the write direction only.
- The sends device scenario (`test-device/scenarios/sends.ts:277`) drives
  `snd0:module`, i.e. audio routing, not persistence.
- `test-device/scenarios/master-fx.ts:239` states the false belief in prose:
  *"the sends are movy-hosted and persist by a different route"*. There is no
  different route.

## There is nothing to migrate

The old-saving paths are structurally sound — they have simply never carried
send data:

- A blob with no `sends` key (anything before 09-05) → `undefined` →
  `sendTriples` returns `[]` → the document names no sends → the engine unloads
  the previous Set's. Correct for a Set that never had one.
- A blob *with* `sends` → every one is `[]`; `captureSends` never saw a triple.
- Rename / duplicate / version history ferry `ui-state.json` **verbatim**
  (`set-session.ts:131,149`, `version-capture.ts:55`), so `[]` travels intact.
- The move-my-tracks migration (`src/track/migrate.ts`) is about chains in
  schwung's slots; sends were never there.

**Consequence:** Sets saved before this fix must have their send FX re-added by
hand. The module and its patch are not in the file, in any copy of it.

## The fix

`desired` becomes the one list of what was asked for, sends included. No UI
change: `sendsFromDoc`, `sendTriples` and `sendPayloadPairs` were written
against this contract all along.

1. `desired: vec![Vec::new(); RENDER_SLOTS]`.
2. `request_load`'s guard `slot >= MOVY_CHAINS` → `>= RENDER_SLOTS`.
3. `request_send_load` routes through `request_load(send_index(bus),
   SEND_COMPONENT, module)`, so a send gets the same bookkeeping — and the same
   one-off-drain rule it already had, which is why it rode the shared queue.
4. `chain_state::restore` routes `slot >= MOVY_CHAINS` to
   `set_send_state(bus, blob)`. Without it a restored send comes back at the
   module's shipped defaults — the "my filter reopened" data loss, one page out.
5. `loaded_report` reads `send_module(bus)` for those slots. Its live read is
   `slots[slot]`, which holds nothing above `MOVY_CHAINS`, so a loaded send
   would report `16:fx1=mverb?` — the `?` meaning "asked for, never
   instantiated", which is exactly the false evidence that read-back exists to
   prevent.

Nothing else changes: `service_loads` already dispatches `slot >= MOVY_CHAINS`
to `service_send_load`; `teardown` already clears all of `desired` and every
`send_slots` entry; `mix_csv`/`get_param` are `.get`-based, so a send's mix and
LFO fields serialize as `""` by construction.

Two consequences worth stating because they are the point of the design:

- The unload direction arrives for free — a document that names no sends is
  now `request_load(16..18, "fx1", "")`, so a send stops outliving a switch the
  way a chain module once did.
- `desired` reports REQUESTED, so a save taken while the restore is still
  draining names the sends. That is what makes the capture safe to run at any
  moment, and it is why the document does not need the payload wait a track's
  blob does.

## Tests

Match the bug, cheapest level first:

- **Engine (the proof, already red):** the two tests above, in
  `chain_slots.rs`. These have teeth — they fail on the current tree.
- **Engine (the state hop):** one test that a restored send's preset rides the
  load it was queued with, read back through `queue.take_one()`.
- **Cross-language:** extend the golden chain-set document in `chain_state.rs`
  and its TypeScript twin (`browser-test/logic/set-state.mjs`, and the mirror
  `doc` in the same file) with a send record at `MOVY_CHAINS + 1`. This does
  not have teeth for this bug — `parseMirror` already handles sends — it pins
  the slot arithmetic both halves agree on, so a change to the send slot
  number breaks both sides.

The device tier is the integration gate.

## What implementation changed against this plan

Three things the plan did not call, found while making it green:

- **`set_chain_set` needs a component filter.** Widening `request_load`'s guard
  to `RENDER_SLOTS` makes a bus slot loadable from *any* document, so a
  hand-written or corrupted one could put a bus's slot under a component that is
  not `fx1` — `snd0:<component>` addresses nothing the send host knows. The
  set's decoded records are filtered to `component == SEND_COMPONENT` for those
  slots (`a_document_cannot_load_a_bus_under_another_component`).
- **The two out-of-range tests were pinned to the wrong boundary.** Both used
  `MOVY_CHAINS` (16) as the canonical impossible slot, which is now bus 0's
  legal slot, so the fix turned them red. They moved to `RENDER_SLOTS` and now
  pin the boundary from both sides — the last bus *is* loadable, one past it is
  not. That is a better test than either had before: the old pair only knew
  where the edge was not.
- **`SEND_COMPONENT` became `pub(crate)`** and `bus_of_slot` was added as its
  inverse, so `chain_state.rs` names the slot arithmetic in one place instead of
  re-deriving `slot - MOVY_CHAINS` inline.

The state-hop test was proven to have teeth the same way as the originals: with
the `restore` routing disabled it reads `None` where it wants the patched load.

The plan's cross-language item is a **contract pin, not a regression test** —
`parseMirror` already handled sends, so the new `ui.sends` assertions in
`set-state.mjs` pass on the unfixed tree. They exist so the send slot number is
written from `sendDocSlot`/`send_index` on both sides and a change to it breaks
the engine and the UI at once.

## Follow-up, 2026-09-16 — the half this plan got wrong

"Nothing else changes: … `mix_csv`/`get_param` are `.get`-based, so a send's mix
and LFO fields serialize as `""` by construction" was written in this file as a
reassurance, and it is exactly where the second bug was hiding. `mix_csv` and
`lfo_state` read through `get_param` and are *right* to — a bus has no mixer
triple and no LFOs. `serialize` reads the **preset blob** through the same
accessor, and there the emptiness is data loss: `get_param` is `.get`-based over
`slots`, which holds `MOVY_CHAINS` entries, so a bus's slot indexes past the end
of it.

So the engine's `chains.json` recorded every send with an empty fourth field,
`chain-mirror.ts` carried the absence into `ui-state.json`, and `restore`'s
`if !c[3].is_empty()` guard skipped `set_send_state` on open. The module came
back; its knobs did not. `engpersist` is on by default, so this is every Set the
fixed build wrote.

The lesson worth keeping: two callers telling the truth about empty fields made
the third, which was losing data, read as the same pattern. `bus_of_slot` now
selects the accessor explicitly in `serialize`, so the bus branch and the track
branch are named rather than inferred. §8a of `docs/persistence-hazards.md`
carries the record. Test: `a_live_sends_preset_reaches_the_file` (reads `""`
with the fix reverted), which asserts both the blob in the file and the queued
load that gets it back.

**Still uncovered on device**: nothing in `test-device/` saves a Set holding a
send and reopens it, so both halves of this were found by hand — the second one
by the user opening a Set. `sends.ts` drives `snd0:module`, i.e. audio routing.
That is the gap worth closing next.

## Device tier, 2026-09-15 — one red check, and it is not this one

`npm run test:device` on this worktree: **130 checks, 1 failed.**

```
✓ sends            14 checks    ✓ migrate  11    ✓ versions  8    (…13 more green)
✗ smoke            refresh-blocking — refresh blocking 19 ms max, 1 sample over 10 ms
```

**`smoke#refresh-blocking` is pre-existing and unrelated.** The check asserts that
*every* `perf_refresh_ms` sample is ≤ 10 ms. That value is a `Date.now()` delta
around one param GET on the shadow-UI QuickJS thread, which is **not realtime**:
it counts descheduled time and time spent waiting behind the audio thread, which
a cold module load holds for up to 428 ms (`chain_state.rs`'s own note). Measured
on a healthy device on 2026-09-13, before this work: 424 samples, 5 over 10 ms,
worst 458, each beside a `perf_ipc peak_period` of 239–351 ms. This run shows the
same signature — `perf_refresh_ms=286 params=0` beside `peak_period=300` — and a
same-window trial asserting the median instead gives **median 5 ms, worst 19 ms**
(one GET is ~3 ms by the check's own comment).

This change is not in that path: the diff is engine-side, and the metric is a UI
thread measurement.

The window is also thin — 3 of 10 samples had `params>0`, and a `params=0` sample
measured nothing at all. The ~1 s sample cadence races a sub-second pre-jog phase,
so the samples that would have measured the module mostly do not exist; back-to-
back runs gave 0 of 4. **The window should be taken before the jog**, which is
what the 09-13 note already prescribed. That is a scenario change (it moves what
`smoke` measures), so it is left alone here. `smoke.ts` is unmodified by this
commit. `ENGINE_VERSION` unchanged — the wire format does not move.
