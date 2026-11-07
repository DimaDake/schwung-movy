/* The target harmony for each HARMONY position (design §2). Locked: the
 * other tracks' chords, and the knob says how the part sits on them. Free:
 * the moves from the source's progression. Partial: the moves that tolerate
 * what the others pin, plus the closest diatonic fits around it. */

import type { GenCtx, Prog } from './analysis/context.js';
import { targetHalves } from './analysis/context.js';
import type { Chord, HarmonyPlan, Sit } from './types.js';
import { colourPcs } from './theory/category.js';
import { harmonicMoves, tolerates } from './theory/moves.js';
import { degreeOf, diatonic } from './theory/roman.js';
import { holds, withChanges } from './theory/changes.js';
import { createPlans } from './create/plans.js';
import { chordsLabel } from './theory/chord-label.js';
import { type Laid, progId, sectionsOver } from './theory/sections.js';

const SITS: [Sit, string][] = [['asis', 'AS PLAYED'], ['roots', 'ROOTS'], ['inv', 'INVERSION'], ['7th', '7TH'], ['9th', '9TH']];

/** `n` half-bars of a progression, looping; a scene's 16th reading goes with it. */
export const sample = (a: Prog, n: number): Prog => {
    const out: Prog = Array.from({ length: n }, (_, i) => (a.length ? a[i % a.length] : null));
    if (a.fine) out.fine = a.fine;
    return out;
};

export function fits(ctx: GenCtx, base: (Chord | null)[], rank: number): (Chord | null)[] {
    const col = (c: Chord) => colourPcs(c, ctx.key);
    const pinsAt = (i: number) => (ctx.pinned.length ? ctx.pinned[i % ctx.pinned.length] : []);
    const bassAt = (i: number) => ctx.pinnedBass[i % Math.max(1, ctx.pinnedBass.length)];
    /** The diatonic chord that best holds `pins`, or null when none does. */
    const fit = (b: Chord | null, pins: number[], bass: number | undefined): Chord | null => {
        const cands = Array.from({ length: 7 }, (_, d) => diatonic(ctx.key, d)).filter((c) => tolerates(c, pins, col));
        if (!cands.length) return null;
        /* A pinned bass note is most often the root: a bass alone in the
         * scene is what tells the chords where to go. */
        const score = (c: Chord) => (pins.every((p) => c.pcs.includes(p)) ? 0 : 2)
            + (bass !== undefined && bass >= 0 && c.root === bass ? -4 : 0)
            + (b && c.root === b.root ? 0 : b ? 3 - c.pcs.filter((x) => b.pcs.includes(x)).length * 0.5 : 1);
        const sorted = cands.sort((x, y) => score(x) - score(y) || x.root - y.root);
        return sorted[Math.min(rank, sorted.length - 1)];
    };
    const same = (x: Chord | null, y: Chord | null) => x === y || (!!x && !!y && x.root === y.root && x.pcs.join() === y.pcs.join());
    const out: (Chord | null)[] = [];
    /* One chord for each of the progression's chords, held over all it
     * spans: fitted half-bar by half-bar, a bass moving inside a bar became
     * two chords a bar (paths bench: 1.5-2 changes a bar after a bass or a
     * lead, the user's scenes 0.4-1). A span no one chord holds splits. */
    for (let i = 0; i < base.length;) {
        let j = i + 1;
        while (j < base.length && same(base[j], base[i])) j++;
        const pins = [...new Set(Array.from({ length: j - i }, (_, k) => pinsAt(i + k)).flat())];
        let whole = pins.length ? fit(base[i], pins, bassAt(i)) : base[i];
        /* Held through: the chord holds what sounds where it arrives, and
         * each later half-bar may pass one note it does not (a walking bass,
         * a lead's passing tone); clearRubs keeps a voice off a semitone. */
        const arrive = pinsAt(i).length ? fit(base[i], pinsAt(i), bassAt(i)) : base[i];
        const passes = (c: Chord) => Array.from({ length: j - i - 1 }, (_, k) => pinsAt(i + k + 1))
            .every((ps) => ps.filter((p) => !tolerates(c, [p], col)).length <= 1);
        if (!whole && arrive && passes(arrive)) whole = arrive;
        for (let k = i; k < j; k++) out.push(whole ?? (pinsAt(k).length ? fit(base[k], pinsAt(k), bassAt(k)) ?? base[k] : base[k]));
        i = j;
    }
    return out;
}

