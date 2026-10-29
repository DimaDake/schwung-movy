/* browser-test/logic/ai-job.mjs — the generator job from gesture to preview:
 * source choice, the running phase (only Back works, the screen stays the app's),
 * cancels and failures (design §3, §5.1, §5.3).
 *
 * Run by browser-test/logic.mjs.
 */

import { _log, eq, ok, installMockFs, uninstallMockFs, installMockEngine, uninstallMockEngine,
    seqEngineTick, resetSeqEngine } from './harness.mjs';
import {
    pickSource, variationTarget, parseTrackDump, startAiJob, aiPhase, aiTick, aiRunningInput, aiCancel,
    aiSetWillChange, aiPreviewInput, resetAiJob, commitPreview, readTrack,
} from '../../dist/esm/ai/index.js';
import { seqToastText, seqHeaderShown } from '../../dist/esm/seq/render.js';
import { openPowerModal, closeLeaveModal } from '../../dist/esm/app/leave-modal.js';

const DUMP = '0 16 0 1/1 0 0|0.24.60.100,96.24.64.100';

import { PREFS_PATH } from '../../dist/esm/seq/prefs.js';
import { genLevelTurn, resetGenLevel } from '../../dist/esm/seq/gen-level.js';

function boot(files = {}) {
    const fs = installMockFs(files);
    const eng = installMockEngine();
    eng.params['ait:0'] = DUMP;
    const calls = [];
    globalThis.host_http_request_background = (o) => { calls.push(o); return true; };
    resetAiJob();
    return { fs, eng, calls };
}
function done(st) { st.calls.length = 0; delete globalThis.host_http_request_background; uninstallMockEngine(); uninstallMockFs(); resetSeqEngine(); }
function runTicks(n) { for (let i = 0; i < n; i++) aiTick(); }

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

let st = boot();
const getsBefore = st.eng.getParamCalls;
eq('idle_tick_costs_nothing: idle tick owns nothing', aiTick(), undefined);
eq('idle_tick_costs_nothing: no engine read', st.eng.getParamCalls, getsBefore);
startAiJob('quantize', 0, 0);
eq('start: running', aiPhase(), 'running');
aiCancel();
done(st);

/* The GENERATORS level is read when the job starts: a turn on the Settings
 * page during the reads changes the next request, not this one. */
st = boot({ [PREFS_PATH]: JSON.stringify({ genLevel: 'SAFE' }) });
resetGenLevel();
startAiJob('quantize', 0, 0);
genLevelTurn(1); genLevelTurn(1);
runTicks(80);
eq('level_read_once_per_request', aiPreviewInput()?.gen?.ctx.input.level, 'SAFE');
commitPreview();
resetGenLevel();
done(st);

st = boot();
startAiJob('quantize', 0, 0);
runTicks(16);
eq('running_swallows_pads_and_steps: pad press', aiRunningInput([0x90, 68, 100]), true);
eq('running_swallows_pads_and_steps: step press', aiRunningInput([0x90, 16, 100]), true);
eq('running passes releases through', aiRunningInput([0x80, 68, 0]), false);
/* No animation and no takeover (user, 2026-10-28): the header names the job,
 * the frame stays the app's, and the power dialog answers over it. */
eq('running_keeps_the_frame', aiTick(), undefined);
ok('running_names_the_job_in_the_header', seqHeaderShown().startsWith('QUANTIZING...'));
openPowerModal();
eq('power_dialog_answers_while_running', aiRunningInput([0xB0, MoveMainKnob, 1]), false);
closeLeaveModal('test');
eq('...and running swallows again once it closes', aiRunningInput([0x90, 68, 100]), true);
eq('back_cancels_running: consumed', aiRunningInput([0xB0, MoveBack, 127]), true);
eq('back_cancels_running: idle', aiPhase(), 'idle');
runTicks(80);
eq('nothing_opens_after_cancel', aiPhase(), 'idle');
startAiJob('quantize', 0, 0);
aiSetWillChange();
eq('set_change_aborts_running', aiPhase(), 'idle');
done(st);

st = boot();
st.eng.params['ait:0'] = '0 16 0 1/1 0 0|';
startAiJob('quantize', 0, 0);
runTicks(20);
eq('nothing_to_quantize: idle', aiPhase(), 'idle');
eq('nothing_to_quantize: toast', seqToastText(), 'NOTHING TO QUANTIZE');
done(st);

st = boot();
st.eng.params['ait:0'] = '0 16 8 1/1 0 0|0.24.50.100,192.24.60.100';
const win = readTrack(0).clips[0];
eq('read_track_windows_the_loop: only the heard note', JSON.stringify(win.notes), '[{"tick":0,"gate":24,"pitch":60,"vel":100}]');
eq('read_track_windows_the_loop: window rebased to 0', win.loopStart, 0);
done(st);


/* ── The generators (plans/2026-10-27-algorithmic-generators-design.md §7):
 * the presets in slices, then the preview. ── */
{
    const st = boot();
    st.eng.params['ait:0'] = '0 16 0 1/1 0 0|5.20.60.100,99.22.64.96,190.24.61.90,262.20.67.100,290.10.67.30';
    startAiJob('quantize', 0, 0);
    runTicks(16);
    eq('algo_still_running_after_the_reads (slices)', aiPhase(), 'running');
    runTicks(60);
    eq('algo_opens_the_preview', aiPhase(), 'preview');
    eq('algo_sends_no_request', st.calls.length, 0);
    const p = aiPreviewInput();
    ok('algo_offers_options', p && p.options.length >= 1 && p.options.length <= 6);
    ok('algo_each_option_knows_its_preset_and_knobs', p && p.gen && p.gen.picks.length === p.options.length
        && p.gen.picks.every((x) => x.knobs.length === x.preset.knobs.length));
    commitPreview();
    done(st);
}
{
    const st = boot();
    st.eng.params['ait:0'] = '0 16 0 1/1 0 0|0.24.60.100,96.24.64.100';
    startAiJob('variation', 0, 1);
    runTicks(16);
    aiRunningInput([0xB0, MoveBack, 127]);
    eq('algo_back_cancels_mid_slices', aiPhase(), 'idle');
    done(st);
}
}
