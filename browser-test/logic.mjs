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

import { _log, failureCount } from './logic/harness.mjs';
import { run as run_model_hierarchy } from './logic/model-hierarchy.mjs';
import { run as run_model_paging } from './logic/model-paging.mjs';
import { run as run_model_params } from './logic/model-params.mjs';
import { run as run_knob_input } from './logic/knob-input.mjs';
import { run as run_trigger_badge } from './logic/trigger-badge.mjs';
import { run as run_drums } from './logic/drums.mjs';
import { run as run_seq_engine } from './logic/seq-engine.mjs';
import { run as run_seq_router } from './logic/seq-router.mjs';
import { run as run_seq_edit } from './logic/seq-edit.mjs';
import { run as run_seq_session } from './logic/seq-session.mjs';
import { run as run_set_session } from './logic/set-session.mjs';
import { run as run_seq_leds } from './logic/seq-leds.mjs';
import { run as run_mute_solo } from './logic/mute-solo.mjs';
import { run as run_step_entry } from './logic/step-entry.mjs';
import { run as run_automation } from './logic/automation.mjs';
import { run as run_keyboard } from './logic/keyboard.mjs';
import { run as run_params_pages } from './logic/params-pages.mjs';
import { run as run_envelope } from './logic/envelope.mjs';
import { run as run_set_state } from './logic/set-state.mjs';
import { run as run_lfo } from './logic/lfo.mjs';
import { run as run_filter_viz } from './logic/filter-viz.mjs';
import { run as run_lfo_assign } from './logic/lfo-assign.mjs';
import { run as run_wave_viz } from './logic/wave-viz.mjs';
import { run as run_eq_cut_wav } from './logic/eq-cut-wav.mjs';
import { run as run_graphics } from './logic/graphics.mjs';
import { run as run_wav_peaks } from './logic/wav-peaks.mjs';
import { run as run_module_configs } from './logic/module-configs.mjs';
import { run as run_items_select } from './logic/items-select.mjs';
import { run as run_track_volume } from './logic/track-volume.mjs';
import { run as run_notes_release } from './logic/notes-release.mjs';
import { run as run_step_record } from './logic/step-record.mjs';
import { run as run_undo_core } from './logic/undo-core.mjs';
import { run as run_undo_restore } from './logic/undo-restore.mjs';
import { run as run_undo_params } from './logic/undo-params.mjs';
import { run as run_quantize } from './logic/quantize.mjs';
import { run as run_loop_window } from './logic/loop-window.mjs';
import { run as run_tracks_refs } from './logic/tracks-refs.mjs';
import { run as run_tracks_chain } from './logic/tracks-chain.mjs';
import { run as run_partition } from './logic/partition.mjs';

/* Awaited one at a time: the suites share the mock device globals, and the
 * expected output is a fixed transcript, so they must not interleave. */
const SUITES = [
    run_model_hierarchy,
    run_model_paging,
    run_model_params,
    run_knob_input,
    run_trigger_badge,
    run_drums,
    run_seq_engine,
    run_seq_router,
    run_seq_edit,
    run_seq_session,
    run_set_session,
    run_seq_leds,
    run_mute_solo,
    run_step_entry,
    run_automation,
    run_keyboard,
    run_params_pages,
    run_envelope,
    run_set_state,
    run_lfo,
    run_filter_viz,
    run_lfo_assign,
    run_wave_viz,
    run_eq_cut_wav,
    run_graphics,
    run_wav_peaks,
    run_module_configs,
    run_items_select,
    run_track_volume,
    run_notes_release,
    run_step_record,
    run_undo_core,
    run_undo_restore,
    run_undo_params,
    run_quantize,
    run_loop_window,
    run_tracks_refs,
    run_tracks_chain,
    run_partition,
];

for (const suite of SUITES) await suite();

/* ── Summary ─────────────────────────────────────────────────────────────── */

_log('');
if (failureCount() === 0) {
    _log('\x1b[32m\x1b[1mALL LOGIC CHECKS PASSED\x1b[0m');
    process.exit(0);
} else {
    _log(`\x1b[31m\x1b[1m${failureCount()} LOGIC CHECK(S) FAILED\x1b[0m`);
    process.exit(1);
}
