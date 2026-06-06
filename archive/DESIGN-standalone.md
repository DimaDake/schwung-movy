# Movy — Design Document

Movy is a standalone Schwung tool for Ableton Move that replaces Move's
firmware while it runs. It presents the 32 pads as a chromatic piano
keyboard and hosts any installed Schwung sound-generator module. The
long-term goal is a full Move-style performance instrument: multi-track
keyboard, per-track sound modules, mixer, FX chain, and scene management.

---

## 1. Context and constraints

### Hardware

| Item | Detail |
|------|--------|
| CPU | ARM64, BCM2835 (Raspberry Pi silicon) |
| OS | Linux 5.15.92-rt57 (PREEMPT_RT) |
| Audio | SPI character device `/dev/ablspi0.0` (driver `ablspi.ko`) |
| Display | 128 × 64 OLED, 1-bit, SSD1306 page addressing |
| Controls | 32 RGB pads, 16 step buttons, 8 knobs, jog wheel, 15 buttons |

### SPI mailbox (768 bytes, flushed every ~2.9 ms)

```
Bytes   0– 79   MIDI out to hardware   (20 × 4-byte USB-MIDI packets)
Bytes  80–255   Display slice          (byte 80 = slice# 1-6, bytes 84-255 = 172-byte bitmap)
Bytes 256–767   Audio out              (128 stereo frames × int16 × 2 ch)
--- mmap offset 2048 ---
Bytes 2048–2303 Hardware input         (USB-MIDI packets: knob deltas, pad presses, button events)
```

Full display refresh = 6 SPI flushes (6 horizontal bands of ~128 × 11 px each).

### Schwung plugin ABI

Installed sound modules are ARM64 shared libraries (`*.so`) built against
Schwung's `plugin_api_v1.h` / `plugin_api_v2.h`. The v2 API is:

```c
typedef struct {
    const char *id;
    uint32_t    api_version;          // 2
    void *(*create)(const host_api_v1_t *host);
    void  (*destroy)(void *instance);
    void  (*process_block)(void *instance, int16_t *out, int frames);
    void  (*on_midi)(void *instance, const uint8_t *msg, int len, int source);
    int   (*get_param)(void *instance, const char *key, char *buf, int len);
    void  (*set_param)(void *instance, const char *key, const char *value);
} plugin_api_v2_t;
```

Modules expose a `plugin_get_api_v2()` symbol. They load their own presets
from `/data/UserData/schwung/modules/sound_generators/<id>/` — the same
paths they use when hosted by the normal Schwung chain, so all existing
settings are automatically available.

---

## 2. Launch lifecycle

Movy ships as a Schwung **standalone tool**:

```
module.json  →  "standalone": true
               "standalone_path": "standalone"  (or the binary is named "standalone")
```

When the user picks Movy from Schwung's Tools menu, `launch-standalone.sh`
runs. It:

1. Closes all inherited file descriptors (≥ 3).
2. Sends SIGTERM then SIGKILL to `Move`, `MoveMessageDisplay`, `MoveLauncher`,
   `schwung`, `shadow_ui`.
3. Kills any remaining holder of `/dev/ablspi0.0`.
4. Execs the `standalone` binary.
5. When the binary exits, restarts `/opt/move/Move` and schwung.

Movy receives `/dev/ablspi0.0` exclusively and owns the full hardware loop.

---

## 3. Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      movy binary                        │
│                                                         │
│  ┌──────────┐    ┌───────────┐    ┌──────────────────┐  │
│  │  hw_io   │    │ ui_engine │    │  plugin_host     │  │
│  │          │    │           │    │                  │  │
│  │ spi_init │    │ keyboard  │◄───│ load / unload    │  │
│  │ spi_flush│◄───│ display   │    │ dlopen plugin    │  │
│  │ poll_in  │───►│ led_ctrl  │    │ process_block()  │  │
│  └──────────┘    │ menu_nav  │    │ on_midi()        │  │
│                  └───────────┘    └──────────────────┘  │
│                        │                  │             │
│                  ┌─────▼──────────────────▼──────────┐  │
│                  │           main loop                │  │
│                  │  poll_input → ui → midi → audio    │  │
│                  └────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### 3.1 hw_io — hardware I/O

