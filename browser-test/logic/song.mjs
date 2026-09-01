/* browser-test/logic/song.mjs — scene launching and Song mode: the Shift+scene
 * gesture, the `song=` mirror, the scene row's LEDs and the bottom-row readout.
 *
 * Run by browser-test/logic.mjs.
 */

import { eq, ok, lastMusicalOp, seqEngineTick, resetSeqEngine, _log } from './harness.mjs';

export async function run() {
    _log('\nsong mode:');
    const { installMockEngine, uninstallMockEngine } = await import('../mock-engine.mjs');
    const { seqHandleMidi } = await import('../../dist/esm/seq/router.js');
    const { seqState, resetSeqState, songFromStr } = await import('../../dist/esm/seq/state.js');
    const { parseStatusForTest } = await import('../../dist/esm/seq/engine.js');
    const { sceneForStep, songShift, resetSong, NUM_SCENES } =
        await import('../../dist/esm/seq/song.js');

    const engine = installMockEngine();
    const reset = () => { resetSeqEngine(); resetSeqState(); resetSong(); engine.reset(); };
    const lastOp = () => lastMusicalOp(engine.ops);
    reset(); seqEngineTick();

    /* ── the scene row: the buttons printed 1,3,5…15 = 0-indexed 0,2,4…14 ─── */
    eq('step 1 (0-indexed 0) is scene 1', sceneForStep(0), 0);
    eq('step 3 (0-indexed 2) is scene 2', sceneForStep(2), 1);
    eq('step 15 (0-indexed 14) is scene 8', sceneForStep(14), 7);
    eq('an odd 0-indexed step is inert', sceneForStep(1), -1);
    eq('step 16 is inert', sceneForStep(15), -1);
    eq('there are eight scenes', NUM_SCENES, 8);

    /* ── building a song: first press of a hold replaces, later ones append ── */
    reset(); seqEngineTick();
    seqState.sessionMode = true;
    songShift(true);
    seqHandleMidi([0x90, 16 + 0, 127], true);   // Shift + step 1 → scene 0
    seqEngineTick();
    eq('the first Shift+scene starts a new song', lastOp(), 'song 0');

    seqHandleMidi([0x90, 16 + 0, 0], true);
    seqHandleMidi([0x90, 16 + 2, 127], true);   // Shift + step 3 → scene 1
    seqEngineTick();
    eq('a later press in the same hold appends', lastOp(), 'songadd 1');

    seqHandleMidi([0x90, 16 + 2, 0], true);
    seqHandleMidi([0x90, 16 + 2, 127], true);   // the same scene again
    seqEngineTick();
    eq('pressing the same scene twice appends it twice', lastOp(), 'songadd 1');

    /* A NEW Shift hold starts a NEW song — the only way to replace one. */
    seqHandleMidi([0x90, 16 + 2, 0], true);
    songShift(false);
    songShift(true);
    seqHandleMidi([0x90, 16 + 4, 127], true);
    seqEngineTick();
    eq('a new Shift hold starts a new song', lastOp(), 'song 2');

    /* An inert step emits nothing at all — and is still consumed, so it can
     * never fall through to the track selector underneath. */
    reset(); seqEngineTick();
    seqState.sessionMode = true;
    songShift(true);
    seqHandleMidi([0x90, 16 + 1, 127], true);
    seqEngineTick();
    ok('an inert step emits no command', !String(lastOp()).startsWith('song'));
    ok('and does not switch tracks', !String(lastOp()).startsWith('watch'));

    /* Outside Session view Shift+step keeps its old meaning. */
    reset(); seqEngineTick();
    seqState.sessionMode = false;
    songShift(true);
    seqHandleMidi([0x90, 16 + 5, 127], true);
    seqEngineTick();
    eq('Shift+Step 6 is still the metronome in Track view', lastOp(), 'metro 1');

    /* ── the mirror ──────────────────────────────────────────────────────── */
    reset();
    songFromStr('-');
    eq('no song parses to an empty list', seqState.songScenes.length, 0);
    songFromStr('1:1,2,2,3');
    eq('the scene list comes through', seqState.songScenes.join(','), '1,2,2,3');
    eq('so does the position', seqState.songPos, 1);
    parseStatusForTest('play=1 song=2:0,7');
    eq('parseStatus reads song=', seqState.songScenes.join(','), '0,7');
    eq('parseStatus reads the position', seqState.songPos, 2);
    parseStatusForTest('play=1 song=-');
    eq('a dash clears the mirror', seqState.songScenes.length, 0);

    /* ── the scene row's LEDs ────────────────────────────────────────────── */
    const { sceneStepLed } = await import('../../dist/esm/seq/song.js');
    const { C_BLACK, C_GREEN, ANIM_NONE, ANIM_PULSE } =
        await import('../../dist/esm/seq/colors.js');

    const inert = sceneStepLed(1, []);
    eq('an inert step is black', inert.base, C_BLACK);
    eq('and carries no animation', inert.channel, ANIM_NONE);

    const idle = sceneStepLed(0, []);
    eq('a scene not in the song is solid green', idle.base, C_GREEN);
    eq('solid means no animation channel', idle.channel, ANIM_NONE);

    const used = sceneStepLed(4, [1, 2, 2, 3]);   // step 4 -> scene 2, in the song
    eq('a scene the song uses pulses', used.channel, ANIM_PULSE);
    eq('the lit colour is in anim, never in base', used.anim, C_GREEN);
    eq('so a base-ignoring firmware still shows it', used.base, C_BLACK);

    const unused = sceneStepLed(0, [1, 2, 2, 3]);  // step 0 -> scene 0, not in the song
    eq('a scene outside the song stays solid', unused.channel, ANIM_NONE);

    /* ── the bottom-row readout ──────────────────────────────────────────── */
    const { songBandTokens } = await import('../../dist/esm/seq/song.js');
    /* A stand-in for fontWidth: two pixels per character, so the window maths
     * is what is checked rather than the font's metrics. */
    const w2 = (t) => t.length * 2;

    const short = songBandTokens([0, 1, 1, 2], 1, 1000, w2);
    eq('scene numbers are 1-based, matching the step buttons',
       short.tokens.map((t) => t.label).join(' '), '1 2 2 3');
    eq('both presses of the current entry are marked',
       short.tokens.map((t) => (t.current ? '*' : '.')).join(''), '.**.');
    ok('a song that fits has no leading ellipsis', short.leading === false);

    const first = songBandTokens([0, 1, 2], 0, 1000, w2);
    eq('the first entry is the current one at pos 0',
       first.tokens.map((t) => (t.current ? '*' : '.')).join(''), '*..');

    /* Overflow: the current entry and the one after it stay on screen, and the
     * window fills leftward with as much history as fits. */
    const many = [0, 1, 2, 3, 4, 5, 6, 7];
    const win = songBandTokens(many, 6, 12, w2);
    ok('the current entry survives the window',
       win.tokens.some((t) => t.current && t.label === '7'));
    ok('so does the entry after it', win.tokens.some((t) => t.label === '8'));
    ok('a windowed song says so', win.leading === true);
    ok('the window really is smaller than the song', win.tokens.length < many.length);

    eq('an empty song has no tokens', songBandTokens([], 0, 1000, w2).tokens.length, 0);

    uninstallMockEngine();
}
