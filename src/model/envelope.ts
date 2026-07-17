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
/* Words that make a param a curve/mode control, not a time/level stage:
 * "Attack Shape", "Envelope Mode" must not join the ADSR group (surge). */
const VETO = new Set(['shape', 'curve', 'mode', 'slope']);
/* An LFO-cluster token. An LFO's own DAHDSR segments (surge lfoN_attack/decay/
 * sustain/release) are a modulator shape, not a synth amplitude envelope, and
 * are out of scope for the envelope graphic — never group them. */
const isLfoToken = (w: string) => /^lfo[0-9]*$/.test(w);

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
        if (ws.some(w => VETO.has(w) || isLfoToken(w))) continue;   // curve/mode/LFO, not a stage
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

/* a is always present; d/s/r optional so partial envelopes (AD/AR/ASR/ADS) can
 * be emitted. `roles` lists the present stages in a,d,s,r order — the renderer
 * uses it to choose the vertex shape. */
export interface EnvGroup {
    a: number; d?: number; s?: number; r?: number;
    roles: EnvRole[]; name: string;
}
const minIdx = (g: EnvGroup): number => Math.min(...g.roles.map(r => g[r] as number));

function qualName(q: string): string {
    if (!q || q === 'amp' || q === 'vca') return 'Amp';
    if (q === 'f' || q === 'flt' || q === 'filter') return 'Filter';
    return q.charAt(0).toUpperCase() + q.slice(1);
}

/* Find every A/D/S/R group on a page (≤8 params). Word/tag matches are grouped
 * by qualifier and emitted when they hold ≥2 stages including attack (AD/AR/
 * ASR/ADS/… up to full ADSR). A pure bare-letter group is merged into '' only
 * when all four letters a,d,s,r appear (the guard against false positives). */
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
        const roles = ROLES.filter(r => g[r] !== undefined);
        if (!roles.includes('a') || roles.length < 2) continue;
        out.push({ a: g.a!, d: g.d, s: g.s, r: g.r, roles, name: qualName(qual) });
    }
    out.sort((x, y) => minIdx(x) - minIdx(y));
    return out;
}

// Page layout planning (envelope + LFO cell arrangement) lives in page-layout.ts.
