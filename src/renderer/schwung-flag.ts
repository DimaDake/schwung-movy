/* One switch, so the swap is reversible on device and comparable in tests.
 *
 * Off by default: this is an experiment against movy's own renderer, not a
 * replacement for it, and its 135 screenshot baselines must keep describing
 * movy until the swap is actually decided. */
import { schwungGridMode, setSchwungGridMode } from './schwung-grid.js';

/* Kept as the 'body' predicate the renderer already asks, now expressed over
 * the three-way mode so there is one switch rather than two that can disagree. */
export function schwungGridEnabled(): boolean { return schwungGridMode() === 'body'; }
export function setSchwungGrid(on: boolean): void { setSchwungGridMode(on ? 'body' : 'off'); }
export { schwungGridMode, setSchwungGridMode };
