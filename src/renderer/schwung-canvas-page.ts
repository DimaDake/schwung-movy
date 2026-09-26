/* schwung-canvas-page.ts — the host half of a module-drawn PAGE and CARD.
 *
 * A `type: "canvas"` param with `as_page: true` is a page the module paints
 * (monksynth's face). Schwung's planner makes the page and its controller asks
 * for the body through `io.drawCanvasPage`, for an enterable page's gestures
 * through `io.canvasPageHook`, and for a knob's card through `io.loadCard`. All
 * three need the module's directory and the script loader, which the library
 * does not have — so they are the HOST's, and shadow_ui supplies them
 * (`drawCanvasPageBody` / `canvasPageHook` / `loadCardScript`). movy supplied
 * none, so the page planned, paged, and drew an empty band. This is movy's copy
 * of that seam, kept to upstream's contract so one canvas.js serves both hosts.
 *
 * ONE EVALUATION PER SCRIPT, ONE STRIKE PER OVERLAY — upstream's rules. The body
 * is redrawn every frame so it can animate, and evaluating the script from the
 * draw would do that on every frame; a thrower is retired for the session and
 * the page falls back to an empty body under movy's normal chrome.
 */
import { loadOverlay, loadExport, moduleFilePath } from './schwung-canvas.js';
import { schwungLib } from './schwung-lib.js';
import { appState } from '../app/state.js';
import { fontWidth } from '../font/index.js';
import { W } from './layout.js';

const SCREEN_H = 64;

interface Canvas { key?: string; script?: string; overlay?: string }

/* Process-wide, keyed as upstream keys them: code by `path|ref`, state by the
 * page's owner as well, so two tracks running one module keep two cursors. */
const overlays = new Map<string, any>();
const disabled = new Set<string>();
const states = new Map<string, Record<string, any>>();

/* The module id is a blocking read, so a miss is retried a bounded number of
 * times per canvas and then parked: the draw asks every frame. */
const MISS_LIMIT = 3;

export function createCanvasPageIo(moduleId: () => string, owner: string,
                                   read: (k: string) => string | null,
                                   write: (k: string, v: string) => void) {
    /* Keyed by the planner's own canvas object: a re-plan after a module swap
     * builds new ones, which is what makes the next ask resolve afresh. */
    const resolved = new WeakMap<object, { path: string | null; misses: number }>();

    function cacheKey(canvas: Canvas): string | null {
        if (!canvas || !canvas.script) return null;
        let r = resolved.get(canvas);
        if (!r) resolved.set(canvas, r = { path: null, misses: 0 });
        if (r.path === null && r.misses < MISS_LIMIT) {
            r.path = moduleFilePath(moduleId(), canvas.script);
            if (r.path === null) r.misses++;
        }
        return r.path === null ? null : `${r.path}|${canvas.overlay || ''}`;
    }

    function overlay(key: string): any {
        if (disabled.has(key)) return null;
        if (!overlays.has(key)) {
            const bar = key.lastIndexOf('|');
            overlays.set(key, loadOverlay(key.slice(0, bar), key.slice(bar + 1)) || null);
        }
        return overlays.get(key);
    }

    function stateOf(key: string): Record<string, any> {
        const k = `${owner}|${key}`;
        let st = states.get(k);
        if (!st) states.set(k, st = {});
        return st;
    }

    function drawCanvasPage(drawCtx: any, band: any, canvas: Canvas, payload: any): void {
        const key = cacheKey(canvas);
        const ov = key ? overlay(key) : null;
        if (!key || !ov || typeof ov.drawPage !== 'function') return;
        const lib = schwungLib();
        if (typeof lib.frameCtx !== 'function') return;
        const p = payload || {};
        try {
            ov.drawPage(lib.frameCtx(drawCtx, band), {
                key: canvas.key,
                values: p.values || {}, base: p.base || {}, keys: p.keys || [],
                touched: typeof p.touched === 'number' ? p.touched : -1,
                preset: p.preset || null,
                nowMs: typeof p.nowMs === 'number' ? p.nowMs : Date.now(),
                width: band.w, height: band.h,
                state: stateOf(key),
            });
        } catch (_e) {
            disabled.add(key);
        }
    }

    function canvasPageHook(canvas: Canvas, hook: string, payload: any): any {
        const key = cacheKey(canvas);
        const ov = key ? overlay(key) : null;
        if (!key || !ov || typeof ov[hook] !== 'function') return undefined;
        let closed = false;
        /* The non-drawing surface a fullscreen dive's hooks get upstream, so a
         * script calling shiftHeld() or getValue() from onMidi does not throw
         * here — and get itself disabled — on a page. */
        const ctx = {
            width: W, height: SCREEN_H,
            state: stateOf(key),
            getParam: (k: string) => read(String(k)),
            setParam: (k: string, v: any) => { write(String(k), String(v)); return true; },
            getValue: () => (canvas.key ? read(canvas.key) || '' : ''),
            setValue: (v: any) => { if (!canvas.key) return false; write(canvas.key, String(v)); return true; },
            measureText: (t: any) => fontWidth(String(t == null ? '' : t)),
            shiftHeld: () => appState.shiftHeld,
            now: () => Date.now(),
            random: () => Math.random(),
            close: () => { closed = true; return true; },
        };
        try {
            const r = ov[hook](ctx, payload || {});
            /* "I am done" outranks whatever the hook returned — the controller
             * reads `close: true` and leaves the door on the module's behalf. */
            return closed ? { close: true } : r;
        } catch (_e) {
            disabled.add(key);
            return undefined;
        }
    }

    /* The controller caches the answer, null included, and asks from a
     * gesture — never from the draw — so no cache is kept here. */
    function loadCard(scriptPath: string, exportRef: string): any {
        if (!scriptPath || !exportRef) return null;
        const path = moduleFilePath(moduleId(), scriptPath);
        return path ? loadExport(path, exportRef) : null;
    }

    return { drawCanvasPage, canvasPageHook, loadCard };
}
