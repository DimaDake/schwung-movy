/* The stand-in for schwung-widgets.ts in a build with the grid switched off.
 * See schwung-body.off.ts for why the module has to leave the graph rather
 * than merely be unreachable.
 *
 * Every entry point answers instead of throwing. Registration is a thing movy
 * DECLINES to do without the grid, not a thing it fails at — there is no
 * Schwung page for a widget to draw into, so "no widget was registered" is the
 * true answer rather than an error. `loadOverlay` in particular must not throw:
 * it is the one that touches globalThis, and a stub that threw there would be
 * more dangerous than the code it replaces.
 *
 * THE SURFACE MIRRORS THE REAL MODULE, INCLUDING WHERE IT MOVED. The file side
 * (which script a module ships, what it published) now lives in
 * schwung-canvas.ts, which imports nothing from param_pages — so these stubs
 * are all that is needed to keep the loader out of this build entirely.
 */
export function declaresCustomWidget(_chainParams: any[]): boolean { return false; }
export function overlayWidgets(_ov: any): any[] { return []; }
export function findOverlay(_moduleId: string): any { return null; }
export function loadOverlay(_path: string, _ref?: string): any { return null; }
export function registerModuleWidgets(_readId: () => string, _chainParams: any[]): boolean { return false; }
export function registerWidget(_kind: string, _impl: any): void { /* no grid to draw in */ }
export function clearWidgets(): void { /* nothing registered */ }
export function isWidgetAvailable(_kind: string): boolean { return false; }
