/* The half of the Model interface a fixed-function page does not have.
 *
 * A virtual chain slot (today: the LFO page, on a track or on the master chain)
 * holds no module, so it has no file params, no automation lanes, no drum pads
 * and no KnobParams to dump. That is a dozen accessors of nothing, which is
 * enough to bury the part of the model that does something.
 *
 * Kept as one object so the app tick can ask any of them cheaply — the module
 * model answers the same questions without building a ViewModel, and a page that
 * threw or returned undefined here would break that contract. */

import type { Model } from '../model/index.js';

/** Every Model member a page with no module answers the same way. */
export type InertModelSurface = Pick<Model,
    'getFileBrowseTarget' | 'clearFileOverlay' | 'setFileValue' |
    'getKnobParamInfo' | 'setNoRefreshKeys' | 'refreshModulation' |
    'paramRangeByKey' | 'getValueByKey' |
    'getDrumConfig' | 'getDrumPadCount' | 'getDrumCurrentPad' |
    'getDrumCurrentPhysPad' | 'updateDrumPad' | 'dumpLayout'>;

export function inertModelSurface(id: string, name: string, componentKey: string): InertModelSurface {
    return {
        getFileBrowseTarget() { return null; },
        clearFileOverlay(): void { /* no file params */ },
        setFileValue(_gi: number, _path: string): void { /* no file params */ },
        getKnobParamInfo(_physK: number) { return null; },     // not automatable
        setNoRefreshKeys(_keys: string[]): void { /* no automation lanes */ },
        refreshModulation(): void { /* LFO params aren't modulation targets */ },
        paramRangeByKey(_key: string) { return null; },
        getValueByKey(_key: string) { return null; },
        getDrumConfig() { return null; },
        /* Never a drum module; mirrors the module model's cheap accessors so the
         * app tick never has to build a VM to ask. */
        getDrumPadCount() { return 0; },
        getDrumCurrentPad() { return 0; },
        getDrumCurrentPhysPad() { return 0; },
        updateDrumPad(_pad: number, _physPad: number): void { /* not a drum */ },
        /* Fixed-function: no KnobParams, so nothing to dump. */
        dumpLayout() {
            return { moduleId: id, moduleName: name, componentKey,
                     banks: [], hasConfig: false, hiddenKeys: [], drum: null, params: [] };
        },
    };
}
