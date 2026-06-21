# Enum parameter automation — root cause + "fix the chain" handoff

Status: **enum automation reverted** (commits `8386260`, `13b93ee` undone). Enums
are non-automatable again. This doc captures everything learned so a future
session can implement the real fix without re-investigating.

Date investigated: 2026-06-21. Device: `move.local`, track 2 = synth **MrHyde**
(a.k.a. "freak"), midi_fx **arp**.

---

## TL;DR

Float/int parameter automation works. **Enum automation is broken in the
Schwung chain, not in movy.** The chain hardcodes every enum's numeric range to
`min=0, max=1`, so an enum lane can only ever reach options 0 or 1 — never
options 2..N. The on-screen value looked correct only because movy fabricates
its own `0..count-1` range purely for display; that range never reaches the
chain.

The **real fix is one line in Schwung** (`parse_chain_params`: derive
`max_val = option_count - 1` for enums). A movy-only alternative (Tier-A) exists
that needs no Schwung change. Both are described below.

---

## User-visible symptoms (both = this one root cause)

1. **Held-step enum lock has no sonic effect.** Automating MrHyde `model` to
   "Phase Distortion" (index 1) on a step: the screen shows Phase Distortion,
   but the sound stays on "VA VCF" (index 0, the base/default).
2. **Normal enum edit reverts on release.** Turning the arp `division` overlay
   to a new value, then releasing, snaps back to the default "1/4". This happens
   because making enums `automatable` re-routes a *plain* edit into the dead CC
   automation path whenever the track is Rec-armed (playing+recording) or a step
   is held — the overlay moves (derived from the live automation value) but the
   value only goes to the dead CC lane, so release snaps to base.

---

## How parameter automation works (the path)

```
movy engine (dsp.so)              Schwung chain                       synth/fx module
  per-step lock value 0..127  →   knob_<N> mapped to target:param  →  param write
  emits CC 102+lane               abs_val = min + (CC/127)(max-min)
                                  (rounded for int/enum)
```

- movy assigns a lane: `shadow_set_param(track, "knob_<N>_set", "<target>:<key>")`
  (`src/midi/router.ts` ~line 128; `src/seq/automation.ts assignLane`).
- The engine emits the lock as an absolute CC at playback:
  `host::midi_send_internal(0xB0 | track, 102 + lane, val)`
  (`engine/crates/movy-dsp/src/lib.rs` ~line 94-95, `OutEvent::Cc`).
- The **chain** turns that CC into a param value. This is where enums break.

CC 102–109 are the **absolute** automation CCs (CC 71–78 are the relative
encoder path). Both are handled in the chain; both share the same per-enum range
bug.

---

## Root cause (exact Schwung code)

Schwung repo (`schwung/`, reference-only — pull before reading):
`src/modules/chain/dsp/`.

### 1. The chain gives every enum the range `0..1`

`chain_params.c` → `parse_chain_params()` (def at line ~550). For each param:

```c
// chain_params.c:~632
p->type    = KNOB_TYPE_FLOAT;   // default
p->min_val = 0.0f;
p->max_val = 1.0f;
...
// type parsing (~line 673)
if      (strncmp(q1, "int",  3) == 0) { p->type = KNOB_TYPE_INT;  p->max_val = 9999.0f; }
else if (strncmp(q1, "enum", 4) == 0) { p->type = KNOB_TYPE_ENUM; }   // <-- max_val NOT touched
...
// options parsing (~line 683): fills p->option_count, but never sets max_val
// explicit "min"/"max" parsing (~line 707/717): enums declare neither
```

**There is no `p->max_val = p->option_count - 1` anywhere.** Modules declare
enums with only `options` (verified live: MrHyde `model` and arp `division` both
have `options` and `default` but **no `min`/`max`**). So every enum ends up with
`min_val=0, max_val=1` in the chain's `chain_param_info_t`.

The second parser, `parse_chain_params_array_json()` (line ~817), has the same
gap (it only does enum *name→index* value lookup, never derives a range).

