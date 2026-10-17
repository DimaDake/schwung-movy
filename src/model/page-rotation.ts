/* Which of a drum config's banks are VOICE pages.
 *
 * A drum module whose voices are separate circuits declares a page per voice
 * (`bank.pad`). THE SHAPE IS FIXED, and this is the only shape movy accepts:
 *
 *     banks: [ voice, voice, voice, ..., page, page, ... ]
 *              ^-- every one declares `pad`     ^-- none of them do
 *
 * The voice run is the LEADING run of banks that declare a pad. A `pad` on any
 * bank after it is ignored — it is an ordinary page. That rules out the two
 * shapes that read as reasonable and are not: a voice bank buried behind Master
 * (nothing would open on it), and a page-only pad — a spare grid seat that
 * opens Reverb — which would silently turn Reverb into a voice.
 *
 * `config-hierarchy.ts` asks this when it translates a config into Schwung's
 * contract. (movy's own pages collapsed the run into one pad-following seat —
 * retired with them; see docs/movy-pages-knowhow.md.)
 */

/** How many leading banks declare a pad — banks [0, n) are voice pages. */
export function voiceRunLength(pads: (number | undefined)[]): number {
    let n = 0;
    while (n < pads.length && pads[n] !== undefined) n++;
    return n;
}
