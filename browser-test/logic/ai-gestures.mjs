/* browser-test/logic/ai-gestures.mjs — Shift + hold Step 16 (Smart Quantize)
 * and Shift + hold Step 14 (Variation), design §2 and §3. Both generators
 * start only from a hold, so a stray press never sends anything.
 *
 * Run by browser-test/logic.mjs.
 */

import { _log, eq, ok, installMockFs, uninstallMockFs, installMockEngine, uninstallMockEngine,
    resetSeqEngine, appState, selectTrack } from './harness.mjs';
import { holdPress, holdRelease, holdTick, holdProgress, holdLabel, aiVariationStart, aiQuantizeStart,
    variationPossible, aiPhase, resetAiJob, holdPending, aiGestureTick, aiCancel } from '../../dist/esm/ai/index.js';
import { handleStepButton } from '../../dist/esm/seq/router-steps.js';
import { stepIconColor } from '../../dist/esm/seq/leds.js';
import { setPhase, sessionPhase } from '../../dist/esm/seq/set-session.js';
let phaseBefore = null;
import { seqState } from '../../dist/esm/seq/state.js';
import { seqToastText } from '../../dist/esm/seq/render.js';

const MOD = '/data/UserData/schwung/modules/tools/movy';
const WHITE_DIM = 16;

function boot() {
    resetAiJob();
    installMockFs({ [MOD + '/secrets/gemini_api_key.txt']: 'K' });
    installMockEngine();
    globalThis.host_http_request_background = () => true;
    selectTrack(0);
    seqState.sessionMode = false; seqState.recording = false; seqState.countingIn = false;
    seqState.session[0].selected = 1;
    seqState.session[0].exist = 0b11;
    seqState.lenSteps = 16;
    seqState.occ.fill(0); seqState.occ[0] = 1;
    phaseBefore ??= sessionPhase();
    setPhase('ready');
}
function done() { if (phaseBefore !== null) setPhase(phaseBefore); phaseBefore = null; done0(); }
function done0() { resetAiJob(); delete globalThis.host_http_request_background; uninstallMockEngine(); uninstallMockFs(); resetSeqEngine(); }

