/* child-keys.ts — which child-level template a concrete key instantiates.
 *
 * A template rack (simian, dr32, sophie) declares one child level whose knobs
 * are TEMPLATES (`start`) and lets Schwung resolve them per instance
 * (`pad16_start`). An automation lane binds the concrete key — the template
 * would play into whichever pad has focus (plan 2026-09-30, C1) — and when a
 * Set is loaded the label sync must still recognise that key. movy's model
 * lists the template only, so without this the sync judged pad 16's lane stale
 * and purged it (C4).
 *
 * THE RESOLVER IS PUSHED IN, NOT IMPORTED, for the reason `drum-declared.ts`
 * gives: resolving is Schwung's `child_key.mjs`, which lives behind
 * `renderer/schwung-lib`, and `model/` imports nothing from `renderer/`. With
 * no resolver registered every answer is null — the sync falls back to the
 * key itself, which is what it did before.
 */

type Resolve = (level: any, i: number, key: string) => string | null;
type Count = (level: any) => number;
let resolve: Resolve | null = null;
let count: Count | null = null;

export function setChildKeyResolver(r: Resolve | null, c: Count | null): void {
    resolve = r; count = c;
}

/** The levels of a declared hierarchy that repeat per instance. */
export function childLevelsOf(levels: Record<string, any> | null | undefined): any[] {
    if (!count || !levels) return [];
    const out: any[] = [];
    for (const lvl of Object.values(levels)) {
        try { if (count(lvl) > 0) out.push(lvl); } catch (_e) { /* malformed: not a child level */ }
    }
    return out;
}

/* A level's own keys in the order `childKeysFor` walks them: knobs, then
 * params that are not level links. */
function keysOfLevel(lvl: any): string[] {
    const out: string[] = [];
    const take = (e: any) => {
        const k = typeof e === 'string' ? e : (e && !e.level ? e.key : null);
        if (typeof k === 'string' && k) out.push(k);
    };
    for (const e of (lvl.knobs || [])) take(e);
    for (const e of (lvl.params || [])) take(e);
    return out;
}

/** The template `key` is an instance of, or null when no child level
 *  resolves any of its keys to it. */
export function childTemplateOf(levels: readonly any[], key: string): string | null {
    if (!resolve || !count) return null;
    for (const lvl of levels) {
        const n = count(lvl);
        for (const t of keysOfLevel(lvl)) {
            for (let i = 0; i < n; i++) {
                const c = resolve(lvl, i, t);
                if (c === key && c !== t) return t;
            }
        }
    }
    return null;
}

/** Every key a module declares: its chain_params, and each level's knobs and
 *  params. The test the label sync applies to a lane on a key no movy page
 *  shows. */
export function declaredKeysOf(chainParams: readonly string[],
                               levels: Record<string, any> | null | undefined): Set<string> {
    const out = new Set<string>(chainParams);
    for (const lvl of Object.values(levels ?? {})) {
        if (lvl && typeof lvl === 'object') for (const k of keysOfLevel(lvl)) out.add(k);
    }
    return out;
}
