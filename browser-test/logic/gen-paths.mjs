/* browser-test/logic/gen-paths.mjs — the paths bench's relation metrics
 * (plans/2026-11-07-generation-paths-bench.md) on hand-written scenes, so a
 * band compares what the rule says and not an artefact of the arithmetic.
 *
 * Run by browser-test/logic.mjs.
 */

import { _log, eq, ok } from './harness.mjs';
import { coincide, phraseEnd, relations, scaleFit, syncopation } from '../../scripts/gen-bench/quality/relations.mjs';
import { groupOf, inBand, refBands } from '../../scripts/gen-bench/quality/paths-score.mjs';

/* Notes in beats: [start, dur, pitch, vel]; steps are 16ths. */
const at = (steps, pitch, dur = 0.25) => steps.map((s) => [s / 4, dur, pitch, 100]);
const bars = (n, steps) => [...Array(n).keys()].flatMap((b) => steps.map((s) => s + b * 16));
const empty = { kick: [], snare: [], hats: [], perc: [], bass: [], chords: [], lead: [] };

export async function run() {
_log('\nTest: generation paths bench metrics');

/* LHL: four on the floor never syncopates; an offbeat 8th line scores
 * 1 + 2 + 1 + 3 per bar (each onset against the stronger silent position
 * that follows it, the last against the next downbeat). */
eq('sync_four_on_the_floor_is_zero', syncopation([0, 4, 8, 12], 16), 0);
eq('sync_offbeat_eighths_is_seven_per_bar', syncopation([2, 6, 10, 14, 18, 22, 26, 30], 32), 7);

/* AAAB: the last bar of the phrase departs, so the end answers (> 0); AAAA does not. */
eq('phrase_end_aaaa_is_zero', phraseEnd(bars(4, [0, 4, 8, 12]), 64), 0);
ok('phrase_end_aaab_answers', phraseEnd([...bars(3, [0, 4, 8, 12]), 48, 50, 52, 54, 56, 58], 64) > 0.5);

eq('scale_fit_any_mode_of_one_collection_is_one', scaleFit(at([0, 1, 2, 3, 4, 5, 6], 0).map((n, i) => [n[0], n[1], 62 + [0, 2, 3, 5, 7, 9, 10][i], 100])), 1);
eq('coincide_over_the_sparser_part', coincide([0, 4], [0, 2, 4, 6]), 1);

/* Kick and bass: a bass on the kicks locks; an offbeat bass complements;
 * a bass on the "e" of every beat does neither, the one the rule flags. */
{
    const kick = at(bars(1, [0, 4, 8, 12]), 36);
    const lock = relations({ ...empty, len: 4, kick, bass: at([0, 4, 8, 12], 36) });
    const off = relations({ ...empty, len: 4, kick, bass: at([2, 6, 10, 14], 36) });
    const neither = relations({ ...empty, len: 4, kick, bass: at([1, 5, 9, 13], 36) });
    ok('bass_on_kicks_locks', lock['bk.lock'] === 1 && lock['bk.neither'] === 0);
    ok('offbeat_bass_complements', off['bk.lock'] === 0 && off['bk.offbeat'] === 1 && off['bk.neither'] === 0);
    eq('bass_neither_on_nor_between_kicks_is_flagged', neither['bk.neither'], 1);
}

/* Chords over a bass: the bass in the chord where it arrives; a lead a
 * minor 2nd off a chord tone rubs. */
{
    const cMaj = [[0, 4, 60, 90], [0, 4, 64, 90], [0, 4, 67, 90]];
    const inC = relations({ ...empty, len: 4, chords: [cMaj], bass: at([0], 36, 4) });
    const outC = relations({ ...empty, len: 4, chords: [cMaj], bass: at([0], 35, 4) });
    eq('bass_root_under_its_chord_is_in_chord', inC['bc.inChord'], 1);
    eq('bass_b_under_c_major_is_not', outC['bc.inChord'], 0);
    const cMaj7 = [[0, 4, 55, 90], [0, 4, 60, 90], [0, 4, 64, 90], [0, 4, 71, 90]];
    eq('c_major_seven_over_an_e_flat_bass_rubs', relations({ ...empty, len: 4, chords: [cMaj7], bass: at([0], 39, 4) })['bc.rub'], 1);
    eq('c_minor_over_an_e_flat_bass_does_not', relations({ ...empty, len: 4, chords: [[[0, 4, 60, 90], [0, 4, 63, 90], [0, 4, 67, 90]]], bass: at([0], 39, 4) })['bc.rub'], 0);
    const rub = relations({ ...empty, len: 4, chords: [cMaj], lead: [[0, 1, 73, 100], [1, 1, 76, 100]] });
    eq('lead_c_sharp_over_c_major_rubs_half_its_notes', rub['lc.rub'], 0.5);
}

/* The order gap groups by which of a metric's two roles was made last. */
eq('group_bass_after_drums', groupOf('bk.lock', ['drums', 'bass', 'chords', 'lead']), 'after');
eq('group_bass_before_drums', groupOf('bk.lock', ['bass', 'lead', 'drums', 'chords']), 'before');
eq('group_one_role_made_first', groupOf('chords.sync', ['chords', 'drums', 'bass', 'lead']), 'before');

/* A one-sided band: more of the bass in its chord is never out of band. */
{
    const rows = [...Array(30).keys()].map((i) => ({ kind: 'public', m: { 'bc.inChord': 0.4 + i / 100, 'bk.neither': i % 10 ? 0 : 1 } }));
    const b = refBands(rows);
    ok('one_sided_band_takes_any_value_above_its_floor', inBand(b['bc.inChord'], 1) && !inBand(b['bc.inChord'], 0.2));
    ok('a_flag_is_in_band_only_unraised', inBand(b['bk.neither'], 0) && !inBand(b['bk.neither'], 1));
}
}
