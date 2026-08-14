/* Which knobs are LOUDNESS controls, and so read better as a fader than a dial.
 *
 * A round knob is the right picture for a value with no natural top or bottom —
 * a cutoff, a rate, a detune. A level has both: silence and full. Everyone who
 * has touched a mixer already knows what a fader at the bottom means, and no
 * one has to read the label to find the volume on a page of eight dials.
 *
 * Name-driven, like every other inference movy makes. The exclusions matter as
 * much as the matches: "Level KF", "Rdm Vol" and a mod-matrix row all say
 * `level` while being an amount of something else entirely. */

import type { KnobParam } from '../types/param.js';

/* Words that name a loudness. `amp` is deliberately absent — in this fleet it
 * is nearly always "amp envelope", not an output level. */
const LOUD = new Set(['volume', 'vol', 'gain', 'level', 'lvl', 'loudness']);

/* Words that make it something other than an output level. */
const NOT_LOUD = new Set([
    'pan', 'width', 'spread', 'balance',                    // placement, not level
    'env', 'lfo', 'mod', 'depth', 'amount', 'amt',          // a MODULATION of a level
    'vel', 'velocity', 'key', 'track', 'follow', 'sens',
    'time', 'rate', 'freq', 'frequency', 'hz', 'ms',        // not a level at all
    'attack', 'decay', 'sustain', 'release',
    'thres', 'threshold', 'ratio', 'knee', 'comp',          // dynamics: read as numbers
    /* A randomiser is an amount, not the thing it names — granular's "Rdm Vol",
     * obxd's "Level Var". The same trap as the waveform toggles. */
    'rnd', 'rdm', 'rand', 'random', 'var', 'variance',
    'correction', 'corr',                                   // a trim factor
]);

/* Glued role suffixes: minijv keys a key-follow amount `levelkeyfollow`, one
 * token, so the word list above never sees the role. */
const GLUED_ROLE = /(keyfollow|follow|track|sens|amount|depth)$/;

const words = (text: string): string[] =>
    text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);

/* A modulation-matrix row targets a level; it is not the level. denis keys them
 * `mat_<src>_<dst>` and labels them with an arrow ("S&H->Level"). */
const isModMatrix = (p: KnobParam): boolean =>
    /^mat[_0-9]/.test(p.key) || String(p.label).indexOf('>') >= 0;

export function isFaderParam(p: KnobParam): boolean {
    if (p.type !== 'float' && p.type !== 'int') return false;
    if (!(p.max > p.min)) return false;
    if (isModMatrix(p)) return false;
    const ws = [...words(p.key), ...words(p.label)];
    if (ws.some((w) => NOT_LOUD.has(w) || GLUED_ROLE.test(w))) return false;
    return ws.some((w) => LOUD.has(w));
}
