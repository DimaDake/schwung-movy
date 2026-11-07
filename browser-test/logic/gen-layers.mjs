/* browser-test/logic/gen-layers.mjs — parts layered on parts (plans/2026-11-07-
 * generation-paths-bench.md, round 6): the layers bench's metrics on
 * hand-written scenes, and the generators' second lines and new lines
 * beside others.
 *
 * Run by browser-test/logic.mjs.
 */

import { _log, eq, ok } from './harness.mjs';
import * as G from '../../dist/esm/gen/index.js';
import { createInput } from '../gen-fixtures.mjs';
import { layers, lineKind } from '../../scripts/gen-bench/quality/layers.mjs';

/* Notes in beats: [start, dur, pitch, vel]; steps are 16ths. */
const at = (steps, pitch, dur = 0.25, vel = 100) => steps.map((s) => [s / 4, dur, pitch, vel]);
const chord = (s, ps, dur = 4) => ps.map((p) => [s / 4, dur, p, 90]);
const scene = (o) => ({ len: 16, drums: [], bass: [], chords: [], lines: [], ...o });
const eighths = (n) => [...Array(n).keys()].map((k) => k * 2);
const pcOf = (p) => ((p % 12) + 12) % 12;

export async function run() {
_log('\nTest: layers (chords on chords, two lines, loops, the arrangement)');

/* Two chord parts: a C pad under an E minor stab is Cmaj7, one chord; a C# stab is not. */
{
    const pad = [0, 16, 32, 48].flatMap((s) => chord(s, [48, 52, 55]));
    eq('two_chord_parts_making_one_chord_agree', layers(scene({ chords: [pad, [0, 16, 32, 48].flatMap((s) => chord(s, [64, 67, 71], 1))] }))['cc.agree'], 1);
    ok('a_stab_a_semitone_off_the_pad_rubs', layers(scene({ chords: [pad, [0, 16, 32, 48].flatMap((s) => chord(s, [61, 65, 68], 1))] }))['cc.rub'] > 0.5);
}

/* Two lines: a harmony in diatonic 3rds is one line doubled, meant; the same
 * rhythm in 2nds is a smear; a second line on the off-beats is independent. */
{
    /* A melodic rhythm, not even 8ths (those are an arp's). */
    const steps = [0, 1, 2, 3, 4, 5, 6, 7].flatMap((b) => [0, 3, 4, 6, 10, 12].map((s) => b * 16 + s)).slice(0, 32);
    const lead = steps.map((s, i) => [s / 4, 0.4, [72, 74, 76, 77][i % 4], 100]);
    const thirds = steps.map((s, i) => [s / 4, 0.4, [69, 71, 72, 74][i % 4], 90]);
    const seconds = steps.map((s, i) => [s / 4, 0.4, [70, 72, 74, 75][i % 4], 90]);
    const m3 = layers(scene({ lines: [lead, thirds] })), m2 = layers(scene({ lines: [lead, seconds] }));
    ok('a_harmony_in_thirds_is_a_double', m3['ll.double'] === 1 && m3['ll.smear'] === 0 && m3['ll.indep'] === undefined);
    eq('the_same_rhythm_in_seconds_smears', m2['ll.smear'], 1);
    const off = steps.map((s, i) => [(s + 1) / 4, 0.2, [60, 62, 64][i % 3], 90]);
    ok('a_line_on_the_offbeats_is_independent', layers(scene({ lines: [lead, off] }))['ll.indep'] > 0.85);
    eq('an_even_busy_line_is_an_arp', lineKind(at([...Array(64).keys()].filter((s) => s % 2 === 0), 72), 64), 'arp');
    eq('a_held_line_is_a_drone', lineKind([[0, 8, 48, 90], [8, 8, 48, 90]], 64), 'drone');
}

/* A short loop over changing chords: a flat 9th over the chord of a repeat
 * is the fault, a major 7th under one is colour. */
{
    const prog = [...chord(0, [60, 64, 67], 4), ...chord(16, [65, 69, 72], 4)];
    const loop = (p) => layers({ len: 8, drums: [], bass: [], chords: [prog], lines: [at([0, 4, 8, 12, 16, 20, 24, 28], p, 0.5)], loops: { bass: 0, chords: [8], lines: [4] } });
    eq('a_loop_a_flat_ninth_over_the_next_chord_rubs', loop(66)['loop.rub'], 0.5);
    eq('a_loop_a_major_seventh_under_it_does_not', loop(64)['loop.rub'], 0);
}

/* The arrangement: an empty middle, with parts below and above it. */
{
    const low = at(eighths(8), 36), high = at(eighths(8), 86), higher = at(eighths(8).map((s) => s + 1), 88);
    eq('a_scene_with_no_middle_has_a_gap', layers(scene({ bass: low, lines: [high, higher] }))['reg.gap'], 1);
    eq('one_with_a_middle_has_none', layers(scene({ bass: low, lines: [high, at(eighths(8), 64)] }))['reg.gap'], 0);
}

/* The generators: a second line is consonant with the melody it sings with,
 * and keeps the melody's own notes; a new line keeps out of another line's
 * register; a line leans on the rhythm section, not on the lead beside it. */
{
    G.forgetOptions();
    const r = G.generateAll(createInput(false, 'locked', 21, { melody: true }));
    const melody = r.ctx.input.tracks.find((t) => t.index === 5).clips[0].notes;
    for (const id of ['n-harmonize', 'n-follow']) {
        const p = r.picks.find((x) => x.preset.id === id);
        const iv = p.notes.map((n) => melody.find((m) => m.tick === n.tick)).map((m, i) => (m ? pcOf(m.pitch - p.notes[i].pitch) : null)).filter((x) => x !== null);
        const rub = iv.filter((x) => [1, 2, 10, 11].includes(x)).length;
        ok(`${id}_is_consonant_with_its_melody`, iv.length > 0 && rub <= 0.1 * iv.length, `${rub} of ${iv.length}`);
    }
    const input = createInput(false, 'empty', 4);
    const lead = [0, 4, 8, 12, 16, 20, 24, 28].map((s, i) => ({ tick: s * G.TPS, gate: 3 * G.TPS, pitch: [72, 74, 76, 74][i % 4], vel: 100 }));
    input.tracks.push({ index: 1, name: 'Lead', module: 'obxd', drum: false, padNames: null,
        clips: [{ track: 1, slot: 1, len: 32, loopStart: 0, scaleNum: 1, scaleDen: 1, transpose: 0, quant: 0, notes: lead }] });
    const ctx = G.prepare(input);
    const mine = lead.map((n) => ({ ...n, pitch: n.pitch - 1, tick: n.tick + G.TPS * 2 }));
    const moved = G.clearLines(ctx, mine);
    eq('a_new_line_in_another_lines_register_moves_an_octave', Math.abs(moved[0].pitch - mine[0].pitch), 12);
    const lean = G.bandLean(ctx);
    eq('a_line_does_not_lean_on_the_lead_beside_it', [0, 4, 8, 12].map(lean).join(), '0,0,0,0');
}
}
