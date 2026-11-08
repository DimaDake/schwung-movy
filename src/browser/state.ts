import { CHAIN_SLOTS } from '../chain/config.js';
export const browserState = {
    modules:      [] as { id: string; name: string }[],
    browseIndex:  0,
    componentKey: 'synth',
    paramSlot:    0,                       // TRACK INDEX (0-15) of the browsed chain, not a schwung slot
    reload:       null as null | (() => void), // refresh the model backing the browsed slot
};

/** The track whose chain slot the browser is open on, or -1 when it is open on
 *  a send or master FX slot, which belong to no track (the freeze guard asks:
 *  a send FX can be picked while a frozen track is focused). */
export function browsedTrack(): number {
    return CHAIN_SLOTS.some((c) => c.componentKey === browserState.componentKey) ? browserState.paramSlot : -1;
}
