/* main-page-constants.ts — the knob map and ranges Main Params' three
 * siblings (`main-page.ts`, `main-page-apply.ts`, `set-params-contract.ts`)
 * all need, with no dependency of their own. Split out solely to avoid a
 * cycle: `main-page.ts` calls into `main-page-apply.ts`'s writers, which need
 * the same knob-index constants `main-page.ts` defines — importing them
 * FROM `main-page.ts` would import back into the file that imports this one. */

export const BPM_MIN_X100 = 2000, BPM_MAX_X100 = 30000;
export const SWING_MIN = 50, SWING_MAX = 80;

/* Knob map: 0 TEMPO, 1 SWING, 2 LINK, 3 unused, 4 ROOT, 5 KEY, 6 MODE,
 * 7 LAYOUT — the four musical params share the bottom row. */
export const K_TEMPO = 0, K_SWING = 1, K_LINK = 2, K_QUANT = 3;
export const K_ROOT = 4, K_KEY = 5, K_MODE = 6, K_LAYOUT = 7;
