import { browserState } from './state.js';
import { appState, VIEW_BROWSE } from '../app/state.js';
import { CHAIN_SLOTS } from '../chain/config.js';

const MODULES_BASE = '/data/UserData/schwung/modules';

function scanModules(chainIndex: number): { id: string; name: string }[] {
    const slot   = CHAIN_SLOTS[chainIndex];
    const dir    = `${MODULES_BASE}/${slot.scanDir}`;
    const result: { id: string; name: string }[] = [];
    try {
        const [entries] = os.readdir(dir) as [string[], number];
        if (!Array.isArray(entries)) return result;
        for (const entry of entries) {
            if (entry === '.' || entry === '..') continue;
            try {
                const raw = host_read_file(`${dir}/${entry}/module.json`);
                if (!raw) continue;
                const json = JSON.parse(raw) as {
                    id?: string; name?: string;
                    component_type?: string;
                    capabilities?: { component_type?: string };
                };
                const ct = json.component_type || json.capabilities?.component_type;
                if (ct === slot.expectedType) {
                    result.push({ id: json.id || entry, name: json.name || entry });
                }
            } catch {}
        }
    } catch {}
    result.sort((a, b) => a.name.localeCompare(b.name));
    return result;
}

export function openBrowser(activeSlot: number, chainIndex: number): void {
    const slot = CHAIN_SLOTS[chainIndex];
    browserState.componentKey = slot.componentKey;
    browserState.modules      = scanModules(chainIndex);
    browserState.browseIndex  = 0;
    const activeId = shadow_get_param(activeSlot, slot.componentKey + '_module') || '';
    const idx = browserState.modules.findIndex(m => m.id === activeId);
    if (idx >= 0) browserState.browseIndex = idx;
    appState.currentView = VIEW_BROWSE;
    appState.dirty = true;
}

export function loadSelectedModule(activeSlot: number): void {
    if (browserState.modules.length === 0) return;
    const mod = browserState.modules[browserState.browseIndex];
    shadow_set_param(activeSlot, browserState.componentKey + ':module', mod.id);
    appState.currentView = appState.browseOrigin;
    appState.dirty = true;
    const idx = CHAIN_SLOTS.findIndex(s => s.componentKey === browserState.componentKey);
    if (idx >= 0) appState.chainModels[idx]?.reload();
}
