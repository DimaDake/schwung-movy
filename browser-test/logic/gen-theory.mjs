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
const moves = G.harmonicMoves(prog, C);
eq('moves_same_first', moves[0].name, 'SAME');
eq('moves_iv_sequence', moves.find((m) => m.name === 'IV SEQ')?.chords.map(name).join(' '), 'F C DM G');
ok('moves_never_two_alike', new Set(moves.map((m) => m.chords.map(name).join() + m.pedal)).size === moves.length);
/* MEDIANT (once WILD's own) sits past the rest, at HARMONY's far end. */
ok('moves_mediant_at_the_far_end', moves.some((m) => m.name === 'MEDIANT') && moves.filter((m) => m.name === 'MEDIANT').every((m) => m.ext && moves.indexOf(m) >= moves.findIndex((x) => x.ext)));
ok('moves_ordered_close_to_far', moves.every((m, i) => i === 0 || m.dist >= moves[i - 1].dist));
const vamp = G.harmonicMoves([G.chordOf(9, 'min'), G.chordOf(9, 'min')], am);
ok('moves_a_one_chord_vamp_still_gets_somewhere', vamp.length >= 3);

/* Connection: fifths strong, tritones weak, a section judged in AND out. */
ok('connect_fifth_beats_tritone', G.connection(G.chordOf(0, 'maj'), G.chordOf(7, 'maj')) > G.connection(G.chordOf(0, 'maj'), G.chordOf(6, 'maj')));
ok('connect_tritone_section_drops', G.sectionConnection([G.chordOf(0, 'maj')], [G.chordOf(6, 'maj')]) < G.DROP_BELOW);
ok('tolerates_a_pinned_ninth', G.tolerates(Cmaj, [2], (c) => G.colourPcs(c, C)) && !G.tolerates(Cmaj, [1], (c) => G.colourPcs(c, C)));

/* The Set's scales (seq/scales.ts names) as a key: every minor-family name is
 * minor (Harm Min, Blues… once read as major), the four 7-note modes carry
 * their degrees, the rest take their parent key. */
const hint = (m) => { const h = G.keyHint('D', m); return `${h.minor ? 'm' : 'M'}${h.mode ? h.mode.join('') : ''}`; };
eq('set_scale_minor_family_is_minor', ['minor', 'locrian', 'harm min', 'mel min', 'min penta', 'blues'].map(hint).join(' '), 'm m m m m m');
eq('set_scale_major_family_is_major', ['major', 'maj penta', 'chromatic'].map(hint).join(' '), 'M M M');
eq('set_scale_modes_carry_their_degrees', ['dorian', 'phrygian', 'lydian', 'mixolydian'].map(hint).join(' '),
    'm02357910 m01357810 M02467911 M02457910');

/* The mode is used only where the notes heard agree with it. */
const dDor = G.keyHint('D', 'dorian');
eq('mode_a_silent_scene_takes_the_sets_mode', G.keyFor(Array(12).fill(0), dDor).mode?.join(), G.DORIAN.join());
eq('mode_notes_in_the_mode_keep_it', G.keyFor(prof([2, 4, 5, 7, 9, 11, 0], 2), dDor).mode?.join(), G.DORIAN.join());
/* A sparse bass in the Set's key, with a chromatic approach note: its profile
 * (from the paths bench, D minor, drums then BASS) correlates best with G
 * major, whose chords then put F# and B over a Bb bass. The notes all sit in
 * D minor, so the key signature holds; an A minor riff in a C major Set still
 * reads as A minor, and notes that leave the scale still move the key. */
{
    const dmBass = [0.125, 0.063, 0.172, 0, 0.109, 0.078, 0, 0.266, 0, 0.109, 0.078, 0];
    const dm = G.keyHint('D', 'minor');
    eq('key_sparse_bass_in_the_sets_key_keeps_its_signature', [5, 2].includes(G.keyFor(dmBass, dm).tonic) && G.keyFor(dmBass, dm).minor === (G.keyFor(dmBass, dm).tonic === 2), true);
    const am = G.keyFor(prof([0, 2, 4, 5, 7, 9, 11], 9), G.keyHint('C', 'major'));
    eq('key_relative_minor_riff_in_a_major_set_reads_minor', `${am.tonic}${am.minor ? 'm' : ''}`, '9m');
    const eMinor = G.keyFor(prof([4, 6, 7, 9, 11, 0, 2], 4), G.keyHint('C', 'major'));
    eq('key_notes_out_of_the_sets_scale_still_move_it', `${eMinor.tonic}${eMinor.minor ? 'm' : ''}`, '4m');
}
eq('mode_a_heard_b_flat_drops_it', G.keyFor(prof([2, 4, 5, 7, 9, 10, 0], 2), dDor).mode, undefined);

/* A mode's chords: its own, a stand-in that carries its odd note where the
 * triad breaks (Dorian vi° → IV), and natural minor's where no mode is set. */
const kd = { tonic: 2, minor: true, score: 0, mode: G.DORIAN };
eq('mode_dorian_iv_is_major', name(G.diatonic(kd, 3)), 'G');
eq('mode_dorian_vi_stands_in_as_iv', name(G.diatonic(kd, 5)), 'G');
eq('mode_plain_minor_vi_unchanged', name(G.diatonic({ tonic: 2, minor: true, score: 0 }, 5)), 'A#');
eq('mode_lydian_ii_is_major', name(G.diatonic({ tonic: 0, minor: false, score: 0, mode: G.LYDIAN }, 1)), 'D');

/* Retuning keeps each note's degree; the tonic moves the shorter way. */
const cM0 = { tonic: 0, minor: false, score: 0 };
eq('retune_c_major_to_d_major', [60, 64, 67, 61].map((p) => G.retune(p, cM0, { tonic: 2, minor: false, score: 0 })).join(), '62,66,69,63');
eq('retune_c_major_to_c_minor', [60, 64, 67, 71].map((p) => G.retune(p, cM0, { tonic: 0, minor: true, score: 0 })).join(), '60,63,67,70');
eq('retune_c_to_a_goes_down', G.retune(60, cM0, { tonic: 9, minor: false, score: 0 }), 57);
eq('retune_c_major_to_c_dorian', [64, 69, 71].map((p) => G.retune(p, cM0, { ...cM0, minor: true, mode: G.DORIAN })).join(), '63,69,70');
}
