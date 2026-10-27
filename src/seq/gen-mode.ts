/* Where the generators' options come from — the GENERATOR MODE row on the
 * Settings page (plans/2026-10-27-algorithmic-generators-design.md §6):
 * ALGORITHMIC (src/gen, on the device, the default) or MODEL (Gemini).
 *
 * A property of this device like GENERATORS: read from prefs.json on first
 * use and cached; a request reads it once when it starts (ai/job.ts). */

import { readPrefGenMode, writePrefGenMode } from './prefs.js';

export type GenMode = 'ALGORITHMIC' | 'MODEL';
const MODES: GenMode[] = ['ALGORITHMIC', 'MODEL'];

let mode: GenMode | null = null;

export function genMode(): GenMode {
    if (!mode) mode = readPrefGenMode();
    return mode;
}

/** Knob turn on the row: one step per turn event, clamped. True when it moved. */
export function genModeTurn(delta: number): boolean {
    const i = MODES.indexOf(genMode());
    const next = MODES[Math.max(0, Math.min(MODES.length - 1, i + Math.sign(delta)))];
    if (next === genMode()) return false;
    mode = next;
    writePrefGenMode(next);
    return true;
}

export function genModeLabel(): string { return genMode(); }

export function resetGenMode(): void { mode = null; }
