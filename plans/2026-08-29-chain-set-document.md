# The chain set is one document the engine owns

**Status:** design, approved 2026-08-29
**Bug:** after a power cycle a set's sequences survived but tracks 2-7 had no
modules. Reproduced from the device log; see "Evidence" below.

## The failure

`restoreChains` transmits a set's chains as ~16 independent messages
(`ch<N>:<comp>:module`, then `ch<N>:<comp>:state`, then the LFO keys), each a
`host_module_set_param_blocking(..., 50)`. That call reaches
`shadow_set_param_common`, which returns 0 when the shim does not service the
request inside the timeout. The shim services param requests on the audio
thread — the same thread that performs a chain load's blocking `dlopen`. A
cold load costs 78 ms here and 276 ms has been observed, so a 50 ms write
issued during the drain **cannot** be serviced.

Nothing checks the boolean. `restoreChains` counts the write as restored and
logs the number it *asked* for.

The loss is then made permanent: `captureChains` reads back what actually
loaded, and `ui-state.json` is written from that read. Each open ratchets the
set down.

### Evidence (device log, 2026-08-28)

```
19:43-19:57  user loads noisemaker into chains 0-9        -> 10 live
20:34:38     set reopen  -> "chains: restoring 10"
             engine loaded 0,4,5,6,7,8,9                  -> 7   (1,2,3 lost)
20:37:21     user adds chain 10                           -> 8 on disk
20:40:30     power-on    -> "chains: restoring 8"
             engine loaded 0,7,8,9,10                     -> 5   (4,5,6 lost)
20:41        autosave rewrites ui-state.json with those 5
```

Between chain 0 and chain 7 at 20:40 there are 295 ms with no `[chain-v2]`
activity at all. The engine drains one queued load per audio callback (~3 ms),
so a silent queue proves the requests never arrived. **The loss is on the
delivery hop, not in the engine.** The queue is not the problem and is not
being changed.

Two things kept this invisible: the SET path in `shadow_ui.c` records no
give-up statistics (only GET does), and movy's own log line reports requested
loads rather than delivered ones.

## The fix

Make the chain set **one atomic, acknowledged, retryable message in each
direction**, owned by the engine.

### Engine

`ChainSlots` gains `desired`: the chain set as last *requested*, not as last
*loaded*.

- `set_param("chains", doc)` — parse, diff against `desired`, clear what is
  gone, queue what is new. Subsumes what `clearChainsNotIn` and
  `restoreChains` did as two separate passes over the wire.
- `get_param("chains")` — serialise `desired`.
- `request_load` is the single place `desired` is updated, so a module loaded
  from the browser, by undo, or by a remote param write keeps it current —
  the same reasoning that already put `generation` there.

`desired` is authoritative the instant the write lands, so a save taken while
dlopens are still draining still reports the full set. **A partial chain set
stops being representable.**

The queue, the one-load-per-callback rule, and the audio path are untouched.

### Wire format

The length-prefixed bulk format the shim already speaks
(`<count>\n<len>\n<bytes>...`), as flat triples `slot, component, module`.
Not JSON: `movy-dsp` has no serde, and preset ids never need escaping. The TS
side already has an encoder/decoder (`src/track/bulk.ts`) with tests.

Ordered by slot, then by `CHAIN_SLOTS` order, so the serialisation is stable
and a comparison between two documents is meaningful.

### UI

- `restoreChains(saved)` — encode, one `setParamTimeout('chains', doc, 500)`,
  retry once on `false`, log requested vs acked. The per-track loop and
  `clearChainsNotIn` are deleted; `resetUiState` clears by sending the empty
  document.
- `captureChains()` — one `getParam('chains')`, then one `getMany` per loaded
  track for the preset blobs and LFO keys (unchanged; they ride the existing
  `attach_state` path).
- Blobs and LFO state are written as one checked `setMany` per track instead
  of one write per key.
- **A capture never writes a worse copy than it holds.** If a blob read
  returns null for a component that had one last time, the previous blob is
  kept rather than dropped. Same rule as the document itself, one level down.

`ui-state.json`'s format does not change — no migration.

### Not doing

Loading modules synchronously at startup behind the "Loading Movy" screen. It
does not address the failure (the writes never reached the engine), and
eleven cold `dlopen`s inline is roughly a second of blocked audio callbacks on
Move's own thread.

## Testing

- **Rust:** document round trip, malformed input, diff that adds / replaces /
  removes, and `desired` surviving a load that has not been serviced yet.
- **Logic (mock port):** a `setParam` that returns `false` makes `restoreChains`
  report failure rather than success; a capture whose blob read fails keeps the
  previous blob.
- **Device:** open the same set three times and assert the chain count in
  `ui-state.json` is stable. This is the reported bug: the current code
  degrades 11 -> 8 -> 5, so the test has teeth by construction.

`ENGINE_VERSION` 0.48.0 -> 0.49.0; needs a `dsp.so` + `ui.js` deploy.
