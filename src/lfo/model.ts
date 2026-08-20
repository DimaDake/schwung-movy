/* createLfoModel — a Model-conforming object for a virtual LFO chain slot.
 * Backs both banks (LFO 1 / LFO 2) of whichever pair of LFOs the scope names —
 * a track's or the master chain's — reading/writing lfoN:* params and emitting
 * the standard ViewModel so the existing chain/knob renderers and router
 * plumbing drive it unchanged. Automation/drum/file surface area is stubbed
 * (LFO params are not automatable). */

import type { Model } from '../model/index.js';
import type { ViewModel } from '../types/viewmodel.js';
import { countDetents } from '../seq/detent.js';
import { assignLfoTarget, clearLfoTarget } from './assign.js';
import { buildLfoVM, type LfoOverlay } from './cells.js';
import { blankVals, readLfoVals, writeLfoParam, type LfoVals } from './io.js';
import { trackScope, type LfoScope } from './scope.js';
import { inertModelSurface } from './inert.js';
import {
    LFO_SHAPES, LFO_DIVISIONS, LFO_BANK_COUNT, RATE_HZ_MIN, RATE_HZ_MAX, RATE_HZ_FACTOR,
    buildTargetOptions, targetIndex,
} from './params.js';

/* Continuous-knob sensitivity for the arc params (device delta ≈ ±1..3/tick).
 * Full sweep ≈ range / step ticks; tuned for feel on device. */
const DEPTH_STEP = 0.02;         // continuous; range 2.0 → ~100 ticks
const PHASE_DIVISIONS = 24;      // phase snaps to a 15° grid (exact 45/90/180)

const clampI = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const clampF = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** A track's own LFO page. */
export function createLfoModel(track: number): Model {
    return createScopedLfoModel(trackScope(track));
}

