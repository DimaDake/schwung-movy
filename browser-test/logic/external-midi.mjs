/* browser-test/logic/external-midi.mjs — a USB-A keyboard (cable 2): the route
 * the engine is pushed (extmap) and the recording the UI forwards.
 *
 * Run by browser-test/logic.mjs.
 */

import { eq, lastMusicalOp, _log } from './harness.mjs';

export async function run() {
    _log('\nexternal MIDI keyboard:');
    const { installMockEngine, uninstallMockEngine } = await import('../mock-engine.mjs');
    const { seqEngineTick, resetSeqEngine } = await import('../../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');
    const { resetStepRec } = await import('../../dist/esm/seq/step-rec.js');
    const { resetSeqChord } = await import('../../dist/esm/seq/router-pads.js');
    const { selectTrack } = await import('../../dist/esm/track/focus.js');
    const { appState } = await import('../../dist/esm/app/state.js');
    const { onMidiMessageExternal } = await import('../../dist/esm/midi/external.js');

    const engine = installMockEngine();
    const reset = () => { resetSeqEngine(); resetSeqState(); resetStepRec(); resetSeqChord(); engine.reset(); };
    const lastOp = () => lastMusicalOp(engine.ops);
    const ext = (...b) => { onMidiMessageExternal(b); seqEngineTick(); };

    /* Fake the active track's synth slot as a drum rack (or not). */
    const setDrum = (t, cfg) => {
        const prev = appState.trackModels[t];
        appState.trackModels[t] = [prev?.[0], { getDrumConfig: () => cfg }, ...(prev?.slice(2) ?? [])];
        return () => { appState.trackModels[t] = prev; };
    };

    reset();
    selectTrack(3);
    seqEngineTick(); seqEngineTick();   // the first tick only boots the engine
    eq('a melodic track routes the keyboard to its chain', engine.params.extmap, '3');

    selectTrack(5);
    seqEngineTick();
    eq('a track switch re-routes it', engine.params.extmap, '5');

    /* Session view changes what the PADS mean, not the keyboard. */
    seqState.sessionMode = true;
    seqEngineTick();
    eq('Session view keeps the keyboard on the track', engine.params.extmap, '5');
    seqState.sessionMode = false;

    /* Recording: a key is recorded like a pad, on any channel, with its velocity. */
    reset(); selectTrack(5); seqEngineTick();
    ext(0x93, 60, 90);
    eq('a key-on records on the active track', lastOp(), 'non 5 60 90');
    ext(0x83, 60, 0);
    eq('a key-off closes the capture', lastOp(), 'nof 5 60');

    /* The ledger: a key held through a track switch closes where it started. */
    ext(0x90, 62, 100);
    selectTrack(2);
    ext(0x90, 62, 0);
    eq('the capture-off follows the key, not the new track', lastOp(), 'nof 5 62');

    /* Wheels are live only. */
    const before = engine.ops.length;
    ext(0xB0, 1, 64);
    ext(0xE0, 0, 0x60);
    eq('mod wheel and pitch bend record nothing', engine.ops.length, before);

    /* A drum track: one key per pad, from note 36. */
    reset();
    const undo = setDrum(4, { padCount: 3, padNoteStart: 36, rawMidi: false, padNotes: [36, 38, 42] });
    selectTrack(4); seqEngineTick(); seqEngineTick();
    eq('a drum track pushes its pads\' notes', engine.params.extmap, '4,36,38,42');
    ext(0x90, 38, 80);
    eq('key 38 records the third pad\'s note', lastOp(), 'non 4 42 80');
    ext(0x80, 38, 0);
    const n = engine.ops.length;
    ext(0x90, 39, 80);
    ext(0x90, 35, 80);
    eq('keys outside the rack record nothing', engine.ops.length, n);

    /* A re-dlopened engine knows no route. */
    resetSeqEngine();
    engine.params.extmap = undefined;
    seqEngineTick(); seqEngineTick();
    eq('the route is pushed again after an engine reset', engine.params.extmap, '4,36,38,42');
    undo();

    uninstallMockEngine();
    reset();
}
