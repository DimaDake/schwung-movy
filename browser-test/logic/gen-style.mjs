/* browser-test/logic/gen-style.mjs — phase 3 of the algorithmic generators
 * (plans/2026-10-28-generators-learned-style-design.md): the Markov chain,
 * the learned walks, the Tonnetz turns, CYCLE rhythms and LOOPER's lock.
 *
 * Run by browser-test/logic.mjs.
 */

import { _log, eq, ok } from './harness.mjs';
import * as G from '../../dist/esm/gen/index.js';
import { fixtureInput } from '../gen-fixtures.mjs';

const name = (c) => G.chordName(c);
const sig = (ns) => ns.map((n) => `${n.tick}.${n.pitch}`).join(',');
const onsets = (ns) => [...new Set(ns.map((n) => Math.round(n.tick / G.TPS)))].sort((a, b) => a - b);

export async function run() {
_log('\nTest: generator style');

/* The chain: the deepest level replays a sequence it learned, the bottom one
 * may leave it, and a draw is a function of its seed. */
const ch = G.chain([() => '', (p) => (p.length ? p[p.length - 1] : null)]);
G.learn(ch, ['a', 'b', 'c', 'a', 'b', 'c'], [0, 1, 2, 3, 4, 5], true);
const walkOf = (level, seed) => { const r = G.rng(seed); const p = []; for (let i = 0; i < 12; i++) p.push(G.draw(ch, level, p, i, r, 1)); return p.join(''); };
ok('markov_deep_level_replays_the_source', walkOf(1, 3).includes('abcabc') || walkOf(1, 3).includes('bcabca') || walkOf(1, 3).includes('cabcab'));
ok('markov_bottom_level_recombines', [1, 2, 3, 4, 5].some((s) => !/^(abc|bca|cab)+/.test(walkOf(0, s))));
eq('markov_is_seeded', walkOf(0, 9), walkOf(0, 9));
eq('markov_backs_off_an_unseen_context', G.draw(ch, 1, ['z'], 0, G.rng(1), 1) !== null, true);
ok('likeness_deeper_and_colder_to_the_right', G.likeness(10).level > G.likeness(0).level && G.likeness(10).temp < G.likeness(0).temp);

/* The learned walks: a lead at full LIKENESS stays close to its source,
 * at none it moves further; a drum walk keeps to the pattern's pads. */
const lead = G.prepare(fixtureInput('lead', { scene: 'free' }));
const src = G.toEvents(lead.src);
const near = (ev) => G.fromEvents(ev, lead.end);
const diff = (a, b) => { const A = new Set(sig(a).split(',')), B = new Set(sig(b).split(',')); let i = 0; for (const x of A) if (B.has(x)) i++; return 1 - i / (A.size + B.size - i); };
const at = (like) => [1, 2, 3, 4].reduce((s, k) => s + diff(near(G.walk(lead, src, like, 5, 16 * G.TPS, G.rng(k))), lead.src), 0) / 4;
ok('walk_likeness_moves_the_distance', at(0) > at(10));
ok('walk_density_moves_the_onsets', near(G.walk(lead, src, 3, 10, 16 * G.TPS, G.rng(2))).length > near(G.walk(lead, src, 3, 0, 16 * G.TPS, G.rng(2))).length);
const drums = G.prepare(fixtureInput('drums'));
const dw = G.drumWalk(drums, 4, 5, 16 * G.TPS, G.rng(5));
ok('drum_walk_uses_the_pattern_pads', dw.length > 0 && dw.every((n) => drums.src.some((s) => s.pitch === n.pitch)));
ok('drum_walk_repeats_its_phrase', sig(dw.filter((n) => n.tick < 16 * G.TPS)) === sig(dw.filter((n) => n.tick >= 16 * G.TPS).map((n) => ({ ...n, tick: n.tick - 16 * G.TPS }))));

/* Tonnetz: P, L and R each keep two notes; a TURN moves the held halves only. */
const C = G.chordOf(0, 'maj'), Am = G.chordOf(9, 'min');
eq('riemann_p_l_r_of_c', ['P', 'L', 'R'].map((t) => name(G.riemann(C, t))).join(' '), 'CM EM AM');
eq('riemann_of_a_minor', ['P', 'L', 'R'].map((t) => name(G.riemann(Am, t))).join(' '), 'A F C');
ok('riemann_keeps_two_common_tones', ['P', 'L', 'R'].every((t) => G.riemann(C, t).pcs.filter((x) => C.pcs.includes(x)).length === 2));
const key = { tonic: 0, minor: false, score: 1 };
const turn = G.harmonicMoves([C, C, G.chordOf(5, 'maj'), G.chordOf(5, 'maj')], key, false).find((m) => m.name === 'R TURN');
eq('turn_moves_the_second_half_of_each_held_chord', turn?.chords.map(name).join(' '), 'C AM F DM');
ok('turn_not_offered_without_held_chords', !G.harmonicMoves([C, G.chordOf(7, 'maj'), Am, G.chordOf(5, 'maj')], key, false).some((m) => m.name === 'R TURN'));

/* CYCLE: the first N steps again every N steps. */
const cyc = G.rhythmStage(lead, src, G.RHYTHMS.indexOf('CYCLE 3'), G.rng(1));
const first = onsets(near(src).filter((n) => n.tick < 3 * G.TPS));
ok('cycle_repeats_every_n_steps', cyc.length > 0 && cyc.every((e) => first.includes(Math.round(e.tick / G.TPS) % 3)));

/* LOOPER fully locked replays the source's first LOOP clock steps. */
const looper = G.PRESETS.find((p) => p.id === 'v-looper');
const base = G.defaults(looper, lead);
const locked = [...base]; locked[0] = 10; locked[2] = 0;
const a = looper.generate(lead, locked, 1), b = looper.generate(lead, locked, 2);
eq('looper_locked_ignores_the_seed', sig(a), sig(b));
const open = [...base]; open[0] = 0;
ok('looper_open_moves', sig(looper.generate(lead, open, 1)) !== sig(looper.generate(lead, open, 2)));
}
