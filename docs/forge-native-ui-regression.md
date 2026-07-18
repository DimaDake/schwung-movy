# Forge — native-UI regression & missing per-voice FX sends

**Status:** open problem, no fix applied. This documents two defects in the
Forge build currently deployed to the device (the `per-voice-cc` branch,
filliformes/forge-move#1 / DimaDake/forge-move@`a30d6bc`), the full chain of
requirements that produced them, and the design tension that any fix must
resolve. It is the decision record for the fix; see **Fix options** at the end.

Related: [`forge-dependency.md`](forge-dependency.md) (the per-voice-CC feature
this build introduced) and [`enum-automation-chain-fix.md`](enum-automation-chain-fix.md).

---

## Symptoms (as reported)

1. **Native schwung UI (Forge without movy) is broken.** Every voice parameter
   now shows its **raw `cv_` key** as its label (e.g. `cv_wave`, `cv_vol`)
   instead of a readable name, and **some params cannot be edited at all** —
   notably the **waveform** selector. A clear regression versus stock Forge.
2. **movy is missing the per-voice FX (Reverb / Delay) sends.** There is no way
   to set a voice's reverb or delay send amount from the movy UI.

The two have **independent root causes**; only #1 is caused by the patch.

---

## Problem 1 — native UI shows `cv_` keys and can't edit enums

### Root cause

A schwung module declares two things the native UI consumes:

- **`capabilities.chain_params`** — the flat list of parameters with their
  metadata (`key`, display `name`/label, `type`, `min`/`max`, enum options).
- **`capabilities.ui_hierarchy`** — which parameter **keys** appear on which
  page/knob.

The native UI walks `ui_hierarchy`, and for each key it looks up the matching
`chain_params` entry to get the **label** and the **type/enum options** it needs
to render and edit the control. **If a key in `ui_hierarchy` has no
`chain_params` entry, the UI falls back to showing the raw key and has no type
metadata — so an enum like the waveform can't be cycled.**

Our `per-voice-cc` commit broke exactly this invariant:

| module.json | `chain_params` total | `cv_` in chain_params | `pv_` in chain_params | `ui_hierarchy` `cv_` refs | consistent? |
|---|---|---|---|---|---|
| **pre-patch** (`a30d6bc~1`, stock) | 193 | **95** | 0 | 95 | ✅ every ref resolves |
| **patched** (`a30d6bc`, deployed) | 250 | **0** | 152 | 95 | ❌ **95 dangling refs** |

The patch **removed all 95 `cv_` params from `chain_params`** (to make room for
the 152 `pv_` params under the 256-param cap — see below) **but never touched
`ui_hierarchy`, which still references those 95 `cv_` keys.** So on the deployed
build the native UI resolves *nothing* for its voice knobs → raw `cv_` labels,
and the **29 `cv_` enum params lose their options and become uneditable**:

```
cv_vpreset  cv_wave*   cv_op       cv_click_type cv_click_smp cv_xfm
cv_noise_type cv_f1_type cv_routing cv_f2_type   cv_bw_on     cv_e2_dest
cv_pe_dest  cv_lfo_w   cv_lfo_w2   cv_lfo_s      cv_xlfo_src  cv_trig_rst
cv_mod_dest cv_lfo_pol cv_lfo_rt   cv_mod_src    cv_mod_crv   cv_algo
cv_choke    cv_bus     cv_poly     cv_init       cv_mute
        (* cv_wave = the waveform selector the user found uneditable)
```

The DSP still *handles* `cv_*` set/get (the aliases were never removed from
`forge.c`), so a write would land — but the native UI can't issue an enum edit
without the options metadata, which is why waveform appears frozen.

### The incorrect assumption that led here

The decision to drop `cv_*` from `chain_params` rested on the belief that
*"CC-controlling the current voice is meaningless, and native UI editing uses
`knob_<N>_adjust`, not `chain_params`"* (recorded in the PR framing and in
memory). The first half is fine. **The second half is wrong:** native editing
issues *deltas* via `knob_<N>_adjust`, but the **labels and enum type/options it
renders and needs to perform those edits come from `chain_params`** (resolved
through `ui_hierarchy`). Removing `cv_*` from `chain_params` therefore broke the
native voice UI even though the adjust path still exists.

---

## Problem 2 — movy never exposed the per-voice FX sends

Independent of the patch. Forge provides per-voice send amounts into its two
send FX (**FX1 → Reverb, FX2 → Delay**):

- `cv_fx1` / `cv_fx2` — current-voice sends (labels *FX1 Send* / *FX2 Send*).
- `v1_fx1 … v8_fx1`, `v1_fx2 … v8_fx2` — per-index sends (these are among the 32
  `v<N>_` keys `{lvl, pan, fx1, fx2}` that live in `chain_params` in **both**
  stock and patched builds).

movy's `src/modules/forge.json` only surfaces the **global** FX params
(`rev_*`, `dly_*`) in its `FX` bank and the `all_fx` macro in `Perf`. **No
pad-specific bank contains `cv_fx1`/`cv_fx2`**, so the per-voice sends are
simply not on any page. This is a config-completeness gap, fixable purely in
`forge.json` by adding *FX1 Send* / *FX2 Send* to a pad-specific bank (they map
through padScoping to `pv{pad}_fx1`… **note:** the `pv_` set does **not** include
`fx1/fx2` — the concrete per-index keys are `v{pad}_fx1`/`v{pad}_fx2`, so the
config must scope to `v{pad}_` for sends, not `pv{pad}_`).

---

## The requirement chain that produced Problem 1

1. **movy edits Forge voices individually.** Forge is an 8-voice (×2 kits) drum
   synth. movy presents each pad as a voice and must read/write that specific
   voice's parameters.
