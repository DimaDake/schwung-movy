/* step-params-contract.ts — the virtual-component cell table for the step
 * page (SP-54), the seam's third component after Clip/Set Params.
 *
 * FURTHER NATIVE THAN SP-53 COULD GO: LENGTH/PROBABILITY/CONDITION already
 * have a fixed label array (`LENGTH_LABELS`/`PROB_LABELS`/`COND_LABELS` in
 * `step-page-vm.ts`), so all three map straight onto Schwung's own
 * enum-square with no widget at all — INVERT is `toggle`, exactly like Set
 * Params' LINK.
 *
 * VELOCITY'S PICTURE CAME BACK WITHOUT A MOVY WIDGET (SP-57). This entry used
 * to record the `vbar` as lost, on the reasoning that taking it back meant
 * hand-drawing and pixel-verifying a canvas widget. It did not: `chain_params`
 * is movy's string to write, a declared `viz` reaches `viz.mjs` through it, and
 * Schwung ships a fader of its own. The follow-up was one field, not a widget.
 *
 * WRITES GO THROUGH THE SAME FIVE FUNCTIONS THE DELTA PATH USES
 * (`seq/step-edit.ts`'s `applyStep*`) — one writer, two callers; see that
 * file's header.
 *
 * A SINGLETON, like Clip/Set Params: this object is stateless (every read
 * closes over live `seqState.hold*` fields), so nothing here needs rebuilding
 * per hold. What DOES need a per-hold reset is the cached `SchwungPage`
 * wrapping it — `seq/step-page.ts` drops that on every session end via
 * `schwungGridDrop`, not by rebuilding this source.
 */

import { seqState } from './state.js';
import {
    LENGTH_LABELS, PROB_LABELS, PROB_VALUES, COND_LABELS,
    lengthIndexForTicks, probIndexForPct, condIndexFor,
} from './step-page-vm.js';
import {
    applyStepVelocityAbs, applyStepLenIdx, applyStepProbIdx,
    applyStepCondIdx, applyStepInvertOn,
} from './step-edit.js';
import { createVirtualSource, type VirtualCellSpec } from '../renderer/schwung-virtual-source.js';
import type { PageParamSource } from '../renderer/schwung-page-source.js';
import { STEP_PARAMS_COMPONENT } from '../chain/config.js';

const asIndex = (v: string): number => Math.round(Number(v)) || 0;

const cells: VirtualCellSpec[] = [
    {
        key: 'vel', name: 'Velocity', shortName: 'VEL', type: 'int', min: 0, max: 127, step: 8,
        /* The `vbar` picture this file's header recorded as lost, taken back as
         * SCHWUNG'S OWN fader rather than a movy widget — the page stays native
         * and nothing has to be registered or drawn here.
         *
         * Declared because nothing detects it: the fader detector matches on
         * NAME against a closed list of fourteen, `vel` is not among them, and
         * measured over this contract no detector claims any cell at all. A
         * unipolar 0..127 level is what `drawFader` draws honestly — the
         * detector's own "no negative minimum" rule is about guessing, and does
         * not gate a declaration. */
        viz: { kind: 'fader' },
        get: () => String(seqState.holdVel),
        set: (v) => applyStepVelocityAbs(asIndex(v)),
    },
    {
        key: 'len', name: 'Length', shortName: 'LEN', type: 'enum', options: LENGTH_LABELS,
        get: () => String(lengthIndexForTicks(seqState.holdGate)),
        set: (v) => applyStepLenIdx(asIndex(v)),
        /* No "indeterminate" shape in `chain_params` (the ledger's own
         * finding) — the arc rests on whichever length the first held step
         * reports (same tradeoff Clip Params' drum-track TRANSPOSE already
         * made), and only the PRINTED text says the held steps disagree. */
        format: (_raw, _surface) => (seqState.holdGateMixed ? '...' : null),
    },
    {
        key: 'prob', name: 'Probability', shortName: 'PROB', type: 'enum',
        /* Schwung's own turn convention is FIXED, not something a contract can
         * flip: CW always INCREASES the wire index (`knob_engine.mjs`'s enum
         * branch adds a positive step for a positive direction). `PROB_VALUES`
         * is stored DESCENDING (100% first) to match movy's OWN off-arm math,
         * which SUBTRACTS a CW detent from the index for exactly this reason
         * (`step-edit.ts`'s knob-2 branch) — so under delegation the wire has
         * to present the REVERSED list, or a delegated CW turn would LOWER
         * probability, backwards from every other arm of this control. */
        options: [...PROB_LABELS].reverse(),
        get: () => String(PROB_VALUES.length - 1 - probIndexForPct(seqState.holdProb)),
        set: (v) => applyStepProbIdx(PROB_VALUES.length - 1 - asIndex(v)),
    },
    {
        key: 'cond', name: 'Condition', shortName: 'COND', type: 'enum', options: COND_LABELS,
        get: () => String(condIndexFor(seqState.holdCondA, seqState.holdCondB)),
        set: (v) => applyStepCondIdx(asIndex(v)),
    },
    {
        key: 'invert', name: 'Invert', shortName: 'INV', type: 'toggle',
        get: () => (seqState.holdInvert ? '1' : '0'),
        set: (v) => applyStepInvertOn(asIndex(v) === 1),
    },
];

let source: PageParamSource | null = null;
export function stepParamsSource(): PageParamSource {
    return source ?? (source = createVirtualSource(STEP_PARAMS_COMPONENT, cells));
}
