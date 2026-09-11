/* createMixModel — a Model-conforming object for the virtual MIX chain slot.
 *
 * Movy's own summing mixer as one page: level, pan and the send amounts
 * (design §8). Built like `createLfoModel` — a closure over cached values plus
 * `inertModelSurface` for the accessors a page with no module answers the same
 * way.
 *
 * Unlike the LFO page, these params ARE automatable, so four of those
 * inert accessors are overridden: the lane layer asks this page for a param's
 * identity, its range and its current value exactly as it asks a module's
 * model, and a lane restored from the engine is validated through the same
 * path. The overrides come AFTER the spread for that reason. */

import type { Model } from '../model/index.js';
import type { ViewModel } from '../types/viewmodel.js';
import type { KnobParamInfo } from '../model/store.js';
import { beginGesture } from '../undo/edit.js';
import { endEdit } from '../undo/group.js';
import { inertModelSurface } from '../lfo/inert.js';
import { SEND_TOP_DB, VOL_TOP_DB, stepAmpDb } from './db-ladder.js';
import { buildMixVM } from './mix-cells.js';
import {
    FIELD_AT, LANE_RANGE, PAN_MAX, PAN_MIN, busOfField, defaultMix, fieldFrac,
    packMixValue, readMix, writeMix, type MixFieldName, type MixVals,
} from './mix-io.js';
import { CONTINUOUS_TICK_FRAC } from '../model/constants.js';

/* Pan is the one field not on the dB ladder, but it travels at the same rate as
 * everything else on the page: one CC unit is CONTINUOUS_TICK_FRAC of the
 * corner-to-corner range.
 *
 * Derived inside the call, not as a module-level const: esbuild's code-split
 * build put this file's initializer BEFORE the chunk holding PAN_MIN/PAN_MAX,
 * so a `const` computed from them here was NaN and every pan edit wrote NaN.
 * The device bundle happened to order it the other way, which is why only the
 * browser build ever saw it. */
function panStep(): number { return (PAN_MAX - PAN_MIN) * CONTINUOUS_TICK_FRAC; }

/* Snapped to the step grid, so pan can always return to exactly centre: a value
 * restored off-grid (a set file, an automation write) would otherwise carry its
 * offset through every detent and never land on 0 again. */
function stepPan(pan: number, ticks: number): number {
    const g = panStep();
    return clampF(Math.round((pan + ticks * g) / g) * g, PAN_MIN, PAN_MAX);
}

const clampF = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function createMixModel(track: number): Model {
    let vals: MixVals = defaultMix();
    let loaded = false;
    let dirty = true;
    const touched: number[] = [];

    function dropCache(): void { loaded = false; dirty = true; }
    function load(): void { vals = readMix(track); loaded = true; }
    function ensure(): MixVals { if (!loaded) load(); return vals; }

    function valueOf(field: MixFieldName): number {
        const v = ensure();
        if (field === 'gain') return v.gain;
        if (field === 'pan') return v.pan;
        return v.send[busOfField(field)] ?? 0;
    }

    /* One undo group per knob: the key has to survive every detent of a turn
     * and close only on release. */
    function gestureKey(k: number): string { return 'mix:' + track + ':' + FIELD_AT[k]; }

    function edit(k: number, delta: number): void {
        const field = FIELD_AT[k];
        if (field === undefined) return;
        const v = ensure();
        const before = packMixValue(v);
        /* VOL and every send walk the shared dB ladder — silence at the bottom,
         * the fader's 12 dB of headroom or a send's unity at the top — so the
         * page and the hold-track+volume gesture describe the same curve. */
        if (field === 'pan') v.pan = stepPan(v.pan, delta);
        else if (field === 'gain') v.gain = stepAmpDb(v.gain, delta, VOL_TOP_DB);
        else {
            const i = busOfField(field);
            v.send[i] = stepAmpDb(v.send[i] ?? 0, delta, SEND_TOP_DB);
        }
        /* Nothing moved — the control is against a stop. No write, and no undo
         * entry for an edit that changed nothing. */
        if (packMixValue(v) === before) return;
        /* An undo group has to be OPEN before the write: `recordParamOp` logs a
         * violation and drops the entry otherwise, so the edit would be both
         * un-undoable and noisy. Keyed per field so turning VOL and then PAN
         * are two entries, and closed on knob release — one gesture, one undo,
         * however many detents it took. */
        beginGesture(gestureKey(k), 'MIX', 'T' + (track + 1), false);
        writeMix(track, v, before);
        dirty = true;
    }

    const api: Model = {
        handleKnobDelta(k: number, delta: number): void { edit(k, delta); },
        handleKnobTouch(k: number): void {
            const i = touched.indexOf(k);
            if (i >= 0) touched.splice(i, 1);
            touched.push(k);
            dirty = true;
        },
        handleKnobRelease(k?: number): boolean {
            if (k !== undefined) {
                const i = touched.indexOf(k);
                if (i >= 0) touched.splice(i, 1);
                endEdit(gestureKey(k));
            } else {
                touched.length = 0;
                endEdit();
            }
            dirty = true;
            return false;
        },
        clearTouch(): void { if (touched.length) { touched.length = 0; dirty = true; } },
        getKnobPage(): number { return 0; },
        getBankCount(): number { return 1; },
        changePage(_delta: number): void { /* one page */ },
        changePageGroup(_delta: number): void { /* one page */ },
        selectBankForPad(_pad: number): void { /* no pad claims this page */ },
        getModuleName(): string { return 'MIX'; },
        reset(): void { touched.length = 0; dropCache(); },
        tick(): boolean {
            if (!loaded) { load(); dirty = true; }
            const d = dirty; dirty = false; return d;
        },
        getViewModel(auto?: import('../types/viewmodel.js').AutomationView): ViewModel {
            return buildMixVM({ vals: ensure(), touched, auto });
        },
        reload(): void { dropCache(); },
        reloadNow(): void { dropCache(); },
        getComponentKey(): string { return 'mix'; },
        /* The page's values are read once and owned by movy after that, so a
         * value written behind its back — an undo, or an automation lane moving
         * the mixer during playback — leaves the display showing the old one.
         * Drop the cache; the next build re-reads. */
        refreshParamKey(): boolean { dropCache(); return true; },
        hasLoadedParams(): boolean { return loaded; },
        ...inertModelSurface('mix', 'MIX', 'mix'),
        /* AFTER the spread: these are the half of the surface the LFO page
         * does not have. `target: 'mix'` is what routes the lane to movy's own
         * mixer instead of a chain knob mapping (see seq/lane-mapping.ts). */
        getKnobParamInfo(physK: number): KnobParamInfo | null {
            const field = FIELD_AT[physK];
            if (field === undefined) return null;
            /* Reported as a POSITION on the control's travel, not in the
             * field's own units: that is what a lane's 0-127 means here, so the
             * automation the knob writes follows the curve the knob walks. */
            return {
                gi: physK, key: field, ioKey: field, target: 'mix',
                value: fieldFrac(field, valueOf(field)),
                min: LANE_RANGE.min, max: LANE_RANGE.max, type: LANE_RANGE.type,
                automatable: true,
            };
        },
        paramRangeByKey(key: string) {
            return FIELD_AT.includes(key as MixFieldName) ? { ...LANE_RANGE } : null;
        },
        getValueByKey(key: string) {
            const field = key as MixFieldName;
            return FIELD_AT.includes(field) ? fieldFrac(field, valueOf(field)) : null;
        },
    };

    return api;
}