2. **Stock Forge only had current-voice aliases `cv_*`.** These resolve to
   *whichever voice last played a note* (`current_voice`), which the sequencer
   moves constantly — so addressing a fixed voice through `cv_*` is racy.
3. **→ Added per-index `pv<N>_<field>` keys** (playback-safe, write straight to
   `kit_{a,b}[voice]`). movy's padScoping maps `cv_vol` → `pv3_vol` etc. This is
   the legitimate, upstreamable feature in forge-move#1.
4. **movy wanted per-voice *automation*, not just editing.** Automation routes a
   CC lane through the chain host's `knob_find_param`, which **aborts if the
   target key is not declared in `chain_params`.** So the `pv_` keys had to be
   *declared in `chain_params`* for automation to be audible.
5. **The 256-param cap forced a cut.** `chain_params` is capped at
   `MAX_CHAIN_PARAMS = 256` (schwung `chain_internal.h`). Declaring the full
   per-voice set for automation overflowed:

   ```
   stock (with cv_)            = 193   (95 cv_ + 32 v#_ + 66 globals/master/kit/fx)
   + 152 pv_ (19 fields × 8)   = 345   → 89 over the 256 cap
   ```

   To fit, the patch **dropped the 95 `cv_`** (193 − 95 + 152 = **250 ≤ 256**).
6. **That cut is what broke the native UI** — because, per the wrong assumption
   above, `cv_*` was believed unused by the native UI. It wasn't.

So Problem 1 is the collision of three hard requirements — *native UI needs
`cv_` in `chain_params`*, *per-voice automation needs `pv_` in `chain_params`*,
and *`chain_params` ≤ 256* — resolved (incorrectly) by sacrificing the first.

### Key fact that widens the fix space

movy's per-voice **editing** (direct `shadow_set_param`/`get_param` on a
concrete key) works **without** the key being in `chain_params` — the DSP's
`set_param`/`get_param` handle it directly (this is how the empty-`chain_params`
drum modules like weird-dreams work; see
[[project_config-range-drift-audit]]). **Only per-voice *automation* (CC lanes)
requires `pv_` in `chain_params`.** Therefore native `cv_` and movy per-voice
editing can coexist with zero `pv_` in `chain_params`; only per-voice automation
is in tension with the cap.

---

## Budget arithmetic (for any curated fix)

```
Fixed cost (must keep):   95 cv_  +  32 v#_  +  66 other  = 193
Remaining under cap:      256 − 193                        =  63  slots for pv_
Full per-voice set:       19 fields × 8 voices             = 152  (89 too many)
Fits in 63:               7 fields × 8 voices = 56, or 8×8 = 64 (1 over)
```

I.e. keeping native `cv_` leaves room to automate **~7 hand-picked fields across
the 8 Kit-A voices**, not the full 19.

---

## Fix options

Each assumes the patched `dsp.so` (which handles both `cv_*` and `pv_*`) stays
deployed; the differences are in `module.json` (`chain_params`/`ui_hierarchy`)
and the PR.

### A. Restore `cv_`, drop `pv_` from `chain_params` (keep `pv_` in the DSP)
Revert `module.json` to the pre-patch layout (95 `cv_` back in `chain_params`,
`ui_hierarchy` already matches). Keep the patched `dsp.so`.
- Native UI: ✅ works. movy per-voice **editing**: ✅ (direct `pv_`/`v_` writes).
- movy per-voice **automation**: ❌ dropped (no `pv_` in `chain_params`).
- On-device this is nearly free: the stock `module.json.orig` is preserved in
  the Forge module dir (per `forge-dependency.md`) — restore it, keep `dsp.so`.
- The PR must be corrected the same way (don't remove `cv_`); it then documents
  `pv_` as **DSP-level per-voice access** (deterministic editing + external
  direct control) rather than claiming chain-host automation.

### B. Curate to fit both (native + partial automation)
Keep all 95 `cv_` **and** declare ~7 automatable fields × 8 Kit-A voices as `pv_`
(≤ 63) so both native rendering and a useful automation subset survive. Also fix
`ui_hierarchy` (it already only references `cv_`, so no change needed there).
- Native UI: ✅. movy editing: ✅. movy automation: ✅ for the curated fields.
- More work; requires choosing the 7 fields and reworking the PR's param budget.

### C. Pristine stock Forge (revert `module.json` **and** `dsp.so`)
- Native UI: ✅. movy per-voice editing: ❌ — movy addresses voices via `pv_`
  keys the **stock** DSP doesn't understand. **Not recommended.**

### Problem 2 (independent of A/B/C)
Add *FX1 Send* / *FX2 Send* to a pad-specific bank in `src/modules/forge.json`,
scoped to the concrete `v{pad}_fx1` / `v{pad}_fx2` keys (present in
`chain_params` in every build). Small config addition + a screenshot baseline.

---

## Recommendation

**A** to un-break the device immediately (native UI is a hard regression;
per-voice *automation* was never safely shippable under the cap and is what
caused the break), and correct forge-move#1 to stop removing `cv_`. Pursue **B**
later if per-voice automation is worth the curation. Do **Problem 2** in either
case.

---

## References

- Regression commit: DimaDake/forge-move@`a30d6bc` ("feat: per-voice CC control
  & automation (`pv<N>_` keys)"), branch `per-voice-cc`, PR filliformes/forge-move#1.
- Cap: schwung `chain_internal.h` `MAX_CHAIN_PARAMS 256`; CC routing abort in
  `chain_midi.c` `knob_find_param`.
- movy config: `src/modules/forge.json` (padScoping `cv_` → `pv{pad}_`).
- Evidence: `git show a30d6bc~1:src/module.json` vs `a30d6bc:src/module.json`
  (95 `cv_` in `chain_params` → 0; `ui_hierarchy` `cv_` refs unchanged at 95).
