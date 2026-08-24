# Track+Volume combo unification (no-shift, Move-excluded)

Status: **implemented and device-verified (2026-08-24)**. schwung fork
branch `feat/suppress-master-volume` pushed (PR not yet opened — see final
note); movy changes committed to main.
Repos touched: `schwung` (fork `DimaDake/schwung`, branch
`feat/suppress-master-volume`), `movy`.

## Problem

Today, holding a track button and turning the master-volume knob edits that
track's level (`slot:volume` for a host slot, `mix` for a movy chain track —
`src/mixer/track-volume.ts`). Two different things happen depending on Shift:

- **Shift held**: movy draws its own dB-ladder slider overlay and owns the
  screen for the gesture.
- **Shift not held**: schwung's `shadow_swap_display()` hands the OLED to
  Move for the duration of the touch, so Move's own native volume UI shows
  instead — and because CC 79 (master volume) and the master-touch note are
  **hardcoded** to always reach Move firmware in overtake regardless of any
  module capability (`schwung_shim.c` ~6624-6634, ~6664-6673), Move also
  processes the turn internally. movy hides the *effect* on Move's own mixer
  by injecting a synthetic CC 40-43 track-hold into Move's firmware first
  (`injectHold` in `track-volume.ts`) so Move routes the turn to "its" track
  volume instead of master — but Move still sees and reacts to the event, and
  still owns the screen.

Wanted: this combo works identically **with or without Shift**, always shows
movy's own overlay, and Move is not involved at all — no display handoff, no
internal state change on Move's side. Applies uniformly across all 16 movy
tracks (4 host-backed slots + 12/16 movy-owned chains, depending on the
`chtracks` flag).

## Design

### schwung PR

Add one new dynamic, runtime-toggleable suppression flag, mirroring the
existing `overtake_suppress_sysex` flag end-to-end:

1. **`shadow_control_t`** (`src/host/shadow_constants.h`): new field
   `uint8_t overtake_suppress_master_volume`.
2. **JS binding** (`src/shadow/shadow_ui.c`): `js_shadow_set_overtake_suppress_master_volume`,
   registered as global `shadow_set_overtake_suppress_master_volume(flag)` —
   same shape as `js_shadow_set_overtake_suppress_sysex` (~line 612).
3. **Guard the two hardcoded exemptions** in `schwung_shim.c`'s overtake input
   filter — mode 2 (~6624-6634) and mode 1 (~6664-6673) — so "let CC 79 /
   master-touch note 8 through" additionally requires
   `!shadow_control->overtake_suppress_master_volume`. While the flag is set,
   CC 79 and note 8 are suppressed from Move exactly like every other
   cable-0 event in full overtake, and reach the module only.
4. **Guard the plain-volume-touch display-hide branch inside
   `shadow_swap_display()`** (~3629-3644: `if (shadow_volume_knob_touched &&
   !shadow_shift_held) { ...yield OLED to Move... }`). This is a *separate*
   mechanism from (3) — `shadow_volume_knob_touched` is tracked from the raw
   hardware unconditionally (set at ~4860/4867/7376) and is what currently
   makes the overlay Shift-only. Add the same `&&
   !shadow_control->overtake_suppress_master_volume` guard here too, or the
   OLED would still yield to Move whenever the flag is off/unset for that
   frame even though Move never receives the event. Both guards are required;
   neither alone reproduces the desired behavior.
5. **Reset on shim init**, mirroring `overtake_suppress_sysex = 0` at
   `schwung_shim.c` ~3266 (the existing reset block for SHM state stale
   across `restart-move.sh` cycles). Additionally reset it in the
   `prev_overtake_mode != 0 && overtake_mode == 0` exit-transition block
   (~6544) as a safety net — a stuck suppression permanently breaks the
   master volume knob for every subsequent module, a worse failure mode than
   `overtake_suppress_sysex`'s equivalent (a stuck LED filter), so unlike
   that flag this one gets the extra belt-and-braces reset.

Default off, so every other module (davebox, etc.) is unaffected. No
`module.json` capability needed — this is a runtime call, not a load-time
declaration.

### movy PR

`src/mixer/track-volume.ts`:

- Capability-detect: `typeof shadow_set_overtake_suppress_master_volume === 'function'`.
- **New path (capability present)**: `beginDivert()` calls
  `shadow_set_overtake_suppress_master_volume(true)` instead of
  `injectHold(track, true)`; `endDivert()` calls it with `false` instead of
  `injectHold(track, false)`. `injectHold` and the whole "fool Move about
  which track is held" mechanism becomes dead code on this path and is
  removed — Move never sees the event at all, so there's nothing to fool.
- **Fallback path (capability absent — pre-merge schwung)**: keep today's
  exact behavior (`injectHold` trick, Shift-gated overlay via schwung's
  existing display-hide) unchanged. This is how movy "doesn't know the PRs
  don't exist yet" — it just runs its current code.
- `volumeOverlay()` needs no change: it already returns the slider whenever
  `heldTrack >= 0 && touched`, with no Shift check — the Shift-gating was
  entirely schwung's display compositing fighting for the screen. Once (4)
  above stops that fight, the overlay simply always shows.

### 16-track uniformity

Already implemented via `trackKind()` / `portFor()` / `volumeKey()`
(`track/ref.ts`, `track/registry.ts`) — host slots (`slot:volume`) and movy
chains (`mix`) go through one call site and one dB-ladder. No new plumbing
needed; verify with a test rather than build it.

## Compatibility

Gated entirely by the `typeof` check above. Pre-merge schwung: identical to
today's shipped behavior (Shift required for the overlay, Move still
technically sees the event via the existing trick). Post-merge: no-Shift,
Move fully excluded. No `module.json` version bump or capability declaration
required — the check is purely dynamic.

## Testing

- **Local logic test** (`browser-test/logic/`): assert the overlay/edit path
  produces identical results for a host-kind track and a movy-kind track
  (same dB-ladder math, different underlying param key) — locks in the
  uniformity claim above. Assert the capability-absent fallback still drives
  `injectHold`-equivalent behavior (mock `move_midi_inject_to_move`) so the
  pre-merge path doesn't silently rot.
- **Device**: reused and repaired the existing `scripts/test-volume.sh`
  rather than adding a new script (it already scripted exactly this
  gesture via MIDI injection; its divert-mechanism assertion just needed to
  become path-aware, and its cross-run "slot read-back" comparison needed
  fixing independently — see the movy commit message). Verified against the
  deployed `feat/suppress-master-volume` fork: `path=suppress` in the arm
  log, zero packets through the MIDI_IN inject ring (Move genuinely gets
  nothing), correct dB-ladder application (+5 detents from unity → 1.7783),
  and slot read-back round-trips correctly within one run.

## Verification (2026-08-24)

- `tests/host` (schwung, CI-gated): unchanged, all green.
- `npm test` (movy, all 8 local suites): all green, including new
  capability-path coverage in `browser-test/logic/track-volume.mjs` (teeth
  confirmed — reverting the fix fails 3 of the new assertions).
- `scripts/test-volume.sh` (device): all checks pass against the deployed
  fork.
- Visual confirmation (`scripts/grab-screen.mjs`): drove track 1 hold +
  master-touch + turn via MIDI injection with **no Shift held**, grabbed the
  live OLED. movy's own "T2 VOLUME" slider overlay renders — Move's native
  volume screen never appears. This is the core user-facing claim, checked
  directly rather than inferred from log evidence alone.
