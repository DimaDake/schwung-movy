/* A module that refused to load (engine chain_load_check.rs).
 *
 * The chain host leaves the position empty and says nothing, so the track
 * went silent with no reason given: Amino holds four instances, and a fifth
 * track's Amino is refused. The engine reports the last refusal as
 * `lde=<seq>:<slot>:<component>:<module>`; a new sequence is a new refusal. */

import { seqToast } from './render.js';
import { moduleDisplayName } from '../modules/loader.js';

/* 0, not freeze's "first sight is old news": movy-host loads the engine and
 * ui.js together and never reloads either, so every refusal the engine counted
 * happened in this session — including a Set opened before the first poll. */
let lastSeq = 0;

/** The toast for a refusal on track `slot` (0-based). */
export function loadErrorText(slot: number, component: string, module: string): string {
    const name = moduleDisplayName(module, component).toUpperCase();
    return `T${slot + 1}: ${name} DID NOT LOAD`;
}

export function loadErrorField(val: string): void {
    const [seqS, slotS, component, module] = val.split(':');
    const seq = Number(seqS);
    if (seq !== lastSeq && module && module !== '-') {
        seqToast(loadErrorText(Number(slotS), component, module));
    }
    lastSeq = seq;
}

/** Tests only: forget the last sequence. */
export function resetLoadErrors(): void {
    lastSeq = 0;
}
