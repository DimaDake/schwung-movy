/* schwung-page-visible.ts — the `visible_if` answer for a MODULE's pages.
 *
 * The planner asks `load({visible})` whether each gated level and cell applies,
 * and with no hook it FAILS OPEN: every conditional page shows. Schwung's own
 * grid supplies one (shadow_ui.js `evaluateVisibilityCondition`); movy supplied
 * one only for its LFO source, so a module's gated pages all showed. DR32 gates
 * one block of pages per drum engine on `ui_engine` — 52 pages in movy against
 * the 8 Schwung shows for a sample pad. Any module gating a level or a cell
 * (mrsample's loop, a send that is a reverb OR a delay) paid the same way.
 *
 * Schwung's rules, restated because they live in shadow_ui.js, which is not a
 * library movy can import:
 *   - the condition key is the level's PER-INSTANCE key only when the level
 *     lists it (hierChildKeyFor); DR32's `ui_engine` is listed nowhere and is
 *     read bare — expanding it reads a key nothing serves;
 *   - the controller's own values answer first (they carry every write it made
 *     and the gate lane's reads, which is what re-plans on a change), then the
 *     page's read cache;
 *   - an unanswered key fails OPEN — never hide what was never read.
 * movy also fails open on "": the chain host answers "" for a key it does not
 * know, and Schwung's controller notes a gate cached that way hid DR32's engine
 * pages for good.
 */

type Cond = Record<string, unknown>;

function asBool(v: unknown): boolean {
    if (v === true || v === 1) return true;
    if (v === false || v === 0 || v === null || v === undefined) return false;
    const s = String(v).trim().toLowerCase();
    return s === '1' || s === 'true' || s === 'on' || s === 'yes';
}

function same(actual: string, expected: unknown): boolean {
    if (typeof expected === 'boolean') return asBool(actual) === expected;
    if (typeof expected === 'number') {
        const n = Number(actual);
        return Number.isFinite(n) && n === expected;
    }
    return actual === String(expected);
}

function threshold(c: Cond, ...names: string[]): number | null {
    for (const n of names) if (c[n] !== undefined) {
        const t = Number(c[n]);
        return Number.isFinite(t) ? t : NaN;
    }
    return null;
}

/** Does `c` hold for `raw`? Schwung's operator set, in Schwung's order. */
export function conditionHoldsFor(c: Cond, raw: string): boolean {
    if (c.equals !== undefined) return same(raw, c.equals);
    if (c.not_equals !== undefined) return !same(raw, c.not_equals);
    const num = Number(raw);
    const gt = threshold(c, 'gt', 'greater_than', 'greater');
    if (gt !== null) return Number.isFinite(num) && num > gt;
    const lt = threshold(c, 'lt', 'smaller_than', 'smaller');
    if (lt !== null) return Number.isFinite(num) && num < lt;
    if (c.truthy !== undefined) return asBool(c.truthy) ? asBool(raw) : !asBool(raw);
    const f = c.falsey !== undefined ? c.falsey : c.falsy;
    if (f !== undefined) return asBool(f) ? !asBool(raw) : asBool(raw);
    return asBool(raw);
}

const listedOn = (lvl: any, key: string): boolean => {
    const hit = (k: any) => (typeof k === 'string' ? k : (k && k.key)) === key;
    return !!lvl && ((lvl.knobs || []).some(hit) || (lvl.params || []).some(hit));
};

export function createPageVisible(ctl: any, lib: any, read: (fullKey: string) => string | null,
                                  qualify: (k: string) => string) {
    /* The wire key, resolved the way Schwung's evaluator resolves it. */
    function wireKey(lvl: any, key: string): string {
        if (key.indexOf(':') >= 0) return key;
        if (!listedOn(lvl, key) || typeof lib.resolveChildKey !== 'function'
            || typeof lib.childIndexParam !== 'function') return qualify(key);
        const cip = lib.childIndexParam(lvl);
        const at = cip ? lib.childIndexFromWire(lvl, read(qualify(cip))) : null;
        return qualify(at === null ? key : (lib.resolveChildKey(lvl, at, key) || key));
    }

    return function visible(cond: unknown, lvl?: unknown): boolean {
        if (!cond || typeof cond !== 'object') return true;
        const c = cond as Cond;
        const key = String(c.param || c.key || c.param_key || '');
        if (!key) return true;
        const vals = ctl.state && ctl.state.values;
        let raw: unknown = vals ? vals[key] : undefined;
        if (raw === undefined || raw === null) raw = read(wireKey(lvl, key));
        if (raw === undefined || raw === null || raw === '') return true;
        return conditionHoldsFor(c, String(raw));
    };
}

/* Re-ask the gates after a change the controller cannot see: a canvas dive
 * that swapped the pad's engine writes no grid key and no contract byte, and
 * the controller marks gates due only on a live press or its own focus move.
 * Upstream has no public verb for it (wanted: `selectionChanged` doing this
 * too), so this sets the controller's own flag — guarded, so a Schwung that
 * renames it costs a re-plan delay, never a throw. */
export function markGatesDue(ctl: any): void {
    const s = ctl && ctl.state;
    if (s && 'gatesDue' in s && s.conditionKeys && s.conditionKeys.size) s.gatesDue = true;
}