### 2. The CC scaling then clamps every enum to two options

`chain_midi.c`, absolute CC path (CC 102–109, ~line 598-620):

```c
// chain_midi.c:611
float abs_val = pinfo->min_val + ((float)msg[2]/127.0f) * (pinfo->max_val - pinfo->min_val);
int is_int = (pinfo->type == KNOB_TYPE_INT || pinfo->type == KNOB_TYPE_ENUM);
if (is_int) abs_val = (float)((int)(abs_val + 0.5f));     // round
if (abs_val < pinfo->min_val) abs_val = pinfo->min_val;   // clamp [0,1]
if (abs_val > pinfo->max_val) abs_val = pinfo->max_val;
```

With `max_val=1`: `abs_val = CC/127`, rounded → **CC<64 ⇒ option 0, CC≥64 ⇒
option 1**, clamped to `[0,1]`. Options 2..N are physically unreachable.

(The relative path at `chain_midi.c:534-595` and a third knob path at
`chain_host.c:1076-1110` have the same `is_int`/`min_val`/`max_val` logic and the
same limitation. `knob_find_param` itself resolves enums fine — the bug is purely
the missing range.)

---

## Why it "works sometimes"

It works **only for 2-option enums**, where the chain's hardcoded `0..1` happens
to be correct. movy emits `norm7(index, 0, count-1)` (movy's fabricated range,
`src/seq/automation.ts`):

| Enum (module)        | Options | movy CC for index 1            | Chain result        |
|----------------------|---------|--------------------------------|---------------------|
| `sync`, `lfo_retrig` | 2       | `norm7(1,0,1)` = **127**       | `127/127·1` → **1** ✓|
| `division` (arp)     | 10      | `norm7(1,0,9)`  = 14           | `14/127·1`  → **0** ✗|
| `model` (MrHyde)     | 17      | `norm7(1,0,16)` = **8**        | `8/127·1`   → **0** ✗|

So a 2-option enum (off/on, internal/clock) automates correctly; anything with
>2 options is stuck on options 0/1, and movy's scaling for the *second* option
of a many-option enum lands below the CC=64 threshold → rounds back to 0 (base).
That is exactly symptom #1.

---

## THE FIX — option A: patch the chain (correct, general)

One change in `schwung/src/modules/chain/dsp/chain_params.c`, in
`parse_chain_params()` (and the same in `parse_chain_params_array_json()`):
after options are parsed, if the param is an enum and no explicit `max` was
declared, set the range from the option count.

```c
// after option parsing, before/after the explicit min/max parse:
if (p->type == KNOB_TYPE_ENUM && p->option_count > 0) {
    p->min_val = 0.0f;
    p->max_val = (float)(p->option_count - 1);
    p->step    = 1.0f;
}
```

Place it so an explicit `"max"` in JSON (if any module ever declares one) still
wins, or just unconditionally derive it for enums (no module declares enum
min/max today, verified). After this, the **existing** CC scaling works for every
enum, every module, every tool (movy *and* davebox) at full ~3 ms timing, and
**movy needs no change** — movy already emits `norm7(index, 0, count-1)`, which
now matches the chain's `0..count-1` exactly (round-trips: chain computes
`(CC/127)·(count-1)` rounded = index).

### Caveats / deploy notes for option A
- **Schwung is marked reference-only in CLAUDE.md** ("do not modify"). Option A
  means maintaining a chain fork against upstream — weigh that. (davebox already
  ships a patched chain for its "Sch" automation, so precedent exists.)
- The chain DSP is a stock Schwung `.so` on the device. Rebuild it with
  Schwung's own toolchain (glibc ≤ 2.35, same constraint as `movy-dsp`), and
  deploy with the **scp-to-temp + `mv`** atomic-inode dance — never scp over a
  dlopen'd `.so` in place (same hazard documented in movy/CLAUDE.md for
  `dsp.so`).
