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
    /* "How full is this control, or unknown" — the reading a knob ARC, a
     * modulation dot and an indicator LED all take, and deliberately not
     * `fractionOf`, which measures an enum against min/max for the viz shapes.
     * Taken from Schwung rather than re-derived so the ring, the arc and the
     * dot cannot disagree about the same cell. Guaranteed present wherever this
     * library loads: `page_controller.mjs` imports it BY NAME, so a
     * render_page_movy without it fails the link and takes the whole set down
     * before anything reads this. */
    normalizedOf: any;
    /* movy's chrome composes the two bands Schwung is not asked to draw, and
     * the footer is drawn with Schwung's own widget so there is one definition
     * of a hint pill. `flipsOnClick` is what decides whether a click on a
     * two-option enum flips it (no intent comes back at all) or opens its list,
     * and the page kinds say which verbs a door's footer owes — the same
     * questions the controller's own onClick and shadow footer answer, taken
     * from the same source rather than restated. */
    drawFooter: any;
    flipsOnClick: any;
    PAGE_KNOBS: any;
    PAGE_PRESET: any;
    PAGE_ITEMS: any;
    PAGE_MENU: any;
    drawEnumList: any;
    registerWidget: any;
    clearWidgets: any;
    isWidgetAvailable: any;
    padLayoutOf: any;
    focusParamOf: any;
    voicesOf: any;
    voiceIndexFromNote: any;
    /* OPTIONAL, and typed so. A Schwung predating the live-press contract
     * serves voices.mjs and child_key.mjs without these, and the whole point of
     * this file is that such a Schwung costs movy nothing but the feature.
     * Reached by property access on the namespace object and guarded at the
     * call site, so a missing export answers `undefined` rather than raising
     * the link error that would take the library — and with it the renderer —
     * down. */
    focusPressParamOf?: any;
    childPressParam?:   any;
    /* SP-38, and optional for exactly the same reason as the pair above: an
     * older Schwung that serves a param_pages without these costs movy the
     * frames it asks for and nothing else — the call site guards.
     *
     * `settled` is the library's OWN "is anything on the drawn page still
     * moving" (anim_state.mjs) rather than movy re-deriving the animation
     * window from the durations, and `buttonPhase` is the one definition of how
     * long a trigger bang draws for. Both are asked rather than restated for
     * the same purpose: a second copy of `ENUM_ANIM_MS` or `BTN_FLASH_MS` here
     * would drift from the renderer that actually draws. */
    settled?:     any;
    buttonPhase?: any;
    /* Optional for the same reason, and asked for the same reason `settled` is:
     * it is the library's OWN bare-key-to-concrete-key mapping, which the
     * controller applies to every key before it asks the port. A second copy
     * here would be a second answer to "which key is `start` on pad 4". A page
     * that is child-level lists aliases, so a warm that prefixes the alias
     * covers keys no read will look up — see `jump` in schwung-page-input.ts. */
    resolveChildKey?: any;
    /* Same pairing, WRITE side (SP-50): adds `child_index_base`, which a raw
     * `String(index)` skips. */
    childIndexToWire?: any;
    /* SP-42, optional for the same reason as the pair above: a sample cell's
     * envelope job is advanced from schwung-page-sample.ts, which no-ops
     * without these rather than throwing — an older Schwung costs movy only
     * the waveform graphic, not the whole grid. `VIZ_SAMPLE` is the group-kind
     * tag `vizGroups()` entries carry; `wavPeaksTick`/`wavPeaksDone` drive and
     * query the resumable peak-build job in wav_peaks.mjs. */
    VIZ_SAMPLE?:   any;
    wavPeaksTick?: any;
    wavPeaksDone?: any;
    /* Read-only, and reachable no other way: this is the ONE door to
     * param_pages, so a test proving the envelope job actually filled in
     * (rather than just finishing) has to ask through here, same as movy's
     * own renderer would if it ever needed the raw array. Nothing in src/
     * calls it — drawSample reads it inside Schwung's own render path. */
    wavPeaks?: any;
    /* SP-44: a knob turned on a preset door has no route to the list at all
     * (`onKnobTurn` bails at `keyAt`, which returns null for a page with no
     * knobs) — `schwung-page-input.ts` reuses `ctl.onJog`'s existing preset
     * step instead, but ITS feel is the jog's (one entry per call), and
     * calibrating that for a knob is the one thing *The injection surface*
     * §4 says movy must not restate: DETENTS_PER_ENTRY and the
     * length-aware acceleration ceiling are `export const`, tuned against the
     * real fleet (Braids' 47 models, `clap`'s 519). Importing the module
     * itself avoids restating them — the feel comes from the same file
     * Schwung's own shadow_ui uses for its filepath browser knob, not a
     * second copy. */
    listKnobInit?: any;
    listKnobStep?: any;
    /* SP-59, optional for the same reason as everything above it: its PRESENCE
     * is the answer to "does this library take `io.isAutomated`". An older
     * Schwung has neither, so movy keeps folding lanes into `isModulated` there
     * (the tilde) rather than handing a hook nothing reads — which would take
     * the lane's pointer/base motion away with it. */
    drawAutomatedMark?: any;
    /* The frame a module-drawn canvas PAGE paints into, so (0,0) is the band's
     * corner and nothing the module draws reaches movy's header or bank bar.
     * Schwung's own host scopes a page with this same function; a second
     * clipper here would be a second answer to where a page may draw. */
    frameCtx?: any;
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
    const [pc, pi, rpm, el, wr, vo, ck, pm, pp, anm, _wio, wp, vz, lk, fc] = await Promise.all([
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
        /* Safe to add to the set: page_controller.mjs, already here, imports
         * child_key.mjs, param_meta.mjs AND page_plan.mjs — so all three exist
         * wherever the library does, and none of them can be the module that
         * makes an otherwise-serviceable Schwung fail. */
        // @ts-ignore
        import('/data/UserData/schwung/shared/param_pages/child_key.mjs'),
        // @ts-ignore
        import('/data/UserData/schwung/shared/param_pages/param_meta.mjs'),
        // @ts-ignore
        import('/data/UserData/schwung/shared/param_pages/page_plan.mjs'),
        /* anim_state.mjs — safe to add for the same reason as the three above:
         * `viz_draw.mjs` and `render_page_movy.mjs` both import it BY NAME, so
         * wherever the library loads at all this file is already being loaded
         * alongside it and cannot be the one that makes an otherwise
         * serviceable Schwung fail. */
        // @ts-ignore
        import('/data/UserData/schwung/shared/param_pages/anim_state.mjs'),
        /* wav_io_qjs.mjs — side-effect only: it calls setWavPeaksIO() on
         * wav_peaks.mjs at the top level, registering the real file reader.
         * Without this import `IO` inside wav_peaks.mjs stays null forever
         * and every sample cell caches "unreadable wav" (SP-42, defect A).
         * Nothing here reads its namespace object — the import itself is the
         * whole point — so the binding is prefixed `_` and unused. Already
         * paid for: render_page_movy.mjs (imported above) already pulls in
         * wav_peaks.mjs and viz.mjs transitively via viz_draw.mjs, so asking
         * for them here by name adds no new parse work, only wav_io_qjs.mjs
         * itself (~35 lines, two host-native imports) is new. */
        // @ts-ignore
        import('/data/UserData/schwung/shared/param_pages/wav_io_qjs.mjs'),
        // @ts-ignore
        import('/data/UserData/schwung/shared/param_pages/wav_peaks.mjs'),
        // @ts-ignore
        import('/data/UserData/schwung/shared/param_pages/viz.mjs'),
        /* list_knob.mjs — SP-44. Pure and tiny (no imports of its own), so
         * adding it costs nothing an otherwise-serviceable Schwung would not
         * already pay, same reasoning as anim_state.mjs above. */
        // @ts-ignore
        import('/data/UserData/schwung/shared/param_pages/list_knob.mjs'),
        /* frame_ctx.mjs — widget_registry.mjs (above) imports it by name, so it
         * is already loaded wherever the library is. */
        // @ts-ignore
        import('/data/UserData/schwung/shared/param_pages/frame_ctx.mjs'),
    ]);
    lib = {
        createController: pc.createController, LAYOUT_MOVY: pc.LAYOUT_MOVY,
        applyInput: pi.applyInput,
        renderPageMovy: rpm.renderPageMovy, BAND_H: rpm.BAND_H,
        normalizedOf: rpm.normalizedOf,
        drawFooter: rpm.drawFooter, flipsOnClick: pm.flipsOnClick,
        PAGE_KNOBS: pp.PAGE_KNOBS, PAGE_PRESET: pp.PAGE_PRESET,
        PAGE_ITEMS: pp.PAGE_ITEMS, PAGE_MENU: pp.PAGE_MENU,
        drawEnumList: el.drawEnumList,
        registerWidget: wr.registerWidget, clearWidgets: wr.clearWidgets,
        isWidgetAvailable: wr.isWidgetAvailable,
        padLayoutOf: vo.padLayoutOf, focusParamOf: vo.focusParamOf,
        voicesOf: vo.voicesOf, voiceIndexFromNote: vo.voiceIndexFromNote,
        focusPressParamOf: vo.focusPressParamOf, childPressParam: ck.childPressParam,
        settled: anm.settled, buttonPhase: rpm.buttonPhase,
        resolveChildKey: ck.resolveChildKey, childIndexToWire: ck.childIndexToWire,
        VIZ_SAMPLE: vz.VIZ_SAMPLE,
        wavPeaksTick: wp.wavPeaksTick, wavPeaksDone: wp.wavPeaksDone,
        wavPeaks: wp.wavPeaks,
        listKnobInit: lk.listKnobInit, listKnobStep: lk.listKnobStep,
        drawAutomatedMark: rpm.drawAutomatedMark,
        frameCtx: fc.frameCtx,
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
