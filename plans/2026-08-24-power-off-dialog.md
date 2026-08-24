# Power-off dialog under overtake

Status: design informed by an on-device spike (2026-08-24); the schwung PR's
first implementation step is itself a verification (does Move's dialog
actually appear once ceded — see Open Question below). Not a finished,
risk-free spec — the closest thing to one this problem currently allows.

Repos touched: `schwung` (fork `DimaDake/schwung`, new branch), `movy`
(minimal — see below).

Supersedes the diagnosis in `movy/docs/schwung-poweroff-overtake-fix.md`
(kept for history; its "Option A: raw MIDI passthrough" theory is revised
below in light of the spike).

## Problem

Pressing Move's power button does nothing while movy (or any overtake tool)
is open — Move's native "Press wheel to shut down" prompt never appears, so
the existing (tested, shipped) shutdown handler in `shadow_dbus.c`
(`shadow_dbus_handle_text`, commit `527a3c90`) never fires: its trigger is a
D-Bus screen-reader announcement of that exact prompt text, and the prompt
is never shown to be announced.

Wanted: press power while movy is open → Move's own real "press wheel to
shut down" screen replaces movy's, owns knob/button/LED input, or a "no,
I plugged you in wrong" nothing" state exit; Back cancels and returns to
movy; jog click performs a real hardware shutdown through Move's own,
already-correct handler. No movy-authored dialog — Move's own screen,
borrowed.

## Spike findings (2026-08-24)

Using schwung's existing `spi_midi_log_on` raw-capture facility (no shim
rebuild needed), captured two isolated button presses (tap, then a ~1.5-2s
hold):

```
cable=14 cin=0xb : eb b2 2a 64      (tap:  CC 0x2A=100 on cable 14)
cable=0  cin=0x4 : 04 f0 00 21      (SysEx, 4 USB-MIDI packets, reassembled:)
cable=0  cin=0x4 : 04 1d 01 01        F0 00 21 1D 01 01 3A 2A 64 00 F7
cable=0  cin=0x4 : 04 3a 2a 64
cable=0  cin=0x6 : 06 00 f7 00

# hold: identical shape, id byte 0x2A -> 0x3A, value stays 0x64(100)
```

1. **The event is real and identifiable**: a dedicated CC on cable 14 plus a
   mirrored SysEx using Ableton's manufacturer header (`00 21 1D 01 01`)
   with subcommand `0x3A` — a sibling of the already-documented `0x37`
   (USB-C audio source) and `0x3B` (knob-ring LED) subcommands. This
   replaces the old doc's "unidentified `status=0` flood" with a concrete
   signature.
2. **`schwung/docs/CORUN.md` states outright**: "The power button is not a
   routable MIDI event... out of scope." Nobody has classified or handled
   this signal in the existing control-surface routing — consistent with a
   real signal that simply has no consumer yet, not a suppressed one.
3. **Neither capture produced Move's D-Bus "Press wheel to shut down"
   announcement**, even on the longer hold. Combined with `schwung_shim.c`'s
   own repeated comments that `hardware_mmap_addr` (the buffer Move firmware
   itself reads) is never modified by any of the overtake filtering
   (confirmed at 3 sites, e.g. ~7780: "hardware_mmap_addr is NOT modified —
   writing MIDI_IN hardware crashes Move"), this **contradicts the old doc's
   "input is suppressed from Move" theory**. Move is very likely already
   receiving this event unmodified and still not reacting — pointing at a
   **display/session ownership** problem, not an input-suppression one.

## Design

### Why co-run, not raw passthrough

schwung already ships a general mechanism for exactly "cede OLED + jog +
back to Move firmware for one session, then automatically hand it back on
Back": **co-run**, target `CORUN_TARGET_MOVE_NATIVE` (`docs/CORUN.md`,
`shadow_corun_begin_cede()` in `shadow_ui.c`). Its existing exit path
(`schwung_shim.c` ~7758-7769) already does the "Back ends the session and
returns `shadow_display_owner` to `DISPLAY_OWNER_SCHWUNG_UI`" half of what
this feature needs — for free, already tested, already shipping (used
today for Move's native preset/synth editor). The old doc's "Option A"
(patch the raw MIDI filter to let the event through) solves a problem the
spike now suggests doesn't exist (input already reaches Move) and does
nothing for the "resume to movy on Back" half, which co-run already solves.

### schwung PR (shape, to be refined during implementation)

1. Classify the identified signal (cable 14, CC 0x2A/0x3A-ish, or the
   mirrored SysEx subcommand `0x3A`) in the shim's overtake input scan.
2. On detecting it, begin a co-run session ceding to
   `CORUN_TARGET_MOVE_NATIVE` (or a new, lighter sibling target if
   `MOVE_NATIVE`'s existing semantics — built for the preset/synth editor —
   don't cleanly fit a modal confirm dialog; this is a call to make once the
   first cede is wired up and observed on-device). Cede at minimum OLED +
   jog + back; movy's own knob/button/LED handling is already fully
   superseded by co-run's routing while ceded, so no separate "block movy's
   input" logic is needed on the movy side.
3. Rely on the existing, shipped `shadow_dbus_handle_text` /
   `527a3c90` handler to do the rest once Move's prompt is actually visible
   and announced: it already saves state, clears `overtake_mode` +
   `display_mode`, and lets the jog click reach Move for the real shutdown
   confirm.
4. Back exits co-run through the existing framework path (interception,
   `shadow_corun_end()`, ownership returns to `DISPLAY_OWNER_SCHWUNG_UI`) —
   verify this actually leaves movy resumed and redrawing correctly, not
   dropped to Move's home menu; this is the "resume to movy on dismiss"
   requirement.

### movy PR (small)

No dialog to build — this is schwung reaching parity with stock Move, not a
new movy UI. movy only needs:

- Nothing to *initiate* — the shim detects the signal and takes ownership
  unilaterally, symmetric with how a real power button works on stock Move.
- A capability/version guard if the co-run resume path needs movy to redraw
  proactively on regaining ownership (versus schwung already forcing a
  redraw as part of ending a co-run session, which the existing chain-edit
  co-run consumer may already rely on) — confirm during implementation
  whether this is already free.

## Open Question (first thing to verify when implementing)

Does Move's native shutdown prompt actually render and announce once ceded
via co-run? The spike confirmed the *signal* and a plausible *mechanism*,
but did not (and, without writing the cede code, could not) confirm Move's
reaction once display/input ownership is actually handed over. If co-run
alone isn't sufficient (e.g. Move's dialog trigger needs something beyond
display ownership), fall back to the old doc's Option B: detect the signal
in the shim and directly mirror `shadow_dbus_handle_text`'s effect
(`overtake_mode=0`, `display_mode=0`, `SAVE_STATE`) without depending on
Move's own D-Bus announcement at all.

## Testing

- No local/CI-testable surface on the movy side beyond the capability guard
  (if any) — this is fundamentally a hardware/firmware-interaction feature.
- schwung side: manual on-device verification per the existing repo's own
  testing model for hardware interactions (no CI-testable surface for a
  physical power-button press). Verify: prompt appears + is legible, Back
  returns cleanly to movy with correct redraw, jog click performs a real
  shutdown.
- Do not add a new `scripts/test-*.sh` device suite for this — a physical
  button press cannot be scripted (confirmed during the spike: no software
  injection path reaches it, unlike CC/note gestures), so a scripted test
  would only be able to cover the co-run cede/resume mechanics, which
  belong in schwung's own test suite if anywhere, not movy's.
