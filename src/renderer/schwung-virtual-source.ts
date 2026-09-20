/* schwung-virtual-source.ts — a PageParamSource for a component with no
 * module behind it (SP-53's virtual-component seam: Set Params, Clip Params,
 * and the step page's held-trig contract after it).
 *
 * Builds BOTH halves of the contract movy already writes for a real module
 * (`ui_hierarchy`, `chain_params` — *The injection surface* §2) from one flat
 * cell table, and answers every read/write out of it. CONFIG-FIRST BY
 * CONSTRUCTION: there is no DSP behind a virtual component to cross-check a
 * range against, so this table is the only place a min/max/option list is
 * declared, and getting it wrong looks exactly like the real-module version
 * of that bug (`project_config-range-drift-audit`) — `commitEnum`/
 * `onKnobTurn` clamp to whatever this reports, silently.
 *
 * Recomputed on every ask, not cached: a virtual page's whole state is a
 * handful of field reads (cheaper than the string-compare a cache would cost
 * to decide staleness), and a cell whose OPTIONS depend on another cell's
 * current value (Set Params' LAYOUT, gated on MODE) needs a live read to ever
 * see the new list — the next re-plan picks it up, same delay any other
 * module's changed contract already tolerates.
 */

import type { PageParamSource } from './schwung-page-source.js';

export interface VirtualCellSpec {
    /** Bare key — what the contract's `knobs` array names and what every
     *  read/write arrives as once the component prefix is stripped. */
    key: string;
    name: string;
    type: 'int' | 'float' | 'enum' | 'toggle';
    min?: number;
    max?: number;
    step?: number;
    /** Index-addressed, matching movy's own convention (`quantIndexForPct`,
     *  `rationalToIdx`) so an enum's wire value never needs a second
     *  translation between "movy's index" and "the wire's index". */
    options?: readonly string[];
    /** Current value as the wire wants it — an int, or an enum's index, as a
     *  decimal string. */
    get(): string;
    /** The ABSOLUTE value Schwung computed (never a delta: the detent-to-step
     *  math is this cell's own `step`/`options`, resolved one layer up in
     *  Schwung's controller, not here). */
    set(value: string): void;
    /** Overrides the PRINTED text only, never the arc/position — SP-53's
     *  "n/a on a drum track" / "120 EXT" case. Absent or a null return falls
     *  through to Schwung's own formatting. */
    format?(raw: string | null, surface: 'cell' | 'header'): string | null;
}

const HIER_KEY = 'ui_hierarchy';
const PARAMS_KEY = 'chain_params';

export function createVirtualSource(componentKey: string,
                                    cells: readonly VirtualCellSpec[]): PageParamSource {
    const prefix = componentKey + ':';
    const bare = (k: string): string => (k.startsWith(prefix) ? k.slice(prefix.length) : k);
    const byKey = new Map(cells.map((c) => [c.key, c] as const));

    function hierarchyJson(): string {
        return JSON.stringify({ levels: { root: { knobs: cells.map((c) => c.key) } } });
    }

    /* An ARRAY of `{key, ...}` — same shape as a module's own `chain_params` —
     * never a keyed object. `param_meta.mjs`'s `buildMetaIndex` iterates it
     * with `for (const p of (chainParams || []))` and reads `p.key`; a keyed
     * object is not iterable at all and throws inside the planner before a
     * single cell ever draws. */
    function chainParamsJson(): string {
        const out = cells.map((c) => {
            const entry: Record<string, unknown> = { key: c.key, name: c.name, type: c.type };
            if (c.type === 'enum') entry.options = c.options ?? [];
            else {
                if (c.min !== undefined) entry.min = c.min;
                if (c.max !== undefined) entry.max = c.max;
                if (c.step !== undefined) entry.step = c.step;
            }
            return entry;
        });
        return JSON.stringify(out);
    }

    return {
        bulkReads: false,
        getParam(k: string): string | null {
            const b = bare(k);
            if (b === HIER_KEY) return hierarchyJson();
            if (b === PARAMS_KEY) return chainParamsJson();
            return byKey.get(b)?.get() ?? null;
        },
        setParam(k: string, v: string): boolean {
            const c = byKey.get(bare(k));
            if (!c) return false;
            c.set(v);
            return true;
        },
        formatValue(fullKey: string, raw: string | null, surface: 'cell' | 'header'): string | null {
            const c = byKey.get(bare(fullKey));
            return c?.format ? c.format(raw, surface) : null;
        },
    };
}
