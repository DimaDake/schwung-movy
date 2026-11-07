/* browser-test/logic/gen-evolve.mjs — evolving a Set with generators
 * (plans/2026-11-07-generation-paths-bench.md, round 4): NUDGE's small steps,
 * a Variation that hears the parts varied before it, Smart Quantize repairing
 * a drummer's slips, and New Clip's takes that lean on the band.
 *
 * Run by browser-test/logic.mjs.
 */

import { _log, eq, ok } from './harness.mjs';
import * as G from '../../dist/esm/gen/index.js';
import { createInput, fixtureInput } from '../gen-fixtures.mjs';

const N = (step, pitch, len = 1, vel = 100) => ({ tick: step * G.TPS, gate: len * G.TPS - 2, pitch, vel });
const median = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
const onsets = (ns) => [...new Set(ns.map((n) => n.tick))].sort((a, b) => a - b).join();
const by = (id) => G.PRESETS.find((p) => p.id === id);
const turn = (ctx, p, name, pos) => { const v = G.defaults(p, ctx); v[G.knobIndex(p, name)] = pos; return G.regenerate(ctx, p, v); };

export async function run() {
_log('\nTest: generator evolution (NUDGE, a Variation in a band, drum slips)');

/* NUDGE: option 1 of a Variation, the part with a few notes moved (in a
 * scene of its own, where the harmony stays). */
{
    const input = fixtureInput('lead', { scene: 'free' });
    const r = G.generateAll(input, 6);
    const src = r.ctx.src, nudge = r.picks[0];
    eq('nudge_is_option_1', nudge?.preset.id, 'v-nudge');
    /* In a full scene two closer-scoring options would take both close slots: it is still first. */
    eq('nudge_is_option_1_in_a_full_scene_too', G.generateAll(fixtureInput('lead'), 6).picks[0]?.preset.id, 'v-nudge');
    const d = G.difference(nudge.notes, src);
    ok('nudge_moves_a_few_notes', d >= 0.15 && d <= 0.5, d.toFixed(2));
    eq('nudge_keeps_the_rhythm', onsets(nudge.notes), onsets(src));
    const p = by('v-nudge');
    ok('nudge_amount_moves_more', G.difference(turn(r.ctx, p, 'AMOUNT', 8), src) > d);
    const mean = (ns) => ns.reduce((a, n) => a + n.pitch, 0) / ns.length;
    ok('nudge_up_climbs', mean(turn(r.ctx, p, 'DIRECTION', 1)) > mean(src) && mean(turn(r.ctx, p, 'DIRECTION', 2)) < mean(src));
    const last = turn(r.ctx, p, 'BARS', 2);
    const bars = Math.round(r.ctx.end / G.BAR);
    const moved = last.filter((n, i) => n.pitch !== src[i]?.pitch).map((n) => Math.floor(n.tick / G.BAR));
    ok('nudge_last_bar_moves_only_the_last_bar', moved.length > 0 && moved.every((b) => b === bars - 1));
}

/* A Variation hears the scene's other parts, and a line varied into a chord
 * part's octave, hitting with it, moves an octave away from it. */
{
    const input = fixtureInput('lead');
    eq('a_variation_hears_the_band', G.prepare(input).band.length > 0, true);
    const chords = [0, 8, 16, 24].flatMap((s) => [60, 64, 67].map((p) => N(s, p, 8)));
    input.tracks = [input.tracks[0], { index: 1, name: 'Keys', module: 'obxd', drum: false, padNames: null,
        clips: [{ track: 1, slot: 1, len: 32, loopStart: 0, scaleNum: 1, scaleDen: 1, transpose: 0, quant: 0, notes: chords }] }];
    const ctx = G.prepare(input);
    const line = [0, 8, 16, 24].map((s, i) => N(s, [65, 64, 62, 64][i], 4));
    const out = G.clearMud(ctx, line);
    ok('a_line_in_the_chords_octave_moves_away', median(out.map((n) => n.pitch)) - median(line.map((n) => n.pitch)) === 12 * Math.sign(ctx.mid - 64 || 1));
    const apart = [2, 10, 18, 26].map((s, i) => N(s, [65, 64, 62, 64][i], 2));
    eq('a_line_that_does_not_hit_with_them_stays', G.clearMud(ctx, apart).map((n) => n.pitch).join(), apart.map((n) => n.pitch).join());
}

/* Smart Quantize's CLEAN on drums: two isolated slips onto the next pad go
 * back, a graze goes, a one-beat tom fill at the end stays. */
{
    const beat = [];
    for (let b = 0; b < 4; b++) {
        for (const s of [0, 8]) beat.push(N(b * 16 + s, 36));
        for (const s of [4, 12]) beat.push(N(b * 16 + s, 38));
        for (let s = 0; s < 16; s += 2) if (!(b === 3 && s >= 12)) beat.push(N(b * 16 + s, 42, 1, 80));
    }
    const fill = [N(60, 43), N(61, 43), N(62, 45), N(63, 45)];
    const played = [...beat, ...fill].map((n) => (n.tick === 22 * G.TPS && n.pitch === 42 ? { ...n, pitch: 43 } : n.tick === 44 * G.TPS && n.pitch === 38 ? { ...n, pitch: 39 } : n));
    played.push(N(35, 42, 1, 14));
    const out = G.cleanDrums(played, 3);
    const at = (step) => out.filter((n) => n.tick === step * G.TPS).map((n) => n.pitch);
    ok('drum_slips_go_back_to_the_loops_pad', at(22).join() === '42' && at(44).includes(38) && !at(44).includes(39));
    eq('a_drum_graze_goes', at(35).join(), '');
    ok('a_tom_fill_stays', [43, 43, 45, 45].every((p, i) => at(60 + i).includes(p)));
}

/* New Clip's takes lean on the band: PULSE and WALK lock to the kick a third
 * of the time, CHORDS and STABS take the band's accents, ARP plays eighths. */
{
    const band = G.prepare(createInput(false, 'locked', 1));
    const lock = G.figurePosition(band, G.BASS_MAP, G.lockFigure(band));
    for (const id of ['n-pulse', 'n-walk']) {
        const p = by(id), k = G.knobIndex(p, 'PATTERN');
        const rolls = Array.from({ length: 90 }, (_, i) => G.rolled(p, band, i % 4, i)[k]);
        ok(`${id}_takes_lock_to_the_kick`, rolls.filter((v) => v === lock).length >= 15);
    }
    const arp = by('n-arp'), rk = G.knobIndex(arp, 'RATE');
    const fast = Array.from({ length: 80 }, (_, i) => G.rolled(arp, band, i % 4, i)[rk]).filter((v) => v >= 3).length;
    ok('arp_takes_are_mostly_eighths', fast <= 30);
}
}
