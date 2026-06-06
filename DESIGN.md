# Movy — Design Document

Movy is a Schwung **tool module** for Ableton Move. It runs inside the
Schwung shadow-UI engine alongside the stock Move firmware — nothing is
killed, nothing is recompiled. The 32 pads become a two-octave chromatic
piano keyboard that plays whatever sound-generator module is loaded in
Schwung's chain slot 0. A built-in browser lets you hot-swap that module
without leaving Movy.

Long-term goal: a full Move-style performance instrument (multi-track
keyboard, per-track modules, mixer, scene management) built as a
progressively enhanced Schwung tool.

---

## 1. How Schwung tool modules work

Schwung injects a shim into Move's process. The shim:

- Intercepts Move's audio output and replaces it with the Schwung chain
  DSP mix.
- Intercepts hardware MIDI (pads, knobs, buttons) and routes it through
  its own QuickJS engine before Move sees it.
- Runs `shadow_ui.js` in that QuickJS engine — this is the normal
  Schwung UI.

When the user picks a tool from the Tools menu, `shadow_ui.js` calls
`shadow_load_ui_module(path/to/ui.js)`, which evaluates the tool's script
in the **same** QuickJS context. The tool's `globalThis.init`,
`globalThis.tick`, and `globalThis.onMidiMessageInternal` replace the
shadow-UI handlers for the duration of the session.

Key consequence: **tool UIs share the full shadow-UI global scope**. Every
C binding that `shadow_ui.js` uses (`shadow_set_param`, `shadow_get_param`,
`move_midi_inject_to_move`, `os.readdir`, …) is directly callable from
the tool with no extra wiring.

### What stays running

| Layer | State while Movy is active |
|-------|---------------------------|
| Move firmware | Running — audio and MIDI intercepted by shim |
| Schwung chain DSPs (DX7, Surge, …) | Running, producing audio |
| Hardware pad MIDI | Captured by Movy, not forwarded to Move's clip launcher |
| Display | Movy's framebuffer, rendered by the shim's OLED writer |

Pressing Back exits Movy; everything snaps back to the normal Schwung UI
instantly because the chain never stopped.

---

## 2. Module descriptor

```json
// module.json
{
    "id": "movy",
    "name": "Movy",
    "version": "0.1.0",
    "author": "megadake",
    "description": "Piano keyboard + module host for Schwung",
    "component_type": "tool",
    "tool_config": {
        "interactive": true,
        "skip_file_browser": true
    },
    "capabilities": {
        "skip_led_clear": true
    }
}
```

`interactive: true` — tool captures all hardware MIDI input.  
`skip_file_browser: true` — tool launches directly with no file prompt.  
`skip_led_clear: true` — Movy controls all 32 pad LEDs from the first tick;
the host does not wipe them on entry.

Default overtake behaviour (hardware MIDI goes to the tool only, chain DSPs
receive only what the tool explicitly injects) applies automatically because
`overtake` is not set to `false`.

---

## 3. Architecture

```
hardware MIDI (pads / knobs / buttons)
        │
        ▼
onMidiMessageInternal(data)          ← tool entry point, called by shim
        │
   ┌────┴──────────┐
   │  input router  │
   └────┬──────────┘
        │
   ┌────▼───────────────────────────────────────────┐
   │                  view state machine             │
   │  VIEW_KEYS  ←→  VIEW_BROWSE  ←→  VIEW_SETTINGS │
   └────┬───────────────────────────────────────────┘
        │
   ┌────▼────────────┐        ┌──────────────────────┐
   │  keyboard layer │        │   module manager     │
   │                 │        │                      │
   │  pad → note map │        │  scanModules()       │
   │  LED colours    │        │  shadow_set_param(   │
   │  octave/root    │        │    0, "synth:module" │
   └────┬────────────┘        │    moduleId)         │
        │                     └──────────────────────┘
        ▼
move_midi_inject_to_move([cable-0 note-on/off])
        │
        ▼
shim routes to chain slot 0 DSP → audio rendered by chain
```

---

## 4. Key APIs used

All of these are C bindings available in the shadow-UI QuickJS context and
therefore callable directly from Movy's `ui.js`.

| API | Purpose |
|-----|---------|
| `move_midi_inject_to_move([CIN, status, d1, d2])` | Inject a USB-MIDI packet on cable 0 (hardware simulation). The shim routes it to all chain slot DSPs. Used for note-on/off. |
| `move_midi_internal_send([0x09, 0x90, padNote, color])` | Set a pad LED colour directly. |
| `shadow_set_param(slot, key, value)` | Write a param to a chain slot. `shadow_set_param(0, "synth:module", "dx7")` hot-swaps the sound module. |
| `shadow_get_param(slot, key)` | Read a param from a chain slot. `shadow_get_param(0, "synth:name")` returns the human-readable module name. |
| `os.readdir(path)` | List a directory (QuickJS built-in, available in this context). Used to scan installed sound-generator modules. |
| `host_read_file(path)` | Read a file. Used to parse each module's `module.json`. |
| `host_exit_module()` | Exit the tool and return to the Schwung UI. |

---

## 5. Pad → piano mapping

The 32 pads (MIDI notes 68–99) are arranged in a 4 × 8 grid. Row 0 is the
bottom row (closest to the player).

```
TOP ROW   92–99   black keys  oct+1   C# D#  —  F# G# A#  —  —
ROW 2     84–91   white keys  oct+1   C  D   E  F  G  A   B  C
ROW 1     76–83   black keys  oct+0   C# D#  —  F# G# A#  —  —
BOT ROW   68–75   white keys  oct+0   C  D   E  F  G  A   B  C
```

