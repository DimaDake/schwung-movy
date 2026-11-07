/* browser-test/logic/gen-scene-b.mjs — a scene B made from A by Variation
 * keeps A's harmonic rhythm and lines its lead up with its chords (chains
 * bench round 7: chords varied changed too often, chords.changes the top
 * miss in 48 of 144 B scenes; lc.coincide out in 35).
 *
 * Run by browser-test/logic.mjs.
 */

import { _log, eq, ok } from './harness.mjs';
import * as G from '../../dist/esm/gen/index.js';

const S = G.TPS;
const N = (step, pitch, len = 1, vel = 100) => ({ tick: step * S, gate: len * S, pitch, vel });
const strike = (step, ps, len = 3) => ps.map((p) => N(step, p, len, 96));
const clip = (track, slot, notes, len = 32) => ({ track, slot, len, loopStart: 0, scaleNum: 1, scaleDen: 1, transpose: 0, quant: 0, notes });
const track = (index, clips) => ({ index, name: `Track ${index + 1}`, module: 'obxd', drum: false, padNames: null, clips });
const by = (id) => G.PRESETS.find((p) => p.id === id);
const sets = (ns) => G.toEvents(ns).map((e) => ({ step: Math.round(e.tick / S), ps: e.voices.map((v) => v.pitch).sort((a, b) => a - b).join() }));
const onsets = (ns) => new Set(ns.map((n) => Math.round(n.tick / S)));

/* C minor: Cm struck four times a bar, then Fm four times, over a bass that
 * walks F-Eb-D under the Fm (the chains bench's seed 0). */
const CM = [63, 67, 72], FM = [65, 68, 72];
const comp = [0, 4, 8, 12].flatMap((s) => strike(s, CM)).concat([16, 20, 24, 28].flatMap((s) => strike(s, FM)));
const walk = [N(0, 36, 8), N(8, 43, 8), N(16, 41, 8), N(24, 39, 4), N(28, 38, 4)];
/* The same in short stabs, the walk loud under them: read with the bass, the
 * Fm bar's second half is Dm7b5. */
const stabs = [0, 4, 8, 12].flatMap((s) => strike(s, CM, 1)).concat([16, 20, 24, 28].flatMap((s) => strike(s, FM, 1)));
const loud = [N(0, 48, 8), N(8, 55, 8), N(16, 53, 8), N(24, 51, 4, 127), N(28, 50, 4, 127), N(24, 62, 8, 127)];
/* Dyads over the bass's roots: Eb-G over C, Ab-C over F. */
const dyads = [0, 4, 8, 12].flatMap((s) => strike(s, [63, 67])).concat([16, 20, 24, 28].flatMap((s) => strike(s, [68, 72])));
const input = (me, others, task = 'variation') => ({ task, tracks: [track(0, me), ...others], target: { track: 0, slot: 1 },
    source: { track: 0, slot: 0 }, len: 32, scale: [1, 1], drum: false, kit: [], root: 'C', mode: 'minor' });

