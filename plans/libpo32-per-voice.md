# Libpo32 per-voice control & automation (mirror of the Forge work)

## Motivation (what we did for Forge, and why)

Forge exposed its 8 per-voice banks only through a **stateful "current voice"**
protocol (`cv_*` aliases selected by pad note). That makes per-voice CC control
and automation impossible/ambiguous — "the current voice" is meaningless as a
CC target, and two automation lanes targeting different voices fight over the
selector. The Forge fix:

1. **Per-index direct keys** (`pv<N>_<field>`) that write straight to the
   voice bank — playback-safe, race-free, automatable per voice. (headline)
2. Framed as an **upstream feature/PR** to the module's own repo, not a movy
   patch — it benefits any host.
3. **256-param cap** resolved via schwung's inline `ui_hierarchy`/`chain_params`
   metadata contract.
4. **Enum name/index consistency** — `set_param` must accept whatever
   `get_param` emits.
5. **Self-describing movy layout** — the module ships its own
   `movy_config.json`; movy's loader reads it (bundled config is only a
   fallback).

## Libpo32 today (the same gap)

`po32_drum.c` holds 16 `po32_patch_params_t` instruments, each **21 normalized
0–1 float fields** (`OscWave OscFreq OscAtk OscDcy ModMode ModRate ModAmt
NFilMod NFilFrq NFilQ NEnvMod NEnvAtk NEnvDcy Mix DistAmt EQFreq EQGain Level
OscVel NVel ModVel`). Per-voice editing is the **stateful selector** pattern:
`set_param("inst", N)` then `inst_wave/inst_freq/...` (only **10** of 21 fields)
writing to `m->patches[selected_inst]`. The module's own `ui.js` drives it
(Sounds → pad → params). At chain level libpo32 exposes only 3 globals
(`kit/level/decay`) — **no per-voice automation at all**.

Differences from Forge that make this *simpler*:
- `selected_inst` is touched only by the UI thread; the audio thread copies
  `m->patches[inst-1]` in `trigger_voice`. Direct per-index writes are
  inherently safe (single float writes; worst case a benign torn read of one
  patch that's about to be copied).
- Enums already round-trip as **indices** in both get and set — no name/index
  asymmetry to fix (goal 4 is already satisfied; keep the new keys consistent).
- All fields are already normalized 0–1 — clean metadata.

## Plan

### A. DSP — `drums/libpo32` (fork → DimaDake, branch `per-voice-cc`)

`src/dsp/po32_drum.c`:

1. **Voice-field table** mapping a short suffix → struct field index + kind
   (FLOAT | ENUM3). All 21 fields covered.
2. `voice_field_lookup("v<N>_<suffix>")` → voice (1..16), field idx, kind.
3. `set_param`: `v<N>_<suffix>` writes `m->patches[N-1].<field>` directly
   (floats raw 0–1; ENUM3 index 0/1/2 → 0.0/0.5/1.0). No `selected_inst`
   mutation. Additive — legacy `inst`/`inst_*` untouched.
4. `get_param`: `v<N>_<suffix>` reads the field (floats "%.4f" raw; ENUM3 →
   index). Raw values for state round-trip.
5. `get_param("chain_params")`: generate JSON dynamically — 3 globals + 16
   voices × a curated automatable set (continuous fields), each with inline
   metadata (label/type/min/max/step/options). Keep total **< 256**.
   (schwung: chain host tries the plugin first for `chain_params`.)
6. Keep static `module.json` `ui_hierarchy` (root globals) — native per-voice
   editing already works via `ui.js`, so no hierarchy churn.

`src/movy_config.json` (new, canonical): 16-pad per-voice layout, `padScoping`
`v_ → v{pad}_` (padDigits 1), pad-specific banks (Osc / Mod / Noise-Filter /
Env / Mix) + a global Main bank (kit/level/decay/randomize/save). Filter viz
tags on the noise filter (cutoff=nffrq, resonance=nfq, mode=nfmode).

`scripts/build.sh`: copy `src/movy_config.json` into `dist/`.

Bump `module.json`/`release.json` version.

### B. Verify

- Native harness (`cc` on macOS; `po32_drum.c` + deps compile freestanding
  with libc): dlopen-free direct call of `move_plugin_init_v2`, assert
  `v5_freq` set/get roundtrip writes patches[4] and does NOT touch
  `selected_inst`; parse `chain_params` JSON, assert valid + count < 256.
- ARM build via Docker (`scripts/build.sh`) → `dist/dsp.so`.
- Device: deploy via `scripts/install.sh` (device is reachable); confirm load.

### C. movy

- `browser-test/fixtures/libpo32-movy-config.json` — snapshot of the module's
  `movy_config.json` (tests serve it; mirror Forge fixture).
- Keep bundled `src/modules/libpo32.json` as the **3-global fallback** for
  devices still running the old DSP (graceful degradation — the full layout is
  useless until the new `dsp.so` with `v<N>_` keys is deployed).
- Update `dump-expect.json`, screenshot baselines; run all local tests.
- Docs: `MANUAL.md` (+`README.md` headline), `docs/libpo32-dependency.md`
  linking the PR.

### D. Upstream + commits

- Push branch to `DimaDake/schwung-libpo32`, open PR to `mestela/...`
  feature-first (no movy mention).
- Commit movy changes.

## Curated automatable per-voice set (continuous, for `chain_params`)
freq, atk, dcy, mrate, mamt, nffrq, nfq, neatk, nedcy, mix, dist, lvl
(12 × 16 = 192 + 3 globals = 195 < 256). All 21 remain **editable** via direct
keys; only these are flagged automatable.
</content>
</invoke>
