#!/usr/bin/env node
/* browser-test/app-loop.mjs — headless integration harness.
 *
 * Drives the REAL app loop (init / onMidiMessageInternal / tick) against the
 * mock engine and a drum preset, capturing setLED so we can assert the full
 * input→LED pipeline — the layer the device cannot read back. Run from movy
 * root: node browser-test/app-loop.mjs */

import { trackRef, TRACK_COUNT } from '../dist/esm/track/ref.js';
import { REFRESH_BULK_TICKS } from '../dist/esm/model/constants.js';
import { setFlag } from '../dist/esm/seq/flags.js';
import { FONT_HEIGHT } from '../dist/esm/font/index.js';
import { HINT_TOP, HINT_LINES } from '../dist/esm/renderer/flags-view.js';
import { selectTrack, focusGroupStep } from '../dist/esm/track/focus.js';
import { watchedTrack } from '../dist/esm/seq/watch.js';
import { MASTER_FX_SLOTS as _MFX_SLOTS } from '../dist/esm/chain/config.js';
import { installEnv } from './env.mjs';
import { installMockEngine, reinstallMockEngine } from './mock-engine.mjs';
import { MOCK_SYNTHS } from './mock-synth.mjs';

const env    = installEnv();
const engine = installMockEngine();

/* Capture LED writes (override env's no-op setLED). */
const ledByPad = {};                       // padNote → last color
globalThis.setLED = (note, color) => { ledByPad[note] = color; };

/* Capture painted rectangles, so a view can be asked which rows it owns. */
const painted = [];
globalThis.fill_rect = (x, y, w, h) => { painted.push([x, y, w, h]); };

/* Capture button LED writes. */
const buttonLeds = {};
globalThis.setButtonLED = (cc, color) => { buttonLeds[cc] = color; };

/* [movy] log capture (for the drum step-entry log assertion). */
const logs = [];
const _origLog = console.log;
console.log = (...a) => { if (typeof a[0] === 'string' && a[0].startsWith('[movy]')) logs.push(a[0]); };

/* Bundled app entry points assign init/tick/onMidiMessageInternal to globalThis. */
await import('../dist/esm/app/globals.js');
const { appState, VIEW_KNOBS, VIEW_CHAIN, VIEW_BROWSE, VIEW_FILE_BROWSE, VIEW_MAIN_PARAMS } = await import('../dist/esm/app/state.js');

/* THE ARM IS SELECTED HERE, NOT BY A BUILD DEFINE. The grid is a setting now
 * (src/renderer/schwung-grid.ts), and MOVY_SCHWUNG_GRID — still in two scripts'
 * usage lines — reaches no build at all, so selecting a mode that way ran `off`
 * twice and called it an A/B. Unset means the default, which is what every
 * existing `npm test` run wants. */
const { setSchwungGridMode, schwungGridMode, schwungGridReload, schwungPageFor } =
    await import('../dist/esm/renderer/schwung-grid.js');
const { schwungLibAvailable } = await import('../dist/esm/renderer/schwung-lib.js');
const GRID_ARM = process.env.MOVY_APP_LOOP_GRID || null;
if (GRID_ARM) setSchwungGridMode(GRID_ARM);

/* WHICH PAGE IS UNDER THE KNOBS, asked the way the app asks it. A gesture whose
 * visible effect is "the param page moved" is asserted through the ownership
 * accessor, not through movy's own bank index: under `page` the bank index is
 * not what is on screen, so asserting it would be asserting an implementation
 * detail this migration deletes. In the `off` arm the accessor IS movy's bank,
 * so the check is the same check it always was. */
const { pageOwnerOf } = await import('../dist/esm/app/page-owner.js');
const { movyBodyUnderPage } = await import('../dist/esm/app/param-body.js');
const shownPage = (model) => pageOwnerOf(model).pageIndex;

/* The module under the knobs, spelled the way app/tick.ts spells it, and its
 * page owner — for the two blocks below that have to reach the controller. */
const activeModelFor = () =>
    appState.trackModels[appState.activeTrack.index]
        ?.[appState.trackChainIndex[appState.activeTrack.index]];
const ownerFor = () => pageOwnerOf(activeModelFor());

/* The first master FX slot, by COMPONENT rather than by position: movy's own
 * send buses sit in front of them on the master page, and these blocks are
 * about what a `master_fx:` slot does, not about what happens to be first. */
const MFX1 = _MFX_SLOTS.findIndex((s) => s.componentKey.startsWith('master_fx'));
const { seqState, resetSeqState, occHasStep } = await import('../dist/esm/seq/state.js');
const { resetSeqEngine } = await import('../dist/esm/seq/engine.js');
const { padVoiceSilent } = await import('../dist/esm/mixer/pad-mutes.js');
const { seqToastText } = await import('../dist/esm/seq/render.js');
const { resetSetSession } = await import('../dist/esm/seq/set-session.js');
const { CC_NOTE_SESSION, STEP_NOTE_BASE } = await import('../dist/esm/seq/constants.js');
const { anyStepHeld, STEP_AUTO_MS } = await import('../dist/esm/seq/step-edit.js');
const { stepPageState } = await import('../dist/esm/seq/step-page.js');
const { leaveModalActive } = await import('../dist/esm/app/leave-modal.js');
const { mainPageActive } = await import('../dist/esm/seq/main-page.js');
const { VIEW_CPU } = await import('../dist/esm/app/state.js');
const { STEP_CPU } = await import('../dist/esm/seq/constants.js');
const { handleStepButton } = await import('../dist/esm/seq/router-steps.js');
const { closeParamPage } = await import('../dist/esm/seq/param-page.js');

let failures = 0;
const _log = _origLog.bind(console);
function ok(label)        { _log(`  \x1b[32m✓\x1b[0m ${label}`); }
/* The LABELS, not the count. page-mode.mjs ratchets on which checks fail, so a
 * count would let one check start failing while another stopped and call it
 * unchanged. */
