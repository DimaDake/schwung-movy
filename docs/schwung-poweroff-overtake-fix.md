# Power-off button broken under Schwung overtake modules — investigation & proposed fix

**Status:** Diagnosed (2026-06-21). Fix NOT implemented — lives in the **schwung**
repo (root `CLAUDE.md` marks schwung do-not-modify; user must approve patching
their schwung fork). This doc is the full handoff so a future session can fix it
without re-investigating.

**Scope:** Universal — power-off fails for **every** Schwung overtake tool
(movy, davebox, …), confirmed by the user. NOT movy-specific. The fix belongs in
schwung core and benefits all overtake modules.

---

## TL;DR

Pressing the Move **power button does nothing** while any overtake module is
active. Cause: in overtake mode the shim **redirects Move's hardware MIDI (which
carries the power button) to the overtake module instead of MoveOriginal**, so
MoveOriginal never engages its shutdown flow and never shows *"Press wheel to
shut down."* Schwung's only shutdown hook keys on that (now-absent) screen-reader
announcement, so it never fires. Circular: the prompt can't appear because the
button is stolen; the hook that would un-steal it waits for the prompt.

**Fix:** in the shim, either (A) let the power-button event pass through to
MoveOriginal even in overtake, or (B) detect it in the shim and directly clear
`overtake_mode`+`display_mode` (mirror the existing shutdown handler). Requires
first identifying the power button's exact event signature on the SPI stream.

---

## Evidence (device move.local, schwung 0.9.18)

- **Move buttons are NOT Linux evdev.** `/proc/bus/input/devices` is empty (only
  `mice` under `/sys/class/input`). So buttons — including power — arrive as
  **MIDI over the SPI stream**, read by MoveOriginal (Move firmware).
- **No systemd-logind** on Move (`/run/systemd/seats` absent, no `login1` on the
  bus). So `PrepareForShutdown` is NOT an available hook.
- **Screen reader works.** `debug.log` received `D-Bus text: "Movy"`,
  `"File Browser"`, `"Guitar Tuner"`, `"Loading Movy"` etc. (12 received
  `D-Bus text:` lines; 24 sent `Screen reader:` injection lines). So the D-Bus
  screen-reader path is alive and schwung receives Move's UI announcements.
- **On the power press (movy active):** the log showed only a flood of
  `OVERTAKE MIDI: status=0 d1=0 d2=0` and **no** `"Press wheel to shut down"`
  announcement, **no** `"Shutdown prompt detected"`, no shutdown. → Move's prompt
  never appeared, so the screen reader had nothing to announce.

---

## How schwung's shutdown handling works (and why it never fires here)

`schwung/src/host/shadow_dbus.c`:
- Connects to the **system** D-Bus bus; subscribes with `rule_all =
  "type='signal'"` (~line 731). It deliberately does NOT add a match for
  `com.ableton.move.ScreenReader` (comment ~728: stock Move's web server treats
  that as a competing client → "single window" error) — but it still **receives**
  the ScreenReader `text` signal via the broad `rule_all`.
- Message dispatch (~line 651): `dbus_message_is_signal(msg,
  "com.ableton.move.ScreenReader", "text")` → `shadow_dbus_handle_text(text)`.
