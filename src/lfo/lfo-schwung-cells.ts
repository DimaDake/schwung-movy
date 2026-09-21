/* lfo-schwung-cells.ts — the LFO page's `PageParamSource` (SP-55).
 *
 * Two banks (LFO 1, LFO 2) of eight real params each, ALL individually
 * addressed by the port already (`lfo1:rate_hz`, `lfo2:target`, ...) — unlike
 * MIX, no engine-side translation is needed for the plain fields. What Schwung
 * still cannot get from a bare port: ONE flat 16-key contract for what the
 * model shows as two 8-knob banks (fixed by declaring both banks' keys in
 * bank order — Schwung's own pagination chunks a level at 8 knobs, so bank 0
 * lands on page 0 and bank 1 on page 1, unprompted), and RATE's dual shape
 * (Hz when free, a division index when synced — a param whose fundamental
 * TYPE depends on another cell's live value, which is why it is declared a
 * fixed `enum` whose OPTIONS resolve per read, covering both cases, rather
 * than needing `VirtualCellSpec.type` to become a function too).
 *
 * TARGET is `type: 'enum'` with a NATIVE Schwung click-to-list-picker in
 * place of movy's own overlay (same posture as Clip Params' SCALE, SU-4 —
 * "the editor is the host's") — deliberately NOT `formatValue`: the ledger's
 * SP-55 entry suggested it, but an enum whose OPTIONS are the resolved
 * "Comp:Param" labels already prints the right text with no extra hook, and
 * that is the more consistent choice against LAYOUT's existing dynamic-
 * options precedent (SP-53).
 *
 * NOT AUTOMATABLE: `schwung-page-render.ts`'s `knobParamInfo` forces this for
 * any `isLfoComponent` key, matching `lfo/inert.ts`'s `off`-mode answer — an
 * LFO modulating another LFO's own knob has no engine support, and nothing in
 * `chain_params` can tell Schwung's metaIndex "ranged but not automatable" on
 * its own (checked: `param_meta.mjs` carries no such field).
 *
 * PER-FIELD READ COST, ACCEPTED: unlike a real module (whose contract's
 * `bulkReads`-aware port lets `schwung-page-cache.ts` batch a whole page's
 * refresh into one round trip), `createVirtualSource` is `bulkReads: false`
 * — a virtual cell is normally a free field access. Here it is a real port
 * read (one per cell, `scope.port.getParam`), so a rotation over the whole
 * bank costs up to 8 round trips where a real module's costs ~1 (SP-26). The
 * one exception (TARGET) additionally re-reads every loaded component's
 * `chain_params` (`buildTargetOptions`, a handful more) — but only via
 * `options()`/`get()`, both on Schwung's own reload/rotation cadence, not
 * every tick. No device measurement of this session; recorded so a
 * device pass knows what to look for rather than re-deriving it.
 */

import { createVirtualSource, type VirtualCellSpec } from '../renderer/schwung-virtual-source.js';
import type { PageParamSource } from '../renderer/schwung-page-source.js';
import { lfoKey, type LfoScope } from './scope.js';
import { writeLfoParam } from './io.js';
import { assignLfoTarget, clearLfoTarget } from './assign.js';
import {
    LFO_SHAPES, LFO_DIVISIONS, RATE_HZ_MIN, RATE_HZ_MAX, RATE_HZ_FACTOR,
    DEPTH_STEP, PHASE_DIVISIONS, buildTargetOptions, targetIndex, formatDepth, formatPhase,
} from './params.js';

const clampI = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Math.round(v) || 0));
const clampF = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const asIndex = (v: string): number => Math.round(Number(v)) || 0;

/* The same 40-detent multiplicative ladder `lfo/model.ts`'s unsynced RATE
 * already steps on (`RATE_HZ_FACTOR = (MAX/MIN)^(1/40)`), spelled out as
 * index-addressed enum labels so an unsynced turn under delegation lands on
 * the SAME 41 stops a turn under `off` does. */
const HZ_STEPS = 40;
const HZ_LABELS = Array.from({ length: HZ_STEPS + 1 }, (_, i) => {
    const hz = RATE_HZ_MIN * Math.pow(RATE_HZ_FACTOR, i);
    return (hz < 10 ? hz.toFixed(2) : hz.toFixed(1)) + 'Hz';
});

function readParam(scope: LfoScope, bank: number, key: string): string | null {
    return scope.port.getParam(lfoKey(scope, bank, key));
}
function isSynced(scope: LfoScope, bank: number): boolean {
    return readParam(scope, bank, 'sync') === '1';
}

function rateCell(scope: LfoScope, bank: number): VirtualCellSpec {
    return {
        key: 'rate', name: 'Rate', shortName: 'RATE', type: 'enum',
        options: () => (isSynced(scope, bank) ? LFO_DIVISIONS : HZ_LABELS),
        get: () => {
            if (isSynced(scope, bank)) {
                return String(clampI(parseInt(readParam(scope, bank, 'rate_div') || '19', 10), 0, LFO_DIVISIONS.length - 1));
            }
            const hz = clampF(parseFloat(readParam(scope, bank, 'rate_hz') || '1') || 1, RATE_HZ_MIN, RATE_HZ_MAX);
            return String(clampI(Math.log(hz / RATE_HZ_MIN) / Math.log(RATE_HZ_FACTOR), 0, HZ_STEPS));
        },
        set: (v) => {
            const idx = asIndex(v);
            if (isSynced(scope, bank)) {
                writeLfoParam(scope, bank, 'rate_div', String(clampI(idx, 0, LFO_DIVISIONS.length - 1)));
            } else {
                const hz = RATE_HZ_MIN * Math.pow(RATE_HZ_FACTOR, clampI(idx, 0, HZ_STEPS));
                writeLfoParam(scope, bank, 'rate_hz', hz.toFixed(4));
            }
        },
    };
}

