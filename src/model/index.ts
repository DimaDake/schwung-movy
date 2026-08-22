import { setChainParam } from '../chain/set-param.js';
import { refreshParamKey } from './store.js';
import { undoableEdit } from '../undo/edit.js';
import { recordPresetState } from '../undo/record.js';
import { createModelState } from './state.js';
import type { TrackPort } from '../track/port.js';
import type { KnobParam } from '../types/param.js';
import { loadHierarchy }    from './hierarchy.js';
import { applyKnobDelta, knobParamInfo, reseedPadParams, refreshModulatedKeys, slotToLocal }   from './store.js';
import { buildViewModel }   from './viewmodel.js';
import { processTick }      from './tick.js';
import { KNOBS_PER_PAGE, LONG_PRESS_TICKS, NAME_POLL_TICKS, ENUM_DELTA_DIV, ITEMS_RELOAD_TICKS } from './constants.js';
import { enumUsesIndex, enumSetValue } from './enum-value.js';
import { basename, dirname } from './path.js';
import { fileContentAllows } from './file-validate.js';
import { mlog } from '../log.js';
import { isItemSelector, itemValueAt, refreshItems } from './items-param.js';

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
 * (browser/file-handler.ts) is the one that shows folders for navigation.
 *
 * One pass, and as few stats as possible. Both matter on a real sample folder:
 * this ran five chained array passes, each allocating, and called isDir — an
 * os.stat SYSCALL — on every surviving entry. A thousand samples meant a
 * thousand stats before the overlay could appear, which is why opening it
 * lagged.
 *
 * An entry that matched the extension filter is taken as a file without
 * statting. The filter is the module's own statement of what it loads, so a
 * directory would have to be named exactly like a sample ("kick.wav/") to slip
 * through. Entries reaching here WITHOUT a filter are still statted, so the
 * unfiltered case keeps its old guarantee. */
function scanFiles(dir: string, filter: string[]): string[] {
    try {
        const [entries] = (os as { readdir(p: string): [string[], number] }).readdir(dir);
        if (!Array.isArray(entries)) return [];
        const out: string[] = [];
        for (const n of entries) {
            if (n === '.' || n === '..' || n.charAt(0) === '.') continue;
            let matched = false;
            if (filter.length > 0) {
                const lower = n.toLowerCase();
                for (const ext of filter) {
                    if (lower.endsWith(ext)) { matched = true; break; }
                }
                if (!matched) continue;
            }
            const path = dir + '/' + n;
            if (!matched && isDir(path)) continue;
            out.push(path);
        }
        return out.sort();
    } catch { return []; }
}

