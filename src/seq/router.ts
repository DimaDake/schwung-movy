/* First-look dispatcher for sequencer-owned input. midi/router.ts calls
 * this before any existing handler; returning true consumes the event, so
 * the param-page layer stays untouched by sequencer features.
 *
 * Sequencer-owned events (claimed in later steps): step buttons (notes
 * 16-31), Play/Rec/Loop/Copy/Delete/Mute/Note-Session CCs, and pads while
 * Session mode is active. */

export function seqHandleMidi(_data: number[]): boolean {
    return false;
}
