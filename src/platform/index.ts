/* Imported as a live binding, so `setPlatformForTest` reaches every caller. */

import type { Platform } from './platform.js';
import { standalonePlatform } from './standalone.js';

export type { Platform } from './platform.js';

export let platform: Platform = standalonePlatform;

export function setPlatformForTest(p: Platform): void { platform = p; }