export function createModel(port: TrackPort, componentKey = 'synth') {
    const s = createModelState(port, componentKey);

    function numBanks() { return Math.max(1, Math.ceil(s.knobParams.length / KNOBS_PER_PAGE)); }

    function primarySlot(): number {
        return s.touchedSlots.length > 0 ? s.touchedSlots[s.touchedSlots.length - 1] : -1;
    }

    function paramAtSlot(k: number): KnobParam | null {
        const local = slotToLocal(s, k);
        if (local < 0) return null;
        return s.knobParams[s.knobPage * KNOBS_PER_PAGE + local] ?? null;
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
            /* An item selector only ever commits from its overlay (opened on
             * touch). A raw delta reaching pendingDeltas would load a bank per
             * detent — and a turn can arrive with no touch at all. */
            if (!isItemSelector(paramAtSlot(k))) s.pendingDeltas[k] += delta;
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
            const local = slotToLocal(s, k);
            const gi = local < 0 ? -1 : s.knobPage * KNOBS_PER_PAGE + local;
            const p  = gi < 0 ? undefined : s.knobParams[gi];
            if (p && p.options && (isItemSelector(p) || (p.type === 'enum' && p.options.length > 6))) {
                /* Re-scan on touch: the list is the module's live directory and
                 * this is the one moment it is cheap to ask (see items-param). */
                const live = isItemSelector(p) ? refreshItems(s, p) : null;
                if (live !== null) s.knobValues[gi] = live;
                /* Clamped because the re-scan can SHRINK the list: a bank
                 * deleted while movy was open leaves the cached position past
                 * the end, and committing that would write an index the module
                 * never offered. */
                const sel = Math.min(p.options.length - 1,
                                     Math.max(0, Math.round((s.knobValues[gi] ?? 0) as number)));
                s.enumOverlay = { slot: k, gi, options: p.options, selected: sel };
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
                        labels: items.map((f) => basename(f).slice(0, 12)),
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
                const gi = s.enumOverlay.gi;
                const p = s.knobParams[gi];
                if (p) {
                    const idx = s.enumOverlay.selected;
                    s.knobValues[gi] = idx;
                    // Send in the module's own enum format (name vs index), learned
                    // on read; probe once if this enum was never read.
                    if (s.enumFmt[gi] === undefined) {
                        s.enumFmt[gi] = enumUsesIndex(p.options, s.port.getParam(s.componentKey + ':' + p.key));
                    }
                    const usesIndex = s.moduleConfig?.enumSetIndex ? true : (s.enumFmt[gi] as boolean);
                    const key = s.componentKey + ':' + p.key;
                    const old = s.port.getParam(key);
                    /* A selector's on-screen position is not its wire value —
                     * the module's own index is, and a sparse list makes the
                     * two differ (see items-param.ts). */
                    const val = isItemSelector(p)
                        ? itemValueAt(p, idx) : enumSetValue(p.options, idx, usesIndex);
                    /* Same shape as store.ts's turn-path line: an overlay commit
                     * used to write nothing to the log at all, so on device an
                     * enum chosen from the list was indistinguishable from one
                     * never chosen. */
                    mlog('set slot=' + s.port.track.index + ' gi=' + gi + ' key=' + key + ' val=' + val);
                    undoableEdit((p.label || p.key).toUpperCase(), 'T' + (s.port.track.index + 1), () => {
                        /* Committing from the overlay is the same lossy inverse
                         * as turning the knob — snapshot the module. */
                        if (p.capturesModuleState) {
                            recordPresetState(s.port.track.index, s.componentKey);
                        }
                        setChainParam(s.port, key, val, old);
                    });
                    /* Choosing an item loads a whole bank: the preset list, and
                     * for sfz/minijv the hierarchy itself, are now stale. Let
                     * the DSP settle, then re-read the module — the same
                     * settle-then-re-read the schwung host does. */
                    if (isItemSelector(p)) s.itemsReloadCountdown = ITEMS_RELOAD_TICKS;
                }
                s.enumOverlay = null;
            }
            if (s.fileOverlay && (k === undefined || k === s.fileOverlay.slot)) {
                const p = s.knobParams[s.fileOverlay.gi];
                if (p && s.fileOverlay.items.length > 0) {
                    const path = s.fileOverlay.items[s.fileOverlay.selected];
                    if (fileContentAllows(path, p.fileRequireContains)) {
                        s.fileValues[s.fileOverlay.gi] = path;
                        const key = s.componentKey + ':' + p.key;
                        const old = s.port.getParam(key);
                        undoableEdit('LOAD FILE', 'T' + (s.port.track.index + 1),
                            () => setChainParam(s.port, key, path, old));
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

        /* Clear only the knob touch/hold state — lighter than reset() (which
         * reloads the hierarchy). Called when the shown param page changes so a
         * held knob's highlight never persists after navigation, and whenever a
         * release provably cannot arrive (app/input-reset.ts).
         *
         * The open enum/file overlay is DROPPED, not committed: its release is
         * what commits it, and this path exists precisely because that release
         * is gone. A stuck overlay swallows the knob it belongs to and blocks
         * changePage entirely, so leaving one behind is the bug, not the fix. */
        clearTouch(): void {
            if (s.touchedSlots.length || s.longPressCountdown >= 0
                || s.enumOverlay || s.fileOverlay) {
                s.touchedSlots.length = 0;
                s.longPressCountdown = -1;
                s.enumOverlay = null;
                s.fileOverlay = null;
                s.dirty = true;
            }
        },

        getKnobPage(): number { return s.knobPage; },

        getBankCount(): number { return numBanks(); },

        changePage(delta: number): void {
            if (s.enumOverlay) return;
            const nBanks = numBanks();
            const next = Math.max(0, Math.min(nBanks - 1, s.knobPage + delta));
            mlog('changePage delta=' + delta + ' ' + s.knobPage + '→' + next + '/' + nBanks);
            if (next !== s.knobPage) { s.knobPage = next; s.dirty = true; }
        },

        /* Shift+jog: jump to the head of the previous/next level. From mid-level
         * a backward jump lands on the current level's own head first — the same
         * "back out to the section start" feel as a paragraph jump. */
        changePageGroup(delta: number): void {
            if (s.enumOverlay) return;
            const n = numBanks();
            const groups = s.bankGroups;
            if (n === 0) return;
            if (groups.length !== n) {
                // No group map (shouldn't happen) — degrade to a plain page turn.
                const clamped = Math.max(0, Math.min(n - 1, s.knobPage + delta));
                if (clamped !== s.knobPage) { s.knobPage = clamped; s.dirty = true; }
                return;
            }
            const here = groups[s.knobPage];
            let next = s.knobPage;
            if (delta > 0) {
                while (next < n - 1 && groups[next] === here) next++;
            } else {
                while (next > 0 && groups[next] === here) next--;
                const target = groups[next];
                while (next > 0 && groups[next - 1] === target) next--;
            }
            mlog('changePageGroup delta=' + delta + ' ' + s.knobPage + '→' + next + '/' + n);
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
            const local = slotToLocal(s, primary);
            if (local < 0) return null;
            const gi = s.knobPage * KNOBS_PER_PAGE + local;
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

        /* Re-read one param the model did not write itself (undo restoring a
         * value straight into the DSP). Returns false when this model does not
         * own the key. */
        refreshParamKey(ioKey: string): boolean { return refreshParamKey(s, ioKey); },

        getKnobParamInfo(physK: number) { return knobParamInfo(s, physK); },

        /* Keys whose synth value the param page must not read back (automation
         * lanes — the page shows the UI-owned base). */
        setNoRefreshKeys(keys: string[]): void {
            s.noRefreshKeys.clear();
            for (const k of keys) s.noRefreshKeys.add(k);
        },

        /* Re-read which of this component's params a slot LFO targets (for the ~
         * mark + read-back suppression). Called after an assign/remove so the
         * change shows immediately without waiting for the poll. */
        refreshModulation(): void { refreshModulatedKeys(s); },

        /* Range of a loaded param by key (for automation-lane validation), or
         * null if this module has no such param. Authoritative for config-driven
         * drum modules, where chain_params may be absent. */
        paramRangeByKey(key: string): { min: number; max: number; type: string } | null {
            const p = s.knobParams.find((p) => p?.key === key);
            return p ? { min: p.min, max: p.max, type: p.type } : null;
        },

        /* True once this slot's module hierarchy has loaded (params known). */
        hasLoadedParams(): boolean { return s.knobParams.some((p) => p != null); },

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

        /* The two drum facts the app tick needs every frame. They are plain
         * ModelState fields; reading them through getViewModel() meant building
         * the whole view model — pages, envelopes, filter curves — and throwing
         * all but one number away, on every tick and for a model that may not
         * even be on screen. */
        getDrumPadCount(): number { return s.drumPadCount; },
        getDrumCurrentPad(): number { return s.drumCurrentPad; },
        getDrumCurrentPhysPad(): number { return s.drumCurrentPhysPad; },

        /* Read-only layout snapshot for external tooling (scripts/dump-movy-layout.mjs).
         * Exposes raw KnobParams (incl. step, which no other public accessor has). */
        dumpLayout(): {
            moduleId:     string;
            moduleName:   string;
            componentKey: string;
            banks:        { name: string; global: boolean; padSpecific: boolean }[];
            hasConfig:    boolean;
            /* Keys the module is hiding via visible_if right now. Exposed so the
             * dump-replay reachability invariant can tell a deliberately hidden
             * param from one movy lost. */
            hiddenKeys:   string[];
            drum:         import('../types/param.js').DrumConfig | null;
            params:       (import('../types/param.js').KnobParam | null)[];
        } {
            // Config modules keep bank names in moduleConfig.banks; the generic
            // path keeps them in s.bankNames (see loadHierarchy).
            const banks = s.moduleConfig
                ? s.moduleConfig.banks.map(b => ({ name: b.name, global: !!b.global, padSpecific: !!b.padSpecific }))
                : s.bankNames.map(n => ({ name: n, global: false, padSpecific: false }));
            return {
                moduleId:     s.moduleId,
                moduleName:   s.activeModuleName,
                componentKey: s.componentKey,
                banks,
                hasConfig:    s.moduleConfig !== null,
                hiddenKeys:   [...s.hiddenKeys],
                drum:         s.moduleConfig?.drum ?? null,
                params:       s.knobParams.map(p => p ? { ...p } : null),
            };
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
