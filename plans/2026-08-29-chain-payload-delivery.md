# Chain payload delivery: stop losing a set's patches to a 100 ms timeout

## The bug

Device log, 17:06:45, opening set `0ce52a9f…`:

```
45.324  [chain-v2] Loading synth: .../obxd/dsp.so     ← blocking dlopen, AUDIO thread
45.419  chains: track 1 presets not delivered
45.527  chains: track 2 presets not delivered
45.634  chains: track 3 presets not delivered
45.742  chains: track 4 presets not delivered
45.752  chain 0: load blocked 428 ms
45.765  chain 1: synth = aphex                        ← loads with NO state
```

`restoreChains` writes the chain-set document (acknowledged, 500 ms, retried),
which **queues the module loads**, and then writes each track's payload — the
preset blob, the two LFOs, and the mixer triple — with `setMany`. That second
write goes through `shadow_set_params` → `shadow_param_bulk_js`, which uses
`SHADOW_PARAM_DEFAULT_TIMEOUT_MS` (100 ms, `shadow_ui.c:743`) unconditionally and
does not retry. The shim services that mailbox on the audio thread, which is by
then inside obxd's 428 ms `dlopen` + 128-preset bank scan. All four writes time
out and every module comes up at its shipped defaults.

Twenty occurrences in one day's log.

Two consequences, the second worse than the first:

1. The chains sound wrong — hush1's filter reopens (`cutoff` default 0.55),
   aphex comes up at `lpf_cut` 0.6 / `lpf_reso` 0.2.
2. **The patch is then destroyed on disk.** `captureChains` reads the live chain,
   which is now at defaults, and the next forced save (a set switch, a teardown)
   writes those defaults into the set file. `lastBlob` does not help: it only
   covers a read that FAILS, not one that succeeds and returns defaults.

## Why the timeout cannot simply be removed

`shadow_param_t` (`shadow_constants.h:509`) is a single-slot mailbox, CAS-claimed
because two processes share it, serviced once per SPI frame by the audio thread.
A synchronous request on it must have a bound or the UI hangs whenever that
thread wedges. Removing the timeout needs either an async queued channel or
module loads off the audio thread — both schwung-side, and `load_queue.rs`
already names the second as "a much larger change". Raised upstream separately.

What we can do is make a timeout cost milliseconds instead of the user's patch.

## Why not fold the payload into the document

Considered and rejected. One bulk write cannot carry it: `SHADOW_BULK_MAX_ITEMS`
is 64 items (32 pairs) and a full set needs ~27 pairs *per track*. Folding the
blobs into `chain_doc` itself would work but changes the wire format between
`ui.js` and `dsp.so`, which ship as a pair but deploy separately — a mismatch
decodes as "malformed document" and unloads the whole set. Not worth it when the
loads themselves tell us when the channel is free.

## The fix

Deliver the payload **after** the loads have drained, when the mailbox is known
to be free, and never write a capture from a chain whose payload has not landed.

1. `restoreChains` sends the document as before, then **arms** the per-track
   payloads instead of firing them into the blocked window.
2. `settleTick` already waits on `statusSeq() > baseSeq && chainPending === 0` —
   loads drained, and not a stale mirror. That is exactly the moment the write
   can land. Deliver there, retry per tick, and do not promote the Set to
   playable until it lands or the attempt cap fires. This is strictly stronger
   than today, which promotes with the modules at defaults.
3. `captureChains` returns the **saved** entry verbatim for any track still
   pending, so a save taken in that window rewrites what is already on disk
   rather than the defaults the chain is sitting at.

On give-up the capture guard stays armed: the chains are audibly wrong and the
user can see that, but the set file keeps the patches. Preserving data beats
recording the failure.

## Files

- `src/track/chain-payload.ts` — new: the armed payloads, delivery, retry, guard.
- `src/track/chain-persist.ts` — arm instead of fire; capture prefers pending.
- `src/seq/set-session.ts` — drive delivery from `settleTick`.

## Tests

- `browser-test/logic/tracks-chain.mjs` — payload is not written during the
  restore; lands on delivery; a refused delivery is retried; **a capture taken
  before delivery returns the saved blob, not the live default** (the data-loss
  assertion — it fails if the guard is removed).
- `browser-test/logic/set-settling.mjs` — the Set does not go ready while a
  payload is outstanding, and does go ready once the cap fires.

Teeth: remove the guard and the capture test must fail; remove the deferral and
the "no payload write during restore" test must fail.
