/* Method 3, the map knobs (plans/2026-10-29-generator-follow-ups.md #14):
 * a knob that walks a map of a hundred positions promises that a turn moves
 * a little and that every position is worth landing on. The sweep (method 1)
 * samples twelve positions of such a knob, so it cannot see either. Here
 * every position is played: how far each turn moves (onsets of a bar for a
 * rhythm, chords for a progression), how many positions are distinct, the
 * density range covered, and the verdict of each. */
import { features, planOf, verdict } from './musical.mjs';

/** A knob is a map when it has this many positions or more. */
const MAP = 40;
const RHYTHM = new Set(['PATTERN', 'GROOVE']);

/* One bar's onsets, folded over the clip, as a set of steps. */
const onsets = (G, notes) => new Set(notes.map((n) => Math.round(n.tick / G.TPS) % 16));
const apart = (a, b) => [...a].filter((x) => !b.has(x)).length + [...b].filter((x) => !a.has(x)).length;

export function mapPreset(G, ctx, p) {
    const out = [];
    const base = G.defaults(p, ctx);
    p.knobs.forEach((k, i) => {
        const n = k.steps(ctx);
        if (n < MAP || !(RHYTHM.has(k.name) || k.name === 'HARMONY')) return;
        /* HARMONY's map is the run's: measured on the plans, played on CHORDS. */
        if (k.name === 'HARMONY' && p.id !== 'n-chords') return;
        const turns = [], sigs = new Set(), verdicts = [], dens = [];
        let prev = null;
        for (let x = 0; x < n; x++) {
            const v = [...base]; v[i] = x;
            const notes = G.regenerate(ctx, p, v) ?? [];
            verdicts.push(verdict(notes.length ? features(G, ctx, notes, planOf(G, ctx, p, v)) : null, ctx.drum)[0]);
            sigs.add(notes.map((m) => `${m.tick}.${m.pitch}`).sort().join());
            if (k.name === 'HARMONY') {
                const chords = ctx.plans[x].chords.map(G.chordName);
                if (prev) turns.push(chords.filter((c, j) => c !== prev[j % prev.length]).length);
                prev = chords;
            } else {
                const o = onsets(G, notes);
                dens.push(o.size);
                if (prev) turns.push(apart(prev, o));
                prev = o;
            }
        }
        out.push({ preset: p.id, knob: k.name, positions: n, distinct: sigs.size / n, turns, verdicts,
            reach: dens.length ? Math.max(...dens) - Math.min(...dens) : null });
    });
    return out;
}

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

export function mapSummary(rows) {
    const all = rows.flat();
    const turns = all.flatMap((r) => r.turns), vs = all.flatMap((r) => r.verdicts);
    const share = (v) => vs.filter((x) => x === v).length / Math.max(1, vs.length);
    /* A rhythm turn of one onset, a progression turn of one chord (a chord
     * spans two half-bars on a long clip, so two slots). */
    const gentle = all.flatMap((r) => r.turns.map((t) => t <= (r.knob === 'HARMONY' ? 2 : 1)));
    return { knobs: all.length, positions: vs.length, gradual: mean(gentle.map(Number)), meanTurn: mean(turns),
        distinct: mean(all.map((r) => r.distinct)), musical: share('musical'), broken: share('broken'),
        reach: mean(all.map((r) => r.reach).filter((x) => x !== null)),
        worst: all.map((r) => ({ id: `${r.preset} ${r.knob}`, gradual: mean(r.turns.map((t) => Number(t <= (r.knob === 'HARMONY' ? 2 : 1)))),
            broken: r.verdicts.filter((v) => v === 'broken').length / r.verdicts.length })) };
}
