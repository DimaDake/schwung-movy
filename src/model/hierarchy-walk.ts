/* Level-graph walk for the generic (no movy config) param pages: turns a
 * module's ui_hierarchy levels into an ordered list of knob pages. Split out of
 * hierarchy.ts, which owns param metadata resolution. */

export interface WalkParam { key?: string; label?: string; level?: string; }
export interface WalkLevel {
    name?: string; label?: string;
    knobs?: (string | WalkParam)[];
    params?: (string | WalkParam)[];
    children?: string;
}

function toKey(k: string | WalkParam): string | null {
    return typeof k === 'string' ? k : (k.key ?? null);
}

export function knobKeys(lvl: WalkLevel | undefined): string[] {
    return (lvl?.knobs ?? []).map(toKey).filter((k): k is string => k !== null);
}

/* 6-char parent tag: one word → first 6 chars, multi-word → first 4 of word 1
 * plus the other words' initials ("Operator 1" → "Oper1"). Keeps "Mod/Pitch"
 * readable in the 128 px header, which also carries the module name. */
function levelNameToPrefix(name: string): string {
    const words = name.split(/\s+/).filter(Boolean);
    if (words.length === 0) return '';
    if (words.length === 1) return words[0].slice(0, 6);
    return (words[0].slice(0, 4) + words.slice(1).map(w => w[0].toUpperCase()).join('')).slice(0, 6);
}

export function buildLevelPages(
    allLevels: Record<string, WalkLevel>, rootKey: string,
): Array<{ name: string; keys: string[] }> {
    const out: Array<{ name: string; keys: string[] }> = [];
    const rootLevel = allLevels[rootKey];
    if (!rootLevel) return out;

    const hasNavEntries = (lvl: WalkLevel | undefined): boolean =>
        Array.isArray(lvl?.params) && lvl!.params!.some(
            p => typeof p === 'object' && (p as WalkParam).level != null);
    const navLevel: WalkLevel =
        hasNavEntries(rootLevel)
            ? rootLevel
            : (rootLevel.children ? (allLevels[rootLevel.children] ?? rootLevel) : rootLevel);

    const levelLabel: Record<string, string> = {};
    for (const p of (navLevel.params ?? [])) {
        if (typeof p === 'object' && p.level && p.label) levelLabel[p.level] = p.label;
    }

    const visited = new Set<string>();
    function addLevelOrExpand(levelKey: string, prefix: string | null, depth: number): void {
        if (depth > 2 || visited.has(levelKey)) return;
        visited.add(levelKey);
        const lvl = allLevels[levelKey];
        if (!lvl) return;
        const name  = lvl.name || levelLabel[levelKey] || levelKey;
        const label = prefix ? prefix + '/' + name : name;
        const keys  = knobKeys(lvl);
        if (keys.length > 0) {
            out.push({ name: label, keys });
        } else if (Array.isArray(lvl.params)) {
            const nextPrefix = levelNameToPrefix(name);
            for (const sub of lvl.params) {
                if (typeof sub !== 'object' || !sub.level) continue;
                addLevelOrExpand(sub.level, nextPrefix, depth + 1);
            }
        }
    }

    for (const entry of (navLevel.params ?? [])) {
        if (typeof entry !== 'object' || !entry.level) continue;
        addLevelOrExpand(entry.level, null, 0);
    }
    return out;
}