Semitone offset from root note (index = padNote − 68, `null` = dead pad):

```
row 0:  [ 0,  2,  4,  5,  7,  9, 11, 12]   white keys oct+0
row 1:  [ 1,  3, null, 6,  8, 10, null, null]  black keys oct+0
row 2:  [12, 14, 16, 17, 19, 21, 23, 24]   white keys oct+1
row 3:  [13, 15, null,18, 20, 22, null, null]  black keys oct+1
```

Default root: **C3 (MIDI 48)**. Playable range: C3–C5.

### LED colours

| Pad type | Schwung colour index |
|----------|----------------------|
| Dead pad (null) | 0 — Black |
| Black key | 124 — Dark Grey |
| White key | 120 — White |
| Root note (C) | 11 — Neon Green |
| Held / pressed | 1 — Bright Red |

---

## 6. MIDI injection

Note-on and note-off are sent as cable-0 USB-MIDI packets:

```js
// note-on
move_midi_inject_to_move([0x09, 0x90, midiNote, velocity]);
// note-off
move_midi_inject_to_move([0x08, 0x80, midiNote, 0]);
```

Cable 0 simulates hardware MIDI input. The Schwung shim drains the inject
ring in its tick loop (max 16 packets/tick) and forwards to all active
chain slot DSPs on their configured receive channel (default: omni).

A `held` map (padNote → injectedMidiNote) ensures the correct note-off is
sent even if root/octave changes while a note is sustained.

---

## 7. Module management

### Scanning

```js
// os.readdir returns [entries, errno]
const [entries] = os.readdir("/data/UserData/schwung/modules/sound_generators");
for (const entry of entries) {
    const raw = host_read_file(`.../${entry}/module.json`);
    const json = JSON.parse(raw);
    if (json.component_type === "sound_generator") { /* add to list */ }
}
```

Produces a sorted list of `{id, name}` from all installed sound generators.

### Hot-swap

```js
shadow_set_param(0, "synth:module", moduleId);
```

This is the exact call `shadow_ui.js` makes when the user picks a new
module from the chain editor. It takes effect on the next audio block —
the module's `.so` is dlopen'd, its `create()` is called, and it loads
its presets from its own directory. No restart required.

### Querying the active module

```js
const name = shadow_get_param(0, "synth:name")    // e.g. "DX7"
          || shadow_get_param(0, "synth_module")  // fallback: module ID
          || "—";
```

Polled once per second in `tick()` to keep the header display current.

---

## 8. Controls (Phase 1)

| Input | Action |
|-------|--------|
| Pads 68–99 | Note on/off, remapped to piano layout |
| Left arrow | Root note down one octave |
| Right arrow | Root note up one octave |
| Up arrow | Root note up one semitone |
| Down arrow | Root note down one semitone |
| Shift + Left or Right | Open module browser |
| Jog wheel | Scroll module list (browser view) |
| Jog click | Load selected module |
| Back | Return to previous view, or exit Movy |

---

## 9. Views (Phase 1)

### 9.1 Keyboard view (default)

```
┌──────────────────────────────┐
│ Movy                  [DX7] │
│──────────────────────────────│
│  ┌─┐┌─┐  ┌─┐┌─┐┌─┐         │
│  │ ││ │  │ ││ ││ │   × 2   │
│  └┬┘└┬┘  └┬┘└┬┘└┬┘         │
│  C  D  E  F  G  A  B  C    │
│──────────────────────────────│
│ C3 ──────────────────── C5  │
│ ◄► oct  ▲▼ semi  Sh+◄► mod │
└──────────────────────────────┘
```

### 9.2 Module browser

```
┌──────────────────────────────┐
│ Sound module                 │
│──────────────────────────────│
│ > DX7                        │
│   Surge XT                   │
│   SF2 Player                 │
│   Breakbeat                  │
│──────────────────────────────│
│ Back: cancel    Click: load  │
└──────────────────────────────┘
```

---

## 10. File layout

```
movy/
├── DESIGN.md          ← this file
├── archive/
│   └── DESIGN-standalone.md
├── module.json        ← Schwung tool descriptor
└── ui.js              ← full tool UI (keyboard, browser, LED control)
```

Installation on device:

```
/data/UserData/schwung/modules/tools/movy/
├── module.json
└── ui.js
```

---

## 11. Phase roadmap

### Phase 1 — Keyboard + single module (current scope)
- [x] Design doc
- [ ] `module.json`
- [ ] `ui.js` — keyboard view, LED control, module browser, MIDI injection

### Phase 2 — Multi-track keyboard
- 4 independent tracks, one sound module each (chain slots 0–3)
- Track select via track buttons (CC 40–43)
- Per-track indicator LEDs on step buttons
- Per-track volume via knobs 1–4

### Phase 3 — Full Move-style instrument
- Scene grid / clip launcher
- Per-track audio FX chain (using installed Schwung audio_fx modules)
- Master FX
- Arpeggiator and chord modes
- WAV recording via `host_sampler_start`

---

## 12. Open questions

- **Knob 1–8 assignment**: in Phase 1 knobs are unused. Map them to the
  active module's first 8 parameters (via `shadow_get_param` hierarchy)?
- **Step buttons**: currently dead. Use them for octave selection (16
  chromatic semitone steps from current root) or leave for Phase 2?
- **External MIDI in**: `onMidiMessageExternal` receives cable-2 packets.
  Should Movy pass external note-on/off through to the chain, or ignore?
- **Velocity curve**: Move pads report raw velocity. Apply a curve before
  injection, or pass raw?
- **Sustain on Back**: should held notes ring out when the user presses Back
  (requires `suspend_keeps_js`), or cut immediately?
