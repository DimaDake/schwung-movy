# Module inventory dump (2026-07-15)

Goal: a repeatable, git-checked-in snapshot of every module installed on the
device (midi_fx / sound_generators / audio_fx) capturing both the **native
schwung view** (module.json, live `ui_hierarchy`, live `chain_params`,
current values, presets) and the **movy view** (exact banks/pages/knobs movy
computes, with labels, types, ranges, steps, render styles, increment
semantics). Used as the data source for deciding UI improvements.

## Why load each module live

`ui_hierarchy` / `chain_params` may be static in `module.json` *or* generated
at runtime by the DSP (`get_param`). Drum modules generate per-pad params
dynamically, so only a live load gives the truth. Loading a module into a
chain slot via `shadow_set_param(ck+':module', id)` is exactly what movy's
own module browser does, so it is a supported operation.

## Pieces

1. **`scripts/dump-tool/ui.js`** — throwaway collector (plain JS, no build),
   deployed *over movy's own on-device `ui.js`* and opened as tool id `movy`
   (the shadow UI caches its tool list, so a brand-new tool dir is invisible
   to `open_tool_cmd` until the Tools menu rescans; the real `ui.js` is
   restored afterwards — a trap restores it even on script failure).
   State machine driven from `tick()`:
   - scan the three module dirs, read every `module.json` (+
     `movy_config.json` override if present);
   - save the original `midi_fx1/synth/fx1` module ids of the focused slot;
   - per module: set `ck:module`, poll (time-based, 10 s timeout) until the
     read-back matches and `ui_hierarchy`/`chain_params` appear (grace
     window for modules that expose neither);
   - capture: parsed hierarchy + chain_params, per-key current values
     (defaults), `ck:name`, preset count/names when the hierarchy declares
     `list_param`/`count_param`, load time, status;
   - write the accumulated dump to
     `/data/UserData/schwung/movy-module-dump.json` after **every** module
     (crash-safe), restore the original chain, mark `complete`, exit.
   - Progress bar rendered with `fill_rect` only (no font dependency).

2. **`scripts/dump-modules.sh`** — orchestrator: SSH check → scp tool to
   `modules/tools/movy-dump/` → open via `open_tool_cmd` shm poke → poll the
   dump file for `"complete"` → scp back to
   `docs/module-dump/device-dump.json` → remove tool + on-device dump → run
   the layout generator.

3. **`scripts/dump-movy-layout.mjs`** — local node script. Stubs
   `shadow_*`/`host_read_file` globals from the device dump (same pattern as
   `browser-test/logic.mjs`), boots the **real** model
   (`dist/esm/model/index.js`) per module under its component key, and
   serializes `model.dumpLayout()` (new debug accessor) plus per-page
   ViewModel extras (envelope lines, LFO viz) into
   `docs/module-dump/modules/<category>--<id>.json`, and a human-readable
   `docs/module-dump/SUMMARY.md` with per-module anomaly notes (hidden
   params, missing metadata, label truncation…).

4. **`model.dumpLayout()`** — new read-only method on the model returning
   `{ moduleId, bankNames, params }` so external tooling sees the exact
   layout (raw step values are not otherwise reachable via the public API).

## Increment semantics recorded per param

- float/int arc: one detent = `step × ARC_DELTA_SCALE (0.5)`
- float/int hbar/vbar/preset: one detent = `step`
- enum: `ENUM_DELTA_DIV (4)` detents per option step
- plus `detentsFullSweep = (max − min) / perDetent`

## Output layout (checked in)

```
docs/module-dump/
  device-dump.json          raw device capture (source of truth)
  modules/<cat>--<id>.json  merged native + movy layout per module
  SUMMARY.md                human-readable index + anomalies
  IMPROVEMENTS.md           analysis → proposed improvements
```

## Side effects / caveats

- Running the dump loads every installed module into track 1's chain slots;
  the previous modules are restored afterwards but their *edited* params may
  reset to defaults. Run on a dev device / saved set.
- Master FX slots are not dumped separately: they host the same audio_fx
  modules (only the load key differs — path vs id).
