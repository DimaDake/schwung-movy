/* schwung-canvas.ts — the file side of a module-supplied widget.
 *
 * Which script a module ships, and what that script published. Separated from
 * schwung-widgets.ts because that file is the DOOR to Schwung's registry while
 * this one must stay drivable without it: nothing here imports param_pages, so
 * a suite with no Schwung checkout can point `host_read_file` and
 * `shadow_load_ui_module` at a fixture and assert the real resolution.
 *
 * NOTHING HERE THROWS. A module that is not where we looked, a module.json that
 * does not parse, a script that fails to load, a name that resolves in no
 * directory at all — each is null, which the caller reads as "no widget" and
 * the registry answers with a built-in. That fall-through is the point of the
 * whole path, so a miss must never be an exception.
 */
declare const shadow_load_ui_module: ((path: string) => boolean) | undefined;

/* Where a module's files live, in the order schwung's own resolver tries. */
const MODULES_ROOT = '/data/UserData/schwung/modules';
const SEARCH_DIRS = ['', 'sound_generators/', 'audio_fx/', 'midi_fx/',
                     'utilities/', 'tools/', 'other/'];
const DEFAULT_CANVAS = 'canvas.js';

/* The globals a canvas.js could claim, deliberately including movy's own
 * entry points — those are the ones whose loss would be silent and fatal. */
const GUARDED = ['init', 'tick', 'onMidiMessageInternal', 'onMidiMessageExternal',
                 'canvas_overlay', 'canvas_overlays'];

/* GUARDED, because the header promises nothing here throws and the caller that
 * matters has no try of its own: the contract's divider asks on a tick, so an
 * unguarded host read would escape into the host's tick loop. `tryFile` in
 * modules/loader.ts is the same shape for the same reason. A read that throws is
 * a MISS, which is the answer this file already gives for everything else — the
 * registry draws a built-in. */
function readFile(path: string): string | null {
    try { return (typeof host_read_file === 'function') ? host_read_file(path) : null; }
    catch (_e) { return null; }
}

function getPath(root: any, path: string): any {
    let cur = root;
    for (const part of path.split('.')) {
        if (!cur || (typeof cur !== 'object' && typeof cur !== 'function')) return undefined;
        cur = cur[part];
    }
    return cur;
}

/* The overlay a script published: the one the module named if it named one, the
 * conventional global otherwise. A candidate that is a FUNCTION is called, as
 * upstream's resolver does — a factory is how a script keeps its own state out
 * of the global. */
function overlayFor(ref: string): any {
    const cands: any[] = [];
    if (ref) {
        cands.push(getPath(globalThis, ref));
        cands.push((globalThis as any)[ref]);
        cands.push(getPath((globalThis as any).canvas_overlays, ref));
    }
    cands.push((globalThis as any).canvas_overlay);
    for (let c of cands) {
        if (typeof c === 'function') { try { c = c(); } catch (_e) { c = null; } }
        if (c && typeof c === 'object') return c;
    }
    return null;
}

/**
 * Evaluate a canvas.js and hand back its overlay, with MOVY'S GLOBALS INTACT
 * whatever the script did.
 *
 * `shadow_load_ui_module` is how movy itself was loaded, so a canvas.js that
 * assigns `init` or `tick` — by accident, or because it was copied from a UI
 * module — would REPLACE MOVY'S, and the device would go on running a tool
 * whose tick belonged to somebody else, silently. Hence the save/restore, the
 * throwing path included.
 *
 * `ref` is the `#fragment` a module may name: a script can publish several
 * overlays and say which one it wants drawn (pushnpull does).
 */
export function loadOverlay(path: string, ref?: string): any {
    return guardedEval(path, [], () => overlayFor((ref || '').trim()));
}

/** A named function a script publishes — a param CARD's drawer (`cards.js#fn`).
 *  The export name is guarded along with movy's own, so reading it cannot leave
 *  a stray global behind. */
