# Track volume gesture — hold track button + master volume knob

**Status:** implemented 2026-07-25
**Scope:** movy only. No schwung changes.

## Goal

Hold a track button and turn the master volume knob to set that track's schwung
chain-slot volume (`slot:volume`, 0–4 where 1.0 = unity), with a slider overlay
showing the value.

## Why it isn't just "read CC 79 and write the param"

Two shim behaviours constrain the design. Both were read out of
`schwung/src/schwung_shim.c` and confirmed on device.

### 1. CC 79 always reaches Move firmware

The overtake input filter (`schwung_shim.c:5696`) blocks everything Move-bound
except three things:

```c
if (status >= 0x80) filter = 1;                 /* block all cable-0 MIDI from Move */
if (d1 == CC_MASTER_KNOB) filter = 0;           /* ...except the volume knob turn */
if (d1 == 8 /* master touch */) filter = 0;     /* ...and its touch note */
if (overtake_passthrough_ccs[d1]) filter = 0;   /* ...and opted-in buttons */
```

`button_passthrough` can only *un*-block, never re-block, so a tool cannot hide
CC 79 from Move. Movy declares `claims_master_knob: true`, which stops the
schwung *host* from consuming the knob (`schwung_host.c:667`) but has no effect
on this filter. Left alone, every detent of our gesture also moves Move's
**master** volume.

The fix is to change what Move does with the CC rather than whether it sees it.
Move's own native gesture is track-hold + volume knob (the shim protects it at
`schwung_shim.c:5265`: *"adjusting a track's volume never opens the shadow UI"*),
but movy owns CC 40–43 in overtake, so Move never sees the hold. Movy injects it:

```js
move_midi_inject_to_move([0x0B, 0xB0, 43 - track, 127])   // press
move_midi_inject_to_move([0x0B, 0xB0, 43 - track, 0])     // release
```

`move_midi_inject_to_move` (`schwung/src/shadow/shadow_ui.c:2138`) writes into
Move's MIDI_IN, and the drain runs *after* all filtering
(`shadow_midi.c:530`), so injected events are not subject to the overtake
filter. With the hold established, Move routes CC 79 to its own track volume and
master volume stays put.

**Injection timing is the whole ballgame.** It must happen on track-button
**down**, before the knob is touched.

The first implementation injected on master-knob *touch* (reasoning that a lone
capacitive note is a quiet frame for the drain, which defers while any hardware
MIDI is present). On device that moved the slot volume *and* Move's master
volume together: Move decides what the volume knob targets when the touch
arrives, so a hold injected in response to that touch is already too late.
Pressing first reproduces Move's own ordering — hold the track, then touch.

The divert is held for the whole track press, not the touch, so releasing and
re-touching the knob mid-hold does not drop Move back into master-volume mode.
The cost is that an ordinary track switch in movy now also moves Move's selected
track, which is invisible under overtake.

Per-detent injection is not viable either way: the drain cannot land packets
during an active turn.

### 2. Movy cannot draw while the volume knob is touched

`shadow_swap_display()` (`schwung_shim.c:3262`) hands the OLED back to Move
firmware for the duration of a volume-knob touch, in overtake too:

```c
if (shadow_volume_knob_touched && !shadow_shift_held) {
    /* Let native Move volume overlay show while volume touch is held. */
    display_phase = 0; display_hidden_for_volume = 1; return;
}
```

`!shadow_shift_held` is the escape hatch. So the gesture has two visual modes,
and movy's code is identical in both:

- **No Shift** — Move owns the screen and draws its native track-volume overlay.
  Movy still writes `slot:volume` behind it.
- **Shift held** — the swap is skipped, movy keeps the screen and draws its own
  slider showing the schwung slot value.

Movy draws the overlay whenever the gesture is live. Without Shift that frame is
simply never pushed to the panel, so no gating on Shift is needed in movy.

## Behaviour

- **Arm:** track button down (CC 40–43) records the held track. Existing
  behaviour (momentary track switch, Mute+track) is unchanged.
- **Divert:** master-knob touch (note 8) while a track is held injects the
  track-hold into Move and reads the track's current `slot:volume`.
- **Adjust:** each CC 79 detent moves the value by 0.05, clamped to 0–4, written
  with `shadow_set_param(track, 'slot:volume', v.toFixed(2))`. The first detent
  marks the momentary as gestured, so releasing the track button reverts the
  view instead of latching it.
- **Release:** touch-off or track-button-up injects the track-hold release.
- **Overlay:** `T<n> VOLUME`, a 0–400% bar with a tick at unity, and the numeric
  percentage. Visible while a track is held and the knob is touched.

CC 79 arrives raw (1–63 clockwise, 65–127 counter-clockwise) — it is outside the
71–78 range that shadow_ui re-encodes and accumulates, so movy decodes it itself.

## Files

| File | Role |
|---|---|
| `src/mixer/track-volume.ts` | gesture state, delta decode, param I/O, injection |
| `src/renderer/volume-overlay.ts` | pure render of the slider |
| `src/midi/router.ts` | wiring: track down/up, master touch, CC 79 |
| `src/app/tick.ts` | draws the overlay on top of the current view |

### Bug fixed in passing

`router.ts` mapped note 8 to `JOG_TOUCH`, but note 8 is `MoveMasterTouch` and
note 9 is `MoveMainTouch` (`schwung/src/shared/constants.mjs:511-512`) —
`appState.jogTouched` was being driven by volume-knob touch. Since the display
is swapped away to Move during exactly that touch, the jog toast it gates could
never have been visible. Corrected to note 9, with note 8 now feeding this
gesture.

## Tests

- `logic.mjs` — delta decode, 0.05 step, 0–4 clamp, param writes, injection
  packets (press on touch, release on touch-off and on track-up), overlay
  visibility, first-detent gesture marking.
- `screenshot.mjs` — `track_volume_unity`, `track_volume_min`, `track_volume_max`.
- `scripts/test-volume.sh` — device e2e: the handler applies 0.05/detent, the
  value lands on the chain slot (the next run re-reads it at arm time, so its
  starting point is the previous run's result), and movy's divert packets are
  delivered into Move's MIDI_IN (the inject ring's consumer cursor advances).
- `scripts/inject-to-move.py` — device-side producer for the inject ring,
  mirroring `shadow_midi_inject_push()`.

### Verification

Automated (device): the param write, slot read-back across runs, overlay render,
and delivery of the divert into Move's MIDI_IN.

The consequence — master volume staying put — needs a **physical** turn, because
Move ignores synthetic knob input (120 injected detents moved neither
`Settings.json` `globalVolume` nor the set's track volumes). Two signals confirm
it after the timing fix: the user's direct observation, and zero `Master volume:`
lines in `debug.log` across a gesture. That log line comes from the shim's pixel
scan of Move's overlay, which runs precisely while the volume knob is touched
and only logs on a change >0.003 — so silence during a gesture means master did
not move.

`trackvol arm t=<n> read=<v>` logs the value read at press time, which is the
quickest way to tell a bad read from a bad write if this ever misbehaves.

Note the inject ring is a Vyukov MPSC queue (`enqueue_pos`/`read_pos`, 8-byte
slots keyed by `seq`) as of current schwung — an older layout with a
`write_idx`/`ready` header appears in schwung checkouts before ~June 2026.
Writing the old layout into the current segment corrupts the ring; re-init is
`slots[i].seq = i` with both cursors zeroed.
