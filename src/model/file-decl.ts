/* file-decl.ts — what a filepath param says about ITS BROWSER, beyond root and
 * filter: `live_preview` (load the file under the cursor while scrolling) and
 * `browser_hooks` (extra writes on open / preview / commit / cancel).
 *
 * Parsed the way Schwung's shadow host parses them (shadow_ui.js
 * normalizeFilepathHookActions): a hook is `{key, value, restore}`, a bare key
 * is the param's own component's, and a value may be `$path`/`$filename`
 * (`$selected_*` too) for the file in play. DR32's kit browser is built on
 * them — `kit_mark` on open, `kit_restore` on cancel, `kit_mark=0` on commit —
 * because undoing a kit preview means reloading 32 pads, which writing the old
 * path back cannot express. Pure: no host, no state.
 */
import type { FileBrowseDecl, FileHookAction } from '../types/param.js';

const asBool = (v: unknown): boolean =>
    v === true || v === 1 || ['1', 'true', 'on', 'yes'].includes(String(v ?? '').trim().toLowerCase());

function actions(raw: unknown): FileHookAction[] {
    if (!Array.isArray(raw)) return [];
    const out: FileHookAction[] = [];
    for (const a of raw) {
        if (!a || typeof a !== 'object') continue;
        const key = typeof (a as any).key === 'string' ? (a as any).key.trim() : '';
        if (!key) continue;
        const v = (a as any).value;
        out.push({ key, value: v === undefined || v === null ? '' : String(v), restore: asBool((a as any).restore) });
    }
    return out;
}

/** Null when the param declares neither — the browser then behaves as before. */
export function fileBrowseDeclOf(...defs: any[]): FileBrowseDecl | null {
    const pick = (k: string) => { for (const d of defs) if (d && d[k] !== undefined) return d[k]; return undefined; };
    const live = asBool(pick('live_preview'));
    const h = pick('browser_hooks');
    const hooks = {
        onOpen:    actions(h && h.on_open),
        onPreview: actions(h && h.on_preview),
        onCancel:  actions(h && h.on_cancel),
        onCommit:  actions(h && h.on_commit),
    };
    const any = hooks.onOpen.length + hooks.onPreview.length + hooks.onCancel.length + hooks.onCommit.length;
    return live || any ? { live, hooks } : null;
}

/** A hook value with the file in play substituted. */
export function hookValue(raw: string, path: string): string {
    if (raw === '$path' || raw === '$selected_path') return path;
    if (raw === '$filename' || raw === '$selected_filename') {
        const i = path.lastIndexOf('/');
        return i >= 0 ? path.slice(i + 1) : path;
    }
    return raw;
}
