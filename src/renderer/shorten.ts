/* A knob's label is budgeted in PIXELS, not characters.
 *
 * The font is proportional — five M's are 31 px in a 32 px cell, but CUTOFF is
 * 30 and RESO is 20 — so a five-character cap was the worst case applied to
 * every label, and words that fit whole were cut anyway ("CUTOF", "VOLUM").
 * Every limit below is therefore `fits`, and every truncation `clip`. */

import { fontWidth } from '../font/index.js';
import { CELL_W } from './layout.js';

/* The label's share of its cell: the full width less a pixel of gutter on each
 * side, so two full-width labels side by side still read as two words. The old
 * five-character cap was 31 px in the worst case (five M's), so nothing gets
 * WIDER than it used to be — the narrow labels just stop being cut short. */
export const LABEL_BUDGET = CELL_W - 2;

/** Does `s` fit the label budget? */
const fits = (s: string, budget: number): boolean => fontWidth(s) <= budget;

/** The longest prefix of `s` that fits `budget`. */
function clip(s: string, budget: number): string {
    let out = s;
    while (out.length > 0 && !fits(out, budget)) out = out.slice(0, -1);
    return out;
}

export function autoShorten(label: string, budget: number): string {
    const up = label.toUpperCase().replace(/_/g, ' ').trim();
    if (fits(up, budget)) return up;
    const words = up.split(/\s+/);
    if (words.length === 1) return clip(words[0], budget);
    if (fits(words[0], budget)) return words[0];
    const acronym = words.map(w => w[0]).join('');
    if (fits(acronym, budget)) return acronym;
    return clip(up.replace(/\s+/g, ''), budget);
}

function normalizeLabel(label: string): string {
    return label.toUpperCase().replace(/_/g, ' ').trim();
}

function wordsOf(label: string): string[] {
    const n = normalizeLabel(label);
    return n ? n.split(/\s+/) : [];
}

/** Longest run of leading words shared by every word array. */
function commonWordPrefix(wordArrays: string[][]): string[] {
    if (wordArrays.length < 2) return [];
    const out: string[] = [];
    for (let wi = 0; wi < wordArrays[0].length; wi++) {
        const w = wordArrays[0][wi];
        if (wordArrays.every(ws => ws[wi] === w)) out.push(w);
        else break;
    }
    return out;
}

const shortenWords = (ws: string[], budget: number): string => autoShorten(ws.join(' '), budget);

/** Vowel-skeleton compression that keeps each word's initial, then truncates.
 *  "FX1 Amount" → "FX1AM", "Shape 1" → "SHP1". Deterministic. */
function compressLabel(ws: string[], budget: number): string {
    const joined = ws.join('');
    if (fits(joined, budget)) return joined;
    const skel = ws.map(w => w[0] + w.slice(1).replace(/[AEIOU]/g, '')).join('');
    return (fits(skel, budget) ? skel : clip(skel, budget)) || clip(joined, budget);
}

interface Item { idx: number; ws: string[]; full: string[]; }

/** Colliding entries that share no leading word: an acronym when it separates
 *  them, otherwise the vowel-skeleton compression (residuals get bumped later). */
function assignDistinct(items: Item[], budget: number, out: string[]): void {
    /* Off the words these labels still DISAGREE about. By the time a group
     * reaches here its shared words may already have been stripped from `ws`
     * but not from `full`, and an acronym of the whole label spells out the
     * part every sibling has in common — "Amp EG Attack Shape" and "Amp EG
     * Decay Shape" came out AEAS and AEDS, where AS and DS say the same thing
     * and can be read. */
    const shared = commonWordPrefix(items.map(it => it.full)).length;
    const words = items.map(it => it.full.slice(shared));
    const acr = items.map((it, k) => words[k].length === 1
        ? autoShorten(words[k][0], budget)
        : clip(words[k].map(w => w[0]).join(''), budget));
    const freq = new Map<string, number>();
    for (const a of acr) freq.set(a, (freq.get(a) ?? 0) + 1);
    items.forEach((it, k) => {
        out[it.idx] = freq.get(acr[k]) === 1 ? acr[k] : compressLabel(words[k], budget);
    });
}

/** Recursively disambiguate a set of entries that currently share one shortName.
 *  Strip their common leading words; a stripped suffix ≤2 chars keeps context by
 *  prepending the last stripped word ("Wave 1" → WAVE1); sub-collisions recurse. */