export function createScopedLfoModel(scope: LfoScope): Model {
    let bank = 0;                       // 0 or 1 → which LFO is shown
    let loaded = false;
    let dirty = true;
    const vals: LfoVals[] = [blankVals(), blankVals()];
    const touched: number[] = [];
    const accum = new Array(8).fill(0) as number[];
    let overlay: LfoOverlay | null = null;

    function load(): void {
        vals[0] = readLfoVals(scope, 0);
        vals[1] = readLfoVals(scope, 1);
        loaded = true;
    }

    const setP = (lfoIdx: number, key: string, val: string) => writeLfoParam(scope, lfoIdx, key, val);

    const buildVM = (): ViewModel => {
        if (!loaded) load();
        return buildLfoVM(scope, { bank, vals, touched, overlay });
    };

    function openOverlay(pos: number): void {
        const v = vals[bank];
        if (pos === 3) {
            const opts = buildTargetOptions(scope, bank);
            overlay = { pos, kind: 'target', options: opts.map(o => o.label),
                selected: targetIndex(opts, v.target, v.targetParam), opts };
            accum[pos] = 0;
        }
    }

    function commitOverlay(): void {
        if (!overlay) return;
        const v = vals[bank];
        if (overlay.opts) {
            const opt = overlay.opts[overlay.selected];
            if (!opt.target) {
                clearLfoTarget(scope, bank);
                v.target = ''; v.targetParam = '';
            } else {
                assignLfoTarget(scope, bank, opt.target, opt.param!);
                v.target = opt.target; v.targetParam = opt.param!;
            }
        }
        overlay = null;
    }

    /* Discrete params: ±1 per detent, clamped. Positions: 0 Rate, 1 Sync,
     * 2 Mode, 4 Shape, 6 Retrigger. */
    function stepDiscrete(pos: number, delta: number): void {
        const n = countDetents(accum, pos, delta);
        if (n === 0) return;
        const v = vals[bank];
        if (pos === 0) {
            if (v.sync) { v.rateDiv = clampI(v.rateDiv + n, 0, LFO_DIVISIONS.length - 1); setP(bank, 'rate_div', String(v.rateDiv)); }
            else { v.rateHz = clampF(v.rateHz * Math.pow(RATE_HZ_FACTOR, n), RATE_HZ_MIN, RATE_HZ_MAX); setP(bank, 'rate_hz', v.rateHz.toFixed(4)); }
        } else if (pos === 1) { v.sync = clampI(v.sync + n, 0, 1); setP(bank, 'sync', String(v.sync)); }
        else if (pos === 2) { v.polarity = clampI(v.polarity + n, 0, 1); setP(bank, 'polarity', String(v.polarity)); }
        else if (pos === 4) { v.shape = clampI(v.shape + n, 0, LFO_SHAPES.length - 1); setP(bank, 'shape', String(v.shape)); }
        else if (pos === 6) { v.retrigger = clampI(v.retrigger + n, 0, 1); setP(bank, 'retrigger', String(v.retrigger)); }
    }

    const api: Model = {
        handleKnobDelta(k: number, delta: number): void {
            if (overlay && k === overlay.pos) {
                const n = countDetents(accum, k, delta);
                if (n !== 0) { overlay.selected = clampI(overlay.selected + n, 0, overlay.options.length - 1); dirty = true; }
                return;
            }
            const v = vals[bank];
            if (k === 5) {
                // Phase snaps to the 15° grid so exact 45/90/180 are selectable.
                const n = countDetents(accum, k, delta);
                if (n !== 0) {
                    const idx = clampI(Math.round(v.phase * PHASE_DIVISIONS) + n, 0, PHASE_DIVISIONS);
                    v.phase = idx / PHASE_DIVISIONS;
                    setP(bank, 'phase_offset', v.phase.toFixed(4));
                }
            }
            else if (k === 7) { v.depth = clampF(v.depth + delta * DEPTH_STEP, -1, 1); setP(bank, 'depth', v.depth.toFixed(4)); }
            /* Knob 6 is dead where the scope has no retrigger: the shim would
             * drop the write anyway, so never pretend it landed. */
            else if (k === 6 && !scope.hasRetrigger) { /* blank cell */ }
            else if (k === 0 || k === 1 || k === 2 || k === 4 || k === 6) { stepDiscrete(k, delta); }
            // k === 3 (Target) is overlay-only; a bare turn is ignored.
            dirty = true;
        },
        handleKnobTouch(k: number): void {
            if (overlay && k !== overlay.pos) { commitOverlay(); }
            const idx = touched.indexOf(k);
            if (idx >= 0) touched.splice(idx, 1);
            touched.push(k);
            if (k === 3) openOverlay(k);
            dirty = true;
        },
        handleKnobRelease(k?: number): boolean {
            if (overlay && (k === undefined || k === overlay.pos)) commitOverlay();
            if (k !== undefined) { const i = touched.indexOf(k); if (i >= 0) touched.splice(i, 1); }
            else touched.length = 0;
            dirty = true;
            return false;
        },
        clearTouch(): void { if (touched.length) { touched.length = 0; dirty = true; } },
        getKnobPage(): number { return bank; },
        getBankCount(): number { return LFO_BANK_COUNT; },
        changePage(delta: number): void {
            if (overlay) return;
            const next = clampI(bank + delta, 0, LFO_BANK_COUNT - 1);
            if (next !== bank) { bank = next; touched.length = 0; dirty = true; }
        },
        /* The LFO page has no level structure — every bank is its own section,
         * so shift+jog behaves like a plain page turn here. */
        changePageGroup(delta: number): void {
            if (overlay) return;
            const next = clampI(bank + delta, 0, LFO_BANK_COUNT - 1);
            if (next !== bank) { bank = next; touched.length = 0; dirty = true; }
        },
        getModuleName(): string { return 'LFO'; },
        reset(): void { bank = 0; touched.length = 0; overlay = null; accum.fill(0); loaded = false; dirty = true; },
        // Values are movy-owned once loaded; they are read from shadow only on
        // load/reload. No periodic re-read: a write's read-back can lag on
        // device, and re-reading would clobber a just-committed value (that was
        // the "target resets to None" bug). reload() picks up any external edit.
        tick(): boolean {
            if (!loaded) { load(); dirty = true; }
            const d = dirty; dirty = false; return d;
        },
        getViewModel(_auto?: import('../types/viewmodel.js').AutomationView): ViewModel { return buildVM(); },
        reload(): void { loaded = false; dirty = true; },
        getComponentKey(): string { return scope.keyPrefix + 'lfo'; },
        /* The page's values are read from schwung ONCE and owned by movy after
         * that (see `loaded`), so a value restored behind its back — by an undo
         * writing straight to the chain — leaves the display showing the old
         * one. Drop the cache; the next build re-reads both LFOs. */
        refreshParamKey(): boolean { loaded = false; dirty = true; return true; },
        hasLoadedParams(): boolean { return loaded; },
        ...inertModelSurface('lfo', 'LFO', scope.keyPrefix + 'lfo'),
    };

    return api;
}
