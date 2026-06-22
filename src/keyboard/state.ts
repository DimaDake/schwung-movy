export const keyboardState = {
    rootNote: 48,
    scale:    0,                              /* index into SCALES (0 = Major) */
    held:     {} as Record<number, number>,  /* padNote → midiNote */
    /* most recent pad-played MIDI note — the sequencer's step-entry value */
    lastPlayedNote: 60,
};
