/* schwung-editor.ts — the screen a divable parameter opens.
 *
 * Schwung's controller answers a click on a held divable param with
 * `{action:"open", key, options, index}` and then stops, deliberately: "The
 * controller never opens it itself — that screen belongs to the host." movy had
 * no such screen, so Plaits' 24-option `engine` could only be crossed one
 * detent at a time, with no list.
 *
 * THE SCREEN IS MOVY'S, THE LIST IS SCHWUNG'S. `drawEnumList` is the same
 * widget every other picker on the device uses; a second one is how Master FX
 * and the chain editor drifted apart upstream. movy owns only the view state —
 * which intent is open, where the cursor is — and the routing.
 *
 * THE COMMIT GOES THROUGH `commitEnum`, NOT THE PORT. Some modules store an
 * enum as its INDEX and others as its NAME. The controller already knows which,
 * and writing the index straight to the port would silently set the wrong value
 * on every name-valued enum. commitEnum also carries the write throttle, the
 * announce, and the condition re-plan that a changed enum can trigger.
 */
import type { SchwungIntent, SchwungPage } from './schwung-page.js';
import { fontPrint, fontWidth } from '../font/index.js';

// @ts-ignore — absolute device path; external in the device build, aliased locally
import { drawEnumList } from '/data/UserData/schwung/shared/param_pages/enum_list.mjs';

interface EditorState {
    intent: SchwungIntent;
    page: SchwungPage;
    options: string[];
    /** Where the cursor is. */
    index: number;
    /** The value that was live when we opened — what Back returns you to, and
     *  what wears the `*` so moving off it reads as having moved. */
    mark: number;
}

let state: EditorState | null = null;

export function schwungEditorActive(): boolean { return state !== null; }
export function schwungEditorIndex(): number { return state ? state.index : -1; }
export function closeSchwungEditor(): void { state = null; }

/**
 * Open the editor for an intent. Returns false — and opens nothing — when the
 * intent cannot be presented as a list, so the caller can fall back rather than
 * put up an empty screen.
 *
 * A filepath or canvas divable has no `options`; those want movy's file browser
 * or an editor that does not exist yet, and an empty list is worse than
 * declining, because it looks like the feature is broken rather than absent.
 */
export function openSchwungEditor(intent: SchwungIntent | null, page: SchwungPage): boolean {
    if (!intent || intent.action !== 'open') return false;
    const options = intent.options;
    if (!Array.isArray(options) || options.length < 2) return false;
    const at = typeof intent.index === 'number' ? intent.index : 0;
    const i = Math.max(0, Math.min(options.length - 1, at));
    state = { intent, page, options, index: i, mark: i };
    return true;
}

/** Move the cursor. Clamped, not wrapped — the same as every other list here. */
export function schwungEditorJog(dir: number): void {
    if (!state) return;
    const n = state.options.length;
    state.index = Math.max(0, Math.min(n - 1, state.index + (dir > 0 ? 1 : -1)));
}

/** Take the option under the cursor and close. */
export function schwungEditorCommit(): void {
    if (!state) return;
    const { page, intent, index } = state;
    state = null;
    page.ctl.commitEnum(intent.key, index);
}

/** Leave without writing. */
export function schwungEditorCancel(): void { state = null; }

export function renderSchwungEditor(): void {
    if (!state) return;
    const ctx = {
        fillRect: (x: number, y: number, w: number, h: number, c: any) =>
            fill_rect(x, y, w, h, c ? 1 : 0),
        print: (x: number, y: number, t: string, c: any) => fontPrint(x, y, t, c ? 1 : 0),
        textWidth: (t: string) => fontWidth(t),
    };
    drawEnumList(ctx, {
        title: state.intent.meta?.label || state.intent.meta?.name || state.intent.key || '',
        /* "SELECT", not "TURNING": here a choice is pending and a click takes
         * it. The peek says TURNING because its value is already set. */
        headerRight: 'SELECT',
        options: state.options,
        index: state.index,
        markIndex: state.mark,
        footer: [['BACK', 'CANCEL'], ['CLICK', 'SET']],
    });
}
