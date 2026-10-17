/* schwung-file-param.ts — which of Schwung's divable params movy can open.
 *
 * ONE ANSWER FOR TWO QUESTIONS that must not disagree: whether a click on the
 * held cell reaches a movy screen (`schwung-dive.ts` for a file,
 * `schwung-canvas-dive.ts` for a canvas), and whether the held-knob footer
 * advertises that click (`schwung-page-chrome.ts`). A `string` and a
 * `wav_position` are divable too, and movy draws neither — a click on one only
 * logs `schwung-open unhandled`, so the footer must not promise it.
 *
 * Files and canvases are the two a knob cannot drive: a turn moves neither, so
 * the click is the only way in, and an unhinted one reads as a dead knob
 * (breakbeat's slice editors, DR32's engine browser).
 */

const FILE_TYPES: Record<string, true> = { filepath: true, file: true };

export function isFileParam(meta: any): boolean {
    return !!meta && typeof meta.type === 'string' && FILE_TYPES[meta.type] === true;
}

/** The footer verb for a held cell whose click is the only way in, or null. */
export function clickOnlyVerb(meta: any): string | null {
    if (!meta || !meta.divable) return null;
    if (isFileParam(meta)) return 'BROWSE';
    if (meta.type === 'canvas') return 'OPEN';
    return null;
}