Wraps `/dev/ablspi0.0`. Taken directly from Schwung's `schwung_spi_lib.c`
(vendored / submoduled). Provides:

```c
int  spi_open(void);           // O_RDWR, ioctl(SPI_SPEED, 20_000_000)
void spi_flush(spi_mailbox_t *mb);  // ioctl(FLUSH, 768)
int  spi_poll_input(void);     // ioctl(POLL_IRQ): 1 = new input
void spi_read_input(uint8_t *buf, int len); // read 256B from mmap+2048
void spi_close(void);
```

### 3.2 plugin_host — sound module loading

Scans `/data/UserData/schwung/modules/sound_generators/` for `module.json`
files, builds a list of `{id, name, dsp_path}`. Loads one at a time:

```c
typedef struct {
    void               *dl_handle;
    const plugin_api_v2_t *api;
    void               *instance;
    char                id[64];
    char                name[128];
} loaded_plugin_t;

int  plugin_load(loaded_plugin_t *p, const char *dsp_path, host_api_v1_t *host);
void plugin_unload(loaded_plugin_t *p);
void plugin_on_midi(loaded_plugin_t *p, const uint8_t *msg, int len, int source);
void plugin_render(loaded_plugin_t *p, int16_t *out, int frames);
```

`host_api_v1_t` is a struct of callbacks movy provides to the plugin (file
I/O, logging, etc.). The same interface Schwung uses, so existing modules
work without modification.

**Hot-swap**: `plugin_unload()` then `plugin_load()` during a blank audio
frame — the plugin's own preset files remain untouched so settings persist
across swaps.

### 3.3 ui_engine — display and input

All display drawing writes into a `uint8_t fb[8][128]` framebuffer (8 SSD1306
pages × 128 bytes). The framebuffer is serialised into the 6 SPI display
slices on every flush.

Font rendering uses the same 5 × 7 bitmap font Schwung uses (vendored from
the Schwung repo's `fonts/` directory) or `stb_truetype.h` (already in the
Schwung tree) for larger text.

Key subsystems:

- **keyboard** — maps pad MIDI notes (68-99) → piano semitone offsets, calls
  `plugin_on_midi()` with the remapped note; drives pad LED colours via the
  MIDI-out section of the mailbox.
- **display** — renders the active view into the framebuffer.
- **menu_nav** — jog wheel + button navigation for the module browser and
  settings screens.

### 3.4 Main loop

```c
while (!g_exit) {
    if (spi_poll_input()) {
        spi_read_input(input_buf, 256);
        process_input(input_buf);   // → ui_engine
    }

    ui_engine_tick();               // update display FB if dirty

    plugin_render(&g_plugin, audio_out, 128);  // 128 stereo frames

    spi_flush(&mailbox);           // MIDI + display slice + audio → hardware
}
```

One iteration = one 2.9 ms audio block. Display refresh is spread across
6 iterations (one slice per flush). The RT kernel ensures consistent timing.

---

## 4. Pad → piano mapping

```
TOP ROW   92–99   C#/D#/—/F#/G#/A#/—/—   black keys  oct+1
ROW 2     84–91   C  D  E  F  G  A  B  C   white keys  oct+1
ROW 1     76–83   C#/D#/—/F#/G#/A#/—/—   black keys  oct+0
BOT ROW   68–75   C  D  E  F  G  A  B  C   white keys  oct+0
```

Default root: C3 (MIDI 48). Range: C3–C5.

Semitone offset table (index = padNote − 68, `null` = dead pad):

```
[ 0, 2, 4, 5, 7, 9,11,12,   ← row 0 white
  1, 3,null,6, 8,10,null,null, ← row 1 black
 12,14,16,17,19,21,23,24,   ← row 2 white
 13,15,null,18,20,22,null,null] ← row 3 black
```

LED colours:

| Pad type | Colour | Index |
|----------|--------|-------|
| Dead pad | Off | 0 |
| Black key | Dark grey | 124 |
| White key | White | 120 |
| Root note (C) | Neon green | 11 |
| Held | Bright red | 1 |

---

## 5. Controls (Phase 1)

| Input | Action |
|-------|--------|
| Pads 68–99 | Note on/off (remapped to piano layout) |
| Left / Right arrow | Root note down / up one octave |
| Up / Down arrow | Root note down / up one semitone |
| Jog wheel | Browse module list (in module picker view) |
| Jog click | Confirm module selection |
| Shift + Left or Right | Open module picker |
| Shift + Back | Exit movy (all-notes-off, restart Move) |

