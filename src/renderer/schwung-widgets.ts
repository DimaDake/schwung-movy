/* schwung-widgets.ts — module-supplied widgets, registered by movy.
 *
 * A module can ship a `canvas.js` beside its module.json that draws its own
 * cell (Schwung #405). The library handles everything EXCEPT the registration:
 * `viz.mjs` claims a cell for a `custom:` kind only once `registerWidget` has
 * been told how to draw it, and the controller's own `vizGroups()` then carries
 * it into the render movy already asks for. So movy needs this one step and
 * gets the rest for free.
 *
 * NOT REGISTERING IS SAFE. An unclaimed custom kind leaves its keys in the
 * detector pool and a built-in widget draws instead — the registry's single
 * fall-through path, which also covers author typos, a canvas.js that failed to
 * load, and an older host reading a newer module. A missing widget is a
 * different picture, never a hole.
 *
 * THE LOADER RUNS THE SCRIPT IN MOVY'S OWN GLOBALS. `shadow_load_ui_module` is
 * how movy itself was loaded, so a canvas.js that assigns `init` or `tick` —
 * by accident or because it was copied from a UI module — would REPLACE MOVY'S.
 * The device would keep running a tool whose tick belonged to someone else,
 * with no error. Every global the script could plausibly claim is therefore
 * saved and restored around the call, restore included on the throwing path.
 */
// @ts-ignore — absolute device path; external in the device build, aliased locally
import { registerWidget, clearWidgets, isWidgetAvailable } from '/data/UserData/schwung/shared/param_pages/widget_registry.mjs';

/*
 * RE-EXPORTED BECAUSE THE REGISTRY IS PER MODULE INSTANCE.
 *
 * `registered` is module state. A caller that imports widget_registry.mjs by a
 * DIFFERENT specifier — from a schwung checkout directly, rather than through
 * the device path this file uses — gets a second instance with its own empty
 * map, registers into it, and sees nothing drawn. It cost an afternoon once:
 * the widget was registered, `isWidgetAvailable` said yes, and `vizGroups()`
 * still came back empty, because the controller was asking the other copy.
 *
 * So movy's binding is the one door. Anything registering a widget for movy —
 * including its tests — goes through here.
 */
export { registerWidget, clearWidgets, isWidgetAvailable };

declare const shadow_load_ui_module: ((path: string) => boolean) | undefined;

/* Where a module's files live, in the order schwung's own resolver tries. */
const MODULES_ROOT = '/data/UserData/schwung/modules';
const SEARCH_DIRS = ['', 'sound_generators/', 'audio_fx/', 'midi_fx/',
                     'utilities/', 'tools/', 'other/'];

/** Does this contract declare a widget at all? Nothing is loaded if not. */
export function declaresCustomWidget(chainParams: any[]): boolean {
    if (!Array.isArray(chainParams)) return false;
    return chainParams.some((p) => {
        const k = p && p.viz && p.viz.kind;
        return typeof k === 'string' && k.startsWith('custom:');
    });
}

/* The globals a canvas.js could claim, deliberately including movy's own
 * entry points — those are the ones whose loss would be silent and fatal. */
const GUARDED = ['init', 'tick', 'onMidiMessageInternal', 'onMidiMessageExternal',
                 'canvas_overlay', 'canvas_overlays'];

/**
 * Evaluate a canvas.js and hand back its overlay, with movy's globals intact
 * whatever the script did. Returns null when there is nothing usable.
 */
export function loadOverlay(path: string): any {
    if (typeof shadow_load_ui_module !== 'function') return null;
    const saved: Record<string, any> = {};
    const had: Record<string, boolean> = {};
    for (const k of GUARDED) {
        had[k] = Object.prototype.hasOwnProperty.call(globalThis, k);
        saved[k] = (globalThis as any)[k];
    }
    let overlay: any = null;
    try {
        if (shadow_load_ui_module(path)) overlay = (globalThis as any).canvas_overlay || null;
    } catch (_e) {
        overlay = null;
    } finally {
        for (const k of GUARDED) {
            if (had[k]) (globalThis as any)[k] = saved[k];
            else delete (globalThis as any)[k];
        }
    }
    return overlay;
}

/**
 * Register whatever widget `moduleId` supplies. Safe to call repeatedly: the
 * registry keys on the kind, and re-registering the same implementation is what
 * a module reload should do.
 */
export function registerModuleWidgets(moduleId: string, chainParams: any[]): boolean {
    if (!moduleId || !declaresCustomWidget(chainParams)) return false;
    for (const sub of SEARCH_DIRS) {
        const ov = loadOverlay(`${MODULES_ROOT}/${sub}${moduleId}/canvas.js`);
        if (ov && typeof ov.drawCell === 'function' && typeof ov.widgetKind === 'string') {
            registerWidget(ov.widgetKind, {
                draw: ov.drawCell.bind(ov),
                nominal: ov.widgetNominal || null,
            });
            return true;
        }
    }
    return false;
}
