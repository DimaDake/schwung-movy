#!/usr/bin/env node
/* browser-test/logic.mjs — pure viewmodel/logic tests, no device or screenshots.
 *
 * Tests business invariants on the model and viewmodel layer.
 * Run from movy root: node browser-test/logic.mjs
 *
 * The suites live in logic/, one module per subsystem; this file only sequences
 * them. harness.mjs must be imported first — it installs the mock globals and
 * owns the failure counter every suite reports into.
 */

import { _log, failureCount, resetPorts } from './logic/harness.mjs';
import { run as run_model_hierarchy } from './logic/model-hierarchy.mjs';
import { run as run_model_params } from './logic/model-params.mjs';
import { run as run_knob_input } from './logic/knob-input.mjs';
import { run as run_declarations } from './logic/declarations.mjs';
import { run as run_drums } from './logic/drums.mjs';
import { run as run_ai_config } from './logic/ai-config.mjs';
import { run as run_ai_context } from './logic/ai-context.mjs';
import { run as run_ai_validate } from './logic/ai-validate.mjs';
import { run as run_ai_role } from './logic/ai-role.mjs';
import { run as run_ai_provider } from './logic/ai-provider.mjs';
import { run as run_ai_job } from './logic/ai-job.mjs';
import { run as run_ai_preview } from './logic/ai-preview.mjs';
import { run as run_ai_gestures } from './logic/ai-gestures.mjs';
import { run as run_gen_bench } from './logic/gen-bench.mjs';
import { run as run_gen_theory } from './logic/gen-theory.mjs';
import { run as run_gen_engine } from './logic/gen-engine.mjs';
import { run as run_ai_preview_knobs } from './logic/ai-preview-knobs.mjs';
import { run as run_host_param } from './logic/host-param.mjs';
import { run as run_platform_caps } from './logic/platform-caps.mjs';
import { run as run_master_chain } from './logic/master-chain.mjs';
import { run as run_master_volume } from './logic/master-volume.mjs';
import { run as run_seq_engine } from './logic/seq-engine.mjs';
import { run as run_seq_router } from './logic/seq-router.mjs';
import { run as run_seq_edit } from './logic/seq-edit.mjs';
import { run as run_seq_session } from './logic/seq-session.mjs';
import { run as run_song } from './logic/song.mjs';
import { run as run_session_shift } from './logic/session-shift.mjs';
import { run as run_set_session } from './logic/set-session.mjs';
import { run as run_set_settling } from './logic/set-settling.mjs';
import { run as run_seq_leds } from './logic/seq-leds.mjs';
import { run as run_mute_solo } from './logic/mute-solo.mjs';
import { run as run_step_entry } from './logic/step-entry.mjs';
import { run as run_automation } from './logic/automation.mjs';
import { run as run_keyboard } from './logic/keyboard.mjs';
import { run as run_params_pages } from './logic/params-pages.mjs';
import { run as run_set_state } from './logic/set-state.mjs';
import { run as run_old_set } from './logic/old-set.mjs';
import { run as run_versions } from './logic/versions.mjs';
import { run as run_sets } from './logic/sets.mjs';
import { run as run_probe } from './logic/probe.mjs';
import { run as run_set_restore_loss } from './logic/set-restore-loss.mjs';
import { run as run_lfo } from './logic/lfo.mjs';
import { run as run_lfo_assign } from './logic/lfo-assign.mjs';
import { run as run_module_configs } from './logic/module-configs.mjs';
import { run as run_config_hierarchy } from './logic/config-hierarchy.mjs';
import { run as run_track_volume } from './logic/track-volume.mjs';
import { run as run_notes_release } from './logic/notes-release.mjs';
import { run as run_step_record } from './logic/step-record.mjs';
import { run as run_undo_core } from './logic/undo-core.mjs';
import { run as run_undo_restore } from './logic/undo-restore.mjs';
import { run as run_undo_params } from './logic/undo-params.mjs';
import { run as run_quantize } from './logic/quantize.mjs';
import { run as run_loop_window } from './logic/loop-window.mjs';
import { run as run_note_view } from './logic/note-view.mjs';
import { run as run_step_piano } from './logic/step-piano.mjs';
import { run as run_external_midi } from './logic/external-midi.mjs';
import { run as run_track_watch } from './logic/track-watch.mjs';
import { run as run_tracks_refs } from './logic/tracks-refs.mjs';
import { run as run_tracks_chain } from './logic/tracks-chain.mjs';
import { run as run_partition } from './logic/partition.mjs';
import { run as run_flags } from './logic/flags.mjs';
import { run as run_schwung_grid } from './logic/schwung-grid.mjs';
import { run as run_schwung_page } from './logic/schwung-page.mjs';
import { run as run_preset_door } from './logic/preset-door.mjs';
import { run as run_schwung_page_press } from './logic/schwung-page-press.mjs';
import { run as run_schwung_widgets } from './logic/schwung-widgets.mjs';
import { run as run_schwung_canvas_page } from './logic/schwung-canvas-page.mjs';
import { run as run_page_freshness } from './logic/page-freshness.mjs';
import { run as run_page_batch } from './logic/page-batch.mjs';
import { run as run_page_automation } from './logic/page-automation.mjs';
import { run as run_schwung_page_undo } from './logic/schwung-page-undo.mjs';
import { run as run_drum_automation } from './logic/drum-automation.mjs';
import { run as run_drum_focus } from './logic/drum-focus.mjs';
import { run as run_drum_seat } from './logic/drum-seat.mjs';
import { run as run_page_visible } from './logic/page-visible.mjs';
import { run as run_canvas_dive } from './logic/schwung-canvas-dive.mjs';
import { run as run_file_preview } from './logic/file-preview.mjs';
import { run as run_drum_racks } from './logic/drum-racks.mjs';
import { run as run_page_owner } from './logic/page-owner.mjs';
import { run as run_param_body } from './logic/param-body.mjs';
import { run as run_hierarchy_source } from './logic/hierarchy-source.mjs';
import { run as run_page_contract } from './logic/page-contract.mjs';
import { run as run_schwung_sample } from './logic/schwung-sample.mjs';
import { run as run_schwung_page_idle_cost } from './logic/schwung-page-idle-cost.mjs';
import { run as run_cpu_page } from './logic/cpu-page.mjs';
import { run as run_mixer } from './logic/mixer.mjs';
import { run as run_clip_params_source } from './logic/clip-params-source.mjs';
import { run as run_set_params_source } from './logic/set-params-source.mjs';
import { run as run_session_mixer } from './logic/session-mixer.mjs';
import { run as run_step_params_source } from './logic/step-params-source.mjs';
import { run as run_own_component_source } from './logic/own-component-source.mjs';
import { run as run_font_parity } from './logic/font-parity.mjs';
import { run as run_env_identity } from './logic/env-identity.mjs';

