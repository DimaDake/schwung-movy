import { browserState } from './state.js';
import { appState, VIEW_BROWSE, VIEW_KNOBS } from '../app/state.js';

const MODULES_DIR = '/data/UserData/schwung/modules/sound_generators';

function scanModules(): { id: string; name: string }[] {
    const result: { id: string; name: string }[] = [];
    try {
        const [entries] = os.readdir(MODULES_DIR) as [string[], number];
        if (!Array.isArray(entries)) return result;
        for (const entry of entries) {
            if (entry === '.' || entry === '..') continue;
            try {
                const raw = host_read_file(`${MODULES_DIR}/${entry}/module.json`);
                if (!raw) continue;
                const json = JSON.parse(raw) as { id?: string; name?: string; component_type?: string; capabilities?: { component_type?: string } };
                const ct = json.component_type || json.capabilities?.component_type;
                if (ct === 'sound_generator') {
                    result.push({ id: json.id || entry, name: json.name || entry });
                }
            } catch {}
        }
    } catch {}
    result.sort((a, b) => a.name.localeCompare(b.name));
    return result;
}

export function openBrowser(activeSlot: number): void {
    browserState.modules = scanModules();
    browserState.browseIndex = 0;
    const activeId = shadow_get_param(activeSlot, 'synth_module') || '';
    const idx = browserState.modules.findIndex(m => m.id === activeId);
    if (idx >= 0) browserState.browseIndex = idx;
    appState.currentView = VIEW_BROWSE;
    appState.dirty = true;
}

export function loadSelectedModule(activeSlot: number): void {
    if (browserState.modules.length === 0) return;
    const mod = browserState.modules[browserState.browseIndex];
    shadow_set_param(activeSlot, 'synth:module', mod.id);
    appState.currentView = VIEW_KNOBS;
    appState.dirty = true;
}
