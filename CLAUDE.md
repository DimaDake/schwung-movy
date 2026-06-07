# CLAUDE.md — Movy

Movy is a Schwung **tool module** (no DSP) that runs inside the shadow-UI
QuickJS context on Ableton Move. It presents the 32 pads as a piano keyboard
and exposes the active chain slot's synth parameters on the 8 knobs.

Device: `ableton@move.local`

**Plans:** Save all implementation plans to `movy/plans/` (not the repo root `plans/`).

---

## Dev loop

```bash
# Quick deploy (ui.js + ui_font.mjs)
./scripts/deploy.sh [move.local]

# Full automated test — deploy, open movy, inject knob CCs, check log (PASS/FAIL)
./scripts/test.sh [move.local]

# Enable unified log (once per device boot; persists until cleared)
ssh ableton@move.local 'touch /data/UserData/schwung/debug_log_on'

# Live movy log tail
ssh ableton@move.local 'tail -f /data/UserData/schwung/debug.log | grep "\[movy\]"'

# Clear log
ssh ableton@move.local '> /data/UserData/schwung/debug.log'
```

**QuickJS module cache:** `shadow_load_ui_module` re-evaluates `ui.js` fresh on
every tool open, but ES modules **imported by** `ui.js` are cached for the entire
`shadow_ui` process lifetime (shadow_ui ignores SIGTERM; SIGKILL kills it without
respawn). To avoid stale-code bugs, **all movy logic lives in `ui.js`** — model,
renderer, and module configs are inlined rather than split into separate files.
The `view/` and `modules/` subdirs exist only for browser tests.

**Never `kill -9` the shadow_ui process** — MoveOriginal (its parent) does not
respawn it, so the device UI breaks until a full reboot.

---

## shadow_ui.js MIDI contract

These facts are stable across Schwung versions. Knowing them avoids re-reading
the 16 000-line `schwung/src/shadow/shadow_ui.js`.

**Knob CC routing (CC 71–78):**
- Hardware knob turns arrive as CC71-78. The shadow UI does NOT forward them
  directly to the module.
- Instead: `overtakeKnobDelta[k] += decodeDelta(d2)` (accumulated, not
  forwarded).
- On each `tick()`, for each k where delta ≠ 0:
  ```
  ccVal = delta > 0 ? Math.min(delta, 63) : Math.max(128 + delta, 65)
  overtakeModuleCallbacks.onMidiMessageInternal([0xB0, 71 + k, ccVal])
  overtakeKnobDelta[k] = 0
  ```
- Decoded back in movy: `decodeDelta(ccVal)` from `shared/input_filter.mjs`.

**All other MIDI:**  forwarded directly as `onMidiMessageInternal(data)`.

**Guard:** the entire overtake block runs only when:
```
view === VIEWS.OVERTAKE_MODULE && overtakeModuleLoaded &&
overtakeModuleCallbacks && !overtakeInitPending
```

**Targeted greps** (instead of reading the file):
```bash
# Knob accumulation + flush:
grep -n "overtakeKnobDelta\|KNOB_CC_START" schwung/src/shadow/shadow_ui.js

# Overtake MIDI routing block start:
grep -n "OVERTAKE_MODULE\|overtakeInitPending\|overtakeModuleCallbacks.onMidi" \
    schwung/src/shadow/shadow_ui.js

# open_tool_cmd handler + shm offsets:
grep -n "open_tool_cmd\|offOpenToolCmd" \
    schwung/src/shadow/shadow_ui.js schwung/schwung-manager/shmconfig.go
```

---

## Host APIs available in JS context

```javascript
shadow_get_ui_slot()                          // → int  currently focused chain slot (0-3)
shadow_get_param(slot, "synth:ui_hierarchy")  // → JSON string or null
shadow_get_param(slot, "synth:<key>")         // → string value or null
shadow_set_param(slot, "synth:<key>", valStr) // → bool (true = IPC accepted)
shadow_send_midi_to_dsp([status, d1, d2])     // inject MIDI to active slot's DSP
host_exit_module()                            // exit movy, return to shadow UI
```

`ui_hierarchy` JSON shape (from `CLAUDE.md` in the schwung repo):
```json
{
  "levels": {
    "root": {
      "knobs": ["param_key1", "param_key2", ...],
      "params": [{"key": "param_key", "label": "Label"}, ...]
    }
  }
}
```
Param metadata (min/max/step/type) comes from `shadow_get_param(slot, "synth:chain_params")`.

---

## open_tool_cmd protocol

The only way to open a tool programmatically (used by `scripts/test.sh`):

```python
import mmap, json
with open("/data/UserData/schwung/open_tool_cmd.json", "w") as f:
    f.write(json.dumps({"file_path": "/", "tool_id": "movy"}))
with open("/dev/shm/schwung-control", "r+b") as f:
    mm = mmap.mmap(f.fileno(), 0)  # use 0 — file is 64 bytes, explicit size fails
    mm[56] = 1                     # offOpenToolCmd = 56 (shmconfig.go)
    mm.close()
```

---

## Known gotchas

**Pad range overlaps knob CC range.**  
Pad note range is `d1 = 68–99`. Knob CC range is `d1 = 71–78` (inside pads).
In `onMidiMessageInternal`, the pad handler must `return` only inside the
`note-on` / `note-off` branches — not unconditionally. If `return` is at the
bottom of the pad block, CC71-78 are silently swallowed before the knob handler
runs.

**`mmap` size on `/dev/shm/schwung-control`.**  
The shm file is 64 bytes. `mmap.mmap(f.fileno(), 256)` raises
`ValueError: mmap length is greater than file size`. Always use `mmap(f, 0)`.

**`decodeDelta` for re-encoded knob CCs.**  
The shadow UI re-encodes accumulated deltas: 1-63 = clockwise, 65-127 =
counter-clockwise. `decodeDelta` from `shared/input_filter.mjs` handles this.
Do not treat the raw `d2` value as a delta directly.

---

## Font

`ui_font.mjs` contains the Elektron pixel font rasterised from
`elektron-font.otf` at 8pt. `FONT_HEIGHT = 5`. Glyph format:
`[advance, yOff, w, h, ...rowBytes]` with bit0 = leftmost pixel per row.

To regenerate after changing the OTF or size:
```bash
python3 scripts/generate_font.py
```
Requires Pillow: `pip install pillow`.
