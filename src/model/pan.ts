/* Which knobs are STEREO PLACEMENT controls, and so read better as a bipolar
 * bar than a dial.
 *
 * An arc knob starts its travel at the bottom left and sweeps 300 degrees, which
 * is the right picture for a value with one end — a cutoff, a rate, a level. Pan
 * has a MIDDLE, and the middle is the value people actually aim for. On a dial
 * that centre is an unremarkable position two thirds of the way round; on a
 * bar filling out from the centre it is the one state that looks different from
 * every other. See renderer/pan-dial.ts.
 *
 * Name-driven, like every other inference movy makes (compare model/fader.ts).
 * The exclusions carry the work: the dumped fleet has almost as many params
 * that merely SAY pan as ones that are a pan — `rnd_pan` is how much a voice
 * wanders, `pan_width` is a spread, `Pan KF` is a key-follow amount, and none
 * of them has a centre.
 *
 * Deliberately absent from the match list: `balance`. osirus `osc_balance` and
 * surge `f_balance` crossfade between two SOURCES, not between two speakers, so
 * a left/right picture would be a lie. usefulity's param is still caught —
 * its key is `pan` and only its label says Balance, and the key is what matches.
 */

import type { KnobParam } from '../types/param.js';

/* Words that name a stereo position. */
const PAN = new Set(['pan', 'panorama', 'panning']);

/* Words that make it something other than a position. */
const NOT_PAN = new Set([
    'width', 'spread', 'stereo',                            // a SIZE, not a place
    'rnd', 'rdm', 'rand', 'random', 'var', 'variance',      // an amount of wander
    'mod', 'lfo', 'env', 'depth', 'amount', 'amt',          // a MODULATION of a pan
    'vel', 'velocity', 'kf', 'keyfollow', 'follow',
    'track', 'sens', 'morph', 'intensity',                  // chordism's "Pan Morph"
    'mode',                                                 // magneto's Mono/Stereo enum
    /* smack keys the two sides of a stereo pair `pan_l` and `pan_r`, each a
     * one-sided 0..100 position. A bar that fills out from a centre would say
     * they have one, so they keep the dial. */
    'l', 'r',
]);

/* Glued role suffixes: minijv keys a pan key-follow `panningkeyfollow`, one
 * token, so the word list above never sees the role. */
const GLUED_ROLE = /(keyfollow|follow|track|sens|amount|depth|spread|width)$/;

/* Glued pan nouns: minijv keys its part and patch pans `partpan` / `patchpan`,
 * again one token. */
const GLUED_PAN = /[a-z]pan$/;

const words = (text: string): string[] =>
    text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);

/* A modulation-matrix row targets a pan; it is not the pan. Same shape as the
 * fader's check — denis keys them `mat_<src>_<dst>` and labels them with an
 * arrow ("LFO2->Pan"). */
const isModMatrix = (p: KnobParam): boolean =>
    /^mat[_0-9]/.test(p.key) || String(p.label).indexOf('>') >= 0;

export function isPanParam(p: KnobParam): boolean {
    if (p.type !== 'float' && p.type !== 'int') return false;
    if (!(p.max > p.min)) return false;
    if (isModMatrix(p)) return false;
    const ws = [...words(p.key), ...words(p.label)];
    if (ws.some((w) => NOT_PAN.has(w) || GLUED_ROLE.test(w))) return false;
    return ws.some((w) => PAN.has(w) || GLUED_PAN.test(w));
}
