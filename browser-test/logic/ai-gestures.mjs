/* browser-test/logic/ai-gestures.mjs — Shift + hold Step 16 (Smart Quantize)
 * and Shift + Step 14 (Generate Variation), design §2 and §3.
 *
 * Run by browser-test/logic.mjs.
 */

import { _log, eq, ok, installMockFs, uninstallMockFs, installMockEngine, uninstallMockEngine,
    resetSeqEngine, appState, selectTrack } from './harness.mjs';
import { hold16Press, hold16Release, hold16Tick, hold16Progress, aiVariationPress, aiQuantizeStart,
    variationPossible, aiPhase, resetAiJob, hold16Pending } from '../../dist/esm/ai/index.js';
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
hold16Press(0);
eq('tap16_fires_quantize_on_release', hold16Release(120), 'quantize');
hold16Press(0);
eq('hold16_under_300_no_progress_drawn', hold16Progress(250), -1);
eq('hold16 progress half way at 800 ms', hold16Progress(800), 0.5);
eq('hold16_release_mid_cancels_no_quantize', hold16Release(700), 'cancel');
hold16Press(0);
hold16Tick(500, false, fire);
eq('hold16_shift_released_first_cancels', hold16Release(600), 'none');
eq('...and starts nothing', fired, 0);
hold16Press(0);
hold16Tick(100, false, fire);
eq('a quick tap that lifts Shift first is still a tap', hold16Release(150), 'quantize');
hold16Press(0);
hold16Tick(1299, true, fire);
eq('not full at 1299 ms', fired, 0);
hold16Tick(1300, true, fire);
hold16Tick(1400, true, fire);
eq('hold16_full_starts_job_once', fired, 1);
eq('the release after a fired hold does nothing', hold16Release(1500), 'none');

eq('step14_led_dim_white_only_when_possible: lit', stepIconColor(13, { shift: true, aiVar: true }), WHITE_DIM);
eq('step14_led_dim_white_only_when_possible: dark', stepIconColor(13, { shift: true, aiVar: false }), 0);
eq('step14 LED dark without Shift', stepIconColor(13, { shift: false, aiVar: true }), 0);

boot();
eq('variationPossible with another clip', variationPossible(), true);
seqState.session[0].exist = 0b10;
eq('variationPossible: only the selected slot', variationPossible(), false);
aiVariationPress();
eq('...and Step 14 does nothing', aiPhase(), 'idle');
seqState.session[0].exist = 0b11;
seqState.sessionMode = true;
aiVariationPress();
eq('step14_inert_in_session', aiPhase(), 'idle');
seqState.sessionMode = false;
seqState.recording = true;
aiVariationPress();
aiQuantizeStart();
eq('ai_gestures_ignored_while_recording', aiPhase(), 'idle');
seqState.recording = false;
aiVariationPress();
eq('step14_starts_variation', aiPhase(), 'running');
done();

boot();
setPhase('settling');
aiQuantizeStart();
aiVariationPress();
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
appState.shiftHeld = false;
/* A Shift+16 press whose release was lost must not hijack the next plain
 * press of Step 16 (its release would skip the step-edit bookkeeping). */
handleStepButton(15, true, true);
handleStepButton(15, true, false);
eq('lost_release_does_not_hijack_a_plain_press', hold16Pending(), false);
handleStepButton(15, false, false);
done();
}
