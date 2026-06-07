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

export function enumSquareLines(value: string): [string, string] {
    const parts = value.toUpperCase().replace(/[_\-]/g, ' ').trim().split(/\s+/);
    if (parts.length >= 2) {
        return [parts[0].substring(0, 3), parts[1].substring(0, 3)];
    }
    const w = parts[0];
    return [w.substring(0, 3), w.substring(3, 6)];
}
