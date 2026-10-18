/* The engine's route for an external USB-A keyboard (engine ext_route.rs): which
 * chain the keys play, and on a drum track which note each key's pad plays.
 *
 * Pushed by comparison every tick, as pad-route.ts does and for its reason: the
 * things that change it (track switch, module change, a rack redeclaring its
 * voices) are a list that would rot. Unlike the pad map it ignores Session view
 * and held buttons — those change what the PADS mean, not the keyboard. */

import { appState } from '../app/state.js';
import { drumNoteOfPad } from '../keyboard/drum-grid.js';
import type { DrumConfig } from '../types/param.js';
import { drumConfigFor } from './pad-route.js';
import { chainInstance } from './ref.js';

/* Note the first drum pad sits on: the GM / Move kick. One key per pad upward. */
export const EXT_DRUM_BASE = 36;

let pushed = '';

/** The pitch an external key plays on this drum rack, or -1 for a key with no pad. */
export function extDrumPitch(note: number, cfg: DrumConfig): number {
    const pad = note - EXT_DRUM_BASE + 1;
    return pad >= 1 && pad <= cfg.padCount ? drumNoteOfPad(pad, cfg) : -1;
}

function buildMap(): string {
    const t = appState.activeTrack.index;
    const drum = drumConfigFor(t);
    const parts: number[] = [chainInstance(t)];
    if (drum && drum.padCount < 1) return '-1';   // a rack with no pads: the bare chain would play it melodically
    if (drum) for (let pad = 1; pad <= drum.padCount; pad++) parts.push(drumNoteOfPad(pad, drum));
    return parts.join(',');
}

export function syncExtRoute(send: (key: string, value: string) => void): void {
    const next = buildMap();
    if (next === pushed) return;
    pushed = next;
    send('extmap', next);
}

/** A re-dlopened engine has no route; forget what the last one was told. */
export function resetExtRoute(): void {
    pushed = '';
}