export async function run() {
_log('\nTest: scene B by Variation');

/* The chords as the comp plays them: the bass's walk is not a new chord. */
{
    const ctx = G.prepare(input([clip(0, 0, stabs)], [track(1, [clip(1, 0, loud)])]));
    const name = (c) => (c ? `${c.root % 12}${c.quality}` : '-');
    eq('variation_reads_a_held_comp_as_one_chord_a_bar', ctx.srcChords.slice(0, 4).map(name).join(' '),
        [ctx.srcChords[0], ctx.srcChords[0], ctx.srcChords[2], ctx.srcChords[2]].map(name).join(' '));
    /* The plan HARMONY opens on (a TURN splits a held chord on purpose, a turn away). */
    const opens = G.planAt(ctx, G.defaultHarmony(ctx)).chords;
    ok('variation_harmony_opens_at_the_comps_chord_rate', opens.slice(0, 4).every((c, i) => i % 2 === 0 || G.sameChord(c, opens[i - 1])));
}

/* NUDGE revoices a held chord on every strike alike and loses no pitch class. */
{
    const ctx = G.prepare(input([clip(0, 0, comp)], [track(1, [clip(1, 0, walk), clip(1, 1, walk)])]));
    const p = by('v-nudge');
    const out = sets(G.regenerate(ctx, p, G.defaults(p, ctx)));
    const perBar = [0, 1].map((b) => new Set(out.filter((e) => Math.floor(e.step / 16) === b).map((e) => e.ps)));
    ok('nudge_moves_a_held_chord_whole', perBar.every((s) => s.size === 1));
    const pcs = (ps) => [...new Set(ps.split(',').map((x) => Number(x) % 12))].sort().join();
    ok('nudge_keeps_every_chord_tone', out.every((e) => pcs(e.ps) === pcs((e.step < 16 ? CM : FM).join())));
    ok('nudge_changes_the_comp', out.some((e) => e.ps !== (e.step < 16 ? CM : FM).join()));
    const two = G.prepare(input([clip(0, 0, dyads)], [track(1, [clip(1, 0, walk), clip(1, 1, walk)])]));
    const seeds = (c, f) => Array.from({ length: 8 }, (_, k) => { const v = G.defaults(p, c); v[G.knobIndex(p, 'SEED')] = k; return f(G.regenerate(c, p, v)); });
    ok('nudge_keeps_a_dyads_notes', seeds(two, (ns) => sets(ns).every((e) => pcs(e.ps) === pcs((e.step < 16 ? [63, 67] : [68, 72]).join()))).every(Boolean));

    /* Under a lead, the voices turn down, away from it. */
    const lead = [0, 4, 8, 12, 16, 20, 24, 28].map((s) => N(s, 79, 2));
    const under = G.prepare(input([clip(0, 0, comp)], [track(1, [clip(1, 0, walk), clip(1, 1, walk)]), track(2, [clip(2, 1, lead)])]));
    ok('nudge_turns_chords_away_from_the_lead', seeds(under, (ns) => Math.max(...ns.map((n) => n.pitch)) <= 72).every(Boolean));
}

/* THIN keeps the strike that brings the chord in, wherever it sits. */
{
    const pad = [...strike(0, CM, 4), ...strike(4, CM, 4), ...strike(8, CM, 4), ...strike(14, FM, 18)];
    const ctx = G.prepare(input([clip(0, 0, pad)], []));
    const p = by('v-thin');
    const v = G.defaults(p, ctx);
    v[G.knobIndex(p, 'AMOUNT')] = p.knobs[G.knobIndex(p, 'AMOUNT')].steps(ctx) - 1;
    const out = G.regenerate(ctx, p, v) ?? [];
    const changes = sets(out).filter((e, i, a) => i > 0 && e.ps !== a[i - 1].ps).length;
    ok('thin_keeps_the_chord_change', out.length > 0 && changes >= 1 && sets(out).length < 4);
}

/* EUCLID and DISPLACE play with the band's chords, not past them. */
{
    const line = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30].map((s, i) => N(s, [72, 74, 75, 77][i % 4], 1));
    const chordsB = [3, 6, 11, 19, 22, 27].flatMap((s) => strike(s, CM, 2));
    const ctx = G.prepare(input([clip(0, 0, line)], [track(1, [clip(1, 0, comp), clip(1, 1, chordsB)])]));
    const hits = onsets(chordsB);
    const shared = (ns) => [...onsets(ns)].filter((s) => hits.has(s)).length;
    const eu = by('v-euclid');
    const ev = G.defaults(eu, ctx);
    ev[G.knobIndex(eu, 'PULSES')] = 4;
    ok('euclid_lands_on_the_bands_chords', shared(G.regenerate(ctx, eu, ev)) >= 4);

    const ds = by('v-displace');
    const lineOn = [3, 6, 11, 14, 19, 22, 27, 30].map((s, i) => N(s, [72, 74, 75, 77][i % 4], 1));
    const ctx2 = G.prepare(input([clip(0, 0, lineOn)], [track(1, [clip(1, 0, comp), clip(1, 1, chordsB)])]));
    const dv = G.defaults(ds, ctx2);
    dv[G.knobIndex(ds, 'AMOUNT')] = 10;
    const moved = G.regenerate(ctx2, ds, dv);
    ok('displace_keeps_the_notes_on_the_chords', [...hits].every((s) => onsets(moved).has(s)) && onsets(moved).size > 0);
}
}
