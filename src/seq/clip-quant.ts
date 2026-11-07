/* The one writer of the watched clip's quantization: the mirror, the engine,
 * and the hold that keeps a stale status from undoing it (local-writes.ts). */

import { seqState } from './state.js';
import { seqCmd } from './engine.js';
import { noteLocalWrite } from './local-writes.js';

export function writeClipQuant(track: number, pct: number): void {
    seqState.clipQuant = pct;
    seqCmd('cq ' + track + ' ' + pct);
    noteLocalWrite('quant');
}
