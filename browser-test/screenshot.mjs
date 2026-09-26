#!/usr/bin/env node
/* browser-test/screenshot.mjs — headless 128×64 framebuffer render + baseline
 * pixel diff. No browser: fill_rect/clear_screen write to an in-memory RGBA
 * framebuffer, the same render functions run as on device, and the frame is
 * PNG-encoded and compared to the committed baselines.
 *
 * The display is 1-bit (a pixel is lit '#d4d0c8' or off '#000000') and every
 * draw is an integer-aligned rect, so the framebuffer reproduces the old
 * canvas captures pixel-for-pixel — the existing baselines are reused as-is.
 *
 * Usage:
 *   node browser-test/screenshot.mjs           # compare (exit 1 on diff)
 *   node browser-test/screenshot.mjs --update   # overwrite baselines
 */

import { trackRef } from '../dist/esm/track/ref.js';
import { componentPort, portFor } from '../dist/esm/track/registry.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { installEnv } from './env.mjs';
import { dumpFixture } from './dump-fixture.mjs';
import { REFRESH_BULK_TICKS } from '../dist/esm/model/constants.js';

/* Quiet the renderer's [movy] mlog chatter; keep our own status lines. */
const _log = console.log.bind(console);
console.log = (...a) => { if (typeof a[0] === 'string' && a[0].startsWith('[movy]')) return; _log(...a); };

const __dir      = dirname(fileURLToPath(import.meta.url));
const BASE_DIR   = join(__dir, 'screenshots', 'baseline');
const ACTUAL_DIR = join(__dir, 'screenshots', 'actual');
const UPDATE     = process.argv.includes('--update');

const PRESETS = [
    'test8', 'test16', 'test_enum', 'test_steps', 'plaits', 'wurl',
    'enum_overlay', 'knob_toast', 'no_params', 'keys_view', 'browse_view',
    'session_booting', 'session_loading', 'session_modules', 'session_preparing',
    'session_migrating', 'session_failed',
    'session_failed_update',
    'versions_empty', 'versions_list', 'versions_confirm',
    'obxd_preset_page', 'obxd_main_page', 'obxd_filter_page',
    'items_cell', 'items_overlay',
    'lfo_prefix', 'collide_osc',
    'chain_synth', 'chain_empty', 'chain_jog_toast', 'knobs_jog_toast',
    'chain_t2', 'chain_t4',
    'lfo_chain', 'lfo_lfo1', 'lfo_lfo2', 'lfo_target_overlay', 'lfo_viz_unipolar', 'lfo_viz_retrig',
    'mix_page', 'mix_page_chain', 'mix_page_two_held',
    'master_send_slot', 'master_send_empty',
    'lfo_master', 'lfo_master_chain',
    'lfo_mod_mark', 'lfo_mod_and_auto', 'lfo_assign_toast',
    'drum-mrdrums-pad5', 'drum-mrdrums-global',
    'chordism-chordb', 'sfz-amp',
    'params-overflow-page', 'params-extras-settings',
    'file_browse',
    'bankbar-mid', 'bankbar-surge', 'bankbar-dense',
    'auto_dot', 'auto_held', 'auto_live', 'auto_limit',
    'step_page_knobs', 'step_page_chain', 'step_indicator', 'step_rec_header',
    'loop_strip_midclip', 'loop_strip_outside', 'loop_header',
    'song_band', 'song_band_overflow', 'song_band_end',
    'main-default', 'main-tempo-touched', 'main-swing-touched',
    'main-root-touched', 'main-key-overlay', 'main-mode-overlay', 'main-layout-overlay',
    'main-ext-sync', 'main-link-on',
    'clip-default', 'clip-fraction', 'clip-overlay', 'clip-drum', 'clip-quant',
    'main-quant', 'quant-overlay-three', 'quant-overlay-two',
    'flags-top', 'flags-scrolled', 'flags-release',
    'cpu-movy-tracks', 'cpu-unsplit-module', 'cpu-overscale', 'cpu-empty',
    'cpu-sends', 'cpu-sends-quiet', 'cpu-ipc-refused',
    'env_dual', 'env_touched', 'env_ad', 'env_asr', 'lfo_mod',
    'filter_lp', 'filter_lp_reso', 'filter_hp', 'filter_bp', 'filter_notch',
    'filter_slope24', 'filter_dual', 'filter_open',
    'deep_page', 'lfo_helm_step', 'lfo_helm_pyramid',
    'signal_voice', 'forge_voice', 'forge_filter', 'forge_mod', 'forge_send', 'forge_mix',
    '8w8_voice', '8w8_master', '8w8_delay', '8w8_chain',
    'leave_modal', 'capture_select', 'capture_fixed',
    'undo_toast', 'redo_toast', 'undo_empty', 'undo_unavailable', 'clip-undo-toast',
    'track_volume_unity', 'track_volume_quiet', 'track_volume_min', 'track_volume_max',
    'trigger_armed', 'trigger_fired', 'trigger_blink_off', 'trigger_touched',
    'trigger_cooling', 'trigger_cooling_low',
    'readouts', 'readout_touched',
    'font_5x3_all', 'font_small_all', 'font_big_all_1', 'font_big_all_2',
    'wave_cells', 'wave_overlay', 'wave_helm', 'wave_toggles',
    'env_stages', 'eq_bands', 'cut_filters', 'faders', 'wav_sample', 'wav_loop', 'wav_loop_off', 'wav_beside_filter',
    'switches', 'pan_dials', 'spray_saturated',
    'page_body', 'page_body_p2', 'page_voice_pad', 'page_sample',
    'page_mod_cell', 'page_mod_cell_held',
    'page_held_lock', 'page_lane_unheld', 'page_held_unassignable',
    'page_chrome_held', 'page_chrome_flip',
    'page_clipparams', 'page_setparams', 'page_stepparams', 'page_master_chain',
    'page_lane_mark', 'page_lane_mark_held',
];

/* The scenes that render Schwung's own body. Only reachable from a bundle built
 * against a checkout — the no-checkout stub throws on import and schwungPageFor
 * raises on top of it — so they are SKIPPED rather than failed without one,
 * which is the repo's rule for a missing checkout: "skipped, not failed"
 * (CLAUDE.md). A set, not an inline `||`, because the runner has to ask before
 * it builds or loads anything; the scenes carry their own guard as well, so a
 * name that drifts out of this set fails loudly instead of rendering a body it
 * cannot. */
const PAGE_SCENES = new Set(['page_body', 'page_body_p2', 'page_voice_pad', 'page_sample',
    'page_mod_cell', 'page_mod_cell_held',
    'page_held_lock', 'page_lane_unheld', 'page_held_unassignable',
    'page_chrome_held', 'page_chrome_flip',
    'page_clipparams', 'page_setparams', 'page_stepparams', 'page_master_chain',
    'page_lane_mark', 'page_lane_mark_held']);

/* Which mock preset backs each (possibly synthetic) screenshot. */
const BASE = {
    enum_overlay: 'plaits', knob_toast: 'test8', no_params: 'no_params',
    keys_view: 'test8', browse_view: 'test8', file_browse: 'test8',
    obxd_preset_page: 'obxd_like', obxd_main_page: 'obxd_like', obxd_filter_page: 'obxd_like',
    items_cell: 'dexed_like', items_overlay: 'dexed_like',
    chain_synth: 'test8', chain_empty: 'test8', chain_jog_toast: 'test8',
    knobs_jog_toast: 'test8', chain_t2: 'test8', chain_t4: 'test8',
    'drum-mrdrums-pad5': 'mrdrums', 'drum-mrdrums-global': 'mrdrums',
    'chordism-chordb': 'chordism', 'sfz-amp': 'sfz',
    'bankbar-mid': 'hier_grouped_pages', 'bankbar-surge': 'hier_surge_pages',
    'bankbar-dense': 'hier_dense_pages',
    'params-overflow-page': 'hier_params_overflow',
    'params-extras-settings': 'hier_params_extras',
    auto_dot: 'test8', auto_held: 'test8', auto_live: 'test8', auto_limit: 'test8',
    /* The page scenes' mocks. `page_mod_cell*` need a page whose first param an
     * LFO can be pointed at; `page_held_unassignable` needs a page only SOME of
     * which can take a lock — `readouts` declares three of its four params
     * `access: "read"`, which is non-automatable by declaration. */
    page_mod_cell: 'test8', page_mod_cell_held: 'test8',
    page_held_lock: 'test8', page_lane_unheld: 'test8',
    page_lane_mark: 'test8', page_lane_mark_held: 'test8',
    page_held_unassignable: 'readouts_hier',
    /* The chrome scenes need the two click kinds that never reach movy — a
     * trigger and a two-way enum — and `switches` is the mock that declares
     * both. */
    page_chrome_held: 'switches', page_chrome_flip: 'switches',
    step_page_knobs: 'test8', step_page_chain: 'test8', step_indicator: 'test8',
    step_rec_header: 'test8',
    loop_strip_midclip: 'test8', loop_strip_outside: 'test8', loop_header: 'test8',
    'main-default': 'test8', 'main-tempo-touched': 'test8',
    'main-swing-touched': 'test8', 'main-root-touched': 'test8',
    'main-key-overlay': 'test8', 'main-mode-overlay': 'test8',
    'main-layout-overlay': 'test8',
    'main-ext-sync': 'test8', 'main-link-on': 'test8',
    'clip-default': 'test8', 'clip-fraction': 'test8', 'clip-overlay': 'test8',
    'clip-drum': 'test8', 'clip-quant': 'test8',
    'quant-overlay-three': 'test8', 'quant-overlay-two': 'test8',
    'flags-top': 'test8', 'flags-scrolled': 'test8', 'flags-release': 'test8',
    trigger_armed: 'triggers', trigger_fired: 'triggers',
    trigger_blink_off: 'triggers', trigger_touched: 'triggers',
    trigger_cooling: 'triggers', trigger_cooling_low: 'triggers',
    readouts: 'readouts', readout_touched: 'readouts',
    env_dual: 'env_dual', env_touched: 'env_dual', env_ad: 'env_ad', env_asr: 'env_asr', lfo_mod: 'lfo_mod',
    filter_lp: 'filter_demo', filter_lp_reso: 'filter_demo', filter_hp: 'filter_demo',
    filter_bp: 'filter_demo', filter_notch: 'filter_demo', filter_slope24: 'filter_demo',
    filter_dual: 'filter_dual', filter_open: 'filter_demo',
    deep_page: 'hier_knobs_and_children',
    lfo_helm_step: 'lfo_helm', lfo_helm_pyramid: 'lfo_helm',
    wave_cells: 'wave_cells', wave_overlay: 'wave_cells', wave_helm: 'helm_waves',
    wave_toggles: 'wave_toggles', env_stages: 'env_stages', eq_bands: 'eq_bands', cut_filters: 'cut_filters',
    faders: 'faders', switches: 'switches', pan_dials: 'pan_dials',
    spray_saturated: 'wav_sample', wav_sample: 'wav_sample', wav_loop: 'wav_loop', wav_loop_off: 'wav_loop',
    wav_beside_filter: 'wav_beside_filter',
    signal_voice: 'signal', forge_voice: 'forge',
    '8w8_master': '8w8', '8w8_voice': '8w8', '8w8_delay': '8w8', '8w8_chain': '8w8',
    forge_filter: 'forge', forge_mod: 'forge', forge_send: 'forge', forge_mix: 'forge',
    lfo_chain: 'test8', lfo_lfo1: 'test8', lfo_lfo2: 'test8',
    lfo_target_overlay: 'test8', lfo_viz_unipolar: 'test8', lfo_viz_retrig: 'test8',
    lfo_mod_mark: 'test8', lfo_mod_and_auto: 'test8', lfo_assign_toast: 'test8',
    leave_modal: 'test8',
    track_volume_unity: 'test8', track_volume_quiet: 'test8',
    track_volume_min: 'test8', track_volume_max: 'test8',
    /* test16, not test8: Schwung plans it into TWO pages ("Main" / "Main - 2"),
     * which is what `page_body_p2` needs and what puts more than one segment in
     * the bank bar. A one-page mock would make the pair identical and the second
     * scene assert nothing. */
    page_body: 'test16', page_body_p2: 'test16',
    /* wav_beside_filter: mrsample's real shape (sample_path + a wav_position
     * marker declaring filepath_param), the same mock schwung-sample.mjs
     * reuses — SP-42 is specifically about THIS cell drawn through Schwung's
     * OWN delegated renderer, not movy's (that path already has baselines:
     * wav_sample/wav_loop/wav_beside_filter above). */
    page_sample: 'wav_beside_filter',
    /* Virtual components (SP-53) — no module port at all, so the mock is
     * irrelevant; movy's own state IS the contract. `test8` only because
     * every OTHER scene needs a named mock and the runner asks for one. */
    page_clipparams: 'test8', page_setparams: 'test8',
    // SP-54: the step page's five cells are the held-trig mirror, never a
    // module's own params — same reasoning as its two Set/Clip Params siblings.
    page_stepparams: 'test8',
    page_master_chain: 'test16',
};

