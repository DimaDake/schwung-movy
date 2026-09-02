/* browser-test/logic/seq-leds.mjs — LED colours: pads, transport, affordances, step icons, loop bars, session cells
 *
 * Run by browser-test/logic.mjs. The suite body is deliberately left at its
 * original indentation inside run() so blame survives the split.
 */

import {
    keyboardState, eq, _log,
} from './harness.mjs';

export async function run() {
/* ── drum pad LED color ──────────────────────────────────────────────────── */
{
    _log('\ndrum pad LED color:');
    globalThis.Black     = 0;
    globalThis.White     = 120;
    globalThis.NeonGreen = 11;

    const { drumPadLedColor } = await import('../../dist/esm/keyboard/leds.js');
    const { trackColor } = await import('../../dist/esm/seq/colors.js');

    const cfg = { rawMidi: false, padNoteStart: 36, padCount: 16 };
    const padMin = 68;
    // pad index 0 => drumPad 1 => note 36; selected when currentPhysPad === pad.
    const unselNotPlaying = drumPadLedColor(68, padMin, cfg, /*phys*/-1, /*track*/2, /*playing*/false);
    eq('unselected = track color', unselNotPlaying, trackColor(2));
    const selected = drumPadLedColor(68, padMin, cfg, /*phys*/68, 2, false);
    eq('selected = white', selected, 120);
    const playing = drumPadLedColor(68, padMin, cfg, -1, 2, /*playing*/true);
    eq('playing = green', playing, 11);
    const off = drumPadLedColor(72, padMin, cfg, -1, 2, false); // col>=4 => off
    eq('right half = off', off, 0);
}

/* ── chromatic pad LED color ─────────────────────────────────────────────── */
{
    _log('\nchromatic pad LED color:');
    const { padColor, padPitch } = await import('../../dist/esm/seq/pads.js');
    const { trackColor } = await import('../../dist/esm/seq/colors.js');
    const { setHeldSet, clearHeldSet } = await import('../../dist/esm/seq/held.js');
    const { keyboardState, resetPadMapCache } = await import('../../dist/esm/keyboard/state.js');

    const padMin = 68;
    keyboardState.rootPc = 0; keyboardState.scale = 0;
    keyboardState.mode = 0; keyboardState.layout = 0;
    keyboardState.octave = [5, 5, 5, 5];   // base 60 = C4, root on pad 71
    resetPadMapCache();
    // The root pad is track colour, unless playing/held.
    eq('root = track color', padColor(71, padMin, 0, false), trackColor(0));
    eq('playing = green',    padColor(71, padMin, 0, /*playing*/true), 11);
    // mark the held set: pitch at pad 72 = C#4 = 61.
    setHeldSet(0, [padPitch(0, 72, padMin)]);
    eq('held-set = white',   padColor(72, padMin, 0, false), 120);
    clearHeldSet(0);
    // step-hold overlay: holdNotes array overrides the noteHeld set
    const holdPitches = [padPitch(0, 71, padMin)]; // C4 = 60
    eq('holdNotes-in-array = white', padColor(71, padMin, 0, false, holdPitches), 120);
    eq('holdNotes-missing = normal', padColor(72, padMin, 0, false, holdPitches), 0); // C# out of scale → black
    keyboardState.octave = [4, 4, 4, 4]; resetPadMapCache();
}

/* ── transport LEDs ──────────────────────────────────────────────────────── */
{
    _log('\ntransport LEDs:');
    const { transportPlayColor, transportRecColor } = await import('../../dist/esm/seq/leds.js');
    const { C_REC_RED } = await import('../../dist/esm/seq/colors.js');

    eq('play stopped = dark grey',   transportPlayColor(false), 124);
    eq('play running = green',       transportPlayColor(true), 11);
    eq('rec idle = dark grey',       transportRecColor(false, false), 124);
    eq('rec recording = red',        transportRecColor(true, false), C_REC_RED);
    /* Armed-and-waiting flashes: a count-in, or a take queued to the next bar. */
    eq('rec armed, blink on = red',  transportRecColor(false, true, true), C_REC_RED);
    eq('rec armed, blink off = dark', transportRecColor(false, true, false), 124);
    eq('rec rolling ignores blink',  transportRecColor(true, false, false), C_REC_RED);
    eq('rec proper red color = 127', C_REC_RED, 127);
}

/* ── affordance LEDs ─────────────────────────────────────────────────────── */
{
    _log('\naffordance LEDs:');
    const {
        backLedColor, arrowLedColor, sampleLedColor, captureLedColor, undoLedColor,
    } = await import('../../dist/esm/seq/buttons.js');
    const { VIEW_CHAIN, VIEW_KNOBS } = await import('../../dist/esm/app/state.js');

    /* Back is dim everywhere: at the chain root it opens the Leave menu, so a
     * dark button there advertised a dead end. */
    eq('back dim at the chain root', backLedColor(VIEW_CHAIN), 16);
    eq('back dim in module view', backLedColor(VIEW_KNOBS), 16);
    eq('left off at bar 0',  arrowLedColor(-1, 0, 3), 0);
    eq('left dim mid',       arrowLedColor(-1, 1, 3), 16);
    eq('right off at max',   arrowLedColor(+1, 3, 3), 0);
    eq('right dim mid',      arrowLedColor(+1, 1, 3), 16);

    /* Step recording: the arrows drive the head, and blink to say so. Never
     * bright↔off — a lit arrow must always mean "pressable". */
    const { stepRecArrowColor } = await import('../../dist/esm/seq/buttons.js');
    eq('steprec right bright on the blink',  stepRecArrowColor(+1, false, true), 124);
    eq('steprec right dim off the blink',    stepRecArrowColor(+1, false, false), 16);
    eq('steprec left off when it cannot go', stepRecArrowColor(-1, false, true), 0);
    eq('steprec left bright when it can',    stepRecArrowColor(-1, true, true), 124);
    eq('steprec left dim off the blink',     stepRecArrowColor(-1, true, false), 16);
    eq('sample always off',  sampleLedColor(), 0);
    eq('capture dark with an empty buffer', captureLedColor(0), 0);
    eq('capture lit with buffered notes',   captureLedColor(3), 124);
    eq('undo off',           undoLedColor(), 0);
}

/* ── step-icon LEDs ──────────────────────────────────────────────────────── */
{
    _log('\nstep-icon LEDs:');
    const { stepIconColor } = await import('../../dist/esm/seq/leds.js');

    // step indexes are 0-based: step 6 -> idx 5 (metro), step 10 -> idx 9 (full vel)
    const off = { shift: false, metro: false, fullVel: false };
    eq('metro idx dark when off+noshift', stepIconColor(5, off), 0);
    eq('metro idx lit when metro on',     stepIconColor(5, { shift: false, metro: true, fullVel: false }), 124);
    eq('fullvel idx lit when on',         stepIconColor(9, { shift: false, metro: false, fullVel: true }), 124);
    // Shift held: all shortcut icons show (dim if inactive, bright if active).
    eq('shift shows metro dim',  stepIconColor(5, { shift: true, metro: false, fullVel: false }), 16);
    eq('shift shows dbl-loop dim', stepIconColor(14, { shift: true, metro: false, fullVel: false }), 16);
    eq('shift shows quant dim',  stepIconColor(15, { shift: true, metro: false, fullVel: false }), 16);
    eq('non-shortcut idx dark',  stepIconColor(0, { shift: true, metro: false, fullVel: false }), 0);
    // Set Params openers (steps 5/7/9 = idx 4/6/8): dim while Shift held, full bright while page open.
    eq('shift shows set-params step dim', stepIconColor(4, { shift: true, metro: false, fullVel: false }), 16);
    eq('set-params step bright when page open', stepIconColor(6, { shift: false, metro: false, fullVel: false, mainPage: true }), 124);
    eq('set-params step dark when closed+noshift', stepIconColor(8, { shift: false, metro: false, fullVel: false, mainPage: false }), 0);
    // Clip Params opener (Step 3 = idx 2): dim while Shift held in Track view,
    // full bright while the page is open, off in Session view (not available there).
    eq('shift shows clip-params step dim', stepIconColor(2, { shift: true, metro: false, fullVel: false }), 16);
    eq('clip-params step bright when page open', stepIconColor(2, { shift: false, metro: false, fullVel: false, clipPage: true }), 124);
    eq('clip-params step dark when closed+noshift', stepIconColor(2, { shift: false, metro: false, fullVel: false, clipPage: false }), 0);
    eq('clip-params step off in Session even with Shift', stepIconColor(2, { shift: true, metro: false, fullVel: false, session: true }), 0);
    /* CPU meter opener (Step 12 = idx 11). Same three states as the other page
     * openers, and available everywhere — unlike Clip Params it means the same
     * thing in Session view, where the chains are still rendering. */
    eq('shift shows cpu step dim', stepIconColor(11, { shift: true, metro: false, fullVel: false }), 16);
    eq('cpu step bright when page open', stepIconColor(11, { shift: false, metro: false, fullVel: false, cpuPage: true }), 124);
    eq('cpu step dark when closed+noshift', stepIconColor(11, { shift: false, metro: false, fullVel: false, cpuPage: false }), 0);
    eq('cpu step available in Session too', stepIconColor(11, { shift: true, metro: false, fullVel: false, session: true }), 16);
    eq('and stays bright there while open', stepIconColor(11, { shift: false, metro: false, fullVel: false, session: true, cpuPage: true }), 124);
}

/* ── track-button LEDs ───────────────────────────────────────────────────── */
{
    _log('\ntrack-button LEDs:');
    const { trackButtonColor } = await import('../../dist/esm/seq/leds.js');
    const { trackColor, trackColorDim } = await import('../../dist/esm/seq/colors.js');

    eq('base = track color', trackButtonColor(1, /*active*/false, /*muted*/false), trackColor(1));
    eq('active = white pulse', trackButtonColor(1, true, false), 120);
    eq('muted dim',     trackButtonColor(2, false, true), trackColorDim(2));
    eq('muted+active still white', trackButtonColor(2, true, true), 120);
}

/* ── loop bar color ──────────────────────────────────────────────────────── */
{
    _log('\nloop bar color:');
    const { loopBarColor } = await import('../../dist/esm/seq/leds.js');
    const { trackColor, C_BLACK, C_DARKGREY, C_WHITE, C_GREEN,
            ANIM_NONE, ANIM_PULSE } = await import('../../dist/esm/seq/colors.js');

    const base = { isPlayhead: false, selected: false, inLoop: false, track: 1 };
    const led = (o) => JSON.stringify(loopBarColor({ ...base, ...o }));
    const want = (b, a, ch) => JSON.stringify({ base: b, anim: a, channel: ch });

    /* Every state fades its own colour against black, and every one of them uses
     * the SAME channel so the row pulses in step — mixed rates cannot stay
     * synchronised. The lit colour must be `anim`, since a firmware that ignores
     * the base once a channel is set would otherwise pulse black on black. */
    eq('playhead pulses green', led({ isPlayhead: true, inLoop: true, selected: true }),
        want(C_BLACK, C_GREEN, ANIM_PULSE));
    eq('selected pulses white', led({ selected: true, inLoop: true }),
        want(C_BLACK, C_WHITE, ANIM_PULSE));
    // Selected outside the loop looks the same: it says "this is where you are".
    eq('selected inactive pulses white too', led({ selected: true }),
        want(C_BLACK, C_WHITE, ANIM_PULSE));
    eq('active pulses the track colour', led({ inLoop: true }),
        want(C_BLACK, trackColor(1), ANIM_PULSE));
    // Inactive: very dark grey, solid. Content is not indicated either way.
    eq('inactive is dark grey', led({}), want(C_DARKGREY, C_DARKGREY, ANIM_NONE));

    const chans = [
        loopBarColor({ ...base, isPlayhead: true }).channel,
        loopBarColor({ ...base, selected: true }).channel,
        loopBarColor({ ...base, inLoop: true }).channel,
    ];
    eq('every pulsing bar shares one channel', new Set(chans).size, 1);
}

/* ── session cell color ──────────────────────────────────────────────────── */
{
    _log('\nsession cell color:');
    const { sessionCellColor } = await import('../../dist/esm/seq/session.js');
    const { trackColor, C_BLACK, C_WHITE, C_DARKGREY,
            ANIM_NONE, ANIM_PULSE, ANIM_PULSE_FAST, ANIM_PULSE_SLOW }
        = await import('../../dist/esm/seq/colors.js');

    const base = { exists:false, isSel:false, isPlaying:false, isQueued:false, track:1 };
    const tc = trackColor(1);
    const led = (ctx) => JSON.stringify(sessionCellColor(ctx));
    const want = (b, a, ch) => JSON.stringify({ base:b, anim:a, channel:ch });
    // Solid (no animation) states.
    eq('empty unselected = off', led({ ...base }), want(C_BLACK, C_BLACK, ANIM_NONE));
    eq('content unselected = solid track', led({ ...base, exists:true }), want(tc, tc, ANIM_NONE));
    eq('selected empty = solid grey', led({ ...base, isSel:true }), want(C_DARKGREY, C_DARKGREY, ANIM_NONE));
    // Animated states (pulse base->white at distinct rates).
    eq('selected content = slow pulse', led({ ...base, exists:true, isSel:true }), want(tc, C_WHITE, ANIM_PULSE_SLOW));
    eq('playing = pulse', led({ ...base, exists:true, isPlaying:true }), want(tc, C_WHITE, ANIM_PULSE));
    eq('queued = fast pulse', led({ ...base, exists:true, isQueued:true }), want(tc, C_WHITE, ANIM_PULSE_FAST));
    // Priority: queued outranks playing.
    eq('queued outranks playing', sessionCellColor({ ...base, exists:true, isPlaying:true, isQueued:true }).channel, ANIM_PULSE_FAST);

    /* A muted track's cells wear its dim accent, the same cue the track button
     * and the step row carry. The transport layers survive it: a muted track is
     * still running, and the grid is where you watch it run. */
    const { trackColorDim } = await import('../../dist/esm/seq/colors.js');
    const dim = trackColorDim(1);
    eq('muted content cell is dim', led({ ...base, exists:true, muted:true }), want(dim, dim, ANIM_NONE));
    eq('muted playing cell keeps the white pulse',
       led({ ...base, exists:true, isPlaying:true, muted:true }), want(dim, C_WHITE, ANIM_PULSE));
    eq('muted queued cell keeps the fast pulse',
       sessionCellColor({ ...base, exists:true, isQueued:true, muted:true }).channel, ANIM_PULSE_FAST);
    eq('an empty cell on a muted track is still off',
       led({ ...base, muted:true }), want(C_BLACK, C_BLACK, ANIM_NONE));
}

/* ── the Mute button reports that something is silenced ──────────────────── */
{
    /* Four track buttons show mute for the focused quartet; with sixteen tracks
     * a mute two groups away has nowhere else to be seen from Track view. */
    _log('\nmute button LED:');
    const { seqLedsTick, seqLedsInvalidate } = await import('../../dist/esm/seq/leds.js');
    const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');
    const { WHITE_BRIGHT, WHITE_DIM } = await import('../../dist/esm/seq/colors.js');

    const CC_MUTE = 88;
    const btnCalls = [];
    const origSetButtonLED = globalThis.setButtonLED;
    const origSetLED = globalThis.setLED;
    globalThis.setButtonLED = (cc, c) => btnCalls.push([cc, c]);
    globalThis.setLED = () => {};

    const paint = () => {
        seqLedsInvalidate(); btnCalls.length = 0;
        for (let i = 0; i < 8; i++) seqLedsTick();
        return Object.fromEntries(btnCalls);
    };

    resetSeqState();
    eq('nothing muted → dim', paint()[CC_MUTE], WHITE_DIM);

    seqState.muted[13] = true;   // outside the focused quartet on purpose
    eq('a far track muted → bright', paint()[CC_MUTE], WHITE_BRIGHT);

    seqState.muted[13] = false;
    eq('unmuting puts it back', paint()[CC_MUTE], WHITE_DIM);

    globalThis.setButtonLED = origSetButtonLED;
    globalThis.setLED = origSetLED;
    resetSeqState(); seqLedsInvalidate();
}

/* ── loop single-press selects bar ───────────────────────────────────────── */
{
    _log('\nloop single-press selects bar:');
    const { loopStepOn, resetLoopMode } = await import('../../dist/esm/seq/loop-mode.js');
    const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');

    resetLoopMode();
    seqState.barOffset = 0;
    loopStepOn(3);
    eq('barOffset follows press', seqState.barOffset, 3);
}

/* ── header announce TTL ─────────────────────────────────────────────────── */
{
    _log('\nheader announce TTL:');
    const { seqHeaderAnnounce, seqHeaderActive, seqHeaderTick, resetSeqHeader } =
        await import('../../dist/esm/seq/render.js');

    resetSeqHeader();
    eq('inactive initially', seqHeaderActive(), false);
    seqHeaderAnnounce('Session', 2);
    eq('active after announce', seqHeaderActive(), true);
    seqHeaderTick(); seqHeaderTick();
    eq('expires after ttl', seqHeaderActive(), false);
}

}
