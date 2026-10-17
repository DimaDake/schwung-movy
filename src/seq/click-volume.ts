/* Metronome click volume — the CLICK VOLUME row on the Settings page.
 *
 * The value is read from prefs.json on first use and cached: the engine push
 * on every boot and every redraw of the row would otherwise each hit the file.
 * The engine starts at the default level, so `pushClickVolume` runs on every
 * engine (re)boot, silently; only a user turn auditions a click. */

import { paramSet } from '../host/param.js';
import { CLICK_DB_MAX, readPrefClickDb, writePrefClickDb } from './prefs.js';

let db = -1;   /* -1 = not read from prefs yet */

export function clickVolumeDb(): number {
    if (db < 0) db = readPrefClickDb();
    return db;
}

export function pushClickVolume(set: (key: string, value: string) => void): void {
    set('clickdb', String(clickVolumeDb()));
}

/** Knob turn on the row. True when the value moved (it is clamped, not wrapped,
 *  so the ends stay findable by feel). */
export function clickVolumeTurn(delta: number): boolean {
    const next = Math.max(0, Math.min(CLICK_DB_MAX, clickVolumeDb() + delta));
    if (next === clickVolumeDb()) return false;
    db = next;
    writePrefClickDb(next);
    paramSet('clickdb', String(next));
    paramSet('clickaud', '1');
    return true;
}

export function clickVolumeLabel(): string {
    return (clickVolumeDb() === 0 ? '' : '+') + clickVolumeDb() + ' dB';
}

export function resetClickVolume(): void {
    db = -1;
}
