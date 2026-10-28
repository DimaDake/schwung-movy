/* FORM (design 2026-10-28 §5): the part laid out as a phrase — A is the
 * source's first unit, B (and C) an answer to it — by a song form or an
 * L-system. Melodic parts are realised over the plan like every option. */

import { type Kit, padFor } from '../analysis/kit.js';
import { strength } from '../analysis/events.js';
import { custom, K } from '../knobs.js';
import type { Preset } from '../preset.js';
import { type Rng, rng } from '../rng.js';
import { defaultUnit, FORMS, formString, layout, UNIT_NAMES, UNITS, unitOf, unitsFor } from '../shape/form.js';
import { dynamics } from '../shape/dynamics.js';
import { drumWalk } from '../style/drums.js';
import { walk } from '../style/melodic.js';
import { degreeIndex, stepScale } from '../theory/pc.js';
import { type Ev, type Note, TPS } from '../types.js';
import { finish, over, partEvs } from './helpers.js';

const ANSWERS = ['SOURCE', 'SEQUENCE', 'INVERT', 'DISPLACE', 'NEW'] as const;
const STEPS = [-3, -2, -1, 1, 2, 3, 4];
const D_ANSWERS = ['FILL', 'STYLE', 'SPARSE', 'SOURCE'] as const;

const clone = (evs: Ev[]): Ev[] => evs.map((e) => ({ tick: e.tick, voices: e.voices.map((v) => ({ ...v })) }));
const sig = (xs: (Ev | Note)[]) =>
    xs.map((x) => `${Math.round(x.tick / TPS)}:${'pitch' in x ? x.pitch : x.voices.map((v) => v.pitch).join('.')}`).join(',');
const unitKnob = () => ({ ...custom('UNIT', UNIT_NAMES), steps: (c: { end: number }) => unitsFor(c.end), def: (c: { end: number }) => defaultUnit(c.end) });

function answer(ctx: Parameters<Preset['generate']>[0], kind: number, A: Ev[], k: number, unit: number, step: number, r: Rng): Ev[] {
    const src = partEvs(ctx);
    const name = ANSWERS[kind % ANSWERS.length];
    if (name === 'SOURCE') { const u = unitOf(src, k, unit); if (u.length && sig(u) !== sig(A)) return clone(u); }
    if (name === 'INVERT') {
        const first = A[0].voices[A[0].voices.length - 1].pitch;
        const d0 = degreeIndex(first, ctx.key);
        return A.map((e) => ({ tick: e.tick, voices: e.voices.map((v) => ({ ...v, pitch: stepScale(first, d0 - degreeIndex(v.pitch, ctx.key), ctx.key) })) }));
    }
    if (name === 'DISPLACE') return clone(A).map((e) => ({ ...e, tick: (e.tick + 2 * TPS) % unit })).sort((a, b) => a.tick - b.tick);
    if (name === 'NEW') return walk(ctx, src, 3, 5, unit, r).filter((e) => e.tick < unit);
    return A.map((e) => ({ tick: e.tick, voices: e.voices.map((v) => ({ ...v, pitch: stepScale(v.pitch, step, ctx.key) })) }));
}

export const FORM: Preset = {
    id: 'v-form', name: 'FORM', task: 'variation', drum: false, cls: 'exp', roles: ['lead', 'arpeggio', 'bass', 'pad', 'stabs'],
    fit: () => 0.55,
    knobs: [custom('FORM', FORMS, 0), unitKnob(),
        custom('ANSWER', ANSWERS, 1), custom('STEP', STEPS.map((s) => (s > 0 ? '+' : '') + s), 4), K.harmony(1), K.tension(4), K.range(5), K.length(5)],
    generate: (ctx, v, seed) => {
        const r = rng(seed);
        const unit = UNITS[v[1]];
        const src = partEvs(ctx);
        const A = unitOf(src, 0, unit);
        if (!A.length) return [];
        const n = Math.ceil(ctx.end / unit);
        const memo = new Map<string, Ev[]>();
        const out = layout(formString(FORMS[v[0]], n), unit, ctx.end, (letter, k) => {
            if (letter === 'A') return clone(A);
            /* An answer is made once per letter, so B is the same B each time;
             * SOURCE answers with what the source plays at each place. */
            const key = ANSWERS[v[2]] === 'SOURCE' ? letter + k : letter;
            if (!memo.has(key)) memo.set(key, answer(ctx, v[2] + (letter === 'C' ? 1 : 0), A, k, unit, STEPS[v[3]], r));
            return clone(memo.get(key)!);
        });
        return finish(ctx, over(ctx, out, { h: v[4], tension: v[5], range: v[6], r, pull: 0.2 }), { length: v[7] }, r);
    },
};

function drumAnswer(ctx: Parameters<Preset['generate']>[0], kit: Kit, kind: number, A: Note[], k: number, unit: number, r: Rng): Note[] {
    const name = D_ANSWERS[kind % D_ANSWERS.length];
    if (name === 'SOURCE') { const u = unitOf(ctx.src, k, unit); if (u.length && sig(u) !== sig(A)) return u; }
    if (name === 'STYLE') return drumWalk(ctx, 3, 5, unit, r).filter((n) => n.tick < unit);
    if (name === 'SPARSE') {
        const thin = new Set([...kit.by.hat, ...kit.by.open, ...kit.by.cym]);
        return A.filter((n) => !thin.has(n.pitch) && (n.pitch !== padFor(kit, 'kick', A) || strength(n.tick) >= 0.85));
    }
    /* FILL: the last quarter of the unit on snare and toms, rising. */
    const from = unit - Math.max(4 * TPS, unit / 4);
    const pads = [padFor(kit, 'snare', ctx.src), ...kit.by.tom].filter((p): p is number => p !== null);
    if (!pads.length) return A;
    const steps = Math.round((unit - from) / TPS);
    return [...A.filter((n) => n.tick < from), ...Array.from({ length: steps }, (_, s) => ({ tick: from + s * TPS, gate: TPS / 2,
        pitch: pads[Math.min(pads.length - 1, Math.floor((s / steps) * pads.length))], vel: Math.round(70 + 45 * (s / Math.max(1, steps - 1))) }))];
}

export const FORM_D: Preset = {
    id: 'd-form', name: 'FORM', task: 'variation', drum: true, cls: 'exp', fit: () => 0.55,
    knobs: [custom('FORM', FORMS, 2), unitKnob(), custom('ANSWER', D_ANSWERS, 0), K.dynamics(0)],
    generate: (ctx, v, seed) => {
        const r = rng(seed);
        const unit = UNITS[v[1]];
        const A = unitOf(ctx.src, 0, unit);
        if (!A.length) return [];
        const memo = new Map<string, Note[]>();
        return dynamics(layout(formString(FORMS[v[0]], Math.ceil(ctx.end / unit)), unit, ctx.end, (letter, k) => {
            if (letter === 'A') return A;
            const key = D_ANSWERS[v[2]] === 'SOURCE' ? letter + k : letter;
            if (!memo.has(key)) memo.set(key, drumAnswer(ctx, ctx.kit!, v[2] + (letter === 'C' ? 1 : 0), A, k, unit, r));
            return memo.get(key)!;
        }), v[3]);
    },
};
