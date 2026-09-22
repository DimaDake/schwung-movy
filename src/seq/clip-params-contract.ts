/* clip-params-contract.ts — the virtual-component cell table for Clip Params
 * (SP-53). One table feeds both halves of the seam: the `ui_hierarchy`/
 * `chain_params` contract movy hands Schwung (`createVirtualSource`) and the
 * read/write for each key — declared here, once, so the two cannot drift the
 * way a page's read and its plan drifted before SP-20.
 *
 * NATIVE FIRST (the ledger's own rule): every cell is a plain `enum`/`int`, no
 * `vizOverrides`. SCALE and QUANT draw as Schwung's ordinary enum-square,
 * LENGTH and TRANSPOSE as its ordinary numeric dial — not movy's big-font
 * "preset" look. TRANSPOSE's drum-track "n/a" is the one reading only movy
 * can compute, so it is `format()`, not a widget.
 *
 * WRITES GO THROUGH THE SAME FOUR FUNCTIONS THE DELTA PATH USES
 * (`seq/clip-page.ts`'s `applyClip*`) — Schwung hands an ABSOLUTE value, never
 * a delta, which is exactly what those take. One writer, two callers; see
 * that file's header.
 */

import { appState, trackIsDrum } from '../app/state.js';
import { seqState } from './state.js';
import { MAX_STEPS } from './constants.js';
import { SCALE_LABELS, SCALE_RATIONALS } from './clip-scale.js';
import { QUANT_LABELS, QUANT_VALUES, quantIndexForPct } from './quant.js';
import { applyClipScaleIdx, applyClipLength, applyClipTranspose, applyClipQuantIdx }
    from './clip-page.js';
import { createVirtualSource, type VirtualCellSpec } from '../renderer/schwung-virtual-source.js';
import type { PageParamSource } from '../renderer/schwung-page-source.js';
import { CLIP_PARAMS_COMPONENT } from '../chain/config.js';

const TRANSPOSE_MIN = -36, TRANSPOSE_MAX = 36;

const activeTrack = () => appState.activeTrack.index;
const asIndex = (v: string): number => Math.round(Number(v)) || 0;

const cells: VirtualCellSpec[] = [
    {
        key: 'scale', name: 'Scale', shortName: 'SCALE', type: 'enum', options: SCALE_LABELS,
        get: () => String(seqState.clipScaleIdx),
        set: (v) => applyClipScaleIdx(activeTrack(), asIndex(v)),
    },
    {
        key: 'length', name: 'Length', shortName: 'LEN', type: 'int', min: 1, max: MAX_STEPS, step: 1,
        get: () => String(seqState.lenSteps),
        set: (v) => applyClipLength(activeTrack(), asIndex(v)),
        /* HEADER ONLY: the word is what tells 16 STEPS from 16 bars, and the
         * 30px cell has no room for it under a label that already says LEN.
         * Same split as TEMPO's bpm. */
        format: (raw, surface) =>
            (raw !== null && surface === 'header') ? raw + ' steps' : null,
    },
    {
        key: 'transpose', name: 'Transpose', shortName: 'TRANS', type: 'int',
        min: TRANSPOSE_MIN, max: TRANSPOSE_MAX, step: 1,
        /* Reports '0' on a drum track — the arc rests at its centre, matching
         * the `off` arm's own `normalizedValue: isDrum ? 0 : ...` (clip-page-vm.ts) —
         * while `format()` below is what actually prints "n/a"; the two must
         * agree or the printed text and the drawn position tell different
         * stories about the same knob. */
        get: () => trackIsDrum(activeTrack()) ? '0' : String(seqState.clipTranspose),
        set: (v) => applyClipTranspose(activeTrack(), asIndex(v)),
        format: (_raw, _surface) => trackIsDrum(activeTrack()) ? 'n/a' : null,
    },
    {
        key: 'quant', name: 'Clip Quantize', shortName: 'QUANT', type: 'enum', options: QUANT_LABELS,
        get: () => String(quantIndexForPct(seqState.clipQuant)),
        set: (v) => applyClipQuantIdx(activeTrack(), asIndex(v)),
    },
];

/* One instance for the process, like `hostPort`/`engineRootPort` — the cell
 * table closes over live state already, so there is nothing session-scoped to
 * rebuild per (track, component) the way a real module's port is. */
let source: PageParamSource | null = null;
export function clipParamsSource(): PageParamSource {
    return source ?? (source = createVirtualSource(CLIP_PARAMS_COMPONENT, cells));
}
