#!/usr/bin/env python3
"""Add per-voice filter params to Forge's module.json chain_params so padScoped
filter automation resolves in the schwung chain host.

Why: the chain's absolute-knob automation (chain_midi.c) looks a param up in the
synth's declared chain_params (knob_find_param) to de-normalise the 0-127 value;
if the param isn't declared it silently aborts (`if (!pinfo) return;`). Forge's
pv<N>_ per-voice keys (added by forge-per-voice-params.patch) are handled by the
DSP but not declared, so their automation never applied.

The chain caps params at 256 (MAX_CHAIN_PARAMS) and Forge already declares 193,
so only the filter trio (cut/res/type) x 16 pads = 48 fits (241 total). Other
per-voice params stay hand-editable but are not host-automatable. Purely
additive metadata — native Forge never references pv_ keys.

Usage:
    python3 forge-add-automation-params.py path/to/forge-move/src/module.json
"""
import json, os, sys

def main(path):
    d = json.load(open(path))
    cp = d['capabilities']['chain_params']
    have = {p['key'] for p in cp if isinstance(p, dict)}
    added = 0
    for v in range(1, 17):                       # pv1-8 = Kit A voices, pv9-16 = Kit B
        for key, meta in (
            (f'pv{v}_f1_cut',  {'name': f'V{v} Cut',  'type': 'float', 'min': 0,   'max': 1}),
            (f'pv{v}_f1_res',  {'name': f'V{v} Res',  'type': 'float', 'min': 0.5, 'max': 20}),
            (f'pv{v}_f1_type', {'name': f'V{v} FTyp', 'type': 'int',   'min': 0,   'max': 10}),
        ):
            if key in have:
                continue
            cp.append({'key': key, **meta})
            added += 1
    assert len(cp) <= 256, f'chain_params {len(cp)} exceeds MAX_CHAIN_PARAMS 256'
    open(path, 'w').write(json.dumps(d, separators=(',', ':')))
    assert os.path.getsize(path) <= 65536, 'module.json exceeds the 65536-byte parse cap'
    print(f'added {added} pv_ params; chain_params now {len(cp)}, file {os.path.getsize(path)} bytes')

if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'src/module.json')
