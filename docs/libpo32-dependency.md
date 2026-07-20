# Libpo32 — per-voice CC dependency

movy's Libpo32 support edits and automates **individual voices**
(playback-safe), which relies on Libpo32 exposing per-index **`v<N>_<field>`**
parameter keys for CC control/automation. Stock Libpo32 only exposes per-voice
params through a **stateful selector** (`set_param("inst", N)` then `inst_*`),
which can't express per-voice CC — "the current voice" is an ambiguous, racy
target, and only 10 of the 21 fields are reachable.

The per-voice keys are a general Libpo32 feature (not movy-specific):

> **mestela/schwung-libpo32 — Per-voice CC control & automation (`v<N>_` keys)**
> Branch `per-voice-cc` on the fork `DimaDake/schwung-libpo32`.
> Open the PR: <https://github.com/mestela/schwung-libpo32/compare/main...DimaDake:per-voice-cc?expand=1>

Writes go straight to the voice's patch and never touch the selected-voice
state, so per-voice automation is safe while notes play and can drive several
voices at once. The curated continuous set (12 fields × 16 voices + 3 globals =
195, under the chain's 256-param cap) is declared in the module's `module.json`
`chain_params` — **required**: the chain host builds its knob/automation mapping
table from `module.json` (not the plugin's `get_param`), and only maps
`chain_params` when the `ui_hierarchy` root params carry no inline `type`
metadata. All 21 fields stay settable directly.

`movy_config.json` maps its `v_` aliases to `v{pad}_` concrete keys via
padScoping (`padDigits: 2`, so voices 1–16 become `v01_`…`v16_`), so movy
addresses a fixed voice deterministically.

## Notes

- The `v<N>_` DSP handling and its `chain_params` live entirely in Libpo32 (the
  PR above). The movy page/knob layout is **owned by Libpo32 too**:
  `src/movy_config.json` in the schwung-libpo32 repo, packaged and deployed by
  its `build.sh`/`install.sh` to the module dir, where movy's loader picks it up
  (self-describing module). movy keeps the bundled `src/modules/libpo32.json`
  only as a **3-global fallback** for devices still running the old DSP, plus a
  fixture snapshot at `browser-test/fixtures/libpo32-movy-config.json` for its
  tests — sync the fixture when the schwung-libpo32 layout changes.
- The legacy `inst`/`inst_*` protocol and the module's own `ui.js` menu are
  unchanged, so the native per-voice editing UI still works.

## Until the PR is merged

Deploy Libpo32 built from the feature branch:

```bash
cd schwung-libpo32
./scripts/build.sh      # Docker ARM64 cross-compile → dist/po32-drum
./scripts/install.sh    # scp to move.local, fix ownership
```

Then reload the module (or power-cycle the Move) so the chain host re-reads the
new `chain_params` and `movy_config.json`.
