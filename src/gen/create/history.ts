/* What New Clip offered lately (plans/2026-10-28-new-clip-design.md): a take
 * that comes out like one of these is passed over, so a run never offers the
 * same defaults as the last few, even on an unchanged Set. RAM only: a
 * restart forgets, which is fine — the nonce already differs. */

import type { Note } from '../types.js';

const RUNS = 3;
const past: Record<'drum' | 'melodic', Note[][][]> = { drum: [], melodic: [] };

const kind = (drum: boolean) => (drum ? 'drum' : 'melodic');

export function recentOptions(drum: boolean): Note[][] { return past[kind(drum)].flat(); }

export function rememberOptions(drum: boolean, options: Note[][]): void {
    const a = past[kind(drum)];
    a.push(options);
    if (a.length > RUNS) a.shift();
}

export function forgetOptions(): void { past.drum = []; past.melodic = []; }
