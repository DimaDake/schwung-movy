/* New Clip on the bench (plans/2026-10-28-new-clip-design.md): each case's
 * target track emptied and a part written from nothing into its slot, twice
 * (two runs, two nonces). Measured: how many options came, how many pass the
 * checks, how well they sit on the harmony and land with the band, how much
 * a second run differs from the first, and how the options of one run differ. */
import { DIMS, variability } from './variability.mjs';

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const f2 = (v) => (v === null || v === undefined ? '-' : v.toFixed(2));

export function createInput(c, level, nonce) {
    const at = c.set.target;
    const tracks = c.set.tracks.map((t) => (t.index === at.track ? { ...t, clips: [] } : t));
    const kit = c.drum ? [...new Set(c.set.tracks.find((t) => t.index === at.track)?.clips.flatMap((k) => k.notes.map((n) => n.pitch)) ?? [])] : [];
    return { task: 'create', level, tracks, target: at, source: null, len: 32, scale: [1, 1], drum: c.drum, kit, root: c.set.root, mode: c.set.mode, nonce };
}

function measure(G, c, level) {
    const a = G.generateAll(createInput(c, level, 1));
    const b = G.generateAll(createInput(c, level, 2));
    const ctx = a.ctx;
    const accents = ctx.band.filter((h) => h.w >= 0.9);
    const per = a.picks.map((p, i) => {
        const h = G.knobIndex(p.preset, 'HARMONY');
        const plan = h >= 0 ? p.knobs[h] : G.runPlan(ctx);
        const fit = ctx.drum ? null : mean(p.notes.map((n) => G.noteFit(n.pitch, G.chordUnder(ctx, plan, n.tick), ctx.key, G.isStrong(n.tick))));
        const on = [...new Set(p.notes.map((n) => n.tick))];
        const band = accents.length && on.length ? on.filter((t) => accents.some((x) => Math.abs(x.tick - t) < 6)).length / on.length : null;
        const other = b.picks.find((q) => q.preset === p.preset);
        return { ok: !G.unmeaning(ctx, p.preset, p.notes), fit, band, rerun: other ? G.difference(p.notes, other.notes) : null };
    });
    return { picks: a.picks, per };
}

/** The section's headline numbers (quality/run.mjs compares them). */
export function createStats(G, cases) {
    G.forgetOptions();
    const ops = cases.flatMap((c) => measure(G, c, 'BALANCED').per);
    G.forgetOptions();
    const m = (k) => mean(ops.map((o) => o[k]).filter((x) => x !== null));
    return { meaningful: mean(ops.map((o) => (o.ok ? 1 : 0))), fit: m('fit'), band: m('band'), rerun: m('rerun') };
}

/** Markdown lines for the bench report. */
export function createSection(G, cases) {
    const out = ['', '## New Clip', '', 'Each case\'s target track emptied, a part written into its slot from nothing. Meaningful: the share '
        + 'of options that pass their part\'s checks. Coherence: chord fit (melodic). With band: the share of onsets on another track\'s '
        + 'accent (where one plays). Re-run: how far a second run\'s option is from the first\'s (0 = the same). Variability: between the options of one request.', '',
        '| level | requests | options | meaningful | coherence | with band | re-run | rhythm var | notes var |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |'];
    /* The GENERATORS level does not move New Clip: one row. */
    for (const level of ['BALANCED']) {
        G.forgetOptions();
        const runs = cases.map((c) => measure(G, c, level));
        const ops = runs.flatMap((r) => r.per);
        const v = variability(runs.map((r) => r.picks.map((p) => p.notes)));
        const some = (k) => f2(mean(ops.map((o) => o[k]).filter((x) => x !== null)));
        out.push(`| ${level} | ${runs.length} | ${f2(mean(runs.map((r) => r.picks.length)))} | ${f2(mean(ops.map((o) => (o.ok ? 1 : 0))))} | `
            + `${some('fit')} | ${some('band')} | ${some('rerun')} | ${f2(v[DIMS[0]])} | ${f2(v[DIMS[1]])} |`);
    }
    G.forgetOptions();
    return out;
}