export function loadExport(path: string, name: string): any {
    return guardedEval(path, [name], () => {
        const fn = (globalThis as any)[name];
        return typeof fn === 'function' ? fn : null;
    });
}

function guardedEval(path: string, extra: string[], pick: () => any): any {
    if (typeof shadow_load_ui_module !== 'function') return null;
    const names = GUARDED.concat(extra);
    const saved: Record<string, any> = {};
    const had: Record<string, boolean> = {};
    for (const k of names) {
        had[k] = Object.prototype.hasOwnProperty.call(globalThis, k);
        saved[k] = (globalThis as any)[k];
    }
    let out: any = null;
    try {
        if (shadow_load_ui_module(path)) out = pick();
    } catch (_e) {
        out = null;
    } finally {
        for (const k of names) {
            if (had[k]) (globalThis as any)[k] = saved[k];
            else delete (globalThis as any)[k];
        }
    }
    return out;
}

/** `file.js#overlay` — the canvas param's own spelling. The fragment names the
 *  global holding the overlay, not a property of the file; an empty script part
 *  falls back to the default, as upstream's parser does. */
function splitSpec(value: string): { file: string; ref: string } {
    const raw = value.trim();
    const hash = raw.indexOf('#');
    if (hash < 0) return { file: raw, ref: '' };
    return { file: raw.slice(0, hash).trim() || DEFAULT_CANVAS,
             ref: raw.slice(hash + 1).trim() };
}

/* The script a module says it ships. The field is a capability and every module
 * on the box spells it there; a module that put it at the top level is not
 * wrong to, and honouring both costs one `||`. */
function scriptOf(meta: any): string {
    const raw = (meta && meta.capabilities && meta.capabilities.canvas_script)
             ?? (meta && meta.canvas_script);
    return (typeof raw === 'string' && raw.trim()) ? raw.trim() : DEFAULT_CANVAS;
}

/**
 * The overlay a module ships, or null.
 *
 * THE NAME IS THE MODULE'S, THE DIRECTORY IS A SEARCH. movy used to load a
 * literal `canvas.js`, so a module that named another file — or that named one
 * at all — was loaded only by luck. `module.json` says which file it is, and it
 * is resolved against the first directory that has one: that is schwung's own
 * rule, and the only directory its host would call the module's.
 *
 * A MODULE THAT IS NOWHERE, OR WHOSE SCRIPT DOES NOT LOAD, IS A MISS AND NOT AN
 * ERROR — and it is also the answer that keeps the caller asking, because a
 * module still being installed looks exactly like this.
 */
export function findOverlay(moduleId: string): any {
    const m = moduleDir(moduleId);
    if (!m) return null;
    const spec = splitSpec(scriptOf(m.meta));
    return loadOverlay(joinPath(m.dir, spec.file), spec.ref);
}

/** A file a module names, resolved against the module's own directory — the
 *  `canvas_script` of a canvas PAGE, a card's script. Null when the module is
 *  nowhere, which the caller reads as "not yet", never as an error. */
export function moduleFilePath(moduleId: string, file: string): string | null {
    if (file.startsWith('/')) return file;
    const m = moduleDir(moduleId);
    return m ? joinPath(m.dir, file) : null;
}

/* An absolute script path is the module's own business; upstream honours one,
 * and it is resolved against nothing. */
function joinPath(dir: string, file: string): string {
    return file.startsWith('/') ? file : `${dir}/${file}`;
}

function moduleDir(moduleId: string): { dir: string; meta: any } | null {
    if (!moduleId) return null;
    for (const sub of SEARCH_DIRS) {
        const dir = `${MODULES_ROOT}/${sub}${moduleId}`;
        const raw = readFile(`${dir}/module.json`);
        if (!raw) continue;              /* not the module's directory — try the next */
        let meta: any = null;
        try { meta = JSON.parse(raw); } catch (_e) { meta = null; }
        return { dir, meta };
    }
    return null;
}
