/* createMixModel — a Model-conforming object for the virtual MIX chain slot.
 *
 * Movy's own summing mixer as one page: level, pan and the two send amounts
 * (design §8). Built like `createLfoModel` — a closure over cached values plus
 * `inertModelSurface` for the accessors a page with no module answers the same
 * way.
 *
 * Unlike the LFO page, these four params ARE automatable, so four of those
 * inert accessors are overridden: the lane layer asks this page for a param's
 * identity, its range and its current value exactly as it asks a module's
 * model, and a lane restored from the engine is validated through the same
 * path. The overrides come AFTER the spread for that reason. */

import type { Model } from '../model/index.js';
import type { ViewModel } from '../types/viewmodel.js';
import type { KnobParamInfo } from '../model/store.js';
import { countDetents } from '../seq/detent.js';
import { beginGesture } from '../undo/edit.js';
import { endEdit } from '../undo/group.js';
import { inertModelSurface } from '../lfo/inert.js';
import { ampToIdx, idxToAmp, VOL_STEPS } from './db-ladder.js';
import { buildMixVM } from './mix-cells.js';
import {
    FIELD_AT, FIELD_RANGE, PAN_MAX, PAN_MIN, SEND_MAX, defaultMix, packMixValue,
    readMix, writeMix, type MixFieldName, type MixVals,
} from './mix-io.js';
import { trackKind } from '../track/ref.js';

/* Pan is the one field not on the dB ladder: 64 detents corner to corner, so a
 * full sweep is about the same wrist travel as the fader's. */
const PAN_STEP = (PAN_MAX - PAN_MIN) / 64;

const clampF = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function createMixModel(track: number): Model {
    let vals: MixVals = defaultMix();
    let loaded = false;
    let dirty = true;
    const touched: number[] = [];
    const accum = new Array(8).fill(0) as number[];

    function dropCache(): void { loaded = false; dirty = true; }
    function load(): void { vals = readMix(track); loaded = true; }
    function ensure(): MixVals { if (!loaded) load(); return vals; }

    function valueOf(field: MixFieldName): number {
        const v = ensure();
        return field === 'gain' ? v.gain
             : field === 'pan' ? v.pan
             : field === 'send1' ? v.send[0] : v.send[1];
    }

    /* VOL and both sends walk the shared dB ladder — one detent is one dB, and
     * index 0 is true silence — so the page and the hold-track+volume gesture
     * feel like the same fader. */
    function ladderStep(current: number, n: number, max: number): number {
        return Math.min(max, idxToAmp(Math.min(VOL_STEPS, Math.max(0, ampToIdx(current) + n))));
    }

    /* One undo group per knob: the key has to survive every detent of a turn
     * and close only on release. */
    function gestureKey(k: number): string { return 'mix:' + track + ':' + FIELD_AT[k]; }

    function edit(k: number, delta: number): void {
        const field = FIELD_AT[k];
        if (field === undefined || trackKind(track) === 'host' && field !== 'gain') return;
        const v = ensure();
        const before = packMixValue(v);
        if (field === 'pan') {
            const n = countDetents(accum, k, delta);
            if (n === 0) return;
            v.pan = clampF(v.pan + n * PAN_STEP, PAN_MIN, PAN_MAX);
        } else {
            const n = countDetents(accum, k, delta);
            if (n === 0) return;
            if (field === 'gain') v.gain = ladderStep(v.gain, n, FIELD_RANGE.gain.max);
            else {
                const i = field === 'send1' ? 0 : 1;
                v.send[i] = ladderStep(v.send[i], n, SEND_MAX);
            }
        }
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
        reset(): void { touched.length = 0; accum.fill(0); dropCache(); },
        tick(): boolean {
            if (!loaded) { load(); dirty = true; }
            const d = dirty; dirty = false; return d;
        },
        getViewModel(auto?: import('../types/viewmodel.js').AutomationView): ViewModel {
            return buildMixVM({ vals: ensure(), kind: trackKind(track), touched, auto });
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
        /* AFTER the spread: these four are the half of the surface the LFO page
         * does not have. `target: 'mix'` is what routes the lane to movy's own
         * mixer instead of a chain knob mapping (see seq/lane-mapping.ts). */
        getKnobParamInfo(physK: number): KnobParamInfo | null {
            const field = FIELD_AT[physK];
            if (field === undefined) return null;
            /* A host track has a fader but no lane: `slot:volume` is a shim
             * param, and `knob_find_param` resolves only components inside the
             * chain, so there is nothing for a lane to target. */
            if (trackKind(track) === 'host') return null;
            const r = FIELD_RANGE[field];
            return {
                gi: physK, key: field, ioKey: field, target: 'mix',
                value: valueOf(field), min: r.min, max: r.max, type: r.type,
                automatable: true,
            };
        },
        paramRangeByKey(key: string) {
            const r = FIELD_RANGE[key as MixFieldName];
            return r ? { min: r.min, max: r.max, type: r.type } : null;
        },
        getValueByKey(key: string) {
            const r = FIELD_RANGE[key as MixFieldName];
            return r ? valueOf(key as MixFieldName) : null;
        },
    };

    return api;
}