const failedLabels = [];
function fail(label, why) { _log(`  \x1b[31m✗\x1b[0m ${label}: ${why}`); failures++; failedLabels.push(label); }
function eq(label, actual, expected) {
    if (actual === expected) ok(label);
    else fail(label, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const PAD_KICK = 68;   // grid pad 1 → drumPad 1 → midi note 36 (mrdrums padNoteStart=36)
const NOTE_KICK = 36;

/* Reset to a clean drum-track app state and settle the engine + hierarchy. */
function resetApp() {
    engine.reset();
    env.setParams(MOCK_SYNTHS.mrdrums);
    for (const k of Object.keys(ledByPad)) delete ledByPad[k];
    logs.length = 0;
    resetSeqState();
    resetSeqEngine();
    /* env.setParams seeds the bare-key store every chain read falls back to
     * (env.mjs), so every track — not just a distinguished four — finds the
     * mocked instrument regardless of which chain it addresses. */
    /* The Set-commit press is WALL-CLOCK timed (it waits 1.5 s for Move to
     * finish loading the Set before borrowing the surface), and the loading
     * splash now waits for it — so with this harness's 12 instant ticks movy
     * would never leave `settling` and every gesture below would be refused.
     * The press itself is covered in logic/set-settling.mjs, on a stubbed
     * clock. */
    setFlag('setcommit', 0);
    globalThis.init();                       // builds 4×chain models, resets keyboardState
    appState.trackModels[0][1].reload();     // force synth hierarchy/drum-config load
    advance(12);                             // settle engine boot + hierarchy + lane
}
function advance(n = 1) { for (let i = 0; i < n; i++) globalThis.tick(); }

/* Advance until the page has gone a full window with nothing NEW painted —
 * the deterministic version of "advance enough ticks". `appState.dirty` cannot
 * be observed for this: `tick()` clears it internally after drawing (app/tick.ts),
 * so it always reads false right after `tick()` returns, whatever happened
 * inside. `painted.length` is the only externally visible signal.
 *
 * A chain port's background model refresh is phase-dependent (it polls on a
 * countdown, not on demand), so a fixed tick count can land the model's own
 * poll inside the very window a test is about to measure — and it did: the CPU
 * page's own dirty gate was proven correct (a device diff showed it comparing
 * pixel-identical signatures and correctly declining to repaint), yet a fixed
 * `advance(12)` still painted, because something ELSE — not the CPU gate —
 * repainted a few ticks into the window this test used to start measuring
 * from cold. This waits that out structurally instead of guessing a count. */
function settleQuiet(margin = 3 * REFRESH_BULK_TICKS) {
    let quiet = 0;
    let guard = margin * 30;   // generous; this must never hang a test run
    let last = painted.length;
    while (quiet < margin && guard-- > 0) {
        globalThis.tick();
        if (painted.length !== last) { last = painted.length; quiet = 0; }
        else quiet++;
    }
}
function sendMidi(msg)  { globalThis.onMidiMessageInternal(msg); }
function padColor(p)    { return ledByPad[p]; }

/* ── Tests ───────────────────────────────────────────────────────────────── */

_log('\napp-loop: drum grid loads');
{
    resetApp();
    const vm = appState.trackModels[0][1].getViewModel();
    eq('drum preset detected (padCount 16)', vm.drumPadCount, 16);
    eq('drum lane selected (watchLane = note of current pad)', seqState.watchLane >= 0, true);
    /* The lane opens on pad 1, so the grid must say which pad that is. It did
     * not: the focused GRID pad was left at 0, and a freshly loaded rack lit no
     * pad white while the sequencer was already editing one. */
    eq('and the pad the lane belongs to is lit white', padColor(PAD_KICK), 120);
}

_log('\napp-loop: drum grid repaints once on a track switch, then idles');
{
    // movy owns the pad LEDs: the host strips Move's cable-0 note LEDs
    // unconditionally and its RGB sysex via the suppression claimed at init, so
    // nothing external can repaint a pad. The grid therefore needs exactly one
    // invalidation per track switch — enough to overwrite the previous layout's
    // colours, which the per-pad cache would otherwise consider correct — and
    // no re-assert window on top of it.
    resetApp();
    advance(45);
    const corrupt = () => { ledByPad[PAD_KICK] = 999; };

    // Steady state: movy trusts its cache and sends nothing.
    corrupt();
    advance(1);
    eq('idle: no re-send (cache-diffed, zero traffic)', padColor(PAD_KICK), 999);

    // A track switch invalidates the cache, so the very next tick repaints.
    sendMidi([0xB0, 42, 127]); sendMidi([0xB0, 42, 0]);  // → T2
    advance(2);
    sendMidi([0xB0, 43, 127]); sendMidi([0xB0, 43, 0]);  // → back to T1
    corrupt();
    advance(1);
    eq('track switch: grid repaints on the next tick', padColor(PAD_KICK) !== 999, true);

    // The invalidation is one-shot — the tick after it, traffic is back to zero.
    corrupt();
    advance(1);
    eq('one-shot: no re-assert window follows', padColor(PAD_KICK), 999);

    // Perf: the old 40-tick re-assert window re-sent all 32 pads every tick,
    // so a single track switch cost up to ~1280 LED writes. One invalidation
    // costs one grid's worth. Budget covers the grid plus the button/step LEDs
    // that legitimately change with the switch.
    resetApp();
    advance(45);
    let ledWrites = 0;
    const realSetLED = globalThis.setLED;
    globalThis.setLED = (n, c) => { ledWrites++; realSetLED(n, c); };
    sendMidi([0xB0, 42, 127]); sendMidi([0xB0, 42, 0]);  // → T2
    advance(40);
    globalThis.setLED = realSetLED;
    eq('track switch costs one grid repaint, not a window', ledWrites <= 80, true);
    _log(`    (${ledWrites} LED writes across 40 ticks after a track switch)`);
}

_log('\napp-loop: a cold LED frame never overflows the output buffer');
{
    /* The MIDI output buffer holds ~64 packets and drops the overflow SILENTLY,
     * and every painter records its own cache as sent — so an over-budget frame
     * is not retried, it is lost. On device that read as: come back from
     * background and every pad is black while the buttons are fine, with movy's
     * own log insisting it had painted all 32.
     *
     * The pad painters and the knob rings used to call setLED directly, outside
     * the budget the cached step/button layer respects. */
    resetApp();
    advance(45);

    let perTick = 0, worst = 0;
    const realSetLED = globalThis.setLED;
    const realSetButtonLED = globalThis.setButtonLED;
    globalThis.setLED = (n, c) => { perTick++; realSetLED(n, c); };
    if (typeof realSetButtonLED === 'function')
        globalThis.setButtonLED = (n, c, i) => { perTick++; realSetButtonLED(n, c, i); };

    globalThis.onResume();                  // exactly what returning from background does
    for (let i = 0; i < 40; i++) {
        perTick = 0;
        advance(1);
        if (perTick > worst) worst = perTick;
    }
    globalThis.setLED = realSetLED;
    if (typeof realSetButtonLED === 'function') globalThis.setButtonLED = realSetButtonLED;

    /* ~64 packets is where the hardware starts dropping, per schwung's API
     * notes. The budgeted painters stop at 40, and the slack above it is for
     * the bounded one-shots that ride a layout transition (the octave arrows). */
    eq('no tick overflows the output buffer', worst <= 60, true);
    _log(`    (worst tick sent ${worst} LED packets after a resume invalidation)`);
}

_log('\napp-loop: selected pad is white when idle');
{
    resetApp();
    sendMidi([0x90, PAD_KICK, 100]);   // press → selects pad, sounds (held)
    sendMidi([0x80, PAD_KICK, 0]);     // release → clears held
    advance(2);
    eq('idle selected pad = white', padColor(PAD_KICK), 120);
}

_log('\napp-loop: drum pads + step lane stay live on a non-synth module slot');
{
    resetApp();                              // drum on synth (slot 1), focused on synth
    appState.trackChainIndex[0] = 2;         // focus FX 1 slot (not the synth)
    advance(2);                              // FX model ticks; drum status still from synth
    eq('focused on FX slot: still a drum track (lane >= 0)', seqState.watchLane >= 0, true);

    const PAD_SNARE = 69;                    // grid pad 2 → drumPad 2 → midi note 37
    sendMidi([0x90, PAD_SNARE, 100]);        // press snare pad while the FX slot is focused
    sendMidi([0x80, PAD_SNARE, 0]);
    advance(2);
    eq('FX slot focused: drum pad selects its lane', seqState.watchLane, 37);
    eq('FX slot focused: selected drum pad lights white', padColor(PAD_SNARE), 120);
}

_log('\napp-loop: Mute (+Shift) + pad mutes or solos that drum voice');
{
    /* The same gesture the track mute uses, one voice down: Mute held and a pad
     * pressed silences that voice in the sequence. It is movy's own control, so
     * there is no host-level gate — live pad playing stays audible, exactly as
     * playing over a muted track does. */
    const CC_MUTE = 88;
    const GREY = 124, WHITE = 120;
    const PAD_SNARE = 69;                    // grid pad 2 → drumPad 2 → note 37
    const NOTE_SNARE = 37;
    const DEAD_PAD  = 72;                    // col 4: outside a 16-pad rack

    resetApp();
    engine.ops.length = 0;
    const model = appState.trackModels[0][1];

    /* The engine answers live pads ITSELF, on the audio thread, from a map movy
     * pushes each tick — so the early return below cannot stop a note it has
     * already built and sent. What silences a gesture press is the MAP saying
     * "the UI owns the pads while Mute is down". */
    const { engineOwnsPads } = await import('../dist/esm/track/pad-route.js');
    advance(1);
    eq('the engine is the one answering pads here', engineOwnsPads(0), true);

    sendMidi([0xB0, CC_MUTE, 127]);          // Mute down
    advance(1);
    eq('holding Mute takes the pads off the engine', engineOwnsPads(0), false);
    sendMidi([0x90, PAD_SNARE, 100]);        // …then the snare pad
    advance(1);
    eq('queues the voice mute', engine.ops.includes('pmute 0 ' + NOTE_SNARE + ' 1'), true);
    eq('the mirror greys it', seqState.padMutes.has(NOTE_SNARE), true);
    /* Consumed: the press is a mute, not a pad select or a note. */
    eq('the pad does not become the selected one', model.getDrumCurrentPhysPad(), PAD_KICK);
    /* The toast says WHICH voice, the way the track mute names its track: the
     * rack's own name where it declared one, else the pad's number. */
    eq('and the toast names the voice', seqToastText(), 'PAD 2 MUTED');
    /* One log line per press, the way the track mute reports itself — it is how
     * a device suite reads a gesture back without a screen. */
    eq('and the gesture is logged',
       logs.some((l) => l === '[movy] pmute t=0 n=' + NOTE_SNARE + ' -> 1'), true);

    sendMidi([0xB0, CC_MUTE, 0]);            // Mute up — the gesture was this one
    advance(1);
    eq('and the engine answers pads again once Mute is up', engineOwnsPads(0), true);
    eq('and the release does not also mute the track', seqState.muted[0], false);
    eq('no whole-track mute was sent', engine.ops.some((o) => o === 'mute 0 1'), false);

    /* The same gesture takes it back off. */
    engine.ops.length = 0;
    sendMidi([0xB0, CC_MUTE, 127]);
    sendMidi([0x90, PAD_SNARE, 100]);
    advance(1);
    eq('the same gesture unmutes', engine.ops.includes('pmute 0 ' + NOTE_SNARE + ' 0'), true);
    eq('and toasts that too', seqToastText(), 'PAD 2 UNMUTED');
    sendMidi([0xB0, CC_MUTE, 0]);
    advance(1);

    /* A dead pad is not a voice: nothing to silence, and nothing to select. */
    engine.ops.length = 0;
    sendMidi([0xB0, CC_MUTE, 127]);
    sendMidi([0x90, DEAD_PAD, 100]);
    sendMidi([0xB0, CC_MUTE, 0]);
    advance(1);
    eq('a pad outside the rack mutes nothing', engine.ops.some((o) => o.startsWith('pmute')), false);

    /* Shift takes the same gesture to solo. */
    engine.ops.length = 0;
    appState.shiftHeld = true;
    sendMidi([0xB0, CC_MUTE, 127]);
    sendMidi([0x90, PAD_SNARE, 100]);
    advance(1);
    eq('Shift + Mute + pad solos the voice', engine.ops.includes('psolo 0 ' + NOTE_SNARE), true);
    eq('and the toast names the solo', seqToastText(), 'PAD 2 SOLO');
    eq('and the solo is logged', logs.some((l) => l === '[movy] psolo t=0 n=' + NOTE_SNARE), true);
    appState.shiftHeld = false;
    sendMidi([0xB0, CC_MUTE, 0]);
    advance(2);
    eq('the soloed voice is not grey', padColor(PAD_SNARE) !== GREY, true);
    eq('the voices it silences are', padColor(PAD_KICK), WHITE);

    /* Exclusive and moving, and pressing the soloed voice again clears it —
     * the track solo's rule, one voice down. */
    engine.ops.length = 0;
    appState.shiftHeld = true;
    sendMidi([0xB0, CC_MUTE, 127]);
    sendMidi([0x90, PAD_SNARE, 100]);
    advance(1);
    eq('pressing the soloed voice again clears it', engine.ops.includes('psolo 0 -1'), true);
    eq('and says so', seqToastText(), 'SOLO OFF');
    /* `-1` is the "no voice" token on the wire, so the log says the same thing
     * the command did. */
    eq('and the clear is logged as none', logs.some((l) => l === '[movy] psolo t=0 n=-1'), true);
    appState.shiftHeld = false;
    sendMidi([0xB0, CC_MUTE, 0]);
    advance(2);

    /* Melodic track: pads are notes, not voices, so the gesture does not exist
     * and the press plays as it always did. */
    env.setParams(MOCK_SYNTHS.plaits);
    model.reload();
    advance(3);
    engine.ops.length = 0;
    sendMidi([0xB0, CC_MUTE, 127]);
    sendMidi([0x90, PAD_SNARE, 100]);
    sendMidi([0xB0, CC_MUTE, 0]);
    advance(1);
    eq('melodic track: nothing is muted', engine.ops.some((o) => o.startsWith('pmute')), false);
}

_log('\napp-loop: a muted pad greys, but plays green and selects white');
{
    /* The priority the user asked for: grey at rest, but a voice that is
     * sounding or selected keeps the colour that says so — a muted pad must
     * never look dead while its gate is open. */
    resetApp();
    const GREY = 124, GREEN = 11, WHITE = 120;
    const PAD_KICK = 68, NOTE_KICK = 36;
    const PAD_SNARE = 69, NOTE_SNARE = 37;

    /* Muted through the gesture, so the mirror is bound to the track the way a
     * real read-back binds it. The lane opens on pad 1, so the kick is the
     * selected pad throughout. */
    sendMidi([0xB0, 88, 127]);
    sendMidi([0x90, PAD_SNARE, 100]);
    sendMidi([0xB0, 88, 0]);
    advance(2);
    eq('a silenced voice rests grey', padColor(PAD_SNARE), GREY);
    eq('the selected pad is still white', padColor(PAD_KICK), WHITE);

    /* Playing beats muted: a voice the sequencer is sounding must still be
     * green. */
    seqState.activeNotes[NOTE_SNARE] = 1;    // track 0's voice, as `act=` lands it
    advance(2);
    eq('green while its gate is open', padColor(PAD_SNARE), GREEN);
    seqState.activeNotes[NOTE_SNARE] = 0;
    advance(2);
    eq('grey again when it closes', padColor(PAD_SNARE), GREY);

    /* Selection beats muted too — the pad the drum lane edits is white even
     * with its own voice silenced, or the user could not see where they are. */
    sendMidi([0xB0, 88, 127]);
    sendMidi([0x90, PAD_KICK, 100]);
    sendMidi([0xB0, 88, 0]);
    advance(2);
    eq('the muted KICK is the selected pad', padVoiceSilent(NOTE_KICK), true);
    eq('and it stays white', padColor(PAD_KICK), WHITE);
}

_log('\napp-loop: a pad press turns the page (bank.pad, through the router)');
{
    /* The logic suite calls selectBankForPad() directly; this covers the
     * router hookup — a real pad note-on arriving at onMidiMessageInternal
     * has to move the page. Served as a module-owned layout, the way a kit
     * with a page per voice ships it. */
    const cell = { key: 'pad_vol', short: 'VOL', full: 'Volume',
                   type: 'float', min: 0, max: 2 };
    const layout = JSON.stringify({
        id: 'mrdrums', name: 'MrDrums',
        drum: { padCount: 2, padNoteStart: 36, rawMidi: false },
        /* The one shape movy accepts: the voice run leads, the page with no
         * voice sits behind it. */
        banks: [
            { name: 'Kick',  pad: 1, rows: [[cell]] },
            { name: 'Snare', pad: 2, rows: [[cell]] },
            { name: 'Main',           rows: [[cell]] },
        ],
    });
    const savedRead = globalThis.host_read_file;
    globalThis.host_read_file = (p) =>
        String(p).endsWith('/mrdrums/movy_config.json') ? layout : (savedRead ? savedRead(p) : null);
    resetApp();
    globalThis.host_read_file = savedRead;

    const model = appState.trackModels[0][1];
    eq('opens on the voice slot', model.getKnobPage(), 0);

    const PAD_SNARE = 69;                    // grid pad 2 → drumPad 2
    sendMidi([0x90, PAD_SNARE, 100]);
    sendMidi([0x80, PAD_SNARE, 0]);
    advance(2);
    eq('a pad note-on selects that pad\'s voice', model.getKnobPage(), 1);

    sendMidi([0x90, PAD_KICK, 100]);
    sendMidi([0x80, PAD_KICK, 0]);
    advance(2);
    eq('and another pad moves it again', model.getKnobPage(), 0);
}

_log('\napp-loop: green wins over white (sequencer gate)');
{
    resetApp();
    sendMidi([0x90, PAD_KICK, 100]); sendMidi([0x80, PAD_KICK, 0]); // select PAD_KICK
    advance(2);
    eq('precondition: selected pad white', padColor(PAD_KICK), 120);

    engine.status.act = String(NOTE_KICK);   // sequencer now sounding the kick
    advance(10);                              // > STATUS_POLL_TICKS (8) → poll lands
    eq('sounding selected pad → green', padColor(PAD_KICK), 11);

    engine.status.act = '';                   // gate closes (engine reports nothing sounding)
    advance(10);
    eq('after gate closes → back to white', padColor(PAD_KICK), 120);
}

_log('\napp-loop: held pad lights green, reverts on release');
{
    resetApp();
    sendMidi([0x90, PAD_KICK, 100]);   // press and HOLD
    advance(2);
    eq('held pad → green', padColor(PAD_KICK), 11);

    sendMidi([0x80, PAD_KICK, 0]);     // release
    advance(2);
    eq('released pad reverts (selected → white)', padColor(PAD_KICK), 120);
}

_log('\napp-loop: multi-step entry on a drum lane');
{
    resetApp();                          // drum lane already selected (watchLane >= 0)
    sendMidi([0x90, 16 + 0, 127]);       // hold step 0
    sendMidi([0x90, 16 + 3, 127]);       // press step 3 while step 0 held
    sendMidi([0x80, 16 + 3, 0]);         // release → step 3 toggles on
    sendMidi([0x80, 16 + 0, 0]);         // release → step 0 toggles on
    eq('drum multi: step 0 entered', occHasStep(0), true);
    eq('drum multi: step 3 entered', occHasStep(3), true);
    eq('drum multi: no length gesture', engine.ops.some((o) => o.startsWith('slen')), false);

    const stepLogs = logs.filter((l) => l.includes('seq: step'));
    eq('drum multi: two step-entry log lines', stepLogs.length, 2);
}

_log('\napp-loop: file-param jog-click opens the browser on the chain page');
{
    const { VIEW_CHAIN, VIEW_FILE_BROWSE } = await import('../dist/esm/app/state.js');
    /* Minimal filesystem for the file browser's directory listing. */
    globalThis.os = {
        readdir: () => [['kick.wav', 'snare.wav'], 0],
        stat: (p) => [{ mode: p.endsWith('.wav') ? 0x8000 : 0x4000 }, 0],
    };
    const setup = () => {
        engine.reset();
        env.setParams(MOCK_SYNTHS.file_param);     // synth slot 0 = "sample" (file)
        resetSeqState(); resetSeqEngine();
        globalThis.init();
        appState.trackModels[0][1].reload();
        advance(12);                                // load hierarchy
        appState.currentView = VIEW_CHAIN;          // user is on the chain page
        /* The Schwung page cache is keyed by (track, component) and outlives
         * init(), so this swap hands a cached controller a different module and
         * it re-plans. Gesturing into that window measures the RE-PLAN, not who
         * takes the click — which is what this block is about. Wait it out,
         * bounded; in the `off` arm nothing is claimed and this returns at once.
         * (SP-12 made the re-plan visible by polling the page once per tick
         * instead of once per rendered frame; before that the stale plan simply
         * kept answering.) */
        const owner = () => pageOwnerOf(appState.trackModels[0][1]);
        for (let i = 0; i < 12 * 60 && owner().claimed && !owner().delegated; i++) advance(1);
    };

    // Holding the file-param knob (slot 0) + jog click → file browser.
    setup();
    sendMidi([0x90, 0, 100]);   // touch knob 0 (file param), keep held
    sendMidi([0xB0, globalThis.MoveMainButton, 127]);  // jog click
    eq('chain page: file-param jog click opens file browser', appState.currentView, VIEW_FILE_BROWSE);
    /* LET GO. A knob left held keeps its slot in the controller's `touchOrder`,
     * and the Schwung page cache is keyed by (track, component) and outlives
     * `init()` — so `touched` stayed >= 0 for the rest of the run, where the
     * controller's own jog-click guard reads it and swallows the click. The
     * PRESS is what this block is about; the hold was never asserted, and it
     * silently disarmed every later block's first click. */
    sendMidi([0x90, 0, 0]);

    // Holding a non-file knob (slot 1 = Volume) + jog click → NOT a file browser.
    setup();
    sendMidi([0x90, 1, 100]);   // touch knob 1 (float param), keep held
    sendMidi([0xB0, 50, 127]);  // jog click
    eq('chain page: non-file knob jog click does not open file browser',
        appState.currentView === VIEW_FILE_BROWSE, false);
    /* Both leaks go back with it: the knob, and the Session press that took the
     * knobs to the master bus while it was down — with that latched, the
     * release below reaches a page that never heard the touch and the synth
     * page keeps the slot. */
    sendMidi([0xB0, 50, 0]);
    sendMidi([0x90, 1, 0]);
}

/* ── a knob release that outlives its page must not latch the controller ─── */
_log('\napp-loop: a knob release that outlives its page does not latch the controller');
{
    /* The block above plugs this leak by hand, in the order that avoids it.
     * This one takes the order the user does not control: the page under the
     * finger changes WHILE it is down, and the release comes out of order.
     *
     * The controller recomputes `touched` from `touchOrder` alone and has no
     * staleness expiry for a held knob — deliberately, it refuses to re-plan
     * under a hand — so a release that arrives at a page which never heard the
     * press strands the slot for the life of that controller. `touched >= 0`
     * is not a stale highlight: movy's jog-click guard reads it as "a knob is
     * under the hand" and hands every later click to the page, so the module
     * browser never opens again. */
    /* THE FIXTURE IS THE ONE THE BLOCK ABOVE LEFT, deliberately: the page cache
     * is keyed by (track, component), so swapping the module here would hand
     * the NEXT block a controller that is still re-planning — which is the
     * hazard `setup()` above waits out, and the next block does not wait. Same
     * module, same key, one live plan. */
    engine.reset();
    env.setParams(MOCK_SYNTHS.file_param);
    resetSeqState(); resetSeqEngine();
    globalThis.init();
    appState.trackModels[0][1].reload();
    advance(12);
    appState.currentView = VIEW_KNOBS;
    for (let i = 0; i < 12 * 60 && ownerFor().claimed && !ownerFor().delegated; i++) advance(1);
    const ctl = ownerFor().page?.ctl ?? null;

    sendMidi([0x90, 1, 127]);                  // touch knob 1 — the page hears it
    sendMidi([0xB0, CC_NOTE_SESSION, 127]);    // Session: the knobs are the master bus now
    sendMidi([0xB0, CC_NOTE_SESSION, 0]);      // (the release is only the button coming up —
    advance(1);                                //  Note/Session toggles on the PRESS)
    sendMidi([0x90, 1, 0]);                    // let go, onto a page that never heard the press
    sendMidi([0xB0, CC_NOTE_SESSION, 127]);    // Session again: the TRACK page has the knobs
    sendMidi([0xB0, CC_NOTE_SESSION, 0]);      // back, and it is the page left holding the slot
    advance(1);

    if (GRID_ARM === 'page') {
        eq('the pressed page is not left holding the knob', ctl?.state.touched ?? 'no page', -1);
        /* The ledger itself, not just its effect: a pin that outlives its
         * release would hold a page object for the rest of the session. */
        const { pinnedCount } = await import('../dist/esm/midi/knob-page-pin.js');
        eq('and the ledger is empty again', pinnedCount(), 0);
    }
    sendMidi([0xB0, globalThis.MoveMainButton, 127]);   // jog click, nothing held
    advance(1);
    eq('...and the next jog click still reaches movy', appState.currentView, VIEW_BROWSE);
}

/* ── a knob release must land on the MODEL that heard the press ─────────── */
_log('\napp-loop: a knob release outliving its model does not strand its overlay');
{
    /* Same shape of gesture as the block above (press, page/model changes
     * mid-hold, release out of order) but for the SP-51 bug: `knobModel()`
     * (`masterChainActive() ? masterModel() : activeModel()`) is re-resolved
     * at release time, so a track switch between press and release hands the
     * release to a different Model instance than the one whose
     * handleKnobTouch opened its enum overlay. Flag-independent (unlike the
     * SP-31 block above) — no GRID_ARM guard, since knobModel() touch/release
     * runs unconditionally in the fallback branch regardless of delegation. */
    schwungGridReload();    // drop the previous block's cached page before swapping modules
    engine.reset();
    env.setParams(MOCK_SYNTHS.name_enum);   // knob 0 = division, 10 options → overlay on touch
    resetSeqState(); resetSeqEngine();
    globalThis.init();
    appState.trackModels[0][1].reload();
    appState.trackModels[1][1].reload();
    advance(12);                              // settle both models' hierarchy
    selectTrack(0);
    appState.currentView = VIEW_KNOBS;

    sendMidi([0x90, 0, 127]);   // touch knob 0 on track 0 — opens its enumOverlay
    selectTrack(1);             // the page changes mid-hold; no MIDI needed —
                                 // this is the state knobModel() reads
    sendMidi([0x90, 0, 0]);     // release — must land on track 0's model, not track 1's

    eq('the pressed track\'s overlay is closed by its own release',
       appState.trackModels[0][1].getViewModel().overlay, null);
    eq('track 1 was not perturbed by the stray release',
       appState.trackModels[1][1].getViewModel().overlay, null);

    /* This block is the only one in the file that ever asks track 1's page
     * (selectTrack(1) mid-hold, above) — every other block only ever touches
     * track 0. Leaving track 1's half-resolved SchwungPage cached under
     * `1:<componentKey>` is invisible here but not free: it is picked up
     * later by anything that walks every cached page (idle-cost accounting,
     * a background poll), which shifted timing-sensitive assertions in
     * blocks far downstream that never touch track 1 themselves. Dropping
     * the whole cache — mine and the SP-31 block's before it — leaves the
     * next block to build fresh, exactly as if this one had not run. */
    schwungGridReload();
    selectTrack(0);
}

_log('\napp-loop: knob turn while a step is held writes automation');
{
    const { VIEW_KNOBS } = await import('../dist/esm/app/state.js');
    const { resetAutomation } = await import('../dist/esm/seq/automation.js');

    engine.reset();
    env.setParams(MOCK_SYNTHS.file_param);   // knob 0 = file, knob 1 = Volume (float)
    resetSeqState(); resetSeqEngine(); resetAutomation();
    globalThis.init();
    appState.trackModels[0][1].reload();
    advance(12);                              // settle engine + hierarchy
    appState.currentView = VIEW_KNOBS;
    appState.activeTrack = trackRef(0);

    // Step-automation mode + turning the Volume knob (CC 72 = knob 1) auto-assigns
    // a lane and writes a lock at the held step.
    seqState.stepAutoMode = true; seqState.holdStep = 4;
    sendMidi([0xB0, 72, 1]);                  // knob 1, +1
    advance(1);                               // flush the cmd queue to the engine
    eq('step-auto knob auto-assigns a lane', engine.ops.some((o) => o.startsWith('alabel 0 0 ')), true);
    eq('step-auto knob writes a lock at step 4', engine.ops.some((o) => o.startsWith('aset 0 0 4 ')), true);

    // The file param (knob 0 = CC 71) is not automatable → no aset, AND (SP-35)
    // the turn is refused rather than left to fall through as a patch edit.
    engine.reset(); resetAutomation();
    seqState.stepAutoMode = true; seqState.holdStep = 4;
    const fileKey = pageOwnerOf(appState.trackModels[0][1]).knobParamInfo(0)?.ioKey;
    eq('(fixture) the refusal can name the cell it is about', typeof fileKey, 'string');
    sendMidi([0xB0, 71, 1]);                  // knob 0 (file param)
    advance(1);
    eq('file param not automated', engine.ops.some((o) => o.startsWith('aset')), false);
    /*
     * A HELD STEP CANNOT LOCK THIS CELL, AND MOVY SAYS SO FROM ITS OWN CHROME.
     * The proactive half — the cell dimmed or hidden — lived in movy's own body
     * drawer (`renderer/label.ts: hiddenDuringHold`) and draws nothing once a
     * delegated page owns the screen (SP-35; the upstream channel for it is
     * SU-8). What movy still owns is the toast band, drawn after the body, so it
     * is live under `page`: this block's neighbour above proves that channel
     * survives delegation. NOT a decoration — `locked` means "a lane live on
     * this frame holds this PARAMETER", and setting it on a cell nobody locked
     * is the lie SP-16 removed.
     *
     * IT HAS TO CONSUME THE TURN. An unconsumed one is handed on to
     * `owner.page.knobTurn` / `model.handleKnobDelta` — an edit of the PATCH —
     * under a hand that believes it is taking a lock.
     */
    eq('a held step refuses to lock it', seqToastText(), 'NO LOCK: ' + fileKey);
    seqState.stepAutoMode = false; seqState.holdStep = -1;
}

_log('\napp-loop: param page repaints when held-step automation changes');
{
    const { VIEW_KNOBS } = await import('../dist/esm/app/state.js');
    const { resetAutomation } = await import('../dist/esm/seq/automation.js');

    // renderKnobsView is the only param-view path that calls clear_screen, so a
    // bump means the page actually repainted (LED/loop-strip use fill_rect/setLED).
    let clears = 0;
    globalThis.clear_screen = () => { clears++; };

    engine.reset();
    env.setParams(MOCK_SYNTHS.file_param);    // knob 1 = Volume (automatable float)
    resetSeqState(); resetSeqEngine(); resetAutomation();
    globalThis.init();
    appState.trackModels[0][1].reload();
    advance(12);
    appState.currentView = VIEW_KNOBS;
    appState.activeTrack = trackRef(0);

    // Enter step-automation and turn knob 1 once to assign a lane + write a lock.
    seqState.stepAutoMode = true; seqState.holdStep = 4;
    sendMidi([0xB0, 72, 1]);
    advance(20);                              // settle assign + initial repaint

    // Baseline: a held step with a stable lock must not repaint every tick
    // (the perf decoupling depends on this).
    let base = clears;
    advance(10);
    eq('idle held-step ticks do not repaint', clears, base);

    // 1) Turning a knob updates the held value → the page must repaint so the
    //    new value shows (the bug: the turn was consumed without marking dirty).
    base = clears;
    sendMidi([0xB0, 72, 1]);
    advance(2);
    eq('knob turn in step-auto repaints held value', clears > base, true);

    // 2) A status poll changing heldLocks (re-holding an automated step pulls
    //    the engine's locks via hauto) → the page must repaint to highlight it.
    engine.status.hauto = '0:10';
    advance(10);                              // absorb into the baseline
    base = clears;
    engine.status.hauto = '0:90';            // engine now reports a different lock
    advance(10);
    eq('poll-driven heldLocks change repaints', clears > base, true);

    globalThis.clear_screen = () => {};
    delete engine.status.hauto;
    seqState.stepAutoMode = false; seqState.holdStep = -1;
    resetAutomation();
}

/* ── length tail LED (held step shows its note length as a light-grey tail) ── */
{
    _log('\nlength tail LED:');
    resetApp();
    seqState.watchLane = -1;          // melodic
    seqState.lenSteps = 16;
    seqState.holdStep = 2;
    seqState.holdLen = 3;             // note spans steps 2..4 → tail on 3 and 4
    advance(4);                       // let the LED frame budget paint the step row
    eq('tail step 3 LED = light-grey (118)', padColor(16 + 3), 118);
    eq('tail step 4 LED = light-grey (118)', padColor(16 + 4), 118);
    seqState.holdStep = -1; seqState.holdLen = 0;
}

/* ── steps beyond clip length are fully off ──────────────────────────────── */
{
    _log('\nsteps beyond clip length off:');
    resetApp();
    seqState.watchLane = -1;          // melodic
    seqState.lenSteps = 4;            // clip is 4 steps; steps 5..16 are not in it
    seqState.holdStep = -1; seqState.holdLen = 0;
    advance(4);                       // let the step row paint
    eq('step 3 (in clip) is lit, not black', padColor(16 + 3) !== 0, true);
    eq('step 5 (beyond length) is fully off', padColor(16 + 5), 0);
    seqState.lenSteps = 16;
}

/* ── drum LED cleanup: non-grid pads cleared on drum entry ───────────────── */
_log('\napp-loop: drum LED cleanup on entry');
{
    resetApp();
    // Seed a stale color on a non-drum-grid pad (col >= 4 → Black in drum layout)
    ledByPad[72] = 99;
    // Force re-entry by resetting drumActive so tick re-enters the drum branch
    appState.drumActive = false;
    advance(1);
    eq('non-grid pad cleared to Black on drum entry', ledByPad[72], 0);
}

/* ── octave buttons disabled on drum track ───────────────────────────────── */
_log('\napp-loop: octave buttons disabled on drum track');
{
    resetApp();
    const { keyboardState } = await import('../dist/esm/keyboard/state.js');
    const octBefore = keyboardState.octave[appState.activeTrack.index];
    for (const k of Object.keys(buttonLeds)) delete buttonLeds[k];
    sendMidi([0xB0, 55, 127]); // MoveUp press
    advance(1);
    eq('drum track: MoveUp does not shift octave', keyboardState.octave[appState.activeTrack.index], octBefore);
    eq('drum track: MoveUp button LED stays dark', buttonLeds[55] ?? 0, 0);
}

/* ── octave buttons flash white on normal (melodic) track ────────────────── */
_log('\napp-loop: octave buttons flash on melodic track');
{
    engine.reset();
    env.setParams(MOCK_SYNTHS.test8);   // melodic synth, no drum config
    resetSeqState(); resetSeqEngine();
    globalThis.init();
    appState.trackModels[0][1].reload();
    advance(12);
    const { keyboardState } = await import('../dist/esm/keyboard/state.js');
    // After init-batch, idle octave buttons show dim (WHITE_DIM=16) on melodic
    eq('melodic idle: MoveUp button dim', buttonLeds[55], 16);
    eq('melodic idle: MoveDown button dim', buttonLeds[54], 16);

    const octBefore = keyboardState.octave[appState.activeTrack.index];
    for (const k of Object.keys(buttonLeds)) delete buttonLeds[k];

    sendMidi([0xB0, 55, 127]); // MoveUp press
    advance(1);
    eq('melodic: MoveUp shifts the active track up an octave',
        keyboardState.octave[appState.activeTrack.index], octBefore + 1);
    eq('melodic: MoveUp button lights white', buttonLeds[55], 124); // WHITE_BRIGHT

    sendMidi([0xB0, 55, 0]); // MoveUp release
    advance(1);
    eq('melodic: MoveUp release returns to dim', buttonLeds[55], 16); // WHITE_DIM
}

/* ── drum→synth module switch does not crash (getDrumConfig race) ─────────── */
_log('\napp-loop: drum→synth switch does not crash');
{
    resetApp();   // drum (mrdrums) settled: drumPadCount=16, hierarchyKey=activeModuleName
    // Switch the underlying params to a non-drum synth while keeping the model
    // state pointing at the old drum hierarchy — exactly what happens when the
    // user switches modules mid-tick before pollModuleName fires.
    env.setParams(MOCK_SYNTHS.test8);
    appState.trackModels[0][1].reload();   // forces hierarchyKey='' so next tick
                                           // processTick calls loadHierarchy

    // Without the fix this single tick throws:
    // TypeError: cannot read property 'rawMidi' of null
    let threw = false;
    try { advance(1); } catch { threw = true; }
    eq('drum→synth transition tick does not throw', threw, false);

    // After a second tick the model has fully transitioned to the melodic synth
    advance(2);
    const vm = appState.trackModels[0][1].getViewModel();
    eq('after transition: drumPadCount is 0', vm.drumPadCount, 0);
    eq('after transition: drumActive flag cleared', appState.drumActive, false);
}

/* ── step-hold: jog wheel switches param page, never note length ──────────── */
_log('\napp-loop: jog wheel while holding a step switches page (not length)');
{
    resetApp();
    appState.currentView = VIEW_KNOBS;
    const held = () => appState.trackModels[0][appState.trackChainIndex[0]];
    const page0 = shownPage(held());
    sendMidi([0x90, 16, 127]);            // hold step 1
    engine.ops.length = 0;                // watch for any 'elen' length edit
    sendMidi([0xB0, 14, 1]);              // jog wheel +1
    /* Asked through the accessor, not through movy's bank: under `page` this
     * fixture is a single Schwung page with nowhere to jog to, which is why the
     * label is still on the burn-down — a fixture limit, not a movy defect, and
     * the note in page-mode-expected-fail.json says so. Swapping the module for
     * a multi-page one poisons every later block: the page cache is keyed by
     * (track, component), outlives init(), and its contract does not re-resolve
     * after a swap even given 200 ticks and a cache drop (Cause D / SP-15). */
    eq('held-step jog switches page', shownPage(held()), page0 + 1);
    eq('no note-length edit emitted', engine.ops.some(o => o.startsWith('elen')), false);
    sendMidi([0x80, 16, 0]);              // release step
}

/* ── step-hold: jog-press suppresses the module browser ───────────────────── */
_log('\napp-loop: jog-press while holding a step never opens the browser');
{
    resetApp();
    appState.currentView = VIEW_KNOBS;
    sendMidi([0x90, 16, 127]);            // hold step 1
    sendMidi([0xB0, 3, 127]);             // jog press
    eq('knobs+held jog-press stays in params', appState.currentView, VIEW_KNOBS);
    sendMidi([0x80, 16, 0]);

    appState.currentView = VIEW_CHAIN;
    sendMidi([0x90, 16, 127]);
    sendMidi([0xB0, 3, 127]);
    eq('chain+held jog-press drills to params', appState.currentView, VIEW_KNOBS);
    eq('chain+held jog-press did not open browser', appState.currentView !== VIEW_BROWSE, true);
    sendMidi([0x80, 16, 0]);
}

/* ── step-hold: Back returns to the chain view (feature relies on this) ────── */
_log('\napp-loop: Back while holding a step returns to chain view');
{
    resetApp();
    appState.currentView = VIEW_KNOBS;
    sendMidi([0x90, 16, 127]);            // hold step 1
    sendMidi([0xB0, 51, 127]);            // Back
    eq('Back while holding a step → chain view', appState.currentView, VIEW_CHAIN);
    sendMidi([0x80, 16, 0]);
}

/* ── step page: jog enters/leaves page 0; knobs edit trig props ───────────── */
_log('\napp-loop: step page navigation + knob editing');
{
    const { stepPageState, resetStepPage } = await import('../dist/esm/seq/step-page.js');
    const { occToggleStep } = await import('../dist/esm/seq/state.js');
    engine.reset();
    env.setParams(MOCK_SYNTHS.test8);         // melodic → watchLane = -1
    resetSeqState(); resetSeqEngine(); resetStepPage();
    globalThis.init();
    appState.trackModels[0][1].reload();
    advance(12);
    appState.currentView = VIEW_KNOBS;
    appState.activeTrack = trackRef(0);

    sendMidi([0x90, 16, 127]);                // hold step 1 (abs step 0)
    occToggleStep(0);                         // the held step has a note (step page available)
    seqState.stepAutoMode = true;             // session promoted
    // Jog left from module bank 0 enters the step page; jog right leaves it.
    sendMidi([0xB0, 14, 127]);                // jog CCW (-1)
    eq('jog left enters the step page', stepPageState.selected, true);
    sendMidi([0xB0, 14, 1]);                  // jog CW (+1)
    eq('jog right leaves the step page', stepPageState.selected, false);

    // Back on the step page, the 5 knobs edit trig props (not chain automation).
    stepPageState.selected = true;
    /* Bracketed with a touch/release, which a real gesture always has anyway
     * (SP-53's own fix for the SAME shape of thing on Set Params' LINK knob —
     * "the fix was making the test bracket each turn with a touch/release").
     * Under `page` a bare CC turn with no press reaches Schwung's controller
     * with no cell "claimed" for it, so movy's own delta answer (the `off`
     * arm's untouched shape) is what a device gesture would never actually
     * produce — every physical turn is preceded by the capacitive touch. */
    /* THE TWO ARMS NOW LAND ON THE SAME VALUE, and that is the assertion
     * (SP-57 H2).
     *
     * They used to differ by exactly 2x and this block said so: Schwung gates
     * an enum at 4 raw units per option (`ENUM_DELTA_DIV`) where movy's delta
     * path gates at 8 (`detent.ts`'s `DETENT_DIV`), so one movy detent was two
     * Schwung steps. It was written up as SU-9's territory — knob feel is
     * upstream's — which turned out to be wrong about the ROUTE: movy owns how
     * many raw units one detent costs, and a virtual source now says so
     * (`rawPerDetent`). Nothing upstream was needed.
     *
     * So there is no `pageArm` landing any more. A divergence that used to be
     * parameterised here is now a thing the suite would CATCH. */

    /* Every gesture below advances ONCE MORE after the release: under `page`
     * the settled write can sit in Schwung's own `pendingWrite` until
     * `onKnobTouch(false)` flushes it (SETPARAM_THROTTLE_MS), and `seqCmd`
     * only reaches `engine.ops` on the NEXT flushed tick — reading it between
     * the turn and the release, as this block used to, caught the FIRST
     * (unmoved) write and missed the real one. */
    engine.ops.length = 0;
    sendMidi([0x90, 2, 127]);
    // CW raises probability (already 100 = max → no change); CCW lowers it.
    sendMidi([0xB0, 73, 120]); advance(1);    // knob 3 (probability) CCW: one detent, both arms
    sendMidi([0x90, 2, 0]); advance(1);
    eq('probability CCW lowers it', engine.ops.some((o) => o === 'eprob 0 0 0 -1 90'), true);
    eq('step page never emits automation aset', engine.ops.some((o) => o.startsWith('aset')), false);

    engine.ops.length = 0;
    sendMidi([0x90, 3, 127]);
    sendMidi([0xB0, 74, 8]); advance(1);      // knob 4 (condition) CW: one detent, both arms
    sendMidi([0x90, 3, 0]); advance(1);
    eq('condition knob raises it', engine.ops.some((o) => o === 'econd 0 0 0 -1 1 2'), true);

    engine.ops.length = 0;
    sendMidi([0x90, 4, 127]);
    sendMidi([0xB0, 75, 8]); advance(1);      // knob 5 (invert) → on
    sendMidi([0x90, 4, 0]); advance(1);
    eq('invert knob emits einv 1', engine.ops.some((o) => o === 'einv 0 0 0 -1 1'), true);

    engine.ops.length = 0;
    sendMidi([0x90, 0, 127]);
    /* ONE WHOLE DETENT (8 raw units), not the sub-detent nudge of 1 this used
     * to send. The `off` path ignores magnitude entirely — any delta is one
     * VEL_STEP — so a fraction of a click moved velocity there, which is the
     * hair trigger SP-57's one-rule pass removed. Under `page` a partial turn
     * now banks its remainder like every other cell, so a whole detent is what
     * both arms are asked for, and both answer with the same step. */
    sendMidi([0xB0, 71, 8]); advance(1);      // knob 1 (velocity) up → evel delta
    sendMidi([0x90, 0, 0]); advance(1);
    eq('velocity knob uses evel delta', engine.ops.some((o) => /^evel 0 0 0 -1 \d+$/.test(o)), true);

    // Length is capped by the next note: with max gate 96 ticks (1/4), turning
    // length far up clamps to 96 rather than overrunning.
    seqState.holdGate = 12; seqState.holdMaxGate = 96;
    engine.ops.length = 0;
    sendMidi([0x90, 1, 127]);
    sendMidi([0xB0, 72, 63]); advance(1);     // knob 2 (length) hard CW
    sendMidi([0x90, 1, 0]); advance(1);
    /* The LAST slen, not the first: under `page` a hard CW turn is many
     * Schwung detents, each capable of its own throttled write (settled on
     * release) — the cap must hold on whichever one the engine actually
     * keeps, and the engine keeps the last. */
    const slen = engine.ops.filter((o) => o.startsWith('slen')).pop();
    eq('length clamps to the cap (96 ticks)', slen, 'slen 0 0 0 -1 96');

    // A held step with NO note has no per-trig params → the step page is not
    // available; jog falls back to normal page nav.
    stepPageState.selected = false;
    occToggleStep(0);                         // clear the note on the held step
    sendMidi([0xB0, 14, 127]);                // jog CCW
    eq('empty step does not open the step page', stepPageState.selected, false);

    sendMidi([0x80, 16, 0]);
    seqState.stepAutoMode = false;
}

/* ── step page: tick() renders the step page when selected ────────────────── */
_log('\napp-loop: tick renders the step page');
{
    const { stepPageState, resetStepPage } = await import('../dist/esm/seq/step-page.js');
    const { occToggleStep } = await import('../dist/esm/seq/state.js');
    engine.reset();
    env.setParams(MOCK_SYNTHS.test8);
    resetSeqState(); resetSeqEngine(); resetStepPage();
    globalThis.init();
    appState.trackModels[0][1].reload();
    advance(12);
    appState.currentView = VIEW_KNOBS;
    appState.activeTrack = trackRef(0);
    sendMidi([0x90, 16, 127]);
    occToggleStep(0);                         // held step has a note
    seqState.stepAutoMode = true;
    stepPageState.selected = true;

    // renderKnobsView is the only param path that calls clear_screen, so a bump
    // proves the step-page branch repainted without throwing.
    let clears = 0;
    const origClear = globalThis.clear_screen;
    globalThis.clear_screen = () => { clears++; };
    appState.dirty = true;
    advance(1);
    globalThis.clear_screen = origClear;
    eq('tick repainted with the step page selected', clears > 0, true);

    sendMidi([0x80, 16, 0]);
    seqState.stepAutoMode = false;
}

/* ── automation: a module change re-validates lanes (purges now-stale) ─────── */
_log('\napp-loop: module change purges lanes invalid for the new module');
{
    const { laneForParam, resetAutomation } = await import('../dist/esm/seq/automation.js');
    const { requestLabelSync } = await import('../dist/esm/seq/engine.js');
    resetApp();                  // mrdrums on track 0
    resetAutomation();
    // Engine holds a valid per-pad lane (p01_vol → alias pad_vol, in mrdrums).
    engine.alabels = '-.synth:p01_vol.-.-.-.-.-.-,-.-.-.-.-.-.-.-,-.-.-.-.-.-.-.-,-.-.-.-.-.-.-.-';
    requestLabelSync();          // engine delivered labels → sync validates them
    advance(3);
    eq('per-pad lane kept under mrdrums', laneForParam(0, 'synth:p01_vol'), 1);

    // Swap the synth to a melodic module with no pad params. Without the
    // module-change re-sync the stale lane would survive until the next boot.
    env.setParams(MOCK_SYNTHS.test8);
    appState.trackModels[0][1].reload();
    advance(6);
    eq('lane purged after module change', laneForParam(0, 'synth:p01_vol'), -1);
}

/* ── automation: the pool-full toast is not overdrawn by the Loop strip ────── */
_log('\napp-loop: pool-full toast wins the bottom rows over the loop strip');
{
    const { resetAutomation, assignLane } = await import('../dist/esm/seq/automation.js');
    resetApp();
    // "8 AUTOMATION LANES — FULL" shows while a step is held and all 8 lanes are
    // assigned (pool full is derived live from the registry).
    resetAutomation();
    for (let i = 0; i < 8; i++) {
        assignLane(0, 0, { gi: 0, key: 'p' + i, ioKey: 'p' + i, target: 'synth', value: 1, min: 0, max: 2, type: 'float', automatable: true }, () => true);
    }
    seqState.stepAutoMode = true;
    appState.currentView = VIEW_KNOBS;
    appState.dirty = true;

    // drawLoopStrip() always clears its band first: fill_rect(0, 60, 128, 4, 0).
    // If the strip is (wrongly) drawn over the toast, that clear band appears.
    const rects = [];
    const origFR = globalThis.fill_rect;
    globalThis.fill_rect = (x, y, w, h, v) => rects.push([x, y, w, h, v]);
    advance(1);
    globalThis.fill_rect = origFR;
    const stripDrawn = rects.some(([x, y, w, h, v]) => x === 0 && y === 60 && w === 128 && h === 4 && v === 0);
    eq('loop strip suppressed under pool-full toast', stripDrawn, false);
    // drawJogToast draws its inverted bar at fill_rect(0, TOAST_Y=58, 128, 6, 1);
    // its presence at 8-lanes+held proves the "FULL" toast renders immediately.
    const toastDrawn = rects.some(([x, y, w, h, v]) => x === 0 && y === 58 && w === 128 && h === 6 && v === 1);
    eq('pool-full toast shown immediately at 8 lanes', toastDrawn, true);
    seqState.stepAutoMode = false; resetAutomation();
}

/* ── Full-screen file browser exits cleanly (Back + select) ──────────────────
 * Regression guard: browseOrigin must capture the pre-open view. If it captures
 * VIEW_FILE_BROWSE (because openFileBrowser already flipped currentView), Back
 * and select send the user "back" to the browser itself — a frozen screen. */
_log('\napp-loop: full-screen file browser exits cleanly');
{
    // mrdrums opens the browser in Move's factory kit folder — see its config.
    const TP = '/data/CoreLibrary/Track Presets/Drums/Electronic';
    const savedOs   = globalThis.os;
    const savedRead = globalThis.host_read_file;
    const mockFs = { [TP]: ['808 Kit.json', '909 Kit.json'] };
    // os is needed by the browser scan; install AFTER resetApp so module-config
    // loading (which also reads via host_read_file) uses the bundled config.
    resetApp();
    globalThis.os = {
        readdir: (p) => [mockFs[p] ?? [], 0],
        stat:    (p) => [{ mode: p.lastIndexOf('.') > p.lastIndexOf('/') ? 0x8000 : 0x4000 }, 0],
    };

    // Gesture: chain→knobs, jog to the Preset page, hold preset knob, jog-click.
    sendMidi([0xB0, 3, 127]); advance(1);            // jog-click: VIEW_CHAIN → VIEW_KNOBS
    // Each config bank is one page; Preset is the last of 4 (Main/Rand/Global/Preset).
    sendMidi([0xB0, 14, 1]); sendMidi([0xB0, 14, 1]); sendMidi([0xB0, 14, 1]); advance(1);  // → Preset page
    sendMidi([0x90, 0, 127]);                         // touch preset knob 0
    sendMidi([0xB0, 3, 127]);                         // jog-click → open full browser

    eq('browser opened', appState.currentView, VIEW_FILE_BROWSE);
    eq('browseOrigin captured the pre-open view', appState.browseOrigin, VIEW_KNOBS);

    /* WHAT SCHWUNG PLANS FOR THIS FIXTURE — recorded, not asserted.
     * These labels are filed in `page-mode-expected-fail.json` as one FIXTURE
     * limit, and the premise of that filing is a page plan: this MOCK declares
     * no `ui_hierarchy`, so the plan is the single fallback page 'Main' and the
     * four banks movy's own config gives it — among them the Preset bank that
     * carries `ui_preset_path` — are on no page at all. (Said of the fixture.
     * The real mrdrums DOES declare that param; SP-32 in the ledger is about
     * which config banks no module declaration carries.) Printing the plan HERE
     * is what keeps the premise a measurement rather than a recollection — a
     * maintainer reads it back on the same run that produces the failures.
     * `movyBanks` is movy's own config, `ctlPages`/`names` Schwung's plan for
     * the declaration; under `off` there is no plan and it says so. */
    const drums = appState.trackModels[0][1];          // the model this block drives
    const plan  = pageOwnerOf(drums);
    const ck    = drums?.getComponentKey?.() ?? '?';
    /* `schwungPageFor` is asked DIRECTLY when the owner has no page, so the plan
     * is read back whatever the arm — the owner is movy's whenever the mode is
     * `off`, and a measurement that only ran under `page` would be no
     * measurement at all. It is the same call `pageOwnerOf` makes. */
    const planned = plan.page ?? schwungPageFor(appState.activeTrack.index, ck);
    planned.tick();   // a fresh controller plans on its first tick, not at reload
    _log(`[page-plan] mrdrums fixture ck=${ck} mode=${schwungGridMode()}`
       + ` lib=${schwungLibAvailable()} movyBanks=${drums?.getBankCount?.()}`
       + ` claimed=${plan.claimed} delegated=${plan.delegated}`
       + ` ctlPages=${planned.pageCount}`
       + ` names=${JSON.stringify((planned.ctl?.pages ?? []).map((p) => p.name))}`);

    /* THE REST OF THIS BLOCK RUNS ONLY IN A BROWSER THAT IS ACTUALLY UP. Under
     * `page` the gesture above opens nothing, and the five checks below then
     * split into two groups that must not be confused with each other.
     *
     * THREE COULD NOT FAIL — `Back clears fileBrowserState` was true because it
     * was already null, and `select leaves the file browser` / `select clears
     * fileBrowserState` expect the view and state a browser-less run is already
     * in. A check that cannot fail is the defect this migration exists to
     * delete, whichever arm it is red on.
     *
     * TWO DID FAIL, and they are why the burn-down moved: `Back leaves the file
     * browser` (expected VIEW_KNOBS, got VIEW_CHAIN — MoveBack exiting the knobs
     * page, movy behaving normally) and `select committed the preset path`
     * (`undefined` — no browser, so no commit). Gating stopped them RUNNING, so
     * they left the ledger as a COVERAGE REDUCTION, not as a fix. The record in
     * docs/schwung-page-migration.md and page-mode-expected-fail.json says so.
     *
     * The two `eq`s above stay outside because they ARE the premise. */
    if (appState.currentView === VIEW_FILE_BROWSE) {
        // Back must return to the origin view, not to the (now empty) browser.
        sendMidi([0xB0, 51, 127]); advance(1);            // MoveBack
        eq('Back leaves the file browser', appState.currentView, VIEW_KNOBS);
        eq('Back clears fileBrowserState', appState.fileBrowserState, null);

        // Reopen, move to 808 Kit.json, select → loads + closes the browser.
        sendMidi([0x90, 0, 127]); sendMidi([0xB0, 3, 127]); advance(1);
        sendMidi([0xB0, 14, 1]);                          // skip '..' → 808 Kit.json
        globalThis.host_read_file = (p) => p.endsWith('.json') ? '{ "kind": "drumRack" }' : null;
        sendMidi([0xB0, 3, 127]);                         // jog-click = select
        globalThis.host_read_file = savedRead;
        eq('select leaves the file browser', appState.currentView, VIEW_KNOBS);
        eq('select clears fileBrowserState', appState.fileBrowserState, null);
        eq('select committed the preset path', env.params['synth:ui_preset_path'], TP + '/808 Kit.json');
    }

    globalThis.os = savedOs;
}

/* ── Main Params page: Shift+Step 5 opens, knob edits tempo, Back exits ────── */
_log('\napp-loop: main params page entry, knob routing, Back exit');
{
    const { VIEW_MAIN_PARAMS } = await import('../dist/esm/app/state.js');
    resetApp();
    engine.reset();

    // resetApp() settles on VIEW_CHAIN (drum track default); capture it as the
    // expected origin so Back must restore exactly this view.
    const originView = appState.currentView;   // VIEW_CHAIN

    // Shift+Step 5 (0-indexed button 4 = note STEP_NOTE_BASE+4 = 16+4 = 20)
    sendMidi([0xB0, MoveShift, 127]);          // Shift down
    sendMidi([0x90, 16 + 4, 127]);             // Step 5 on
    sendMidi([0x80, 16 + 4, 0]);              // Step 5 off
    sendMidi([0xB0, MoveShift, 0]);            // Shift up
    eq('shift+step 5 opens main params', appState.currentView, VIEW_MAIN_PARAMS);

    // Knob 0 turn (CC 71 = MoveKnob1, delta +1 encoded as value 1)
    // The mock engine starts with bpm=12000 (120.00 BPM). A single +1 detent
    // should raise it by 100 (to 12100 = 121 BPM) and emit a 'bpm ...' command.
    engine.ops.length = 0;
    sendMidi([0xB0, 71, 8]);                   // knob 0 (tempo) CW +1 detent (value 8 = +8 delta)
    advance(1);
    eq('knob 0 edits tempo on main page',
        engine.ops.some((c) => c.startsWith('bpm ')), true);

    // Back exits the page and must restore exactly the origin view (VIEW_CHAIN),
    // not just any view other than VIEW_MAIN_PARAMS.
    sendMidi([0xB0, MoveBack, 127]);
    eq('Back exits main params to origin view', appState.currentView, originView);
}

/* ── A track button closes the Set Parameters page (so per-track view memory
 *    can't re-show it on return to that track) ───────────────────────────── */
_log('\napp-loop: track button closes set parameters page');
{
    const { VIEW_MAIN_PARAMS } = await import('../dist/esm/app/state.js');
    const { mainPageActive } = await import('../dist/esm/seq/main-page.js');
    resetApp();
    engine.reset();
    sendMidi([0xB0, MoveShift, 127]); sendMidi([0x90, 16 + 4, 127]); sendMidi([0x80, 16 + 4, 0]); sendMidi([0xB0, MoveShift, 0]);
    eq('set params open before track press', appState.currentView, VIEW_MAIN_PARAMS);
    // Press the CURRENT track's button (CC43 = track 0): tap down+up.
    sendMidi([0xB0, 43, 127]); sendMidi([0xB0, 43, 0]);
    eq('track button leaves set params view', appState.currentView !== VIEW_MAIN_PARAMS, true);
    eq('track button clears set params state', mainPageActive(), false);
}

/* ── Set Params and Clip Params are ONE level deep ────────────────────────── */
_log('\napp-loop: set/clip params replace each other, one level deep');
{
    /* Field report: alternating the two pages made Back cycle between them
     * forever. Each page captured appState.currentView as its own origin, so
     * after one round trip the two origins pointed AT EACH OTHER — and every
     * "close the param page" site (Back, a track button, Session) then landed
     * on the sibling page instead of on a real view. */
    const { VIEW_MAIN_PARAMS, VIEW_CLIP_PARAMS } = await import('../dist/esm/app/state.js');
    const { mainPageActive } = await import('../dist/esm/seq/main-page.js');
    const { clipPageActive } = await import('../dist/esm/seq/clip-page.js');
    const STEP_SET = 4, STEP_CLIP = 2;          // Shift+Step 5 / Shift+Step 3
    const shiftStep = (btn) => {
        sendMidi([0xB0, MoveShift, 127]);
        sendMidi([0x90, 16 + btn, 127]); sendMidi([0x80, 16 + btn, 0]);
        sendMidi([0xB0, MoveShift, 0]);
    };
    const paramLayer = () => mainPageActive() || clipPageActive();

    resetApp();
    engine.reset();
    const origin = appState.currentView;        // VIEW_CHAIN

    shiftStep(STEP_SET);
    eq('set params opens', appState.currentView, VIEW_MAIN_PARAMS);
    shiftStep(STEP_CLIP);
    eq('clip params replaces set params', appState.currentView, VIEW_CLIP_PARAMS);
    shiftStep(STEP_SET);
    eq('set params replaces clip params', appState.currentView, VIEW_MAIN_PARAMS);
    shiftStep(STEP_CLIP);
    eq('clip params replaces it again', appState.currentView, VIEW_CLIP_PARAMS);

    // One Back leaves the whole param layer — for the view it was entered from.
    sendMidi([0xB0, MoveBack, 127]);
    eq('Back leaves the param layer in one press', appState.currentView, origin);

    /* A track button must not write a param page into the per-track view
     * memory: pressing the ACTIVE track's button round-trips prev.view through
     * trackView[], so what lands in currentView is exactly what was stored. */
    shiftStep(STEP_SET); shiftStep(STEP_CLIP);
    sendMidi([0xB0, 43, 127]); sendMidi([0xB0, 43, 0]);
    eq('a track switch clears the param layer', paramLayer(), false);
    eq('a track switch restores the origin view', appState.currentView, origin);

    // Session view is the master chain's screen; no param page may sit over it.
    resetApp();
    engine.reset();
    shiftStep(STEP_SET);
    eq('set params open before Session', mainPageActive(), true);
    sendMidi([0xB0, CC_NOTE_SESSION, 127]); sendMidi([0xB0, CC_NOTE_SESSION, 0]);
    advance(2);
    eq('Session view latched', seqState.sessionMode, true);
    eq('Session clears the param layer', paramLayer(), false);
}

/* ── Master FX: jog-click adds a module by DSP path (not id) ──────────────── */
_log('\napp-loop: master FX slot adds a module by DSP path');
{
    // Master FX modules live under modules/audio_fx; schwung resolves
    // master_fx:fxN:module as a DSP PATH (track slots use the bare id).
    const prevOs = globalThis.os;
    const prevRead = globalThis.host_read_file;
    globalThis.os = {
        readdir: (p) => (p.endsWith('/audio_fx') ? [['reverb'], 0] : [[], 0]),
        stat: () => [{ mode: 0x4000 }, 0],
    };
    globalThis.host_read_file = (p) =>
        p.endsWith('/audio_fx/reverb/module.json')
            ? JSON.stringify({ id: 'reverb', name: 'Reverb', dsp: 'dsp.so', component_type: 'audio_fx' })
            : null;

    const sets = [];
    const realSet = globalThis.shadow_set_param;
    const realSetT = globalThis.shadow_set_param_timeout;
    globalThis.shadow_set_param = (s, k, v) => { sets.push(`${s}|${k}=${v}`); return realSet(s, k, v); };
    /* A master load is a BLOCKING write (browser/handler.ts) — capture that
     * variant too, or the load looks like it never happened. */
    globalThis.shadow_set_param_timeout = (s, k, v, t) => { sets.push(`${s}|${k}=${v}`); return realSetT(s, k, v, t); };

    resetApp();
    seqState.sessionMode = true;          // master FX chain is shown in Session mode
    appState.masterChainIndex = MFX1;
    appState.currentView = VIEW_CHAIN;
    advance(2);

    sendMidi([0xB0, globalThis.MoveMainButton, 127]);   // jog-click on empty master slot
    eq('master jog-click opens the module browser', appState.currentView, VIEW_BROWSE);

    sendMidi([0xB0, globalThis.MoveMainKnob, 1]);        // jog → select Reverb (index 1; 0 = NONE)
    sets.length = 0;
    sendMidi([0xB0, globalThis.MoveMainButton, 127]);    // jog-click → load selection

    const moduleSet = sets.find((s) => s.includes('master_fx:fx1:module='));
    eq('master load writes master_fx:fx1:module', !!moduleSet, true);
    eq('master load writes the DSP path, not the id',
        moduleSet?.endsWith('/audio_fx/reverb/dsp.so'), true);

    globalThis.shadow_set_param = realSet;
    globalThis.shadow_set_param_timeout = realSetT;
    globalThis.os = prevOs;
    globalThis.host_read_file = prevRead;
}

/* ── Master FX: track 0 being a movy chain must not capture the master bus ── */
_log('\napp-loop: master FX adds a module while track 0 is a movy chain');
{
    /* `master_fx:` keys are schwung's own and global to the shim; they only RIDE
     * on slot 0 as a carrier. Track 0 is ALWAYS a movy chain now, so a port taken
     * by track INDEX would namespace the write `ch0:master_fx:…` — a key movy's
     * engine has never heard of, and the module would silently never load. This
     * used to be the case only under `chtracks`; it is the only case there is. */
    const prevOs = globalThis.os;
    const prevRead = globalThis.host_read_file;
    globalThis.os = {
        readdir: (p) => (p.endsWith('/audio_fx') ? [['reverb'], 0] : [[], 0]),
        stat: () => [{ mode: 0x4000 }, 0],
    };
    globalThis.host_read_file = (p) =>
        p.endsWith('/audio_fx/reverb/module.json')
            ? JSON.stringify({ id: 'reverb', name: 'Reverb', dsp: 'dsp.so', component_type: 'audio_fx' })
            : null;

    resetApp();

    const sets = [];
    const engineWrites = [];
    const realSet  = globalThis.shadow_set_param;
    const realSetT = globalThis.shadow_set_param_timeout;
    const realEng  = globalThis.host_module_set_param_blocking;
    globalThis.shadow_set_param = (s, k, v) => { sets.push(`${s}|${k}=${v}`); return realSet(s, k, v); };
    globalThis.shadow_set_param_timeout = (s, k, v, t) => { sets.push(`${s}|${k}=${v}`); return realSetT(s, k, v, t); };
    globalThis.host_module_set_param_blocking = (k, v, t) => {
        engineWrites.push(k);
        return realEng ? realEng(k, v, t) : true;
    };

    seqState.sessionMode = true;          // master FX chain is shown in Session mode
    appState.masterChainIndex = MFX1;
    appState.currentView = VIEW_CHAIN;
    advance(2);

    sendMidi([0xB0, globalThis.MoveMainButton, 127]);   // jog-click on empty master slot
    eq('master jog-click opens the module browser', appState.currentView, VIEW_BROWSE);

    sendMidi([0xB0, globalThis.MoveMainKnob, 1]);       // jog → Reverb (0 = NONE)
    sets.length = 0; engineWrites.length = 0;
    sendMidi([0xB0, globalThis.MoveMainButton, 127]);   // jog-click → load selection

    const moduleSet = sets.find((s) => s.includes('master_fx:fx1:module='));
    eq('the master load still reaches a schwung slot', !!moduleSet, true);
    eq('on slot 0, the carrier for a global key', moduleSet?.startsWith('0|'), true);
    eq('carrying the DSP path', moduleSet?.endsWith('/audio_fx/reverb/dsp.so'), true);
    eq('and nothing was namespaced to a movy chain',
        engineWrites.filter((k) => k.indexOf('ch') === 0).join(','), '');

    globalThis.shadow_set_param = realSet;
    globalThis.shadow_set_param_timeout = realSetT;
    globalThis.host_module_set_param_blocking = realEng;
    globalThis.os = prevOs;
    globalThis.host_read_file = prevRead;
}

/* ── Master FX: jog-click on a loaded slot drills into its detail params ───── */
_log('\napp-loop: master FX slot drills into detail params on jog-click');
{
    resetApp();
    // master_fx:fx1:name reads back → masterModel[0] polls non-empty (slot loaded).
    env.setParams({ ...MOCK_SYNTHS.mrdrums, 'master_fx:fx1:name': 'Reverb' });
    seqState.sessionMode = true;
    appState.masterChainIndex = MFX1;
    appState.currentView = VIEW_CHAIN;
    appState.masterDetail = false;
    appState.masterFxModels[MFX1].reload();   // pollCountdown=1 → next tick reads the name
    advance(2);

    eq('master slot reads as loaded', appState.masterFxModels[MFX1].getViewModel().isEmpty, false);

    sendMidi([0xB0, globalThis.MoveMainButton, 127]);   // jog-click on a loaded master slot
    eq('jog-click drills into master detail params', appState.masterDetail, true);

    // Jog rotation while in detail scrolls the module's param pages — it must
    // NOT switch master slots (that is grid-view navigation).
    appState.masterChainIndex = MFX1;
    sendMidi([0xB0, globalThis.MoveMainKnob, 1]);
    eq('jog rotation in detail does not switch master slot', appState.masterChainIndex, MFX1);

    // Second jog-click (now in detail) opens the module browser to swap, like
    // the track chain's VIEW_KNOBS. Back returns to the detail page (not grid).
    sendMidi([0xB0, globalThis.MoveMainButton, 127]);
    eq('second jog-click opens the module browser', appState.currentView, VIEW_BROWSE);
    sendMidi([0xB0, globalThis.MoveBack, 127]);
    eq('Back from browser returns to the detail page', appState.masterDetail, true);

    // Back from the detail page returns to the master grid (not exit, not track).
    sendMidi([0xB0, globalThis.MoveBack, 127]);
    eq('Back returns to the master chain grid', appState.masterDetail, false);
    eq('Back stays in session mode', seqState.sessionMode, true);
}

_log('\napp-loop: the track chain reaches its LAST slot');
{
    /* The jog clamped to LFO_CHAIN_INDEX, which was the last slot until MIX was
     * appended after it — so the bank bar drew a sixth segment the jog could
     * never reach. The constant was doing double duty ("which slot is the LFO"
     * AND "the highest slot"), and a grep for isLfoSlot() callers does not find
     * a site that uses the constant directly. Walk to the end and back rather
     * than asserting one index, so the next appended slot is covered too. */
    const { CHAIN_SLOTS, LFO_CHAIN_INDEX, MIX_CHAIN_INDEX } =
        await import('../dist/esm/chain/config.js');
    const last = CHAIN_SLOTS.length - 1;
    resetApp();
    env.setParams(MOCK_SYNTHS.test8);
    appState.currentView = VIEW_CHAIN;
    appState.trackChainIndex[appState.activeTrack.index] = 0;
    advance(2);

    const chainIdx = () => appState.trackChainIndex[appState.activeTrack.index];
    for (let i = 0; i < CHAIN_SLOTS.length + 2; i++) sendMidi([0xB0, globalThis.MoveMainKnob, 1]);
    eq('the jog reaches the last chain slot', chainIdx(), last);
    eq('which is MIX', chainIdx(), MIX_CHAIN_INDEX);
    ok('and that is past the LFO', last > LFO_CHAIN_INDEX);

    /* The Right arrow carries the same clamp (router.ts, MoveRight branch) and
     * it is fixed with it — but NOT asserted here: in this state the sequencer's
     * first-look dispatch consumes the arrows for bar navigation, so the branch
     * never runs and the assertion would pass or fail for reasons that have
     * nothing to do with the bound. The jog is the gesture that reaches slots.
     */

    for (let i = 0; i < CHAIN_SLOTS.length + 2; i++) sendMidi([0xB0, globalThis.MoveMainKnob, 127]);
    eq('and jogging back stops at the first slot', chainIdx(), 0);
}

_log('\napp-loop: the master chain reaches its LFO page');
{
    const { MASTER_LFO_INDEX } = await import('../dist/esm/chain/config.js');
    resetApp();
    env.setParams({
        'master_fx:fx1:name': 'Reverb',
        'master_fx:fx1:chain_params': JSON.stringify([{ key: 'mix', name: 'Mix', type: 'float' }]),
    });
    seqState.sessionMode = true;
    appState.masterChainIndex = 0;
    appState.currentView = VIEW_CHAIN;
    appState.masterDetail = false;
    advance(2);

    /* Jog right past the two sends and the four FX slots: the grid used to clamp
     * at 3, so the LFO page was unreachable even once it existed. */
    for (let i = 0; i < _MFX_SLOTS.length + 2; i++) sendMidi([0xB0, globalThis.MoveMainKnob, 1]);
    eq('jog reaches the LFO slot', appState.masterChainIndex, MASTER_LFO_INDEX);
    eq('and stops there', appState.masterChainIndex, MASTER_LFO_INDEX);

    /* It has no module, so a click drills rather than opening a browser — there
     * is nothing to browse for. */
    sendMidi([0xB0, globalThis.MoveMainButton, 127]);
    eq('jog-click drills into the LFO page', appState.masterDetail, true);
    eq('and does not open a module browser', appState.currentView === VIEW_BROWSE, false);
    sendMidi([0xB0, globalThis.MoveMainButton, 127]);
    eq('a second click still opens no browser', appState.currentView === VIEW_BROWSE, false);

    /* The knobs now edit the shim's master LFOs. */
    const lfoModel = appState.masterFxModels[MASTER_LFO_INDEX];
    eq('the LFO slot holds the LFO model', lfoModel.getComponentKey(), 'master_fx:lfo');
    sendMidi([0xB0, globalThis.MoveKnob1 + 2, 8]);   // knob 3 = MODE → bipolar
    advance(1);
    eq('a master LFO knob writes the namespaced key', env.params['master_fx:lfo1:polarity'], '1');
    eq('and not the track form', env.params['lfo1:polarity'], undefined);

    /* Under `page` (SP-55) the turn just above opened Schwung's own transient
     * "peek" panel for the enum cell it landed on, and the library's own Back
     * ladder takes that layer down FIRST (`page_input.mjs`'s `dismissPeek()`,
     * ahead of `exitMenu`/`exit` — "Back here means I have read it, go away",
     * same one-layer-at-a-time rule the picker and an entered menu follow).
     * A real gesture is never this fast on the peek's own heels, so a second
     * press — not a wait — is what a user's next Back would be. */
    /* Under `page` (SP-55) the turn just above opened Schwung's own transient
     * "peek" panel for the enum cell it landed on (`page_controller.mjs`'s
     * `ENUM_PEEK_MS = 1500`, wall-clock) — Back's own ladder takes that layer
     * down FIRST (`page_input.mjs`'s `dismissPeek()`, ahead of `exit` —
     * "Back here means I have read it, go away", the same one-layer-at-a-time
     * rule the picker and an entered menu follow). A real gesture is never
     * this fast on the peek's own heels, so age the mocked clock past it
     * rather than pressing Back twice — same technique the hold-knob test
     * below uses for its own wall-clock gesture. */
    const realNow = Date.now;
    Date.now = () => realNow() + 1600;
    sendMidi([0xB0, globalThis.MoveBack, 127]);
    Date.now = realNow;
    eq('Back returns to the master grid', appState.masterDetail, false);
}

_log('\napp-loop: active-set switch reloads the engine');
{
    // Back the host filesystem with an in-memory map and an active set "S1".
    const fs = {};
    globalThis.host_read_file  = (p) => (p in fs ? fs[p] : null);
    globalThis.host_write_file = (p, c) => { fs[p] = c; return true; };
    globalThis.host_file_exists = (p) => p in fs;
    globalThis.host_ensure_dir = () => true;
    const ACTIVE = '/data/UserData/schwung/active_set.txt';
    const stPath = (u) => '/data/UserData/schwung/modules/tools/movy/sets/' + u + '/seq-state.json';

    fs[ACTIVE] = 's1-uuid\nSet One\n';
    /* The OLD path: every assertion here is about the UI pushing `state` and
     * writing seq-state.json, which is what a mock engine can be held to. The
     * engine-owned path's own mechanics are covered in logic/set-session.mjs
     * (E1-E6) and on the device; this block keeps the writer it was written
     * for until the release that deletes it (spec §12 step 6). */
    setFlag('engpersist', 0);
    resetSetSession();                       // force a fresh boot-load
    resetApp();                              // init() + settle; boot-load reads S1
    advance(4);
    const loadsAfterBoot = engine.stateLoads.length;
    eq('boot loaded a set blob', loadsAfterBoot >= 1, true);

    /* Switch to a set that ALREADY HAS state: the poll (~96 ticks) must save the
     * outgoing set and load the incoming one. The engine reports edited state,
     * so the switch-out flush is forced rather than trusting the 24 Hz dirty
     * mirror, which can still read clean for an edit made moments before. */
    engine.stateBlob = 'movy1\nbpm 13700\ncl 0 0 16 0 0:24:60:100\n';
    fs[stPath('s2-uuid')] = 'movy1\nbpm 10000\n';
    fs[ACTIVE] = 's2-uuid\nSet Two\n';
    advance(120);
    eq('set switch triggered a fresh engine load', engine.stateLoads.length > loadsAfterBoot, true);
    eq('S1 saved on switch-out', typeof fs[stPath('s1-uuid')], 'string');
    eq('S1 kept its edits', fs[stPath('s1-uuid')].includes('bpm 13700'), true);

    /* And the counterpart: moving to another REAL set that has no state is a
     * switch, and it starts blank. Deleting a set in Move makes exactly this
     * shape — a fresh uuid movy has never seen — and carrying the work into it
     * is what made a deleted set appear to come back. */
    engine.stateBlob = 'movy1\nbpm 14900\ncl 0 0 16 0 0:24:64:100\n';
    seqState.dirty = true;
    fs[ACTIVE] = 's3-uuid\nSet Three\n';
    advance(120);
    eq('a new set starts blank', engine.stateBlob, 'movy1\n');
    eq('the work stayed with the set it was made in',
       (fs[stPath('s2-uuid')] || '').includes('bpm 14900'), true);
    eq('and did not follow', (fs[stPath('s3-uuid')] || '').includes('bpm 14900'), false);

    /* The one transition that IS a rename: schwung's provisional id being
     * replaced by the real one Move finally materialised. The id changed; the
     * set did not. */
    const loadsBeforeRename = engine.stateLoads.length;
    fs[ACTIVE] = '__pending-4-2\nNew Set 5\n';
    advance(120);
    engine.stateBlob = 'movy1\nbpm 15100\ncl 0 0 16 0 0:24:67:100\n';
    seqState.dirty = true;
    fs[ACTIVE] = 's4-uuid\nSet Four\n';
    advance(120);
    eq('materialising a set is not loaded over', engine.stateLoads.length, loadsBeforeRename + 1);
    eq('the work followed it', (fs[stPath('s4-uuid')] || '').includes('bpm 15100'), true);
}

_log('\napp-loop: nothing is live until the Set is loaded');
{
    resetApp();
    const { sessionReady, sessionPhase, resetSetSession: resetSess } =
        await import('../dist/esm/seq/set-session.js');
    resetSess();                       // back to 'booting', before any load

    /* A press before the engine holds the Set used to queue into a
     * not-yet-existing engine and flush on the very tick a blank state landed
     * on top of it. Now it is simply refused. */
    eq('gate: not ready at open', sessionReady(), false);
    eq('gate: phase is booting', sessionPhase(), 'booting');
    engine.ops.length = 0;
    sendMidi([0x90, STEP_NOTE_BASE, 127]);
    sendMidi([0x80, STEP_NOTE_BASE, 0]);
    advance(2);
    eq('gate: the press queued nothing',
        engine.ops.filter((o) => o.startsWith('tog') || o.startsWith('ltog')).length, 0);

    /* Back must always work, or an engine that never boots traps the user
     * inside movy with no way out. */
    let exited = false;
    const origExit = globalThis.host_exit_module;
    globalThis.host_exit_module = () => { exited = true; };
    sendMidi([0xB0, globalThis.MoveBack, 127]);
    advance(1);
    sendMidi([0xB0, globalThis.MoveBack, 0]);
    advance(1);
    globalThis.host_exit_module = origExit;
    /* Back at the root view opens the Leave-Movy modal rather than exiting, and
     * that IS the handler being reached: the press was not swallowed by the
     * gate. Either outcome proves the point. */
    eq('gate: Back still reaches its handler', exited || leaveModalActive(), true);

    /* Leave nothing behind: the modal swallows input while it is up, and the
     * session outlives init(), so without both of these every later test in
     * this file runs against a movy that is ignoring it. */
    if (leaveModalActive()) { sendMidi([0xB0, globalThis.MoveBack, 127]); advance(1); }
    eq('gate: the modal is closed again', leaveModalActive(), false);
    resetApp();
    advance(30);
    eq('gate: ready again for the tests below', sessionReady(), true);
}

_log('\napp-loop: the splash does not lift on a UI that is still catching up');
{
    /* A Model caches its module name and hierarchy and re-reads them only on
     * the name poll — 344 ticks, which is 1.7-5.5 s at the device's measured
     * tick rate. The settling gate used to ask the ENGINE whether the loads had
     * drained and nothing else, so the first frame after the splash came out of
     * a cache that predated the Set: an empty slot on a cold open, the previous
     * Set's module after a switch. Measured before the fix: ready at tick 1,
     * name resolved at tick 348. */
    const { sessionReady, resetSetSession: resetSess } =
        await import('../dist/esm/seq/set-session.js');

    engine.reset();
    env.setParams(MOCK_SYNTHS.mrdrums);
    resetSeqState(); resetSeqEngine();
    setFlag('setcommit', 0);
    globalThis.init();                       // no manual reload(): this is a cold open
    resetSess();

    let nameAtReady = null;
    for (let i = 0; i < 400 && nameAtReady === null; i++) {
        globalThis.tick();
        if (sessionReady()) nameAtReady = appState.trackModels[0][1].getModuleName();
    }
    eq('the visible slot names its module on the tick movy goes live',
        nameAtReady, 'MrDrums');

    resetApp();
    advance(30);
    eq('cold-open: ready again for the tests below', sessionReady(), true);
}

_log('\napp-loop: a session phase change repaints, so the splash actually covers');
{
    /* The render is gated on something being dirty, and a phase change makes no
     * model dirty on its own. So entering the splash drew nothing: the previous
     * Set's chain page stayed on screen for the whole load, and the first live
     * frame waited on whatever repainted next — the ~1 s module-name poll. */
    const { sessionReady, sessionPhase, resetSetSession: resetSess } =
        await import('../dist/esm/seq/set-session.js');
    resetApp();
    advance(30);
    eq('repaint: live to begin with', sessionReady(), true);

    /* The control arm. Without it this test cannot fail: the Loop strip repaints
     * a few rows every tick regardless, so "something was painted" proves
     * nothing on its own — a whole view is an order of magnitude more. */
    advance(2);
    let n = painted.length;
    advance(1);
    const idleRects = painted.length - n;
    eq('repaint: an idle tick paints almost nothing', idleRects < 5, true);

    n = painted.length;
    resetSess();                             // → 'booting': the splash is owed
    advance(1);
    eq('repaint: the phase change is on screen the very next tick',
        painted.length - n > idleRects * 5, true);
    eq('repaint: and what is owed is the splash', sessionPhase() !== 'ready', true);
    _log(`    (idle tick ${idleRects} rects, phase-change tick ${painted.length - n})`);

    resetApp();
    advance(400);
    eq('repaint: ready again for the tests below', sessionReady(), true);
}

_log('\napp-loop: LFO chain slot reachable + drill');
{
    resetApp();
    appState.currentView = VIEW_CHAIN;
    appState.trackChainIndex[0] = 1;          // start on SYNTH

    // Jog right 3 detents: 1→2→3→4 (LFO).
    sendMidi([0xB0, 14, 1]); advance(1);
    sendMidi([0xB0, 14, 1]); advance(1);
    sendMidi([0xB0, 14, 1]); advance(1);
    eq('jog reaches LFO slot (index 4)', appState.trackChainIndex[0], 4);

    // Jog-click drills into the LFO detail (VIEW_KNOBS), never a browser.
    sendMidi([0xB0, 3, 127]); advance(1);
    eq('LFO jog-click drills to VIEW_KNOBS', appState.currentView, VIEW_KNOBS);
    eq('active model is the LFO', appState.trackModels[0][4].getComponentKey(), 'lfo');

    // Jog in detail scrolls banks LFO1↔LFO2. Read back through the OWNER
    // (`shownPage`), not `model.getKnobPage()` directly: under `page` (SP-55)
    // the jog moves SCHWUNG's own page index and the movy model's bank
    // counter is correctly inert (same reason a real module's own bank index
    // is never consulted for drawing under delegation — schwung-grid.ts's
    // own header). `shownPage` falls back to `getKnobPage()` under `off`, so
    // this assertion is mode-agnostic.
    sendMidi([0xB0, 14, 1]); advance(1);
    eq('detail jog scrolls to LFO 2', shownPage(appState.trackModels[0][4]), 1);

    // Shift+jog-click on the LFO chain page also drills (no browser to swap).
    appState.currentView = VIEW_CHAIN;
    appState.shiftHeld = true;
    sendMidi([0xB0, 3, 127]); advance(1);
    eq('shift+click on LFO drills, no browser', appState.currentView, VIEW_KNOBS);
    appState.shiftHeld = false;
}

_log('\napp-loop: hold-knob → assign LFO target');
{
    const { appState, VIEW_CHAIN, VIEW_KNOBS } = await import('../dist/esm/app/state.js');
    const { resetAssignMode, assignActive } = await import('../dist/esm/lfo/assign-mode.js');
    engine.reset();
    env.setParams(MOCK_SYNTHS.test8);
    resetSeqState(); resetSeqEngine();
    globalThis.init();
    appState.trackModels[0][1].reload();  // load the synth hierarchy
    advance(12);                          // settle hierarchy + engine
    appState.trackChainIndex[0] = 1;      // synth
    appState.currentView = VIEW_KNOBS;
    resetAssignMode();
    eq('synth param 0 is automatable', appState.trackModels[0][1].getKnobParamInfo(0)?.automatable, true);

    const realNow = Date.now; let t = 10000; Date.now = () => t;
    sendMidi([0x90, 0, 100]);             // touch knob 0 (automatable synth param)
    advance(1);
    t = 11100; advance(1);                // > 1000ms → holdTick activates assign mode
    eq('assign mode active after hold', assignActive(), true);

    sendMidi([0xB0, 3, 127]);             // jog-click → assign LFO1
    advance(1);
    eq('assigned: navigated to LFO slot', appState.trackChainIndex[0], 4);
    eq('assigned: on chain view', appState.currentView, VIEW_CHAIN);
    eq('assign mode exited', assignActive(), false);

    // Bug 1: the LFO page must show the freshly-assigned target, not "None"
    // (the model's cached target was stale until reload()).
    advance(3);
    eq('LFO page shows the assigned target (not None)',
        appState.trackModels[0][4].getViewModel().rows[0][3].displayValue !== 'None', true);

    // Bug 2: the knob was never released (release landed on the LFO model), so
    // the module's touch would stick — returning to the module page must clear
    // it (touch reset on shown-page change).
    eq('module still touched before return',
        appState.trackModels[0][1].getViewModel().touchedSlot, 0);
    appState.trackChainIndex[0] = 1;      // navigate back to the synth
    advance(2);
    eq('module touch cleared on return',
        appState.trackModels[0][1].getViewModel().touchedSlot, null);
    Date.now = realNow;
}

_log('\napp-loop: jog touch shows the CLICK JOG hint only after a hold');
{
    const { jogHintVisible, jogHintTouch } = await import('../dist/esm/app/jog-hint.js');
    resetApp();
    appState.currentView = VIEW_CHAIN;
    jogHintTouch(false);

    const realNow = Date.now; let t = 20000; Date.now = () => t;
    sendMidi([0x90, 9, 127]);              // jog touch on
    advance(1);
    eq('no hint on touch', jogHintVisible(), false);
    t = 20500; advance(1);
    eq('no hint mid-hold', jogHintVisible(), false);
    t = 21100; advance(1);                 // > HOLD_MS
    eq('hint after the hold', jogHintVisible(), true);

    sendMidi([0xB0, 14, 1]);               // jog turn
    advance(1);
    eq('turn removes the hint', jogHintVisible(), false);

    // Touch → turn → keep resting: the turn already answered the question.
    t = 30000; sendMidi([0x90, 9, 127]);
    sendMidi([0xB0, 14, 1]);
    t = 31500; advance(1);
    eq('no hint after a turn, however long the hold', jogHintVisible(), false);

    sendMidi([0x90, 9, 0]);                // release
    Date.now = realNow;
}

_log('\napp-loop: root-view Back → Leave modal → Background parks');
{
    const { soundingCount } = await import('../dist/esm/keyboard/held-notes.js');
    const { leaveModalActive } = await import('../dist/esm/app/leave-modal.js');
    resetApp();
    appState.currentView = VIEW_CHAIN;           // root view
    sendMidi([0x90, PAD_KICK, 100]);             // hold a pad
    let suspended = 0;
    globalThis.host_suspend_overtake = () => { suspended++; };
    sendMidi([0xB0, globalThis.MoveBack, 127]);  // Back → open modal (no instant park)
    eq('Back opened the Leave modal', leaveModalActive(), true);
    eq('opening the modal released the held pad', soundingCount(), 0);
    eq('Back did NOT park instantly', suspended, 0);
    sendMidi([0xB0, globalThis.MoveMainButton, 127]);  // jog-click → Background (default)
    eq('jog-click Background parked movy', suspended, 1);
    eq('modal closed after confirm', leaveModalActive(), false);
    delete globalThis.host_suspend_overtake;
}

_log('\napp-loop: Leave modal — Back cancels; old host offers only Close Movy');
{
    const { leaveModalActive, leaveModalLabels } = await import('../dist/esm/app/leave-modal.js');
    resetApp();
    appState.currentView = VIEW_CHAIN;
    globalThis.host_suspend_overtake = () => {};
    sendMidi([0xB0, globalThis.MoveBack, 127]);       // open
    eq('modal offers Background + Close', leaveModalLabels().join(','), 'Background,Close Movy');
    sendMidi([0xB0, globalThis.MoveBack, 127]);       // Back again → cancel
    eq('second Back cancels the modal', leaveModalActive(), false);
    // Old host: no host_suspend_overtake → only Close Movy → jog-click exits.
    let exited = 0;
    const realExit = globalThis.host_exit_module;
    globalThis.host_exit_module = () => { exited++; };
    delete globalThis.host_suspend_overtake;
    sendMidi([0xB0, globalThis.MoveBack, 127]);       // open (Close only)
    eq('old host: modal offers only Close Movy', leaveModalLabels().join(','), 'Close Movy');
    sendMidi([0xB0, globalThis.MoveMainButton, 127]); // jog-click → Close
    eq('old host: jog-click closes movy', exited, 1);
    globalThis.host_exit_module = realExit;
}

_log('\napp-loop: Leave modal — the hardware keeps working; using it dismisses the menu');
{
    const { leaveModalActive } = await import('../dist/esm/app/leave-modal.js');
    const { stepRecActive } = await import('../dist/esm/seq/step-rec.js');
    const { soundingCount } = await import('../dist/esm/keyboard/held-notes.js');
    const CC_TRACK_1 = 42;   // CC 43 = track 0, so CC 42 = track 1
    const CC_PLAY = 85, CC_REC = 86;
    /* Back toggles: with the modal already up it cancels instead of opening, and
     * resetApp() does not clear modal state. Close first so each case starts
     * from the same place. */
    const openModal = () => {
        if (leaveModalActive()) sendMidi([0xB0, globalThis.MoveBack, 127]);
        appState.currentView = VIEW_CHAIN;             // root view — Back opens the modal
        sendMidi([0xB0, globalThis.MoveBack, 127]);
        sendMidi([0xB0, globalThis.MoveBack, 0]);
        eq('modal opened', leaveModalActive(), true);
    };
    globalThis.host_suspend_overtake = () => {};

    resetApp();
    selectTrack(0);
    openModal();
    sendMidi([0xB0, CC_TRACK_1, 127]);
    eq('track press dismissed the modal', leaveModalActive(), false);
    sendMidi([0xB0, CC_TRACK_1, 0]);                   // quick tap → latches the switch
    eq('the same press also switched track', appState.activeTrack.index, 1);

    resetApp();
    openModal();
    const wasSession = seqState.sessionMode;
    sendMidi([0xB0, CC_NOTE_SESSION, 127]);
    eq('Session press dismissed the modal', leaveModalActive(), false);
    eq('the same press also opened Session', seqState.sessionMode, !wasSession);
    sendMidi([0xB0, CC_NOTE_SESSION, 0]);

    /* Transport is the other half of the policy: it runs UNDER the modal, so
     * the dialog must survive it. */
    resetApp();
    openModal();
    const playing = seqState.playing;
    sendMidi([0xB0, CC_PLAY, 127]);
    eq('Play ran under the modal', seqState.playing, !playing);
    eq('Play did NOT dismiss the modal', leaveModalActive(), true);

    /* A knob turn stays swallowed: the modal covers the screen, so the edit
     * would be invisible. Counting param writes, not modal state — "the modal
     * is still up" would also hold if the turn had edited a param behind it. */
    const realSet = globalThis.shadow_set_param;
    let writes = 0;
    globalThis.shadow_set_param = (...a) => { writes++; return realSet(...a); };
    sendMidi([0xB0, globalThis.MoveKnob1, 4]);
    globalThis.shadow_set_param = realSet;
    eq('knob turn wrote no param behind the modal', writes, 0);
    eq('knob turn still swallowed', leaveModalActive(), true);

    /* Confirming hands the foreground away, so a hold armed while the modal was
     * up can never see its release. Rec latches step-record — it must be gone. */
    resetApp();
    openModal();
    sendMidi([0xB0, CC_REC, 127]);                     // held Rec while stopped
    eq('Rec armed step-record under the modal', stepRecActive(), true);
    sendMidi([0xB0, globalThis.MoveMainButton, 127]);  // jog-click → Background
    eq('confirming forgot the hold armed under the modal', stepRecActive(), false);

    /* The rest of the hardware is the same policy, not a special case: playing
     * the instrument answers the menu by walking away. */
    resetApp();
    openModal();
    sendMidi([0x90, PAD_KICK, 100]);
    eq('a pad dismissed the modal', leaveModalActive(), false);
    eq('and the pad still sounded', soundingCount(), 1);
    sendMidi([0x80, PAD_KICK, 0]);
    eq('the pad release landed normally', soundingCount(), 0);

    resetApp();
    openModal();
    const step = STEP_NOTE_BASE + 4;
    sendMidi([0x90, step, 100]); sendMidi([0x80, step, 0]);
    eq('a step button dismissed the modal', leaveModalActive(), false);
    eq('and the step still toggled a note', occHasStep(4), true);

    /* The host trickles [0,0,0] into the overtake callback whether or not
     * anyone touched anything. Dismissing on undecodable traffic killed the
     * menu in the same millisecond Back opened it, on device — no press
     * involved, and Close Movy became unreachable. */
    resetApp();
    openModal();
    sendMidi([0, 0, 0]);
    advance(1);
    eq('host junk did NOT dismiss the modal', leaveModalActive(), true);
    sendMidi([0xF8, 0, 0]);                            // MIDI clock
    eq('a clock byte did NOT dismiss it either', leaveModalActive(), true);
    sendMidi([0xB0, globalThis.MoveBack, 127]);        // cancel for the next case

    /* Shift is a modifier, not an answer: dismissing on it would break the
     * combo the press was reaching for. */
    resetApp();
    openModal();
    sendMidi([0xB0, globalThis.MoveShift, 127]);
    eq('Shift did NOT dismiss the modal', leaveModalActive(), true);
    eq('Shift still registered', appState.shiftHeld, true);
    sendMidi([0xB0, globalThis.MoveMainButton, 127]);  // confirm → Background
    eq('confirming forgot the Shift latch too', appState.shiftHeld, false);
    delete globalThis.host_suspend_overtake;
}

_log('\napp-loop: parked tick does no LED work, keeps engine synced');
{
    const { uiTick } = await import('../dist/esm/seq/engine.js');
    resetApp();
    advance(4);                                   // let LEDs settle
    let ledWrites = 0, fillRects = 0;
    const realSetLED = globalThis.setLED;
    const realFillRect = globalThis.fill_rect;
    globalThis.setLED = (n, c) => { ledWrites++; realSetLED(n, c); };
    globalThis.fill_rect = (...a) => { fillRects++; if (realFillRect) realFillRect(...a); };
    const beforeUi = uiTick();
    globalThis.overtakeParked = true;
    advance(8);
    eq('parked: zero LED writes', ledWrites, 0);
    eq('parked: zero fill_rect (no render)', fillRects, 0);   // perf: parked path skips the draw pipeline
    eq('parked: engine still ticked (uiTick advanced)', uiTick() - beforeUi, 8);
    globalThis.overtakeParked = false;
    globalThis.setLED = realSetLED;
    globalThis.fill_rect = realFillRect;
}

_log('\napp-loop: onResume invalidates caches and repaints');
{
    resetApp();
    advance(6);
    globalThis.overtakeParked = true;             // park, advance blind
    advance(8);
    globalThis.overtakeParked = false;
    let ledWrites = 0;
    const realSetLED = globalThis.setLED;
    globalThis.setLED = (n, c) => { ledWrites++; realSetLED(n, c); };
    globalThis.onResume();
    eq('onResume set dirty', appState.dirty, true);
    eq('onResume reset init-LEDs flag', appState.initLedsDone, false);
    advance(3);
    if (ledWrites > 0) ok('resume repainted LEDs');
    else fail('resume repainted LEDs', 'no LED writes after resume');
    globalThis.setLED = realSetLED;
}

_log('\napp-loop: LINK toggle routes through knob 2 on the Set page');
{
    const { mainPageActive } = await import('../dist/esm/seq/main-page.js');
    resetApp();
    eq('link off initially', seqState.linkEnabled, false);
    // Open the Set page: Shift + Step 5 (step-button index 4 = note 20).
    appState.shiftHeld = true;
    sendMidi([0x90, 20, 100]);          // Step 5 press → opens Main Params (page 0)
    sendMidi([0x80, 20, 0]);
    appState.shiftHeld = false;
    eq('Set page open', mainPageActive(), true);
    // Regression: the knob-dispatch gate must span the whole page, or cells
    // are dead on device. Clockwise → LINK on (LINK is knob 2 = CC 73).
    // Touch/release bracket each turn (as a real gesture always has one): under
    // `page` a write is throttled (SETPARAM_THROTTLE_MS, SU-13) and only the
    // RELEASE flushes it synchronously — two turns fired back-to-back with no
    // release in between (this test's original shape, written for the `off`
    // arm's synchronous apply) leaves the second one sitting in Schwung's
    // pendingWrite, unobservable until a real tick's worth of wall-clock time
    // has passed. Both arms read `seqState.linkEnabled` at the same points.
    sendMidi([0x90, 2, 127]);
    sendMidi([0xB0, 73, 40]); advance(1);
    sendMidi([0x90, 2, 0]);
    eq('knob 2 CW enables link', seqState.linkEnabled, true);
    sendMidi([0x90, 2, 127]);
    sendMidi([0xB0, 73, 88]); advance(1);   // counter-clockwise → LINK off
    sendMidi([0x90, 2, 0]);
    eq('knob 2 CCW disables link', seqState.linkEnabled, false);
}

/* Note conservation: every note-on movy sends must be answered by a note-off on
 * the SAME channel by the end of a scenario. This is the assertion that catches
 * leak paths nobody enumerated — it does not care which transition stranded the
 * note, only that one did. */
function makeNoteLedgerProbe() {
    const open = new Map();   // `${ch}:${pitch}` → count
    const orig = globalThis.shadow_send_midi_to_dsp;
    globalThis.shadow_send_midi_to_dsp = (msg) => {
        const [status, d1, d2] = msg;
        const kind = status & 0xF0, ch = status & 0x0F, key = `${ch}:${d1}`;
        if (kind === 0x90 && d2 > 0) open.set(key, (open.get(key) ?? 0) + 1);
        else if (kind === 0x80 || (kind === 0x90 && d2 === 0)) {
            const n = (open.get(key) ?? 0) - 1;
            if (n > 0) open.set(key, n); else open.delete(key);
        }
        if (typeof orig === 'function') orig(msg);
    };
    return {
        stranded: () => [...open.keys()],
        restore:  () => { globalThis.shadow_send_midi_to_dsp = orig; },
    };
}

_log('\napp-loop: note conservation across context changes');
{
    /* Hold a pad, switch tracks, release: the note must not outlive the switch. */
    resetApp();
    let probe = makeNoteLedgerProbe();
    sendMidi([0x90, PAD_KICK, 100]);                     // pad down on track 1 (slot 0)
    sendMidi([0xB0, 42, 127]); sendMidi([0xB0, 42, 0]);  // → track 2 (slot 1)
    // Cut on switch: the note is already released before the pad comes up. The
    // ledger alone would route the eventual off to the right channel anyway, so
    // conservation cannot see this — only the timing can.
    eq('track switch cut the note immediately', probe.stranded().join(','), '');
    sendMidi([0x80, PAD_KICK, 0]);                       // pad up, now on another track
    eq('no note stranded by a track switch', probe.stranded().join(','), '');
    probe.restore();

    /* Hold a pad, enter Session mode (which swallows pad note-offs), release. */
    resetApp();
    probe = makeNoteLedgerProbe();
    sendMidi([0x90, PAD_KICK, 100]);
    sendMidi([0xB0, CC_NOTE_SESSION, 127]);              // Note/Session button down
    sendMidi([0x80, PAD_KICK, 0]);
    eq('no note stranded by Session entry', probe.stranded().join(','), '');
    probe.restore();

    /* Hold a pad and close movy: teardown must release it. */
    resetApp();
    probe = makeNoteLedgerProbe();
    sendMidi([0x90, PAD_KICK, 100]);
    globalThis.onUnload();
    eq('no note stranded by teardown', probe.stranded().join(','), '');
    probe.restore();
}

/* Closing movy must persist. The autosave runs every ~3 s, so without a flush
 * on teardown every exit silently discarded whatever was done since the last
 * one — the "I left Movy, went back in, and the set is gone" report. */
_log('\napp-loop: teardown flushes pending state');
{
    const fs = {};
    globalThis.host_read_file  = (p) => (p in fs ? fs[p] : null);
    globalThis.host_write_file = (p, c) => { fs[p] = c; return true; };
    globalThis.host_file_exists = (p) => p in fs;
    globalThis.host_ensure_dir = () => true;
    const ACTIVE = '/data/UserData/schwung/active_set.txt';
    const stPath = (u) => '/data/UserData/schwung/modules/tools/movy/sets/' + u + '/seq-state.json';

    fs[ACTIVE] = 'u1-uuid\nUnload Set\n';
    resetSetSession();
    resetApp();
    advance(4);                                   // boot-load resolves the set

    // An edit lands and movy closes well inside the ~3 s autosave interval.
    engine.stateBlob = 'movy1\nbpm 15500\ncl 0 0 16 0 0:24:64:100\n';
    globalThis.onUnload();
    eq('teardown wrote the set', typeof fs[stPath('u1-uuid')], 'string');
    eq('teardown kept the edit', fs[stPath('u1-uuid')].includes('bpm 15500'), true);

    /* onUnload() is a teardown: the session it left behind is not live, and the
     * gate means every later test would be talking to a movy that ignores it.
     * Bring it back up on the same mock fs. */
    resetSetSession();
    resetApp();
    advance(30);
}

/* ── shift+jog skips a whole level through the real router ───────────────── */

_log('\napp-loop: shift+jog skips a level\'s overflow pages');
{
    engine.reset();
    env.setParams(MOCK_SYNTHS.hier_params_overflow_two_levels);
    resetSeqState();
    resetSeqEngine();
    globalThis.init();
    const m = appState.trackModels[0][1];
    m.reload();
    advance(12);
    appState.currentView = VIEW_KNOBS;

    eq('shift+jog: 3 pages (Main, Main - 2, Effects)', m.getBankCount(), 3);

    sendMidi([0xB0, globalThis.MoveMainKnob, 1]);        // plain jog CW
    advance(1);
    eq('shift+jog: plain jog steps one page', shownPage(m), 1);

    sendMidi([0xB0, globalThis.MoveShift, 127]);         // Shift down
    sendMidi([0xB0, globalThis.MoveMainKnob, 127]);      // jog CCW (decodeDelta → -1)
    advance(1);
    eq('shift+jog: back jumps to the level head', m.getKnobPage(), 0);

    sendMidi([0xB0, globalThis.MoveMainKnob, 1]);        // jog CW, still shifted
    advance(1);
    eq('shift+jog: forward skips the overflow page', m.getKnobPage(), 2);
    sendMidi([0xB0, globalThis.MoveShift, 0]);           // Shift up
}

/* ── a lost button release must not wedge the knobs ──────────────────────── */

_log('\napp-loop: a dropped step release never strands the hold');
{
    /* Field report (Discord, 2026-08-02): after a while of ordinary use the
     * knobs stop editing anything movy owns — tempo, clip length, step length —
     * until movy is closed and reopened. Cause: a step-button release that never
     * arrives leaves heldRanges holding a phantom, which keeps stepAutoMode
     * latched, which routes every knob turn into step automation forever. Three
     * ways in, three ways out. */
    const holdStep = (btn) => {
        sendMidi([0x90, STEP_NOTE_BASE + btn, 127]);
        const t0 = Date.now(); while (Date.now() - t0 < STEP_AUTO_MS + 60) { /* wall-clock hold */ }
        advance(4);
    };
    const openMainParams = () => {
        sendMidi([0xB0, globalThis.MoveShift, 127]);
        sendMidi([0x90, STEP_NOTE_BASE + 4, 127]);   // Shift+Step 5
        sendMidi([0x90, STEP_NOTE_BASE + 4, 0]);
        sendMidi([0xB0, globalThis.MoveShift, 0]);
        advance(2);
    };
    const tempoTurns = () => {
        const before = seqState.bpmX100;
        for (let i = 0; i < 12; i++) sendMidi([0xB0, globalThis.MoveKnob1, 4]);
        advance(4);
        return seqState.bpmX100 - before;
    };

    // (1) The Leave-Movy modal used to swallow the release outright.
    resetApp();
    sendMidi([0x90, STEP_NOTE_BASE, 127]); sendMidi([0x80, STEP_NOTE_BASE, 0]); advance(6);
    holdStep(0);
    eq('modal: hold promoted to step-automation', seqState.stepAutoMode, true);
    stepPageState.selected = true;
    appState.currentView = VIEW_CHAIN;
    sendMidi([0xB0, globalThis.MoveBack, 127]);          // → Leave-Movy modal
    eq('modal: is up', leaveModalActive(), true);
    sendMidi([0x80, STEP_NOTE_BASE, 0]);                 // release under the modal
    eq('modal: hold forgotten', anyStepHeld(), false);
    eq('modal: step-automation ended', seqState.stepAutoMode, false);
    sendMidi([0xB0, globalThis.MoveBack, 127]);          // cancel
    advance(4);
    openMainParams();
    eq('modal: tempo knob still edits tempo', tempoTurns() > 0, true);

    // (2) The host drops the release outright (its input callback was blocked by
    //     a synchronous module scan). heldRanges is keyed by button, so the next
    //     press of THAT step re-registers it — but the stale `gestured` mark
    //     survived, and it is what says "this release was not a tap". The step
    //     then silently refused to enter a note until pressed twice.
    resetApp();
    holdStep(0);                                          // promoted → marked gestured
    eq('dropped: hold registered', anyStepHeld(), true);
    eq('dropped: a promoted hold enters no note', occHasStep(0), false);
    /* release never arrives */
    sendMidi([0x90, STEP_NOTE_BASE, 127]);                // press again
    sendMidi([0x80, STEP_NOTE_BASE, 0]);                  // …and tap out of it
    advance(2);
    eq('dropped: the hold is gone', anyStepHeld(), false);
    eq('dropped: step-automation ended', seqState.stepAutoMode, false);
    eq('dropped: the tap still enters its note', occHasStep(0), true);

    // (3) Even while a step really is held, the page on screen owns its knobs.
    resetApp();
    sendMidi([0x90, STEP_NOTE_BASE, 127]); sendMidi([0x80, STEP_NOTE_BASE, 0]); advance(6);
    openMainParams();
    holdStep(0);
    stepPageState.selected = true;
    eq('page priority: Main Params is on screen', mainPageActive(), true);
    eq('page priority: tempo knob reaches the page', tempoTurns() > 0, true);
    sendMidi([0x80, STEP_NOTE_BASE, 0]);
    advance(2);

    /* (4) The input lock-up, in two button presses. "Open" used to be a flag of
     * its own, synced by hand at the open site, so any path that moved
     * currentView without closing the page left it latched — and Note/Session
     * did not close Main Params. The knob dispatch asks Main Params first, so
     * from then on every knob turn anywhere fed the tempo invisibly, and clip
     * length and module params were dead until movy was reopened. That is the
     * lock-up users reported for months. Note/Session now closes the param
     * layer outright, so this is a second line of defence, not the only one. */
    resetApp();
    openMainParams();
    eq('lock-up: the page is up', mainPageActive(), true);
    /* Three ordinary presses, all reachable: Note/Session latches Session (Main
     * Params keeps the screen, so only the pads change), and the jog click then
     * lands in masterChainActive(), which never excluded the params views — it
     * opens the master browser and takes the screen. */
    sendMidi([0xB0, CC_NOTE_SESSION, 127]);
    sendMidi([0xB0, CC_NOTE_SESSION, 0]);
    advance(2);
    sendMidi([0xB0, globalThis.MoveMainButton, 127]);
    sendMidi([0xB0, globalThis.MoveMainButton, 0]);
    advance(2);
    eq('lock-up: the browser took the screen', appState.currentView, VIEW_BROWSE);
    eq('lock-up: the page stopped being open', mainPageActive(), false);
    eq('lock-up: and stopped eating the knobs', tempoTurns(), 0);
}

_log('\napp-loop: step recording paints a blinking red head');
{
    resetApp();
    const { C_REC_RED } = await import('../dist/esm/seq/colors.js');
    const { stepRecActive } = await import('../dist/esm/seq/step-rec.js');
    const { soundingCount } = await import('../dist/esm/keyboard/held-notes.js');

    seqState.playing = false;
    seqState.lenSteps = 16;
    /* The engine's master tick does NOT advance while the transport is stopped
     * (seq-core returns before incrementing it) and is only reset on play — so
     * for a stopped-only mode like step recording it is a FROZEN number,
     * whatever the last stop left. Pin it inside an odd 24-tick block: the
     * value that used to leave the head permanently black. */
    seqState.engineTick = 24;

    const realNow = Date.now;
    let t = 500000;
    Date.now = () => t;
    const head = () => ledByPad[STEP_NOTE_BASE + 0];

    sendMidi([0xB0, 86, 127]);                 // hold Rec
    advance(3);
    eq('step recording entered from a real Rec press', stepRecActive(), true);
    eq('head lit red despite the frozen engine tick', head(), C_REC_RED);

    t += 250;
    advance(1);
    eq('head dark on the other half of the blink', head() !== C_REC_RED, true);

    t += 250;
    advance(1);
    eq('head red again — it really blinks', head(), C_REC_RED);

    /* Move the head with a rest and confirm the red follows it. */
    sendMidi([0xB0, 63, 127]);                 // Right = rest
    sendMidi([0xB0, 63, 0]);
    advance(2);
    eq('the red head followed the rest', ledByPad[STEP_NOTE_BASE + 1], C_REC_RED);

    sendMidi([0xB0, 86, 0]);                   // release Rec
    advance(2);
    eq('mode left on release', stepRecActive(), false);
    Date.now = realNow;
    seqState.lenSteps = 0;
    seqState.engineTick = 0;
}

_log('\napp-loop: step recording advertises the arrows it can act on');
{
    resetApp();
    const { WHITE_BRIGHT, WHITE_DIM, WHITE_OFF } = await import('../dist/esm/seq/colors.js');
    const CC_LEFT = 62, CC_RIGHT = 63;

    seqState.playing = false;
    seqState.lenSteps = 16;
    seqState.engineTick = 24;            // frozen, as it is whenever stopped

    const realNow = Date.now;
    let t = 500000;                      // even 250 ms block → bright half
    Date.now = () => t;

    sendMidi([0xB0, 86, 127]);           // hold Rec → head on step 1
    advance(3);
    eq('Right advertises itself — always pressable (rest / tie)',
        buttonLeds[CC_RIGHT], WHITE_BRIGHT);
    eq('Left is dark on the first step — nothing to step back to',
        buttonLeds[CC_LEFT], WHITE_OFF);

    t += 250;
    advance(1);
    eq('Right blinks rather than sitting lit', buttonLeds[CC_RIGHT], WHITE_DIM);
    eq('Left stays dark through the blink', buttonLeds[CC_LEFT], WHITE_OFF);

    t += 250;
    sendMidi([0xB0, 63, 127]);           // Right = rest → head on step 2
    sendMidi([0xB0, 63, 0]);
    advance(2);
    eq('Left lights once there is a step to go back to',
        buttonLeds[CC_LEFT], WHITE_BRIGHT);

    t += 250;
    advance(1);
    eq('Left blinks too', buttonLeds[CC_LEFT], WHITE_DIM);

    sendMidi([0xB0, 86, 0]);             // release Rec
    advance(2);
    Date.now = realNow;
    seqState.lenSteps = 0;
    seqState.engineTick = 0;
}

_log('\napp-loop: loop-mode bars pulse on the firmware channels, not on any tick');
{
    resetApp();
    const { occToggleStep } = await import('../dist/esm/seq/state.js');
    const { trackColor, C_DARKGREY, C_WHITE, ANIM_PULSE }
        = await import('../dist/esm/seq/colors.js');
    const CC_LOOP = 58;

    /* Capture the raw note-ons so the animation CHANNEL is visible — the whole
     * point of the change is that the hardware owns the pulse. The old version of
     * this scene guarded a JS blink derived from the engine tick, which froze
     * while the transport was stopped; nothing about a bar is JS-timed now, so
     * the guard becomes "a frozen tick and a moving clock change nothing". */
    const msgs = [];
    globalThis.move_midi_internal_send = (m) => msgs.push(m);

    seqState.playing = false;
    seqState.loopStart = 16;
    seqState.lenSteps = 32;              // loop = bars 2-3
    seqState.barOffset = 1;              // bar 2 selected
    seqState.engineTick = 24;            // frozen in an odd block, as when stopped
    occToggleStep(16 * 3 + 2);           // content outside the loop — not indicated

    const realNow = Date.now;
    let t = 500000;
    Date.now = () => t;

    /* Paint the step row in Note mode FIRST so lastNoteLed is warm. Without this
     * the exit-repaint assertion below passes either way — an empty cache always
     * sends — and proves nothing about the two-cache hazard. */
    advance(4);
    const noteModeRow = [...Array(16).keys()].map((i) => ledByPad[STEP_NOTE_BASE + i]);
    eq('step row warm before entering Loop mode',
        noteModeRow.every((c) => c !== undefined), true);

    sendMidi([0xB0, CC_LOOP, 127]); sendMidi([0xB0, CC_LOOP, 0]);   // tap → Loop mode
    advance(4);                          // base frame + animation frame + budget
    eq('loop mode entered', seqState.loopMode, true);
    const chanOf = (n) => msgs.filter((m) => m[2] === n).map((m) => m[1] & 0x0f);
    const lastColor = (n) => msgs.filter((m) => m[2] === n).at(-1)?.[3];
    eq('selected bar pulses with a frozen engine tick',
        chanOf(STEP_NOTE_BASE + 1).includes(ANIM_PULSE), true);
    eq('the other loop bar pulses on the same channel',
        chanOf(STEP_NOTE_BASE + 2).includes(ANIM_PULSE), true);
    eq('selected bar pulses white', lastColor(STEP_NOTE_BASE + 1), C_WHITE);
    eq('active bar pulses the track colour',
        lastColor(STEP_NOTE_BASE + 2), trackColor(watchedTrack()));
    eq('a bar outside the loop is dark grey', lastColor(STEP_NOTE_BASE + 0), C_DARKGREY);

    // Time passing sends nothing further: the pulse is not redrawn per frame.
    msgs.length = 0;
    t += 250;
    advance(2);
    eq('no LED traffic while only the clock moves', msgs.length, 0);

    /* Leaving Loop mode must repaint the step row. The bars were written through
     * cachedSetAnimLED (lastAnimLed) while the step colours live in lastNoteLed —
     * two caches over the same 16 notes. Without forgetting both on the toggle,
     * the step row diffs against colours the hardware no longer shows and skips
     * the sends, leaving the bars on screen in Note mode. */
    msgs.length = 0;
    for (const k of Object.keys(ledByPad)) delete ledByPad[k];
    sendMidi([0xB0, CC_LOOP, 127]); sendMidi([0xB0, CC_LOOP, 0]);   // back to Note mode
    advance(4);
    eq('left loop mode', seqState.loopMode, false);
    const stepRowRepainted = [...Array(16).keys()]
        .filter((i) => ledByPad[STEP_NOTE_BASE + i] !== undefined).length;
    eq('the whole step row is repainted on the way out', stepRowRepainted, 16);

    Date.now = realNow;
    delete globalThis.move_midi_internal_send;
    seqState.loopStart = 0;
    seqState.lenSteps = 0;
    seqState.barOffset = 0;
    seqState.engineTick = 0;
}

_log('\napp-loop: Clear + drum pad wipes that pad from the clip');
{
    resetApp();
    const CC_DELETE = 119;
    const PAD_OFF_GRID = 72;   // col 4 — outside mrdrums' 4x4 grid, sounds nothing

    seqState.lenSteps = 16;
    engine.reset();

    sendMidi([0xB0, CC_DELETE, 127]);        // hold Clear
    sendMidi([0x90, PAD_KICK, 110]);         // + the kick pad
    sendMidi([0x80, PAD_KICK, 0]);
    advance(3);
    eq('every note of that pad is cleared, whole clip',
        engine.ops.includes(`del 0 0 255 ${NOTE_KICK}`), true);
    sendMidi([0xB0, CC_DELETE, 0]);          // release
    advance(2);
    eq('the pad gesture suppresses the clip delete on release',
        engine.ops.some((o) => o.startsWith('clipdel')), false);

    /* A pad that is not part of the drum grid sounds nothing, so it must clear
     * nothing. It used to delete whatever pitch was played LAST — silent, and
     * destructive to a lane the user never touched in the gesture. */
    sendMidi([0x90, PAD_KICK, 110]);         // establish a last-played pitch
    sendMidi([0x80, PAD_KICK, 0]);
    advance(2);
    engine.reset();
    sendMidi([0xB0, CC_DELETE, 127]);
    sendMidi([0x90, PAD_OFF_GRID, 110]);
    sendMidi([0x80, PAD_OFF_GRID, 0]);
    advance(3);
    eq('a pad outside the grid clears nothing',
        engine.ops.some((o) => o.startsWith('del ')), false);
    sendMidi([0xB0, CC_DELETE, 0]);
    advance(2);
    seqState.lenSteps = 0;
}

_log('\napp-loop: Clear + a knob never deletes the clip');
{
    /*
     * THE HIGHEST-SEVERITY SYMPTOM IN THE MIGRATION (design §3): Clear + knob
     * deleted the clip. Clear's RELEASE deletes the active clip unless the
     * gesture marked itself as having acted, and the knob branch only marked it
     * when the page owner named a parameter for that knob. An empty cell — a
     * page with fewer than 8 knobs, a delegated page still loading — answered
     * null, the branch fell through, and letting go of Clear wiped the clip.
     *
     * Runs in BOTH arms on purpose: this is not only a delegation bug. movy's
     * own pages have empty cells too, so the guarantee is the same under `off`,
     * and a two-parameter module is where both planners leave knob 7 blank.
     */
    const CC_CLEAR = 119;
    const clipDeleted = () => engine.ops.some((o) => o.startsWith('clipdel'));

    resetApp();
    env.setParams(MOCK_SYNTHS.file_param);   // knob 0 = file, knob 1 = Volume, 2..7 blank
    resetSeqState(); resetSeqEngine();
    globalThis.init();
    appState.trackModels[0][1].reload();
    advance(12);
    seqState.lenSteps = 16;

    engine.ops.length = 0;
    sendMidi([0xB0, CC_CLEAR, 127]);     // hold Clear
    sendMidi([0x90, 7, 127]);            // + touch a knob with nothing under it
    sendMidi([0x80, 7, 0]);
    sendMidi([0xB0, CC_CLEAR, 0]);       // let Clear go
    advance(3);
    eq('Clear + an empty knob leaves the clip alone', clipDeleted(), false);

    /* And the ordinary case still consumes the gesture: a knob that DOES carry
     * a parameter clears that parameter's lane, not the clip. */
    engine.ops.length = 0;
    sendMidi([0xB0, CC_CLEAR, 127]);
    sendMidi([0x90, 1, 127]);
    sendMidi([0x80, 1, 0]);
    sendMidi([0xB0, CC_CLEAR, 0]);
    advance(3);
    eq('Clear + a live knob leaves the clip alone too', clipDeleted(), false);

    /* The tap itself must still work, or the guard above would be a mute button
     * on the feature: Clear with nothing else touched deletes the clip. */
    engine.ops.length = 0;
    sendMidi([0xB0, CC_CLEAR, 127]);
    sendMidi([0xB0, CC_CLEAR, 0]);
    advance(3);
    eq('a plain Clear tap still deletes the clip', clipDeleted(), true);

    seqState.lenSteps = 0;
}

/* ── Undo: the guard, and the round trip ─────────────────────────────────── */

_log('\napp-loop: no edit escapes undo');
{
    const { takeUndoViolation } = await import('../dist/esm/undo/record.js');
    const { resetUndoState, canUndo, undoDepth } = await import('../dist/esm/undo/state.js');
    const { resetUndoGroups } = await import('../dist/esm/undo/group.js');
    const { undoOnce, redoOnce, resetUndoApply } = await import('../dist/esm/undo/apply.js');

    const CC_DEL = 119, CC_MUTE_B = 88, CC_LOOP_B = 58, CC_COPY_B = 60;
    const CC_VOL = 79, CC_SHIFT = 49, CC_UNDO_B = 56, CC_TRACK0 = 43;

    resetUndoState(); resetUndoGroups(); resetUndoApply();
    seqState.lenSteps = 16;
    takeUndoViolation();

    /* Every gesture that mutates the set, driven through the real router. A
     * violation here means an edit was made that no undo entry would record —
     * which is exactly the bug this whole guard exists to prevent, and the one
     * a future feature is most likely to reintroduce. */
    const gestures = {
        'step tap': () => { sendMidi([0x90, STEP_NOTE_BASE, 127]); sendMidi([0x80, STEP_NOTE_BASE, 0]); },
        'delete + step': () => {
            sendMidi([0xB0, CC_DEL, 127]); sendMidi([0x90, STEP_NOTE_BASE + 2, 127]);
            sendMidi([0xB0, CC_DEL, 0]);
        },
        'mute': () => {
            sendMidi([0xB0, CC_MUTE_B, 127]); sendMidi([0xB0, CC_TRACK0, 127]);
            sendMidi([0xB0, CC_TRACK0, 0]); sendMidi([0xB0, CC_MUTE_B, 0]);
        },
        'loop window': () => {
            sendMidi([0xB0, CC_LOOP_B, 127]); sendMidi([0x90, STEP_NOTE_BASE + 1, 127]);
            sendMidi([0x80, STEP_NOTE_BASE + 1, 0]); sendMidi([0xB0, CC_LOOP_B, 0]);
        },
        'held step + velocity': () => {
            sendMidi([0x90, STEP_NOTE_BASE + 3, 127]); sendMidi([0xB0, CC_VOL, 1]);
            sendMidi([0x80, STEP_NOTE_BASE + 3, 0]);
        },
        'copy then paste': () => {
            sendMidi([0xB0, CC_COPY_B, 127]); sendMidi([0x90, STEP_NOTE_BASE, 127]);
            sendMidi([0x90, STEP_NOTE_BASE + 5, 127]); sendMidi([0xB0, CC_COPY_B, 0]);
        },
        /* Step recording — hold Rec while stopped, then pads and arrows. A
         * device run found this whole path un-grouped; the local table had no
         * row for it. */
        'step record: pad at head': () => {
            sendMidi([0xB0, 86, 127]);              // Rec down (hold = step rec)
            advance(2);
            sendMidi([0x90, 68, 110]); sendMidi([0x80, 68, 0]);
            advance(2);
        },
        'step record: tie': () => { sendMidi([0xB0, 63, 127]); sendMidi([0xB0, 63, 0]); },
        'step record: step tap': () => {
            sendMidi([0x90, STEP_NOTE_BASE + 4, 127]);
            sendMidi([0x80, STEP_NOTE_BASE + 4, 0]);
        },
        'step record: end': () => { sendMidi([0xB0, 86, 0]); advance(2); },
        'quantize': () => {
            sendMidi([0xB0, CC_SHIFT, 127]); sendMidi([0x90, STEP_NOTE_BASE + 15, 127]);
            sendMidi([0x80, STEP_NOTE_BASE + 15, 0]); sendMidi([0xB0, CC_SHIFT, 0]);
        },
    };
    for (const [name, run] of Object.entries(gestures)) {
        run();
        advance(2);
        eq(name + ' is recorded', takeUndoViolation(), '');
    }

    /* The quantize panel's input policy, through the real router: Back closes
     * it and is consumed, while a step press runs underneath without even
     * closing it (a step neither repaints the screen nor toasts). */
    {
        const { quantOverlayActive } =
            await import('../dist/esm/seq/quant-overlay.js');
        sendMidi([0xB0, CC_SHIFT, 127]); sendMidi([0x90, STEP_NOTE_BASE + 15, 127]);
        sendMidi([0x80, STEP_NOTE_BASE + 15, 0]); sendMidi([0xB0, CC_SHIFT, 0]);
        advance(1);
        eq('Shift+Step16 raises the quantize panel', quantOverlayActive(), true);

        engine.ops.length = 0;
        sendMidi([0x90, STEP_NOTE_BASE + 6, 127]); sendMidi([0x80, STEP_NOTE_BASE + 6, 0]);
        advance(2);
        /* `ltog` not `tog`: the surrounding section leaves loop mode on. Either
         * way the press reached the sequencer instead of being swallowed. */
        eq('a step press runs underneath the panel',
            engine.ops.some((o) => /^(tog|ltog)\b/.test(o)), true);
        eq('and leaves it up', quantOverlayActive(), true);

        sendMidi([0xB0, 51, 127]);   // MoveBack
        advance(1);
        eq('Back closes the panel', quantOverlayActive(), false);
    }

    /* The button itself, through the router. */
    resetUndoState(); resetUndoGroups();
    sendMidi([0x90, STEP_NOTE_BASE + 7, 127]); sendMidi([0x80, STEP_NOTE_BASE + 7, 0]);
    advance(2);
    eq('a step tap leaves something to undo', canUndo(), true);
    const before = undoDepth();
    sendMidi([0xB0, CC_UNDO_B, 127]); sendMidi([0xB0, CC_UNDO_B, 0]);
    advance(2);
    eq('Undo consumes an entry', undoDepth(), before - 1);
    engine.ops.length = 0;
    sendMidi([0xB0, CC_SHIFT, 127]);
    sendMidi([0xB0, CC_UNDO_B, 127]); sendMidi([0xB0, CC_UNDO_B, 0]);
    sendMidi([0xB0, CC_SHIFT, 0]);
    advance(2);
    eq('Shift+Undo redoes', undoDepth(), before);
    eq('and reaches the engine', engine.ops.some((o) => o.startsWith('uswap ')), true);

    resetUndoState(); resetUndoGroups(); resetUndoApply();
    seqState.lenSteps = 0;
}

_log('\napp-loop: a tick builds each ViewModel at most once');
{
    /* buildViewModel is the dearest thing a tick does — it lays out the page and
     * computes envelope/filter graphics. The tick used to call getViewModel()
     * unconditionally just to read drumPadCount, and buildAutomationView called
     * it again for drumCurrentPad, so a param-dense module (helm, 180 params)
     * paid for up to three full builds per tick, on EVERY tick, even undirtied
     * ones — and the tick period is the knob's MIDI sampling interval, so the
     * knobs on its costliest page turned visibly behind the hardware. */
    resetApp();
    appState.currentView = VIEW_KNOBS;
    appState.activeTrack  = trackRef(0);

    const counts = new Map();
    for (const track of appState.trackModels) {
        for (const m of track) {
            if (!m || typeof m.getViewModel !== 'function' || m.__vmSpy) continue;
            const orig = m.getViewModel.bind(m);
            m.__vmSpy = true;
            m.getViewModel = (...a) => { counts.set(m, (counts.get(m) ?? 0) + 1); return orig(...a); };
        }
    }

    const TICKS = 10;
    counts.clear();
    advance(TICKS);
    let worst = 0;
    for (const n of counts.values()) if (n > worst) worst = n;
    eq(`no model is built more than once per tick (worst ${worst}/${TICKS} ticks)`,
        worst <= TICKS, true);
}

_log('\napp-loop: session view selects tracks from the step row');
{
    engine.reset();
    env.setParams(MOCK_SYNTHS.file_param);
    resetSeqState(); resetSeqEngine();
    globalThis.init();
    advance(6);
    selectTrack(0);

    /* Latch Session view: a quick press+release of the Note/Session button. */
    sendMidi([0xB0, 50, 127]);
    sendMidi([0xB0, 50, 0]);
    advance(1);
    eq('session view latched', seqState.sessionMode, true);

    /* Latched Session view shows the group pulse and nothing else. The
     * selected-track read-out belongs to the HELD button — holding it is a
     * question ("where am I?"), while a latched row is somewhere you sit and
     * work, and a permanent white step there just competes with the group. */
    {
        const { C_WHITE } = await import('../dist/esm/seq/colors.js');
        const { seqLedsInvalidate } = await import('../dist/esm/seq/leds.js');
        const msgs = [];
        const real = globalThis.move_midi_internal_send;
        globalThis.move_midi_internal_send = (m) => msgs.push(m);
        seqLedsInvalidate();
        advance(6);
        globalThis.move_midi_internal_send = real;
        // Notes 16-31 only — the clip-grid pads (68-99) pulse white legitimately.
        const white = msgs.filter((m) => m[2] >= STEP_NOTE_BASE
            && m[2] < STEP_NOTE_BASE + 16 && m[3] === C_WHITE);
        eq('latched session shows no white selection on the step row', white.length, 0);
    }

    /* A step press in latched Session view IS the track-button gesture: it
     * drops straight onto that track — pads, screen and knobs. */
    engine.ops.length = 0;
    sendMidi([0x90, 16 + 9, 127]);
    advance(1);
    eq('step press selected track 9', appState.activeTrack.index, 9);
    eq('step press refocused group 2', appState.focusGroup, 2);
    eq('step press left session view for the track', seqState.sessionMode, false);
    /* The bug this fixes: the selector moved the screen and the pads but not the
     * sequencer, and the engine re-pinned watchTrack from `trk=` on every status
     * poll — so every step edit kept landing on the track you came from. */
    eq('step press retargeted the watched track', watchedTrack(), 9);
    eq('step press emitted the engine watch', engine.ops.some((o) => o === 'watch 9'), true);

    /* Quick release = tap = latch: you stay on track 9, and the release must not
     * toggle a note under the finger that was only ever selecting a track. */
    sendMidi([0x90, 16 + 9, 0]);
    advance(1);
    eq('a tap keeps the new track', appState.activeTrack.index, 9);
    eq('a tap stays out of session view', seqState.sessionMode, false);
    eq('the selecting press entered no note', occHasStep(9), false);

    /* Hold the step instead and the release reverts — the track-button peek. */
    sendMidi([0xB0, 50, 127]); sendMidi([0xB0, 50, 0]); advance(1);   // back to Session
    eq('re-latched session view', seqState.sessionMode, true);
    {
        const realNow = Date.now; let t = 50000; Date.now = () => t;
        sendMidi([0x90, 16 + 2, 127]);
        advance(1);
        eq('peek switched to track 2', appState.activeTrack.index, 2);
        t += 600;                                    // past the 500 ms hold threshold
        sendMidi([0x90, 16 + 2, 0]);
        advance(1);
        Date.now = realNow;
        eq('a held step reverts to the track it came from', appState.activeTrack.index, 9);
        eq('a held step reverts to session view', seqState.sessionMode, true);
        eq('the revert put the watched track back', watchedTrack(), 9);
    }

    /* Octave up moves the focused group without changing the active track, and
     * scrolls the way the grid reads: up walks towards track 1, down away. */
    sendMidi([0xB0, 55, 127]);
    sendMidi([0xB0, 55, 0]);
    advance(1);
    eq('octave up moved to group 1', appState.focusGroup, 1);
    eq('octave up left the active track alone', appState.activeTrack.index, 9);

    sendMidi([0xB0, 54, 127]);
    sendMidi([0xB0, 54, 0]);
    advance(1);
    eq('octave down moved back to group 2', appState.focusGroup, 2);

    /* The LEDs must agree with the buttons: at the first group there is nothing
     * above, so up is the dark one. */
    while (appState.focusGroup > 0) { sendMidi([0xB0, 55, 127]); sendMidi([0xB0, 55, 0]); advance(1); }
    eq('at the first group, up is off', buttonLeds[55], 0);
    eq('at the first group, down is dim', buttonLeds[54], 16);

    selectTrack(0);
    resetSeqState();
}

_log('\napp-loop: holding Session keeps the step row a track selector');
{
    engine.reset();
    env.setParams(MOCK_SYNTHS.file_param);
    resetSeqState(); resetSeqEngine();
    globalThis.init();
    advance(6);
    selectTrack(0);

    /* Session held (no release yet): the pads are the clip grid, as before. */
    sendMidi([0xB0, 50, 127]);
    advance(2);
    eq('session view while the button is held', seqState.sessionMode, true);
    eq('the session button lights bright while active', buttonLeds[50], 124);

    /* A step press lands on the track — pads, screen, knobs — but the row stays
     * a selector, because the button is still down. */
    sendMidi([0x90, 16 + 5, 127]);
    sendMidi([0x90, 16 + 5, 0]);
    advance(2);
    eq('held-session step selected track 5', appState.activeTrack.index, 5);
    eq('held-session step left the clip grid', seqState.sessionMode, false);
    eq('the step row is still the selector', seqState.trackSelectHold, true);
    eq('held-session step retargeted the sequencer', watchedTrack(), 5);
    eq('held-session step emitted the engine watch',
        engine.ops.some((o) => o === 'watch 5'), true);
    eq('the selecting press entered no note',
        engine.ops.some((o) => o.startsWith('tog ') || o.startsWith('ltog ')), false);

    /* The row is visibly the SELECTOR, not steps: every one of the 16 buttons
     * carries its own track's colour, painted through the animation channel.
     * This is the assertion that fails if the hold ever falls back to the
     * ordinary step painter. */
    {
        const { TRACK_COLOR, C_BLACK, C_WHITE } = await import('../dist/esm/seq/colors.js');
        const { seqLedsInvalidate } = await import('../dist/esm/seq/leds.js');
        const msgs = [];
        const realSend = globalThis.move_midi_internal_send;
        globalThis.move_midi_internal_send = (m) => msgs.push(m);
        seqLedsInvalidate();
        advance(6);
        globalThis.move_midi_internal_send = realSend;
        /* cachedSetAnimLED sends the base on channel 0 first (the handshake),
         * then the pulse colour on the animation channel — so the two halves of
         * one step have to be read apart, by channel, not by taking the last
         * message for the note. */
        const sentOn = (note, chan) => {
            const hit = msgs.filter((m) => m[2] === note && (m[1] & 0x0f) === chan);
            return hit.length ? hit[hit.length - 1][3] : undefined;
        };
        const pulseOf = (note) => {
            const hit = msgs.filter((m) => m[2] === note && (m[1] & 0x0f) !== 0);
            return hit.length ? hit[hit.length - 1][3] : undefined;
        };

        /* Track 5 is selected and the Session button is still down, so the quad
         * is 4-7 with track 5 as the held read-out: SOLID WHITE, no animation,
         * while its three neighbours pulse black->their own colour. Stillness is
         * what separates it — a pulse would share the group's one channel. */
        eq('the selected track is solid white', sentOn(STEP_NOTE_BASE + 5, 0), C_WHITE);
        eq('and does not animate at all', pulseOf(STEP_NOTE_BASE + 5), undefined);

        const neighbours = [4, 6, 7];
        const wrongPulse = neighbours.filter((i) => pulseOf(STEP_NOTE_BASE + i) !== TRACK_COLOR[i]);
        eq('its group neighbours pulse to their own colours', wrongPulse.length, 0);
        eq('its group neighbours trough to black',
            neighbours.every((i) => sentOn(STEP_NOTE_BASE + i, 0) === C_BLACK), true);

        /* The other twelve do not animate at all — they sit solid in their own
         * colour on channel 0, which is what makes the pulsing quad's POSITION
         * the cue that identifies the group. */
        const outside = [...Array(16).keys()].filter((i) => i < 4 || i > 7);
        const wrongSolid = outside.filter((i) => sentOn(STEP_NOTE_BASE + i, 0) !== TRACK_COLOR[i]);
        eq('every track outside the quad sits solid in its colour', wrongSolid.length, 0);
        eq('and none of them pulse',
            outside.every((i) => pulseOf(STEP_NOTE_BASE + i) === undefined), true);
    }

    /* …so the next step press switches again, without re-entering Session. */
    sendMidi([0x90, 16 + 12, 127]);
    sendMidi([0x90, 16 + 12, 0]);
    advance(2);
    eq('a second press switched again', appState.activeTrack.index, 12);
    eq('the second press refocused group 3', appState.focusGroup, 3);
    eq('still not the clip grid', seqState.sessionMode, false);

    /* Releasing Session COMMITS — you stay where you landed, and it must not
     * latch Session view on the way out.
     *
     * It also hands the row back from the selector's cachedSetAnimLED to the
     * ordinary step painter's cachedSetLED — two caches over the same 16 notes
     * — so the whole row has to come back through setLED. */
    for (const k of Object.keys(ledByPad)) delete ledByPad[k];
    sendMidi([0xB0, 50, 0]);
    advance(4);
    const stepRowRepainted = [...Array(16).keys()]
        .filter((i) => ledByPad[STEP_NOTE_BASE + i] !== undefined).length;
    eq('the whole step row is repainted on the way out', stepRowRepainted, 16);
    eq('release commits the last track', appState.activeTrack.index, 12);
    eq('release ends the selector row', seqState.trackSelectHold, false);
    eq('release leaves you in track view', seqState.sessionMode, false);
    eq('the session button falls back to dim', buttonLeds[50], 16);

    /* And the row is real steps again: a press now enters a note. */
    engine.ops.length = 0;
    sendMidi([0x90, 16 + 3, 127]);
    sendMidi([0x90, 16 + 3, 0]);
    advance(2);
    eq('the row is steps again', engine.ops.some((o) => o.startsWith('tog ')), true);

    selectTrack(0);
    resetSeqState();
}

_log('\napp-loop: track state exists for every track, not just the first four');
{
    engine.reset();
    env.setParams(MOCK_SYNTHS.file_param);
    resetSeqState(); resetSeqEngine();
    globalThis.init();
    advance(6);

    eq('per-track chain index covers every track', appState.trackChainIndex.length, TRACK_COUNT);
    eq('per-track view covers every track', appState.trackView.length, TRACK_COUNT);
    eq('per-track models cover every track', appState.trackModels.length, TRACK_COUNT);

    /* The device symptom: pressing a track button in any group but the first
     * set currentView to undefined, because trackView[4..15] did not exist.
     * The UI then had no view to render and selection looked broken. */
    selectTrack(0);
    const viewBefore = appState.currentView;
    focusGroupStep(1);                        // focus tracks 4-7
    sendMidi([0xB0, 43, 127]);                // first track button
    sendMidi([0xB0, 43, 0]);
    advance(2);
    eq('track button in group 1 selected track 4', appState.activeTrack.index, 4);
    eq('currentView is still a real view', typeof appState.currentView, 'number');
    eq('a movy track has models', Array.isArray(appState.trackModels[4]), true);
    eq('a movy track has a chain index', typeof appState.trackChainIndex[4], 'number');

    selectTrack(0);
    appState.currentView = viewBefore;
    resetSeqState();
}

_log('\napp-loop: the module browser loads onto a movy-hosted track');
{
    const { uninstallMockEngine } = await import('./mock-engine.mjs');
    const { openBrowser, loadSelectedModule } = await import('../dist/esm/browser/handler.js');
    const { browserState } = await import('../dist/esm/browser/state.js');
    const { CHAIN_SLOTS } = await import('../dist/esm/chain/config.js');

    engine.reset();
    env.setParams(MOCK_SYNTHS.file_param);
    resetSeqState(); resetSeqEngine();
    globalThis.init();
    advance(6);
    reinstallMockEngine(engine);

    /* Capture what actually reaches the engine — the whole question is whether
     * a browser load on a movy track becomes a ch<N>: write rather than a
     * schwung slot write that would silently hit another track. */
    const engineWrites = [];
    const realSet = globalThis.host_module_set_param_blocking;
    globalThis.host_module_set_param_blocking = (k, v, t) => {
        engineWrites.push([k, v]);
        return realSet ? realSet(k, v, t) : true;
    };

    selectTrack(5);                       // chain instance 5

    openBrowser(CHAIN_SLOTS[1], appState.activeTrack.index, () => {});   // synth slot
    eq('browser opened for the movy track', browserState.paramSlot, 5);

    /* Pick the first real module (index 0 is the synthetic "NONE"). */
    browserState.browseIndex = browserState.modules.length > 1 ? 1 : 0;
    const picked = browserState.modules[browserState.browseIndex];
    loadSelectedModule();

    const moduleWrite = engineWrites.find(([k]) => k.endsWith(':synth:module'));
    eq('the load reached the engine as a chain write', !!moduleWrite, true);
    if (moduleWrite) {
        /* A track's chain IS its index, so track 5 is chain 5. This used to be
         * `index - HOST_TRACKS`; either way, getting it wrong loads the module
         * onto a different track entirely. */
        eq('addressed chain 5 (track 5)', moduleWrite[0], 'ch5:synth:module');
        eq('wrote the picked module id', moduleWrite[1], picked.id);
    }

    globalThis.host_module_set_param_blocking = realSet;
    uninstallMockEngine();
    selectTrack(0);
    resetSeqState();
}

_log('\napp-loop: the step view follows the FOCUSED track, not the button index');
{
    /* The block above uninstalls the mock engine, and movy refuses input until
     * the engine holds the Set — so this needs one back before it can press a
     * track button. */
    reinstallMockEngine(engine);
    engine.reset();
    env.setParams(MOCK_SYNTHS.file_param);
    resetSeqState(); resetSeqEngine(); resetSetSession();
    globalThis.init();
    advance(30);
    selectTrack(0);

    /* Device report: entering steps on track 1 also set them on 5, 9 and 13.
     * Tracks 1/5/9/13 all sit under the SAME track button, so a handler that
     * used the raw button index instead of the focused group edited track 0
     * whichever group was on screen. */
    focusGroupStep(1);                    // focus tracks 4-7
    sendMidi([0xB0, 43, 127]);            // first track button
    sendMidi([0xB0, 43, 0]);
    advance(2);
    eq('active track is 4', appState.activeTrack.index, 4);
    eq('the step view watches track 4, not 0', watchedTrack(), 4);

    focusGroupStep(1);                    // group 2 => tracks 8-11
    sendMidi([0xB0, 42, 127]);            // second track button
    sendMidi([0xB0, 42, 0]);
    advance(2);
    eq('second button in group 2 watches track 9', watchedTrack(), 9);

    selectTrack(0);
    resetSeqState();
}

_log('\napp-loop: every track gets a playable keyboard, not just the host four');
{
    /* init() used to hand keyboardState a four-entry octave array while
     * TRACK_COUNT was 16, so `baseNoteFor` read `undefined` on tracks 5-16 and
     * every pitch came out NaN. NaN fails both of buildPadMap's range tests, so
     * Int16Array stored 0 — every pad played MIDI note 0 into the synth (a
     * sub-audio pulse train, not a note) and every pad rendered the track accent
     * because pitch 0 IS the root pitch class. Assert the map, since that is
     * what both the sound and the colour are derived from. */
    const { keyboardState, padMapFor, baseNoteFor, resetPadMapCache } =
        await import('../dist/esm/keyboard/state.js');
    resetApp();
    for (const t of [0, 3, 4, 15]) {
        resetPadMapCache();
        const base = baseNoteFor(t);
        const map  = Array.from(padMapFor(t));
        eq(`track ${t + 1} has a real base note`, Number.isFinite(base), true);
        eq(`track ${t + 1} pads are not all one pitch`,
            new Set(map).size > 1, true);
    }
    selectTrack(0);
    resetSeqState();
}

_log('\napp-loop: the Settings page owns the whole screen');
{
    /* The Loop Overview strip repaints at rows 60-63 on EVERY tick, outside the
     * dirty-frame block — so a full-screen view that is not excluded from it
     * gets its bottom painted over a few milliseconds after it draws. Settings
     * puts its explanation band there, and the strip cut the second line in
     * half on the device while every local suite passed: nothing here rendered
     * a tick and a view together. */
    resetApp();
    const { VIEW_FLAGS } = await import('../dist/esm/app/state.js');
    sendMidi([0xB0, 49, 127]);                    // Shift down
    sendMidi([0x90, 16 + 1, 100]);                // Step 2
    sendMidi([0x80, 16 + 1, 0]);
    sendMidi([0xB0, 49, 0]);                      // Shift up
    eq('Shift + Step 2 opens Settings', appState.currentView, VIEW_FLAGS);

    painted.length = 0;
    advance(8);
    /* Full-width fills only: the band's own glyphs are one-pixel runs, while
     * anything that repaints the bottom of the screen clears the whole width
     * first. The rows the band occupies must survive every tick. */
    const HINT_BOT = HINT_TOP + HINT_LINES * (FONT_HEIGHT + 2);
    const swept = painted.filter(([, y, w, h]) => w >= 128 && y + h > HINT_TOP && y < HINT_BOT);
    eq('nothing sweeps the explanation band away', swept.length, 0);
}

/* ── Scene row: Loop held in Session view ────────────────────────────────── */
/* Asserted through the real app loop because this is the layer the device
 * cannot read back — a scene row that never reaches the LED wire looks
 * identical to one painted in the wrong colours. The row uses the native
 * animation path, so it goes out on move_midi_internal_send rather than
 * setLED, and an animated pad costs TWO ticks (base handshake, then the
 * animation): the capture spans several. */
{
    _log('\nscene row:');
    resetApp();
    sendMidi([0xB0, CC_NOTE_SESSION, 127]); sendMidi([0xB0, CC_NOTE_SESSION, 0]);
    seqState.songScenes = [1];                 // scene 2 is in the song, scene 1 is not

    const msgs = [];
    const real = globalThis.move_midi_internal_send;
    globalThis.move_midi_internal_send = (m) => msgs.push(m);
    sendMidi([0xB0, 58, 127]);                 // Loop down — the scene modifier
    advance(12);
    globalThis.move_midi_internal_send = real;
    sendMidi([0xB0, 58, 0]);

    /* The last state each step note was left in: [channel, colour]. */
    const last = (step) => {
        const m = msgs.filter((x) => x[2] === STEP_NOTE_BASE + step).pop();
        return m ? [m[1] & 0x0f, m[3]] : null;
    };
    const C_GREEN = 11, ANIM_PULSE = 0x09, ANIM_NONE = 0x00;

    eq('step 1 is scene 1, solid green (not in the song)',
       JSON.stringify(last(0)), JSON.stringify([ANIM_NONE, C_GREEN]));
    eq('step 3 is scene 2 and pulses — the song uses it',
       JSON.stringify(last(2)), JSON.stringify([ANIM_PULSE, C_GREEN]));
    eq('step 2 is inert, and dark',
       JSON.stringify(last(1)), JSON.stringify([ANIM_NONE, 0]));
}

/* ── Summary ─────────────────────────────────────────────────────────────── */
console.log = _origLog;
/* ── CPU page owns its bottom rows ──────────────────────────────────────────
 * drawLoopStrip() clears rows 60-63 every tick, OUTSIDE the dirty-frame block.
 * A page that draws down there and is not excluded loses those rows a few
 * milliseconds after it painted them — visible only on the device, because a
 * screenshot scene never ticks.
 *
 * Run as two arms. "The strip did not draw" is worth nothing on its own: half
 * the guard's conditions are module state this harness does not reset, so a
 * silent strip can just as easily mean the harness cannot see one. The CONTROL
 * is a page that must keep it. */
_log('\napp-loop: CPU page is not painted over by the loop strip');
{
    const { seqToastActive } = await import('../dist/esm/seq/render.js');
    const stripRectsFor = (view, holdKnob = -1) => {
        resetApp();
        for (let i = 0; i < 400 && seqToastActive(); i++) advance(1);
        if (view === VIEW_CPU) handleStepButton(STEP_CPU, true, true);
        else appState.currentView = view;
        eq(`arm is on view ${view}`, appState.currentView, view);
        appState.dirty = true;
        const rects = [];
        /* A knob any EARLIER block left pressed must be let go of first:
         * `touched` / `touchOrder` live in the page controller, which
         * resetApp() does not reach and which is cached by (track, component)
         * for the whole process. movy's header readout and hint band take the
         * bottom rows exactly while a knob is under the hand, so an inherited
         * latch would fail the control arm for a reason it is not about. The
         * arm is "a page with NOTHING held keeps the strip", and it says so. */
        ownerFor().page?.ctl.clearTouch();
        if (holdKnob >= 0) sendMidi([0x90, holdKnob, 100]);
        /* jogToastShown and the toast TTL are tick.ts / render.ts module state
         * that resetApp() does not reach, and both suppress the strip. Ticking
         * the toast out is what makes the control arm meaningful. */
        const origFR = globalThis.fill_rect;
        globalThis.fill_rect = (x, y, w, h, v) => rects.push([x, y, w, h, v]);
        advance(1);
        globalThis.fill_rect = origFR;
        if (view === VIEW_CPU) appState.currentView = closeParamPage();
        return rects;
    };
    const cleared = (rects) => rects.some(
        ([x, y, w, h, v]) => x === 0 && y === 60 && w === 128 && h === 4 && v === 0);

    /* CONTROL: the step/knobs view keeps the strip. If this is false the arm
     * below is vacuous and the whole check has to be treated as broken. */
    const control = stripRectsFor(VIEW_KNOBS);
    eq('control: a normal page still gets the loop strip', cleared(control), true);

    const cpu = stripRectsFor(VIEW_CPU);
    eq('loop strip suppressed on the CPU page', cleared(cpu), false);
    eq('and the page actually painted', cpu.length > 0, true);

    /* A HAND ON A KNOB TAKES THE BOTTOM ROWS. The footer band is 57..63 and
     * the strip clears 60..63 on every tick, so they cannot both have them —
     * the same terms movy's own bottom-row toasts already take the row on.
     * Only meaningful where there IS a controller to hint about: with the grid
     * off there is no page, no chrome, and the strip keeps its rows. */
    if (GRID_ARM === 'page') {
        /* Knob 1, not 0: on this model knob 0 is the `file` param, and movy's
         * own browse hint ("JOG: BROWSE", a full-width band at 58) legitimately
         * wins the row for it — it is a rung ABOVE the footer in the same yield
         * chain, and that is not the rung this arm is about. Every other knob
         * reaches the footer. */
        const touched = stripRectsFor(VIEW_KNOBS, 1);
        eq('a knob under the hand takes the bottom rows from the strip',
           cleared(touched), false);
        const isPill = ([x, y, w, h, v]) => y === 57 && h === 7 && v === 1 && x < 128;
        eq('...which the hint band is what took',
           touched.some(isPill), true);
        /* A toast would have taken them just as effectively, and one is a full
         * width inverted band one row lower. Without this the check passes on
         * the wrong painter. */
        eq('...and not one of movy\'s own bottom-row toasts instead',
           touched.some(([x, y, w, h, v]) => x === 0 && y === 58 && w === 128 && h === 6 && v === 1),
           false);
    }
}

/* ── The step LED under the CPU page's own gesture ──────────────────────────
 * stepIconColor is a pure function and is unit-tested as one, which says
 * nothing about whether paintStepIcons ever passes it the page's state: wiring
 * `cpuPage: false` there passes every one of those assertions. This is the arm
 * that fails. */
_log('\napp-loop: the CPU page lights its own step LED');
{
    const CC_CPU_ICON = 16 + 11;          // step-icon LEDs are CC 16..31
    const WHITE_BRIGHT = 124, WHITE_OFF = 0;
    resetApp();
    advance(2);
    eq('closed and unshifted, the icon is dark', buttonLeds[CC_CPU_ICON] ?? WHITE_OFF, WHITE_OFF);

    handleStepButton(STEP_CPU, true, true);
    advance(2);
    eq('open, the icon is full bright', buttonLeds[CC_CPU_ICON], WHITE_BRIGHT);

    appState.currentView = closeParamPage();
    advance(2);
    eq('closed again, it goes dark', buttonLeds[CC_CPU_ICON], WHITE_OFF);

    /* Settings, through the same paint path. */
    const CC_FLAGS_ICON = 16 + 1;
    handleStepButton(1, true, true);      // STEP_FLAGS
    advance(2);
    eq('the settings icon lights when its page opens', buttonLeds[CC_FLAGS_ICON], WHITE_BRIGHT);
    appState.currentView = closeParamPage();
    advance(2);
    eq('and goes dark again', buttonLeds[CC_FLAGS_ICON], WHITE_OFF);
}

/* ── CPU page repaints on pixels, not on microseconds ───────────────────────
 * The meter runs on the UI thread, which competes with the render lanes for
 * Move's cores. A page that repaints because a number wobbled below the
 * resolution of a bar is measuring its own repaint. */
_log('\napp-loop: CPU page repaints only when a drawn pixel changes');
{
    resetApp();
    const cols = (t, sy) => [`${t}/${sy}/900`].concat(Array(15).fill('0/0/0')).join(',');
    engine.status.chmask = '0001/0000';
    engine.status.chwall = '1491/2180/2902';
    engine.status.chcost = cols(800, 600);

    handleStepButton(STEP_CPU, true, true);
    eq('the CPU page is up for the gate check', appState.currentView, VIEW_CPU);
    settleQuiet();

    const paintsAfter = (mutate) => {
        mutate();
        appState.dirty = false;
        const before = painted.length;
        advance(12);
        return painted.length - before;
    };

    /* One microsecond on a 1000 us column is 1/39th of a pixel, and one on the
     * capacity bar is well under 1%. */
    eq('sub-pixel jitter does not repaint', paintsAfter(() => {
        engine.status.chcost = cols(801, 601);
        engine.status.chwall = '1492/2180/2902';
    }) > 0, false);

    /* 100 us is ~4 px of a column: a change the screen can actually show.
     *
     * NOT a gate-isolating assertion — other dirty sources can repaint in the
     * same window, and killing `cpuRepaintTick` does not fail this. It is here
     * as a liveness check (the page is not frozen); the gate's own logic is
     * pinned by the quantisation assertions in logic/cpu-page.mjs, and its
     * suppressing half by the jitter arm above. */
    eq('the page is still live after a real change', paintsAfter(() => {
        engine.status.chcost = cols(900, 700);
    }) > 0, true);

    /* A send bus loading changes NONE of the three chain fields, and it is the
     * biggest change the page can undergo: every track column narrows to make
     * room for the send region. Left out of the gate's cheap stage it is
     * swallowed outright and the page sits on the old layout until a chain's
     * cost happens to move.
     *
     * Gate-attributable in this window specifically: the jitter arm above
     * asserts that nothing else repaints here, so the count can only have come
     * from this. */
    eq('a send bus appearing repaints the page', paintsAfter(() => {
        engine.status.sndcost = '640/900,-,-';
    }) > 0, true);

    delete engine.status.chcost;
    delete engine.status.chwall;
    delete engine.status.chmask;
    delete engine.status.sndcost;
    appState.currentView = closeParamPage();
}


/* ── SP-12: who READS the page, and who LIGHTS the knobs ────────────────────
 *
 * LAST BLOCK ON PURPOSE. It swaps the module under track 0, and a swap poisons
 * every later block: the Schwung page cache is keyed by (track, component),
 * outlives init(), and its contract does not re-resolve after one (Cause D,
 * SP-15). SP-11 measured that and the note in page-mode-expected-fail.json
 * carries it.
 *
 * Both halves of SP-12 in one fixture, in BOTH arms:
 *
 *  - movy's own value refresh must stop for a component Schwung draws, and the
 *    drawn page must go on reading — a page nobody reads is a frozen page, not
 *    a cheap one.
 *  - the eight knob LEDs must show the DRAWN cells. Under `page` the jog moves
 *    Schwung's index and leaves movy's bank where it was (SP-10's divergence),
 *    so a row still lit from movy's model would simply not move.
 */
_log('\napp-loop: the drawn page is the only reader, and it lights the knobs');
{
    /* The ramps are written out rather than imported so the expectation is an
     * independent one — if renderer/knob-leds.ts's ramp moves, this is one of
     * the places that says so. */
    const rampWhite = (v) => (v < 0.33 ? 124 : v < 0.67 ? 118 : 120);
    const rampAmber = (v) => (v < 0.25 ? 75 : v < 0.5 ? 29 : v < 0.75 ? 6 : 3);

    schwungGridReload();                     // the cache still holds mrdrums' page
    engine.reset();
    env.setParams(MOCK_SYNTHS.test16);       // p1..p16 = i/15; two pages either way
    resetSeqState(); resetSeqEngine();
    setFlag('setcommit', 0);
    globalThis.init();
    const m = appState.trackModels[0][1];
    m.reload();
    appState.currentView = VIEW_KNOBS;
    advance(12);

    const owner = () => pageOwnerOf(appState.trackModels[0][1]);
    /* The contract resolves on the POLL, and the poll is the thing this item
     * moved — so this settle is also the first assertion that it still runs. */
    for (let i = 0; i < 12 * 60 && !owner().delegated; i++) advance(1);

    /* Asked of the mode that RESOLVED, never of the env var: without a schwung
     * checkout `page` pins itself to `off` and both arms would measure one
     * program and agree. */
    const expectDelegated = schwungGridMode() === 'page';
    eq('the arm delegates exactly when its mode says so',
       owner().delegated, expectDelegated);

    /* ── the reader ──────────────────────────────────────────────────────── */

    /* Change p1 behind BOTH readers' backs. Whoever is polling picks it up. */
    const movyP1 = () => m.getKnobParamInfo(0)?.value;
    const drawnP1 = () => owner().knobParamInfo(0)?.value;
    const before = movyP1();
    globalThis.shadow_set_param(0, 'synth:p1', '0.90');
    advance(6 * REFRESH_BULK_TICKS);         // several full refresh windows

    /* ONE label, both arms, and it is the gate itself: movy re-reads the
     * module's params only while movy owns the page. */
    eq('movy re-reads the params only when movy owns the page',
       movyP1() !== before, !expectDelegated);
    /* ...and the page on screen is read by SOMEBODY in either arm. Without
     * this the check above passes just as well with nothing reading at all. */
    eq('the drawn page is read whoever owns it', drawnP1(), 0.9);

    /* ── the LEDs ────────────────────────────────────────────────────────── */

    const ledRow = () => Array.from({ length: 8 }, (_, k) => buttonLeds[71 + k] ?? -1);
    /* Built from the LIVE store and the DRAWN keys, so it is neither reader's
     * cache: what the eight cells on screen are worth right now. */
    const drawnRow = () => {
        const o = owner();
        return Array.from({ length: 8 }, (_, k) => {
            const info = o.knobParamInfo(k);
            if (!info) return 0;
            const raw = globalThis.shadow_get_param(0, 'synth:' + info.key);
            if (raw === null) return 0;
            const nv = (parseFloat(raw) - info.min) / (info.max - info.min);
            return k < 4 ? rampWhite(nv) : rampAmber(nv);
        });
    };

    appState.dirty = true; advance(3);
    eq('the knob row shows the drawn page',
       JSON.stringify(ledRow()), JSON.stringify(drawnRow()));

    /* Jog one page. In the `page` arm this moves SCHWUNG's index and leaves
     * movy's bank alone, so a row lit from movy's model would not move at all. */
    const rowBefore = JSON.stringify(ledRow());
    sendMidi([0xB0, globalThis.MoveMainKnob, 1]);
    advance(20);                              // the incoming page fills a key/tick
    eq('the jog moved the page the knobs address', owner().pageIndex, 1);
    eq('and the knob row followed it', ledRow().join() === rowBefore, false);
    eq('the knob row still shows the drawn page',
       JSON.stringify(ledRow()), JSON.stringify(drawnRow()));
    const modulePageRow = ledRow().join();

    /* ── the other half: movy's OWN pages are untouched ──────────────────── */

    /* Main Params is not a module's declared contract — nothing delegates it,
     * in either arm — and it lights four knobs from its own view model. A gate
     * that suppressed movy's LED work by view rather than by OWNER would take
     * this row out with it. */
    sendMidi([0xB0, globalThis.MoveMainKnob, 0]);   // no-op, keeps the jog quiet
    handleStepButton(4, true, true);                // a MAIN_PAGE_STEPS step
    advance(4);
    eq('the main params page is up', appState.currentView, VIEW_MAIN_PARAMS);
    const mainRow = ledRow();
    eq('movy\'s own page still lights its knobs',
       mainRow.every((c) => c > 0), true);
    /* ...and it TOOK the row back from whoever had it: one writer, one diff
     * cache, so leaving a delegated page can never strand a knob on its
     * colour. */
    eq('and the row left the module page behind',
       mainRow.join() === modulePageRow, false);
    appState.currentView = closeParamPage();
    advance(2);
}

/* ── a held step keeps the DRAWN page's own values arriving ───────────────── */
{
    /*
     * WHICHEVER SIDE DRAWS THE HELD-STEP SCREEN MUST KEEP READING FOR IT.
     *
     * SP-18 handed the held-step screen back to movy (schwungBodyFor's `held`
     * gate) but left the refresh gate above it asking the narrower question —
     * "is the page delegated?" — so under `page` that screen was built from
     * whatever values were last read before the finger went down, and the cells
     * NEIGHBOURING a lock froze for as long as the step was held. The locked
     * cells themselves stayed right (they come from the engine's own status
     * poll) which is what made it easy to miss.
     *
     * SP-35 moves the ownership, so the reader moves with it: under `page` the
     * delegated page's per-tick poll is what keeps the held-step screen live
     * (`app/page-poll.ts`), and movy's own bulk refresh stopping is SP-12's
     * rule rather than a loss. The check is written against "the reader that
     * draws the cell" so ONE expression grades both arms.
     */
    const { resetAutomation } = await import('../dist/esm/seq/automation.js');

    schwungGridReload();                     // the cache holds the last block's page
    engine.reset();
    env.setParams(MOCK_SYNTHS.test16);       // p1..p16 = i/15
    resetSeqState(); resetSeqEngine(); resetAutomation();
    setFlag('setcommit', 0);
    globalThis.init();
    const m = appState.trackModels[0][1];
    m.reload();
    appState.currentView = VIEW_KNOBS;
    appState.activeTrack = trackRef(0);
    advance(12);

    const owner = () => pageOwnerOf(appState.trackModels[0][1]);
    for (let i = 0; i < 12 * 60 && !owner().delegated; i++) advance(1);
    const expectDelegated = schwungGridMode() === 'page';

    /* THE PREMISE, and read BEFORE the hold rather than asserted from the mode:
     * the hold is only meaningful on a page Schwung had actually taken. (It
     * used to be `eq(expectDelegated, schwungGridMode() === 'page')` — the same
     * expression on both sides, which cannot fail.) */
    const preHoldPage = owner().page;
    eq('the page under the hold was Schwung\'s to begin with',
       !!preHoldPage, expectDelegated);
    const drawnKey0 = preHoldPage ? preHoldPage.keyAt(0) : null;

    /* THE HOLD IS IN PLACE FIRST, so the only window in which the new value
     * could arrive is a held one. Written behind every reader's back, exactly as
     * the block above does, so the arrival is a re-read and not an echo. */
    seqState.stepAutoMode = true; seqState.holdStep = 4;
    /* WHOEVER DRAWS THE CELL IS WHO READS IT — the same expression on both
     * sides of the arm, so this is one check and not two. Under `page` the
     * drawn page's own read is the probe (movy's refresh has stopped, which is
     * SP-12's rule, not a loss). */
    const drawn0 = () => (owner().page ? owner().page.knobLevels()[0]
                                       : m.getKnobParamInfo(0)?.value);
    const before = drawn0();
    globalThis.shadow_set_param(0, 'synth:p1', '0.55');
    advance(6 * REFRESH_BULK_TICKS);         // several full refresh windows

    /* A HELD STEP KEEPS SCHWUNG'S PAGE, AND THE KNOCK-ON IS THE POINT.
     *
     * SP-18 moved the BODY back to movy for a held step and left the OWNER
     * saying Schwung; SP-33 closed that by handing the OWNER back too, so the
     * screen and the gesture agreed — at the cost of the one gesture the
     * migration's decoration work was built for, because the parameters move
     * under your hand at the moment you are choosing which to lock. SP-35
     * reverses the direction and keeps SP-33's ruling: ONE ACCESSOR, ONE
     * ANSWER. `live()` no longer asks about the hold, so the body, the bank
     * bar, the chrome, the LEDs and every gesture site all answer "Schwung"
     * together, and the lock lands on the key the drawn page has in that cell.
     *
     * THE SAME EXPRESSION IN BOTH ARMS. In the `off` arm nothing is claimed, so
     * every one of these reads the movy answer it always did and the checks are
     * the regression guards they were; the expected VALUE is the only thing
     * that moves between the arms, never the claim.
     */
    eq('a held step keeps the page the mode delegated', owner().delegated, expectDelegated);
    eq('...so the knob targets the parameter the drawn page has there',
       owner().knobParamInfo(0)?.key,
       expectDelegated ? drawnKey0 : m.getKnobParamInfo(0)?.key);
    /* ...AND THE ANSWER CAME FROM THE PAGE, not from the model underneath it.
     * The two planners put the SAME param in knob 0 on this fixture
     * (`differing slots: 0`), so the key above cannot tell the two answers
     * apart — the spy is what does, and the next block is where the difference
     * gets a fixture that shows it. */
    let askedOf = 0;
    if (preHoldPage) {
        const real = preHoldPage.knobParamInfo;
        preHoldPage.knobParamInfo = (s) => { askedOf++; return real.call(preHoldPage, s); };
        owner().knobParamInfo(0);
        preHoldPage.knobParamInfo = real;
    }
    eq('...asked of the page, not of the model underneath', askedOf > 0, expectDelegated);
    eq('a held step keeps the drawn page reading', drawn0() !== before, true);

    seqState.stepAutoMode = false; seqState.holdStep = -1;
    resetAutomation();
}

/* ── SP-35: a held step locks the cell the DRAWN page has ─────────────────── */
{
    /*
     * THE HOLD NO LONGER HANDS THE PAGE BACK, so the two things a hold owns are
     * both live again on a delegated page: SP-18's p-lock DECORATION — whose
     * only gate is `auto.held`, the very flag that made `owner.page` null — and
     * the lane a knob turn writes.
     *
     * THE JOG IS THE TEETH. This fixture's two planners put the SAME param in
     * knob 0 (`differing slots: 0`), so nothing about the two answers can be
     * told apart at rest. Jog the drawn page a step and that cell has `p9` where
     * it held `p1`; the lock then has to name the page's key or it is bound to a
     * parameter that is not on the screen.
     *
     * THE DECORATION IS COUNTED AT ITS ONE SEAM INTO SCHWUNG. SP-18's renderer
     * was only ever proved by handing it the page and the auto view directly —
     * the failure mode upstream's own `triggerFiredAt` comment warns about
     * ("the test handed the renderer both directly and so only ever proved the
     * renderer, never the wiring"). Wrapping `ctl.setDecorations` measures the
     * wiring, and it read ZERO calls for a whole hold before this change.
     */
    const { resetAutomation } = await import('../dist/esm/seq/automation.js');

    schwungGridReload();                     // the cache holds the last block's page
    engine.reset();
    env.setParams(MOCK_SYNTHS.test16);
    resetSeqState(); resetSeqEngine(); resetAutomation();
    setFlag('setcommit', 0);
    globalThis.init();
    const m = appState.trackModels[0][1];
    m.reload();
    appState.currentView = VIEW_KNOBS;
    appState.activeTrack = trackRef(0);
    advance(12);

    const owner = () => pageOwnerOf(appState.trackModels[0][1]);
    for (let i = 0; i < 12 * 60 && !owner().delegated; i++) advance(1);
    const pageArm = schwungGridMode() === 'page';

    /* THE JOG, AND THE PREMISE READ FROM IT rather than asserted from the mode:
     * the cell has to be somewhere other than where it was, or neither the key
     * nor its opposite says anything. */
    const wasKey = m.getKnobParamInfo(0)?.key;      // the cell BEFORE the jog
    owner().changePage(1);
    advance(4);
    const drawnKey = owner().knobParamInfo(0)?.key; // read BEFORE the hold
    eq('(fixture) the jog moved the drawn cell off the key it held',
       drawnKey !== wasKey, true);
    /* ...and under `page` it is the TWO PLANNERS that are apart: movy's own bank
     * stayed where it was while Schwung's page moved. That is the condition this
     * block needs to have teeth, so it is asserted where it can exist. */
    if (pageArm) eq('(fixture) ...because the two planners disagree there',
                    drawnKey !== m.getKnobParamInfo(0)?.key, true);

    /* THE SEAM, WRAPPED BEFORE THE HOLD. Restored at the end of the block. */
    const sp = owner().page;
    let realDec = null, decCalls = 0, decs = null;
    if (sp) {
        realDec = sp.ctl.setDecorations;
        sp.ctl.setDecorations = (d) => { decCalls++; decs = d; return realDec.call(sp.ctl, d); };
    }

    /* Before the turn, so the frame the turn dirties is drawn with the lane
     * already live — the engine reports it a poll behind, so the mirror the
     * automation view actually reads is set alongside the status. */
    engine.reset();                          // clears ops; it also clears status
    engine.status.aauto = '1';
    seqState.autoActive = 1;
    seqState.stepAutoMode = true; seqState.holdStep = 4;
    sendMidi([0xB0, 71, 1]);                 // knob 0: whatever the page drew there
    advance(20);

    eq('a held step keeps Schwung drawing the page', !!owner().page, pageArm);
    eq('and the p-lock decoration reaches the controller', decCalls > 0, pageArm);
    eq('...marked on a cell the page drew',
       !!(decs && decs.some((d) => d && d.locked === true)), pageArm);
    eq('the knob bound the lane to the parameter the page drew',
       engine.ops.some((o) => o.startsWith('alabel 0 0 synth:' + drawnKey)), true);
    eq('...and not to the key movy\'s planner had in that cell',
       engine.ops.some((o) => o.startsWith('alabel 0 0 synth:' + wasKey)), false);

    seqState.stepAutoMode = false; seqState.holdStep = -1;
    seqState.autoActive = 0;
    delete engine.status.aauto;
    if (sp) sp.ctl.setDecorations = realDec;
    resetAutomation();
}

/* ── SP-38: a value change draws FRAMES until the transition settles ──────── */
{
    /*
     * THE ITEM'S OWN ACCEPTANCE, END TO END: "a value change on a delegated
     * page produces frames until the transition settles and none after".
     *
     * COUNTED AT `render`, NOT AT `dirty`. The bug was never that the value
     * failed to arrive — it arrived, and the tick drew it, ONCE. The bug is
     * that nothing asked for the NEXT frame, so the enum square froze halfway
     * to its new width and stayed there. The only measurement that tells "the
     * widget animated" from "the widget jumped" is how many times the page was
     * drawn, and `render` is the call `app/tick.ts`'s body closure makes.
     *
     * THE FIXTURE IS AN ENUM, DELIBERATELY. Only the enum square and the
     * waveform morph feed Schwung's animation store, so on a page of eight
     * floats there is nothing to animate and this block would pass with the fix
     * REMOVED. `test_enum`'s knob 0 is `mode`, a four-option enum, so the
     * transition it starts is the renderer's own observation and not something
     * this test puts in the store.
     *
     * AND IT HAS TO CHANGE THE WIDTH, WHICH IS NOT THE SAME AS CHANGING THE
     * OPTION. The square's frame travels to the WIDTH OF THE NEW LABEL —
     * `enumw:<key>` observes `enumSquareWidth(text)`, a pixel count, not the
     * option index — so a change between two options that render the same width
     * moves nothing and there is no transition to draw. This block first wrote
     * mode `0`→`2`, which is "LP"→"HP": same width, `observe` saw no change, and
     * the check failed against a CORRECT fix. `0`→`3` is "LP"→"Notch", 17px to
     * the 28px cap, which is the transition the widget actually has.
     *
     * THE ARM IS FORCED rather than read from MOVY_APP_LOOP_GRID, so these
     * checks have teeth in the plain `npm test` run too and not only under
     * page-mode.mjs. `pageArm` then goes in as the EXPECTED value, which is how
     * every other block here stays honest with the library unavailable.
     */
    setSchwungGridMode('page');
    const pageArm = schwungGridMode() === 'page';
    schwungGridReload();
    engine.reset();
    env.setParams(MOCK_SYNTHS.test_enum);
    resetSeqState(); resetSeqEngine();
    setFlag('setcommit', 0);
    globalThis.init();
    appState.currentView = VIEW_KNOBS;
    appState.activeTrack = trackRef(0);
    advance(12);

    const owner = () => pageOwnerOf(appState.trackModels[0][1]);
    for (let i = 0; i < 12 * 60 && !owner().delegated; i++) advance(1);
    const sp = pageArm ? owner().page : null;
    eq('the enum page is delegated to Schwung', !!sp, pageArm);

    /* Frames are counted at the page's own render. Wrapped rather than
     * re-exported so nothing else has to agree about what "a frame" is. */
    let frames = 0;
    if (sp) {
        const realRender = sp.render;
        sp.render = (...a) => { frames++; return realRender.apply(sp, a); };
    }

    /* (a) THE CONTROL. A delegated page with nothing moving draws NOTHING —
     * SP-13's floor, and the thing that makes (b) mean something: if this loop
     * drew frames on its own, every count below would be measuring the loop and
     * not the fix. */
    settleQuiet();
    frames = 0;
    advance(40);
    eq('an idle delegated page draws no frame at all', frames, 0);

    /* (b) THE TEETH. One value change on the drawn page, and MORE than the one
     * frame the change alone buys — one is the bug. Written through the host
     * the way the device writes it, behind the page's back, so the page has to
     * READ it: a value the page set itself could arrive by a path this item
     * does not touch. */
    globalThis.shadow_set_param(0, 'synth:mode', '3');
    frames = 0;
    /* ARRIVAL FIRST, THEN THE WINDOW. The write lands in the engine, and the
     * drawn page picks it up on its own read cursor — tens of ticks, not one —
     * so counting frames from the write would measure the harness's latency
     * rather than the transition. Count from the tick the changed value is in
     * the page's own `values`, which is the render that draws it. */
    let arrived = false;
    for (let i = 0; i < 400 && !arrived; i++) {
        advance(1);
        arrived = String(sp ? sp.ctl.state.values.mode : '') === '3';
    }
    eq('the changed value reached the drawn page', arrived, true);

    /* THE WINDOW, BOUNDED BY THE STORE'S OWN ANSWER AND NOT BY A TICK COUNT.
     * The transition is 120 ms of WALL CLOCK, and how many ticks that is
     * depends entirely on what a tick costs: here a tick is ~50 us when nothing
     * is dirty and a few hundred us when it draws (a whole run of 60 ticks took
     * ~18 ms), where on the DEVICE the animating window itself is the worst one:
     * `tick_ms=3.9 period_ms=6.8` with `render=0.7` of it (SP-38's ledger —
     * per-tick, averaged over a 120-tick window). Those are two different
     * machines by two orders of
     * magnitude, so a fixed tick count would measure the harness's speed rather
     * than the animation. The loop runs
     * while Schwung's own store says something is still moving — the same
     * question the fix asks — and the cap exists only so that "it animates"
     * cannot be satisfied by "it draws forever". */
    let ticks = 0;
    while (ticks++ < 5000 && (!sp || sp.animating(Date.now()))) advance(1);
    eq('a value change draws frames until the transition settles ('
       + frames + ' frames over ' + ticks + ' ticks)', frames > 1, pageArm);

    /* (c) NONE AFTER. Every transition placed in the past — `anim_state`'s own
     * field, so this is the input `settled` reads and not a restatement of it —
     * and the page must go back to drawing nothing at all. Without this half
     * "it animates" would also be satisfied by "it redraws forever". */
    if (sp) {
        for (const k of [...sp.ctl.state.anim.since.keys()]) {
            sp.ctl.state.anim.since.set(k, Date.now() - 10_000);
        }
    }
    frames = 0;
    advance(80);
    eq('and none once it has settled', frames, 0);

    /* The wrapper goes with the page: the reload below drops both together. */
    setSchwungGridMode(null);
    schwungGridReload();
}


/* ── SP-58: the master chain GRID draws Schwung's body, not movy's ─────────
 *
 * The master grid (session mode, not drilled in) draws the focused slot's knob
 * body under its slot bar. SP-52 delegated only the DETAIL page, so the grid
 * kept movy's body while its knobs already wrote through Schwung's page — the
 * labels were movy's page set, the edits were Schwung's. Forced to the `page`
 * arm, like the SP-38 block above, so this has teeth in plain `npm test`.
 *
 * Two readings, because either alone is satisfiable by a wrong fix: Schwung's
 * page must actually RENDER on the grid, and movy's body must never draw over
 * it (`param-body.ts`'s trip counter, which is the general guard).
 */
_log('\napp-loop: the master chain grid draws Schwung\'s body (SP-58)');
{
    setSchwungGridMode('page');
    const pageArm = schwungGridMode() === 'page';
    schwungGridReload();
    resetApp();
    /* test_enum declares a hierarchy, re-keyed onto MFX 1's namespace so the
     * master slot's own port reads it. */
    const mfx = _MFX_SLOTS[MFX1].componentKey;
    env.setParams(Object.fromEntries(Object.entries(MOCK_SYNTHS.test_enum)
        .map(([k, v]) => [k.replace(/^synth:/, mfx + ':'), v])));
    seqState.sessionMode = true;
    appState.masterChainIndex = MFX1;
    appState.currentView = VIEW_CHAIN;
    appState.masterDetail = false;
    appState.masterFxModels[MFX1].reload();
    const tripsBefore = movyBodyUnderPage().count;

    const owner = () => pageOwnerOf(appState.masterFxModels[MFX1]);
    for (let i = 0; i < 12 * 60 && !owner().delegated; i++) advance(1);
    const sp = pageArm ? owner().page : null;
    eq('the master slot\'s page is delegated on the grid', !!sp, pageArm);

    let frames = 0;
    if (sp) {
        const realRender = sp.render;
        sp.render = (...a) => { frames++; return realRender.apply(sp, a); };
    }
    appState.dirty = true;
    advance(3);
    eq('the grid renders Schwung\'s page', frames > 0, pageArm);
    eq('the grid never drew movy\'s body over it', movyBodyUnderPage().count - tripsBefore, 0);

    seqState.sessionMode = false;
    setSchwungGridMode(null);
    schwungGridReload();
}

/* THE GENERAL GUARD, over the whole run. Any view the blocks above put on
 * screen that drew movy's body while its owner was live under Schwung is a
 * render site that never asked for Schwung's body (SP-58). Only a `page` arm
 * can trip it — `delegated` is false everywhere else — and the SP-38 and SP-58
 * blocks force one, so this holds in plain `npm test` too. */
/* The label stays fixed so page-mode.mjs can ratchet on it; WHERE it tripped
 * goes to the log beside it. */
if (movyBodyUnderPage().count) _log('  movy body over a live page, last at ' + movyBodyUnderPage().last);
eq('movy never drew its own body over a live Schwung page', movyBodyUnderPage().count, 0);

if (process.env.MOVY_APP_LOOP_LABELS) _log('APP-LOOP-FAILED-LABELS ' + JSON.stringify(failedLabels));
if (failures === 0) _log('\n\x1b[32m\x1b[1mALL APP-LOOP CHECKS PASSED\x1b[0m');
else { _log(`\n\x1b[31m\x1b[1m${failures} APP-LOOP CHECK(S) FAILED\x1b[0m`); process.exit(1); }
