# DSP patches (third-party modules)

Movy configs assume the module's DSP exposes the parameter keys the config
writes. When a stock module lacks a key we need, the change belongs in that
module's DSP source (a separate repo), and the built `dsp.so` is deployed to the
device. Patches captured here so the change is reproducible.

## forge-per-voice-params.patch

**Against:** [`filliformes/forge-move`](https://github.com/filliformes/forge-move)
`src/dsp/forge.c` (v0.2.0).

**Why:** Stock Forge exposes per-voice detail only through the `cv_*`
*current-voice* aliases, whose target voice is set by the incoming pad **note**
(`on_midi`: `voice = (note-36) % 8`, Kit context = `pad >= 8`). That is fragile
under movy's sequencer — playback notes retarget the edit. Weird Dreams, by
contrast, exposes per-index `v<N>_<param>` keys (playback-safe), which is what
movy's padScoping drives.

**What it adds:** direct per-index keys **`pv<N>_<field>`** (N = 1..16;
1-8 = Kit A voices, 9-16 = Kit B voices) covering the full `cv_*` field set.
It refactors `handle_cv_set` → `set_voice_field(voice_bank_t *vb, …)` so both
the `cv_*` path and the new `pv<N>_` path share one field table; writes go
straight to `kit_{a,b}[voice]` (race-free vs the audio-thread note handler).
Reads delegate through the `cv_*` reader with the voice context saved/restored.

movy's `forge.json` then uses padScoping `cv_ → pv{pad}_` — playback-safe,
instant, no MIDI selection. `movy/src/modules/forge.json`.

### Build & deploy

```bash
git clone https://github.com/filliformes/forge-move && cd forge-move
git apply /path/to/movy/patches/forge-per-voice-params.patch
# aarch64 cross-compile (glibc 2.17; well under the device's 2.35 ceiling):
aarch64-linux-gnu-gcc -O2 -ffast-math -shared -fPIC \
    -Wall -Wno-unused-parameter -Wno-unused-variable -Wno-unused-but-set-variable \
    -o dsp.so src/dsp/forge.c -lm
# Deploy atomically (never scp over a dlopen'd .so in place):
scp dsp.so ableton@move.local:/data/UserData/schwung/modules/sound_generators/forge/dsp.so.new
ssh ableton@move.local 'cd /data/UserData/schwung/modules/sound_generators/forge && mv dsp.so.new dsp.so'
```

The stock binary is backed up on the device at `…/forge/dsp.so.orig`.
Upstreaming this as a PR to forge-move would remove the need to re-patch on
module updates.

## Self-describing layout: `movy_config.json`

Forge is **not** bundled into movy (`src/modules/loader.ts` has no forge entry).
Instead the module ships its own layout: movy reads
`sound_generators/<id>/movy_config.json` at load time (see `loadModuleConfig`).
Forge's layout is authored in `movy/src/modules/forge.json` and deployed to the
module directory:

```bash
scp movy/src/modules/forge.json \
    ableton@move.local:/data/UserData/schwung/modules/sound_generators/forge/movy_config.json
```

The layout declares its **filter and LFO graphics explicitly** via per-slot tags
— `"filter": "cutoff"|"resonance"|"mode"|"slope"` and
`"lfo": "shape"|"rate"|"depth"|…` — so movy draws the Filter-page curve and
Mod-page waveform with no name-inference (the `cv_*` alias keys wouldn't be
detected anyway). Any module can become self-describing the same way.
