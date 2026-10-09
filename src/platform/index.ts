/* Picks the host implementation once, at module evaluation — which is ui.js
 * load, before init(). Imported as a live binding, so `setPlatformForTest`
 * reaches every caller. */

import type { Platform } from './platform.js';
import { overtakePlatform } from './overtake.js';

export type { Platform } from './platform.js';
export type { Caps } from './caps.js';

/* Only one flavour exists until movy-host (WP6) adds the standalone one. */
export let platform: Platform = overtakePlatform;

export function setPlatformForTest(p: Platform): void { platform = p; }