/* MODULES THAT ARE NOT MOCKS. `page_voice_pad`'s subject is a DECLARED drum
 * rack, and the fleet has one: `voice-poc` declares `pad_layout: "drums"` with
 * named voices and a page per voice, so replaying it out of
 * `docs/module-dump/device-dump.json` (`dump-fixture.mjs`) gives the scene a
 * real rack with two different names to choose between. A `drums_hier` mock was
 * written for it first and deleted — its page names were the mock's own
 * invention, so a change to Schwung's naming would have moved the fixture
 * rather than the baseline. */
const DUMP_BASE = { page_voice_pad: 'voice-poc' };

const STEP_VM_A = {
    holdVel: 100, holdGate: 48, holdGateMixed: false,
    holdProb: 40, holdCondA: 2, holdCondB: 3, holdInvert: true,
};
const STEP_VM_B = {
    holdVel: 64, holdGate: 24, holdGateMixed: true,
    holdProb: 100, holdCondA: 1, holdCondB: 1, holdInvert: false,
};

const W = 128, H = 64;
const ON  = [212, 208, 200];   // '#d4d0c8' lit pixel
const OFF = [0, 0, 0];

/* ── Framebuffer-backed display globals ──────────────────────────────────── */

const fb = new Uint8Array(W * H * 4);
function paint(x, y, w, h, rgb) {
    const x0 = Math.max(0, x | 0), y0 = Math.max(0, y | 0);
    const x1 = Math.min(W, (x | 0) + (w | 0)), y1 = Math.min(H, (y | 0) + (h | 0));
    for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
            const i = (yy * W + xx) * 4;
            fb[i] = rgb[0]; fb[i + 1] = rgb[1]; fb[i + 2] = rgb[2]; fb[i + 3] = 255;
        }
    }
}

const env = installEnv();
globalThis.fill_rect    = (x, y, w, h, v) => paint(x, y, w, h, v ? ON : OFF);
globalThis.clear_screen = () => paint(0, 0, W, H, OFF);

/* ── Model + renderers (imported after env so bundled globals resolve) ───── */

const { createModel }      = await import('../dist/esm/model/index.js');
const { createLfoModel, createScopedLfoModel } = await import('../dist/esm/lfo/model.js');
const { createMixModel } = await import('../dist/esm/mixer/mix-model.js');
const { FIELD_AT } = await import('../dist/esm/mixer/mix-io.js');
const { masterScope }      = await import('../dist/esm/lfo/scope.js');
const { resetPorts }       = await import('../dist/esm/track/registry.js');
const { MASTER_FX_SLOTS, MASTER_LFO_INDEX } = await import('../dist/esm/chain/config.js');
const { holdTouch, holdTick, assignToastText, resetAssignMode } = await import('../dist/esm/lfo/assign-mode.js');
const { trackScope } = await import('../dist/esm/lfo/scope.js');
const { drawJogToast }     = await import('../dist/esm/renderer/overlay.js');
const { LONG_PRESS_TICKS } = await import('../dist/esm/model/constants.js');
const { drawLeaveModal }   = await import('../dist/esm/renderer/leave-modal-view.js');
const { drawCaptureOverlay } = await import('../dist/esm/renderer/capture-overlay.js');
const { drawQuantOverlay } = await import('../dist/esm/renderer/quant-overlay.js');
const { renderFlagsView } = await import('../dist/esm/renderer/flags-view.js');
const { renderCpuView }   = await import('../dist/esm/renderer/cpu-view.js');
const { buildCpuPageVM }  = await import('../dist/esm/seq/cpu-page-vm.js');
const { paramSet, resetParamStats } = await import('../dist/esm/host/param.js');
const { buildFlagsPageVM } = await import('../dist/esm/seq/flags-page-vm.js');
const { flagsPageState, resetFlagsPage, flagsRowCount } = await import('../dist/esm/seq/flags-page.js');
const { visibleFlags } = await import('../dist/esm/seq/flags-visible.js');
const { setFlag, resetFlags } = await import('../dist/esm/seq/flags.js');
const { armQuantOverlay, buildQuantOverlayVM, resetQuantOverlay } =
    await import('../dist/esm/seq/quant-overlay.js');
const { drawUndoOverlay } = await import('../dist/esm/renderer/undo-overlay.js');
const { undoToastVM } = await import('../dist/esm/undo/label.js');
const { buildCaptureVM }     = await import('../dist/esm/seq/capture-vm.js');
const { setCaptureStateForTest } = await import('../dist/esm/seq/capture.js');
const { drawVolumeOverlay } = await import('../dist/esm/renderer/volume-overlay.js');
const { volumeFrac }       = await import('../dist/esm/mixer/track-volume.js');
const { renderKnobsView, headerRightText } = await import('../dist/esm/renderer/knob-view.js');
/* The `page` scenes' entry points. Imported here, not statically, for the same
 * reason as every other renderer: the file resolves them after installEnv(). */
const { setSchwungGridMode, schwungPageFor, schwungGridReload } =
    await import('../dist/esm/renderer/schwung-grid.js');
/* The app's own half of the `page` scenes: who owns the page, what body it
 * draws, and the lookup the page asks about modulation. Imported rather than
 * re-derived — a scene that re-implements a condition the app owns stays green
 * with that condition taken out, which is the one thing these have to not do. */
const { pageOwnerOf } = await import('../dist/esm/app/page-owner.js');
/* SP-53's virtual-component owner — the same accessor `midi/router.ts`/
 * `app/tick.ts` use for Set/Clip Params, so a `page_*` scene for either is
 * driven by the real ownership question, not a re-implementation of it. */
const { pageOwnerForComponent } = await import('../dist/esm/app/page-owner-virtual.js');
const { CLIP_PARAMS_COMPONENT, SET_PARAMS_COMPONENT, STEP_PARAMS_COMPONENT } = await import('../dist/esm/chain/config.js');
const { schwungBodyFor, schwungBankFor, schwungChromeFor } = await import('../dist/esm/app/tick.js');
const { modulatedKeysOf } = await import('../dist/esm/app/modulated-keys.js');
const { assignLane, resetAutomation } = await import('../dist/esm/seq/automation.js');
const { stepPageAvailable, stepPageState } = await import('../dist/esm/seq/step-page.js');
const { schwungLibAvailable } = await import('../dist/esm/renderer/schwung-lib.js');
/* The reader the MODEL asks through and the renderer that answers it. `model/`
 * imports nothing from `renderer/`, so the dependency is pushed in —
 * `app/globals.ts` does exactly this line at start-up. Without it `readSurface`
 * answers null, no module can declare a drum rack whatever its hierarchy says,
 * and `vm.drumPadName` is '' for every scene in this file. */
const { setSurfaceReader } = await import('../dist/esm/model/drum-declared.js');
const { surfaceOf }        = await import('../dist/esm/renderer/schwung-voices.js');
const { renderKeysView }   = await import('../dist/esm/renderer/keys-view.js');
const { renderLoadingView } = await import('../dist/esm/renderer/loading-view.js');
const { renderVersionsView } = await import('../dist/esm/renderer/versions-view.js');
const { renderBrowseView } = await import('../dist/esm/renderer/browse-view.js');
const { renderFileBrowseView } = await import('../dist/esm/renderer/file-browse-view.js');
const { renderChainView }  = await import('../dist/esm/renderer/chain-view.js');
const { buildStepPageVM }  = await import('../dist/esm/seq/step-page-vm.js');
const { buildMainPageVM }  = await import('../dist/esm/seq/main-page-vm.js');
const { mainPageState, resetMainPage } = await import('../dist/esm/seq/main-page.js');
const { buildClipPageVM }  = await import('../dist/esm/seq/clip-page-vm.js');
const { clipPageState, resetClipPage } = await import('../dist/esm/seq/clip-page.js');
const { setStepPageSelected, resetStepPage } = await import('../dist/esm/seq/step-page.js');
const { seqState, resetSeqState }      = await import('../dist/esm/seq/state.js');
const { appState }                     = await import('../dist/esm/app/state.js');
const { keyboardState }                = await import('../dist/esm/keyboard/state.js');
const { resetStepRec, stepRecDownAt } = await import('../dist/esm/seq/step-rec.js');
const { stepRecTick }      = await import('../dist/esm/seq/step-rec-view.js');
const { drawSeqHeader, resetSeqHeader, drawLoopStrip, drawLoopHeader, drawSongBand, resetSongBand } =
    await import('../dist/esm/seq/render.js');
const { MOCK_SYNTHS }      = await import('./mock-synth.mjs');
const { fontPrint5x3, fontWidth5x3, FONT5_HEIGHT, CHARS5 } =
    await import('../dist/esm/font/index5x3.js');
const { fontPrint, fontWidth, FONT_HEIGHT } = await import('../dist/esm/font/index.js');
const { fontPrintBig, fontWidthBig, BIG_FONT_HEIGHT } = await import('../dist/esm/font/big.js');

/* Every glyph of one font, wrapped to the 128 px screen. A whole font on one
 * reviewed image is what turns "the 1 looks mirrored" from something you notice
 * on a device months later into a baseline diff: the earlier misdrawn '+', '='
 * and '1' were all in cells nobody had screenshotted. `page` exists because the
 * big font needs more than 64 px of lines. */
function drawFontChart(chars, measure, print, lineH, page = 0) {
    const lines = [];
    let line = '';
    for (const ch of chars) {
        const next = line + ch;
        if (measure(next) > W - 2) { lines.push(line); line = ch; } else { line = next; }
    }
    if (line) lines.push(line);
    const perPage = Math.floor((H - 1) / (lineH + 2));
    const slice = lines.slice(page * perPage, (page + 1) * perPage);
    if (slice.length === 0) throw new Error(`font chart page ${page} is empty (${lines.length} lines)`);
    slice.forEach((l, i) => print(1, 1 + i * (lineH + 2), l, 1));
}

/* Printable ASCII, the range the normal and big fonts index directly. */
const ASCII = Array.from({ length: 0x7E - 0x20 + 1 }, (_, i) => String.fromCharCode(0x20 + i)).join('');

const COMPONENT_KEYS = ['midi_fx1', 'synth', 'fx1', 'fx2'];
const chainModels = COMPONENT_KEYS.map(k => createModel(portFor(0), k));
const model = chainModels[1];   // synth slot — the default knobs view

function loadPreset(id) {
    env.setParams(DUMP_BASE[id] ? dumpFixture(DUMP_BASE[id]) : MOCK_SYNTHS[id]);
    for (const m of chainModels) { m.reset(); m.reload(); }
}

/* ── View renderers (port of harness.mjs __movy_* helpers) ───────────────── */

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const midiName = n => NOTE_NAMES[n % 12] + Math.floor(n / 12 - 1);

function knobsRepaint() { renderKnobsView(model.getViewModel()); }
let lastRender = knobsRepaint;
function forceRender()  { lastRender = knobsRepaint; lastRender(); }

/* Frozen-clock support. The runner settles again after applyView, so a scene that
 * mocks time must STAY mocked through those ticks — otherwise the trigger phase
 * expires against wall-clock time and whether the frame repaints becomes luck.
 * Cleared per scene by the runner. */
const REAL_NOW = Date.now;
let nowOverride = null;
Date.now = () => (nowOverride === null ? REAL_NOW() : nowOverride);

/* Fire knob 0's trigger, then render `afterMs` later on a frozen clock. */
function fireTrigger(afterMs) {
    settle();
    nowOverride = 1_000_000;
    model.handleKnobDelta(0, 1);
    model.tick();
    nowOverride += afterMs;
    forceRender();
}

/* Override synth params on the loaded mock and re-read, then repaint. */
function setFilter(overrides) {
    const patched = { ...env.params };
    for (const [k, v] of Object.entries(overrides)) patched['synth:' + k] = v;
    env.setParams(patched);
    for (const m of chainModels) { m.reset(); m.reload(); }
    forceRender(); settle();
}

/* Each helper sets lastRender so the post-state settle repaints THIS view. */
function showKeys()  { lastRender = () => renderKeysView(model.getModuleName(), 60, midiName); lastRender(); }
function showBrowse(mods, idx) { lastRender = () => renderBrowseView(mods, idx); lastRender(); }
function showChain(chainIndex, jogTouched, activeSlot) {
    const label = 'T' + ((activeSlot ?? 0) + 1);
    lastRender = () => renderChainView(
        chainModels[chainIndex ?? 1].getViewModel(), chainIndex ?? 1, jogTouched ?? false, label);
    lastRender();
}
function showKnobsJogToast() { lastRender = () => renderKnobsView(model.getViewModel(), true); lastRender(); }
function showKnobsAuto(auto) { lastRender = () => renderKnobsView(model.getViewModel(auto)); lastRender(); }
/* Automation snapshot: lane 0 bound to knob 0's param. */
function autoView({ held = false, poolFull = false, assignedLanes = 1, heldVal = null, liveVal = null } = {}) {
    const key = model.getKnobParamInfo(0)?.key;
    const heldValues = new Map();
    if (heldVal !== null) heldValues.set(0, heldVal);
    const liveValues = new Map();
    if (liveVal !== null) liveValues.set(0, liveVal);
    return {
        assignedLanes, activeLanes: 1, held, poolFull, heldValues, liveValues,
        laneForKey: (k) => (k === key ? 0 : -1),
    };
}