/** Runs a staged build to its end. */
export function drain<T>(g: Generator<void, T, void>): T {
    for (;;) { const r = g.next(); if (r.done) return r.value; }
}

/** HARMONY's plans, a stage at a time: New Clip's map is several ticks of
 *  work (create/harmony-map.ts), which a request spreads over its ticks. */
export function* planSteps(ctx: GenCtx): Generator<void, HarmonyPlan[], void> {
    if (ctx.task === 'create') return yield* createPlans(ctx, targetHalves(ctx));
    return buildPlans(ctx);
}

export function buildPlans(ctx: GenCtx): HarmonyPlan[] {
    const n = targetHalves(ctx);
    if (ctx.task === 'create') return drain(createPlans(ctx, n));
    if (ctx.task !== 'variation') return [{ chords: sample(ctx.fixedChords, n), sit: 'asis', pedal: null, label: 'SCENE' }];
    if (ctx.freedom === 'locked') {
        const chords = sample(ctx.fixedChords, n);
        return SITS.map(([sit, label]) => ({ chords, sit, pedal: null, label }));
    }
    const base = sample(ctx.srcChords, n);
    const same: HarmonyPlan = { chords: base, sit: 'asis', pedal: null, label: 'SAME' };
    if (!base.some((c) => c)) return [same];
    const col = (c: Chord) => colourPcs(c, ctx.key);
    const ok = (cs: (Chord | null)[]) => ctx.freedom !== 'partial' || cs.every((c, i) => !c || tolerates(c, ctx.pinned[i % ctx.pinned.length] ?? [], col));
    let moves = harmonicMoves(base, ctx.key);
    if (ctx.freedom === 'partial') {
        moves = moves.filter((m) => ok(m.chords));
        const seen = new Set(moves.map((m) => progId(m.chords)));
        ['FIT', 'FIT 2', 'FIT 3'].forEach((label, r) => {
            const chords = fits(ctx, base, r);
            const id = progId(chords);
            if (!seen.has(id)) { seen.add(id); moves.push({ name: label, dist: 0.2 + r * 0.25, chords, pedal: null }); }
        });
        moves.sort((a, b) => Number(!!a.ext) - Number(!!b.ext) || a.dist - b.dist);
    }
    const sev = sevenths(base);
    const mid: HarmonyPlan[] = !moves.length ? [same] : moves.map((m) => ({ chords: sev ? m.chords.map((c) => withSeventh(c, ctx)) : m.chords,
        sit: 'asis', pedal: m.pedal, label: m.name, ...(m.ext ? { ext: true } : {}) }));
    return withSections(ctx, n, base, mid, ok);
}

/** Variation's 2 and 8 sections either side of its moves, from the source's
 *  own chords (theory/sections.ts). */
function withSections(ctx: GenCtx, n: number, base: (Chord | null)[], mid: HarmonyPlan[], ok: (cs: (Chord | null)[]) => boolean): HarmonyPlan[] {
    const plan = (l: Laid): HarmonyPlan => ({ chords: l.chords, sit: 'asis', pedal: null, label: chordsLabel(l.chords), count: l.count });
    const [two, eight] = sectionsOver(base, ctx.key, n, false, ok, new Set(mid.map((p) => progId(p.chords))));
    return [...two.map(plan), ...mid, ...eight.map(plan)];
}

/* The source's style carries over: a part that plays seventh chords gets
 * seventh chords in the new harmony too. */
