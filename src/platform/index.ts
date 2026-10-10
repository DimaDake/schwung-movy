/* Picks the host implementation once, at module evaluation — which is ui.js
 * load, before init(). Imported as a live binding, so `setPlatformForTest`
 * reaches every caller. */

import type { Platform } from './platform.js';
import { overtakePlatform } from './overtake.js';
import { isStandaloneHost, standalonePlatform } from './standalone.js';

export type { Platform } from './platform.js';
export type { Caps } from './caps.js';

export let platform: Platform = isStandaloneHost() ? standalonePlatform : overtakePlatform;

export function setPlatformForTest(p: Platform): void { platform = p; }
