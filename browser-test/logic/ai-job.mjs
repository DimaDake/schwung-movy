/* browser-test/logic/ai-job.mjs — the AI job from gesture to preview: source
 * choice, the running phase (only Back works), cancels, failures, and the
 * thinking animation (design §3, §5.1, §5.3).
 *
 * Run by browser-test/logic.mjs.
 */

import { _log, eq, ok, installMockFs, uninstallMockFs, installMockEngine, uninstallMockEngine,
    seqEngineTick, resetSeqEngine } from './harness.mjs';
import {
    pickSource, variationTarget, parseTrackDump, startAiJob, aiPhase, aiTick, aiRunningInput, aiCancel,
    aiSetWillChange, aiPreviewInput, resetAiJob, commitPreview, readTrack, thinkingPadColour, AI_DIR,
} from '../../dist/esm/ai/index.js';
import { seqToastText } from '../../dist/esm/seq/render.js';

const MOD = '/data/UserData/schwung/modules/tools/movy';
const DUMP = '0 16 0 1/1 0 0|0.24.60.100,96.24.64.100';
const GOOD = JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ options: [
    { notes: [[0, 1, 60, 100]] }, { notes: [[0, 1, 62, 100]] }, { notes: [[0, 1, 64, 100]] }] }) }] } }] });

import { PREFS_PATH } from '../../dist/esm/seq/prefs.js';
import { FIRST_TIMEOUT_S, HTTP_TIMEOUT_S } from '../../dist/esm/ai/index.js';
import { genLevelTurn, resetGenLevel } from '../../dist/esm/seq/gen-level.js';

function boot(withKey = true) {
    const fs = installMockFs(withKey ? { [MOD + '/secrets/gemini_api_key.txt']: 'K' } : {});
    const eng = installMockEngine();
    eng.params['ait:0'] = DUMP;
    const calls = [];
    globalThis.host_http_request_background = (o) => { calls.push(o); return true; };
    resetAiJob();
    return { fs, eng, calls };
}
function done(st) { st.calls.length = 0; delete globalThis.host_http_request_background; uninstallMockEngine(); uninstallMockFs(); resetSeqEngine(); }
function runTicks(n) { for (let i = 0; i < n; i++) aiTick(1000 + i * 20); }
function reply(st, status, body) {
    const o = st.calls[st.calls.length - 1];
    st.fs.files[o.response_path] = body;
    st.fs.files[o.status_path] = JSON.stringify({ http_status: status, curl_exit: 0 });
}