/* A real WAV for the sample-waveform scenes: two decaying hits, so the envelope
 * has a shape the eye can check rather than a synthetic ramp, and deliberately
 * mixed low (~-18 dBFS) — the baselines are what prove the graphic normalises
 * a quiet sample to the full height instead of drawing a thin middle line. */
function makeSceneWav() {
    const FR = 120000;
    const bytes = new Uint8Array(44 + FR * 2);
    const ws = (o, t) => { for (let i = 0; i < t.length; i++) bytes[o + i] = t.charCodeAt(i); };
    const w32 = (o, v) => { bytes[o] = v & 255; bytes[o+1] = (v>>8)&255; bytes[o+2] = (v>>16)&255; bytes[o+3] = (v>>>24)&255; };
    const w16 = (o, v) => { bytes[o] = v & 255; bytes[o+1] = (v>>8)&255; };
    ws(0, 'RIFF'); w32(4, 36 + FR * 2); ws(8, 'WAVE');
    ws(12, 'fmt '); w32(16, 16); w16(20, 1); w16(22, 1);
    w32(24, 44100); w32(28, 88200); w16(32, 2); w16(34, 16);
    ws(36, 'data'); w32(40, FR * 2);
    for (let i = 0; i < FR; i++) {
        const t = i / FR;
        const hit = (x) => x < 0 ? 0 : Math.exp(-9 * x);
        const envl = Math.max(hit(t - 0.02), hit(t - 0.55) * 0.7);
        const v = Math.round(Math.sin(i * 0.07) * envl * 4000);
        w16(44 + i * 2, v < 0 ? v + 65536 : v);
    }
    env.setFiles({ '/s/scene.wav': bytes });
}

/* Drive model.tick()+repaint until the render converges (mirrors the old
 * deterministic settle: N clean ticks, or a 200-tick cap). Only the synth
 * model ticks — matching the harness rAF loop — so chain slots that were never
 * ticked render as empty.
 *
 * N is REFRESH_BULK_TICKS + 1, not a flat 5: every track is a movy chain now,
 * and a chain port's background refresh fires once per REFRESH_BULK_TICKS
 * rather than incrementally every tick (a host track's old cadence). A gap
 * between two bulk reads can itself run REFRESH_BULK_TICKS ticks wide with
 * nothing changing, so 5 consecutive quiet ticks can land entirely inside that
 * gap — "converged" right before the one read that would have populated a page
 * just switched to. `obxd_filter_page` shipped every knob reading "..." this
 * way: settle() gave up 8 ticks early. */
function settle() {
    let idle = 0, total = 0;
    const quietFor = REFRESH_BULK_TICKS + 1;
    while (idle < quietFor && total < 200) {
        const dirty = model.tick();
        if (dirty) lastRender();
        idle = dirty ? 0 : idle + 1;
        total++;
    }
}