---

## 6. Views (Phase 1)

### 6.1 Keyboard view (default)

```
┌────────────────────────────┐
│ Movy              [DX7]   │  ← active module
│────────────────────────────│
│  ┌─┐┌─┐ ┌─┐┌─┐┌─┐        │
│  │ ││ │ │ ││ ││ │  × 2   │  ← piano diagram
│  └┬┘└┬┘ └┬┘└┬┘└┬┘        │
│  C D  E  F  G  A  B  C   │
│────────────────────────────│
│ C3 ─────────────────── C5 │
│ ◄► oct  ▲▼ semi  Sh+◄► mod│
└────────────────────────────┘
```

### 6.2 Module picker view

```
┌────────────────────────────┐
│ Sound module               │
│────────────────────────────│
│ > DX7                      │
│   Surge XT                 │
│   SF2 Player               │
│   Breakbeat                │
│────────────────────────────│
│ Back: cancel   Click: load │
└────────────────────────────┘
```

---

## 7. Phase roadmap

### Phase 1 — Keyboard + single module (this repo)
- [x] Design doc
- [ ] SPI I/O layer (vendor `schwung_spi_lib.c`)
- [ ] Plugin host (vendor `module_manager.c` + plugin API headers)
- [ ] Framebuffer + 5×7 font renderer
- [ ] Pad → piano MIDI mapping
- [ ] Keyboard view + LED control
- [ ] Module picker (scan + hot-swap)
- [ ] `module.json` with `"standalone": true`
- [ ] Build system (CMake, cross-compile to ARM64)

### Phase 2 — Multi-track keyboard
- 4 tracks, each with its own sound module
- Track select via track buttons (CC 40–43)
- Per-track MIDI channel routing
- Simple per-track volume (knobs 1–4)

### Phase 3 — Full Move-style performance instrument
- Clip launcher / scene grid
- Per-track FX chain (audio_fx plugins from installed Schwung modules)
- Master FX
- Arpeggiator / chord modes
- Recording to WAV

---

## 8. Build

Target: ARM64 Linux, cross-compiled from macOS or Linux x86-64.

```
toolchain: aarch64-linux-gnu-gcc  (or Clang with --target=aarch64-linux-gnu)
sysroot:   Move device rootfs (or minimal arm64 sysroot)
deps:      libc, libm, libdl, libpthread  (all present on Move)
```

Directory layout:

```
movy/
├── DESIGN.md
├── CMakeLists.txt
├── src/
│   ├── main.c
│   ├── hw_io.c / hw_io.h          ← SPI layer
│   ├── plugin_host.c / .h         ← dlopen module loading
│   ├── ui_engine.c / .h           ← display + input dispatch
│   ├── keyboard.c / .h            ← pad→piano mapping + LEDs
│   ├── menu_nav.c / .h            ← jog/button navigation
│   └── font.c / .h                ← 5×7 bitmap font
├── vendor/
│   ├── schwung_spi_lib.c / .h     ← copied from schwung, do not edit
│   ├── plugin_api_v1.h            ← copied from schwung, do not edit
│   ├── plugin_api_v2.h            ← copied from schwung, do not edit
│   └── stb_truetype.h             ← single-header lib
└── module.json                    ← schwung tool descriptor
```

`vendor/` files are copied verbatim from the Schwung repo at a known commit
and updated manually when the Schwung ABI changes. This is intentional: it
makes Schwung ABI changes explicit and auditable rather than silently
breaking a submodule pin.

---

## 9. Open questions

- **Audio sample rate**: Schwung uses the Move's native rate (~48 kHz assumed
  — confirm from `ablspi.ko` driver or by reading dronage's audio block math).
- **Module preset path**: do plugins read their presets relative to their own
  `.so` path, or relative to CWD? Check `host_api_v1_t.get_module_dir()`.
- **Volume / gain staging**: the SPI audio output is raw int16 — need to
  understand the expected full-scale level to avoid clipping.
- **MIDI channel routing**: which USB-MIDI cable/channel do the plugins
  actually respond to? Schwung chains use cable 0 ch 0 by default.