- Verify nothing else relied on enums being `0..1` (search the chain for
  `KNOB_TYPE_ENUM`; the serialization sites in `chain_host.c` ~1475-1770 emit
  options separately and are unaffected by a numeric max).

### Device verification (the spike to run after patching)
Reading chain metadata without movy open, via the schwung-manager WebSocket
(`ws://move.local:7700/ws/remote-ui`), `python3` + `websocket-client`:
```python
ws.send('{"type":"subscribe","slot":1}'); ws.send('{"type":"get_hierarchy","slot":1}')
# enum params show "options" but (pre-fix) no min/max
```
End-to-end CC spike (the 2026-06-15 method, run in movy's JS context):
```
shadow_set_param(slot, "knob_1_set", "synth:model")   # assignOk
shadow_send_midi_to_dsp([0xB0, 102, 8])   # pre-fix → VA VCF (0); post-fix → Phase Distortion (1)
shadow_send_midi_to_dsp([0xB0, 102, 127]) # post-fix → Modal Resonator (16)
```
WS caveat: while movy (a tool) is overtaking, `get_hierarchy`/`param_update` are
suppressed (slots look empty), but `slot_info` and `chain_params` still come
through. Read metadata with movy closed.

---

## THE FIX — option B: movy-side Tier-A (no Schwung change)

Keep enum lock data in the engine for editing/display/persistence, but **apply
the active step's enum value from the UI** via the native path movy already uses
for manual enum edits:

```
shadow_set_param(slot, "<target>:<key>", String(index))
```

- Needs the engine's status poll to report, per enum lane, the index locked at
  the **currently playing** step (engine owns playhead + locks). The UI applies
  it each tick when it changes.
- Module-independent; reaches every option; no fork.
- Cost: UI-tick latency (~23 ms / 44 Hz) instead of ~3 ms. Negligible for a
  model/division switch that changes a few times per bar.
- Do **not** route enums through the CC lane at all (don't emit CC 102+lane for
  enum lanes — it's a dead/ambiguous write). The enum lane is "engine stores the
  lock, UI applies it."

Recommendation: option A is cleaner and faster if a chain fork is acceptable;
option B keeps Schwung stock.

---

## movy-side facts (for whoever re-enables this)

- `src/model/hierarchy.ts:120` and `:321` force enum `min=0, max=options.length-1,
  step=1` (movy's own range, for rendering + accumulator scaling). This is
  already correct for option A — leave it.
- `src/seq/automation.ts`: `norm7`/`denorm7` (lane 0..127 ↔ value), `assignLane`
  (`abase`/`alabel`), `handleAutomationKnob` (the `effDelta` enum pre-scale using
  `ENUM_DELTA_DIV`), `automationKnobReleased`.
- `src/model/constants.ts`: `ENUM_DELTA_DIV = 4` (physical turns per option step).
- To re-enable: set enum `automatable: true` again in `hierarchy.ts` (both the
  config path ~120/130 and the generic-fallback path ~321/332), and re-add the
  enum branches in `src/model/viewmodel.ts` (enumIdx / overlaySelected from
  held/live automation values) and the `commit` flag in `router.ts` +
  `model/index.ts handleKnobRelease`. See reverted commits `8386260` and
  `13b93ee` for the exact diffs.
- Original design + plan (kept): `plans/2026-06-15-param-automation-design.md`
  (§2 "Finding — what is automatable" deferred enums for exactly this reason),
  `plans/2026-06-15-param-automation-plan.md`, and the enum-specific
  `plans/step-5-enum-overlay.md`, `plans/` enum spec/plan from commits
  `fc93715`/`15f733d`.

---

## Why this was reverted (not fixed now)

The chosen architecture (Tier B, engine-emitted CC) is sound for float/int and
explicitly deferred enums pending verification that the chain assigns enums a
`0..count-1` range. Verification answer: **it does not** — it hardcodes `0..1`.
Fixing it properly is a deliberate decision (chain fork vs Tier-A), not a quick
patch, so enum automation is reverted to a known-good state until that decision
is made.