function applyView(preset) {
    switch (preset) {
        case 'enum_overlay':     model.handleKnobTouch(0); forceRender(); break;
        /* The bank selector at rest: a framed item name in the leftmost cell,
         * with the preset cell beside it. The two must not read alike. */
        case 'items_cell':       settle(); forceRender(); break;
        /* Touching it opens the picker even though the list is short — a plain
         * enum would need more than six options to get one. */
        case 'items_overlay':    settle(); model.handleKnobTouch(0); forceRender(); break;
        case 'knob_toast':       model.handleKnobTouch(2); forceRender(); break;
        case 'keys_view':        showKeys(); break;
        /* The three states movy shows before it is live. The failed one names
         * what broke and what the jog click will do, because that click wipes
         * the Set's sequencer state. */
        case 'session_booting':  lastRender = () => renderLoadingView('booting', ''); lastRender(); break;
        case 'session_loading':  lastRender = () => renderLoadingView('loading', ''); lastRender(); break;
        /* The two halves of settling: the Set is loaded but its modules are
         * still arriving one per audio callback, then the tail where the
         * Set-commit press has the surface. */
        case 'session_modules':  lastRender = () => renderLoadingView('settling', '', 7); lastRender(); break;
        case 'session_preparing': lastRender = () => renderLoadingView('settling', '', 0); lastRender(); break;
        case 'session_migrating':
            lastRender = () => renderLoadingView('settling', '', 0, 'set', true);
            lastRender(); break;
        case 'session_failed':
            lastRender = () => renderLoadingView('failed', 'SET FILE UNREADABLE', 0, 'set');
            lastRender(); break;
        /* The other failure, and it must not look like the one above: nothing
         * is wrong with the set, and no button here wipes anything. */
        case 'session_failed_update':
            lastRender = () => renderLoadingView('failed', 'MOVY WAS UPDATED', 0, 'engine');
            lastRender(); break;
        case 'versions_empty':
            lastRender = () => renderVersionsView(
                { rows: [], selected: 0, confirming: false, empty: true });
            lastRender(); break;
        case 'versions_list':
            lastRender = () => renderVersionsView({
                rows: [
                    /* The widest age label beside a wide reason — the pair that
                     * used to read as one word, "JUST NOWPRE-UNDO", when the
                     * reason column started at 41. WHY_X is what keeps them apart. */
                    { age: 'JUST NOW', why: 'PRE-UNDO',   clips: '6 CLIPS', seqOnly: false },
                    { age: '18M AGO',  why: 'AUTOSAVE',   clips: '6 CLIPS', seqOnly: false },
                    { age: '1H AGO',   why: 'PRE-WIPE',   clips: '6 CLIPS', seqOnly: false },
                    { age: '3H AGO',   why: 'AUTOSAVE',   clips: '4 CLIPS', seqOnly: false },
                    { age: 'OLDEST',   why: 'FOUND',      clips: '5 CLIPS', seqOnly: true  },
                    { age: '2D AGO',   why: 'ON EXIT',    clips: '5 CLIPS', seqOnly: false },
                ], selected: 2, confirming: false, empty: false });
            lastRender(); break;
        /* The confirm must say what a restore does NOT cover — Schwung's own
         * four track slots live in Move's set file, out of movy's reach. */
        case 'versions_confirm':
            lastRender = () => renderVersionsView({
                rows: [{ age: '2M AGO', why: 'OPENED', clips: '6 CLIPS', seqOnly: false }],
                selected: 0, confirming: true, empty: false });
            lastRender(); break;
        case 'browse_view':      showBrowse([{ name: 'Plaits' }, { name: 'Wurl' }, { name: 'Bass' }], 1); break;
        /* The other browser: the one a FILE parameter opens, which is what "hold
         * the knob and click the jog" lands on. The cursor sits on a file rather
         * than the ".." row so the selection bar is over a loadable entry. */
        case 'file_browse':
            lastRender = () => renderFileBrowseView({
                paramSlot: 0, componentKey: 'synth', paramKey: 'sample', gi: 12,
                root: '/data/UserData/UserLibrary/Samples',
                filter: ['.wav', '.aif'],
                currentDir: '/data/UserData/UserLibrary/Samples/Drums',
                items: [
                    { name: '..', path: '/data/UserData/UserLibrary/Samples', isDir: true },
                    { name: 'Breaks', path: '/data/UserData/UserLibrary/Samples/Drums/Breaks', isDir: true },
                    { name: 'Kick Tight A.wav', path: '/x/Kick Tight A.wav', isDir: false },
                    { name: 'Kick Tight B.wav', path: '/x/Kick Tight B.wav', isDir: false },
                    { name: 'Snare Rim C.wav',  path: '/x/Snare Rim C.wav',  isDir: false },
                    { name: 'Tom Low D.wav',    path: '/x/Tom Low D.wav',    isDir: false },
                ],
                selectedIndex: 2,
            });
            lastRender(); break;
        /* Trigger badge phases. Time is frozen so the fired flash and two drain
         * positions are deterministic; the drain is what makes the re-arm
         * debounce visible, so it needs more than one sample pinned. */
        /* Knob 2 is the only turnable param on the page, so a shot with knob 0
         * touched shows a dotted frame and a filled label cell together —
         * touching a readout is allowed, turning it is not. */
        case 'readouts':            settle(); forceRender(); break;
        case 'readout_touched':     settle(); model.handleKnobTouch(0); forceRender(); break;
        case 'trigger_armed':       settle(); forceRender(); break;
        case 'trigger_fired':       fireTrigger(0); break;
        case 'trigger_blink_off':   fireTrigger(60); break;   // second half of the blink
        case 'trigger_touched':     settle(); model.handleKnobTouch(0); forceRender(); break;
        case 'trigger_cooling':     fireTrigger(250); break;
        case 'trigger_cooling_low': fireTrigger(620); break;
        /* Font charts: every glyph of each font, reviewed as pixels. The 5x3 one
         * also pins the signed/numeric strings the step cells draw, which is
         * where a swallowed minus and a top-aligned '+' were found. */
        case 'font_5x3_all':
            clear_screen();
            drawFontChart(CHARS5, fontWidth5x3, fontPrint5x3, FONT5_HEIGHT);
            fontPrint5x3(1, 3 * (FONT5_HEIGHT + 2) + 1, '-3 +2 -1 0 12 128', 1);
            break;
        case 'font_small_all':
            clear_screen();
            drawFontChart(ASCII, (s) => fontWidth(s), (x, y, s, c) => fontPrint(x, y, s, c), FONT_HEIGHT);
            break;
        case 'font_big_all_1':
            clear_screen();
            drawFontChart(ASCII, fontWidthBig, fontPrintBig, BIG_FONT_HEIGHT, 0);
            break;
        case 'font_big_all_2':
            clear_screen();
            drawFontChart(ASCII, fontWidthBig, fontPrintBig, BIG_FONT_HEIGHT, 1);
            break;
        case 'env_dual':    forceRender(); break;
        case 'env_touched': model.handleKnobTouch(2); forceRender(); break;   // touch Sustain
        case 'env_ad':      forceRender(); break;
        case 'env_asr':     forceRender(); break;
        case 'lfo_mod':     forceRender(); break;
        /* Deepest nested page name movy can produce ("Oper1/Envelope") — the
         * header shares 128 px with the module name, so this is reviewed as
         * pixels rather than assumed to fit. */
        case 'deep_page':   model.changePage(3); forceRender(); break;
        /* Waveform silhouettes on single knobs. Values are pinned per shot (the
         * mock's own defaults do not survive the runner's reload) so each cell
         * shows a DIFFERENT glyph: flat Off, saw, square and pulse side by side
         * make the duty-cycle difference and the straight risers reviewable. */
        case 'wave_cells':
            setFilter({
                wave_1: '0', wave_2: '3', wave_3: '4', wave_4: '5',
                osc_wave: '1', mod_shape: '5', vca_mode: '0', level: '0.60',
            });
            /* settle() stops after 5 idle ticks, but the round-robin value
             * refresh does not mark every tick dirty — so how far it has got
             * depends on the state the PREVIOUS scene left behind. Tick a fixed
             * count here instead: this scene is entirely about which glyph each
             * value selects, so it must not render half-refreshed. */
            for (let i = 0; i < 120; i++) model.tick();
            forceRender();
            break;
        /* Same list with the overlay open on knob 0, so the glyph gutter, the
         * inverted glyph on the selected row and the flat "Off" entry are all
         * in one shot. Long-press is 172 ticks, so the hold is driven
         * explicitly rather than left to settle()'s idle heuristic. */
        case 'wav_beside_filter': {
            makeSceneWav();
            setFilter({ sample_start: '0.45' });
            for (let i = 0; i < 300; i++) model.tick();
            forceRender();
            break;
        }
        case 'wav_loop':
        case 'wav_loop_off': {
            makeSceneWav();
            setFilter(preset === 'wav_loop_off' ? { loop_mode: '0' } : { loop_mode: '1' });
            for (let i = 0; i < 300; i++) model.tick();
            forceRender();
            break;
        }
        case 'wav_sample': {
            makeSceneWav();
            setFilter({ position: '0.42' });
            /* Enough ticks for the chunked read to finish (19 blocks, 2/tick). */
            for (let i = 0; i < 300; i++) model.tick();
            forceRender();
            break;
        }
        case 'spray_saturated':
            /* Past 0.5 the region already covers the whole file, so the fences
             * sit on the edges and stop moving — granny's offset wraps, so a
             * wider spread reaches no new frames. */
            setFilter({ position: '0.2', spray: '0.6' });
            for (let i = 0; i < 300; i++) model.tick();
            forceRender();
            break;
        case 'switches':
            setFilter({ osc2_sync: '1', legato: 'Off', unison: '0', bypass: 'on',
                        lfo_mode: 'Sync', rnd_patch: '0', cutoff: '0.5', voice_mode: 'Poly' });
            for (let i = 0; i < 80; i++) model.tick();
            forceRender();
            break;
        case 'pan_dials':
            /* The whole sweep in one frame — hard left, part left, centre,
             * part right, hard right — beside the two near-misses that keep
             * the arc. A single value would not show that the bar travels. */
            for (let i = 0; i < 80; i++) model.tick();
            forceRender();
            break;
        case 'faders':
            setFilter({ volume: '0.75', gain: '0.3', lvl_snare: '1.0', sub_level: '0',
                        trim_db: '0', pre_gain: '-9', cutoff: '0.5', rate: '0.4' });
            for (let i = 0; i < 80; i++) model.tick();
            forceRender();
            break;
        case 'cut_filters':
            setFilter({
                high_cut: '0.75', low_cut: '0.25', mix: '0.5', width: '0.5',
                hpf: '0.4', lpf_only: '0.6', hp_slope: '0.5', hpf_mg: '0',
            });
            for (let i = 0; i < 120; i++) model.tick();
            forceRender();
            break;
        case 'eq_bands':
            setFilter({
                eq_lo: '9', eq_mid: '-6', eq_hi: '7', trim: '0',
                drv_body: '3', drv_air: '-5', low_xo: '600', high_xo: '4000',
            });
            for (let i = 0; i < 120; i++) model.tick();
            forceRender();
            break;
        case 'env_stages':
            setFilter({
                decay: '0.15', mod_decay: '0.45', all_decay: '0.75', lpg_decay: '1.0',
                attack: '0.30', soft_attack: '0.80', decay_rnd: '0.50', rev_decay: '0.50',
            });
            for (let i = 0; i < 120; i++) model.tick();
            forceRender();
            break;
        case 'wave_toggles':
            setFilter({
                osc1_saw: '1', osc1_pulse: '0', osc2_saw: '0', osc2_pulse: '1',
                lfo_sin: '1', lfo_square: '0', mute_noise: '1', cutoff: '0.60',
            });
            for (let i = 0; i < 120; i++) model.tick();
            forceRender();
            break;
        case 'wave_helm':
            setFilter({
                w_step3: '5', w_step4: '6', w_step8: '7', w_sawup: '4',
                w_pyr3: '8', w_pyr5: '9', w_pyr9: '10', w_tri: '1',
            });
            for (let i = 0; i < 120; i++) model.tick();
            forceRender();
            break;
        case 'wave_overlay':
            setFilter({
                wave_1: '4', wave_2: '3', wave_3: '4', wave_4: '5',
                osc_wave: '1', mod_shape: '5', vca_mode: '0', level: '0.60',
            });
            for (let i = 0; i < 120; i++) model.tick();
            model.handleKnobTouch(0);
            for (let i = 0; i < LONG_PRESS_TICKS + 10; i++) model.tick();
            forceRender();
            break;
        case 'lfo_helm_step':    forceRender(); break;                       // "8 Step" → stepped ramp
        case 'lfo_helm_pyramid': setFilter({ mono_lfo_1_waveform: '9' }); break;  // "5 Pyramid" → stepped triangle
        case 'filter_lp':      forceRender(); break;                         // demo defaults: LP, reso 0.30
        case 'filter_lp_reso': setFilter({ resonance: '0.90' }); break;      // high resonance bump
        case 'filter_hp':      setFilter({ mode: '1' }); break;
        case 'filter_bp':      setFilter({ mode: '2' }); break;
        case 'filter_notch':   setFilter({ mode: '3' }); break;
        case 'filter_slope24': setFilter({ resonance: '0.70', slope: '1' }); break;
        case 'filter_dual':    forceRender(); break;
        case 'filter_open':    setFilter({ cutoff: '1.0', resonance: '0.05' }); break;   // fully open — corner still visible
        // Pad-selected voice bank (padSpecific page 0) — pad-grid icon in header.
        case 'signal_voice':   model.updateDrumPad(2, 37); settle(); forceRender(); break;
        case 'forge_voice':    model.updateDrumPad(3, 38); settle(); forceRender(); break;
        // Explicit filter:/lfo: tags in forge's movy-layout → curve / waveform.
        case 'forge_filter':   model.updateDrumPad(3, 38); model.changePage(1); settle(); forceRender(); break;
        case 'forge_mod':      model.updateDrumPad(3, 38); model.changePage(3); settle(); forceRender(); break;
        case 'forge_send':     model.updateDrumPad(3, 38); model.changePage(5); settle(); forceRender(); break; // per-voice sends + pan
        case 'forge_mix':      model.changePage(8); settle(); forceRender(); break;   // Mix bank: vbar faders
        /* A kit with a page PER voice and the pad choosing among them. No bank
         * re-targets, so the pad-grid icon is the only thing on screen saying
         * which voice is under the knobs — and the rotation collapses nineteen
         * banks to a FOUR-dot bank bar, the voice slot sitting second and
         * wearing the selected voice's own name. */
        case '8w8_voice':  model.updateDrumPad(11, 46); model.selectBankForPad(11); settle(); forceRender(); break;
        case '8w8_delay':  model.changePage(2); settle(); forceRender(); break;
        case '8w8_master': model.changePage(3); settle(); forceRender(); break;
        /* The same voice page on the CHAIN view, where the icon has to appear
         * too — that is where you land after a slot change, and an icon on only
         * one of the two reads as the voice selection having been lost. */
        case '8w8_chain':  model.updateDrumPad(11, 46); model.selectBankForPad(11);
                           settle(); showChain(1, false); break;
        case 'obxd_preset_page': forceRender(); break;                       // page 0
        case 'obxd_main_page':   model.changePage(1); forceRender(); break;
        case 'obxd_filter_page': model.changePage(3); forceRender();
        break;
        case 'chain_synth':      showChain(1, false); break;
        case 'chain_empty':      showChain(2, false); break;                 // fx1 = empty
        case 'chain_jog_toast':  showChain(1, true); break;
        case 'knobs_jog_toast':  showKnobsJogToast(); break;
        /* Post-capture overlay, both variants, over the view it interrupts. */
        /* The quantize panel over the Clip Params page: it is a strip, not a
         * takeover, so the page underneath has to survive. `three` puts the
         * selection on the default, where box and DEF marker coincide — the
         * common case. */
        case 'quant-overlay-three':
        case 'quant-overlay-two': {
            resetSeqState(); resetClipPage();
            seqState.clipScaleIdx = 4; seqState.lenSteps = 16; seqState.clipTranspose = 0;
            const three = preset === 'quant-overlay-three';
            seqState.defaultQuant = three ? 70 : 0;
            seqState.clipQuant = three ? 70 : 100;
            armQuantOverlay(Date.now());
            lastRender = () => {
                renderKnobsView(buildClipPageVM(), false, 0);
                drawQuantOverlay(buildQuantOverlayVM());
            };
            lastRender();
            break;
        }
        /* The Settings page, in the debug arrangement: every flag listed. Two
         * states, because the value column, the selection band and the scroll
         * window are what the page IS — `top` has the selection on row 0 with
         * the list unscrolled, `scrolled` puts it on the LAST row (an action
         * row — the table is only two flags deep now that the schwung host is
         * gone), with values that are not the defaults so a row whose value
         * stopped tracking its flag shows up as a diff. */
        case 'flags-top':
        case 'flags-scrolled': {
            resetFlags(); resetFlagsPage();
            const scrolled = preset === 'flags-scrolled';
            setFlag('setcommit', scrolled ? 0 : 1);
            setFlag('schwunggrid', scrolled ? 1 : 0);
            flagsPageState.selected = scrolled ? flagsRowCount() - 1 : 0;
            lastRender = () => renderFlagsView(buildFlagsPageVM());
            lastRender();
            break;
        }
        /* And the arrangement that actually SHIPS: the one flag a release
         * build lists (Param Pages) above the action rows. The debug scenes
         * above cannot cover this — they render the list this
         * build has compiled in, which is every flag. */
        case 'cpu-movy-tracks':
        case 'cpu-unsplit-module':
        case 'cpu-overscale':
        case 'cpu-empty':
        /* The page's SECOND layout: any send bus holding a module narrows every
         * track column to make room for the send region. Two scenes because the
         * region has to say which of its three buses is doing work — `cpu-sends`
         * has one heavy and one light bus, `cpu-sends-quiet` has a loaded bus
         * nothing is feeding, which must read as asleep-with-a-peak rather than
         * as empty. */
        case 'cpu-sends':
        case 'cpu-sends-quiet':
        /* Writes the single-slot param SHM refused. Drawn ONLY when there were
         * some, which is why it needs a baseline of its own: every other CPU
         * baseline is the proof that a healthy channel adds nothing to the page. */
        case 'cpu-ipc-refused': {
            resetFlags();
            /* Every column inside the 1 ms floor, so `cpu-overscale` is the
             * only baseline where the scale has had to GROW — otherwise the two
             * scenes differ by nothing and neither pins it. */
            const live = [
                '240/180/310', '370/300/450', '900/760/980', '820/620/910',
                '250/200/300', '320/320/400', '180/140/220', '670/560/790',
            ];
            /* A chain whose module cannot split renders in ONE call, so the
             * synth stage IS the total and there is no FX segment. */
            const unsplit = live.map((t) => {
                const [total, , peak] = t.split('/');
                return `${total}/${total}/${peak}`;
            });
            /* One chain well past the floor. The plot must re-scale so this
             * column's real height is visible and every other column shrinks
             * with it — the failure this replaced was a 1.6 ms chain and a
             * 2.5 ms chain drawing as the same clamped bar. */
            const over = live.slice();
            over[2] = '2400/1900/2600';
            const rows = (preset === 'cpu-overscale' ? over
                : preset === 'cpu-unsplit-module' ? unsplit : live).slice();
            /* Chain 8 is the sleeping one (mask 0100). Giving it a held peak is
             * what pins that a chain which spiked and then went quiet still
             * shows what it did — the dash alone would hide it. */
            rows[8] = '0/0/620';
            if (preset === 'cpu-empty') {
                seqState.cpuCost = ''; seqState.cpuWall = ''; seqState.cpuMask = '';
            } else {
                seqState.cpuCost = rows.concat(Array(16 - rows.length).fill('0/0/0')).join(',');
                seqState.cpuWall = preset === 'cpu-overscale' ? '2210/2680/2902' : '1491/2180/2902';
                seqState.cpuMask = '01ff/0100';
            }
            seqState.cpuSend =
                preset === 'cpu-sends' ? '760/1180,190/240,-'
                : preset === 'cpu-sends-quiet' ? '0/1180,-,-'
                : '-,-,-';
            resetParamStats();
            if (preset === 'cpu-ipc-refused') {
                const saved = globalThis.host_module_set_param_blocking;
                globalThis.host_module_set_param_blocking = () => false;
                for (let i = 0; i < 7; i++) paramSet('cmd', 'stop');
                globalThis.host_module_set_param_blocking = saved;
            }
            lastRender = () => renderCpuView(buildCpuPageVM());
            lastRender();
            break;
        }
        case 'flags-release': {
            resetFlags(); resetFlagsPage();
            flagsPageState.selected = 0;         // Param Pages, the one release flag
            lastRender = () => renderFlagsView(buildFlagsPageVM(visibleFlags(false)));
            lastRender();
            break;
        }
        case 'capture_select':
        case 'capture_fixed': {
            showChain(1, false);
            setCaptureStateForTest(preset === 'capture_select'
                ? { overlay: 'select', cands: [85, 120, 170], idx: 1, detected: 120, bpm: 120, bars: 4 }
                : { overlay: 'fixed', cands: [], idx: 0, detected: 117, bpm: 120,
                    why: 'ext', bars: 2, stretchPermille: 26 });
            lastRender = () => drawCaptureOverlay(buildCaptureVM());
            lastRender();
            break;
        }
        /* Undo toast, over the view it interrupts. Covers a success with a full
         * three-line label, a redo, and both failure shapes. */
        case 'undo_toast':
        case 'redo_toast':
        case 'undo_empty':
        case 'undo_unavailable': {
            showChain(1, false);
            const base = lastRender;
            const r = preset === 'undo_toast'
                ? { ok: true, verb: 'CLEAR CLIP', target: 'T2 CLIP 3', detail: '12 NOTES' }
                : preset === 'redo_toast'
                ? { ok: true, verb: 'CUTOFF', target: 'T1', detail: '0.42 -> 0.31' }
                : preset === 'undo_empty'
                ? { ok: false, verb: '', target: '', detail: '', reason: 'empty' }
                : { ok: false, verb: '', target: '', detail: '', reason: 'drift' };
            const vm = undoToastVM(r, preset === 'redo_toast');
            lastRender = () => { base(); drawUndoOverlay(vm); };
            lastRender();
            break;
        }
        case 'leave_modal': {
            showChain(1, false);
            const base = lastRender;
            lastRender = () => { base(); drawLeaveModal(['Background', 'Close Movy'], 0); };
            lastRender();
            break;
        }
        /* Track-volume slider over the chain view it is invoked from. */
        case 'track_volume_unity':
        case 'track_volume_quiet':
        case 'track_volume_min':
        case 'track_volume_max': {
            const vol = preset === 'track_volume_min' ? 0
                : preset === 'track_volume_max' ? 4
                : preset === 'track_volume_quiet' ? 10 ** (-9 / 20)   // the field report's range
                : 1;
            const trk = preset === 'track_volume_unity' ? 1 : 0;
            showChain(1, false, trk);
            const base = lastRender;
            const vm = { track: trk, value: vol, frac: volumeFrac(vol), unityFrac: volumeFrac(1) };
            lastRender = () => { base(); drawVolumeOverlay(vm); };
            lastRender();
            break;
        }
        case 'chain_t2':         showChain(1, false, 1); break;
        case 'chain_t4':         showChain(1, false, 3); break;
        case 'drum-mrdrums-pad5':   model.tick(); model.tick(); model.updateDrumPad(5, 76); forceRender(); break;
        case 'drum-mrdrums-global': model.tick(); model.tick(); model.changePage(2); forceRender(); break;  // Main/Rand/Global
        // Page indicator with many pages: 25 pages still get a gap between
        // segments, 70 pages drop it so each page keeps a pixel.
        case 'bankbar-mid':   for (let i = 0; i < 12; i++) model.changePage(1); forceRender(); break;
        case 'bankbar-surge': for (let i = 0; i < 26; i++) model.changePage(1); forceRender(); break;
        case 'bankbar-dense': for (let i = 0; i < 40; i++) model.changePage(1); forceRender(); break;
        // Overflow page: the " - 2" header and a full row of params[] extras.
        case 'params-overflow-page':   model.changePage(1); forceRender(); break;
        // A level with NO knobs[] at all now gets a page from its params[].
        case 'params-extras-settings': model.changePage(2); forceRender(); break;
        case 'chordism-chordb':     model.changePage(8); forceRender(); break;  // Chord B bank (top 4 pitch classes)
        case 'sfz-amp':             forceRender(); break;                       // Amp bank: ADSR graphic + cutoff/reso
        case 'auto_dot':         showKnobsAuto(autoView()); break;
        case 'auto_held':        showKnobsAuto(autoView({ held: true, heldVal: model.getKnobParamInfo(0).max })); break;
        case 'auto_live':        showKnobsAuto(autoView({ held: false, liveVal: model.getKnobParamInfo(0).max })); break;
        case 'auto_limit':       showKnobsAuto(autoView({ held: true, poolFull: true, assignedLanes: 0xFF })); break;
        case 'step_page_knobs':  lastRender = () => renderKnobsView(buildStepPageVM(STEP_VM_A, 4), false, 0); lastRender(); break;
        case 'step_page_chain':  lastRender = () => renderChainView(buildStepPageVM(STEP_VM_B), 1, false, 'T1'); lastRender(); break;
        case 'step_rec_header': {
            // Rec held: the band sits over a live param page, which stays
            // readable so the sound can be shaped while the part goes in.
            resetSeqState(); resetStepRec(); resetSeqHeader();
            seqState.playing = false; seqState.lenSteps = 16;
            stepRecDownAt(1000);
            seqState.holdNotes = [60, 64, 67];
            stepRecTick();
            lastRender = () => { renderKnobsView(model.getViewModel()); drawSeqHeader(); };
            lastRender();
            break;
        }
        case 'song_band': {
            // Session view with a four-scene song, playing the doubled second
            // scene: `SONG 1 2 2 3` with both 2s boxed as one entry.
            resetSeqState(); resetSongBand();
            seqState.sessionMode = true;
            seqState.songScenes = [0, 1, 1, 2];
            seqState.songPos = 1;
            seqState.session[0].exist = 0b111;   // scenes 1-3 all have clips
            lastRender = () => { renderKnobsView(model.getViewModel()); drawSongBand(); };
            lastRender();
            break;
        }
        case 'song_band_overflow': {
            // A song longer than the row: the window keeps the current entry
            // and the next one on screen behind a leading ellipsis.
            resetSeqState(); resetSongBand();
            seqState.sessionMode = true;
            seqState.songScenes = [
                0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3, 4, 5, 6, 7,
                0, 1, 2, 3, 4, 5, 6, 7, 0, 1,
            ];
            seqState.songPos = 22;
            seqState.session[0].exist = 0xff;    // every scene has a clip
            lastRender = () => { renderKnobsView(model.getViewModel()); drawSongBand(); };
            lastRender();
            break;
        }
        case 'song_band_end': {
            // Parked on an empty scene: the arrangement has ended, and says so.
            // The transport keeps running — this is a stop in the song only.
            resetSeqState(); resetSongBand();
            seqState.sessionMode = true;
            seqState.songScenes = [0, 1, 2];
            seqState.songPos = 2;
            seqState.session[0].exist = 0b011;   // nothing in scene 3
            lastRender = () => { renderKnobsView(model.getViewModel()); drawSongBand(); };
            lastRender();
            break;
        }
        case 'loop_header': {
            // Loop mode over a live param page: readout band on top, strip below.
            // The band replaces a 0.3s flash that left no indication of the window.
            resetSeqState(); resetSeqHeader();
            seqState.loopMode = true;
            seqState.loopStart = 32; seqState.lenSteps = 32; seqState.barOffset = 2;
            lastRender = () => {
                renderKnobsView(model.getViewModel());
                drawLoopHeader(); drawLoopStrip();
            };
            lastRender();
            break;
        }
        case 'loop_strip_midclip': {
            // Loop = bars 3-4, viewing bar 3, playing: the segments sit on the
            // active bars and the sweep stays inside them. Reading lenSteps as a
            // bar count used to draw this at bars 1-2 with the sweep pinned right.
            resetSeqState();
            seqState.loopStart = 32; seqState.lenSteps = 32; seqState.barOffset = 2;
            seqState.playing = true; seqState.posTick = 40 * 24;
            lastRender = () => { renderKnobsView(model.getViewModel()); drawLoopStrip(); };
            lastRender();
            break;
        }
        case 'loop_strip_outside': {
            // Navigated a bar past a mid-clip loop: a "+" leads out to it.
            resetSeqState();
            seqState.loopStart = 32; seqState.lenSteps = 32; seqState.barOffset = 4;
            lastRender = () => { renderKnobsView(model.getViewModel()); drawLoopStrip(); };
            lastRender();
            break;
        }
        case 'step_indicator': {
            // Module page during a session: dotted leading segment, not selected.
            lastRender = () => {
                const vm = model.getViewModel();
                vm.stepPagePresent = true; vm.stepPageSelected = false;
                renderKnobsView(vm, false, 0);
            };
            lastRender();
            break;
        }
        case 'main-quant': {         // set default quantization at 70%
            resetSeqState(); resetMainPage();
            keyboardState.rootPc = 0; keyboardState.octave = [4, 4, 4, 4];
            keyboardState.mode = 0; keyboardState.layout = 0; keyboardState.scale = 0;
            seqState.bpmX100 = 12000; seqState.swingPct = 50;
            seqState.defaultQuant = 70;
            mainPageState.touchedKnob = 3;
            lastRender = () => renderKnobsView(buildMainPageVM(), false, 0);
            lastRender();
            break;
        }
        case 'main-default': {
            resetSeqState(); resetMainPage();
            keyboardState.rootPc = 0; keyboardState.octave = [4, 4, 4, 4];
            keyboardState.mode = 0; keyboardState.layout = 0; keyboardState.scale = 0;
            seqState.bpmX100 = 12000; seqState.swingPct = 50;
            lastRender = () => renderKnobsView(buildMainPageVM(), false, 0);
            lastRender();
            break;
        }
        case 'main-tempo-touched': {
            resetSeqState(); resetMainPage();
            keyboardState.rootPc = 0; keyboardState.octave = [4, 4, 4, 4];
            keyboardState.mode = 0; keyboardState.layout = 0; keyboardState.scale = 0;
            seqState.bpmX100 = 12000; seqState.swingPct = 50;
            mainPageState.touchedKnob = 0;
            lastRender = () => renderKnobsView(buildMainPageVM(), false, 0);
            lastRender();
            break;
        }
        case 'main-swing-touched': {
            resetSeqState(); resetMainPage();
            keyboardState.rootPc = 0; keyboardState.octave = [4, 4, 4, 4];
            keyboardState.mode = 0; keyboardState.layout = 0; keyboardState.scale = 0;
            seqState.bpmX100 = 12000; seqState.swingPct = 50;
            mainPageState.touchedKnob = 1;
            lastRender = () => renderKnobsView(buildMainPageVM(), false, 0);
            lastRender();
            break;
        }
        case 'main-root-touched': {
            resetSeqState(); resetMainPage();
            keyboardState.rootPc = 3; keyboardState.octave = [4, 4, 4, 4];
            keyboardState.mode = 0; keyboardState.layout = 0; keyboardState.scale = 0;   // D#
            seqState.bpmX100 = 12000; seqState.swingPct = 50;
            mainPageState.touchedKnob = 4;
            lastRender = () => renderKnobsView(buildMainPageVM(), false, 0);
            lastRender();
            break;
        }
        case 'main-key-overlay': {
            resetSeqState(); resetMainPage();
            keyboardState.rootPc = 0; keyboardState.octave = [4, 4, 4, 4];
            keyboardState.mode = 0; keyboardState.layout = 0; keyboardState.scale = 0;
            seqState.bpmX100 = 12000; seqState.swingPct = 50;
            mainPageState.overlayKnob = 5; mainPageState.overlaySel = 1;
            lastRender = () => renderKnobsView(buildMainPageVM(), false, 0);
            lastRender();
            break;
        }
        case 'main-mode-overlay': {
            resetSeqState(); resetMainPage();
            keyboardState.rootPc = 0; keyboardState.octave = [4, 4, 4, 4];
            keyboardState.mode = 0; keyboardState.layout = 0; keyboardState.scale = 0;
            seqState.bpmX100 = 12000; seqState.swingPct = 50;
            mainPageState.overlayKnob = 6; mainPageState.overlaySel = 1;
            lastRender = () => renderKnobsView(buildMainPageVM(), false, 0);
            lastRender();
            break;
        }
        case 'main-layout-overlay': {
            resetSeqState(); resetMainPage();
            keyboardState.rootPc = 0; keyboardState.octave = [4, 4, 4, 4];
            keyboardState.mode = 1; keyboardState.layout = 0; keyboardState.scale = 0;  // In Key: 4ths/Inline
            seqState.bpmX100 = 12000; seqState.swingPct = 50;
            mainPageState.overlayKnob = 7; mainPageState.overlaySel = 1;
            lastRender = () => renderKnobsView(buildMainPageVM(), false, 0);
            lastRender();
            break;
        }
        case 'main-ext-sync': {      // following Move: tempo cell shows EXT
            resetSeqState(); resetMainPage();
            keyboardState.rootPc = 0; keyboardState.octave = [4, 4, 4, 4];
            keyboardState.mode = 0; keyboardState.layout = 0; keyboardState.scale = 0;
            seqState.bpmX100 = 12500; seqState.swingPct = 50;
            seqState.extSync = true;
            lastRender = () => renderKnobsView(buildMainPageVM(), false, 0);
            lastRender();
            break;
        }
        case 'main-link-on': {       // Play-link enabled: LINK cell shows ON
            resetSeqState(); resetMainPage();
            keyboardState.rootPc = 0; keyboardState.octave = [4, 4, 4, 4];
            keyboardState.mode = 0; keyboardState.layout = 0; keyboardState.scale = 0;
            seqState.linkEnabled = true;
            lastRender = () => renderKnobsView(buildMainPageVM(), false, 0);
            lastRender();
            break;
        }
        case 'clip-default': {       // 1X / len 16 / transpose 0
            resetSeqState(); resetClipPage();
            seqState.clipScaleIdx = 4; seqState.lenSteps = 16; seqState.clipTranspose = 0;
            lastRender = () => renderKnobsView(buildClipPageVM(), false, 0);
            lastRender();
            break;
        }
        /* The undo toast over the Clip Params page: it is drawn after every view
         * branch, so a page that is not the chain view still shows it. */
        case 'clip-undo-toast': {
            resetSeqState(); resetClipPage();
            seqState.clipScaleIdx = 4; seqState.lenSteps = 16; seqState.clipTranspose = 0;
            const vm = undoToastVM(
                { ok: true, verb: 'CLIP LENGTH', target: 'T1', detail: '16 -> 9' }, false);
            lastRender = () => { renderKnobsView(buildClipPageVM(), false, 0); drawUndoOverlay(vm); };
            lastRender();
            break;
        }
        /* QUANT dialled off both ends of its list, with its toast up: proves the
         * enum index and the '%' display, which a 0% cell cannot. */
        case 'clip-quant': {
            resetSeqState(); resetClipPage();
            seqState.clipScaleIdx = 4; seqState.lenSteps = 16; seqState.clipTranspose = 0;
            seqState.clipQuant = 70;
            clipPageState.touchedKnob = 3;
            lastRender = () => renderKnobsView(buildClipPageVM(), false, 0);
            lastRender();
            break;
        }
        case 'clip-fraction': {      // stacked 1/4 scale, length 9, transpose -5
            resetSeqState(); resetClipPage();
            seqState.clipScaleIdx = 1; seqState.lenSteps = 9; seqState.clipTranspose = -5;
            clipPageState.touchedKnob = 2;   // transpose toast (+/- ct)
            lastRender = () => renderKnobsView(buildClipPageVM(), false, 0);
            lastRender();
            break;
        }
        case 'clip-overlay': {       // SCALE long-enum overlay open
            resetSeqState(); resetClipPage();
            seqState.clipScaleIdx = 4; seqState.lenSteps = 16; seqState.clipTranspose = 0;
            clipPageState.scaleOverlay = true; clipPageState.scaleSel = 6; // 2X
            lastRender = () => renderKnobsView(buildClipPageVM(), false, 0);
            lastRender();
            break;
        }
        case 'clip-drum': {          // drum track: transpose unavailable
            resetSeqState(); resetClipPage();
            seqState.clipScaleIdx = 4; seqState.lenSteps = 16; seqState.clipTranspose = 0;
            // Minimal stand-in for a loaded drum module on the active track's
            // synth slot — trackIsDrum() only asks for the drum config.
            const savedModels = appState.trackModels, savedSlot = appState.activeTrack.index;
            appState.trackModels = [[null, { getDrumConfig: () => ({ padCount: 16 }) }]];
            appState.activeTrack = trackRef(0);
            clipPageState.touchedKnob = 2;   // 'n/a on drums' toast
            const vm = buildClipPageVM();
            appState.trackModels = savedModels; appState.activeTrack = trackRef(savedSlot);
            lastRender = () => renderKnobsView(vm, false, 0);
            lastRender();
            break;
        }
        case 'lfo_chain':
        case 'lfo_lfo1':
        case 'lfo_lfo2':
        case 'lfo_target_overlay':
        case 'lfo_viz_unipolar':
        case 'lfo_viz_retrig': {
            env.setParams({
                'synth:chain_params': JSON.stringify([
                    { key: 'cutoff', name: 'Cutoff', type: 'float' },
                    { key: 'reso',   name: 'Resonance', type: 'float' },
                ]),
                'fx1:chain_params': JSON.stringify([{ key: 'mix', name: 'Mix', type: 'float' }]),
                'lfo1:sync': '0', 'lfo1:rate_hz': '2.0', 'lfo1:depth': '0.65',
                'lfo1:shape': (preset === 'lfo_viz_unipolar') ? '2' : (preset === 'lfo_viz_retrig') ? '1' : '0',
                'lfo1:polarity': (preset === 'lfo_viz_unipolar') ? '0' : '1',
                'lfo1:phase_offset': (preset === 'lfo_viz_unipolar') ? '0.25' : '0',
                'lfo1:retrigger': (preset === 'lfo_viz_retrig') ? '1' : '0',
                'lfo2:sync': '1', 'lfo2:rate_div': '19', 'lfo2:shape': '3',
            });
            const lm = createLfoModel(0);
            lm.tick();
            if (preset === 'lfo_lfo2') lm.changePage(1);
            if (preset === 'lfo_target_overlay') lm.handleKnobTouch(3);
            if (preset === 'lfo_chain') lastRender = () => renderChainView(lm.getViewModel(), 4, false, 'T1', 'LFO');
            else lastRender = () => renderKnobsView(lm.getViewModel(), false, 0);
            lastRender();
            break;
        }
        /* A movy-hosted SEND slot on the master page. It is left of the master
         * FX both here and in the signal path — a send's output joins movy's
         * stereo out, which schwung's master FX then process. */
        case 'master_send_slot':
        case 'master_send_empty': {
            const loaded = preset === 'master_send_slot';
            const oldGet = globalThis.host_module_get_param;
            globalThis.host_module_get_param = (k) => {
                if (k === 'snd0:module') return loaded ? 'reverb' : null;
                if (k === 'snd0:name') return loaded ? 'Reverb' : null;
                if (k === 'snd0:chain_params') {
                    return loaded ? JSON.stringify([
                        { key: 'mix',   name: 'Mix',   type: 'float' },
                        { key: 'decay', name: 'Decay', type: 'float' },
                    ]) : null;
                }
                return oldGet?.(k) ?? null;
            };
            resetPorts();
            const sm = createModel(componentPort(0, 'snd0'), 'snd0');
            sm.tick(); sm.tick();
            lastRender = () => renderChainView(sm.getViewModel(), 0, false, 'MASTER', 'SEND 1',
                                               MASTER_FX_SLOTS);
            lastRender();
            globalThis.host_module_get_param = oldGet;
            break;
        }
        /* Movy's own summing mixer as a page. */
        /* `mix_page_two_held` is two knobs held at once: BOTH show their value,
         * and the header follows the one touched last. One readout for two
         * hands reads as a knob that stopped responding. */
        case 'mix_page':
        case 'mix_page_chain':
        case 'mix_page_two_held': {
            const mtrk = 6;
            const oldGet = globalThis.host_module_get_param;
            globalThis.host_module_get_param = (k) =>
                /* Full width, and every send at a DIFFERENT level: a baseline
                 * where two knobs agree cannot show one being drawn under the
                 * wrong encoder. */
                k === 'ch6:mix' ? '0.7079,-0.5000,0,0.5012,0.0000,0.2512' : oldGet?.(k) ?? null;
            resetPorts();
            const mx = createMixModel(mtrk);
            mx.tick();
            if (preset === 'mix_page_two_held') {
                mx.handleKnobTouch(0);          // VOL
                mx.handleKnobTouch(FIELD_AT.indexOf('send2'));
            }
            if (preset === 'mix_page_chain') {
                lastRender = () => renderChainView(mx.getViewModel(), 5, false, 'T' + (mtrk + 1), 'MIX');
            } else {
                lastRender = () => renderKnobsView(mx.getViewModel(), false, mtrk);
            }
            lastRender();
            globalThis.host_module_get_param = oldGet;
            break;
        }
        /* The master chain's own LFO page: same eight positions, but knob 7 is
         * blank — the master bus has no notes to retrigger on. */
        case 'lfo_master':
        case 'lfo_master_chain': {
            env.setParams({
                'master_fx:fx1:chain_params': JSON.stringify([{ key: 'mix', name: 'Mix', type: 'float' }]),
                'master_fx:lfo1:sync': '0', 'master_fx:lfo1:rate_hz': '2.0',
                'master_fx:lfo1:depth': '0.65', 'master_fx:lfo1:shape': '0',
                'master_fx:lfo1:polarity': '1', 'master_fx:lfo1:phase_offset': '0',
                'master_fx:lfo1:target': 'fx1', 'master_fx:lfo1:target_param': 'mix',
            });
            resetPorts();
            const mlm = createScopedLfoModel(masterScope());
            mlm.tick();
            if (preset === 'lfo_master_chain') {
                lastRender = () => renderChainView(mlm.getViewModel(), MASTER_LFO_INDEX, false, 'MASTER', 'LFO', MASTER_FX_SLOTS);
            } else {
                lastRender = () => renderKnobsView(mlm.getViewModel(), false, 0);
            }
            lastRender();
            break;
        }
        case 'lfo_mod_mark':
        case 'lfo_mod_and_auto': {
            loadPreset('test8');
            for (let i = 0; i < 6; i++) chainModels[1].tick();
            env.setParams({ ...env.params, 'lfo1:target': 'synth', 'lfo1:target_param': chainModels[1].getKnobParamInfo(0).ioKey });
            chainModels[1].refreshModulation();
            const auto = preset === 'lfo_mod_and_auto' ? autoView() : undefined;
            lastRender = () => renderKnobsView(chainModels[1].getViewModel(auto), false, 0);
            lastRender();
            break;
        }
        case 'lfo_assign_toast': {
            loadPreset('test8');
            for (let i = 0; i < 6; i++) chainModels[1].tick();
            const realNow = Date.now; let t = 1000; Date.now = () => t;
            resetAssignMode();
            holdTouch(trackScope(0), 0, chainModels[1].getKnobParamInfo(0)); t = 2100; holdTick();
            Date.now = realNow;
            lastRender = () => { renderKnobsView(chainModels[1].getViewModel(), false, 0); drawJogToast(assignToastText()); };
            lastRender();
            break;
        }
        /* PAGE MODE, DRAWN BY SCHWUNG. The rest of the baselines cannot reach it:
         * `renderKnobsView` only ever draws Schwung's widgets through a supplied
         * `bodyOverride` (SP-40 deleted the flag-driven `body` mode that used to
         * read `schwunggrid` on its own), so every existing scene renders movy's
         * own widgets regardless of the flag, and the suite would report green
         * about a renderer it never ran. These scenes supply `bodyOverride` —
         * the same seam the device uses — so Schwung really plans and really
         * draws.
         *
         * `page_body` and `page_body_p2` differ only by a jog click, which is
         * the point: the bank bar's index is Schwung's pageIndex, and a frozen 0
         * there is the Cause A symptom a screenshot can see — and the HEADER's
         * right-hand end is Schwung's page NAME (SP-37), so the pair also pins
         * that it moves. `page_voice_pad` is the same frame on a module that
         * declares a drum rack, where the header has a second name to choose
         * from and the wrong precedence draws that one instead. */
        case 'page_body':
        case 'page_body_p2':
        case 'page_voice_pad': {
            if (!schwungLibAvailable()) throw new Error(
                'screenshot: ' + preset + ' needs a bundle built with SCHWUNG=/path/to/schwung');
            setSchwungGridMode('page');
            /* dropped first so the two scenes cannot share one page: `pages` is
             * a module-level cache and nothing clears it between them, so
             * without this `page_body` would inherit `page_body_p2`'s index if
             * the PRESETS list were ever reordered. */
            schwungGridReload();
            /* schwungPageFor, NOT schwungActiveFor. The Active variant returns
             * null unless the page is ALREADY ready (`schwung-grid.ts:138` —
             * `p.ready ? p : null`), and a page it just created never is. Used
             * here it would throw on this line, before the loop below could ever
             * run, with a message blaming SCHWUNG for what is only a readiness
             * race. schwungPageFor creates and reload()s the page and never
             * returns null. */
            const sp = schwungPageFor(0, 'synth');
            /* The controller resolves the contract over several ticks (RETRY_TICKS
             * 12 × RETRY_LIMIT 60 in schwung-page-contract.ts). Waiting on
             * `ready` rather than on a tick count keeps the scene deterministic
             * on a slow machine. model.tick() alongside sp.tick() because the
             * scene owns the clock: the harness's own settle() drives model.tick()
             * and knows nothing about a Schwung page, so a page ticked without a
             * model tick reads a stale view. */
            for (let i = 0; i < 12 * 60 && !sp.ready; i++) { sp.tick(); model.tick(); }
            if (!sp.ready) throw new Error(preset + ': the contract never resolved');
            if (preset === 'page_body_p2') sp.changePage(1);
            /* A DRUM RACK UNDER A DELEGATED PAGE, on a page that is NOT the
             * focused pad's own — which is the shape the pad-name precedence
             * used to get wrong. `updateDrumPad` is what fills `drumPadName`
             * (the model reads the names off the module's own declaration, so
             * nothing here invents one); on `voice-poc` pad 2 is "Snare" and
             * its own page is page 1, so page 0 — "Kick" — is a page where the
             * two names on screen differ. */
            if (preset === 'page_voice_pad') {
                sp.goToPage(0);
                model.updateDrumPad(2, 38);
            }
            const vm = model.getViewModel();
            if (preset === 'page_voice_pad') {
                const label = sp.chrome(true).pageLabel;
                if (!vm.drumPadName) throw new Error(
                    'page_voice_pad: the rack declared no pad names, so the shot cannot test the precedence');
                /* AND THE TWO NAMES MUST DIFFER, or this frame is green whichever
                 * of them leads and the regression is a clean diff — the
                 * failure mode a screenshot is worst at seeing. */
                if (vm.drumPadName === label) throw new Error(
                    'page_voice_pad: the focused pad and the page are both '
                    + JSON.stringify(vm.drumPadName)
                    + ', so the baseline cannot tell the precedence from a coincidence');
                /* ...AND WHAT IT DRAWS IS THE PAGE'S, asserted through the
                 * renderer's own chooser so a regression fails naming the rule
                 * instead of a pixel count. That the name MOVES when the jog
                 * does is `logic/schwung-page.mjs`'s claim: one frame can only
                 * witness what is in it. */
                if (headerRightText(vm, sp.chrome(true)) !== label) throw new Error(
                    'page_voice_pad: the frame draws '
                    + JSON.stringify(headerRightText(vm, sp.chrome(true)))
                    + ' where the page is named ' + JSON.stringify(label));
            }
            /* `sp.chrome(true)` is the APP's own call (`schwungChromeFor(owner,
             * body, true)`) and the reason these scenes exist: the header's
             * right-hand end is the page's name under `page`, and movy's own
             * bank name under `off`. Without it the pair is a constant and the
             * SP-37 symptom is invisible to every baseline in this suite. */
            lastRender = () => renderKnobsView(model.getViewModel(), false, 0,
                () => sp.render('T1 > ' + model.getModuleName()),
                { index: sp.pageIndex, count: sp.pageCount }, sp.chrome(true));
            lastRender();
            /* The mode is a module-level override: leaving it set would silently
             * repaint every scene after this one, and they would still report
             * green. */
            setSchwungGridMode(null);
            break;
        }

        /* SP-58: the master chain GRID with Schwung's body under its slot bar —
         * the frame the device showed movy's own widgets in. The chain view's
         * frame (MASTER header, eight slot dots, no page hint band since the
         * jog moves slots here) around Schwung's cells is what is pinned; the
         * module behind the body is the mock's, because what differs between a
         * track slot and a master slot is the port, which a picture cannot
         * see (that half is app-loop's SP-58 block). */
        case 'page_master_chain': {
            if (!schwungLibAvailable()) throw new Error(
                'screenshot: ' + preset + ' needs a bundle built with SCHWUNG=/path/to/schwung');
            setSchwungGridMode('page');
            schwungGridReload();
            const sp = schwungPageFor(0, 'synth');
            for (let i = 0; i < 12 * 60 && !sp.ready; i++) { sp.tick(); model.tick(); }
            if (!sp.ready) throw new Error(preset + ': the contract never resolved');
            const mfx1 = MASTER_FX_SLOTS.findIndex((sl) => sl.componentKey === 'master_fx:fx1');
            lastRender = () => renderChainView(model.getViewModel(), mfx1, false, 'MASTER',
                MASTER_FX_SLOTS[mfx1].label, MASTER_FX_SLOTS,
                () => sp.render(''), sp.chrome(false));
            lastRender();
            setSchwungGridMode(null);
            break;
        }

        /* SP-42: the sample cell drawn through SCHWUNG'S OWN render path
         * (viz_draw.mjs's drawSample), not movy's — that path already has
         * baselines (wav_sample/wav_loop/wav_beside_filter). A waveform is
         * pixels, so this is the only baseline that can show the difference
         * between "wired" and "the flat no-envelope fallback" by eye. */
        case 'page_sample': {
            if (!schwungLibAvailable()) throw new Error(
                'screenshot: page_sample needs a bundle built with SCHWUNG=/path/to/schwung');
            setSchwungGridMode('page');
            schwungGridReload();
            /* Backed BEFORE the contract resolves: `advanceSample` only ever
             * sees the path once `ctl.state.values` has it, which is itself
             * gated behind the page being ready, so ordering here does not
             * matter — but doing it up front matches every other WAV scene in
             * this file (makeSceneWav is called before the tick loop there
             * too) and keeps this scene reusing the SAME fixture rather than
             * inventing a second one. */
            makeSceneWav();
            const sp = schwungPageFor(0, 'synth');
            for (let i = 0; i < 12 * 60 && !sp.ready; i++) { sp.tick(); model.tick(); }
            if (!sp.ready) throw new Error('page_sample: the contract never resolved');
            /* Past resolving, the tick loop above already ran `advanceSample`
             * every pass (schwung-page-contract.ts), so the envelope job has
             * had hundreds of ticks — far more than the ~2 it needs for this
             * fixture's size. A short extra run just covers the case where the
             * contract resolved before the page's own state.values batch
             * picked up sample_path. */
            for (let i = 0; i < 60; i++) { sp.tick(); model.tick(); }
            lastRender = () => renderKnobsView(model.getViewModel(), false, 0,
                () => sp.render('T1 > ' + model.getModuleName()),
                { index: sp.pageIndex, count: sp.pageCount }, sp.chrome(true));
            lastRender();
            setSchwungGridMode(null);
            break;
        }

        /* SP-53: Clip Params and Set Params under `page` — a component with
         * NO module port at all, so the page is built through
         * `pageOwnerForComponent` (the exact accessor `app/tick.ts` and
         * `midi/router.ts` use), never a re-implementation of the ownership
         * question. `schwungBodyFor`/`schwungBankFor`/`schwungChromeFor` are
         * the same three functions the real render branch calls, so a
         * regression in any of them shows here as a pixel diff, not just in
         * the logic suite's assertions. */
        case 'page_clipparams': {
            if (!schwungLibAvailable()) throw new Error(
                'screenshot: ' + preset + ' needs a bundle built with SCHWUNG=/path/to/schwung');
            resetSeqState(); resetClipPage();
            seqState.clipScaleIdx = 4; seqState.lenSteps = 16; seqState.clipTranspose = 0;
            setSchwungGridMode('page');
            schwungGridReload();
            const owner = pageOwnerForComponent(CLIP_PARAMS_COMPONENT);
            for (let i = 0; i < 12 * 60 && !owner.page; i++) owner.poll();
            if (!owner.page) throw new Error(preset + ': the contract never resolved');
            const body = schwungBodyFor(owner, false);
            if (!body) throw new Error(preset + ': claimed but no body — schwungBodyFor declined');
            lastRender = () => renderKnobsView(buildClipPageVM(), false, 0,
                body, schwungBankFor(owner, body), schwungChromeFor(owner, body, false));
            lastRender();
            setSchwungGridMode(null);
            break;
        }
        case 'page_setparams': {
            if (!schwungLibAvailable()) throw new Error(
                'screenshot: ' + preset + ' needs a bundle built with SCHWUNG=/path/to/schwung');
            resetSeqState(); resetMainPage();
            keyboardState.rootPc = 0; keyboardState.octave = [4, 4, 4, 4];
            keyboardState.mode = 0; keyboardState.layout = 0; keyboardState.scale = 0;
            seqState.bpmX100 = 12000; seqState.swingPct = 50;
            setSchwungGridMode('page');
            schwungGridReload();
            const owner = pageOwnerForComponent(SET_PARAMS_COMPONENT);
            for (let i = 0; i < 12 * 60 && !owner.page; i++) owner.poll();
            if (!owner.page) throw new Error(preset + ': the contract never resolved');
            const body = schwungBodyFor(owner, false);
            if (!body) throw new Error(preset + ': claimed but no body — schwungBodyFor declined');
            lastRender = () => renderKnobsView(buildMainPageVM(), false, 0,
                body, schwungBankFor(owner, body), schwungChromeFor(owner, body, false));
            lastRender();
            setSchwungGridMode(null);
            break;
        }
        /* SP-54: the step page under `page` — same shape as its two siblings
         * above (a virtual component with no module port), through the same
         * `pageOwnerForComponent` accessor `app/tick.ts` uses. `vm` still
         * comes from `buildStepPageVM` (the header fallback and the "step is
         * a bank of its own" bar read it regardless of who draws the body —
         * see `app/tick.ts`'s own comment on this), only its ROWS are
         * replaced by Schwung's `body`. */
        case 'page_stepparams': {
            if (!schwungLibAvailable()) throw new Error(
                'screenshot: ' + preset + ' needs a bundle built with SCHWUNG=/path/to/schwung');
            resetSeqState(); resetStepPage();
            seqState.holdVel = 100; seqState.holdGate = 96; seqState.holdGateMixed = false;
            seqState.holdProb = 100; seqState.holdCondA = 1; seqState.holdCondB = 1;
            seqState.holdInvert = false;
            setStepPageSelected(true);
            setSchwungGridMode('page');
            schwungGridReload();
            const owner = pageOwnerForComponent(STEP_PARAMS_COMPONENT);
            for (let i = 0; i < 12 * 60 && !owner.page; i++) owner.poll();
            if (!owner.page) throw new Error(preset + ': the contract never resolved');
            const body = schwungBodyFor(owner);
            if (!body) throw new Error(preset + ': claimed but no body — schwungBodyFor declined');
            const heldTrig = () => ({
                holdVel: seqState.holdVel, holdGate: seqState.holdGate,
                holdGateMixed: seqState.holdGateMixed, holdProb: seqState.holdProb,
                holdCondA: seqState.holdCondA, holdCondB: seqState.holdCondB,
                holdInvert: seqState.holdInvert,
            });
            lastRender = () => renderKnobsView(buildStepPageVM(heldTrig(), 1), false, 0,
                body, schwungBankFor(owner, body), schwungChromeFor(owner, body, false));
            lastRender();
            setSchwungGridMode(null);
            resetStepPage();
            break;
        }

        /* THE DECORATION CHANNEL (SP-18). Four readings a person takes at a
         * glance in `off` mode, and the reason `page_body` cannot cover any of
         * them: it passes no automation view and wires no modulation source, so
         * under it all four are the plain page and would stay green with the
         * whole channel taken out.
         *
         * Each scene is the frame the APP draws, through the same call the app
         * makes — `sp.render(title, auto)` where the decoration decides, and
         * `schwungBodyFor(owner, …)` where the body decision does. None of them
         * re-derives a condition the app owns; a scene that did would keep
         * passing with that condition removed, which is the one thing these
         * exist to prevent.
         *
         * ── page_mod_cell / page_mod_cell_held (a) ───────────────────────────
         * The tilde, and the polarity case upstream calls out as the one no
         * contact sheet shows: the mark sits six pixels left of the label run,
         * which is OUTSIDE the inverted strip, so on a touched cell it has to be
         * drawn in black-on-white rather than white-on-black or it is invisible
         * on exactly the cell that needs it. `page_mod_cell_held` is therefore
         * the same frame with knob 0 touched — a real `knobTouch`, the same call
         * a finger makes — not a second flag.
         *
         * The LFO is pointed at the page's first key, and the tick loop is then
         * driven to that key rather than to a count: `modCache` is filled one
         * key per tick by the controller's own read rotation, so a page that
         * has just resolved has only asked about the keys its replan landed on,
         * and how many ticks the rotation needs is the controller's business.
         * `synth:freq:effective` is set away from the base value so the mod dot
         * is a dot ON the arc rather than under the pointer — without it the two
         * marks coincide and the shot cannot tell the dot from the base.
         *
         * ── page_held_lock (b) ──────────────────────────────────────────────
         * A held step with a resolved lock: the cell is marked AND shows the
         * value that step will play, never where the knob was left. Rendered
         * through `sp.render(title, auto)` because that is where the decoration
         * is built (`schwung-page-decorations.ts`), and the held value is the
         * wiring: drop it and the cell goes back to the live value.
         *
         * ── page_held_unassignable (c) ──────────────────────────────────────
         * A held step on a page most of which cannot take a lock. Rendered
         * through the REAL body decision — `pageOwnerOf` + `schwungBodyFor`,
         * with `seqState.stepAutoMode` set, which is what `vm.automationHeld`
         * is — so the scene grades the body decision end to end rather than a
         * copy of its condition.
         *
         * THE FRAME IS SCHWUNG'S PAGE NOW, AND THE SHOT IS WHERE THE DIFF IS
         * READ. SP-35 stopped the hold from handing the owner back, so the body
         * here is the delegated page and the cells movy's own drawer used to
         * HIDE (`hiddenDuringHold`) are simply drawn — they show the same thing
         * as any other cell, and the refusal to lock one is said at the gesture
         * instead (`seq/automation.ts` consumes the turn and toasts). SP-35
         * regenerated this one baseline for exactly that, and for nothing else:
         * it is the only scene that asks the app for the body under a hold.
         *
         * ── page_lane_unheld (d) ────────────────────────────────────────────
         * The frame `page_held_lock` is one term away from: the same page, the
         * same live lane, nothing held. `activeLanes` is set in both — it is
         * live for as long as the track has locks — so what separates them is
         * `held` alone, and a decoration pass that ignores it marks a cell
         * nobody locked, every frame, for the rest of the page's life. That is
         * SP-16's "mark that lies": it went unnoticed while the graphic gate
         * hid the picture behind it, and it is the whole of what is left of the
         * symptom now that upstream keeps the graphic. */
        case 'page_mod_cell':
        case 'page_mod_cell_held':
        case 'page_held_lock':
        case 'page_lane_unheld':
        case 'page_held_unassignable': {
            if (!schwungLibAvailable()) throw new Error(
                'screenshot: ' + preset + ' needs a bundle built with SCHWUNG=/path/to/schwung');
            const modded = preset === 'page_mod_cell' || preset === 'page_mod_cell_held';
            /* `modulatedKeysOf` resolves the model through `appState.trackModels`
             * — the registry `app/init.ts` fills and the one production runs on
             * — so the scene has to be under it too, or it would be grading a
             * lookup that never finds anything. Restored on the way out: other
             * scenes read this. */
            const savedModels = appState.trackModels;
            appState.trackModels = [chainModels];
            try {
                setSchwungGridMode('page');
                /* Dropped first: `pages` is a module-level cache and nothing
                 * clears it between scenes, so a scene would otherwise inherit
                 * the previous one's index. */
                schwungGridReload();
                const sp = schwungPageFor(0, 'synth', modulatedKeysOf);
                for (let i = 0; i < 12 * 60 && !sp.ready; i++) { sp.tick(); model.tick(); }
                if (!sp.ready) throw new Error(preset + ': the contract never resolved');

                if (modded) {
                    /* The page's OWN key at knob 0, not movy's: the tilde is the
                     * controller asking `isModulated` about the key IT planned,
                     * and the two planners do not always put the same param in
                     * the same cell. */
                    const MOD_KEY = sp.keyAt(0);
                    if (!MOD_KEY) throw new Error(preset + ': nothing planned at knob 0');
                    env.setParams({
                        ...env.params,
                        'lfo1:target': 'synth',
                        'lfo1:target_param': MOD_KEY,
                        /* The live value an LFO has put the param at, which the
                         * controller reads on its own lane for the dot. Above
                         * the 0.50 base, so dot and pointer are two marks. */
                        ['synth:' + MOD_KEY + ':effective']: '0.85',
                    });
                    model.refreshModulation();

                    /* Driven to the key, not to a tick count — the accessor is
                     * the controller's own, i.e. the cache the renderer reads.
                     * Deliberately NOT an assertion: the failure this guards
                     * against is "the mark did not appear", and the pixel diff
                     * says that with a count, where a throw would only say the
                     * page never asked. */
                    for (let i = 0; i < 400 && !sp.ctl.isModulatedCached(MOD_KEY); i++) {
                        sp.tick(); model.tick();
                    }
                    /* ...and a little more, for the effective-value lane the dot
                     * rides, which is a separate read on its own cadence. */
                    for (let i = 0; i < 24; i++) { sp.tick(); model.tick(); }
                    if (preset === 'page_mod_cell_held') sp.knobTouch(0, true);
                    lastRender = () => renderKnobsView(model.getViewModel(), false, 0,
                        () => sp.render('T1 > ' + model.getModuleName()),
                        { index: sp.pageIndex, count: sp.pageCount });
                } else if (preset === 'page_held_lock') {
                    /* THE KEY THE PAGE PLANNED, resolved the way the app resolves
                     * it: through the owner, which under delegation answers with
                     * Schwung's key. A lane built from movy's own knob 0 would
                     * mark nothing at all on a page that put a different param
                     * there — and the scene would then be green with the whole
                     * decoration taken out. */
                    const info = pageOwnerOf(model).knobParamInfo(0);
                    if (!info) throw new Error(preset + ': no parameter at knob 0');
                    /* The auto view the app builds for a held step, with knob
                     * 0's lane locked at its maximum: `test8` reads 0.50 at
                     * rest, so a lock at 1.00 is unmistakable. */
                    const auto = { ...autoView({ held: true, heldVal: info.max }),
                                   laneForKey: (k) => (k === info.key ? 0 : -1) };
                    lastRender = () => renderKnobsView(model.getViewModel(auto), false, 0,
                        () => sp.render('T1 > ' + model.getModuleName(), auto),
                        { index: sp.pageIndex, count: sp.pageCount });
                } else if (preset === 'page_lane_unheld') {
                    /* THE OTHER HALF OF `page_held_lock`: the SAME page, the
                     * same live lane, and no step held. `activeLanes` is set in
                     * both frames — it is live for as long as the track HAS
                     * locks, which on an automated page is every frame — so
                     * `held` is the only thing between them, and the decoration
                     * pass is the only reader of it. Resolved through the owner
                     * for the same reason as above: a lane built from movy's
                     * own knob 0 would mark a different cell under `page`, and
                     * the shot would stay green with the condition taken out. */
                    const info = pageOwnerOf(model).knobParamInfo(0);
                    if (!info) throw new Error(preset + ': no parameter at knob 0');
                    const auto = { ...autoView({ held: false }),
                                   laneForKey: (k) => (k === info.key ? 0 : -1) };
                    lastRender = () => renderKnobsView(model.getViewModel(auto), false, 0,
                        () => sp.render('T1 > ' + model.getModuleName(), auto),
                        { index: sp.pageIndex, count: sp.pageCount });
                } else {
                    /* `seqState.stepAutoMode` IS `vm.automationHeld` — the flag
                     * the automation view publishes as `held`. Set rather than
                     * gestured because the scene owns the frame; the body is
                     * asked for through the app's own function either way, once
                     * per frame, which is where the app asks it. */
                    seqState.stepAutoMode = true;
                    lastRender = () => {
                        const owner = pageOwnerOf(model);
                        /* THE HOLD IS NOT AN INPUT TO EITHER CALL, and that is
                         * SP-35: `pageOwnerOf` no longer reads
                         * `seqState.stepAutoMode` (app/page-owner.ts) and
                         * `schwungBodyFor` never did, so the two cannot be told
                         * the same news twice or told different news. What the
                         * flags above still decide is the HELD-STEP GRAPHIC the
                         * body draws (the lock mark and the value that step will
                         * play), which is movy's `autoView` on one side and
                         * Schwung's decoration pass on the other. */
                        const body = schwungBodyFor(owner,
                            stepPageAvailable() && stepPageState.selected);
                        renderKnobsView(model.getViewModel(autoView({ held: true })), false, 0,
                            body, schwungBankFor(owner, body));
                    };
                }
                lastRender();
            } finally {
                /* Both are module-level state, and leaving either set silently
                 * repaints every scene after this one — which would still report
                 * green. */
                setSchwungGridMode(null);
                seqState.stepAutoMode = false;
                appState.trackModels = savedModels;
            }
            break;
        }
        /* ── page_lane_mark / page_lane_mark_held (SP-59) ─────────────────────
         * A LANE through the app's own wiring: the owner's page (which is
         * where `automationFor` is injected), a
         * lane assigned in the real registry, the port answering the value the
         * lane drives. Everything the earlier page scenes hand the renderer as
         * an auto VIEW is here asked for the way the device asks — which is the
         * only way a scene sees the io's channel choice at all.
         *
         * What it shows depends on the library, and that is the point of
         * feature-detecting it: against a Schwung with `drawAutomatedMark` the
         * cell wears the 2x2 beside its label and no tilde; against an older
         * one it wears the tilde (the SP-36 fold). Both keep the pointer at the
         * base and the dot on the lane. `_held` adds the step: the lock's value
         * where the name was (inverted from #509 on), the mark beside it. */
        case 'page_lane_mark':
        case 'page_lane_mark_held': {
            if (!schwungLibAvailable()) throw new Error(
                'screenshot: ' + preset + ' needs a bundle built with SCHWUNG=/path/to/schwung');
            const savedModels = appState.trackModels;
            appState.trackModels = [chainModels];
            try {
                setSchwungGridMode('page');
                schwungGridReload();
                resetAutomation();
                /* Through the owner, which is where `automationFor` is wired —
                 * the device's own path to the page, not a copy of it. */
                for (let i = 0; i < 20; i++) model.tick();
                const sp = pageOwnerOf(model).page;
                if (!sp) throw new Error(preset + ': the page is not delegated');
                for (let i = 0; i < 12 * 60 && !sp.ready; i++) { sp.tick(); model.tick(); }
                if (!sp.ready) throw new Error(preset + ': the contract never resolved');
                const info = pageOwnerOf(model).knobParamInfo(0);
                if (!info) throw new Error(preset + ': no parameter at knob 0');
                if (assignLane(0, 0, info, () => true) !== 0) throw new Error(preset + ': no lane');
                seqState.autoActive |= 1;
                /* Playback as the port sees it: the lane's value, away from the
                 * 0.50 base, so the dot and the pointer are two marks. */
                portFor(0).setParam('synth:' + info.ioKey, '0.85');
                const k = sp.keyAt(0);
                for (let i = 0; i < 400 && !(sp.ctl.isAutomatedCached?.(k) || sp.ctl.isModulatedCached(k)); i++) {
                    sp.tick(); model.tick();
                }
                for (let i = 0; i < 24; i++) { sp.tick(); model.tick(); }
                const auto = preset === 'page_lane_mark_held'
                    ? { ...autoView({ held: true, heldVal: info.max }),
                        laneForKey: (key) => (key === info.key ? 0 : -1) }
                    : undefined;
                lastRender = () => renderKnobsView(model.getViewModel(auto), false, 0,
                    () => sp.render('T1 > ' + model.getModuleName(), auto),
                    { index: sp.pageIndex, count: sp.pageCount });
                lastRender();
            } finally {
                setSchwungGridMode(null);
                seqState.autoActive = 0;
                resetAutomation();
                appState.trackModels = savedModels;
            }
            break;
        }
        /* ── THE TWO BANDS MOVY KEEPS (SP-17) ─────────────────────────────────
         * `bands.header`/`bands.footer` are false for LAYOUT reasons, so movy
         * draws both — the readout from the controller's own `describePage()`,
         * the hints from conditions it asks the controller for. A scene is the
         * only thing that sees them: the logic suite proves the pairs are the
         * right WORDS, and nothing there proves they reach the pixels.
         *
         * The two scenes are the two clicks that never come back to movy. A
         * trigger FIRES inside the controller, a two-way enum FLIPS there, and
         * neither returns an intent — so the footer has to name the consequence
         * instead, and these are the frames where it does.
         */
        case 'page_chrome_held':
        case 'page_chrome_flip': {
            if (!schwungLibAvailable()) throw new Error(
                'screenshot: ' + preset + ' needs a bundle built with SCHWUNG=/path/to/schwung');
            const savedModels = appState.trackModels;
            appState.trackModels = [chainModels];
            try {
                setSchwungGridMode('page');
                schwungGridReload();
                const sp = schwungPageFor(0, 'synth');
                for (let i = 0; i < 12 * 60 && !sp.ready; i++) { sp.tick(); model.tick(); }
                if (!sp.ready) throw new Error(preset + ': the contract never resolved');

                /* By KEY, not by slot: which cell a param lands in is the
                 * planner's business, and a scene pinned to slot 0 would keep
                 * rendering green if the planner moved it. */
                const WANT = preset === 'page_chrome_held' ? 'rnd_patch' : 'legato';
                let slot = -1;
                for (let pg = 0; pg < sp.pageCount && slot < 0; pg++) {
                    sp.goToPage(pg);
                    for (let k = 0; k < 8; k++) if (sp.keyAt(k) === WANT) { slot = k; break; }
                }
                if (slot < 0) throw new Error(preset + ': ' + WANT + ' is on no page');
                sp.knobTouch(slot, true);
                /* Through the app's own call, chrome included — the header and
                 * the hints are the last argument, exactly as app/tick.ts
                 * passes them. */
                lastRender = () => renderKnobsView(model.getViewModel(), false, 0,
                    () => sp.render('T1 > ' + model.getModuleName()),
                    { index: sp.pageIndex, count: sp.pageCount }, sp.chrome(true));
                lastRender();
            } finally {
                setSchwungGridMode(null);
                appState.trackModels = savedModels;
            }
            break;
        }

        default:                 forceRender(); break;                       // plain knobs view
    }
}

