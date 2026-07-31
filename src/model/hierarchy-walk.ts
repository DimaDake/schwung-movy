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

/* The level's params[] entries that name a param (nav entries carry `level`
 * instead). This is the module's own list view — what the native UI shows and
 * what movy renders after the knob row. */
export function paramKeys(lvl: WalkLevel | undefined): string[] {
    return (lvl?.params ?? [])
        .map(p => (typeof p === 'string' ? p : p.key ?? null))
        .filter((k): k is string => k !== null);
}

export interface WalkOptions {
    /* params[]-only keys to append to a level's knob row. hierarchy.ts owns the
     * filtering (dedupe, preset list key, ui_*, degenerate ranges) because only
     * it holds chain_params metadata. Called at most once per level so the
     * caller's running dedupe stays sound. */
    extras?: (lvl: WalkLevel) => string[];
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

/* `children` is absent as null, missing, or the literal string "None" (dexed
 * serialises it that way). */
function childOf(lvl: WalkLevel): string | null {
    const c = lvl.children;
    return (c && c !== 'None') ? c : null;
}

export function buildLevelPages(
    allLevels: Record<string, WalkLevel>, rootKey: string, opts: WalkOptions = {},
): Array<{ name: string; keys: string[] }> {
    const out: Array<{ name: string; keys: string[] }> = [];
    const rootLevel = allLevels[rootKey];
    if (!rootLevel) return out;

    /* A level's display name is usually carried by the nav entry that points at
     * it, not by the level itself, so collect labels from EVERY level's nav
     * entries. Nav label beats the level's own `label` because that is the name
     * movy has always shown (24 levels in the module fleet disagree between the
     * two — dexed's op1_eg is "Envelope" under an "Oper1" prefix, not "Op1
     * Envelope"). */
    const navLabel: Record<string, string> = {};
    for (const lvl of Object.values(allLevels)) {
        for (const p of (lvl.params ?? [])) {
            if (typeof p === 'object' && p.level && p.label) navLabel[p.level] = p.label;
        }
    }
    const nameOf = (key: string, lvl: WalkLevel): string =>
        lvl.name || navLabel[key] || lvl.label || key;

    /* Pages are deduped by their exact knob key-list: modules routinely publish
     * a `children` level that re-lists root's knobs (16 in the fleet), which
     * would otherwise render as a second identical page. No module has two
     * genuinely different pages sharing a key list. */
    const rendered = new Set<string>([knobKeys(rootLevel).join(' ')]);
    const visited  = new Set<string>([rootKey]);

    /* `transparent` marks a level reached through a `children` edge: it stands
     * in for its parent's menu rather than being a category of its own, so it
     * neither introduces nor consumes a name prefix — without this, every moog
     * page would read "main/Oscillator 1". A `params` nav edge does introduce
     * one, which is what keeps sibling pages apart ("Tone 1/Filter"). */
    function visit(key: string, prefix: string | null, transparent: boolean): void {
        if (visited.has(key)) return;
        visited.add(key);
        const lvl = allLevels[key];
        if (!lvl) return;

        const name = nameOf(key, lvl);
        const keys = knobKeys(lvl);
        const sig  = keys.join(' ');
        /* A `children` level that re-lists its parent's knobs is a duplicate
         * page — but it can still own params[] entries nothing else consumed,
         * so ask for extras either way and render them alone when the knob row
         * is the duplicate. */
        const dup      = keys.length > 0 && rendered.has(sig);
        const extras   = opts.extras ? opts.extras(lvl) : [];
        const pageKeys = dup ? extras : [...keys, ...extras];
        if (pageKeys.length > 0) {
            if (!dup) rendered.add(sig);
            out.push({ name: prefix ? prefix + '/' + name : name, keys: pageKeys });
        }

        /* Both edges, always: a level that has knobs can still own sub-levels
         * (dexed's Operators, forge's Voice). */
        const childPrefix = transparent ? prefix : levelNameToPrefix(name);
        for (const p of (lvl.params ?? [])) {
            if (typeof p === 'object' && p.level) visit(p.level, childPrefix, false);
        }
        const child = childOf(lvl);
        if (child) visit(child, prefix, true);
    }

    for (const p of (rootLevel.params ?? [])) {
        if (typeof p === 'object' && p.level) visit(p.level, null, false);
    }
    const rootChild = childOf(rootLevel);
    if (rootChild) visit(rootChild, null, true);

    /* Levels no edge reaches (minijv's performance/part pages) would otherwise
     * be permanently invisible; sweeping them in keeps "every declared knob is
     * reachable" true for every module. */
    for (const key of Object.keys(allLevels)) {
        if (!visited.has(key) && knobKeys(allLevels[key]).length > 0) visit(key, null, false);
    }
    return out;
}
