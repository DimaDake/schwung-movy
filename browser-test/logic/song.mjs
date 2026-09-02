/* browser-test/logic/song.mjs — scene launching and Song mode: the Loop+scene
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
    const { sceneForStep, resetSong, songSceneRowActive, songBandVisible, NUM_SCENES } =
        await import('../../dist/esm/seq/song.js');
    const { resetLoopMode } = await import('../../dist/esm/seq/loop-mode.js');
    /* The modifier is pressed as REAL MIDI (Loop = CC 58) rather than by calling
     * the hold directly: the wiring from the button to the scene row is half of
     * what this suite is guarding. */
    const loop = (down) => seqHandleMidi([0xB0, 58, down ? 127 : 0], false);

    const engine = installMockEngine();
    const reset = () => { resetSeqEngine(); resetSeqState(); resetSong(); resetLoopMode(); engine.reset(); };
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
    loop(true);
    ok('Loop held in Session view turns the row into the scene launcher',
       songSceneRowActive());
    ok('and the readout band comes up empty with it', songBandVisible());
    seqHandleMidi([0x90, 16 + 0, 127], false);   // Loop + step 1 → scene 0
    seqEngineTick();
    eq('the first Loop+scene starts a new song', lastOp(), 'song 0');

    seqHandleMidi([0x90, 16 + 0, 0], false);
    seqHandleMidi([0x90, 16 + 2, 127], false);   // Loop + step 3 → scene 1
    seqEngineTick();
    eq('a later press in the same hold appends', lastOp(), 'songadd 1');

    seqHandleMidi([0x90, 16 + 2, 0], false);
    seqHandleMidi([0x90, 16 + 2, 127], false);   // the same scene again
    seqEngineTick();
    eq('pressing the same scene twice appends it twice', lastOp(), 'songadd 1');

    /* A NEW Loop hold starts a NEW song — the only way to replace one. */
    seqHandleMidi([0x90, 16 + 2, 0], false);
    loop(false);
    ok('releasing Loop puts the row back to the track selector',
       !songSceneRowActive());
    loop(true);
    seqHandleMidi([0x90, 16 + 4, 127], false);
    seqEngineTick();
    eq('a new Loop hold starts a new song', lastOp(), 'song 2');
    seqHandleMidi([0x90, 16 + 4, 0], false);
    loop(false);

    /* An inert step emits nothing at all — and is still consumed, so it can
     * never fall through to the track selector underneath. */
    reset(); seqEngineTick();
    seqState.sessionMode = true;
    loop(true);
    seqHandleMidi([0x90, 16 + 1, 127], false);
    seqEngineTick();
    ok('an inert step emits no command', !String(lastOp()).startsWith('song'));
    ok('and does not switch tracks', !String(lastOp()).startsWith('watch'));
    seqHandleMidi([0x90, 16 + 1, 0], false);
    loop(false);

    /* Outside Session view Loop keeps its own meaning: the bar selector, not
     * scenes. Session view is the only place the row addresses scenes at all. */
    reset(); seqEngineTick();
    seqState.sessionMode = false;
    loop(true);
    ok('Loop outside Session view is not the scene launcher', !songSceneRowActive());
    seqHandleMidi([0x90, 16 + 0, 127], false);
    seqEngineTick();
    ok('so a step under it emits no song command', !String(lastOp()).startsWith('song'));
    seqHandleMidi([0x90, 16 + 0, 0], false);
    loop(false);
    resetLoopMode(); seqState.loopMode = false;

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

    /* ── the band stays in the bottom toast's rows ───────────────────────── */
    /* It shares TOAST_Y/TOAST_H with drawJogToast rather than choosing its own
     * geometry: the rows above belong to the param view's second label row, and
     * a taller band drew straight over live UI. Asserted on every rectangle the
     * band paints, glyph runs included. */
    {
        const { drawSongBand, resetSongBand } = await import('../../dist/esm/seq/render.js');
        const { TOAST_Y, TOAST_H } = await import('../../dist/esm/renderer/layout.js');
        resetSeqState(); resetSongBand();
        seqState.sessionMode = true;
        seqState.songScenes = [0, 1, 1, 2];
        seqState.songPos = 1;

        const rects = [];
        const prev = globalThis.fill_rect;
        globalThis.fill_rect = (x, y, w, h) => { rects.push([y, h]); };
        drawSongBand();
        globalThis.fill_rect = prev;

        ok('the band paints something', rects.length > 0);
        eq('nothing is drawn above the toast band',
           rects.filter(([y]) => y < TOAST_Y).length, 0);
        eq('and nothing runs off the bottom of the screen',
           rects.filter(([y, h]) => y + h > 64).length, 0);
        eq('the band is exactly the toast height',
           Math.max(...rects.map(([y, h]) => y + h)) - TOAST_Y <= TOAST_H, true);
        resetSeqState(); resetSongBand();
    }

    /* ── the end of a song ───────────────────────────────────────────────── */
    /* A scene with no clip on any track is TERMINAL: there is nothing to take a
     * length from, so the arrangement stops there (the transport keeps
     * running). The UI derives that from the same clip existence the engine
     * reads, so the readout cannot disagree with what the engine did. */
    {
        const { songTerminal } = await import('../../dist/esm/seq/song.js');
        resetSeqState();
        eq('no song is not an ended song', songTerminal(), false);

        seqState.songScenes = [0, 1, 2];
        seqState.session[0].exist = 0b011;   // clips in scenes 1 and 2, none in 3
        seqState.songPos = 0;
        eq('playing a scene that has clips is not the end', songTerminal(), false);
        seqState.songPos = 2;
        eq('parked on a scene with no clips anywhere IS the end', songTerminal(), true);

        /* Existence is read across ALL tracks, not just the first. */
        seqState.session[9].exist = 0b100;
        eq('a clip on any track keeps the scene alive', songTerminal(), false);
        resetSeqState();
    }

    uninstallMockEngine();
}