/* ── PNG encode + pixel diff ─────────────────────────────────────────────── */

function capturePng() {
    const png = new PNG({ width: W, height: H });
    png.data.set(fb);
    return PNG.sync.write(png);
}

function diffPngs(baselinePath, actualPath) {
    const baseline = PNG.sync.read(readFileSync(baselinePath));
    const actual   = PNG.sync.read(readFileSync(actualPath));
    if (baseline.width !== actual.width || baseline.height !== actual.height) {
        return { different: true, reason: 'size mismatch' };
    }
    const diff  = new PNG({ width: baseline.width, height: baseline.height });
    const count = pixelmatch(baseline.data, actual.data, diff.data,
        baseline.width, baseline.height, { threshold: 0.1 });
    return { different: count > 0, count };
}

/* ── Main ────────────────────────────────────────────────────────────────── */

mkdirSync(BASE_DIR,   { recursive: true });
mkdirSync(ACTUAL_DIR, { recursive: true });

let pass = 0, fail = 0, skipped = 0;

for (const preset of PRESETS) {
    process.stdout.write(`  ${preset} ... `);

    /* A `page` scene cannot run without the library, and the difference between
     * "skipped" and "passed" is the whole point of this file: a baseline written
     * from a build that could not render the body would be a lie that stays
     * green forever. Skipped loudly, and never baselined. */
    if (PAGE_SCENES.has(preset) && !schwungLibAvailable()) {
        console.log('SKIPPED (no param_pages; set SCHWUNG=/path/to/schwung)');
        skipped++;
        continue;
    }

    clear_screen();
    nowOverride = null;            // every scene starts on the real clock
    /* A READER CHANGES WHAT THE MODEL BELIEVES EVERY MODULE DECLARED, so it is
     * registered for the one scene that needs it and cleared for every other:
     * each baseline in this file was written with no reader at all, which is
     * also the state a real movy boots in until `app/globals.ts` runs. */
    setSurfaceReader(preset === 'page_voice_pad' ? surfaceOf : null);
    loadPreset(BASE[preset] ?? preset);
    lastRender = knobsRepaint;
    settle();          // load hierarchy, render default knobs view
    applyView(preset); // synthetic view state (if any)
    settle();          // converge async value refresh

    const pngBuf = capturePng();
    const actual = join(ACTUAL_DIR, `${preset}.png`);
    writeFileSync(actual, pngBuf);

    const baseline = join(BASE_DIR, `${preset}.png`);
    if (!existsSync(baseline) || UPDATE) {
        writeFileSync(baseline, pngBuf);
        console.log(UPDATE ? 'updated' : 'saved baseline');
        pass++;
    } else {
        const result = diffPngs(baseline, actual);
        if (result.different) {
            console.log(`FAIL (${result.reason ?? result.count + ' px differ'})`);
            fail++;
        } else {
            console.log('ok');
            pass++;
        }
    }
}

console.log(`\n  ${pass} passed, ${fail} failed`
    + (skipped ? `, ${skipped} skipped (no param_pages; set SCHWUNG=)` : ''));
process.exit(fail > 0 ? 1 : 0);
