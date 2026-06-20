import { createModelState } from './state.js';
import { loadHierarchy }    from './hierarchy.js';
import { applyKnobDelta, knobParamInfo, reseedPadParams }   from './store.js';
import { buildViewModel }   from './viewmodel.js';
import { processTick }      from './tick.js';
import { KNOBS_PER_PAGE, LONG_PRESS_TICKS, NAME_POLL_TICKS, ENUM_DELTA_DIV } from './constants.js';
import { basename, dirname } from './path.js';
import { fileContentAllows } from './file-validate.js';
import { mlog } from '../log.js';

// Fractional accumulator: returns whole steps consumed and the leftover fraction
function accumStep(accum: number, delta: number): [newAccum: number, step: number] {
    const next = accum + delta / ENUM_DELTA_DIV;
    const step = Math.trunc(next);
    return [next - step, step];
}

function isDir(path: string): boolean {
    try {
        const [st] = (os as { stat(p: string): [{ mode: number }, number] }).stat(path);
        return (st.mode & 0xF000) === 0x4000;
    } catch { return false; }
}

/* Flat file list for the inline jog-browse overlay. The overlay has no
 * directory navigation, so folders are excluded — selecting one would set the
 * param to a folder path and crash the loader. The full-screen browser
 * (browser/file-handler.ts) is the one that shows folders for navigation. */
function scanFiles(dir: string, filter: string[]): string[] {
    try {
        const [entries] = (os as { readdir(p: string): [string[], number] }).readdir(dir);
        if (!Array.isArray(entries)) return [];
        return entries
            .filter(n => n !== '.' && n !== '..' && !n.startsWith('.'))
            .filter(n => {
                if (filter.length === 0) return true;
                const lower = n.toLowerCase();
                return filter.some(ext => lower.endsWith(ext));
            })
            .map(n => dir + '/' + n)
            .filter(p => !isDir(p))
            .sort();
    } catch { return []; }
}

