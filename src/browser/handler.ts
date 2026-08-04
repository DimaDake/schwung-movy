import { browserState } from './state.js';
import { appState, VIEW_BROWSE } from '../app/state.js';
import { moduleReadKey, type ChainSlot } from '../chain/config.js';
import { requestLaneWarm } from '../seq/automation.js';
import { releaseAllLive } from '../keyboard/release.js';
import { dumpModuleParams } from '../undo/module-dump.js';
import { addModuleOp, beginEdit, endEdit, CLOSE } from '../undo/group.js';

const MODULES_BASE = '/data/UserData/schwung/modules';

function scanModules(slot: ChainSlot): { id: string; name: string; path: string }[] {
    const dir    = `${MODULES_BASE}/${slot.scanDir}`;
    const result: { id: string; name: string; path: string }[] = [];
    try {
        const [entries] = os.readdir(dir) as [string[], number];
        if (!Array.isArray(entries)) return result;
        for (const entry of entries) {
            if (entry === '.' || entry === '..') continue;
            try {
                const raw = host_read_file(`${dir}/${entry}/module.json`);
                if (!raw) continue;
                const json = JSON.parse(raw) as {
                    id?: string; name?: string; dsp?: string;
                    component_type?: string;
                    capabilities?: { component_type?: string };
                };
                const ct = json.component_type || json.capabilities?.component_type;
                if (ct === slot.expectedType) {
                    // Master FX slots load by DSP path (see loadSelectedModule); track
                    // slots load by id. Capture both so either can be written.
                    const path = `${dir}/${entry}/${json.dsp || 'dsp.so'}`;
                    result.push({ id: json.id || entry, name: json.name || entry, path });
                }
            } catch {}
        }
    } catch {}
    result.sort((a, b) => a.name.localeCompare(b.name));
    return result;
}

/* Open the module browser for a chain slot. `paramSlot` is the shadow param
 * slot (0-3 for track chains, 0 for the master bus); `reload` refreshes the
 * model backing this slot after a load. Generalized over CHAIN_SLOTS and
 * MASTER_FX_SLOTS so master FX slots browse/load like track slots. */
export function openBrowser(slot: ChainSlot, paramSlot: number, reload: () => void): void {
    browserState.componentKey = slot.componentKey;
    browserState.paramSlot    = paramSlot;
    browserState.reload       = reload;
    browserState.modules      = [{ id: '', name: 'NONE', path: '' }, ...scanModules(slot)];
    browserState.browseIndex  = 0;
    const activeId = shadow_get_param(paramSlot, moduleReadKey(slot.componentKey)) || '';
    const idx = browserState.modules.findIndex(m => m.id === activeId);
    if (idx >= 0) browserState.browseIndex = idx;
    appState.currentView = VIEW_BROWSE;
    appState.dirty = true;
}

export function loadSelectedModule(): void {
    if (browserState.modules.length === 0) return;
    const mod = browserState.modules[browserState.browseIndex];
    // Track chain slots load a module by its id (`fx1:module` = "reverb"); master
    // FX slots (colon-namespaced componentKey, e.g. `master_fx:fx1`) instead take
    // the full DSP path — schwung's master bus resolves `master_fx:fxN:module`
    // as a path, not an id, so writing the id silently no-ops.
    const isMaster = browserState.componentKey.includes(':');
    const value    = isMaster ? mod.path : mod.id;
    // The outgoing module is about to be torn down; its notes must be released
    // while it is still there to receive the off.
    releaseAllLive();
    /* Dump BEFORE the write: schwung tears the outgoing module down, and after
     * that its params are unrecoverable. A reselect of the same module records
     * nothing — it changes no state worth an undo press. */
    const prevId = shadow_get_param(browserState.paramSlot,
        moduleReadKey(browserState.componentKey)) || '';
    if (prevId !== value) {
        const dump = dumpModuleParams(browserState.paramSlot, browserState.componentKey);
        beginEdit({
            key: 'module:' + browserState.paramSlot + ':' + browserState.componentKey,
            verb: value ? 'LOAD MODULE' : 'CLEAR SLOT',
            target: 'T' + (browserState.paramSlot + 1),
            detail: (mod.name || value || 'NONE').toUpperCase(),
            close: CLOSE.IMMEDIATE, seq: true,
        });
        addModuleOp({
            slot: browserState.paramSlot,
            componentKey: browserState.componentKey,
            oldModuleId: prevId,
            newModuleId: value,
            oldParams: dump,
        });
    }
    shadow_set_param(browserState.paramSlot, browserState.componentKey + ':module', value);
    if (prevId !== value) endEdit();
    // The reload empties the host's static param cache; a same-id reselect won't
    // trip the module-name watcher, so schedule the warm here too (see
    // warmLaneParams) — without it, abs-CC automation is inaudible until restart.
    requestLaneWarm(browserState.paramSlot);
    appState.currentView = appState.browseOrigin;
    appState.dirty = true;
    browserState.reload?.();
}
