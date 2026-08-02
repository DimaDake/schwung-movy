/* What step recording puts on screen, and the per-tick work that keeps it
 * there. The mode's parameter page stays visible underneath — you can keep
 * shaping the sound while entering the part — so the only chrome is the
 * existing inverted announcement band at the top. */

import { fontWidth } from '../font/index.js';
import { midiNoteName } from '../keyboard/notes.js';
import { W } from '../renderer/layout.js';
import { seqHeaderAnnounce } from './render.js';
import { seqState } from './state.js';
import { stepRecActive, stepRecHead } from './step-rec.js';

const HEADER_TTL = 2;   // ticks — re-armed every tick, so it dies with the mode

/* `STEP REC 5/16  C3 E3 G3`. The notes come from the engine's reply for the
 * head step and are shown as they will SOUND (clip transpose applied), so the
 * header agrees with the pads and with playback. Names are dropped from the end
 * until the line fits — a 128 px display cannot show a seven-note chord. */
export function stepRecHeaderText(): string {
    const len = seqState.lenSteps > 0 ? String(seqState.lenSteps) : '--';
    const base = `STEP REC ${stepRecHead() + 1}/${len}`;
    const names = seqState.holdNotes.map(
        (p) => midiNoteName(Math.max(0, Math.min(127, p + seqState.clipTranspose))),
    );
    const line = () => (names.length > 0 ? `${base} ${names.join(' ')}` : base);
    let text = line();
    while (names.length > 0 && fontWidth(text) > W - 4) {
        names.pop();
        text = line();
    }
    return text;
}

/* Per app tick. Re-arms the header band with a two-tick life so it stays up for
 * the whole gesture and vanishes on its own the moment the mode ends. */
export function stepRecTick(): void {
    if (!stepRecActive()) return;
    seqHeaderAnnounce(stepRecHeaderText(), HEADER_TTL);
}
