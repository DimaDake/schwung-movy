import type { KnobParam } from '../types/param.js';

export type EnvRole = 'a' | 'd' | 's' | 'r';
const ROLES: EnvRole[] = ['a', 'd', 's', 'r'];

/* Role keyword tables, matched whole-word, longest/most-specific first so
 * "attack" wins before the bare-letter pass. */
const ROLE_WORDS: Record<EnvRole, string[]> = {
    a: ['attack', 'atk', 'att'],
    d: ['decay', 'dcy', 'dec'],
    s: ['sustain', 'sus', 'sst'],
    r: ['release', 'rel', 'rls'],
};
const LETTER: Record<string, EnvRole> = { a: 'a', d: 'd', s: 's', r: 'r' };
/* Unit/suffix noise words that carry no envelope identity: "attack_ms",
 * "sustain_time" belong to the Amp group, not a group called "ms"/"time". */
const NOISE = new Set(['ms', 'time', 'sec']);
/* An env-cluster token ("env", "eg", "env1", "eg2") that licenses reading a
 * bare a/d/s/r letter as a role — without it, letters like phase_r/pan_r/load_a
 * would be misread as envelope stages. */
const isEnvToken = (w: string) => /^(env|eg)[0-9]*$/.test(w);

function words(text: string): string[] {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
}

/* Qualifier = the words left after removing the role word at index `skip` and
 * any unit-noise words. That remainder is the envelope's identity (e.g.
 * "f"/"filter"/"env1"); '' for an unqualified set. */
function qualifierFrom(ws: string[], skip: number): string {
    return ws.filter((w, j) => j !== skip && !NOISE.has(w)).join(' ');
}

/* Word/tag match → {role, qualifier}. */
function roleOf(p: KnobParam): { role: EnvRole; qualifier: string } | null {
    if (p.env) return { role: p.env, qualifier: '' };
    for (const text of [p.key, p.label]) {
        const ws = words(text);
        for (const role of ROLES) {
            for (const w of ROLE_WORDS[role]) {
                const i = ws.indexOf(w);
                if (i >= 0) return { role, qualifier: qualifierFrom(ws, i) };
            }
        }
        /* Bare a/d/s/r letter, but only when an env token names the cluster. */
        if (ws.some(isEnvToken)) {
            const j = ws.findIndex(w => LETTER[w] !== undefined);
            if (j >= 0) return { role: LETTER[ws[j]], qualifier: qualifierFrom(ws, j) };
        }
    }
    return null;
}

export interface EnvGroup { a: number; d: number; s: number; r: number; name: string }

function qualName(q: string): string {
    if (!q || q === 'amp' || q === 'vca') return 'Amp';
    if (q === 'f' || q === 'flt' || q === 'filter') return 'Filter';
    return q.charAt(0).toUpperCase() + q.slice(1);
}

/* Find every complete A/D/S/R group on a page (≤8 params). Word/tag matches
 * are grouped by qualifier; a single bare-letter group is added only when all
 * four letters a,d,s,r appear (the guard against false positives). */
export function detectEnvelopes(params: (KnobParam | null)[]): EnvGroup[] {
    const byQual = new Map<string, Partial<Record<EnvRole, number>>>();
    const claimed = new Set<number>();

    params.forEach((p, i) => {
        if (!p) return;
        const m = roleOf(p);
        if (!m) return;
        const g = byQual.get(m.qualifier) ?? {};
        if (g[m.role] === undefined) { g[m.role] = i; byQual.set(m.qualifier, g); claimed.add(i); }
    });

    const letters: Partial<Record<EnvRole, number>> = {};
    params.forEach((p, i) => {
        if (!p || claimed.has(i)) return;
        const k = words(p.key).join('');
        if (LETTER[k] && letters[LETTER[k]] === undefined) letters[LETTER[k]] = i;
    });
    if (ROLES.every(r => letters[r] !== undefined)) {
        const g = byQual.get('') ?? {};
        for (const r of ROLES) if (g[r] === undefined) g[r] = letters[r];
        byQual.set('', g);
    }

    const out: EnvGroup[] = [];
    for (const [qual, g] of byQual) {
        if (ROLES.every(r => g[r] !== undefined)) {
            out.push({ a: g.a!, d: g.d!, s: g.s!, r: g.r!, name: qualName(qual) });
        }
    }
    out.sort((x, y) => Math.min(x.a, x.d, x.s, x.r) - Math.min(y.a, y.d, y.s, y.r));
    return out;
}

export interface PageCell { line: 0 | 1; col: 0 | 1 | 2 | 3; idx: number }
export interface PageLayout { cells: PageCell[]; envelopes: { line: 0 | 1; name: string }[] }

/* Physical knob (screen slot 0..7, slot = line*4 + col) → page-relative param
 * index, honoring the envelope rearrange so a knob always drives the param shown
 * at its position. -1 for a slot that holds no param. Identity when no rearrange. */
export function pageSlotMap(params: (KnobParam | null)[]): number[] {
    const map = new Array(8).fill(-1);
    for (const c of planPageLayout(params).cells) map[c.line * 4 + c.col] = c.idx;
    return map;
}

/* Decide which knob line each envelope occupies and where the remaining params
 * sit. Each cell keeps its page-relative index (idx) so touch/value stay mapped
 * to the physical knob even when params are rearranged onto one line. */
export function planPageLayout(params: (KnobParam | null)[]): PageLayout {
    const envs = detectEnvelopes(params);
    const envCols: (number[] | null)[] = [null, null];
    const info: { line: 0 | 1; name: string }[] = [];
    const used = new Set<number>();
    const claimed = new Set<number>();

    for (const e of envs) {
        if (info.length >= 2) break;
        const desired = (Math.floor(Math.min(e.a, e.d, e.s, e.r) / 4)) as 0 | 1;
        const line: 0 | 1 = used.has(desired) ? ((desired ^ 1) as 0 | 1) : desired;
        if (used.has(line)) continue;
        used.add(line);
        envCols[line] = [e.a, e.d, e.s, e.r];
        info.push({ line, name: e.name });
        for (const i of [e.a, e.d, e.s, e.r]) claimed.add(i);
    }

    const leftover: number[] = [];
    params.forEach((p, i) => { if (p && !claimed.has(i)) leftover.push(i); });

    const cells: PageCell[] = [];
    let li = 0;
    for (let line = 0 as 0 | 1; line <= 1; line = (line + 1) as 0 | 1) {
        if (envCols[line]) {
            envCols[line]!.forEach((idx, col) => cells.push({ line, col: col as 0 | 1 | 2 | 3, idx }));
        } else {
            for (let col = 0; col <= 3 && li < leftover.length; col++) {
                cells.push({ line, col: col as 0 | 1 | 2 | 3, idx: leftover[li++] });
            }
        }
        if (line === 1) break;
    }
    return { cells, envelopes: info };
}
