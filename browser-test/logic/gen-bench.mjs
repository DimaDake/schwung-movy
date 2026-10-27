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
}