export function createModel(slot: number, componentKey = 'synth') {
    const s = createModelState(slot, componentKey);

    function numBanks() { return Math.max(1, Math.ceil(s.knobParams.length / KNOBS_PER_PAGE)); }

    function primarySlot(): number {
        return s.touchedSlots.length > 0 ? s.touchedSlots[s.touchedSlots.length - 1] : -1;
    }

    return {
        handleKnobDelta(k: number, delta: number): void {
            if (s.enumOverlay && k === s.enumOverlay.slot) {
                const [acc, step] = accumStep(s.enumAccums[k], delta);
                s.enumAccums[k] = acc;
                if (step !== 0) {
                    const n    = s.enumOverlay.options.length;
                    const next = Math.max(0, Math.min(n - 1, s.enumOverlay.selected + step));
                    if (next !== s.enumOverlay.selected) {
                        s.enumOverlay.selected = next;
                        s.knobValues[s.enumOverlay.gi] = next;
                        s.dirty = true;
                    }
                }
                return;
            }
            if (s.fileOverlay && k === s.fileOverlay.slot) {
                const [acc, step] = accumStep(s.fileOverlay.accum, delta);
                s.fileOverlay.accum = acc;
                if (step !== 0) {
                    const n    = s.fileOverlay.items.length;
                    const next = Math.max(0, Math.min(n - 1, s.fileOverlay.selected + step));
                    if (next !== s.fileOverlay.selected) {
                        s.fileOverlay.selected = next;
                        s.dirty = true;
                    }
                }
                return;
            }
            s.longPressCountdown = -1;
            s.pendingDeltas[k] += delta;
            // Make this knob the primary touched slot without disturbing other held knobs
            const idx = s.touchedSlots.indexOf(k);
            if (idx < 0) { s.touchedSlots.push(k); s.dirty = true; }
            else if (idx < s.touchedSlots.length - 1) {
                s.touchedSlots.splice(idx, 1);
                s.touchedSlots.push(k);
                s.dirty = true;
            }
        },

        handleKnobTouch(k: number): void {
            if (s.enumOverlay) { s.enumOverlay = null; s.dirty = true; }
            if (s.fileOverlay) { s.fileOverlay = null; s.dirty = true; }
            const idx = s.touchedSlots.indexOf(k);
            if (idx >= 0) s.touchedSlots.splice(idx, 1);
            s.touchedSlots.push(k);
            s.dirty = true;
            const gi = s.knobPage * KNOBS_PER_PAGE + k;
            const p  = s.knobParams[gi];
            if (p && p.type === 'enum' && p.options && p.options.length > 6) {
                s.enumOverlay = { slot: k, gi, options: p.options, selected: Math.round((s.knobValues[gi] ?? 0) as number) };
                s.enumAccums[k] = 0;
            }
            if (p && p.type === 'file') {
                const currentPath = s.fileValues[gi] ?? '';
                const scanDir     = currentPath ? dirname(currentPath) : (p.fileStartPath ?? '/data/UserData');
                const items       = scanFiles(scanDir, p.fileFilter ?? []);
                if (items.length > 0) {
                    const selIdx = currentPath ? items.indexOf(currentPath) : 0;
                    s.fileOverlay = {
                        slot: k, gi, items,
                        selected: selIdx >= 0 ? selIdx : 0,
                        original: currentPath, accum: 0,
                    };
                }
            }
            s.longPressCountdown = -1;
        },

        /* Returns true if a file selection was rejected (wrong preset type) so
         * the router can surface a toast — keeps the model free of the seq layer. */
        handleKnobRelease(k?: number): boolean {
            let fileRejected = false;
            if (s.enumOverlay && (k === undefined || k === s.enumOverlay.slot)) {
                const p = s.knobParams[s.enumOverlay.gi];
                if (p) {
                    s.knobValues[s.enumOverlay.gi] = s.enumOverlay.selected;
                    shadow_set_param(s.activeSlot, s.componentKey + ':' + p.key, String(s.enumOverlay.selected));
                }
                s.enumOverlay = null;
            }
            if (s.fileOverlay && (k === undefined || k === s.fileOverlay.slot)) {
                const p = s.knobParams[s.fileOverlay.gi];
                if (p && s.fileOverlay.items.length > 0) {
                    const path = s.fileOverlay.items[s.fileOverlay.selected];
                    if (fileContentAllows(path, p.fileRequireContains)) {
                        s.fileValues[s.fileOverlay.gi] = path;
                        shadow_set_param(s.activeSlot, s.componentKey + ':' + p.key, path);
                    } else {
                        fileRejected = true;
                    }
                }
                s.fileOverlay = null;
            }
            if (k !== undefined) {
                const idx = s.touchedSlots.indexOf(k);
                if (idx >= 0) s.touchedSlots.splice(idx, 1);
            } else {
                s.touchedSlots.length = 0;
            }
            s.dirty = true;
            s.longPressCountdown = -1;
            return fileRejected;
        },

        changePage(delta: number): void {
            if (s.enumOverlay) return;
            const nBanks = numBanks();
            const next = Math.max(0, Math.min(nBanks - 1, s.knobPage + delta));
            mlog('changePage delta=' + delta + ' ' + s.knobPage + '→' + next + '/' + nBanks);
            if (next !== s.knobPage) { s.knobPage = next; s.dirty = true; }
        },

        getModuleName(): string { return s.activeModuleName; },

        reset(): void {
            s.knobPage = 0;
            s.touchedSlots.length = 0;
            s.longPressCountdown = -1;
            s.enumOverlay = null;
            s.fileOverlay = null;
            s.pollCountdown = NAME_POLL_TICKS;
            s.refreshParamCursor = 0;
            for (let i = 0; i < KNOBS_PER_PAGE; i++) { s.pendingDeltas[i] = 0; s.enumAccums[i] = 0; }
            s.dirty = true;
        },

        tick(): boolean { return processTick(s); },

        getViewModel(auto?: import('../types/viewmodel.js').AutomationView) { return buildViewModel(s, auto); },

        reload(): void { s.hierarchyKey = ''; s.pollCountdown = 1; s.dirty = true; },

        getFileBrowseTarget(): { key: string; gi: number; root: string; filter: string[]; startPath: string; currentPath: string | null; requireContains?: string } | null {
            const primary = primarySlot();
            if (primary < 0) return null;
            const gi = s.knobPage * KNOBS_PER_PAGE + primary;
            const p  = s.knobParams[gi];
            if (!p || p.type !== 'file') return null;
            return {
                key:         p.key,
                gi,
                root:        p.fileRoot      ?? '/data/UserData',
                filter:      p.fileFilter    ?? [],
                startPath:   p.fileStartPath ?? '/data/UserData',
                currentPath: s.fileValues[gi] ?? null,
                requireContains: p.fileRequireContains,
            };
        },

        clearFileOverlay(): void { s.fileOverlay = null; s.dirty = true; },

        setFileValue(gi: number, path: string): void {
            if (gi >= 0 && gi < s.fileValues.length) {
                s.fileValues[gi] = path;
                s.dirty = true;
            }
        },

        getComponentKey(): string { return s.componentKey; },

        getKnobParamInfo(physK: number) { return knobParamInfo(s, physK); },

        /* Keys whose synth value the param page must not read back (automation
         * lanes — the page shows the UI-owned base). */
        setNoRefreshKeys(keys: string[]): void {
            s.noRefreshKeys.clear();
            for (const k of keys) s.noRefreshKeys.add(k);
        },

        /* Current (base) value of a param by key, regardless of page, or null. */
        getValueByKey(key: string): number | null {
            const gi = s.knobParams.findIndex((p) => p?.key === key);
            if (gi < 0) return null;
            const v = s.knobValues[gi];
            return (v === null || v === undefined) ? null : (v as number);
        },

        getDrumConfig(): import('../types/param.js').DrumConfig | null {
            return s.moduleConfig?.drum ?? null;
        },

        updateDrumPad(pad: number, physPad: number): void {
            s.drumCurrentPad     = pad;
            s.drumCurrentPhysPad = physPad;
            reseedPadParams(s);  // show the newly-focused pad's values immediately
            s.dirty = true;
        },
    };
}

export type Model = ReturnType<typeof createModel>;
