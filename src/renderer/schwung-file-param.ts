/* schwung-file-param.ts — which of Schwung's divable params movy can open.
 *
 * ONE ANSWER FOR TWO QUESTIONS that must not disagree: whether a click on the
 * held cell reaches movy's file browser (`schwung-dive.ts`), and whether the
 * held-knob footer advertises that click (`schwung-page-chrome.ts`). A
 * `canvas`, a `string` and a `wav_position` are divable too, and movy draws
 * none of them — a click on one only logs `schwung-open unhandled`, so the
 * footer must not promise it.
 */

const FILE_TYPES: Record<string, true> = { filepath: true, file: true };

export function isFileParam(meta: any): boolean {
    return !!meta && typeof meta.type === 'string' && FILE_TYPES[meta.type] === true;
}