const sevenths = (a: (Chord | null)[]) => {
    const cs = a.filter((c): c is Chord => !!c);
    return cs.length > 0 && cs.filter((c) => c.pcs.length > 3).length * 2 >= cs.length;
};

function withSeventh(c: Chord | null, ctx: GenCtx): Chord | null {
    if (!c || c.pcs.length > 3 || !['maj', 'min', 'dim'].includes(c.quality)) return c;
    const d = degreeOf(c, ctx.key);
    if (d < 0) return c;
    const s = diatonic(ctx.key, d, true);
    return s.pcs.slice(0, 3).join() === c.pcs.join() ? s : c;
}

/** Whether HARMONY is a knob here (§2.8): every New Clip melodic part; on a
 *  Variation, the part that leads the harmony (bass or chords) or any part
 *  when the scene's harmony is not locked. A follower in a locked scene
 *  re-harmonised on its own clashes with the band (2026-10-27, set
 *  mmv41ucwf), so it keeps COLOUR only. */
export function harmonyApplies(ctx: GenCtx): boolean {
    if (ctx.task === 'create') return !ctx.drum;
    if (ctx.task !== 'variation') return false;
    const k = ctx.role?.kind;
    return ctx.freedom !== 'locked' || k === 'bass' || k === 'pad' || k === 'stabs';
}

/** HARMONY's value: the chords themselves, or how a locked part sits on the
 *  band's chords (AS PLAYED, ROOTS…; New Clip: the approach chords it adds),
 *  whose chords are the same throughout. */
export function harmonyLabel(ctx: GenCtx, h: number): string {
    const p = planAt(ctx, h);
    if (!p) return '';
    return ctx.freedom === 'locked' && ctx.task !== 'quantize' ? p.label : chordsLabel(p.chords);
}

/** Where HARMONY opens: a free scene moves somewhere (a B section changes
 *  its harmony), a locked one sits on the chords as played. */
export function defaultHarmony(ctx: GenCtx, far = 1): number {
    const home = homeOf(ctx);
    /* Partial: the closest fit around what the others pin comes first. */
    const basic = ctx.plans.filter((p) => !p.ext && !p.count).length;
    if (ctx.freedom !== 'free' || basic <= 1) return home;
    return home + Math.min(far, basic - 1);
}

/** Where the scene's own chords sit on HARMONY: past a Variation's 2
 *  section (the first plan otherwise). */
export const homeOf = (ctx: GenCtx): number => (ctx.task === 'variation' ? Math.max(0, ctx.plans.findIndex((p) => p.count !== 2)) : 0);

/** The plan at HARMONY's home: the chords the part plays now. */
export const homePlan = (ctx: GenCtx): HarmonyPlan | undefined => ctx.plans[homeOf(ctx)];

export function planAt(ctx: GenCtx, h: number, changes = 0): HarmonyPlan {
    const p = ctx.plans[Math.max(0, Math.min(ctx.plans.length - 1, h))];
    /* A locked scene's chords are the other tracks': CHANGES cannot add any. */
    if (changes <= 0 || ctx.freedom === 'locked' || !p) return p;
    const key = `${h}:${changes}`;
    const hit = changesCache.get(ctx)?.get(key);
    if (hit) return hit;
    const out = { ...p, chords: withChanges(p.chords, changes, ctx.key, pinOk(ctx)), label: p.label };
    if (!changesCache.has(ctx)) changesCache.set(ctx, new Map());
    changesCache.get(ctx)!.set(key, out);
    return out;
}

/** Whether a chord may sound at a beat: it holds what the others pin there. */
export function pinOk(ctx: GenCtx): (c: Chord, beat: number) => boolean {
    const col = (c: Chord) => colourPcs(c, ctx.key);
    return (c, beat) => holds(c, ctx.pinned.length ? ctx.pinned[Math.floor(beat / 2) % ctx.pinned.length] : [], col);
}

/* A plan at a CHANGES level is asked for on every knob turn: built once. */
const changesCache = new WeakMap<GenCtx, Map<string, HarmonyPlan>>();
