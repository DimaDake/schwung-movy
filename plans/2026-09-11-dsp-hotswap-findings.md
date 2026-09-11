# Spike findings — three blockers found while probing `dsp.so` hot-swap

**Date:** 2026-09-11
**Plan task:** Task 1 of `2026-09-11-device-test-framework-plan.md`
**Device:** move.local, schwung 1.4.0, movy ENGINE_VERSION 0.72.0

---

## 1. Can `dsp.so` hot-swap without a stack restart? **No.**

`movy/CLAUDE.md` is correct. My reading of `schwung_shim.c` — that the worker's
`dlclose(overtake_free_handle)` drops the mapping — was wrong about the
consequence.

Evidence, in order:

| step | result |
| --- | --- |
| movy open, engine queried | `GET_PARAM overtake_dsp:ping` → `pong 0.72.0` |
| movy closed via the leave modal | `grep -c "retired module freed"` → **1** |
| new engine built as `0.72.0-hotswap1`, deployed `--no-restart` | on-device md5 `efc779bd…` == local `dist/dsp.so` md5 |
| movy reopened | shim logs a fresh `Overtake DSP: loaded generator from …/dsp.so` |
| engine queried again | `GET_PARAM overtake_dsp:ping` → **`pong 0.72.0`** |
| shim logs the instance | `movy-dsp v0.72.0: init` / `create_instance` |

So: the module *is* retired and freed, the file on disk *is* the new one with a
fresh inode, a fresh `dlopen` *does* run — and the code that executes is still
the old build. glibc returns the already-loaded library, exactly as
`movy/CLAUDE.md` says.

**Mechanism: not confirmed.** `/proc/<pid>/maps` still showed 4 `movy/dsp.so`
segments after a close attempt, but that reading is void because the close had
silently failed (see §3), so it was sampled while movy was still open. The
likeliest explanation remains that the refcount never reaches zero — glibc
promotes a library with static TLS to `NODELETE` automatically, and a Rust
`cdylib` plausibly has it. Confirming this needs a reliable close, which needs
the probe (§3). Not worth chasing further: the behaviour is settled even if the
cause is not.

**Consequence for the plan:** `dev.swapEngine()` must always restart. The
`MOVY_ENGINE_NEEDS_RESTART` opt-in in Task 6 becomes unconditional, and
`CLAUDE.md` needs no correction — Task 1 Step 7 is a no-op.

---

## 2. `schwung-testd`'s `INJECT_MIDI` cannot drive movy's UI

There are **two** injection rings, and the daemon writes to the wrong one for
this purpose:

| ring | written by | drained by |
| --- | --- | --- |
| `/dev/shm/schwung-ui-midi` | `schwung-midi-inject-ui.py` (what every movy bash suite uses) | `shadow_ui.c:3349` → `onMidiMessageInternal` → **movy's gestures** |
| `/schwung-midi-inject` | `schwung-testd` `INJECT_MIDI`, the shim, shadow_ui, the chain forwarder | the shim, into **Move's MIDI_IN** |

Measured: with movy open and ticking (its `perf_ipc` lines still arriving), an
injected track CC 40 via `INJECT_MIDI` changed neither `selected_slot` nor
`ui_slot` in `STATE`, and produced no movy log activity. The same CC through
`schwung-midi-inject-ui.py` reaches movy.

The pytest-schwung README's claim that a track CC updates the `move_ui_mode` /
`selected_slot` mirror is about the shim's post-merge scan; whatever the stock
path does, it does not deliver to an overtake module's UI on this shim.

**Consequence for the plan:** the framework needs `INJECT_UI_MIDI` in
`schwung-testd`. The ring is trivial — 1024 bytes of 4-byte slots
`[head, status, d1, d2]` with `head` written last as the publish barrier, then
bump `shadow_control_t` byte 3 (`offMidiReady`). ~30 lines, and as generic as
the `INJECT_MIDI` it sits beside.

**This invalidates the plan's sequencing.** Tasks 2–7 were ordered to deliver
the speed win *before* the schwung PR, on the assumption that stock testd could
already drive gestures. It cannot. The schwung change is now a hard dependency
for anything beyond reading engine params.

---

## 3. Movy's close path is a leave modal, and it is view-depth dependent

`close()` in the plan (and the `Back ×3` in `test-auto.sh`) does not close movy.
From `src/app/leave-modal.ts` + `src/midi/router.ts:230`:

- Back **at the root (Chain) view** opens the Leave modal, default selection
  `Background`.
- Back **while the modal is up** dismisses it.
- Back **anywhere else** navigates up one level.
- Closing requires: reach root → Back (modal) → jog turn (`CC 14`) to select
  `Close Movy` → jog click (`CC 3`) to confirm → `host_exit_module()`.

So `Back ×3` from an unknown depth is ambiguous by parity: it can open, dismiss
and reopen the modal without ever exiting. Measured directly — one attempt with
the correct turn+click closed movy (`overtake_mode` 2 → 0, `retired module
freed`), and two later attempts from a post-reopen view left it at
`overtake_mode=2`.

**Consequences:**

- The plan's `Device.close()` is wrong and must drive the modal explicitly.
- It cannot be made deterministic from injection alone, because nothing
  observable distinguishes "modal up" from "one level up". **The probe is needed
  for basic lifecycle, not just for assertions** — which moves it from Task 9 to
  the critical path.
- **Pre-existing weakness in `test-auto.sh`:** its two "Reopening movy fresh"
  steps use `Back ×3` and then fire `open_tool_cmd`. Since the Backs do not
  close movy, those steps re-open an already-open movy. Its P3 assertions —
  "the registry repopulates from restore on reopen" — have therefore not been
  testing a cold restore path. The suite passes, but that check is weaker than
  it reads. Worth confirming when the scenario is migrated, and worth a separate
  look regardless of this framework.

---

## Recommendation

Re-sequence: the schwung PR (`INJECT_UI_MIDI` + `MODULE_STATE` + the shadow_ui
probe hook) moves to the front, because UI injection and lifecycle determinism
both depend on it. `SNAPSHOT_DISPLAY` / `SNAPSHOT_STEP_LEDS` can stay in the
same PR at no extra cost.

The daemon's own value without that PR is real but narrow: `WAIT_FRAME`,
`STATE`, `GET_PARAM`/`SET_PARAM` into the engine, and `SET_OPEN_TOOL` all work
today and were verified in this spike.
