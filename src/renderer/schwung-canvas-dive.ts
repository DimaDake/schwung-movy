/* schwung-canvas-dive.ts — the fullscreen screen a `type: "canvas"` knob opens.
 *
 * Schwung's controller answers a click on a held canvas cell with an `open`
 * intent and stops: the screen is the host's (shadow_ui.js openCanvasPreview).
 * movy had none, so the intent was logged and dropped — DR32's ENGN knob, the
 * only way to choose a pad's sample or synth engine, did nothing at all.
 *
 * Upstream's contract, so one script serves both hosts (docs/CANVAS_PAGES.md):
 *   - the script draws the whole screen from `draw`, and `tick` runs per frame;
 *     both get a ctx WITHOUT the param accessors or close (DRAW_PATH_HOOKS);
 *   - input arrives at `onMidi` as the bytes the hardware sends (jog CC 14,
 *     click CC 3, knobs CC 71-78, and pad notes when it `wantsPads`);
 *   - `enterable: true` hands the module the click, and Back asks `handleBack`
 *     first: true = "I went up a level", anything else closes;
 *   - Shift+jog always closes and is never offered to the module;
 *   - `ctx.close()` records the wish and the HOST leaves, after the hook;
 *   - a hook that throws retires the overlay for the dive (one strike).
 * Text is movy's font for both `print` and `measureText`, as the canvas-page
 * ctx is, so the module's layout measures what it draws.
 */
import { loadOverlay, moduleFilePath, splitSpec } from './schwung-canvas.js';
import { fontPrint, fontWidth } from '../font/index.js';
import { appState } from '../app/state.js';
import { W } from './layout.js';

const H = 64;
const CC_JOG = 14, CC_CLICK = 3;

/** What a dive needs from the page that opened it. */
export interface CanvasDiveHost {
    moduleId(): string;
    owner: string;
    /** Live reads and writes, unqualified keys — the script's own dialect. */
    read(key: string): string | null;
    write(key: string, value: string): void;
    /** The dive closed; the module may now declare different pages. */
    closed(): void;
}

interface Dive {
    key: string; meta: any; host: CanvasDiveHost;
    ov: any; dead: boolean; closeWanted: boolean; error: string;
    ctx: any; drawCtx: any;
}

let dive: Dive | null = null;
/* Per (owner, script), as upstream keeps a canvas's state on its runtime: a
 * browser reopened on the same track remembers where it was. */
const states = new Map<string, Record<string, any>>();

/* Upstream's resolveCanvasScriptPath, field for field. */
function scriptSpec(meta: any): { file: string; ref: string } {
    const cs = meta && meta.canvas_script;
    let file = 'canvas.js', ref = '';
    if (typeof cs === 'string') file = cs.trim() || 'canvas.js';
    else if (cs && typeof cs === 'object') {
        file = String(cs.script || cs.file || cs.path || 'canvas.js');
        ref = String(cs.overlay || cs.target || cs.entry || cs.element || '').trim();
    }
    const over = [meta?.canvas_overlay, meta?.overlay, meta?.canvas_target]
        .find((v) => typeof v === 'string' && v.trim());
    if (over) ref = over.trim();
    const parsed = splitSpec(file);
    return { file: parsed.file || 'canvas.js', ref: ref || parsed.ref };
}

function setPx(x: number, y: number, c: any) { fill_rect(Math.round(x), Math.round(y), 1, 1, c ? 1 : 0); }

function makeCtx(d: Dive, state: Record<string, any>): any {
    const ctx: any = {
        width: W, height: H, state,
        clear: () => fill_rect(0, 0, W, H, 0),
        setPixel: setPx,
        fillRect: (x: number, y: number, w: number, h: number, c: any) =>
            fill_rect(Math.round(x), Math.round(y), Math.round(w), Math.round(h), c ? 1 : 0),
        drawRect(x: number, y: number, w: number, h: number, c: any) {
            ctx.fillRect(x, y, w, 1, c); ctx.fillRect(x, y + h - 1, w, 1, c);
            ctx.fillRect(x, y, 1, h, c); ctx.fillRect(x + w - 1, y, 1, h, c);
        },
        drawLine(x1: number, y1: number, x2: number, y2: number, c: any) {
            const n = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1), 1);
            for (let i = 0; i <= n; i++) setPx(x1 + (x2 - x1) * i / n, y1 + (y2 - y1) * i / n, c);
        },
        print: (x: number, y: number, t: any, c: any = 1) => fontPrint(Math.round(x), Math.round(y), String(t), c ? 1 : 0),
        measureText: (t: any) => fontWidth(String(t == null ? '' : t)),
        now: () => Date.now(),
        random: () => Math.random(),
        shiftHeld: () => appState.shiftHeld,
        sourcePath: () => '',
    };
    d.drawCtx = { ...ctx };
    ctx.getParam = (k: string) => d.host.read(String(k));
    ctx.setParam = (k: string, v: any) => { d.host.write(String(k), String(v)); return true; };
    ctx.getValue = () => d.host.read(d.key) || '';
    ctx.setValue = (v: any) => { d.host.write(d.key, String(v)); return true; };
    ctx.close = () => { d.closeWanted = true; return true; };
    return ctx;
}

