/* The UI's half of movy's Set library: the wire to the engine, and name policy.
 *
 * The engine owns the index and every file (set_library.rs); this side sends
 * `set lib …` commands, reads the `lib` answer, and decides what new Sets are
 * CALLED — the same split copy-on-inherit already has, where naming is policy
 * and moving bytes is the engine's.
 *
 * The answer is read only when somebody needs it (the Sets page, or a command
 * in flight) and parsed only when its text changed, so an open page costs one
 * string read every few ticks and nothing per frame. */

import { paramGet, paramSet } from '../host/param.js';
import { PAGE_ROOTS } from './set-gc.js';
import { LEGACY_SETS_DIR } from './set-source.js';
import { MOVE_SETS_DIR } from './set-context.js';

export interface LibRow { id: string; clips: number; depth: number; name: string; }
export interface LibState { rev: number; cur: string; made: string; err: string; rows: LibRow[]; }

/* set_library.rs NAME_MAX — the engine cuts there anyway; cutting here too
 * keeps a duplicate's " Copy" from being the part that falls off. */
export const NAME_MAX = 48;

const dash = (v: string | undefined): string => (!v || v === '-' ? '' : v);

/** `rev=… cur=… made=… err=…` then `id\tclips\tdepth\tname` rows. */
export function parseLib(raw: string | null): LibState | null {
    if (!raw) return null;
    const lines = raw.split('\n');
    const head: Record<string, string> = {};
    for (const tok of lines[0].split(' ')) {
        const i = tok.indexOf('=');
        if (i > 0) head[tok.slice(0, i)] = tok.slice(i + 1);
    }
    const rev = parseInt(head.rev, 10);
    if (!(rev > 0)) return null;
    const rows: LibRow[] = [];
    for (const line of lines.slice(1)) {
        const t = line.split('\t');
        if (t.length < 4 || !t[0]) continue;
        rows.push({ id: t[0], clips: parseInt(t[1], 10) || 0, depth: parseInt(t[2], 10) || 0,
                    name: t.slice(3).join('\t') });
    }
    return { rev, cur: dash(head.cur), made: dash(head.made), err: dash(head.err), rows };
}

let raw = '';
let state: LibState | null = null;

export function libState(): LibState | null { return state; }

/** Re-read the answer; true when it changed. */
export function libRefresh(): boolean {
    const s = paramGet('lib');
    if (s === null || s === raw) return false;
    raw = s;
    state = parseLib(s);
    return true;
}

export function libSend(cmd: string): void { paramSet('set', 'lib ' + cmd, 200); }

/** A fresh engine (or a fresh session) knows nothing — forget its old answer. */
export function resetLib(): void { raw = ''; state = null; }

export function libImportCmd(): string {
    return 'import legacy=' + LEGACY_SETS_DIR + ' move=' + MOVE_SETS_DIR
         + ' pages=' + PAGE_ROOTS.join(',');
}

const pad2 = (n: number): string => (n < 10 ? '0' : '') + n;

/** `YYYY-MM-DD_NN`: local date, NN one past the highest suffix used today.
 *  Highest, not count: deleting today's _01 must not mint a second _02. */
export function defaultSetName(now: Date, rows: LibRow[]): string {
    const day = now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate());
    let top = 0;
    for (const r of rows) {
        if (!r.name.startsWith(day + '_')) continue;
        const n = parseInt(r.name.slice(day.length + 1), 10);
        if (n > top) top = n;
    }
    return day + '_' + pad2(top + 1);
}

/** Move's own convention for a copy. The source name gives way, never the
 *  suffix: two copies that both read "Long name th…" are indistinguishable. */
export function dupName(name: string): string {
    const tail = ' Copy';
    return name.slice(0, NAME_MAX - tail.length).trimEnd() + tail;
}