/* Awaited one at a time: the suites share the mock device globals, and the
 * expected output is a fixed transcript, so they must not interleave. */
const SUITES = [
    /* First on purpose. A dump boot takes the param accessors AND the env's
     * `os`/`host_read_file`, and it used to be that only a boot could hand the
     * accessors back — so this suite had to sit between the range that needed one
     * host and the range that needed another. It restores what it takes
     * (`env.restoreHostGlobals()`), which is what makes its position arbitrary;
     * it stays first because a position that is only correct because nothing has
     * run yet is the position that keeps that property visible. */
    run_env_identity,
    run_model_hierarchy,
    run_model_params,
    run_knob_input,
    run_declarations,
    run_drums,
    run_ai_config,
    run_ai_context,
    run_ai_validate,
    run_ai_role,
    run_ai_provider,
    run_ai_job,
    run_ai_preview,
    run_ai_gestures,
    run_gen_bench,
    run_gen_theory,
    run_gen_engine,
    run_ai_preview_knobs,
    run_host_param,
    run_platform_caps,
    run_master_chain,
    run_master_volume,
    run_seq_engine,
    run_seq_router,
    run_seq_edit,
    run_seq_session,
    run_song,
    run_session_shift,
    run_set_session,
    run_set_settling,
    run_seq_leds,
    run_mute_solo,
    run_step_entry,
    run_automation,
    run_keyboard,
    run_params_pages,
    run_set_state,
    run_old_set,
    run_versions,
    run_sets,
    run_probe,
    run_set_restore_loss,
    run_lfo,
    run_lfo_assign,
    run_module_configs,
    run_config_hierarchy,
    run_track_volume,
    run_notes_release,
    run_step_record,
    run_undo_core,
    run_undo_restore,
    run_undo_params,
    run_quantize,
    run_loop_window,
    run_note_view,
    run_step_piano,
    run_external_midi,
    run_track_watch,
    run_tracks_refs,
    run_tracks_chain,
    run_partition,
    run_flags,
    run_schwung_grid,
    run_schwung_page,
    run_preset_door,
    run_schwung_page_press,
    run_schwung_widgets,
    run_schwung_canvas_page,
    run_page_freshness,
    run_page_batch,
    run_page_automation,
    run_schwung_page_undo,
    run_drum_automation,
    run_drum_focus,
    run_drum_seat,
    run_page_visible,
    run_canvas_dive,
    run_file_preview,
    run_drum_racks,
    run_page_owner,
    run_param_body,
    run_hierarchy_source,
    run_page_contract,
    run_schwung_sample,
    run_schwung_page_idle_cost,
    run_cpu_page,
    run_mixer,
    run_clip_params_source,
    run_set_params_source,
    run_session_mixer,
    run_step_params_source,
    run_own_component_source,
    run_font_parity,
];

/* Between suites, drop the port cache: a suite that leaves ports bound to its
 * own mock globals would hand the next one a stale binding. */
for (const suite of SUITES) {
    resetPorts();
    await suite();
}

/* ── Summary ─────────────────────────────────────────────────────────────── */

_log('');
if (failureCount() === 0) {
    _log('\x1b[32m\x1b[1mALL LOGIC CHECKS PASSED\x1b[0m');
    process.exit(0);
} else {
    _log(`\x1b[31m\x1b[1m${failureCount()} LOGIC CHECK(S) FAILED\x1b[0m`);
    process.exit(1);
}
