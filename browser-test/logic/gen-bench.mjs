/* browser-test/logic/gen-bench.mjs — the pure parts of the generator bench
 * (plans/2026-10-27-generators-quality-design.md): MIDI reading, messing a
 * part up, our own patterns. The bench itself needs the network and a key and
 * never runs here.
 *
 * Run by browser-test/logic.mjs.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { _log, eq, ok } from './harness.mjs';
import { parseMidi } from '../../scripts/gen-bench/midi.mjs';
import { messify } from '../../scripts/gen-bench/messify.mjs';
import { scoreOption, scoreReply, difference, bAlignment, recovery } from '../../scripts/gen-bench/score.mjs';
import { parseTrackDump, sceneChords, sceneHarmony } from '../../dist/esm/ai/index.js';

const PATTERNS = new URL('../../scripts/gen-bench/patterns/', import.meta.url);

/* Format 0, 480 per quarter: C4 for a quarter, then D4 (running status) for
 * an eighth closed by a note-off; the first note is closed by note-on vel 0. */
const SMF = Uint8Array.from([
    0x4D, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xE0,
    0x4D, 0x54, 0x72, 0x6B, 0, 0, 0, 20,
    0x00, 0x90, 60, 100,
    0x83, 0x60, 60, 0,
    0x00, 62, 80,
    0x81, 0x70, 0x80, 62, 0,
    0x00, 0xFF, 0x2F, 0x00,
]);

