/* Which pad of a drum track plays which part.
 *
 * What the rack says about a pad comes first, strongest first: the role it
 * declares, the name it declares, then what the pad holds right now (a
 * sample's file name, a per-pad enum like a voice's algorithm). All of it is
 * read by one vocabulary (drum-lexicon.ts), so a rack movy has never seen
 * needs no entry here.
 *
 * Only a rack that says NOTHING is guessed, and only then by the General MIDI
 * map (36 = kick, the layout most racks follow), what the pattern does, and
 * the order the pads come in. A rack that names its pads is never second-
 * guessed by GM: plenty lay them out otherwise (36 kick, 37 snare, 38 tom).
 *
 * A generator only ever writes a pad the kit has. */

import type { Note } from '../types.js';
import { TPS } from '../types.js';
import { MEMBRANE, roleOfText, type RoleHit } from './drum-lexicon.js';

export type PadRole = 'kick' | 'snare' | 'hat' | 'open' | 'tom' | 'cym' | 'perc';

export interface Kit { pads: number[]; role: Record<number, PadRole>; by: Record<PadRole, number[]> }

/** What a track's rack says about its pads, pitch → text. */
export interface KitHints {
    names?: Record<number, string> | null;
    roles?: Record<number, string> | null;
    labels?: Record<number, string> | null;
}

/** The hints a generator input carries for a track. */
export function kitHints(t: { padNames?: Record<number, string> | null; padRoles?: Record<number, string> | null;
    padLabels?: Record<number, string> | null } | undefined | null): KitHints {
    return { names: t?.padNames ?? null, roles: t?.padRoles ?? null, labels: t?.padLabels ?? null };
}

const GM: Record<number, RoleHit> = {};
for (const [notes, role, rank] of [
    [[36], 'kick', 0], [[35], 'kick', 1], [[38], 'snare', 0], [[39], 'snare', 1], [[40], 'snare', 2],
    [[37], 'perc', 1], [[56], 'perc', 0], [[42], 'hat', 0], [[44], 'hat', 1], [[54], 'hat', 2], [[46], 'open', 0],
    [[41, 43, 45, 47, 48, 50], 'tom', 0], [[49, 51, 52, 53, 55, 57, 59], 'cym', 0],
] as [number[], PadRole, number][]) for (const n of notes) GM[n] = { role, rank };

/* The declared role first. A name may still sharpen it within its family —
 * a rack that calls both hats "hat" and names one "Open" has an open hat —
 * and a bare membrane ("drum") gives way to anything more definite. */
function fromText(p: number, h: KitHints, roles: boolean): RoleHit | null {
    const said = [roles ? h.roles?.[p] : null, h.names?.[p], h.labels?.[p]].map(roleOfText);
    const first = said.find((x) => x && x.rank !== MEMBRANE) ?? said.find((x) => x) ?? null;
    if (first?.role === 'hat' && said.some((x) => x?.role === 'open')) return { role: 'open', rank: 0 };
    return first;
}

const hitsAt = (notes: Note[], p: number, steps: number[]) =>
    notes.filter((n) => n.pitch === p && steps.includes(Math.round(n.tick / TPS) % 16)).length;

export function kitOf(pads: number[], hints: KitHints | null, notes: Note[]): Kit {
    const h = hints ?? {};
    /* A role every pad shares tells them apart no better than none (CW-78
     * calls all fourteen voices "drum"). */
    const said = pads.map((p) => h.roles?.[p]).filter((r) => r);
    const roles = !(said.length > 2 && new Set(said).size === 1);
    const told: Record<number, RoleHit | null> = {};
    for (const p of pads) told[p] = fromText(p, h, roles);
    const named = pads.some((p) => told[p]);
    /* A bare membrane ("Drum"): the lowest is the kick when nothing else is. */
    const drums = pads.filter((p) => told[p]?.rank === MEMBRANE).sort((a, b) => a - b);
    if (drums.length && !pads.some((p) => told[p]?.role === 'kick')) told[drums[0]] = { role: 'kick', rank: 1 };
    const hit: Record<number, RoleHit> = {};
    for (const p of pads) hit[p] = told[p] ?? (named ? null : GM[p]) ?? { role: 'perc', rank: 3 };
    const role: Record<number, PadRole> = {};
    for (const p of pads) role[p] = hit[p].role;
    const has = (r: PadRole) => pads.some((p) => role[p] === r);
    /* Only a pad the rack said nothing about is ever guessed. */
    const open = (p: number) => !told[p] && role[p] === 'perc';
    const used = pads.filter((p) => notes.some((n) => n.pitch === p));
    const count = (p: number) => notes.filter((n) => n.pitch === p).length;
    /* A kit off the GM map: the pattern names its kick, snare and hats. */
    if (!has('kick')) {
        const k = used.filter((p) => !told[p]).sort((a, b) => hitsAt(notes, b, [0, 4, 8, 12]) - hitsAt(notes, a, [0, 4, 8, 12]) || a - b)[0];
        if (k !== undefined) role[k] = 'kick';
    }
    if (!has('snare')) {
        const s = used.filter(open).sort((a, b) => hitsAt(notes, b, [4, 12]) - hitsAt(notes, a, [4, 12]))[0];
        if (s !== undefined && hitsAt(notes, s, [4, 12]) > 0) role[s] = 'snare';
    }
    if (!has('hat')) {
        const x = used.filter(open).sort((a, b) => count(b) - count(a))[0];
        if (x !== undefined) role[x] = 'hat';
    }
    /* An empty kit that says nothing (New Clip on a fresh rack): the first
     * pads are kick, snare and hat, the way racks lay out. */
    if (!has('kick') && !used.length) {
        const free = [...pads].sort((a, b) => a - b).filter(open);
        (['kick', 'snare', 'hat'] as PadRole[]).forEach((r, i) => { if (!has(r) && free[i] !== undefined) role[free[i]] = r; });
    }
    const by = { kick: [], snare: [], hat: [], open: [], tom: [], cym: [], perc: [] } as Record<PadRole, number[]>;
    const rankOf = (p: number) => (role[p] === hit[p].role ? hit[p].rank : 0);
    for (const p of [...pads].sort((a, b) => rankOf(a) - rankOf(b) || a - b)) by[role[p]].push(p);
    return { pads: [...pads], role, by };
}

/** The pad that plays a role in this pattern, most used first, then the
 *  instrument itself before its stand-ins (a snare before a clap); or null. */
export function padFor(kit: Kit, r: PadRole, notes: Note[]): number | null {
    const list = kit.by[r];
    if (!list.length) return null;
    return [...list].sort((a, b) => notes.filter((n) => n.pitch === b).length - notes.filter((n) => n.pitch === a).length)[0];
}
