/* file-preview.ts — a file browser that previews, and the module's hooks around it.
 *
 * Schwung's own browser (shadow_ui.js openHierarchyFilepathBrowser and
 * closeHierarchyFilepathBrowser) honours two declarations movy's ignored:
 *
 *   live_preview   the file under the cursor is written to the param once the
 *                  cursor rests (150 ms, Schwung's figure), so you hear it
 *                  before choosing; leaving without a pick writes the original
 *                  back.
 *   browser_hooks  extra writes on open / each preview / commit / cancel, a
 *                  `restore: true` one put back on close whatever happened.
 *
 * Both or neither: a preview without the cancel hook breaks DR32, whose kit
 * preview reloads all 32 pads — only its `kit_restore` hook can undo that.
 *
 * Preview and hook writes go straight to the port, NOT through the undo log:
 * the commit is the one undo step, and its "before" is the value from before
 * the browser opened, not the last preview.
 */
import type { FileBrowserState } from '../app/state.js';
import type { FileBrowseDecl, FileHookAction } from '../types/param.js';
import { componentPort } from '../track/registry.js';
import { hookValue } from '../model/file-decl.js';

export const PREVIEW_REST_MS = 150;

export interface FilePreview {
    decl: FileBrowseDecl;
    fullKey: string;
    original: string;
    current: string;
    restore: Record<string, string>;
    pendingPath: string;
    pendingAt: number;
}

const portOf = (st: FileBrowserState) => componentPort(st.paramSlot, st.componentKey);
const qualify = (st: FileBrowserState, k: string) => (k.indexOf(':') >= 0 ? k : st.componentKey + ':' + k);

function run(st: FileBrowserState, list: FileHookAction[], path: string): void {
    const pv = st.preview;
    if (!pv) return;
    const port = portOf(st);
    for (const a of list) {
        const key = qualify(st, a.key);
        if (a.restore && !(key in pv.restore)) {
            const prev = port.getParam(key);
            if (prev !== null && prev !== undefined) pv.restore[key] = String(prev);
        }
        port.setParam(key, hookValue(a.value, path));
    }
}

function apply(st: FileBrowserState, path: string): void {
    const pv = st.preview;
    if (!pv || !pv.decl.live || !path || path === pv.current) return;
    portOf(st).setParam(pv.fullKey, path);
    pv.current = path;
    run(st, pv.decl.hooks.onPreview, path);
}

const selectedFile = (st: FileBrowserState): string => {
    const it = st.items[st.selectedIndex];
    return it && !it.isDir ? it.path : '';
};

/** Arm a freshly opened browser. No declaration, no preview: nothing changes. */
export function previewBegin(st: FileBrowserState, decl: FileBrowseDecl | null | undefined): void {
    if (!decl) return;
    const fullKey = st.componentKey + ':' + st.paramKey;
    const original = String(portOf(st).getParam(fullKey) ?? '');
    st.preview = { decl, fullKey, original, current: original, restore: {}, pendingPath: '', pendingAt: 0 };
    run(st, decl.hooks.onOpen, original);
    /* Schwung previews what the cursor opens on, too. */
    apply(st, selectedFile(st));
}

/** The cursor moved: preview once it rests. */
export function previewCursorMoved(st: FileBrowserState, now: number): void {
    const pv = st.preview;
    if (!pv || !pv.decl.live) return;
    pv.pendingPath = selectedFile(st);
    pv.pendingAt = pv.pendingPath ? now : 0;
}

/** A folder was entered: what the cursor lands on previews at once. */
export function previewDirEntered(st: FileBrowserState): void {
    const pv = st.preview;
    if (!pv) return;
    pv.pendingPath = ''; pv.pendingAt = 0;
    apply(st, selectedFile(st));
}

export function previewTick(st: FileBrowserState | null, now: number): void {
    const pv = st && st.preview;
    if (!st || !pv || !pv.pendingPath || now - pv.pendingAt < PREVIEW_REST_MS) return;
    const path = pv.pendingPath;
    pv.pendingPath = ''; pv.pendingAt = 0;
    apply(st, path);
}

/** The value the commit's undo step returns to — before ANY preview. */
export function previewOriginal(st: FileBrowserState): string | null {
    return st.preview ? st.preview.original : null;
}

/** Close after a pick (`path`), or without one (null). */
export function previewEnd(st: FileBrowserState, path: string | null): void {
    const pv = st.preview;
    if (!pv) return;
    if (path !== null) {
        run(st, pv.decl.hooks.onCommit, path);
    } else {
        if (pv.decl.live && pv.current !== pv.original) portOf(st).setParam(pv.fullKey, pv.original);
        run(st, pv.decl.hooks.onCancel, pv.original);
    }
    const port = portOf(st);
    for (const [k, v] of Object.entries(pv.restore)) port.setParam(k, v);
    st.preview = undefined;
}
