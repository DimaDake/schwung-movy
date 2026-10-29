/* Method 5, phrasing (plans/2026-10-29-phrase-space-design.md §5): every
 * SPARSE position of every New Clip generator, against its own FULL part.
 * ROOM is the share of the clip left silent; a CUT is a rest the position
 * made (a beat or more, where the full part played) that follows a note which
 * did not land — off the 8th grid, or not a tone of the chord there. A cut
 * sounds like a dropout; a landed note before the same rest, like a breath. */
import { planOf } from './musical.mjs';

const BEAT = 96;

function sounding(G, ns, len) {
    const on = new Set();
    for (const n of ns) for (let t = n.tick; t < n.tick + n.gate; t += G.TPS) on.add(Math.floor(t / G.TPS) % len);
    return on.size / len;
}

function cuts(G, ctx, h, notes, full) {
    const on = [...notes].sort((a, b) => a.tick - b.tick);
    let rests = 0, cut = 0;
    on.forEach((n, i) => {
        const next = on.find((m) => m.tick > n.tick)?.tick ?? on[0].tick + ctx.end;
        if (next - (n.tick + n.gate) < BEAT || on.some((m) => m.tick <= n.tick && m.tick + m.gate > n.tick + n.gate)) return;
        if (!full.some((m) => m.tick > n.tick && m.tick < next && !on.some((x) => x.tick === m.tick))) return;
        rests++;
        const c = G.chordUnder(ctx, h, n.tick);
        if (n.tick % (2 * G.TPS) !== 0 || ![...c.pcs, c.bass].includes(G.pc(n.pitch))) cut++;
    });
    return [rests, cut];
}

/* Lines only: a chord part's beat windows are rhythm on purpose (user: beat
 * 3 alone makes sense for chords), a voiced chord holds colour tones, and
 * DUB leaves the one empty by design. */
const LINES = new Set(['n-melody', 'n-bass', 'n-arp', 'n-riff', 'n-counter']);

export function phrasePreset(G, ctx, p) {
    const k = G.knobIndex(p, 'SPARSE');
    if (k < 0 || ctx.task !== 'create' || ctx.drum || !LINES.has(p.id)) return null;
    const base = G.defaults(p, ctx);
    base[k] = 0;
    const full = G.regenerate(ctx, p, base) ?? [];
    const out = [];
    for (let i = 1; i < p.knobs[k].steps(ctx); i++) {
        if (p.knobs[k].label(i, ctx) === 'DUB') continue;
        const v = [...base]; v[k] = i;
        const notes = G.regenerate(ctx, p, v);
        if (!notes?.length) { out.push({ empty: true }); continue; }
        const [rests, cut] = cuts(G, ctx, planOf(G, ctx, p, v), notes, full);
        out.push({ room: 1 - sounding(G, notes, ctx.len), rests, cut });
    }
    return out;
}

export function phraseSummary(rows) {
    const all = rows.filter(Boolean).flat();
    const played = all.filter((x) => !x.empty);
    const rests = played.reduce((a, x) => a + x.rests, 0);
    return { positions: all.length, empty: all.length ? (all.length - played.length) / all.length : 0,
        room: played.length ? played.reduce((a, x) => a + x.room, 0) / played.length : 0,
        cuts: rests ? played.reduce((a, x) => a + x.cut, 0) / rests : 0 };
}
