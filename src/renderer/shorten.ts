export function autoShorten(label: string, maxChars: number): string {
    const up = label.toUpperCase().replace(/_/g, ' ').trim();
    if (up.length <= maxChars) return up;
    const words = up.split(/\s+/);
    if (words.length === 1) return words[0].substring(0, maxChars);
    if (words[0].length <= maxChars) return words[0];
    const acronym = words.map(w => w[0]).join('');
    if (acronym.length <= maxChars) return acronym;
    return up.replace(/\s+/g, '').substring(0, maxChars);
}

function normalizeLabel(label: string): string {
    return label.toUpperCase().replace(/_/g, ' ').trim();
}

function wordsOf(label: string): string[] {
    const n = normalizeLabel(label);
    return n ? n.split(/\s+/) : [];
}

const clip = (s: string, n: number): string => s.slice(0, Math.max(0, n));

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

const shortenWords = (ws: string[], maxChars: number): string => autoShorten(ws.join(' '), maxChars);

/** Vowel-skeleton compression that keeps each word's initial, then truncates.
 *  "FX1 Amount" → "FX1AM", "Shape 1" → "SHP1". Deterministic. */
function compressLabel(ws: string[], maxChars: number): string {
    const joined = ws.join('');
    if (joined.length <= maxChars) return joined;
    const skel = ws.map(w => w[0] + w.slice(1).replace(/[AEIOU]/g, '')).join('');
    return (skel.length <= maxChars ? skel : skel.slice(0, maxChars)) || joined.slice(0, maxChars);
}

interface Item { idx: number; ws: string[]; full: string[]; }

/** Colliding entries that share no leading word: an acronym when it separates
 *  them, otherwise the vowel-skeleton compression (residuals get bumped later). */
function assignDistinct(items: Item[], maxChars: number, out: string[]): void {
    const acr = items.map(it => it.full.length === 1
        ? autoShorten(it.full[0], maxChars)
        : it.full.map(w => w[0]).join('').slice(0, maxChars));
    const freq = new Map<string, number>();
    for (const a of acr) freq.set(a, (freq.get(a) ?? 0) + 1);
    items.forEach((it, k) => {
        out[it.idx] = freq.get(acr[k]) === 1 ? acr[k] : compressLabel(it.full, maxChars);
    });
}

/** Recursively disambiguate a set of entries that currently share one shortName.
 *  Strip their common leading words; a stripped suffix ≤2 chars keeps context by
 *  prepending the last stripped word ("Wave 1" → WAVE1); sub-collisions recurse. */
function resolve(items: Item[], maxChars: number, out: string[]): void {
    if (items.length === 1) {
        const it = items[0];
        out[it.idx] = shortenWords(it.ws.length ? it.ws : it.full, maxChars);
        return;
    }
    const prefix = commonWordPrefix(items.map(it => it.ws));
    if (prefix.length === 0) { assignDistinct(items, maxChars, out); return; }

    const lastPrefix = prefix[prefix.length - 1];
    const named = items.map(it => {
        const ws = it.ws.slice(prefix.length);
        let nm: string;
        if (ws.length === 0) nm = shortenWords(prefix, maxChars);          // bare-prefix label
        else {
            const suffix = ws.join(' ');
            nm = suffix.length <= 2
                ? clip(lastPrefix, maxChars - suffix.length) + suffix
                : shortenWords(ws, maxChars);
        }
        return { it: { idx: it.idx, ws, full: it.full }, nm };
    });
    const byName = new Map<string, typeof named>();
    for (const n of named) {
        const g = byName.get(n.nm);
        if (g) g.push(n); else byName.set(n.nm, [n]);
    }
    for (const [nm, arr] of byName) {
        if (arr.length === 1) out[arr[0].it.idx] = nm;
        else resolve(arr.map(n => n.it), maxChars, out);   // ws already stripped → shrinks each level
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
    result: string[], locked: boolean[], maxChars: number,
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
            cand = clip(result[i], maxChars - suf.length) + suf;
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
    maxChars: number,
): string[] {
    const locked = entries.map(e => !!(e && e.shortLabel));
    const result = entries.map(e =>
        e ? (e.shortLabel ? e.shortLabel.toUpperCase() : autoShorten(e.label, maxChars)) : '',
    );

    for (let pass = 0; pass < 3; pass++) {
        const groups = collisionGroups(entries, result, locked);
        if (groups.length === 0) break;
        for (const idxs of groups) {
            const items = idxs.map(i => {
                const w = wordsOf(entries[i]!.label);
                return { idx: i, ws: w, full: w };
            });
            resolve(items, maxChars, result);
        }
    }
    forceUnique(entries, result, locked, maxChars);
    return result;
}

export function enumSquareLines(value: string): [string, string] {
    const parts = value.toUpperCase().replace(/[_\-]/g, ' ').trim().split(/\s+/);
    if (parts.length >= 2) {
        return [parts[0].substring(0, 3), parts[1].substring(0, 3)];
    }
    const w = parts[0];
    return [w.substring(0, 3), w.substring(3, 6)];
}
