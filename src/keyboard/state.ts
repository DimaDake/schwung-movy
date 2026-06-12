export const keyboardState = {
    rootNote: 48,
    held:     {} as Record<number, number>,  /* padNote → midiNote */
    /* most recent pad-played MIDI note — the sequencer's step-entry value */
    lastPlayedNote: 60,
};
