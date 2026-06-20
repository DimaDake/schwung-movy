import type { FileBrowserItem, FileBrowserState } from '../app/state.js';
import { appState, VIEW_FILE_BROWSE } from '../app/state.js';
import { dirname } from '../model/path.js';
import { fileContentAllows } from '../model/file-validate.js';
import { seqToast } from '../seq/render.js';

function isDir(path: string): boolean {
    try {
        const [st] = os.stat(path);
        return (st.mode & 0xF000) === 0x4000;
    } catch { return false; }
}

function scanDir(dir: string, root: string, filter: string[]): FileBrowserItem[] {
    const items: FileBrowserItem[] = [];
    if (dir !== root) {
        items.push({ name: '..', path: dirname(dir), isDir: true });
    }
    try {
        const [entries] = os.readdir(dir);
        if (!Array.isArray(entries)) return items;
        const fileItems: FileBrowserItem[] = [];
        const dirItems:  FileBrowserItem[] = [];
        for (const name of entries) {
            if (name === '.' || name === '..') continue;
            const path  = dir + '/' + name;
            const d     = isDir(path);
            if (!d && filter.length > 0) {
                const lower = name.toLowerCase();
                if (!filter.some(ext => lower.endsWith(ext))) continue;
            }
            (d ? dirItems : fileItems).push({ name, path, isDir: d });
        }
        dirItems.sort((a, b)  => a.name.localeCompare(b.name));
        fileItems.sort((a, b) => a.name.localeCompare(b.name));
        items.push(...dirItems, ...fileItems);
    } catch {}
    return items;
}

export function openFileBrowser(
    paramSlot:    number,
    componentKey: string,
    paramKey:     string,
    gi:           number,
    root:         string,
    filter:       string[],
    startPath:    string,
    currentPath:  string | null,
    requireContains?: string,
): void {
    const startDir = currentPath ? dirname(currentPath) : (startPath || root);
    const items    = scanDir(startDir, root, filter);

    let selectedIndex = 0;
    if (currentPath) {
        const idx = items.findIndex(it => it.path === currentPath);
        if (idx >= 0) selectedIndex = idx;
    }

    appState.fileBrowserState = {
        paramSlot, componentKey, paramKey, gi,
        root, filter, currentDir: startDir,
        items, selectedIndex, requireContains,
    };
    appState.currentView = VIEW_FILE_BROWSE;
    appState.dirty = true;
}

export function navigateFileBrowser(delta: number): void {
    const state = appState.fileBrowserState;
    if (!state) return;
    state.selectedIndex = Math.max(0, Math.min(state.items.length - 1, state.selectedIndex + delta));
    appState.dirty = true;
}

export function activateFileBrowserItem(): void {
    const state = appState.fileBrowserState;
    if (!state) return;
    const item = state.items[state.selectedIndex];
    if (!item) return;

    if (item.isDir) {
        const newDir = item.path;
        state.items      = scanDir(newDir, state.root, state.filter);
        state.currentDir = newDir;
        state.selectedIndex = 0;
        appState.dirty = true;
    } else {
        /* Reject a preset built for a different instrument before committing —
         * keep the browser open so the user can pick another. */
        if (!fileContentAllows(item.path, state.requireContains)) {
            seqToast('Wrong preset type');
            return;
        }
        shadow_set_param(state.paramSlot, state.componentKey + ':' + state.paramKey, item.path);
        const chainIdx = appState.trackChainIndex[state.paramSlot];
        appState.trackModels[state.paramSlot]?.[chainIdx]?.setFileValue(state.gi, item.path);
        appState.fileBrowserState = null;
        appState.currentView      = appState.browseOrigin;
        appState.dirty = true;
    }
}
