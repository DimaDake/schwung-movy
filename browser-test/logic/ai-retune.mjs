/* browser-test/logic/ai-retune.mjs — the Set's key moved under live New Clip
 * sessions (src/ai/preview-retune.ts): a part made from nothing follows it,
 * open or parked, and parts made side by side in one scene follow together;
 * one that hears a clip no live New Clip made stays where it is.
 *
 * Run by browser-test/logic.mjs.
 */

import { _log, eq, ok, installMockEngine, uninstallMockEngine, seqEngineTick, resetSeqEngine,
    selectTrack, resetUndoState, resetUndoGroups, keyboardState } from './harness.mjs';
import { openPreview, aiPreviewTick, previewSwitch, resetAiJob, knobsCtx, previewInputOpen } from '../../dist/esm/ai/index.js';
import { seqState } from '../../dist/esm/seq/state.js';
import * as G from '../../dist/esm/gen/index.js';
import { createInput } from '../gen-fixtures.mjs';

const SLOT = 1;
const pcOf = (p) => ((p % 12) + 12) % 12;
const pitches = (opts) => opts.map((ns) => ns.map((n) => n.pitch));

let eng;
function boot() {
    resetUndoState(); resetUndoGroups(); resetAiJob();
    eng = installMockEngine();
    keyboardState.rootPc = 0;
    keyboardState.scale = 0;   // C major
    for (const t of [0, 1, 2]) { seqState.session[t].selected = SLOT; seqState.session[t].playing = -1; seqState.session[t].exist = 0; }
    seqState.sessionMode = false;
    seqState.watchLane = 36;
    selectTrack(0);
    seqEngineTick();
    aiPreviewTick();   // the key as it stands is seen once, before any change
}
function ops() { seqEngineTick(); const o = eng.ops.slice(); eng.ops.length = 0; return o; }
function ticks(n = 2) { for (let i = 0; i < n; i++) aiPreviewTick(); return ops(); }
function done() { resetAiJob(); uninstallMockEngine(); resetSeqEngine(); }

/* A New Clip run on `track` in the scene as `others` hold it, opened there. */
function open(track, others = []) {
    const base = createInput(false, 'empty', 1 + track);
    const input = { ...base, target: { track, slot: SLOT },
        tracks: [{ index: track, name: 'T', module: 'obxd', drum: false, padNames: null, clips: [] }, ...others] };
    G.forgetOptions();
    const r = G.generateAll(input);
    selectTrack(track);
    seqEngineTick();
    openPreview({ task: 'create', track, slot: SLOT, orig: null, options: r.picks.map((p) => p.notes), len: 32, scaleNum: 1, scaleDen: 1,
        gen: { ctx: r.ctx, picks: r.picks.map((p) => ({ preset: p.preset, knobs: [...p.knobs] })) } });
    seqState.session[track].exist |= 1 << SLOT;
    ticks();
    return previewInputOpen();
}
const clipOf = (track, notes) => ({ index: track, name: 'T', module: 'obxd', drum: false, padNames: null,
    clips: [{ slot: SLOT, len: 32, notes }] });

export async function run() {
_log('\nTest: generator sessions follow the Set key');

/* One session, open: C major → D major moves every note up a tone. */
boot();
let p = open(0);
previewSwitch(1);
ticks();
const before = pitches(p.options);
keyboardState.rootPc = 2;
let o = ticks();
eq('retune_open_every_option_up_a_tone', JSON.stringify(pitches(p.options)), JSON.stringify(before.map((ns) => ns.map((x) => x + 2))));
ok('retune_open_the_option_showing_is_rewritten', o.some((x) => x.startsWith(`aiclip 0 ${SLOT} `)));
eq('retune_open_knobs_answer_the_new_key', knobsCtx().key.tonic, 2);
/* Major → minor: D major's F# (its third) becomes F, its fifth stays. */
const thirds = p.options.flat().filter((n) => pcOf(n.pitch) === 6).length;
const fifths = p.options.flat().filter((n) => pcOf(n.pitch) === 9).length;
keyboardState.scale = 1;   // Minor
ticks();
ok('retune_minor_the_thirds_go_flat', thirds > 0 && p.options.flat().filter((n) => pcOf(n.pitch) === 5).length >= thirds
    && !p.options.flat().some((n) => pcOf(n.pitch) === 6));
eq('retune_minor_the_fifths_stay', p.options.flat().filter((n) => pcOf(n.pitch) === 9).length, fifths);
eq('retune_minor_knobs_answer_minor', knobsCtx().key.minor, true);
/* Major to its pentatonic changes no note: nothing is rewritten. */
keyboardState.scale = 0;
ticks();
const steady = JSON.stringify(pitches(p.options));
keyboardState.scale = 9;   // Maj Penta
o = ticks();
ok('retune_same_scale_family_writes_nothing', JSON.stringify(pitches(p.options)) === steady && !o.some((x) => x.startsWith('aiclip')));
done();

/* Two sessions side by side in one scene, the first parked: both follow. */
boot();
const a = open(0);
const b = open(1, [clipOf(0, a.options[0])]);   // parks track 0's
const aBefore = pitches(a.options), bBefore = pitches(b.options);
keyboardState.rootPc = 7;   // C → G: down a fourth, the shorter way
o = ticks();
eq('retune_parked_moves_too', JSON.stringify(pitches(a.options)), JSON.stringify(aBefore.map((ns) => ns.map((x) => x - 5))));
eq('retune_beside_it_moves_with_it', JSON.stringify(pitches(b.options)), JSON.stringify(bBefore.map((ns) => ns.map((x) => x - 5))));
ok('retune_parked_clip_is_rewritten', o.some((x) => x.startsWith(`aiclip 0 ${SLOT} `)));
done();

/* A session that hears a hand-made clip took its key from it: it stays. */
boot();
seqState.session[2].exist |= 1 << SLOT;
const c = open(0, [clipOf(2, [{ tick: 0, gate: 96, pitch: 57, vel: 100 }, { tick: 0, gate: 96, pitch: 60, vel: 100 }, { tick: 0, gate: 96, pitch: 64, vel: 100 }])]);
const cBefore = JSON.stringify(pitches(c.options));
keyboardState.rootPc = 2;
o = ticks();
eq('retune_a_hand_made_clip_holds_the_key', JSON.stringify(pitches(c.options)), cBefore);
ok('retune_held_session_is_not_rewritten', !o.some((x) => x.startsWith('aiclip')));
done();
}
