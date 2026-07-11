/* createLfoModel — a Model-conforming object for movy's virtual LFO chain slot.
 * Backs both banks (LFO 1 / LFO 2) of the current track's schwung slot LFOs,
 * reading/writing lfoN:* params and emitting the standard ViewModel so the
 * existing chain/knob renderers and router plumbing drive it unchanged.
 * Automation/drum/file surface area is stubbed (LFO params are not automatable). */

import type { Model } from '../model/index.js';
import type { ViewModel, ParamVM } from '../types/viewmodel.js';
import { paramCell as cell } from '../seq/param-vm.js';
import { countDetents } from '../seq/detent.js';
import {
    LFO_SHAPES, LFO_DIVISIONS, LFO_BANK_COUNT, RATE_HZ_MIN, RATE_HZ_MAX, RATE_HZ_FACTOR,
    lfoPrefix, compLabel, buildTargetOptions, shortenTarget, targetIndex, formatDepth, formatPhase,
    type TargetOption,
} from './params.js';

/* Continuous-knob sensitivity for the arc params (device delta ≈ ±1..3/tick).
 * Full sweep ≈ range / step ticks; tuned for feel on device. */
const DEPTH_STEP = 0.02;   // range 2.0 → ~100 ticks
const PHASE_STEP = 0.02;   // range 1.0 → ~50 ticks

interface LfoVals {
    target: string; targetParam: string;
    shape: number; polarity: number; sync: number;
    rateHz: number; rateDiv: number;
    depth: number; phase: number; retrigger: number;
}

