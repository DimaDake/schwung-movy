/* Whether this bundle exposes the debug-only surfaces — today, the measurement
 * flags on the Settings page (`seq/flags-visible.ts`). The page itself ships in
 * every build; a release one lists only the two flags marked `release`.
 *
 * A build-time constant substituted by esbuild, so every `DEBUG_BUILD &&` is a
 * literal `false` in a release build and the gated paths can never run. The
 * device bundle is NOT minified, so the code behind them is still *present* —
 * this hides the page, it does not strip it. That is the honest claim, and
 * scripts/build-module.sh asserts exactly it rather than absence.
 *
 * Gate the CONTENT, not a view: a gate that hid the page's rows while leaving
 * the gesture that opens it would ship a blank screen with no way back — which
 * is why the page is filtered rather than hidden.
 *
 * The `typeof` guard fails SAFE: a build path that forgot the define gets
 * `false` — the page vanishes in dev, which is noticed immediately — rather
 * than `true`, which would ship it. */
export const DEBUG_BUILD: boolean =
    typeof __MOVY_DEBUG__ !== 'undefined' ? __MOVY_DEBUG__ : false;
