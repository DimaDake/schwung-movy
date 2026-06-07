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

function commonWordPrefix(labels: string[]): string {
    if (labels.length < 2) return '';
    const wordArrays = labels.map(l => normalizeLabel(l).split(/\s+/));
    let n = 0;
    for (let wi = 0; wi < wordArrays[0].length; wi++) {
        if (wordArrays.every(ws => ws[wi] === wordArrays[0][wi])) n = wi + 1;
        else break;
    }
    return n > 0 ? wordArrays[0].slice(0, n).join(' ') + ' ' : '';
}

/** Compute shortNames for a page of knobs, stripping shared word-prefixes from
 *  auto-generated names that would otherwise collide (e.g. "LFO Rate", "LFO Shape" → "RATE", "SHAPE"). */
export function dedupShortNames(
    entries: Array<{ label: string; shortLabel: string | null } | null>,
    maxChars: number,
): string[] {
    const result = entries.map(e =>
        e ? (e.shortLabel ? e.shortLabel.toUpperCase() : autoShorten(e.label, maxChars)) : ''
    );

    const groups = new Map<string, number[]>();
    entries.forEach((e, i) => {
        if (!e) return;
        const s = result[i];
        if (!groups.has(s)) groups.set(s, []);
        groups.get(s)!.push(i);
    });

    for (const [, idxs] of groups) {
        if (idxs.length < 2) continue;
        if (idxs.some(i => !!entries[i]!.shortLabel)) continue; // respect explicit labels
        const labels = idxs.map(i => entries[i]!.label);
        const prefix = commonWordPrefix(labels);
        if (!prefix) continue;
        for (const i of idxs) {
            const suffix = normalizeLabel(entries[i]!.label).slice(prefix.length).trim();
            if (suffix.length > 0) result[i] = autoShorten(suffix, maxChars);
        }
    }

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
