/* browser-test/logic/ai-context.mjs — the Set as text for the model
 * (design §4, §9): clip dumps, duplicate folding, drum names, the harmony map
 * and the size ceiling.
 *
 * Run by browser-test/logic.mjs.
 */

import { _log, eq, ok } from './harness.mjs';
import { parseTrackDump, sceneHarmony, buildContext } from '../../dist/esm/ai/index.js';

/* C E G held for a bar (C3 = 60), then A C E. */
const CHORDS = '0 32 0 1/1 0 0|0.384.60.100,0.384.64.100,0.384.67.100,384.384.57.90,384.384.60.90,384.384.64.90';

function set(over = {}) {
    return {
        bpm: 120, swing: 0, root: 'C', mode: 'major',
        tracks: [
            { index: 0, name: 'Keys', module: 'obxd', drum: false, padNames: null,
              clips: parseTrackDump(0, CHORDS + '\n' + CHORDS.replace(/^0 /, '1 ')) },
            { index: 1, name: 'Drums', module: '8w8', drum: true, padNames: { 36: 'BD', 38: 'SD' },
              clips: parseTrackDump(1, '0 16 0 1/1 0 0|0.12.36.120,96.12.38.100,48.12.42.80') },
        ],
        target: { track: 0, slot: 2 }, source: { track: 0, slot: 0 },
        ...over,
    };
}

export async function run() {
_log('\nTest: AI context');

const clips = parseTrackDump(3, '2 16 4 1/2 -3 70|0.24.60.100,24.12.62.90\n5 16 0 1/1 0 0|');
eq('parse_track_dump_roundtrip: two clips', clips.length, 2);
eq('parse_track_dump_roundtrip: fields', [clips[0].track, clips[0].slot, clips[0].len, clips[0].loopStart,
    clips[0].scaleNum, clips[0].scaleDen, clips[0].transpose, clips[0].quant].join(','), '3,2,16,4,1,2,-3,70');
eq('parse_track_dump_roundtrip: notes', JSON.stringify(clips[0].notes[1]), '{"tick":24,"gate":12,"pitch":62,"vel":90}');
eq('parse_track_dump_roundtrip: empty clip has no notes', clips[1].notes.length, 0);
eq('parse_track_dump: empty dump', parseTrackDump(0, '').length, 0);

const text = buildContext(set());
ok('duplicates_sent_once: same-as line', /scene 2: same as scene 1/.test(text));
eq('duplicates_sent_once: notes listed once', (text.match(/57:A2/g) || []).length, 1);
ok('drum_names_declared_vs_guessed: declared', /36:BD/.test(text) && /38:SD/.test(text));
ok('drum_names_declared_vs_guessed: guessed', /42:CLOSED HAT \(guessed\)/.test(text));
ok('target_and_source_flagged: source', /scene 1 \[SOURCE\]/.test(text));
ok('target_and_source_flagged: empty target', /scene 3 \[TARGET\]: empty/.test(text));

const h = sceneHarmony(parseTrackDump(0, CHORDS), () => false);
eq('harmony_c_major_bar: bar 1', h[0], 'bar 1: C (C E G)');
eq('harmony_c_major_bar: bar 2', h[1], 'bar 2: Am (A C E)');
eq('harmony: drums ignored', sceneHarmony(parseTrackDump(1, '0 16 0 1/1 0 0|0.12.36.120'), () => true)[0], 'bar 1: -');

const tr = sceneHarmony(parseTrackDump(0, '0 16 0 1/1 2 0|0.384.60.100,0.384.64.100,0.384.67.100'), () => false);
eq('transpose_applied_in_harmony_not_in_notes: harmony', tr[0], 'bar 1: D (D F# A)');
ok('transpose_applied_in_harmony_not_in_notes: notes stay stored',
    /60:C3/.test(buildContext(set({ tracks: [{ index: 0, name: 'K', module: 'x', drum: false, padNames: null,
        clips: parseTrackDump(0, '0 16 0 1/1 2 0|0.384.60.100') }], target: { track: 0, slot: 0 }, source: null }))));

/* Loop window bars 2..2 of a 2-bar clip: only bar 2's Am sounds. */
eq('harmony_uses_loop_window_only', sceneHarmony(parseTrackDump(0, CHORDS.replace(/^0 32 0/, '0 16 16')), () => false)[0],
    'bar 1: Am (A C E)');

/* Ceiling: other scenes shrink to their harmony line; target and source never do. */
const big = set();
big.tracks[0].clips.push(...parseTrackDump(0, '4 32 0 1/1 0 0|' + Array.from({ length: 300 },
    (_, i) => `${i * 2}.1.${48 + (i % 12)}.64`).join(',')));
const small = buildContext({ ...big, ceilingBytes: 2500 });
ok('ceiling_shrinks_other_scenes_not_target: scene 5 notes gone', !/scene 5[^\n]*\n\s+bar/.test(small) && /scene 5: harmony only/.test(small));
ok('ceiling_shrinks_other_scenes_not_target: source kept', /scene 1 \[SOURCE\][^\n]*\n\s+bar 1:/.test(small));
ok('ceiling: full context unaffected without a ceiling hit', !/harmony only/.test(buildContext(big)));
}
