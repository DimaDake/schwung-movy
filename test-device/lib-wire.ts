/* The Set library's `lib` answer, as the scenarios read it.
 *
 * sets-lib.ts:parseLib's wire, restated rather than imported: the harness
 * compiles apart from src/. Read through UI_EVAL, not engineGet — the bus's GET
 * answers one LINE, and the library's answer is a header and one line per Set. */

import type { HostBus } from './transport.js';

export type LibRow = { id: string; name: string };
export type Lib = { cur: string; made: string; mig: number; rows: LibRow[] };

const EMPTY: Lib = { cur: '', made: '', mig: 0, rows: [] };

export function parseLib(raw: string): Lib | null {
    if (!raw) return null;
    const [head, ...lines] = raw.split('\n');
    const f: Record<string, string> = {};
    for (const tok of head.split(' ')) { const i = tok.indexOf('='); if (i > 0) f[tok.slice(0, i)] = tok.slice(i + 1); }
    if (!(parseInt(f.rev, 10) > 0)) return null;
    const dash = (v?: string) => (!v || v === '-' ? '' : v);
    const rows = lines.map((l) => l.split('\t')).filter((t) => t.length >= 4 && t[0])
        .map((t) => ({ id: t[0], name: t.slice(3).join('\t') }));
    return { cur: dash(f.cur), made: dash(f.made), mig: parseInt(f.mig, 10) || 0, rows };
}

/** The library's answer now, or an empty one while it has none. */
export async function readLib(hb: HostBus): Promise<Lib> {
    return parseLib(String(await hb.uiEval(`host_module_get_param('lib') ?? ''`).catch(() => ''))) ?? EMPTY;
}
