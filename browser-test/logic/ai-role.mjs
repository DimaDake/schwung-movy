/* browser-test/logic/ai-role.mjs — Variation keeps the source's role and never
 * returns the same loop (plans/2026-10-27-variation-eight-options.md). The
 * parts are the device Set of 2026-10-27 whose scene 2 prompted the rules:
 * its bass B was the A with the bars swapped, its helm drone became a melody.
 *
 * Run by browser-test/logic.mjs.
 */

import { _log, eq, ok } from './harness.mjs';
import { roleOf, roleBreak, roleText, saneNote, loopMatch, isSameLoop, variationFacts, validateReply, buildPrompt }
    from '../../dist/esm/ai/index.js';

/* tick:gate:pitch, as the Set file stores them (velocity is not compared). */
const P = (s) => s.split(',').map((x) => { const [tick, gate, pitch] = x.split(':').map(Number); return { tick, gate, pitch, vel: 110 }; });
const BASS_A = P('0:15:45,88:7:45,144:11:52,229:15:52,376:17:47,471:13:47,524:14:53,619:12:53,672:15:53');
const BASS_B = P('0:15:47,88:7:47,144:11:53,229:15:53,376:12:45,471:13:45,524:14:52,619:12:52,672:15:52');
const HELM_A = P('132:649:76');
const HELM_B = P('128:240:74,384:192:71,888:240:74,1152:192:69');
const PAD_A = P('7:378:81,11:378:72,3:390:76,391:377:83,389:379:74,386:382:78');
const LEAD_A = P('102:28:76,195:33:72,266:38:71,347:25:69,867:29:76,954:29:72,1026:41:71,1105:31:69,1152:41:71,1250:38:72,384:72:64');
const LEAD_B = P('102:28:74,195:33:71,266:38:69,347:25:67,867:29:74,954:29:71,1026:41:69,1105:31:67,1152:41:69,1250:38:71,384:72:62');
const DRUM_A = P('0:20:36,97:15:37,149:25:36,239:17:36,288:27:37,342:4:42');
const DRUM_B = P('0:20:36,92:15:37,149:25:36,192:6:42,239:17:36,288:27:37,336:6:42,360:4:42');

const steps = (notes) => JSON.stringify(notes.map((n) => [n.tick / 24, n.gate / 24, n.pitch, n.vel]));
const shift = (notes, t, dp = 0) => notes.map((n) => ({ ...n, tick: n.tick + t, pitch: n.pitch + dp }));

