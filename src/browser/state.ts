export const browserState = {
    modules:      [] as { id: string; name: string; path: string }[],
    browseIndex:  0,
    componentKey: 'synth',
    paramSlot:    0,                       // TRACK INDEX (0-15) of the browsed chain, not a schwung slot
    reload:       null as null | (() => void), // refresh the model backing the browsed slot
};
