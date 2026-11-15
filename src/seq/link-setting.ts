/* Ableton Link on/off — the LINK row on the Settings page.
 *
 * Kept for this Move in prefs.json, not per Set, like CLICK VOLUME: it is
 * about the room (is there a Live to sync with), not about the song. The
 * engine is told on every boot (a re-dlopened engine starts with Link off) and
 * on every click; the engine passes it to movy-link (link_bridge.rs). */

import { paramSet } from '../host/param.js';
import { readPrefLink, writePrefLink } from './prefs.js';

let on: boolean | null = null;   /* null = not read from prefs yet */

export function linkSettingOn(): boolean {
    if (on === null) on = readPrefLink();
    return on;
}

export function pushLinkSetting(set: (key: string, value: string) => void): void {
    set('link', linkSettingOn() ? '1' : '0');
}

/** Jog click on the row. */
export function linkSettingToggle(): void {
    set(!linkSettingOn());
}

/** Knob 1 on the row: right is on, left is off, like a two-position switch.
 *  True when the value moved. */
export function linkSettingTurn(delta: number): boolean {
    if (delta === 0 || (delta > 0) === linkSettingOn()) return false;
    set(delta > 0);
    return true;
}

function set(next: boolean): void {
    on = next;
    writePrefLink(next);
    paramSet('link', next ? '1' : '0');
}

export function linkSettingLabel(): string {
    return linkSettingOn() ? 'ON' : 'OFF';
}

export function resetLinkSetting(): void {
    on = null;
}
