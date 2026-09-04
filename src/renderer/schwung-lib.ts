/* schwung-lib.ts — the ONE door to Schwung's param_pages, opened at load and
 * allowed to stay shut.
 *
 * WHY THIS EXISTS AT ALL. The five schwung-*.ts modules used to import the
 * library by its absolute device path at the top of the file, which esbuild
 * keeps as an EXTERNAL import whatever the importing code does. That is a
 * LOAD-TIME dependency: on a Schwung too old to serve those files, movy does
 * not start — not "the grid is unavailable", the whole tool fails to load with
 * no message anywhere, because shadow_ui's stderr is /dev/null. The build
 * worked around it by swapping the five modules for `.off` stand-ins whenever
 * the grid was compiled out, which is why the switch had to be a build-time
 * define and could not be a setting.
 *
 * A RUNTIME SWITCH CANNOT DO THAT. Both renderers have to be present in one
 * build for a flag to choose between them, so the import has to survive being
 * unsatisfiable. `import()` inside try/catch does; a static import does not.
 *
 * TOP-LEVEL AWAIT IS SAFE HERE, and this is the one place it is worth spending.
 * `shadow_load_ui_module` evaluates ui.js through `eval_buf`, which calls
 * `js_std_await` on the module's result — so the load blocks until these
 * settle, and every global movy assigns afterwards (tick, onMidiMessage*) is in
 * place before the host is told the load succeeded. Verified on device with a
 * probe ui.js that awaited this exact import and reported its own outcome.
 *
 * It is NOT safe anywhere else in movy: nothing pumps the job queue during a
 * tick, so a promise created inside one never settles. This module is the
 * exception because it runs during evaluation, not during a tick.
 */

/** Everything movy uses from param_pages, in one place so the failure is one
 *  failure. Typed loosely on purpose: these are `.mjs` with no declarations,
 *  and inventing types here would be a second, drifting copy of Schwung's. */
export interface SchwungLib {
    createController: any;
    LAYOUT_MOVY: any;
    applyInput: any;
    renderPageMovy: any;
    BAND_H: any;
    drawEnumList: any;
    registerWidget: any;
    clearWidgets: any;
    isWidgetAvailable: any;
    padLayoutOf: any;
    focusParamOf: any;
    voicesOf: any;
    voiceIndexFromNote: any;
}

/* LITERAL PATHS, NOT A CONCATENATION. esbuild can only apply its resolver to a
 * specifier it can read at build time: with `BASE + 'page_controller.mjs'` the
 * browser build's alias plugin never fires, Node is handed the raw device path
 * at runtime, and the library is unavailable in EVERY local test — which turns
 * the whole Schwung half of the suite green by never running it. Literals keep
 * the device build's `external` match working too. */

let lib: SchwungLib | null = null;
let failure = '';

try {
    /* Loaded together rather than lazily: a page that half-exists is worse than
     * one that does not, and the modules import each other anyway — asking for
     * `voices.mjs` already pulls `page_plan.mjs` and `child_key.mjs` in. One
     * catch for the whole set means one answer to "is the grid available".
     *
     * The MISSING-EXPORT case is why this is a real risk and not a formality:
     * a Schwung whose files are present but older fails here with
     * "Could not find export 'navLabelsOf' in module page_plan.mjs" — a link
     * error at evaluation, indistinguishable from a missing file to everything
     * above this line, and correctly treated the same way.
     */
    const [pc, pi, rpm, el, wr, vo] = await Promise.all([
        // @ts-ignore — absolute device path; external in the device build
        import('/data/UserData/schwung/shared/param_pages/page_controller.mjs'),
        // @ts-ignore
        import('/data/UserData/schwung/shared/param_pages/page_input.mjs'),
        // @ts-ignore
        import('/data/UserData/schwung/shared/param_pages/render_page_movy.mjs'),
        // @ts-ignore
        import('/data/UserData/schwung/shared/param_pages/enum_list.mjs'),
        // @ts-ignore
        import('/data/UserData/schwung/shared/param_pages/widget_registry.mjs'),
        // @ts-ignore
        import('/data/UserData/schwung/shared/param_pages/voices.mjs'),
    ]);
    lib = {
        createController: pc.createController, LAYOUT_MOVY: pc.LAYOUT_MOVY,
        applyInput: pi.applyInput,
        renderPageMovy: rpm.renderPageMovy, BAND_H: rpm.BAND_H,
        drawEnumList: el.drawEnumList,
        registerWidget: wr.registerWidget, clearWidgets: wr.clearWidgets,
        isWidgetAvailable: wr.isWidgetAvailable,
        padLayoutOf: vo.padLayoutOf, focusParamOf: vo.focusParamOf,
        voicesOf: vo.voicesOf, voiceIndexFromNote: vo.voiceIndexFromNote,
    };
} catch (e: any) {
    /* Swallowed DELIBERATELY, and this is the whole point of the file: an
     * unavailable library must cost movy nothing but the Schwung renderer. The
     * reason is kept so the Settings row can say why the switch is stuck on
     * MOVY, rather than looking broken. */
    failure = String((e && (e.message || e)) || 'unknown');
}

/** True when Schwung's renderer can be selected at all. */
export function schwungLibAvailable(): boolean { return lib !== null; }

/** Why it cannot, for the Settings hint. Empty when it can. */
export function schwungLibError(): string { return failure; }

/**
 * The library, or a throw.
 *
 * Callers reach it through this rather than holding a reference, so there is no
 * way to capture a null at import time and discover it a frame later. Every
 * caller is already behind `schwungGridMode()`, which is pinned to 'off' while
 * this is unavailable — so a throw here means the mode gate was bypassed, which
 * is a bug worth the exception rather than a blank screen.
 */
export function schwungLib(): SchwungLib {
    if (!lib) throw new Error('schwung param_pages unavailable: ' + failure);
    return lib;
}
