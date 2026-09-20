/* The stand-in for schwung-widgets.ts in a build with the grid switched off.
 * See build/device.mjs's gridOffStubs comment ("THE OFF SWITCH HAS TO BE
 * FREE") for why the module has to leave the graph rather than merely be
 * unreachable.
 *
 * Every entry point answers instead of throwing. Registration is a thing movy
 * DECLINES to do without the grid, not a thing it fails at — there is no
 * Schwung page for a widget to draw into, so "no widget was registered" is the
 * true answer rather than an error.
 *
 * THE SURFACE IS THE REAL MODULE'S AND NOTHING MORE. The file side — which
 * script a module ships, what it published — moved out to schwung-canvas.ts,
 * which imports nothing from param_pages and so needs no stand-in here (it is
 * not in this build's graph at all). `findOverlay` and `loadOverlay` used to be
 * stubbed below after that move, which made this file claim a surface the real
 * module no longer had; a stub for a function nothing can call is a lie about
 * the module it stands in for.
 */
export function declaresCustomWidget(_chainParams: any[]): boolean { return false; }
export function overlayWidgets(_ov: any): any[] { return []; }
export function registerModuleWidgets(_owner: string, _readId: () => string,
                                      _chainParams: any[]): boolean { return false; }
export function setOwnerWidgets(_owner: string, _widgets: any[]): void { /* no registry */ }
export function registerWidget(_kind: string, _impl: any): void { /* no grid to draw in */ }
export function clearWidgets(): void { /* nothing registered */ }
export function isWidgetAvailable(_kind: string): boolean { return false; }
