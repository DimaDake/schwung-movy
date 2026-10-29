/* What a part is and how it sounds where it will play: the features a knob
 * is expected to move, and the one musical / experimental / broken verdict
 * that the knob sweep, the knob-space map and the piece all judge by
 * (plans/2026-10-29-generator-quality-metrics.md). The verdict is about the
 * ear, not taste: "experimental" is allowed, "broken" is what no user keeps. */

const TPS = 24, BAR = 384;
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const covariance = (xs, ys) => { const mx = mean(xs), my = mean(ys); return mean(xs.map((x, i) => (x - mx) * (ys[i] - my))); };

/** The harmony a preset's notes are heard against: its HARMONY knob where it
 *  has one, else the plan the task runs on. */
export function planOf(G, ctx, p, knobs) {
    const h = G.knobIndex(p, 'HARMONY');
    if (h >= 0) return knobs[h];
    return ctx.task === 'create' ? G.runPlan(ctx) : G.defaultHarmony(ctx);
}

/** The other melodic tracks' notes in the target scene, looped over the
 *  target's length: what a new part will sound against. */
export function bandNotes(ctx) {
    const { tracks, target } = ctx.input;
    const out = [];
    for (const t of tracks) {
        if (t.index === target.track || t.drum) continue;
        for (const c of t.clips.filter((x) => x.slot === target.slot && x.notes.length)) {
            const span = Math.max(TPS, c.len * TPS), from = (c.loopStart ?? 0) * TPS;
            const heard = c.notes.filter((n) => n.tick >= from && n.tick < from + span);
            for (let off = 0; off < ctx.end; off += span) {
                for (const n of heard) if (n.tick - from + off < ctx.end) out.push({ ...n, tick: n.tick - from + off });
            }
        }
    }
    return out;
}

/* A rub: a minor second or minor ninth (or a semitone two octaves apart)
 * against a note another track holds. Not the major seventh: it is a maj7
 * chord's own colour, and the corpus's real parts play it (calibration in
 * the design note: real parts rub 0% on strong beats by this measure). */
export const rubs = (a, b) => { const d = Math.abs(a - b); return d % 12 === 1 && d <= 25; };

/** Strong-position notes that rub against a note another track holds at
 *  that moment, as a share of those checked. */
export function clashShare(G, notes, band) {
    let checked = 0, bad = 0;
    for (const n of notes) {
        if (!G.isStrong(n.tick)) continue;
        const under = band.filter((b) => b.tick <= n.tick && b.tick + b.gate > n.tick);
        if (!under.length) continue;
        checked++;
        if (under.some((b) => rubs(n.pitch, b.pitch))) bad++;
    }
    return checked ? bad / checked : 0;
}

/** What the sweep watches move. Melodic and drum parts share the timing ones. */
export function features(G, ctx, notes, plan, band = bandNotes(ctx)) {
    const bars = Math.max(1, ctx.end / BAR);
    const offs = notes.map((n) => n.tick - Math.round(n.tick / TPS) * TPS);
    const base = {
        n: notes.length, perBar: (ctx.drum ? notes.length : G.toEvents(notes).length) / bars,
        gate: median(notes.map((n) => n.gate)), vel: Math.sqrt(mean(notes.map((n) => (n.vel - mean(notes.map((x) => x.vel))) ** 2))),
        /* How much louder the strong positions are: DYNAMICS shapes velocity
         * along the metre (shape/dynamics.ts), so its promise is this. */
        accent: covariance(notes.map((n) => G.strength(n.tick)), notes.map((n) => n.vel)),
        late: mean(notes.filter((n) => Math.round(n.tick / TPS) % 2 === 1).map((n) => n.tick - Math.round(n.tick / TPS) * TPS)),
        timing: mean(offs.map(Math.abs)),
        emptyBar: Array.from({ length: Math.ceil(bars) }, (_, b) => !notes.some((n) => Math.floor(n.tick / BAR) === b)).some(Boolean),
    };
    if (ctx.drum || !notes.length) {
        return { ...base, pads: new Set(notes.map((n) => n.pitch)).size,
            downbeat: notes.some((n) => n.tick < TPS / 2) };
    }
    const ps = notes.map((n) => n.pitch);
    const chord = (t) => G.chordUnder(ctx, plan, t);
    const cats = notes.map((n) => G.categoryOf(n.pitch, chord(n.tick), ctx.key));
    return { ...base, span: Math.max(...ps) - Math.min(...ps), mid: median(ps), distinct: new Set(ps).size,
        poly: notes.length / Math.max(1, G.toEvents(notes).length),
        outside: cats.filter((c) => c === 'approach' || c === 'other').length / notes.length,
        colour: cats.filter((c) => c !== 'chord').length / notes.length,
        fit: mean(notes.map((n) => G.noteFit(n.pitch, chord(n.tick), ctx.key, G.isStrong(n.tick)))),
        clash: clashShare(G, notes, band) };
}

/** 'musical' | 'experimental' | 'broken', and why. */
export function verdict(f, drum) {
    /* The guard refused every roll: the screen keeps what it had, so the turn
     * did nothing — a dead click, not a broken sound. */
    if (f === null) return ['refused', 'refused'];
    if (!f.n) return ['broken', 'empty'];
    if (drum) {
        if (f.perBar > 32) return ['broken', 'wall'];
        if (f.emptyBar && f.perBar > 2) return ['experimental', 'gap'];
        if (!f.downbeat || f.perBar > 24 || f.perBar < 2) return ['experimental', !f.downbeat ? 'no downbeat' : 'density'];
        return ['musical', ''];
    }
    /* A 1/16-triplet arp (24 a bar) is a trance staple, not a wall. */
    if (f.perBar > 24) return ['broken', 'wall'];
    if (f.mid < 28 || f.mid > 100) return ['broken', 'register'];
    if (f.fit < 0.55) return ['broken', 'off harmony'];
    if (f.clash > 0.25) return ['broken', 'clash'];
    if (f.fit < 0.72 || f.clash > 0.1) return ['experimental', f.fit < 0.72 ? 'outside' : 'rub'];
    if (f.span > 36 || f.emptyBar || f.perBar > 16) return ['experimental', f.span > 36 ? 'wide' : f.emptyBar ? 'gap' : 'busy'];
    return ['musical', ''];
}

export const sig = (a) => (a ? a.map((n) => `${n.tick}.${n.pitch}.${n.gate}.${n.vel}`).join(',') : '-');