function resolve(items: Item[], budget: number, out: string[], stripped: string[][]): void {
    if (items.length === 1) {
        const it = items[0];
        out[it.idx] = shortenWords(it.ws.length ? it.ws : it.full, budget);
        return;
    }
    const prefix = commonWordPrefix(items.map(it => it.ws));
    if (prefix.length === 0) { assignDistinct(items, budget, out); return; }

    const lastPrefix = prefix[prefix.length - 1];
    const named = items.map(it => {
        const ws = it.ws.slice(prefix.length);
        let nm: string;
        if (ws.length === 0) nm = shortenWords(prefix, budget);          // bare-prefix label
        else {
            const suffix = ws.join(' ');
            nm = suffix.length <= 2
                ? clip(lastPrefix, budget - fontWidth(suffix)) + suffix
                : shortenWords(ws, budget);
        }
        /* What is LEFT of this label once the shared prefix is gone. Carried
         * back out so a later pass re-resolves the residue rather than the
         * whole label again: rebuilding from the full words made the passes
         * oscillate (a name won in pass 1, was overwritten in pass 2 by a name
         * its sibling already held, and the loop simply ran out of passes). */
        stripped[it.idx] = ws.length ? ws : prefix;
        return { it: { idx: it.idx, ws, full: it.full }, nm };
    });
    const byName = new Map<string, typeof named>();
    for (const n of named) {
        const g = byName.get(n.nm);
        if (g) g.push(n); else byName.set(n.nm, [n]);
    }
    for (const [nm, arr] of byName) {
        if (arr.length === 1) out[arr[0].it.idx] = nm;
        else resolve(arr.map(n => n.it), budget, out, stripped);   // ws already stripped → shrinks each level
    }
}

/** Groups of ≥2 non-locked entries with distinct labels that share a shortName. */
function collisionGroups(
    entries: Array<{ label: string; shortLabel: string | null } | null>,
    result: string[], locked: boolean[],
): number[][] {
    const byName = new Map<string, number[]>();
    entries.forEach((e, i) => {
        if (!e || locked[i]) return;
        const g = byName.get(result[i]);
        if (g) g.push(i); else byName.set(result[i], [i]);
    });
    const out: number[][] = [];
    for (const idxs of byName.values()) {
        if (idxs.length < 2) continue;
        if (new Set(idxs.map(i => normalizeLabel(entries[i]!.label))).size > 1) out.push(idxs);
    }
    return out;
}

/** Last-resort guarantee: no two non-locked entries with different labels share a
 *  name (append an incrementing digit, honoring locked names as taken). */
function forceUnique(
    entries: Array<{ label: string; shortLabel: string | null } | null>,
    result: string[], locked: boolean[], budget: number,
): void {
    const used = new Map<string, string>();   // name → first claiming label
    entries.forEach((e, i) => {
        if (e && locked[i] && !used.has(result[i])) used.set(result[i], normalizeLabel(e.label));
    });
    entries.forEach((e, i) => {
        if (!e || locked[i]) return;
        const lab = normalizeLabel(e.label);
        let cand = result[i], c = 2;
        while (used.has(cand) && used.get(cand) !== lab) {
            const suf = String(c++);
            cand = clip(result[i], budget - fontWidth(suf)) + suf;
        }
        result[i] = cand;
        if (!used.has(cand)) used.set(cand, lab);
    });
}

/** Compute shortNames for a page of knobs. Auto-generated names that would
 *  otherwise collide are disambiguated by stripping shared word-prefixes,
 *  iterating to a fixed point, then a forced last-resort pass; explicit
 *  shortLabels are never altered and non-colliding names keep their plain form. */
export function dedupShortNames(
    entries: Array<{ label: string; shortLabel: string | null } | null>,
    budget: number,
): string[] {
    const locked = entries.map(e => !!(e && e.shortLabel));
    const result = entries.map(e =>
        e ? (e.shortLabel ? e.shortLabel.toUpperCase() : autoShorten(e.label, budget)) : '',
    );

    /* What each label still has to say for itself, narrowed as passes strip
     * shared words off it. */
    const stripped = entries.map(e => (e ? wordsOf(e.label) : []));
    for (let pass = 0; pass < 3; pass++) {
        const groups = collisionGroups(entries, result, locked);
        if (groups.length === 0) break;
        for (const idxs of groups) {
            const items = idxs.map(i => ({
                idx: i, ws: stripped[i], full: wordsOf(entries[i]!.label),
            }));
            resolve(items, budget, result, stripped);
        }
    }
    forceUnique(entries, result, locked, budget);
    return result;
}

export function enumSquareLines(value: string): [string, string] {
    /* A number is a value, not a two-word label. The '-' → separator rule below
     * exists so LOW_PASS and SAMPLE-HOLD split across the box's two lines, but on
     * a number it ate the minus sign: "-3" drew as "3", indistinguishable from
     * the positive 3 that surge publishes as the very next octave option. Widest
     * real value is 3 chars (sfz voices 1..128) = 12px in a 14px box. */
    const num = value.trim();
    if (/^[+-]?\d+$/.test(num)) return [num, ''];
    const parts = value.toUpperCase().replace(/[_\-]/g, ' ').trim().split(/\s+/);
    if (parts.length >= 2) {
        return [parts[0].substring(0, 3), parts[1].substring(0, 3)];
    }
    const w = parts[0];
    return [w.substring(0, 3), w.substring(3, 6)];
}
