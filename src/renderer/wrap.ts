/* Greedy word wrap against the pixel font.
 *
 * Measured in PIXELS, not characters: the font is proportional (`fontWidth`),
 * so a character budget is wrong by a third either way depending on the letters
 * — and the failure it produces is a line that runs off the right edge, which
 * looks like a bug rather than a full line.
 *
 * A word wider than the line gets its own line rather than being broken: at
 * this size a mid-word break reads as a typo, and every string that hits this
 * path is one we wrote and can shorten. */

import { fontWidth } from '../font/index.js';

export function wrapWords(text: string, maxPx: number): string[] {
    const out: string[] = [];
    let line = '';
    for (const word of text.split(' ')) {
        if (!word) continue;
        const next = line ? line + ' ' + word : word;
        if (line && fontWidth(next) > maxPx) {
            out.push(line);
            line = word;
        } else {
            line = next;
        }
    }
    if (line) out.push(line);
    return out;
}