export async function run() {
_log('\nTest: AI role + same loop');

eq('role: the helm drone', roleOf(HELM_A, 64, false).kind, 'drone');
eq('role: the dexed chords are a pad', roleOf(PAD_A, 32, false).kind, 'pad');
eq('role: a spread chord is one onset', roleOf(PAD_A, 32, false).onsets, 2);
eq('role: the noisemaker bass', roleOf(BASS_A, 32, false).kind, 'bass');
eq('role: the hank lead', roleOf(LEAD_A, 64, false).kind, 'lead');
eq('role: drums', roleOf(DRUM_A, 16, true).kind, 'drums');
eq('role: an arpeggio', roleOf(Array.from({ length: 16 }, (_, i) => ({ tick: i * 24, gate: 20, pitch: 60 + (i % 4) * 4, vel: 100 })), 16, false).kind, 'arpeggio');
eq('role: stabs', roleOf(P('0:24:60,0:24:64,0:24:67,96:24:60,96:24:64,96:24:67'), 16, false).kind, 'stabs');
eq('role: no notes, no role', roleOf([], 16, false), null);

const drone = roleOf(HELM_A, 64, false);
eq('roleBreak: the drone that became a melody (device 2026-10-27)', roleBreak(HELM_B, drone, 64), 'lengths');
eq('roleBreak: a held note per bar is still a drone (live reply 2026-10-27)', roleBreak(P('132:649:74,516:649:71,900:649:74,1284:240:69'), drone, 64), null);
eq('roleBreak: more than one held note per bar is not', roleBreak(P('0:300:74,192:300:71,384:300:74,576:300:69,768:300:74,960:300:71'), drone, 64), 'onsets');
eq('roleBreak: a line keeps half to double its onsets', roleBreak([...LEAD_A, ...shift(LEAD_A, 48, 2), ...shift(LEAD_A, 504, 4)].map((n) => ({ ...n, tick: n.tick % 1536 })), roleOf(LEAD_A, 64, false), 64), 'onsets');
eq('roleBreak: a drone held on another note is still a drone', roleBreak(P('128:640:74'), drone, 64), null);
eq('roleBreak: two held notes still a drone', roleBreak(P('0:700:74,768:700:71'), drone, 64), null);
eq('roleBreak: short notes are not a drone', roleBreak(P('0:24:74,768:24:71'), drone, 64), 'lengths');
const pad = roleOf(PAD_A, 32, false);
eq('roleBreak: chords turned to single notes', roleBreak(P('0:380:72,384:380:74'), pad, 32), 'voices');
eq('roleBreak: chords kept', roleBreak(P('0:380:72,0:380:76,0:380:79,384:380:74,384:380:77,384:380:81'), pad, 32), null);
eq('roleBreak: more than an octave away', roleBreak(shift(LEAD_B, 0, 15), roleOf(LEAD_A, 64, false), 64), 'register');
eq('roleBreak: drums keep only their density', roleBreak(DRUM_B, roleOf(DRUM_A, 16, true), 16), null);
ok('roleText names the role and its numbers', /a drone \(long held notes\): 1 onsets, 1 notes at once, notes held about 27/.test(roleText(drone, 64)));
ok('roleText gives the onset range the validator checks', /1 to 4 onsets/.test(roleText(drone, 64)));
ok('roleText says not to turn a held note into a melody', /held note into a melody/.test(roleText(drone, 64)));

const g = (n) => saneNote(n, BASS_A, false);
eq('saneNote: a pitch copied into the length is cut back (live reply 2026-10-27)', g({ tick: 144, gate: 52 * 24, pitch: 52, vel: 127 }).gate, 4 * 24);
eq('saneNote: a velocity copied into the pitch is dropped', g({ tick: 144, gate: 11, pitch: 127, vel: 55 }), null);
eq('saneNote: an ordinary note passes', JSON.stringify(g(BASS_A[2])), JSON.stringify(BASS_A[2]));
eq('saneNote: a drone may hold its length', saneNote(HELM_A[0], HELM_A, false).gate, 649);

ok('same loop: the bass with its bars swapped (device 2026-10-27)', isSameLoop(BASS_B, [BASS_A], 32, false));
ok('same loop: the swap scores the rotation', loopMatch(BASS_B, BASS_A, 32, 'loop') >= 0.85 && loopMatch(BASS_B, BASS_A, 32, 'still') < 0.2);
ok('same loop: transposed as a whole', isSameLoop(shift(LEAD_A, 0, 5), [LEAD_A], 64, false));
ok('same loop: a copy', isSameLoop(LEAD_A, [LEAD_A], 64, false));
ok('not same loop: a diatonic sequence changes the intervals', !isSameLoop(LEAD_B, [LEAD_A], 64, false));
ok('not same loop: new notes over the same rhythm', !isSameLoop(P('0:15:45,88:7:48,144:11:50,229:15:52,376:17:43,471:13:47,524:14:50,619:12:48,672:15:45'), [BASS_A], 32, false));
ok('drums: added hats are no same loop', !isSameLoop(DRUM_B, [DRUM_A], 16, true));
ok('drums: the pattern a beat late is the same loop', isSameLoop(P('96:6:36,192:6:38,288:6:36,0:6:38,144:6:42'),
    [P('0:6:36,96:6:38,192:6:36,288:6:38,48:6:42')], 16, true));
ok('a drone on a new pitch is no same loop (one note matches any note moved)', !isSameLoop(P('128:640:74'), [HELM_A], 64, false));
const bar = P('0:6:36,96:6:38,192:6:36,288:6:38');
ok('drums: a bar-repeating groove with one hit added is no rotation', !isSameLoop([...bar, ...shift(bar, 384), ...P('720:6:36')], [[...bar, ...shift(bar, 384)]], 32, true));

const clip = (track, slot, len, notes) => ({ track, slot, len, loopStart: 0, scaleNum: 1, scaleDen: 1, transpose: 0, quant: 0, notes });
const trk = (index, drum, clips) => ({ index, name: `Track ${index + 1}`, module: 'm', drum, padNames: null, clips });
const set = (others) => ({ bpm: 116, swing: 50, root: 'C', mode: 'major', target: { track: 3, slot: 1 }, source: { track: 3, slot: 0 },
    tracks: [trk(0, true, [clip(0, 0, 16, DRUM_A), clip(0, 1, 16, DRUM_B)]), trk(1, false, [clip(1, 0, 32, BASS_A), ...others]),
        trk(3, false, [clip(3, 0, 64, HELM_A)])] });
let f = variationFacts(set([]), 64);
eq('facts: the source role', f.role.kind, 'drone');
eq('facts: a scene with only drums is free', f.harmonySet, false);
eq('facts: the loops are the track\'s other clips', f.loops.length, 1);
f = variationFacts(set([clip(1, 1, 32, BASS_B)]), 64);
eq('facts: another melodic track in the target scene sets the harmony', f.harmonySet, true);

const pv = (facts, drum = false) => buildPrompt('variation', 'CTX', { len: 64, drum, facts }).user;
ok('prompt: asks for eight', /exactly 8 options/.test(pv(f)) && /The 8 options/.test(pv(f)));
ok('prompt: quantize still asks for three', /exactly 3 options/.test(buildPrompt('quantize', 'C', { len: 16, drum: false }).user));
ok('prompt: states the role', pv(f).includes(roleText(f.role, 64)));
ok('prompt: the same-loop rule', /SAME-LOOP RULE[^.]*bars swapped/.test(pv(f)));
ok('prompt: a set scene is followed, not reharmonised', /none reharmonises/.test(pv(f)) && !/move to new chords/.test(pv(f)));
ok('prompt: a free scene moves to new chords, not A\'s reordered', /move to new\s+chords[^.]*never the \[SOURCE\] scene's chords in another order/.test(pv({ ...f, harmonySet: false })));
ok('prompt: the groups 1-4 / 5-6 / 7-8', /Options 1-4 stay close[^.]*5-6 change[^.]*7-8 are experimental/.test(pv(f)));
ok('prompt: drums have kick, fill and feel rungs', /Option 1 \(kick\)[\s\S]*Option 4 \(fill\)[\s\S]*Option 7 \(feel\)/.test(pv(f, true)));
ok('prompt: the level moves only 7-8', (() => {
    const a = buildPrompt('variation', 'C', { len: 64, drum: false, facts: f, level: 'SAFE' }).user.split('\n');
    const b = buildPrompt('variation', 'C', { len: 64, drum: false, facts: f, level: 'WILD' }).user.split('\n');
    const diff = a.filter((l, i) => l !== b[i]);
    return diff.length === 2 && diff.every((l) => /^Option [78] /.test(l));
})());

/* Replies for the bass: new notes on its rhythm, the bass as chords (role),
 * the device's swapped bars (same loop), a near copy of the first, and
 * another new line. */
const NEW1 = P('0:15:45,88:7:48,144:11:50,229:15:52,376:17:43,471:13:47,524:14:50,619:12:48,672:15:45');
const NEW5 = P('0:15:40,88:7:40,144:11:47,229:15:47,376:17:43,471:13:43,524:14:50,619:12:50,672:15:50');
const CHORDS = BASS_A.flatMap((n) => [n, { ...n, pitch: n.pitch + 4 }, { ...n, pitch: n.pitch + 7 }]);
const reply = JSON.stringify({ options: [NEW1, CHORDS, BASS_B, NEW1.map((n) => ({ ...n, vel: 90 })), NEW5]
    .map((notes) => ({ label: 'x', notes: JSON.parse(steps(notes)) })) });
const v = validateReply(reply, { task: 'variation', len: 32, drum: false, original: [], kitPads: [], units: 'steps',
    source: BASS_A, loops: [BASS_A] });
eq('validate: role break, same loop and near copy dropped', v.dropped.join(' '), '2:role voices 3:same loop 4:near copy');
eq('validate: the survivors keep their ladder slots', v.slots.join(','), '0,4');
eq('validate: quantize never checks a role (three asked)', validateReply(reply, { task: 'quantize', len: 32, drum: false, original: [], kitPads: [], units: 'steps' }).options.length, 3);
}
