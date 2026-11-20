# Module feedback API

A `sound_generator` can talk back to Movy: paint the drum pads and the step
row, show a line of text, draw a waveform on the main screen, and claim a few
buttons and the knobs on its own track. It is **opt-in**: a module declares the
keys it wants at the root of its `ui_hierarchy` (next to `focus_press_param`).
A module that declares none is never polled and never has input diverted, so
behaviour is unchanged for every existing module.

Reference implementation: [movy-looper](https://github.com/rogerbacardit/movy-looper)
(Looper 606, a 6-track looper `sound_generator`).

Source: `src/keyboard/module-feedback.ts` (pure key/format helpers),
`src/keyboard/module-input.ts` (glue to the active track),
`src/renderer/module-display.ts` (waveform view).

## Keys

Each key's value is the name of a module param. Read = Movy calls `get_param`
on it; write = Movy calls `set_param`.

| ui_hierarchy key | Dir | Value format |
| --- | --- | --- |
| `pad_leds_param` | read | 64 hex digits: one byte per rack pad, pad 1 first. Bits 0-6 = Move LED palette index, bit 7 (`0x80`) = blink. |
| `status_text_param` | read | `"<seq>:<text>"`. Shown as a toast when `seq` differs from the last seen; the first value seen per track is remembered, not shown. |
| `display_param` | read | `"<seq>\|<pos>\|<peaks>\|<header>"`. `seq` bumps when peaks change; `pos` is `0..127` (or `"pos,mark"` / `"pos,mark,end"`, markers `0..127`, negative = none); `peaks` = 128 values as two hex digits each (empty = nothing to draw); `header` is free text (may contain `\|`). Drawn instead of the knob page until a knob/jog is touched (1.5 s idle). |
| `delete_pad_param` | write | Delete held + pad press writes the 0-based rack pad index (`0..31`) and swallows the press. |
| `step_buttons_param` | write | A press on a step button (no Shift, Mute not held, not Session view) writes `0..15` and swallows press and release. The module also owns Loop on its track (a pure modifier: no Loop mode, no bar selector). |
| `step_leds_param` | read | 32 hex digits: one palette byte per step LED (bit 7 = blink). |
| `loop_knob_param` | write | Loop held + knob N: writes `"N:delta"` (N = 1..8, delta = signed relative turn, `":1"` appended while Shift is held = fine) and swallows the turn. |
| `knob_capture_param` | read | `"0"` / `"1"`. While `"1"` for the active track, every knob turn and touch is the module's. |
| `knob_delta_param` | write | Captured knob turns, same `"N:delta[:1]"` form as `loop_knob_param`. |
| `undo_param` | write | Undo writes `"undo"`, Shift+Undo `"redo"`, instead of Movy's own undo, on that track only. The Undo LED is lit while such a track is active. |

Pad numbering is the module's own rack numbering (the same as its declared
voices); the module never needs to know how Movy lays a rack onto the 8x4 grid.

## Example

```json
"ui_hierarchy": {
  "pad_leds_param": "pad_leds",
  "status_text_param": "status_text",
  "display_param": "display",
  "step_buttons_param": "step",
  "step_leds_param": "step_leds",
  "loop_knob_param": "loop_knob",
  "knob_capture_param": "knob_capture",
  "knob_delta_param": "knob_delta",
  "delete_pad_param": "delete_pad",
  "undo_param": "undo_cmd",
  "levels": { }
}
```

## Cost

Reads happen only for the **active** track, only every 8 ticks (about 25 Hz at
the device's ~196 ticks/s), and only for the keys the module declared (at most
five `get_param` per poll: pad LEDs, status, display, step LEDs, capture).
`display` peaks are parsed only when `seq` changes. Writes are event-driven.
Leaving a track forgets its cached state, so switching back never replays an
old message. Blink phase is 98 ticks (~0.5 s).

## Tests

`browser-test/logic/module-feedback.mjs` covers the pure formats;
`browser-test/app-loop.mjs` ("module" sections) drives the full tick/MIDI loop.