const ABSENT = {};
function hook(name: string, payload: any = {}): any {
    const d = dive;
    if (!d || d.dead || !d.ov || typeof d.ov[name] !== 'function') return ABSENT;
    try {
        return d.ov[name](name === 'draw' || name === 'tick' ? d.drawCtx : d.ctx, payload);
    } catch (e) {
        d.dead = true; d.error = `${name} error: ${e}`;
        return ABSENT;
    }
}

/* After any hook that may have called ctx.close(). */
function settle(): void { if (dive && dive.closeWanted) closeCanvasDive(false); }

export function canvasDiveActive(): boolean { return dive !== null; }

/** Open the dive for a canvas intent. False when the intent is not a canvas. */
export function openCanvasDive(key: string, meta: any, host: CanvasDiveHost): boolean {
    if (!meta || meta.type !== 'canvas') return false;
    const spec = scriptSpec(meta);
    const path = moduleFilePath(host.moduleId(), spec.file);
    const sk = `${host.owner}|${path}|${spec.ref}`;
    if (!states.has(sk)) states.set(sk, {});
    const d: Dive = { key, meta, host, ov: null, dead: false, closeWanted: false,
                      error: '', ctx: null, drawCtx: null };
    d.ov = path ? loadOverlay(path, spec.ref) : null;
    if (!d.ov) d.error = path ? 'No module canvas overlay' : 'No canvas script found';
    d.ctx = makeCtx(d, states.get(sk)!);
    dive = d;
    hook('onOpen', { param_key: key, module_id: host.moduleId(), script_path: path || '' });
    settle();
    return true;
}

export function closeCanvasDive(cancelled: boolean): void {
    const d = dive;
    if (!d) return;
    hook('onClose', { cancelled }); hook('onExit', { cancelled });
    dive = null;
    d.host.closed();
}

const enterable = () => !!(dive && dive.meta && dive.meta.enterable);

/** Any MIDI the dive should hear. True when it took the event. */
export function canvasDiveMidi(data: number[]): boolean {
    if (!dive) return false;
    hook('onMidi', { source: 'internal', data: data.slice() });
    settle();
    return true;
}

export function canvasDiveJog(delta: number): void {
    if (!dive) return;
    if (appState.shiftHeld) { closeCanvasDive(true); return; }
    canvasDiveMidi([0xB0, CC_JOG, delta > 0 ? Math.min(delta, 63) : 128 + Math.max(delta, -63)]);
}

export function canvasDiveClick(): void {
    if (!dive) return;
    if (!enterable()) { closeCanvasDive(false); return; }
    canvasDiveMidi([0xB0, CC_CLICK, 127]);
}

export function canvasDiveBack(): void {
    if (!dive) return;
    if (enterable() && hook('handleBack') === true) { settle(); return; }
    closeCanvasDive(true);
}

/** A pad press, passively: the pad still plays, the script is told as well. */
export function canvasDivePad(note: number, velocity: number): void {
    if (dive && dive.ov && dive.ov.wantsPads) canvasDiveMidi([0x90, note, velocity]);
}

export function tickCanvasDive(): void { if (dive) { hook('tick'); settle(); } }

export function renderCanvasDive(): void {
    const d = dive;
    if (!d) return;
    fill_rect(0, 0, W, H, 0);
    if (hook('draw') !== ABSENT) return;
    const title = String((d.meta && (d.meta.label || d.meta.name)) || 'Canvas');
    fontPrint(Math.max(0, (W - fontWidth(title)) >> 1), 10, title, 1);
    fontPrint(3, 29, d.error.slice(0, 30), 1);
    fontPrint(3, 52, enterable() ? 'BACK: RETURN' : 'CLICK/BACK: RETURN', 1);
}
