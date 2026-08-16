# Pad-to-sound latency: where it goes and what can be recovered

**Question:** how long between pressing a pad in movy (non-Session) and hearing a
note from a schwung chain module, and what can reasonably reduce it?

**Status:** analysis only — nothing implemented. Budget below is computed from
frame arithmetic in the source, **not** measured on hardware (`move.local` was
offline for this investigation). Treat every number as a model to be validated,
not a stopwatch reading. See [Verifying on device](#verifying-on-device).

Sources: `schwung` @ `b7015e10` (2026-08-01), `movy` @ main, `perf.mjs` run
locally 2026-08-01.

**Since measured on device:** `track-performance.md` §6 has real numbers for the
movy-track pad path, and finds option **#3** below to be the live one — a movy
track spends 2.4 ms of every ~9 ms tick in the chain page's blocking param
refresh, which is added pad latency by the argument in §1.

---

## 1. The path a pad press takes

Four process boundaries between finger and sound:

```
pad → Move firmware → MIDI_IN mmap
        → [SPI ioctl]
        → shim post-ioctl scan → shadow_ui_midi SHM + midi_ready++
        → shadow_ui JS loop → movy onMidiMessageInternal
        → shadow_send_midi_to_dsp → shadow_midi_dsp SHM
        → shim drain → chain DSP → deferred render → mix → [SPI ioctl] → DAC
```

### Frame constants

`FRAMES_PER_BLOCK = 128` @ 44.1 kHz = **2.90 ms per SPI frame**
(`schwung/src/host/shadow_constants.h:43`).

### Per-frame ordering in the shim

From `schwung/src/schwung_shim.c`, one frame runs:

| Phase | Work | Line |
|---|---|---|
| pre-ioctl | `shadow_forward_midi()` — MIDI_IN → chain SHM | `:4695` |
| pre-ioctl | `shadow_mix_audio()` — mixes buffer rendered *last* frame | `:4700` |
| pre-ioctl | `shadow_inprocess_handle_param_request()` — serves **one** JS param request | `:4711` |
| pre-ioctl | `shadow_drain_ui_midi_dsp()` — first drain of the JS→DSP ring | `:4816` |
| — | **SPI ioctl** (audio out, MIDI in) | |
| post-ioctl | MIDI scan/filter → `shadow_ui_midi_publish` | `~:7120` |
| post-ioctl | `shadow_drain_ui_midi_dsp()` — second drain | `:7167` |
| post-ioctl | `shadow_inprocess_render_to_buffer()` — renders **next** frame's audio | `:7184` |

Two structural facts fall out of this ordering:

1. **Deferred rendering costs one frame by design.** `shadow_inprocess_render_to_buffer`
   runs post-ioctl and produces audio for frame N+1, which is mixed pre-ioctl of
   N+1 and clocked out during N+1's ioctl. The comment at `:1595` is explicit:
   *"adding one frame of latency (~3ms) but allowing Move to process pad events
   faster after ioctl returns."* This is a deliberate trade, not a bug.

2. **The JS→DSP ring is already double-drained.** Pre-ioctl (`:4816`) and again
   post-ioctl (`:7167`). The comment at `:7163` names the motivation: *"This
   roughly doubles the time window for overtake modules calling
   shadow_send_midi_to_dsp(), reducing the chance of a note being delayed by one
   frame (~2.9 ms)."* **This is the precedent for fix #2 below** — the same trick
   has not been applied to the MIDI *input* path.

### The `shadow_ui` loop

`schwung/src/shadow/shadow_ui.c:2653` — the whole loop is:

```c
while (!global_exit_flag) {
    if (shadow_control->midi_ready != last_midi_ready) {
        process_shadow_midi(...);      // :2672 — ONCE, at the top
    }
    if (jsTickIsDefined) callGlobalFunction(ctx, &JSTick, 0);
    /* display pack ... */
    if (overtake_mode >= 2) usleep(2000);   // :2702 — ~500 Hz ceiling
    else                    usleep(16000);
}
```

**`process_shadow_midi` is called exactly once per iteration, before `tick()`.**
Therefore the interval between consecutive MIDI drains — and so the input
sampling interval — **is movy's tick period**: `usleep(2ms) + tick() work`.

There is no event-driven wakeup. `midi_ready` is polled, not waited on.

### Why the tick period varies

Every `shadow_get_param` is a synchronous busy-wait to the shim, and the shim
services **one param request per SPI frame** (`shadow_ui.c:880`: *"busy-wait to
the shim, serviced once per SPI frame"*, served at `schwung_shim.c:4711`). So
each param read costs 2.9 ms, up to 5.8 ms if it misses the service window.

movy's measured IPC load (`browser-test/perf.mjs`, run 2026-08-01):

- `shadow_get_param`: **max 1 per tick, avg 0.43** (Test 2; helm-scale module Test 3b agrees)
- `host_module_get_param('status')`: every 8 ticks, blocks ~3–5 ms
  (`movy/src/seq/engine.ts:13`, `:21`)
- `host_module_set_param_blocking('cmd', …)`: 1 per tick when the queue is non-empty
  (`engine.ts:52`, perf Test 5)

Sanity check: 205 Hz ⇒ 4.88 ms period ⇒ ~2.9 ms tick work ⇒ ≈ one param
round-trip. Consistent with the measured 0.43 avg plus render/LED/display work.

Observed rates across builds, per movy's own comments: **63, 94, 196, 205 Hz**
(`seq/momentary.ts:11` — *"the device tick rate is not a stable constant (it has
run ~94 Hz and ~205 Hz across schwung builds)"*; 63 Hz seen under load, see
`memory/movy-device-tick-rate.md`).

---

## 2. The budget

At a healthy **205 Hz** tick (4.88 ms period):

| Stage | Mean | Worst | Fixed? |
|---|---|---|---|
| Press → next ioctl picks up MIDI_IN | 1.45 ms | 2.9 ms | fixed |
| **`shadow_ui` loop picks up `midi_ready`** | **2.4 ms** | **4.9 ms** | **addressable** |
| movy handler → `shadow_send_midi_to_dsp` | ~0.05 ms | — | already optimal |
| SHM write → shim drain (double-drained) | ~0.7 ms | 1.5 ms | fixed |
| Drain → deferred render → mix → out the ioctl | 5.8 ms | 5.8 ms | fixed (architecture) |
| **Software subtotal** | **~10.4 ms** | **~15 ms** | |
| Move pad scan + velocity detect + DAC | unknown, likely 3–5 ms | | firmware |
| **End to end** | **~14 ms** | **~20 ms** | |

At a loaded **63 Hz** tick (15.9 ms period), the pickup stage alone becomes
**8 ms mean / 16 ms worst** → total **~20 ms mean / ~30 ms worst**.

### The comparison that matters

Native Schwung pads skip the JS hop entirely: `shadow_forward_midi`
(`schwung/src/host/shadow_midi.c:977`) copies MIDI_IN into the chain DSP's SHM
pre-ioctl, same frame, no JS involved. That is how a normal Schwung slot is
played from the pads.

Native software-side ≈ **7.3 ms** (1.45 + 5.8).

**movy's JS detour therefore costs ~3 ms mean at 205 Hz, ~8.7 ms at 63 Hz — plus
0→16 ms of jitter.** On pads the jitter reads worse than a constant offset.

movy takes the detour because it needs to remap the note before it reaches the
DSP: per-track octave, scale/layout, drum-lane mapping, and the per-track MIDI
channel (`movy/src/keyboard/handler.ts:11`). None of that exists in the shim's
straight-through forward path.

### What is already optimal

movy's handler side needs no work:

- `seqHandleMidi` is two range checks for pad notes before falling through
  (`movy/src/seq/router.ts:87`)
- the pad branch sits early in `onMidiMessageInternal` (`movy/src/midi/router.ts:170`)
- `noteOn` sends to the DSP **before** painting the LED
  (`movy/src/keyboard/handler.ts:16-17`) — correct ordering, don't regress it
- `seqNotePadPlayed` (record capture) runs *after* the DSP send

---

## 3. Options, ranked by benefit

### #1 — Native pad routing table (upstream schwung, big job)

**Recovers the full 3–9 ms and all the jitter.** The only option that reaches
native latency, and the only one that removes jitter rather than shrinking it.

Push a per-slot note-remap table (transpose + channel map) into the shim,
refreshed only when the layout changes (octave, scale, track, drum config), so
movy's pads ride `shadow_forward_midi` like native Schwung pads. JS still
receives the note for record capture — just off the critical path.

Open questions: interaction with `shadow_control->pad_block`; keeping the ledger
in `keyboard/held-notes.ts` authoritative for note-offs (see
`memory/project_movy-note-off-ledger.md` — offs must come from the ledger, never
current state, so a shim-side remap must not be allowed to redirect an off).

### #2 — Second `process_shadow_midi()` after `tick()` (upstream schwung, ~5 lines)

**Best ratio in the list.** The pickup wait is bounded by the gap between
consecutive drains. Draining after the tick as well as before roughly halves it:

- −1.2 ms mean at 205 Hz
- −4 ms at 63 Hz
- halves the worst case in both

The shim already does exactly this on the DSP ring for exactly this reason
(`schwung_shim.c:7163`). Optionally pair with dropping `usleep(2000)` → ~500 µs
for another ~0.7 ms, at some CPU cost.

Stretch version: drain from inside `shadow_param_wait_response` — that busy-wait
is literally where the milliseconds sit — but re-entrancy into JS from within a
param wait needs thought.

### #3 — Suppress blocking IPC while pads are live (movy-only)

**Insurance, not a speedup.** Worth ~0 when the tick is already 205 Hz; worth up
to ~5 ms mean in the loaded 63 Hz case, and it flattens the worst-case spikes.

When a note is sounding or within ~50 ms of a pad press: skip the tick's param
reads and defer the status poll one tick. A knob label refreshing 50 ms late is
invisible; a note 6 ms late is not.

The only item shippable without an upstream PR. Guard it with a `perf.mjs` budget
counting blocking IPC per tick *while a note is held* — Test 2's existing budget
does not distinguish playing from idle.

### Rejected — bulk get for chain slots

`shadow_get_params` exists and explicitly *"collapses N param round-trips into
one"* (`shadow_ui.c:809`), and the shim's bulk handler notes it *"turns ~N×2.9ms
into ~2.9ms"* (`schwung_shim.c:3421`). But `shim_handle_param_bulk`
(`schwung_shim.c:3463`) routes **only** to the overtake DSP
(`overtake_dsp_gen` / `overtake_dsp_fx`) — never to chain slots.

Extending it would be a reasonable upstream feature for other tools. **For movy's
latency it is near-worthless**: perf.mjs measures max 1 `shadow_get_param` per
tick, so there is essentially nothing to batch. Do not spend effort here for
latency reasons.

### Not addressable

- The 2.9 ms SPI frame quantisation (`shadow_constants.h:43`)
- The deferred-render frame — deliberate, buys pad-event responsiveness (`schwung_shim.c:1595`)
- Move's firmware pad scan / velocity detection and DAC output buffering

Together ≈ 7.3 ms software + unknown firmware. That is the floor for **any**
schwung module, movy included.

---

## 4. Verifying on device

None of the above has been measured. Before building anything:

```sh
ssh ableton@move.local touch /data/UserData/schwung/otlp_trace_on
```

Relevant spans (see `schwung/docs/tracing.md`):

- **`js.tick`** — the loop period, i.e. the input sampling interval *directly*.
  Its histogram under real playing load is the single most important number.
- **`param.get`** / **`param.serve`** — where tick time goes; confirms the
  "one param round-trip ≈ one frame" model.

Decision rule:

- `js.tick` steady at ~205 Hz → already near the floor; only **#1** moves the needle.
- `js.tick` dipping toward 63–94 Hz under load → **#3** alone buys most of the win,
  and is free of upstream dependencies.

Trace file lands per `docs/LOGGING.md`; touch-file constant is
`TRACE_TOUCH_FILE` at `schwung/src/host/schwung_trace.c:44`.

---

## 5. Recommendation

1. Measure `js.tick` under load — everything else is contingent on it.
2. Ship **#3** (movy-only, protects the bad case, no dependency).
3. Open **#2** as a small upstream PR — best ms-per-line available.
4. Treat **#1** as the real fix if movy pads should feel like native pads.

Framing note: #1 and #2 are upstream schwung features, not movy patches — see
`memory/feedback_upstream-not-patch.md`.