export async function run() {
_log('\nTest: AI gestures');

let fired = 0;
const fire = () => { fired++; };
holdPress(0, 'quantize');
eq('tap16_fires_quantize_on_release', holdRelease(120), 'tap');
holdPress(0, 'quantize');
eq('hold16_under_300_no_progress_drawn', holdProgress(250), -1);
eq('hold16 progress half way at 800 ms', holdProgress(800), 0.5);
eq('hold16_release_mid_cancels_no_quantize', holdRelease(700), 'cancel');
holdPress(0, 'quantize');
holdTick(500, false, fire);
eq('hold16_shift_released_first_cancels', holdRelease(600), 'none');
eq('...and starts nothing', fired, 0);
holdPress(0, 'quantize');
holdTick(100, false, fire);
eq('a quick tap that lifts Shift first is still a tap', holdRelease(150), 'tap');
holdPress(0, 'quantize');
holdTick(1299, true, fire);
eq('not full at 1299 ms', fired, 0);
holdTick(1300, true, fire);
holdTick(1400, true, fire);
eq('hold16_full_starts_job_once', fired, 1);
eq('the release after a fired hold does nothing', holdRelease(1500), 'none');
fired = 0;
holdPress(0, 'quantize', false);
eq('hold16_unarmed_shows_no_bar', holdProgress(800), -1);
holdTick(1400, true, fire);
eq('hold16_unarmed_never_fires', fired, 0);
eq('hold16_unarmed_release_is_a_tap', holdRelease(1500), 'tap');
let started = '';
holdPress(0, 'variation');
holdTick(1300, true, (k) => { started = k; });
eq('hold_full_starts_its_own_kind', started, 'variation');
holdRelease(1400);
holdPress(0, 'variation');
eq('hold_label_names_the_generator: variation', holdLabel(), 'VARIATION');
holdRelease(100);
holdPress(0, 'quantize');
eq('hold_label_names_the_generator: quantize', holdLabel(), 'SMART QUANTIZE');
holdRelease(100);

eq('step14_led_dim_white_under_shift: lit', stepIconColor(13, { shift: true, aiVar: true }), WHITE_DIM);
eq('step14_led_dim_white_under_shift: dark', stepIconColor(13, { shift: true, aiVar: false }), 0);
eq('step14 LED dark without Shift', stepIconColor(13, { shift: false, aiVar: true }), 0);

boot();
eq('variationPossible with another clip', variationPossible(), true);
seqState.session[0].exist = 0b10;
eq('variationPossible: only the selected slot', variationPossible(), false);
aiVariationStart();
eq('...and Step 14 makes a New Clip instead', aiPhase(), 'running');
aiCancel();
seqState.session[0].exist = 0b11;
seqState.sessionMode = true;
aiVariationStart();
eq('step14_inert_in_session', aiPhase(), 'idle');
seqState.sessionMode = false;
seqState.recording = true;
aiVariationStart();
aiQuantizeStart();
eq('ai_gestures_ignored_while_recording', aiPhase(), 'idle');
seqState.recording = false;
aiVariationStart();
eq('step14_starts_variation', aiPhase(), 'running');
done();

boot();
setPhase('settling');
aiQuantizeStart();
aiVariationStart();
eq('ai_gestures_wait_for_a_ready_set', aiPhase(), 'idle');
setPhase('ready');
done();

boot();
seqState.occ.fill(0);
aiQuantizeStart();
eq('quantize_empty_clip_toasts: idle', aiPhase(), 'idle');
eq('quantize_empty_clip_toasts: toast', seqToastText(), 'NOTHING TO QUANTIZE');
seqState.occ[0] = 1;
aiQuantizeStart();
eq('quantize with notes starts the job', aiPhase(), 'running');
done();

/* Through the real step router: a Shift tap on Step 16 still cycles quantize
 * (on release), a press alone does not. */
boot();
const before = seqState.clipQuant;
appState.shiftHeld = true;
handleStepButton(15, true, true);
eq('Shift+Step16 press alone does not cycle', seqState.clipQuant, before);
handleStepButton(15, false, true);
ok('Shift+Step16 release cycles quantize', seqState.clipQuant !== before);
seqState.recording = true;
const qRec = seqState.clipQuant;
handleStepButton(15, true, true);
eq('hold_bar_stays_hidden_while_recording', holdProgress(Date.now() + 800), -1);
handleStepButton(15, false, true);
ok('Shift+Step16 while recording still cycles quantize', seqState.clipQuant !== qRec);
seqState.recording = false;
appState.shiftHeld = false;
/* A Shift+16 press whose release was lost must not hijack the next plain
 * press of Step 16 (its release would skip the step-edit bookkeeping). */
handleStepButton(15, true, true);
handleStepButton(15, true, false);
eq('lost_release_does_not_hijack_a_plain_press', holdPending(), false);
handleStepButton(15, false, false);
done();

/* Shift + Step 14 through the router: a tap only says to hold; a full hold
 * starts the variation; letting go early sends nothing. */
boot();
appState.shiftHeld = true;
handleStepButton(13, true, true);
handleStepButton(13, false, true);
eq('step14_tap_starts_nothing', aiPhase(), 'idle');
eq('step14_tap_says_hold', seqToastText(), 'HOLD TO GENERATE');
handleStepButton(13, true, true);
aiGestureTick(Date.now() + 700);
handleStepButton(13, false, true);
eq('step14_early_release_starts_nothing', aiPhase(), 'idle');
handleStepButton(13, true, true);
aiGestureTick(Date.now() + 1400);
eq('step14_hold_starts_variation', aiPhase(), 'running');
handleStepButton(13, false, true);
appState.shiftHeld = false;
done();

boot();
appState.shiftHeld = true;
seqState.session[0].exist = 0b10;
handleStepButton(13, true, true);
ok('step14_hold_armed_without_a_source: the bar fills', holdProgress(Date.now() + 800) > 0);
eq('step14_hold_without_a_source_is_named_new_clip', holdLabel(), 'NEW CLIP');
aiGestureTick(Date.now() + 1400);
eq('step14_hold_without_a_source_starts_new_clip', aiPhase(), 'running');
aiCancel();
handleStepButton(13, false, true);
appState.shiftHeld = false;
done();

/* Shift + Step 15: a tap still doubles the loop (on release); a full hold
 * grows into Smart Double and leaves the length to the preview. */
boot();
appState.shiftHeld = true;
seqState.loopStart = 0; seqState.lenSteps = 16;
handleStepButton(14, true, true);
eq('step15_press_alone_does_not_double', seqState.lenSteps, 16);
handleStepButton(14, false, true);
eq('step15_tap_doubles_on_release', seqState.lenSteps, 32);
seqState.lenSteps = 16;
handleStepButton(14, true, true);
eq('hold_label_names_the_generator: double', holdLabel(), 'SMART DOUBLE');
aiGestureTick(Date.now() + 1400);
eq('step15_hold_starts_smart_double', aiPhase(), 'running');
handleStepButton(14, false, true);
eq('step15_hold_release_does_not_also_double', seqState.lenSteps, 16);
done();

boot();
appState.shiftHeld = true;
seqState.lenSteps = 16 * 9;
handleStepButton(14, true, true);
eq('step15_hold_unarmed_past_16_bars: no bar', holdProgress(Date.now() + 800), -1);
handleStepButton(14, false, true);
seqState.lenSteps = 16;
seqState.occ.fill(0);
handleStepButton(14, true, true);
eq('step15_hold_unarmed_on_an_empty_clip: no bar', holdProgress(Date.now() + 800), -1);
handleStepButton(14, false, true);
appState.shiftHeld = false;
done();
}
