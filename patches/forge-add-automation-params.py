#!/usr/bin/env python3
"""Rewrite Forge's module.json chain_params so movy's padScoped per-voice filter/
env/etc. automation resolves in the schwung chain host.

Background: the chain de-normalises step automation by looking the target param
up in the synth's declared chain_params (knob_find_param); an undeclared param
silently aborts (`if (!pinfo) return;`). Forge's pv<N>_ per-voice keys (from
forge-per-voice-params.patch) are DSP-handled but not declared, so per-voice
automation produced the dot but no audio.

The chain caps params at 256 (MAX_CHAIN_PARAMS). To make room this script DROPS
the 95 cv_* current-voice aliases — they're only needed for NATIVE per-voice
*automation* (movy uses pv_; native manual editing uses knob_<N>_adjust, neither
of which needs cv_ in chain_params) — and declares the automatable set for Kit A
(pv1-8): 19 continuous params x 8 voices = 152, well under the cap.

Not automatable (marked automatable:false in movy_config.json instead): discrete
choices (wave/type/routing/algo/…), set-and-forget (detune/bw/glide/vsens), and
all of Kit B. Purely additive/subtractive metadata — native Forge never
references pv_ keys and edits per-voice via knob_adjust, not chain_params.

Usage: python3 forge-add-automation-params.py path/to/forge-move/src/module.json
"""
import json, os, sys

# Continuous per-voice params that ARE host-automatable (by cv_ suffix).
AUTO = [
    'level', 'pwm', 'fbk',                                   # Osc
    'f1_cut', 'f1_res', 'f1_drv', 'f2_cut',                  # Filter
    'e1_atk', 'e1_dec', 'e1_crv', 'e1_rep',                  # Env 1
    'e2_dec', 'e2_crv', 'pe_amt', 'pe_dec',                  # Env 2 / pitch env
    'lfo_r', 'lfo_d', 'mod_dpth',                            # Mod
    'tune',                                                  # Setup
]
KIT_A_VOICES = 8

def main(path):
    d = json.load(open(path))
    cp = d['capabilities']['chain_params']
    meta = {p['key']: p for p in cp if isinstance(p, dict)}
    # Range/type per automatable param, sourced from its cv_ declaration.
    ranges = {}
    for s in AUTO:
        cv = meta.get('cv_' + s)
        assert cv, f'cv_{s} not found in chain_params'
        ranges[s] = {k: cv[k] for k in ('type', 'min', 'max') if k in cv}
    # Drop cv_* (frees 95 slots); keep everything else.
    kept = [p for p in cp if not (isinstance(p, dict) and p['key'].startswith('cv_'))]
    # Declare pv1..8_<suffix> for the automatable set.
    for v in range(1, KIT_A_VOICES + 1):
        for s in AUTO:
            kept.append({'key': f'pv{v}_{s}', 'name': f'V{v} {s}', **ranges[s]})
    d['capabilities']['chain_params'] = kept
    assert len(kept) <= 256, f'chain_params {len(kept)} exceeds MAX_CHAIN_PARAMS 256'
    open(path, 'w').write(json.dumps(d, separators=(',', ':')))
    assert os.path.getsize(path) <= 65536, 'module.json exceeds the 65536-byte parse cap'
    print(f'chain_params: dropped cv_*, added {len(AUTO)}x{KIT_A_VOICES}='
          f'{len(AUTO)*KIT_A_VOICES} pv_ → {len(kept)} total, {os.path.getsize(path)} bytes')

if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'src/module.json')