export async function run() {
_log('\nTest: AI job');

const has = (slots) => slots.map((s) => ({ slot: s, hasNotes: true }));
eq('pick_source_prefers_above', pickSource([...has([0, 3, 5])], 4), 3);
eq('pick_source_below_when_none_above', pickSource(has([6]), 2), 6);
eq('pick_source_null_alone', pickSource(has([2]), 2), null);
eq('pick_source ignores clips without notes', pickSource([{ slot: 1, hasNotes: false }], 3), null);

const clips = parseTrackDump(0, '1 32 0 1/2 0 0|0.1.60.1\n4 64 0 1/1 0 0|');
eq('variation_len_from_existing_target', variationTarget(clips, 4, 1).len, 64);
eq('variation_len_from_source_when_empty', variationTarget(clips, 6, 1).len, 32);
eq('variation_scale_from_source', JSON.stringify(variationTarget(clips, 4, 1).scale), '[1,2]');

let st = boot(false);
startAiJob('quantize', 0, 0);
eq('no_key_toasts_and_stays_idle: phase', aiPhase(), 'idle');
eq('no_key_toasts_and_stays_idle: toast', seqToastText(), 'NO API KEY — MOVE.LOCAL:7700');
st.fs.files[MOD + '/ai-fake-response.json'] = GOOD;
startAiJob('quantize', 0, 0);
eq('a fake reply needs no key (device scenarios)', aiPhase(), 'running');
aiCancel();
done(st);

st = boot();
const getsBefore = st.eng.getParamCalls;
eq('idle_tick_costs_nothing: idle tick owns nothing', aiTick(0), false);
eq('idle_tick_costs_nothing: no engine read', st.eng.getParamCalls, getsBefore);
startAiJob('quantize', 0, 0);
eq('start: running', aiPhase(), 'running');
runTicks(20);
eq('start: one request sent', st.calls.length, 1);
ok('start: body under the AI dir', st.calls[0].body_path.startsWith(AI_DIR));
ok('start: the prompt carries the clip', /60:C3/.test(st.fs.files[st.calls[0].body_path]));
aiCancel();
done(st);

/* The GENERATORS level is read when the job starts: a turn on the Settings
 * page during the reads changes the next request, not this one. */
st = boot();
st.fs.files[PREFS_PATH] = JSON.stringify({ genLevel: 'SAFE' });
resetGenLevel();
startAiJob('quantize', 0, 0);
genLevelTurn(1); genLevelTurn(1);
runTicks(20);
const sentBody = JSON.parse(st.fs.files[st.calls[0].body_path]);
ok('level_read_once_per_request: SAFE ladder', /Option 2 \(tidy\)/.test(sentBody.contents[0].parts[0].text));
eq('level_read_once_per_request: one temperature for every level (bench)', sentBody.generationConfig.temperature, 1);
resetGenLevel();
aiCancel();
done(st);
st = boot();
startAiJob('quantize', 0, 0);
runTicks(20);
eq('running_swallows_pads_and_steps: pad press', aiRunningInput([0x90, 68, 100]), true);
eq('running_swallows_pads_and_steps: step press', aiRunningInput([0x90, 16, 100]), true);
eq('running passes releases through', aiRunningInput([0x80, 68, 0]), false);
eq('back_cancels_running: consumed', aiRunningInput([0xB0, MoveBack, 127]), true);
eq('back_cancels_running: idle', aiPhase(), 'idle');
reply(st, 200, GOOD);
runTicks(3);
eq('late_reply_after_cancel_ignored', aiPhase(), 'idle');
done(st);

st = boot();
startAiJob('quantize', 0, 0);
runTicks(20);
reply(st, 200, GOOD);
runTicks(2);
eq('valid reply opens the preview', aiPhase(), 'preview');
eq('preview gets three options', aiPreviewInput()?.options.length, 3);
eq('preview carries the original clip', aiPreviewInput()?.orig?.notes.length, 2);
commitPreview();
eq('commit returns the job to idle', aiPhase(), 'idle');
done(st);

st = boot();
startAiJob('quantize', 0, 0);
runTicks(20);
reply(st, 429, '{}');
runTicks(2);
eq('fallback_only_on_busy: a busy primary asks the fallback', st.calls.length, 2);
ok('fallback_only_on_busy: ...by name', JSON.parse(st.fs.files[st.calls[1].body_path]) && /flash-lite-latest/.test(st.calls[1].url));
eq('fallback_only_on_busy: still running', aiPhase(), 'running');
reply(st, 503, '{}');
runTicks(2);
eq('fallback_both_busy_shows_busy', seqToastText(), 'BUSY, TRY LATER');
eq('quota reply leaves idle', aiPhase(), 'idle');
startAiJob('quantize', 0, 0);
runTicks(20);
const before = st.calls.length;
reply(st, 200, '{"candidates":[]}');
runTicks(2);
eq('unusable reply toasts AI ERROR', seqToastText(), 'GENERATOR ERROR');
eq('fallback_only_on_busy: an answered request never falls back', st.calls.length, before);
startAiJob('quantize', 0, 0);
aiSetWillChange();
eq('set_change_aborts_running', aiPhase(), 'idle');
aiCancel();
done(st);

st = boot();
st.eng.params['ait:0'] = '0 16 8 1/1 0 0|0.24.50.100,192.24.60.100';
const win = readTrack(0).clips[0];
eq('read_track_windows_the_loop: only the heard note', JSON.stringify(win.notes), '[{"tick":0,"gate":24,"pitch":60,"vel":100}]');
eq('read_track_windows_the_loop: window rebased to 0', win.loopStart, 0);
st.eng.params['ait:0'] = DUMP;
startAiJob('quantize', 0, 0);
runTicks(20);
eq('fallback_fits_the_watchdog: the primary waits FIRST_TIMEOUT_S', st.calls[0].timeout_seconds, FIRST_TIMEOUT_S);
ok('fallback_fits_the_watchdog: both waits stay under 90 s', FIRST_TIMEOUT_S + HTTP_TIMEOUT_S + 20 <= 90);
aiTick(1000 + (FIRST_TIMEOUT_S + 11) * 1000);
eq('a silent primary falls back after its watchdog', st.calls.length, 2);
aiTick(1000 + (FIRST_TIMEOUT_S + HTTP_TIMEOUT_S + 30) * 1000);
eq('stuck_request_times_out: idle', aiPhase(), 'idle');
eq('stuck_request_times_out: toast', seqToastText(), 'GENERATOR ERROR');
done(st);

eq('thinking_band_moves_one_column_per_step: head white', thinkingPadColour(3, 3), 120);
eq('thinking_band_moves_one_column_per_step: next step', thinkingPadColour(4, 4), 120);
ok('thinking band: trail is violet', thinkingPadColour(2, 3) !== 0 && thinkingPadColour(2, 3) !== 120);
eq('thinking band: rest dark', thinkingPadColour(6, 3), 0);
eq('thinking band: same column on every row', thinkingPadColour(3 + 24, 3), 120);
}
