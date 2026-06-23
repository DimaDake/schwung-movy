export const browserState = {
    modules:      [] as { id: string; name: string; path: string }[],
    browseIndex:  0,
    componentKey: 'synth',
    paramSlot:    0,                       // shadow_get/set_param slot for the browsed chain
    reload:       null as null | (() => void), // refresh the model backing the browsed slot
};
