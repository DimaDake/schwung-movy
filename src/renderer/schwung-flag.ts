/* One switch, so the swap is reversible on device and comparable in tests.
 *
 * Off by default: this is an experiment against movy's own renderer, not a
 * replacement for it, and its 135 screenshot baselines must keep describing
 * movy until the swap is actually decided. */
let enabled = false;
export function schwungGridEnabled(): boolean { return enabled; }
export function setSchwungGrid(on: boolean): void { enabled = !!on; }
