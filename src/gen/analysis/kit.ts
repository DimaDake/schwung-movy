/* Which pad of a drum track plays which part: the kit's declared names first,
 * the General MIDI map second (Ableton's racks and Move's kits follow it from
 * 36 = kick), and what the pattern does last. A generator only ever writes a
 * pad the kit has. */

import type { Note } from '../types.js';
import { TPS } from '../types.js';

export type PadRole = 'kick' | 'snare' | 'hat' | 'open' | 'tom' | 'cym' | 'perc';

export interface Kit { pads: number[]; role: Record<number, PadRole>; by: Record<PadRole, number[]> }

const GM: Record<number, PadRole> = {
    35: 'kick', 36: 'kick', 37: 'perc', 38: 'snare', 39: 'snare', 40: 'snare', 41: 'tom', 42: 'hat', 43: 'tom',
    44: 'hat', 45: 'tom', 46: 'open', 47: 'tom', 48: 'tom', 49: 'cym', 50: 'tom', 51: 'cym', 52: 'cym', 53: 'cym',
    55: 'cym', 57: 'cym', 59: 'cym',
};

function byName(name: string): PadRole | null {
    const n = name.toUpperCase();
    if (/OPEN|\bOH\b/.test(n)) return 'open';
    if (/HAT|\bHH\b|\bCH\b|SHAKER/.test(n)) return 'hat';
    if (/KICK|\bBD\b|BASS ?DRUM|\bKD\b/.test(n)) return 'kick';
    if (/SNARE|\bSD\b|CLAP|\bCP\b/.test(n)) return 'snare';
    if (/TOM/.test(n)) return 'tom';
    if (/CRASH|RIDE|CYM|SPLASH|CHINA/.test(n)) return 'cym';
    return null;
}

const hitsAt = (notes: Note[], p: number, steps: number[]) =>
    notes.filter((n) => n.pitch === p && steps.includes(Math.round(n.tick / TPS) % 16)).length;

export function kitOf(pads: number[], names: Record<number, string> | null, notes: Note[]): Kit {
    const role: Record<number, PadRole> = {};
    for (const p of pads) role[p] = (names?.[p] ? byName(names[p]) : null) ?? GM[p] ?? 'perc';
    const has = (r: PadRole) => pads.some((p) => role[p] === r);
    const used = pads.filter((p) => notes.some((n) => n.pitch === p));
    const count = (p: number) => notes.filter((n) => n.pitch === p).length;
    /* A kit off the GM map: the pattern names its kick, snare and hats. */
    if (!has('kick') && used.length) {
        const k = [...used].sort((a, b) => hitsAt(notes, b, [0, 4, 8, 12]) - hitsAt(notes, a, [0, 4, 8, 12]) || a - b)[0];
        role[k] = 'kick';
    }
    if (!has('snare')) {
        const s = used.filter((p) => role[p] === 'perc').sort((a, b) => hitsAt(notes, b, [4, 12]) - hitsAt(notes, a, [4, 12]))[0];
        if (s !== undefined && hitsAt(notes, s, [4, 12]) > 0) role[s] = 'snare';
    }
    if (!has('hat')) {
        const h = used.filter((p) => role[p] === 'perc').sort((a, b) => count(b) - count(a))[0];
        if (h !== undefined) role[h] = 'hat';
    }
    const by = { kick: [], snare: [], hat: [], open: [], tom: [], cym: [], perc: [] } as Record<PadRole, number[]>;
    for (const p of pads) by[role[p]].push(p);
    return { pads: [...pads], role, by };
}

/** The pad that plays a role in this pattern, most used first; or any pad of
 *  that role in the kit; or null. */
export function padFor(kit: Kit, r: PadRole, notes: Note[]): number | null {
    const list = kit.by[r];
    if (!list.length) return null;
    return [...list].sort((a, b) => notes.filter((n) => n.pitch === b).length - notes.filter((n) => n.pitch === a).length)[0];
}
