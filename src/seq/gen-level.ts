/* How bold the generators are — the GENERATORS row on the Settings page.
 *
 * A property of this device, like the click volume: read from prefs.json on
 * first use and cached, and read once per request (ai/job.ts), so turning it
 * while a request runs changes the next one, not the one running. */

import { GEN_LEVELS, type GenLevel } from '../gen/types.js';
import { readPrefGenLevel, writePrefGenLevel } from './prefs.js';

let level: GenLevel | null = null;

export function genLevel(): GenLevel {
    if (!level) level = readPrefGenLevel();
    return level;
}

/** Knob turn on the row: one level per turn event whatever its size (three
 *  levels are found by feel, not by speed), clamped. True when it moved. */
export function genLevelTurn(delta: number): boolean {
    const i = GEN_LEVELS.indexOf(genLevel());
    const next = GEN_LEVELS[Math.max(0, Math.min(GEN_LEVELS.length - 1, i + Math.sign(delta)))];
    if (next === genLevel()) return false;
    level = next;
    writePrefGenLevel(next);
    return true;
}

export function genLevelLabel(): string { return genLevel(); }

export function resetGenLevel(): void { level = null; }
