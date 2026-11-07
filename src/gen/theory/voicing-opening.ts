/* Where a REGISTER rung opens the voicing search (voicings.ts): the window,
 * the anchor and the first chord's bottom note. */

import type { Chord, Key } from '../types.js';
import { candidates, type Style, STYLES } from './voicing-styles.js';
import { pc } from './pc.js';
import type { VoiceOpts } from './voicings.js';

const LADDER_FROM = 40;

/** The window, the anchor and the first chord's bottom note for a rung. */
export function opening(c: Chord, k: Key, s: Style, o: VoiceOpts): { lo: number; hi: number; anchor: number; bottom: number | null } {
    const none = { lo: o.lo, hi: o.hi, anchor: o.anchor, bottom: null };
    if (o.rung === undefined) return none;
    const triad = c.pcs.slice(0, 3);
    let rung = LADDER_FROM;
    for (let i = 0; !triad.includes(pc(rung)) || i++ < o.rung; rung++) { /* the rung-th chord tone */ }
    const target = Math.max(rung, o.lo);
    let cs = candidates(c, k, s, o.lo, 108);
    if (!cs.length) cs = candidates(c, k, STYLES[1], o.lo, 108);
    /* A rung stands on a chord tone, not on a seventh or a colour. */
    const plain = cs.filter((x) => triad.includes(pc(x.notes[0])));
    const pool = plain.length ? plain : cs;
    if (!pool.length) return none;
    const bottom = pool.map((x) => x.notes[0]).sort((a, b) => Math.abs(a - target) - Math.abs(b - target) || a - b)[0];
    const anchor = Math.min(...pool.filter((x) => x.notes[0] === bottom).map((x) => x.notes[x.notes.length - 1]));
    const lo = Math.max(o.lo, bottom - 7);
    return { lo, hi: Math.max(anchor + 7, lo + 18), anchor, bottom };
}

