/* set-params-contract.ts — the virtual-component cell table for Set Params
 * (SP-53), the seam's second component after Clip Params.
 *
 * Same shape as `clip-params-contract.ts`: one table feeds both halves of the
 * contract movy hands Schwung and the read/write for each key. NATIVE FIRST,
 * same rule — TEMPO/SWING/ROOT are Schwung's ordinary numeric/enum cells, not
 * movy's big-font "preset" look; LINK is `type: 'toggle'`, which
 * `param_meta.mjs` normalises to a plain two-option enum ("Off"/"On"), so it
 * needs no `switch`-style widget either.
 *
 * LAYOUT IS THE ONE NEW SHAPE THIS FILE ADDS: its option list is a FUNCTION
 * (`() => layoutNames(keyboardState.mode)`), because it depends on MODE's
 * current value — `createVirtualSource` resolves it fresh on every contract
 * read, so a mode change reaches the next re-plan rather than staying stuck
 * on the list the page opened with.
 *
 * WRITES GO THROUGH THE SAME EIGHT FUNCTIONS THE DELTA PATH USES
 * (`seq/main-page-apply.ts`) — one writer, two callers; see that file's header.
 */

import { seqState } from './state.js';
import { keyboardState } from '../keyboard/state.js';
import { SCALE_NAMES } from './scales.js';
import { MODE_NAMES, layoutNames } from '../keyboard/layouts.js';
import { NOTE_NAMES } from '../keyboard/notes.js';
import { QUANT_LABELS, quantIndexForPct } from './quant.js';
import { applyTempoX100, applySwing, applyLink, applyDefaultQuantIdx,
         applyRootPc, applyScaleIdx, applyModeIdx, applyLayoutIdx } from './main-page-apply.js';
import { createVirtualSource, type VirtualCellSpec } from '../renderer/schwung-virtual-source.js';
import type { PageParamSource } from '../renderer/schwung-page-source.js';
import { SET_PARAMS_COMPONENT } from '../chain/config.js';
import { BIG_VALUE_KIND } from '../renderer/schwung-big-value.js';

const asIndex = (v: string): number => Math.round(Number(v)) || 0;

const cells: VirtualCellSpec[] = [
    {
        key: 'tempo', name: 'Tempo', shortName: 'TEMPO', type: 'int', min: 20, max: 300, step: 1,
        get: () => String(Math.round(seqState.bpmX100 / 100)),
        set: (v) => applyTempoX100(asIndex(v) * 100),
        /* The raw value stays a plain bpm number (so the arc/knob-state math
         * stays sane); only the PRINTED text carries a suffix, matching the
         * `off` arm's own displayValue (`main-page-vm.ts`).
         *
         * EXT WINS OVER THE UNIT, and only one of them can be shown: when the
         * clock is external, WHERE the tempo comes from is the more useful
         * reading of the two. The unit then rides the HEADER alone — "120 bpm"
         * does not fit a 30px cell, where the label underneath already says
         * TEMPO. */
        format: (raw, surface) => {
            if (raw === null) return null;
            if (seqState.extSync) return raw + ' EXT';
            return surface === 'header' ? raw + ' bpm' : null;
        },
    },
    {
        key: 'swing', name: 'Swing', shortName: 'SWING', type: 'int', min: 50, max: 80, step: 1,
        get: () => String(seqState.swingPct),
        set: (v) => applySwing(asIndex(v)),
        /* THE PERCENT SIGN IS THE READING, not decoration. Swing is the one
         * value on this page whose bare number reads as a count — 54 of what?
         * — and it is short enough for the 30px cell, so unlike tempo's unit it
         * goes on both surfaces. The `off` arm printed it the same way
         * (`main-page-vm.ts`'s `swing + '%'`). */
        format: (raw) => (raw === null ? null : raw + '%'),
        /* "Show swing the same way as before": the old page drew it in the big
         * preset face with its percent sign. Schwung's big number cannot —
         * span 30 is over the 24 cap, and its twelve-glyph face has no '%'.
         * The suffix rides the declaration so the widget prints the same
         * reading `format()` gives every other surface. */
        viz: { kind: BIG_VALUE_KIND, suffix: '%' },
    },
    {
        key: 'link', name: 'Play Link', shortName: 'LINK', type: 'toggle',
        get: () => (seqState.linkEnabled ? '1' : '0'),
        set: (v) => applyLink(asIndex(v) === 1),
    },
    {
        key: 'quant', name: 'Default Quantize', shortName: 'QUANT', type: 'enum', options: QUANT_LABELS,
        peek: false,          /* the labels fit their square */
        get: () => String(quantIndexForPct(seqState.defaultQuant)),
        set: (v) => applyDefaultQuantIdx(asIndex(v)),
    },
    {
        key: 'root', name: 'Root', shortName: 'ROOT', type: 'enum', options: NOTE_NAMES,
        /* Big, as the old page drew it; "C#" fits whole, so no overlay either.
         * KEY below keeps its overlay — scale names are words that do not fit
         * a 30px box, which is exactly the case the panel exists for. */
        viz: { kind: BIG_VALUE_KIND },
        peek: false,
        get: () => String(keyboardState.rootPc),
        set: (v) => applyRootPc(asIndex(v)),
    },
    {
        key: 'key', name: 'Key', shortName: 'KEY', type: 'enum', options: SCALE_NAMES,
        get: () => String(keyboardState.scale),
        set: (v) => applyScaleIdx(asIndex(v)),
    },
    {
        key: 'mode', name: 'Note Mode', shortName: 'MODE', type: 'enum', options: MODE_NAMES,
        get: () => String(keyboardState.mode),
        set: (v) => applyModeIdx(asIndex(v)),
    },
    {
        key: 'layout', name: 'Pad Layout', shortName: 'LAYOUT', type: 'enum',
        options: () => layoutNames(keyboardState.mode),
        get: () => String(Math.min(keyboardState.layout, layoutNames(keyboardState.mode).length - 1)),
        set: (v) => applyLayoutIdx(asIndex(v)),
    },
];

/* One instance for the process — see clip-params-contract.ts's own note on
 * why a virtual source needs no per-(track,component) lifetime. */
let source: PageParamSource | null = null;
export function setParamsSource(): PageParamSource {
    return source ?? (source = createVirtualSource(SET_PARAMS_COMPONENT, cells));
}