export async function run() {
_log('\nTest: generator bench');

const m = parseMidi(SMF);
const notes = m.tracks.flatMap((t) => t.notes);
eq('midi_parses_running_status', JSON.stringify(notes),
    '[{"tick":0,"gate":96,"pitch":60,"vel":100},{"tick":96,"gate":48,"pitch":62,"vel":80}]');
eq('midi_note_on_vel0_is_off: the first note ends at the vel-0 note-on', notes[0]?.gate, 96);

const part = Array.from({ length: 16 }, (_, i) => ({ tick: i * 48, gate: 24, pitch: 60 + (i % 5), vel: 100 }));
const dev = [5, -7, 9, -3, 11, -6, 2, -10];
eq('messify_is_deterministic', JSON.stringify(messify(part, dev, 7)), JSON.stringify(messify(part, dev, 7)));
ok('messify changes the part', JSON.stringify(messify(part, dev, 7)) !== JSON.stringify(part));
ok('messify_keeps_note_count_within_one', Math.abs(messify(part, dev, 3).length - part.length) <= 1);

const files = readdirSync(PATTERNS).filter((f) => f.endsWith('.json'));
ok('patterns: at least 8 groovebox idioms', files.length >= 8);
const bad = files.filter((f) => {
    const p = JSON.parse(readFileSync(new URL(f, PATTERNS), 'utf8'));
    if (!p.genre || !Array.isArray(p.tracks) || p.tracks.length < 2) return true;
    return p.tracks.some((t) => t.clips.some((c) => !c.notes.length
        || c.notes.some((n) => n.tick < 0 || n.tick >= c.len * 24 || n.gate < 1)));
});
eq('patterns_are_valid_sets', bad.join(','), '');

/* Scores (Task 2). */
const CHORDS = '0 32 0 1/1 0 0|0.384.60.100,0.384.64.100,0.384.67.100,384.384.57.90,384.384.60.90,384.384.64.90';
const sc = sceneChords(parseTrackDump(0, CHORDS), () => false);
eq('scene_chords_match_harmony_text: bar 1', `${sc[0].name} ${sc[0].pcs.join(',')}`, 'C 0,4,7');
eq('scene_chords_match_harmony_text: bar 2', sc[1].name, 'Am');
eq('sceneHarmony still formats the same', sceneHarmony(parseTrackDump(0, CHORDS), () => false)[1], 'bar 2: Am (A C E)');

const n = (tick, pitch, gate = 24) => ({ tick, gate, pitch, vel: 100 });
const setWith = (others, drum = false) => ({ bpm: 120, swing: 0, root: 'C', mode: 'major',
    tracks: [{ index: 0, name: 'T', module: 'x', drum, padNames: null, clips: [] }, ...others],
    target: { track: 0, slot: 0 }, source: null });
const keys = (notes) => ({ index: 1, name: 'K', module: 'x', drum: false, padNames: null,
    clips: [{ track: 1, slot: 0, len: 16, loopStart: 0, scaleNum: 1, scaleDen: 1, transpose: 0, quant: 0, notes }] });
const ctx = (set, input, extra = {}) => ({ set, input, reference: null, a: null, len: 16, drum: false, task: 'quantize', ...extra });

/* Ab major (borrowed bVI in C): its own tones beat in-key notes that clash. */
const abSet = setWith([keys([n(0, 56, 384), n(0, 60, 384), n(0, 63, 384)])]);
const borrowed = [n(0, 68, 96), n(96, 72, 96), n(192, 75, 96)];
const clash = [n(0, 74, 96), n(96, 71, 96), n(192, 74, 96)];
ok('fit_rewards_chord_tones_not_key', scoreOption(borrowed, ctx(abSet, borrowed)).fit > scoreOption(clash, ctx(abSet, clash)).fit + 0.3);

const cSet = setWith([keys([n(0, 48, 384), n(0, 52, 384), n(0, 55, 384)])]);
const run = [n(0, 60), n(24, 61), n(48, 62), n(72, 63), n(96, 64)];
ok('fit_forgives_weak_chromatic_passing', scoreOption(run, ctx(cSet, run)).fit >= 0.9);

/* Drums swung: odd 16ths 8 ticks late. A hat that follows them sits in the
 * groove; a straight one does not. */
const swungDrums = { index: 1, name: 'D', module: 'x', drum: true, padNames: null,
    clips: [{ track: 1, slot: 0, len: 16, loopStart: 0, scaleNum: 1, scaleDen: 1, transpose: 0, quant: 0,
        notes: Array.from({ length: 16 }, (_, i) => n(i * 24 + (i % 2 ? 8 : 0), 42)) }] };
const gSet = setWith([swungDrums]);
const swung = Array.from({ length: 8 }, (_, i) => n(i * 48 + 24 + 8, 60));
const straight = Array.from({ length: 8 }, (_, i) => n(i * 48 + 24, 60));
ok('groove_follows_scene_onsets_not_grid', scoreOption(swung, ctx(gSet, swung)).groove > scoreOption(straight, ctx(gSet, straight)).groove + 0.5);

const full = Array.from({ length: 8 }, (_, i) => n(i * 48, 60));
const half = full.slice(0, 4);
ok('usable_flags_empty_last_half', !scoreOption(half, ctx(cSet, full)).usable);
ok('a full option is usable', scoreOption(full.map((x) => ({ ...x, pitch: 64 })), ctx(cSet, full)).usable);
eq('difference_identical_is_zero', difference(full, full), 0);
eq('recovery_perfect_on_reference', recovery(full, full, false), 1);

const A = Array.from({ length: 8 }, (_, i) => n(i * 48, 60 + (i % 3)));
const B = Array.from({ length: 6 }, (_, i) => n(i * 64, 65 + (i % 2) * 4));
ok('b_alignment_prefers_real_b_over_copy_of_a: B ≈ 1', bAlignment(B, A, B) > 0.95);
ok('b_alignment_prefers_real_b_over_copy_of_a: A ≈ 0', bAlignment(A, A, B) < 0.05);
const r3 = scoreReply([full, full.map((x) => ({ ...x, pitch: 64 })), full.map((x) => ({ ...x, pitch: 67 }))], ctx(cSet, full.map((x) => ({ ...x, tick: x.tick + 3 })), { reference: full }));
eq('scoreReply: alignment is the best option', r3.alignment, 1);
ok('scoreReply: the gate passes three different usable options', r3.gatePassed);
}
