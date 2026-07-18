# Forge — per-voice CC dependency

> ⚠️ **Known regression — read first.** The current `per-voice-cc` build breaks
> the **native** Forge UI (voice params show raw `cv_` keys; enums like waveform
> can't be edited) because it removed `cv_*` from `chain_params` to fit `pv_*`
> under the 256-param cap, but `ui_hierarchy` still references `cv_*`. It also
> never surfaced the per-voice FX sends in movy. Full analysis, requirement
> chain, and fix options: [`forge-native-ui-regression.md`](forge-native-ui-regression.md).

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

```bash
git clone -b per-voice-cc https://github.com/DimaDake/forge-move && cd forge-move
# aarch64 cross-compile (glibc 2.17; under the device's 2.35 ceiling):
aarch64-linux-gnu-gcc -O2 -ffast-math -shared -fPIC \
    -Wall -Wno-unused-parameter -Wno-unused-variable -Wno-unused-but-set-variable \
    -o dsp.so src/dsp/forge.c -lm
FDIR=/data/UserData/schwung/modules/sound_generators/forge
scp dsp.so     ableton@move.local:$FDIR/dsp.so.new    # atomic — never scp over a dlopen'd .so
scp src/module.json ableton@move.local:$FDIR/module.json
ssh ableton@move.local "cd $FDIR && mv dsp.so.new dsp.so"
```

Once merged and released, this reduces to "requires Forge ≥ &lt;version&gt;".

## Notes

- The `pv<N>_` DSP handling and its `chain_params` declarations live entirely in
  Forge (the PR above). movy contributes only its own `src/modules/forge.json`
  layout, which references the keys.
- The chain host caps declared params at 256, so the PR declares the per-voice
  set for **Kit A (voices 1–8)**; movy marks the rest `automatable: false` and
  gates Kit B via `drum.automatablePads`.
