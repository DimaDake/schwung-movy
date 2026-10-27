/* browser-test/logic/gen-theory.mjs — the algorithmic generators' music
 * theory (plans/2026-10-27-algorithmic-generators-design.md §2-§3): keys,
 * chords from sounding notes, Roman numerals, note categories, voice leading,
 * the harmonic moves and how chords connect.
 *
 * Run by browser-test/logic.mjs.
 */

import { _log, eq, ok } from './harness.mjs';
import * as G from '../../dist/esm/gen/index.js';

const seg = (pitches, bass) => {
    const w = Array(12).fill(0);
    for (const p of pitches) w[((p % 12) + 12) % 12] += 100;
    return { w, bass: bass ?? Math.min(...pitches), total: pitches.length * 100 };
};
const name = (c) => G.chordName(c);

export async function run() {
_log('\nTest: generator theory');

/* Keys: a C major scale profile, an A minor one (same notes, tonic weight). */
const prof = (pcs, tonic) => { const w = Array(12).fill(0); for (const p of pcs) w[p] += 1; w[tonic] += 2; w[(tonic + 7) % 12] += 1; return w; };
const cM = G.findKey(prof([0, 2, 4, 5, 7, 9, 11], 0));
eq('key_c_major', `${cM.tonic}${cM.minor ? 'm' : ''}`, '0');
const aM = G.findKey(prof([0, 2, 4, 5, 7, 9, 11], 9));
eq('key_a_minor_from_the_same_notes', `${aM.tonic}${aM.minor ? 'm' : ''}`, '9m');
eq('key_hint_breaks_a_flat_profile_tie', G.findKey(Array(12).fill(1), { tonic: 2, minor: true }).tonic, 2);

/* Chords from what sounds. */
const am = { tonic: 9, minor: true, score: 1 };
eq('chord_triad', name(G.detectChord(seg([57, 60, 64]), am)), 'AM');
eq('chord_seventh_when_all_four_sound', name(G.detectChord(seg([57, 60, 64, 67]), am)), 'AM7');
eq('chord_bare_fifth_reads_as_the_keys_triad', name(G.detectChord(seg([53, 60]), am)), 'F');
eq('chord_slash_bass_keeps_the_root', name(G.detectChord(seg([52, 57, 60, 64], 52), am)), 'AM');
eq('chord_nothing_sounds', G.detectChord({ w: Array(12).fill(0), bass: -1, total: 0 }, am), null);
const held = G.chordsOf([seg([57, 60, 64]), { w: Array(12).fill(0), bass: -1, total: 0 }, seg([53, 57, 60])], am).map(name).join(' ');
eq('chords_an_empty_half_bar_holds_the_chord_before', held, 'AM AM F');

/* Roman numerals and the diatonic chord on a degree. */
const C = { tonic: 0, minor: false, score: 1 };
eq('roman_v7', G.roman(G.chordOf(7, '7'), C), 'V7');
eq('roman_vi', G.roman(G.chordOf(9, 'min'), C), 'vi');
eq('diatonic_ii7_in_c', name(G.diatonic(C, 1, true)), 'DM7');
eq('shift_degrees_I_to_IV', name(G.shiftDegrees(G.chordOf(0, 'maj'), C, 3)), 'F');
eq('shift_keeps_a_sus', name(G.shiftDegrees(G.chordOf(0, 'sus4'), C, 4)), 'GS4');

/* Categories, after Impro-Visor: chord, colour, approach, other. */
const Cmaj = G.chordOf(0, 'maj');
eq('cat_chord_tone', G.categoryOf(64, Cmaj, C), 'chord');
eq('cat_ninth_is_colour', G.categoryOf(62, Cmaj, C), 'colour');
eq('cat_eleventh_over_major_is_not_colour (avoid note)', G.categoryOf(65, Cmaj, C) === 'colour', false);
eq('cat_eleventh_over_minor_is_colour', G.categoryOf(62, G.chordOf(9, 'min'), am), 'colour');
eq('cat_chromatic_neighbour_is_approach', G.categoryOf(63, Cmaj, C), 'approach');
ok('clash_semitone_against_a_chord_tone', G.clashes(61, Cmaj) && !G.clashes(62, Cmaj));
ok('fit_strong_beat_clash_scores_zero_ish', G.noteFit(61, Cmaj, C, true) < 0.2 && G.noteFit(64, Cmaj, C, true) === 1);

/* Voice leading: each voice moves as little as it can, the third survives. */
const v = G.voiceLead([60, 64, 67], G.chordOf(5, 'maj').pcs, [9, 5, 0], 48, 84);
eq('voice_lead_C_to_F_is_the_close_inversion', v.join(' '), '60 65 69');
eq('voice_movement_counts_semitones', G.movement([60, 64, 67], [60, 65, 69]), 3);
const four = G.voiceLead([57, 60, 64, 67], G.chordOf(5, 'maj7').pcs, [9, 5, 4, 0], 48, 84);
ok('voice_lead_covers_the_third', four.some((p) => p % 12 === 9));

/* Scale steps and Euclid. */
eq('step_scale_C_up_two_in_C', G.stepScale(60, 2, C), 64);
eq('step_scale_down_wraps_octave', G.stepScale(60, -1, C), 59);
eq('step_scale_in_A_minor', G.stepScale(69, 2, am), 72);
eq('euclid_tresillo', G.euclid(3, 8).map((x) => (x ? 'x' : '.')).join(''), 'x..x..x.');
eq('euclid_rotated', G.euclid(3, 8, 1).map((x) => (x ? 'x' : '.')).join(''), '.x..x..x');

/* Harmonic moves from I–V–vi–IV in C: SAME first, nothing that sounds alike twice. */
const prog = [G.chordOf(0, 'maj'), G.chordOf(7, 'maj'), G.chordOf(9, 'min'), G.chordOf(5, 'maj')];
const moves = G.harmonicMoves(prog, C, false);
eq('moves_same_first', moves[0].name, 'SAME');
eq('moves_iv_sequence', moves.find((m) => m.name === 'IV SEQ')?.chords.map(name).join(' '), 'F C DM G');
ok('moves_never_two_alike', new Set(moves.map((m) => m.chords.map(name).join() + m.pedal)).size === moves.length);
ok('moves_mediant_only_when_wild', !moves.some((m) => m.name === 'MEDIANT') && G.harmonicMoves(prog, C, true).some((m) => m.name === 'MEDIANT'));
ok('moves_ordered_close_to_far', moves.every((m, i) => i === 0 || m.dist >= moves[i - 1].dist));
const vamp = G.harmonicMoves([G.chordOf(9, 'min'), G.chordOf(9, 'min')], am, false);
ok('moves_a_one_chord_vamp_still_gets_somewhere', vamp.length >= 3);

/* Connection: fifths strong, tritones weak, a section judged in AND out. */
ok('connect_fifth_beats_tritone', G.connection(G.chordOf(0, 'maj'), G.chordOf(7, 'maj')) > G.connection(G.chordOf(0, 'maj'), G.chordOf(6, 'maj')));
ok('connect_tritone_section_drops', G.sectionConnection([G.chordOf(0, 'maj')], [G.chordOf(6, 'maj')]) < G.DROP_BELOW);
ok('tolerates_a_pinned_ninth', G.tolerates(Cmaj, [2], (c) => G.colourPcs(c, C)) && !G.tolerates(Cmaj, [1], (c) => G.colourPcs(c, C)));
}
