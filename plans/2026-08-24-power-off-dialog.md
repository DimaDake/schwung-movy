# Power-off dialog under overtake

Status: **two fixes implemented and device-verified (2026-08-24)**. Pressing
power while movy is open now shows Move's real "Press wheel to shut down"
prompt, Back dismisses it safely (no accidental shutdown), and a power press
no longer leaks a spurious Loop-mode trigger into movy (cable-14 collision
with CC 58, found and fixed same session). **Two follow-on auto-resume
attempts were tried and reverted — still open**: the user still has to
manually reselect movy from Move's Tools menu after Back, and pad LEDs don't
recover until the next interaction. See **Two more attempts made and
reverted** below for what was tried, why both failed, and what to
investigate next — this needs a different approach, not a retry of either.

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

## Design (as implemented — the co-run theory below was superseded)

The spike's "co-run"/display-ownership theory turned out to be a red
herring, disproven by actually tracing `shim_post_transfer`'s two buffers:
`hw` (raw, `hardware_mmap_addr`) is filtered *into* a working `shadow`
buffer (`sh_midi`) each frame, and it's `shadow` — not `hw` — that ends up
back in what MoveOriginal reads. So the original "input already reaches
Move unfiltered" reading of the "never modified" comments was wrong at the
one site that matters: those comments describe OTHER code paths
deliberately avoiding a write to `hw` (which really would crash Move), not
a claim that filtering has no effect on what Move sees.

