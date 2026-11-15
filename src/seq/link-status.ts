/* Ableton Link as the UI sees it: two status fields from the engine
 * (link_bridge.rs) and how the tempo cell shows them. Link is switched in
 * schwung's Global Settings ("Movy Link"), never here. */

import { seqState } from './state.js';

export function linkStatusField(key: string, val: string): void {
    if (key === 'lk') seqState.linkOn = val === '1';
    else seqState.linkPeers = Math.max(0, parseInt(val, 10) || 0);
}

/* The tempo cell's text while Link is on, or undefined to fall through to the
 * EXT/unit rules. The header always says Link is on and with how many peers;
 * the 30px cell says LNK only while movy is following someone, and that beats
 * EXT because the engine ignores MIDI clock while it has peers. */
export function linkTempoText(raw: string, surface: string): string | null | undefined {
    if (!seqState.linkOn) return undefined;
    if (surface === 'header') return raw + ' bpm LINK ' + seqState.linkPeers;
    return seqState.linkPeers > 0 ? raw + ' LNK' : null;
}
