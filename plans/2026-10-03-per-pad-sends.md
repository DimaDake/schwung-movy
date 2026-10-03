# Per-pad sends → movy SEND 1 / SEND 2

Approved in chat 2026-10-03.

## What exists

A splittable drum module publishes `split_voices` + `move_plugin_render_split`
and, optionally, `voice_send_params` (`["{id}_send_a","{id}_send_b"]`). Schwung's
chain host — which IS every movy track (`chain_host.rs`) — already polls those
levels, renders a voice with a non-zero level into its own pool buffer, and
exports `chain_drain_sends(inst, accum[], n_sends, frames, volume_0_127)` to sum
them into a caller's accumulators. The shim calls it for schwung's slots; movy
never did, so a Simian / DR32 pad's Send A/B knob did nothing in movy.

Fleet (each module's origin, 2026-10-03): **Simian** and **DR32** only. Surge,
Weird Dreams, Forge, MiniJV, Mono Voice, Osirus have "send" params that feed
their OWN internal FX — not host-routable.

## Design

- Send A → SEND 1 (bus 0), Send B → SEND 2 (bus 1). SEND 3 stays MIX-page-only
  (the module contract caps at two).
- Additive to the track's own SND1/SND2, post-fader + post-pan at the track's
  `channel_gains` (movy's send rule), pre-insert (schwung's per-voice rule).
- Each chain drains into a PRIVATE 2×128-frame scratch on whichever thread
  rendered it (`volume = 127`; movy applies its own fader). Only when the synth
  rendered this block — `voice_send_mask` is only cleared by a render, so a
  sleeping chain drained would resend its last block forever.
- Only chains whose module declares `voice_send_params` drain: a round-robin
  probe asks one chain per block (allocation-free `get_param`).
- Feeder rule (`chain_colo`): a chain whose drained scratch was non-zero in the
  last `VOICE_HOLD_BLOCKS` is a feeder of that bus, so co-location puts the bus
  behind it. Entering/leaving forces a replan. A contribution that arrives for a
  co-located bus the chain is not yet a feeder of is DROPPED for that block
  (writing it would race the bus's lane) — one block at onset.
- Lane path: `Task.voice` drains and taps co-located buses on the lane. Audio
  thread path: after the join, `SendBuses::accumulate_bus`.
- `sndlog` gains `vsnd=<declares mask>/<feeds0>,<feeds1>`.

## Tests

- `voice_send.rs`: hold/feeds/changed rules, declaration parse.
- `render_pool.rs`: a voice task drains only after a real render; taps sum.
- `chain_colo::feeders` includes voice feeders.
- Device: Simian on track 0, pad send A up, track SND1 = 0, send FX loaded →
  `sndlog` bus 0 `in>0`.