**Real root cause**: the mode-2/mode-1 filter's blanket `status >= 0x80 →
filter = 1` rule (meant to block Move's own button CCs) also matches
`0xF0`, the lead byte of *every* cable-0 SysEx — including the
power-button's `F0 00 21 1D 01 01 3A ... F7`. Its first USB-MIDI packet gets
zeroed like any other cable-0 event in full overtake, handing Move a
message missing its own header. That's it — no display-ownership problem,
no co-run needed.

**Fix implemented** (`schwung_shim.c`, mode-2 and mode-1 filter branches):
a small lookahead at the SysEx's first packet — when a cable-0 `cin=0x04`
packet matches `F0 00 21` and the following two packets match the fixed
Ableton-manufacturer continuation (`1D 01 01`) and the power subcommand
(`3A`), and the fourth packet is a SysEx-end (`cin=0x06`), all four packets
are exempted from suppression via a `power_sysex_remaining` counter carried
across loop iterations (function-local, reset every frame). The `id` byte
right after `0x3A` varies between presses (observed `0x2A` tap, `0x3A`
hold) and is intentionally not matched on — only the fixed header +
subcommand identify the message. See the inline comment above the
lookahead in `schwung_shim.c` for the exact byte offsets.

Device-verified: pressing and holding power now shows Move's real
"Press wheel to shut down" prompt on screen (Move's own rendering, not a
movy overlay — nothing built on the movy side). **Back dismisses it
correctly with no accidental shutdown** — but see Follow-up below for what
Back does *not* yet do.

### movy PR

None needed. This is schwung reaching parity with stock Move; movy has no
role in showing or handling the prompt.

## Follow-up: auto-resume on dismiss (not yet implemented)

Confirmed on-device: when the prompt appears, the existing
`shadow_dbus_handle_text` / `527a3c90` handler clears `overtake_mode` and
`display_mode` as designed, which correctly parks movy (the exact same
"suspended" state as its own deliberate Background feature — nothing is
lost or corrupted). Move's native Back then dismisses the prompt safely.
But nothing re-selects movy afterward, so the user lands on Move's own
Tools/File-Browser menu and has to manually scroll to "Movy" and click to
resume it (schwung's existing `resumeOvertakeModule()` then works exactly
as it does from a deliberate Background/manual-resume today).

**Shape of the fix** (next session): capture which overtake module was
active at the moment the power-button SysEx is detected (before
`overtake_mode` gets cleared), and once the prompt is dismissed without an
actual shutdown (device still running), auto-invoke `resumeOvertakeModule()`
for it — the same call the tools-menu selection already makes. The open
part is *detecting* "dismissed, not shut down" cleanly from the shim/JS
side (Move's Back on that screen isn't schwung-intercepted the way co-run's
Back is) — likely via the next D-Bus screen-reader announcement differing
from the shutdown prompt's text, but not yet designed in detail.

**Second symptom observed the same session, worth folding into the same
fix**: pads showed Move's own native colors/behavior, not movy's, both
*during* the dialog and *after* manually reselecting movy from Tools. The
"during" half is expected (Move genuinely owns the surface while its prompt
is up). The "after" half is not — it means `resumeOvertakeModule()`'s
manual path (same one the auto-resume fix would call) isn't fully
reclaiming LED ownership the way movy's own deliberate Background→resume
cycle does (`app/led-ownership.ts`'s `shadow_set_overtake_suppress_sysex`
re-assert on resume is the likely place to check first). Whoever picks up
the auto-resume fix should verify pad LEDs recover on manual resume too,
independent of the auto-resume trigger — it may be a pre-existing gap in
the manual path, not something the new fix introduces.

### Two more attempts made and reverted (2026-08-24, same session)

Both were implemented, device-tested, and found ineffective — reverted
rather than shipped as dead weight. Recorded here so the next session
doesn't retry them blind.

**Attempt A — suppress the Back event at the shim, so it never reaches
movy's own router.** Theory: the module's tick rate is unaffected
throughout the dialog (confirmed — `perf_phase`/`perf_ipc` keep logging at
the normal ~4.5ms period the whole time), so `overtake_mode` was assumed to
never actually change; Back was assumed to leak through schwung's normal
forwarding to movy's own `suspend_self_managed` Back-handling, which
self-parks. Fix: arm a flag on the power SysEx, swallow the next Back
down+up pair before it reaches the module (bounded to 30s). **Result:
no effect** — a repeat trace showed `shadow_dbus_handle_text()`'s
`overtake_mode = 0` DID fire this time (unlike the trace the theory was
built on), which bypasses the module-dispatch loop entirely. The two
mechanisms are apparently non-deterministic about which one fires on a
given press — tap vs hold didn't cleanly predict it either ("a quick tap is
enough", per user testing).

**Attempt B — restore `overtake_mode`/`display_mode` directly in
`shadow_dbus_handle_text()` (`shadow_dbus.c`) once the prompt is
dismissed.** Needed a "the prompt is gone" signal with none available
directly, so it hooked the *next* distinct D-Bus screen-reader text after
"Press wheel to shut down" — reasoned as safe because a device trace once
showed "Set 31" arrive ~7s after the prompt, presumably as Move returned to
its own home screen. **Result: no effect** — a fresh trace showed the
D-Bus text stream going completely silent after a *duplicate* "Press wheel
to shut down" line (logged twice, ~1ms apart) — no further text arrived at
all in the window before the user gave up and used Tools. So the "next
text" signal is not reliable either; whatever screen Move lands on after
dismissal apparently doesn't always re-trigger the screen-reader D-Bus
path.

**What this rules in for next time**: neither "suppress the Back" nor "wait
for the next D-Bus text" works alone, and the underlying mechanism appears
non-deterministic across presses — schwung's own `overtake_mode` clearing
sometimes fires (confirmed via the "Overtake exit" log line + the D-Bus
handler's own log line) and sometimes doesn't (a trace showing zero D-Bus
activity at all around the press, with the tick rate staying at ~4.5ms
throughout and *only* changing after Back). Both are real, both were
observed on real hardware in the same session, and nothing so far
distinguishes which one a given press will hit. Worth investigating before
another implementation attempt: (a) why `shadow_dbus_handle_text()` fires
inconsistently for the same physical gesture — possibly a race between the
D-Bus signal delivery and Move's own internal announcement timing; (b)
whether there's a *polling* signal (rather than an event) for "is Move
currently showing this prompt" — e.g. reading Move's own displayed pixels
the way `schwung_shim.c`'s master-volume-overlay OCR (~5650, see the
track-volume-unification plan) reads Move's on-screen volume bar, which
would sidestep the D-Bus reliability question entirely.

## Testing

- No local/CI-testable surface on the movy side — this is fundamentally a
  hardware/firmware-interaction feature with no movy code involved.
- schwung side: verified manually on-device (no CI-testable surface for a
  physical power-button press, and no software injection path reaches it —
  confirmed during the spike, unlike CC/note gestures). `tests/host` (the
  CI-gated suite) passes unchanged; no new host test added, since the fix
  is a raw-byte lookahead over live hardware timing that a host-side unit
  test can't meaningfully exercise without fabricating the exact SPI frame
  shape — a device check is the correct-weight test here.
- Do not add a new movy `scripts/test-*.sh` device suite — a physical
  button press cannot be scripted, and the mechanics that got fixed are
  entirely inside schwung, not movy.
