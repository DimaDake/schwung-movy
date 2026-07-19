# Forge — per-voice CC dependency

> The `per-voice-cc` branch briefly broke the **native** Forge UI (raw `cv_`
> labels, uneditable enums) by dropping `cv_*` from `chain_params`. **Fixed in
> `40d9d7f`**: `ui_hierarchy` is now self-describing (inline metadata), which
> the shadow UI supports as an equal metadata source — native UI and full
> per-voice automation coexist under the 256-param cap. History and analysis:
> [`forge-native-ui-regression.md`](forge-native-ui-regression.md).

movy's Forge support edits and automates **individual voices** (playback-safe),
which relies on Forge exposing per-index **`pv<N>_<field>`** parameter keys for
CC control/automation. Stock Forge only exposes the current-voice `cv_*` aliases,
which resolve to whichever voice last played a note — ambiguous under live CC and
single-voice only.

The per-voice keys are a general Forge feature (not movy-specific):

> **filliformes/forge-move#1 — Per-voice CC control & automation (`pv<N>_` keys)**

`movy_config.json` maps its `cv_` aliases to `pv{pad}_` concrete keys via
padScoping, so movy addresses a fixed voice deterministically.

## Until the PR is merged

Deploy Forge built from the feature branch. The stock module is preserved on the
device (`dsp.so.orig`, `module.json.orig`) so it's reversible.

The repo is cloned at `~/git/cld/forge-move` (branch `per-voice-cc`).

```bash
cd ~/git/cld/forge-move
# aarch64 cross-compile (glibc 2.17; under the device's 2.35 ceiling):
aarch64-linux-gnu-gcc -O2 -ffast-math -shared -fPIC \
    -Wall -Wno-unused-parameter -Wno-unused-variable -Wno-unused-but-set-variable \
    -o dsp.so src/dsp/forge.c -lm
FDIR=/data/UserData/schwung/modules/sound_generators/forge
scp dsp.so     ableton@move.local:$FDIR/dsp.so.new    # atomic — never scp over a dlopen'd .so
scp src/module.json ableton@move.local:$FDIR/module.json
ssh ableton@move.local "cd $FDIR && mv dsp.so.new dsp.so"
# module.json is cached by the dlopen'd dsp.so — reload the slot's synth
# (set synth:module=none then =forge, or reboot) to pick up changes.
```

Once merged and released, this reduces to "requires Forge ≥ &lt;version&gt;".

## Notes

- The `pv<N>_` DSP handling and its `chain_params` declarations live entirely in
  Forge (the PR above). The movy page/knob layout is **owned by Forge too**:
  `src/movy_config.json` in the forge-move repo, packaged and deployed by its
  build/install scripts to the module dir, where movy's loader picks it up
  (self-describing module; movy bundles no forge config). movy keeps only a
  fixture snapshot at `browser-test/fixtures/forge-movy-config.json` for its
  tests — sync it when the forge-move layout changes.
- The chain host caps declared params at 256, so the PR declares the per-voice
  set for **Kit A (voices 1–8)**; movy marks the rest `automatable: false` and
  gates Kit B via `drum.automatablePads`.