function targetCell(scope: LfoScope, bank: number): VirtualCellSpec {
    return {
        key: 'target', name: 'Target', shortName: 'TARGET', type: 'enum',
        options: () => buildTargetOptions(scope, bank).map((o) => o.label),
        get: () => {
            const opts = buildTargetOptions(scope, bank);
            const target = readParam(scope, bank, 'target') || '';
            const tparam = readParam(scope, bank, 'target_param') || '';
            return String(targetIndex(opts, target, tparam));
        },
        set: (v) => {
            const opts = buildTargetOptions(scope, bank);
            const opt = opts[clampI(asIndex(v), 0, opts.length - 1)];
            if (!opt || !opt.target) clearLfoTarget(scope, bank);
            else assignLfoTarget(scope, bank, opt.target, opt.param!);
        },
    };
}

function toggleCell(scope: LfoScope, bank: number, key: string, name: string, short: string): VirtualCellSpec {
    return {
        key, name, shortName: short, type: 'toggle',
        get: () => (readParam(scope, bank, key) === '1' ? '1' : '0'),
        set: (v) => writeLfoParam(scope, bank, key, asIndex(v) === 1 ? '1' : '0'),
    };
}

function retriggerCell(scope: LfoScope, bank: number): VirtualCellSpec {
    /* Master has nothing to retrigger on (no notes on the master bus) — a
     * dead cell rather than an absent one, so both banks stay 8 keys and the
     * flat 16-key list still chunks into two aligned 8-knob pages. Same
     * "answer at the gesture" posture as SU-8's ruling for a refused turn. */
    const base = toggleCell(scope, bank, 'retrigger', 'Retrigger', 'RETRIG');
    if (scope.hasRetrigger) return base;
    return { ...base, get: () => '0', set: () => {} };
}

function modeCell(scope: LfoScope, bank: number): VirtualCellSpec {
    return {
        key: 'mode', name: 'Mode', shortName: 'MODE', type: 'enum', options: ['Uni', 'Bi'],
        get: () => (readParam(scope, bank, 'polarity') === '1' ? '1' : '0'),
        set: (v) => writeLfoParam(scope, bank, 'polarity', asIndex(v) === 1 ? '1' : '0'),
    };
}

function shapeCell(scope: LfoScope, bank: number): VirtualCellSpec {
    return {
        key: 'shape', name: 'Shape', shortName: 'SHAPE', type: 'enum', options: LFO_SHAPES,
        get: () => String(clampI(parseInt(readParam(scope, bank, 'shape') || '0', 10), 0, LFO_SHAPES.length - 1)),
        set: (v) => writeLfoParam(scope, bank, 'shape', String(clampI(asIndex(v), 0, LFO_SHAPES.length - 1))),
    };
}

function phaseCell(scope: LfoScope, bank: number): VirtualCellSpec {
    return {
        key: 'phase', name: 'Phase', shortName: 'PHASE', type: 'int', min: 0, max: PHASE_DIVISIONS, step: 1,
        get: () => String(Math.round(clampF(parseFloat(readParam(scope, bank, 'phase_offset') || '0') || 0, 0, 1) * PHASE_DIVISIONS)),
        set: (v) => writeLfoParam(scope, bank, 'phase_offset', (clampI(asIndex(v), 0, PHASE_DIVISIONS) / PHASE_DIVISIONS).toFixed(4)),
        format: (raw) => raw === null ? null : formatPhase(Number(raw) / PHASE_DIVISIONS),
    };
}

function depthCell(scope: LfoScope, bank: number): VirtualCellSpec {
    return {
        key: 'depth', name: 'Depth', shortName: 'DEPTH', type: 'float', min: -1, max: 1, step: DEPTH_STEP,
        get: () => String(clampF(parseFloat(readParam(scope, bank, 'depth') || '0') || 0, -1, 1)),
        set: (v) => writeLfoParam(scope, bank, 'depth', clampF(Number(v) || 0, -1, 1).toFixed(4)),
        format: (raw) => raw === null ? null : formatDepth(Number(raw)),
    };
}

/* One bank's 8 cells, in the SAME order the movy model's knob positions use
 * (`lfo/cells.ts`'s `buildCells`) — Schwung lays a level's `knobs` array onto
 * the grid in declaration order, so this order IS the on-screen layout. */
function bankCells(scope: LfoScope, bank: number): VirtualCellSpec[] {
    return [
        rateCell(scope, bank),
        toggleCell(scope, bank, 'sync', 'Sync', 'SYNC'),
        modeCell(scope, bank),
        targetCell(scope, bank),
        shapeCell(scope, bank),
        phaseCell(scope, bank),
        retriggerCell(scope, bank),
        depthCell(scope, bank),
    /* Keys are bare within a bank (`rate`, `sync`, ...) but two banks share
     * this component's namespace — prefixed here, the one place both bank
     * loops meet, rather than inside each cell builder. */
    ].map((c) => ({ ...c, key: 'b' + bank + '_' + c.key }));
}

export function lfoSchwungSource(scope: LfoScope): PageParamSource {
    const cells = [...bankCells(scope, 0), ...bankCells(scope, 1)];
    return createVirtualSource(scope.keyPrefix + 'lfo', cells);
}
