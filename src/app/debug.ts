/* Whether this bundle exposes the debug-only surfaces (the Global Params flags
 * page).
 *
 * A build-time constant substituted by esbuild, so every `DEBUG_BUILD &&` is a
 * literal `false` in a release build and the gated paths can never run. The
 * device bundle is NOT minified, so the code behind them is still *present* —
 * this hides the page, it does not strip it. That is the honest claim, and
 * scripts/build-module.sh asserts exactly it rather than absence.
 *
 * Gate the GESTURE, not just the render. A gate that only stopped the drawing
 * would leave a view a release build could still switch to, and the symptom is a
 * blank screen with no way back that only appears in the shipped module.
 *
 * The `typeof` guard fails SAFE: a build path that forgot the define gets
 * `false` — the page vanishes in dev, which is noticed immediately — rather
 * than `true`, which would ship it. */
export const DEBUG_BUILD: boolean =
    typeof __MOVY_DEBUG__ !== 'undefined' ? __MOVY_DEBUG__ : false;