- `shadow_dbus_handle_text()` (~line 186): when `text == "Press wheel to shut
  down"` (~line 201):
  - `ctrl->ui_flags |= SHADOW_UI_FLAG_SAVE_STATE;` (0x08)
  - `host.save_state();`
  - `*host.display_mode = 0; ctrl->display_mode = 0;`
  - `ctrl->overtake_mode = 0;` (~line 210, comment: *"Clear overtake mode so jog
    click reaches Move for shutdown confirm"*)
- This is commit **`527a3c90`** ("Clear overtake_mode on shutdown prompt so jog
  click reaches Move"), present since v0.7.11 → **is in the deployed 0.9.18**.

**Why it never fires:** MoveOriginal never *shows* the shutdown prompt under
overtake (it never gets the power button), so the screen reader never announces
"Press wheel to shut down". The handler is correct; its **trigger never occurs**.

---

## Why MoveOriginal never sees the power button

`schwung/src/schwung_shim.c`, hardware MIDI_IN scan + overtake forward
(~lines 6740–6810):
- The whole scan/forward block is gated by `if (shadow_display_mode &&
  shadow_control && hardware_mmap_addr)`.
- In `overtake_mode == 2` (module mode), **all** hardware MIDI (cable 0) is
  forwarded to the shadow module via `shadow_ui_midi_shm` (~line 6779), and
  (co-run aside) suppressed from MoveOriginal.
- The shim only lets the jog reach Move once **both** `overtake_mode == 0` AND
  `display_mode == 0` (the forward block is gated on `shadow_display_mode`). The
  shutdown handler sets both — but it never runs (see above).
- `overtake_mode → 0` transition cleanup is around `schwung_shim.c` ~5551–5657
  (comment ~5558 explicitly references the "D-Bus shutdown prompt" path).

So under overtake the power button (a hardware MIDI event) goes to the module,
which ignores it, and never reaches MoveOriginal. **Movy can't fix this itself:**
during the press, movy received only `status=0` events — the power button does
not surface to the module as a usable event.

---

## `button_passthrough` (candidate, but unproven for power)

- `capabilities.button_passthrough = [cc, ...]` in `module.json`.
  `shadow_ui.js` (~3416–3430) reads it → `overtakePassthroughCCs` → pushes a
  `"passthrough"` param to the shim (`shadow_set_param_timeout(0,"passthrough",
  csv,100)`).
- `schwung_shim.c` keeps an `overtake_passthrough_ccs[128]` bitmap (~423–427);
  those CCs route **through to MoveOriginal** (press reaches Move, LEDs stay
  Move-driven) even in overtake.
- davebox passes through CC **79** (volume). movy passes through **none**.
- **Caveat:** the power button did NOT appear as a normal CC (`0xB0`) in the
  overtake capture — only `status=0`. So `button_passthrough` (which acts on CC
  events) may not catch it, meaning the power event is consumed below the
  passthrough layer or is not a plain CC. **Must identify the signature first.**

---

## Proposed fix (schwung), most robust first

### Option A — shim-level passthrough of the power event (preferred)
1. Identify the power button's event signature in the SPI `MIDI_IN` stream
   (`schwung_shim.c`). Not evdev. Could be a specific CC/note/sysex on cable 0,
   or a non-MIDI SPI control message.
2. In the overtake forward path (~6740–6810), **let that event pass through to
   MoveOriginal** regardless of overtake (do not suppress it). Then MoveOriginal
   shows the prompt → screen reader announces → the existing `shadow_dbus`
   handler clears overtake → the wheel press completes shutdown. Keeps the
   existing, tested handler intact.

### Option B — detect power in the shim, clear overtake directly
- If the power event is recognizable in the shim, on detecting it set
  `overtake_mode=0` + `display_mode=0` + `SAVE_STATE` flag directly (mirror the
  `shadow_dbus` shutdown handler). Removes the dependency on the screen-reader
  announcement entirely. More robust if Move's prompt/announcement is unreliable.

### Option C — system-bus signal (likely dead end)
- No systemd-logind, so no `PrepareForShutdown`. The shim already receives ALL
  system-bus signals (`rule_all`); if Move emits *any* D-Bus signal on power,
  catch it in `shadow_dbus.c` dispatch and run the save+dismiss+clear logic.
  Requires capturing whether power generates any D-Bus traffic (the `status=0`
  flood suggests it does not, but verify).

---

## Next steps for future-me (do on-device BEFORE coding)

1. **Capture the power event signature.** Clear `debug.log`, press power once,
   then:
   - Add temporary raw `MIDI_IN` byte logging in `schwung_shim.c` (or find an
     existing verbose flag) to see exactly what (if anything) the press emits on
     the SPI stream. **Investigate the `status=0 d1=0 d2=0` flood** — confirm
     whether it correlates with the press (could be the power event arriving
     malformed) or is just idle knob-touch noise.
   - `busctl --system monitor` (if available) during the press to see any D-Bus
     traffic.
   - Check if MoveOriginal logs anything on power.
2. Determine short-press vs long-hold for the soft shutdown prompt.
3. Implement Option A (or B) in `schwung_shim.c`; build + deploy + verify with
   movy active:
   - `cd schwung && ./scripts/build.sh`
   - `./scripts/install.sh local --skip-modules --skip-confirmation`
   - Reboot, open movy, press power → expect "Press wheel to shut down" → wheel →
     shutdown.

---

## Key file/line references (schwung repo)

- `src/host/shadow_dbus.c`: ~186 `shadow_dbus_handle_text`; ~201 `"Press wheel to
  shut down"`; ~203 `SAVE_STATE`; ~210 clear `overtake_mode`; ~651 ScreenReader
  signal dispatch; ~731 `rule_all = "type='signal'"`; ~728 note on not
  subscribing to ScreenReader.
- `src/schwung_shim.c`: ~423–427 `overtake_passthrough_ccs[128]`; ~5551–5657
  `overtake_mode→0` transition cleanup (~5558 mentions D-Bus shutdown prompt);
  ~6740 scan gated on `shadow_display_mode`; ~6779 forward-to-shadow gated by
  `overtake_mode` (1=UI events only: jog 14 / click 3 / back 51 / tracks 40–43;
  2=all events).
- `src/shadow/shadow_ui.js`: ~3416–3430 `button_passthrough` → `passthrough`
  param; ~13944 `SAVE_STATE` flag handler (saves framework slots then CLEARS the
  flag — runs in shadow_ui tick BEFORE the overtake module's tick, so a module
  polling `shadow_get_ui_flags()` for `SAVE_STATE` can't reliably see it →
  module-side detection is NOT viable); ~14574 `OVERTAKE_MODULE` view dispatch.
- `module.json` `capabilities.button_passthrough`: davebox `[79]`; movy none.
- Commit `527a3c90` = the existing (screen-reader-dependent) shutdown handler.

## Constraints / gotchas
- Never `kill -9` `shadow_ui` (no respawn → device UI broken until reboot).
- schwung deploy: `./scripts/install.sh local --skip-modules --skip-confirmation`
  — never scp individual files (strips setuid → NO_SHIM).
- SPI callback is RT (SCHED_FIFO, core 3): **no logging/alloc/file-IO/locks** in
  that path. Raw MIDI logging must be outside the RT callback.
- Move buttons CCs: jog click 3, jog turn 14, shift 49, menu 50, back 51,
  tracks 40–43 (reversed: 43=T1), knobs 71–78, volume 79. Pads notes 68–99,
  steps notes 16–31, knob-touch notes 0–9. (Power button CC unknown — find it.)
