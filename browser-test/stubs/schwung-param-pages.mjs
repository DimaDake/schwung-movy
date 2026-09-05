/* Stand-in for Schwung's shared param_pages when no schwung checkout is
 * available (SCHWUNG unset).
 *
 * IT THROWS ON IMPORT, not on call, and that is the whole point of it now.
 * movy reaches the library through `renderer/schwung-lib.ts`, which wraps the
 * import in try/catch precisely so a Schwung that cannot serve it leaves the
 * feature unavailable instead of stopping the tool from loading. A stub that
 * imports cleanly and throws later would make `schwungLibAvailable()` answer
 * TRUE on a machine with no schwung at all — the one answer that must not be
 * wrong, since it is what pins the mode to 'off'.
 *
 * So this reproduces the real failure shape: on device an old Schwung fails the
 * same way, either with a missing file or with "Could not find export
 * 'navLabelsOf' in module page_plan.mjs" — a link error at evaluation time.
 */
throw new Error(
    'Schwung param_pages not available: rebuild with SCHWUNG=/path/to/schwung ' +
    'to exercise the Schwung knob grid.');
