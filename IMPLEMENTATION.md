# Movy — Implementation Notes

Phase 1 implementation complete. Two files ship to the device.

---

## Files

```
movy/
├── module.json   — Schwung tool descriptor
└── ui.js         — Full tool UI (keyboard, browser, LEDs, MIDI)
```

Install at `/data/UserData/schwung/modules/tools/movy/`.

---

## What was built

### module.json
Declares Movy as a Schwung `tool` component with three flags:
- `interactive: true` — tool captures all hardware MIDI
- `skip_file_browser: true` — launches directly, no file prompt
- `skip_led_clear: true` — Movy owns all 32 pad LEDs from the first tick

### ui.js
Runs in the shadow-UI QuickJS context. Three logical sections:

**Keyboard layer**
- `PAD_MAP` maps each of the 32 pads (MIDI 68–99) to a semitone offset from `rootNote` (default C3 = MIDI 48), or `null` for dead pads (gaps in the piano layout)
- `noteOn` / `noteOff` inject cable-0 USB-MIDI via `move_midi_inject_to_move`
- A `held` map (padNote → injected MIDI note) ensures correct note-off even when root changes while keys are held
- `changeRoot` releases all held notes before shifting to avoid stuck notes

**LED control**
- Dead pads: black (0)
- Black keys: dark grey (124)
- White keys: white (120)
- Root C notes: neon green (11)
- Held/pressed: bright red (1)
- Written via `move_midi_internal_send([0x09, 0x90, padNote, colorIndex])`

**Module browser**
- `scanModules()` reads `os.readdir` on the sound generators directory, parses each `module.json`, filters by `component_type === "sound_generator"`
- Hot-swap via `shadow_set_param(0, "synth:module", moduleId)` — identical to what shadow_ui.js does natively
- Active module name polled from `shadow_get_param(0, "synth:name")` every ~30 ticks

---

## Controls

| Input | Action |
|-------|--------|
| Pads 68–99 | Note on/off, piano layout |
| Left / Right | Octave down / up |
| Up / Down | Semitone up / down |
| Shift + Left or Right | Open module browser |
| Jog wheel | Scroll module list |
| Jog click | Load selected module |
| Back (in browser) | Return to keyboard |
| Back (on keyboard) | Exit Movy |

---

## Key API calls used

| Call | Purpose |
|------|---------|
| `move_midi_inject_to_move([0x09, 0x90, note, vel])` | Note-on to chain slot DSPs |
| `move_midi_inject_to_move([0x08, 0x80, note, 0])` | Note-off |
| `move_midi_internal_send([0x09, 0x90, pad, color])` | Set pad LED colour |
| `shadow_set_param(0, "synth:module", id)` | Hot-swap sound module |
| `shadow_get_param(0, "synth:name")` | Read active module name |
| `os.readdir(path)` | Scan installed modules |
| `host_read_file(path)` | Parse module.json files |
| `host_exit_module()` | Return to Schwung UI |

---

## What's not yet done (Phase 2+)

- Knob 1–8 → active module parameters
- Step buttons for octave selection
- Multi-track (4 chain slots, track buttons CC 40–43)
- External MIDI passthrough (`onMidiMessageExternal`)
- Velocity curve
