import { createModelState } from './state.js';
import type { TrackPort } from '../track/port.js';
import { childTemplateOf } from './child-keys.js';
import { buildGenericParam } from './param-build.js';
import { refreshModulatedKeys, enumLaneInfo, paramIoKey } from './store.js';
import { buildViewModel }   from './viewmodel.js';
import { processTick, reReadModule } from './tick.js';
import { NAME_POLL_TICKS } from './constants.js';
import { rememberFileDir, defaultDirFor } from './file-dirs.js';

/* Everything the file browser needs to open on one parameter. `gi` is movy's
 * own index, and the only handle its file-value cache answers to. */
export interface FileBrowseTarget {
    key: string; gi: number; root: string; filter: string[]; startPath: string;
    currentPath: string | null; requireContains?: string;
    browse?: import('../types/param.js').FileBrowseDecl;
}

export function createModel(port: TrackPort, componentKey = 'synth') {
    const s = createModelState(port, componentKey);

    function primarySlot(): number {
        return s.touchedSlots.length > 0 ? s.touchedSlots[s.touchedSlots.length - 1] : -1;
    }

    /* What the file browser needs to open on the right parameter. The current
     * path is read live: the browser opens on it, and nothing else in movy
     * mirrors a module's values any more. */
    function fileTargetByGi(gi: number): FileBrowseTarget | null {
        const p = s.knobParams[gi];
        if (!p || p.type !== 'file') return null;
        const raw = s.port.getParam(s.componentKey + ':' + paramIoKey(s, p));
        return {
            key:         p.key,
            gi,
            root:        p.fileRoot      ?? '/data/UserData',
            filter:      p.fileFilter    ?? [],
            startPath:   defaultDirFor(s.moduleId, p),
            currentPath: raw ? raw : null,
            requireContains: p.fileRequireContains,
            browse: p.fileBrowse,
        };
    }

    /* First match: a key repeated across levels (jp8000's shape) carries the
     * same declaration. */
    function fileTargetByKey(key: string): FileBrowseTarget | null {
        return fileTargetByGi(s.knobParams.findIndex((q) => q?.key === key));
    }

    return {
        /* The touch is recorded for the gestures that ask which knob is held —
         * the file-browse jog click and the release. The page under the finger
         * is Schwung's; the model opens nothing of its own. */
        handleKnobTouch(k: number): void {
            const idx = s.touchedSlots.indexOf(k);
            if (idx >= 0) s.touchedSlots.splice(idx, 1);
            s.touchedSlots.push(k);
            s.dirty = true;
        },

        handleKnobRelease(k?: number): void {
            if (k !== undefined) {
                const idx = s.touchedSlots.indexOf(k);
                if (idx >= 0) s.touchedSlots.splice(idx, 1);
            } else {
                s.touchedSlots.length = 0;
            }
            s.dirty = true;
        },

        /* Clear only the knob touch state — lighter than reset() (which reloads
         * the hierarchy). Called when the shown param page changes, and whenever
         * a release provably cannot arrive (app/input-reset.ts). */
        clearTouch(): void {
            if (s.touchedSlots.length) { s.touchedSlots.length = 0; s.dirty = true; }
        },

        getModuleName(): string { return s.activeModuleName; },

        reset(): void {
            s.touchedSlots.length = 0;
            s.pollCountdown = NAME_POLL_TICKS;
            s.dirty = true;
        },

        tick(): boolean { return processTick(s); },

        getViewModel(auto?: import('../types/viewmodel.js').AutomationView) { return buildViewModel(s, auto); },

        reload(): void { s.hierarchyKey = ''; s.pollCountdown = 1; s.dirty = true; },

        /* `reload()` schedules the re-read for this model's next tick; this does
         * it now. Used where the next frame must already show the new module —
         * a Set load, where the poll's ~1 s cadence is what put an empty slot,
         * or the previous Set's module, on a surface that had gone live. */
        reloadNow(): void { reReadModule(s); },

        /* The held knob's file param, resolved through `keyAt` — the page on
         * screen's own key for that slot. `model/` cannot see who draws the page
         * (it may not import `app/`), so the answer is passed in. */
        getFileBrowseTarget(keyAt: (slot: number) => string | null): FileBrowseTarget | null {
            const primary = primarySlot();
            if (primary < 0) return null;
            const drawn = keyAt(primary);
            return drawn ? fileTargetByKey(drawn) : null;
        },
        /*
         * THE SAME ANSWER WITHOUT A SLOT, and it is asked for by the caller that
         * has no business naming one. A DIVE arrives as `{action:"open", key,
         * fullKey}` — the controller's own anchor — and it does NOT arrive with
         * a slot: under a delegated page Schwung holds the touch order, and the
         * anchor is not always the cell that was clicked (a gizmo inside a
         * sample graphic redirects). Routing that through `getFileBrowseTarget`
         * would mean handing it a thunk that returns one constant and hoping
         * `primarySlot()` happens to be >= 0 — movy's own `touchedSlots`, which
         * is precisely the state a page Schwung is drawing does not fill. The
         * fallback would then vanish silently, and the browser would open on
         * Schwung's declaration alone with no sign that movy's config had been
         * consulted at all.
         */
        fileBrowseTargetForKey(key: string): FileBrowseTarget | null {
            return fileTargetByKey(key);
        },

        /* The full-screen browser's commit path; records where the file came
         * from. */
        setFileValue(gi: number, path: string): void {
            const p = s.knobParams[gi];
            if (p) rememberFileDir(s.moduleId, p.key, path);
        },

        getComponentKey(): string { return s.componentKey; },

        /* Re-read which of this component's params a slot LFO targets (for the ~
         * mark + read-back suppression). Called after an assign/remove so the
         * change shows immediately without waiting for the poll. */
        refreshModulation(): void { refreshModulatedKeys(s); },

        /* The same cached set, answered by KEY rather than by ParamVM.
         *
         * Schwung's page controller asks "is this parameter modulated?" with the
         * module's own key, before any of movy's pages has been laid out — and
         * the delegated page has no ParamVM to ask through. One source for both
         * marks is the point: a tilde drawn by movy and a mod dot drawn by
         * Schwung that disagreed would be two readings of one fact. */
        modulatedKeys(): ReadonlySet<string> { return s.modulatedKeys; },

        /* Range of a loaded param by key (for automation-lane validation), or
         * null if this module has no such param. Authoritative for config-driven
         * drum modules, where chain_params may be absent. */
        paramRangeByKey(key: string): { min: number; max: number; type: string; options?: string[]; wiresNames?: boolean } | null {
            const gi = s.knobParams.findIndex((p) => p?.key === key);
            const p = gi >= 0 ? s.knobParams[gi] : null;
            /* An enum lane restored from a Set is re-bound from this answer, so
             * it has to carry the options and the wire form the bind writes. */
            if (p) return { min: p.min, max: p.max, type: p.type, ...(enumLaneInfo(s, gi) ?? {}) };
            /* A key the module declares but no movy page shows: built the way
             * a config-less module's cell is, from the same metadata. */
            const d = s.declared;
            if (!d || !d.keys.has(key)) return null;
            const g = buildGenericParam(key, d.cp[key] ?? {}, d.defs[key] ?? {});
            if (g.type === 'file') return null;
            return { min: g.min, max: g.max, type: g.type,
                     ...(g.type === 'enum' && g.options ? { options: g.options } : {}) };
        },

        /* The child-level template a concrete key instantiates
         * (`pad16_start` → `start`), or null. See model/child-keys.ts. */
        childTemplateOf(key: string): string | null { return childTemplateOf(s.childLevels, key); },

        /* The keys only pad `pad`'s voice owns (1-based), or null when the
         * module declares no voice map. See model/voice-keys.ts. */
        voiceKeysOf(pad: number): readonly string[] | null {
            return s.voiceKeys.length ? (s.voiceKeys[pad - 1] ?? []) : null;
        },

        /* True once this slot's module hierarchy has loaded (params known). */
        hasLoadedParams(): boolean { return s.knobParams.some((p) => p != null); },


        /* The module's declared live-press param, for the router's vouch.
         * Null for every module that has not declared one, which is all of
         * them in docs/module-dump/. */
        getPressParam(): string | null { return s.pressParam; },
        getDrumConfig(): import('../types/param.js').DrumConfig | null {
            /* `drumConfig` is the RESOLVED one — the module's declaration where
             * it made one, movy's table otherwise — settled once per hierarchy
             * load. Falls back to the table for a model whose hierarchy has not
             * loaded yet, which is what this returned before. */
            return s.drumConfig ?? s.moduleConfig?.drum ?? null;
        },

        /* The two drum facts the app tick needs every frame. They are plain
         * ModelState fields; reading them through getViewModel() meant building
         * the whole view model — pages, envelopes, filter curves — and throwing
         * all but one number away, on every tick and for a model that may not
         * even be on screen. */
        getDrumPadCount(): number { return s.drumPadCount; },
        /* The voice names a DECLARED rack gave, 1-based ('' for a rack that
         * declared none). A gesture has to name the voice it moved, and the
         * view model's `drumPadName` is the FOCUSED pad's — the wrong one. */
        getDrumPadNames(): string[] { return s.drumPadNames; },
        getDrumCurrentPad(): number { return s.drumCurrentPad; },
        getDrumCurrentPhysPad(): number { return s.drumCurrentPhysPad; },

        /* Read-only snapshot of the param registry, for tests and tooling.
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
            s.dirty = true;
        },
    };
}

export type Model = ReturnType<typeof createModel>;