const clampI = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const clampF = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function createLfoModel(track: number): Model {
    let bank = 0;                       // 0 or 1 → which LFO is shown
    let loaded = false;
    let dirty = true;
    const vals: LfoVals[] = [blank(), blank()];
    const touched: number[] = [];
    const accum = new Array(8).fill(0) as number[];
    let overlay: { pos: number; kind: 'target' | 'shape'; options: string[]; selected: number; opts?: TargetOption[] } | null = null;

    function blank(): LfoVals {
        return { target: '', targetParam: '', shape: 0, polarity: 0, sync: 0,
            rateHz: 1.0, rateDiv: 19, depth: 0, phase: 0, retrigger: 0 };
    }

    function readLfo(lfoIdx: number): LfoVals {
        const g = (k: string) => shadow_get_param(track, lfoPrefix(lfoIdx) + k);
        return {
            target: g('target') || '',
            targetParam: g('target_param') || '',
            shape: clampI(parseInt(g('shape') || '0', 10) || 0, 0, LFO_SHAPES.length - 1),
            polarity: g('polarity') === '1' ? 1 : 0,
            sync: g('sync') === '1' ? 1 : 0,
            rateHz: clampF(parseFloat(g('rate_hz') || '1') || 1, RATE_HZ_MIN, RATE_HZ_MAX),
            rateDiv: clampI(parseInt(g('rate_div') || '19', 10) || 19, 0, LFO_DIVISIONS.length - 1),
            depth: clampF(parseFloat(g('depth') || '0') || 0, -1, 1),
            phase: clampF(parseFloat(g('phase_offset') || '0') || 0, 0, 1),
            retrigger: g('retrigger') === '1' ? 1 : 0,
        };
    }

    function load(): void {
        vals[0] = readLfo(0);
        vals[1] = readLfo(1);
        loaded = true;
    }

    function setP(lfoIdx: number, key: string, val: string): void {
        shadow_set_param(track, lfoPrefix(lfoIdx) + key, val);
    }

    /* Blocking write for multi-field commits (target+target_param+enabled): the
     * overtake param SHM is a single slot, so three consecutive non-blocking
     * writes clobber each other and the target never persists on device. */
    function setPBlocking(lfoIdx: number, key: string, val: string): void {
        if (typeof shadow_set_param_timeout === 'function') {
            shadow_set_param_timeout(track, lfoPrefix(lfoIdx) + key, val, 100);
        } else {
            shadow_set_param(track, lfoPrefix(lfoIdx) + key, val);
        }
    }

    /* Current target's compact label for the resting enum box. */
    function targetLabel(v: LfoVals): string {
        return v.target ? shortenTarget(compLabel(v.target), v.targetParam) : 'None';
    }

    function rateDisplay(v: LfoVals): string {
        return v.sync ? LFO_DIVISIONS[v.rateDiv] : v.rateHz.toFixed(1) + ' Hz';
    }
    function rateNorm(v: LfoVals): number {
        return v.sync
            ? v.rateDiv / (LFO_DIVISIONS.length - 1)
            : Math.log(v.rateHz / RATE_HZ_MIN) / Math.log(RATE_HZ_MAX / RATE_HZ_MIN);
    }

    function buildCells(v: LfoVals): ParamVM[] {
        // None → framed X box (drawn, not text); a real target → enum box label.
        const targetCell = v.target
            ? cell({ shortName: 'TARGET', fullName: 'Target', type: 'enum', isLongEnum: true,
                options: [targetLabel(v)], enumIndex: 0, displayValue: targetLabel(v) })
            : cell({ shortName: 'TARGET', fullName: 'Target', type: 'float', renderStyle: 'xbox',
                displayValue: 'None' });
        return [
            targetCell,
            cell({ shortName: 'SHAPE', fullName: 'Shape', type: 'enum', isLongEnum: true,
                options: LFO_SHAPES, enumIndex: v.shape, displayValue: LFO_SHAPES[v.shape],
                normalizedValue: v.shape / (LFO_SHAPES.length - 1) }),
            cell({ shortName: 'MODE', fullName: 'Mode', type: 'enum',
                options: ['UNI', 'BI'], enumIndex: v.polarity, displayValue: v.polarity ? 'BI' : 'UNI',
                normalizedValue: v.polarity }),
            cell({ shortName: 'SYNC', fullName: 'Sync', type: 'enum',
                options: ['FREE', 'SYNC'], enumIndex: v.sync, displayValue: v.sync ? 'SYNC' : 'FREE',
                normalizedValue: v.sync }),
            cell({ shortName: 'RATE', fullName: 'Rate', type: 'float', renderStyle: 'arc',
                displayValue: rateDisplay(v), normalizedValue: rateNorm(v) }),
            cell({ shortName: 'DEPTH', fullName: 'Depth', type: 'float', renderStyle: 'arc',
                displayValue: formatDepth(v.depth), normalizedValue: (v.depth + 1) / 2 }),
            cell({ shortName: 'PHASE', fullName: 'Phase', type: 'float', renderStyle: 'arc',
                displayValue: formatPhase(v.phase), normalizedValue: v.phase }),
            cell({ shortName: 'RETRIG', fullName: 'Retrigger', type: 'int', renderStyle: 'hbar',
                displayValue: v.retrigger ? 'On' : 'Off', normalizedValue: v.retrigger }),
        ];
    }

    function buildVM(): ViewModel {
        if (!loaded) load();
        const v = vals[bank];
        const cells = buildCells(v);
        const primary = touched.length > 0 ? touched[touched.length - 1] : -1;
        let toast: ViewModel['toast'] = null;
        if (primary >= 0 && primary < 8) {
            cells[primary].touched = true;
            toast = { fullName: cells[primary].fullName, value: cells[primary].displayValue, browseHint: false };
        }
        return {
            moduleName: 'LFO ' + (bank + 1),
            bankName: '',
            bankIndex: bank,
            bankCount: LFO_BANK_COUNT,
            rows: [cells.slice(0, 4), cells.slice(4, 8)],
            touchedSlot: primary >= 0 ? primary : null,
            toast,
            overlay: overlay ? { slot: overlay.pos, options: overlay.options, selected: overlay.selected } : null,
            isEmpty: false,
            drumPadCount: 0, drumCurrentPad: 0, drumCurrentPhysPad: 0, isPadSpecific: false,
            // LFO editing is independent of automation — never hide/held.
            automationHeld: false, automationPoolFull: false,
            stepPagePresent: false, stepPageSelected: false,
        };
    }

    function openOverlay(pos: number): void {
        const v = vals[bank];
        if (pos === 0) {
            const opts = buildTargetOptions(track, bank);
            overlay = { pos, kind: 'target', options: opts.map(o => o.label),
                selected: targetIndex(opts, v.target, v.targetParam), opts };
        } else if (pos === 1) {
            overlay = { pos, kind: 'shape', options: LFO_SHAPES.slice(), selected: v.shape };
        }
        accum[pos] = 0;
    }

    function commitOverlay(): void {
        if (!overlay) return;
        const v = vals[bank];
        if (overlay.kind === 'target' && overlay.opts) {
            const opt = overlay.opts[overlay.selected];
            if (!opt.target) {
                setPBlocking(bank, 'target', ''); setPBlocking(bank, 'target_param', ''); setPBlocking(bank, 'enabled', '0');
                v.target = ''; v.targetParam = '';
            } else {
                setPBlocking(bank, 'target', opt.target); setPBlocking(bank, 'target_param', opt.param!); setPBlocking(bank, 'enabled', '1');
                v.target = opt.target; v.targetParam = opt.param!;
            }
        } else if (overlay.kind === 'shape') {
            v.shape = overlay.selected;
            setP(bank, 'shape', String(v.shape));
        }
        overlay = null;
    }

    /* Discrete params: ±1 per detent, clamped. */
    function stepDiscrete(pos: number, delta: number): void {
        const n = countDetents(accum, pos, delta);
        if (n === 0) return;
        const v = vals[bank];
        if (pos === 1) { v.shape = clampI(v.shape + n, 0, LFO_SHAPES.length - 1); setP(bank, 'shape', String(v.shape)); }
        else if (pos === 2) { v.polarity = clampI(v.polarity + n, 0, 1); setP(bank, 'polarity', String(v.polarity)); }
        else if (pos === 3) { v.sync = clampI(v.sync + n, 0, 1); setP(bank, 'sync', String(v.sync)); }
        else if (pos === 4) {
            if (v.sync) { v.rateDiv = clampI(v.rateDiv + n, 0, LFO_DIVISIONS.length - 1); setP(bank, 'rate_div', String(v.rateDiv)); }
            else { v.rateHz = clampF(v.rateHz * Math.pow(RATE_HZ_FACTOR, n), RATE_HZ_MIN, RATE_HZ_MAX); setP(bank, 'rate_hz', v.rateHz.toFixed(4)); }
        } else if (pos === 7) { v.retrigger = clampI(v.retrigger + n, 0, 1); setP(bank, 'retrigger', String(v.retrigger)); }
    }

    const api: Model = {
        handleKnobDelta(k: number, delta: number): void {
            if (overlay && k === overlay.pos) {
                const n = countDetents(accum, k, delta);
                if (n !== 0) { overlay.selected = clampI(overlay.selected + n, 0, overlay.options.length - 1); dirty = true; }
                return;
            }
            const v = vals[bank];
            if (k === 5) { v.depth = clampF(v.depth + delta * DEPTH_STEP, -1, 1); setP(bank, 'depth', v.depth.toFixed(4)); }
            else if (k === 6) { v.phase = clampF(v.phase + delta * PHASE_STEP, 0, 1); setP(bank, 'phase_offset', v.phase.toFixed(4)); }
            else if ((k >= 1 && k <= 4) || k === 7) { stepDiscrete(k, delta); }
            // k === 0 (target) is overlay-only; a bare turn is ignored.
            dirty = true;
        },
        handleKnobTouch(k: number): void {
            if (overlay && k !== overlay.pos) { commitOverlay(); }
            const idx = touched.indexOf(k);
            if (idx >= 0) touched.splice(idx, 1);
            touched.push(k);
            if (k === 0 || k === 1) openOverlay(k);
            dirty = true;
        },
        handleKnobRelease(k?: number): boolean {
            if (overlay && (k === undefined || k === overlay.pos)) commitOverlay();
            if (k !== undefined) { const i = touched.indexOf(k); if (i >= 0) touched.splice(i, 1); }
            else touched.length = 0;
            dirty = true;
            return false;
        },
        getKnobPage(): number { return bank; },
        getBankCount(): number { return LFO_BANK_COUNT; },
        changePage(delta: number): void {
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
        getFileBrowseTarget() { return null; },
        clearFileOverlay(): void { /* no file params */ },
        setFileValue(_gi: number, _path: string): void { /* no file params */ },
        getComponentKey(): string { return 'lfo'; },
        getKnobParamInfo(_physK: number) { return null; },     // not automatable
        setNoRefreshKeys(_keys: string[]): void { /* no automation lanes */ },
        paramRangeByKey(_key: string) { return null; },
        hasLoadedParams(): boolean { return loaded; },
        getValueByKey(_key: string) { return null; },
        getDrumConfig() { return null; },
        updateDrumPad(_pad: number, _physPad: number): void { /* not a drum */ },
    };

    return api;
}
