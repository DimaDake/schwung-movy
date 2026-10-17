/* A Model for a chain slot with no module behind it: the LFO page (a track's
 * or the master chain's) and the MIX page.
 *
 * Schwung draws both from a translating source (`lfo/lfo-schwung-source.ts`,
 * `chain/own-component-source.ts`) and writes through it, so all movy still
 * needs from the slot is an identity — the component key the page owner asks
 * for — a header, and the touch bookkeeping every model keeps for the release.
 * No file params, no automation lanes of its own, no drum pads. */

import type { Model } from './index.js';
import { headerOnlyVM } from '../seq/header-vm.js';

const NO_MODULATION: ReadonlySet<string> = new Set();

export function createVirtualSlotModel(name: string, componentKey: string,
                                       extra: Partial<Model> = {}): Model {
    const touched: number[] = [];
    let dirty = true;
    return {
        handleKnobTouch(k: number): void {
            const i = touched.indexOf(k);
            if (i >= 0) touched.splice(i, 1);
            touched.push(k);
            dirty = true;
        },
        handleKnobRelease(k?: number): void {
            if (k === undefined) touched.length = 0;
            else { const i = touched.indexOf(k); if (i >= 0) touched.splice(i, 1); }
            dirty = true;
        },
        clearTouch(): void { if (touched.length) { touched.length = 0; dirty = true; } },
        getModuleName(): string { return name; },
        reset(): void { touched.length = 0; dirty = true; },
        tick(): boolean { const d = dirty; dirty = false; return d; },
        getViewModel() { return { ...headerOnlyVM(name), headerOverride: undefined }; },
        reload(): void { dirty = true; },
        reloadNow(): void { dirty = true; },
        getComponentKey(): string { return componentKey; },
        getPressParam(): string | null { return null; },
        hasLoadedParams(): boolean { return true; },
        getFileBrowseTarget() { return null; },
        fileBrowseTargetForKey() { return null; },
        setFileValue(): void { /* no file params */ },
        refreshModulation(): void { /* not a modulation target */ },
        modulatedKeys(): ReadonlySet<string> { return NO_MODULATION; },
        paramRangeByKey() { return null; },
        childTemplateOf() { return null; },
        voiceKeysOf() { return null; },
        getDrumConfig() { return null; },
        getDrumPadCount() { return 0; },
        getDrumPadNames() { return []; },
        getDrumCurrentPad() { return 0; },
        getDrumCurrentPhysPad() { return 0; },
        updateDrumPad(): void { /* not a drum */ },
        dumpLayout() {
            return { moduleId: componentKey, moduleName: name, componentKey,
                     banks: [], hasConfig: false, hiddenKeys: [], drum: null, params: [] };
        },
        ...extra,
    };
}
