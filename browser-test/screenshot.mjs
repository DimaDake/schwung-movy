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

/* Quiet the renderer's [movy] mlog chatter; keep our own status lines. */
const _log = console.log.bind(console);
console.log = (...a) => { if (typeof a[0] === 'string' && a[0].startsWith('[movy]')) return; _log(...a); };

const __dir      = dirname(fileURLToPath(import.meta.url));
const BASE_DIR   = join(__dir, 'screenshots', 'baseline');
const ACTUAL_DIR = join(__dir, 'screenshots', 'actual');
const UPDATE     = process.argv.includes('--update');

const PRESETS = [
    'keys_view', 'browse_view', 'session_booting', 'session_loading', 'session_modules',
    'session_preparing', 'session_failed', 'session_failed_mismatch', 'versions_empty',
    'versions_list', 'versions_confirm', 'sets_list', 'sets_long_names', 'sets_confirm',
    'chain_synth', 'chain_empty', 'chain_jog_toast', 'knobs_jog_toast', 'chain_t2',
    'chain_t4', 'lfo_chain', 'mix_page_chain', 'master_send_slot', 'master_send_empty',
    'lfo_master_chain', 'lfo_assign_toast', 'file_browse',
    'step_indicator', 'step_rec_header', 'loop_strip_midclip', 'loop_strip_outside',
    'note_view_bass', 'note_view_chords', 'note_view_drums', 'note_view_plus', 'note_view_dense', 'note_view_wide',
    'song_band', 'song_band_overflow', 'song_band_end',
    'quant-overlay-three', 'quant-overlay-two', 'flags-top', 'flags-scrolled', 'flags-generators', 'flags-genmode', 'gen_preview_knob',
    'ai_error_nokey', 'ai_preview_orig', 'ai_preview_opt1', 'ai_preview_opt3', 'ai_preview_var8', 'ai_hold_progress_50', 'ai_hold_variation_50', 'ai_hold_double_50', 'ai_hold_newclip_50',
    'cpu-movy-tracks', 'cpu-unsplit-module', 'cpu-overscale',
    'cpu-empty', 'cpu-sends', 'cpu-sends-quiet', 'cpu-master', 'leave_modal',
    'power_modal', 'capture_select', 'capture_fixed', 'undo_toast', 'redo_toast',
    'undo_empty', 'undo_unavailable', 'clip-undo-toast', 'track_volume_unity',
    'track_volume_quiet', 'track_volume_min', 'track_volume_max', 'master_volume',
    'font_5x3_all', 'font_small_all', 'font_big_all_1', 'font_big_all_2', 'page_body',
    'page_body_p2', 'page_voice_pad', 'page_voice_global', 'page_config_pad',
    'page_config_filter', 'page_config_mix', 'page_config_mod', 'page_sample',
    'page_mod_cell', 'page_mod_cell_held', 'page_held_lock', 'page_lane_unheld',
    'page_held_unassignable', 'page_held_enum', 'page_chrome_held', 'page_chrome_flip',
    'page_chrome_file', 'page_clipparams', 'page_setparams', 'page_stepparams',
    'page_master_chain', 'page_lane_mark', 'page_lane_mark_held', 'page_held_drum',
    'page_lfo', 'page_lfo_master', 'page_enum_list', 'mixer_p1', 'mixer_p2', 'mixer_held',
    'step_piano_triad', 'step_piano_adjacent', 'step_piano_wide', 'step_piano_spread', 'step_piano_empty',
];

/* The scenes that render Schwung's own body. Only reachable from a bundle built
 * against a checkout — the no-checkout stub throws on import and schwungPageFor
 * raises on top of it — so they are SKIPPED rather than failed without one,
 * which is the repo's rule for a missing checkout: "skipped, not failed"
 * (CLAUDE.md). A set, not an inline `||`, because the runner has to ask before
 * it builds or loads anything; the scenes carry their own guard as well, so a
 * name that drifts out of this set fails loudly instead of rendering a body it
 * cannot. */
const PAGE_SCENES = new Set(['page_body', 'page_body_p2', 'page_voice_pad', 'page_voice_global', 'page_config_pad', 'page_config_filter', 'page_config_mix', 'page_config_mod', 'page_sample',
    'page_mod_cell', 'page_mod_cell_held',
    'page_held_lock', 'page_lane_unheld', 'page_held_unassignable', 'page_held_enum',
    'page_chrome_held', 'page_chrome_flip', 'page_chrome_file',
    'page_clipparams', 'page_setparams', 'page_stepparams', 'page_master_chain',
    'page_lane_mark', 'page_lane_mark_held', 'page_held_drum',
    'page_lfo', 'page_lfo_master', 'page_enum_list', 'mixer_p1', 'mixer_p2', 'mixer_held']);

/* Which mock preset backs each (possibly synthetic) screenshot. */
const BASE = {
        keys_view: 'test8', browse_view: 'test8', file_browse: 'test8',
            chain_synth: 'test8', chain_empty: 'test8', chain_jog_toast: 'test8',
    knobs_jog_toast: 'test8', chain_t2: 'test8', chain_t4: 'test8',
                                /* D14: knob 0 is an enum (Mode, at rest LP); the held step locks HP. */
    page_held_enum: 'test_enum',
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
    page_chrome_held: 'switches', page_chrome_flip: 'switches', page_chrome_file: 'wav_sample',
    step_indicator: 'test8',
    step_piano_triad: 'test8', step_piano_adjacent: 'test8', step_piano_wide: 'test8',
    step_piano_spread: 'test8', step_piano_empty: 'test8',
    step_rec_header: 'test8',
    loop_strip_midclip: 'test8', loop_strip_outside: 'test8',
    note_view_bass: 'test8', note_view_chords: 'test8', note_view_drums: 'test8',
    note_view_plus: 'test8', note_view_dense: 'test8', note_view_wide: 'test8',
                                'quant-overlay-three': 'test8', 'quant-overlay-two': 'test8',
    'flags-top': 'test8', 'flags-scrolled': 'test8', 'flags-generators': 'test8', 'flags-genmode': 'test8', gen_preview_knob: 'test8',
    ai_error_nokey: 'test8',
    ai_preview_orig: 'test8', ai_preview_opt1: 'test8', ai_preview_opt3: 'test8', ai_preview_var8: 'test8', ai_hold_progress_50: 'test8', ai_hold_variation_50: 'test8', ai_hold_double_50: 'test8', ai_hold_newclip_50: 'test8',
                                                                            lfo_chain: 'test8',         lfo_assign_toast: 'test8',
    leave_modal: 'test8', power_modal: 'test8',
    master_volume: 'test8',
    track_volume_unity: 'test8', track_volume_quiet: 'test8',
    track_volume_min: 'test8', track_volume_max: 'test8',
    /* test16, not test8: Schwung plans it into TWO pages ("Main" / "Main - 2"),
     * which is what `page_body_p2` needs and what puts more than one segment in
     * the bank bar. A one-page mock would make the pair identical and the second
     * scene assert nothing. */
    page_body: 'test16', page_body_p2: 'test16',
    /* wav_beside_filter: mrsample's real shape (sample_path + a wav_position
     * marker declaring filepath_param), the same mock schwung-sample.mjs
     * reuses — SP-42 is THIS cell drawn through Schwung's own renderer. */
    page_sample: 'wav_beside_filter',
    /* Virtual components (SP-53) — no module port at all, so the mock is
     * irrelevant; movy's own state IS the contract. `test8` only because
     * every OTHER scene needs a named mock and the runner asks for one. */
    page_clipparams: 'test8', page_setparams: 'test8',
    mixer_p1: 'test8', mixer_p2: 'test8', mixer_held: 'test8',
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
const DUMP_BASE = { page_voice_pad: 'voice-poc', page_voice_global: 'voice-poc', page_held_drum: 'simian',
                    page_config_pad: 'forge', page_config_filter: 'forge', page_config_mix: 'forge',
                    page_config_mod: 'forge' };

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
const { drawLeaveModal }   = await import('../dist/esm/renderer/leave-modal-view.js');
const { drawCaptureOverlay } = await import('../dist/esm/renderer/capture-overlay.js');
const { drawQuantOverlay } = await import('../dist/esm/renderer/quant-overlay.js');
const { MSG_NO_KEY, drawPreviewStrip, drawHoldProgress } = await import('../dist/esm/ai/index.js');
const { seqToast, drawSeqToast } = await import('../dist/esm/seq/render.js');
const { drawStepPiano } = await import('../dist/esm/renderer/step-piano.js');
const { stepPianoVM, resetStepPiano } = await import('../dist/esm/seq/step-piano.js');
const { editStepDown, resetStepEdit } = await import('../dist/esm/seq/step-edit.js');
const { renderFlagsView } = await import('../dist/esm/renderer/flags-view.js');
const { renderSetsView }  = await import('../dist/esm/renderer/sets-view.js');
const { buildSetsPageVM } = await import('../dist/esm/seq/sets-page-vm.js');
const { renderCpuView }   = await import('../dist/esm/renderer/cpu-view.js');
const { buildCpuPageVM }  = await import('../dist/esm/seq/cpu-page-vm.js');
const { buildFlagsPageVM } = await import('../dist/esm/seq/flags-page-vm.js');
const { flagsPageState, resetFlagsPage, flagsRowCount } = await import('../dist/esm/seq/flags-page.js');
const { armQuantOverlay, buildQuantOverlayVM, resetQuantOverlay } =
    await import('../dist/esm/seq/quant-overlay.js');
const { drawUndoOverlay } = await import('../dist/esm/renderer/undo-overlay.js');
const { undoToastVM } = await import('../dist/esm/undo/label.js');
const { buildCaptureVM }     = await import('../dist/esm/seq/capture-vm.js');
const { setCaptureStateForTest } = await import('../dist/esm/seq/capture.js');
const { drawVolumeOverlay } = await import('../dist/esm/renderer/volume-overlay.js');
const { volumeFrac }       = await import('../dist/esm/mixer/track-volume.js');
const { dbFrac }           = await import('../dist/esm/mixer/db-ladder.js');
const { renderKnobsView, headerRightText } = await import('../dist/esm/renderer/knob-view.js');
/* The `page` scenes' entry points. Imported here, not statically, for the same
 * reason as every other renderer: the file resolves them after installEnv(). */
const { schwungPageFor, schwungGridReload } =
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
const { CLIP_PARAMS_COMPONENT, MIXER_COMPONENT, SET_PARAMS_COMPONENT, STEP_PARAMS_COMPONENT } = await import('../dist/esm/chain/config.js');
const { schwungBodyFor, schwungBankFor, schwungChromeFor } = await import('../dist/esm/app/tick.js');
const { modulatedKeysOf } = await import('../dist/esm/app/modulated-keys.js');
const { assignLane, resetAutomation } = await import('../dist/esm/seq/automation.js');
const { buildAutomationView } = await import('../dist/esm/app/tick.js');
const { stepPageAvailable, stepPageState } = await import('../dist/esm/seq/step-page.js');
const { schwungLib } = await import('../dist/esm/renderer/schwung-lib.js');
const { movyCtx } = await import('../dist/esm/renderer/schwung-ctx.js');
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
const { headerOnlyVM }     = await import('../dist/esm/seq/header-vm.js');
const { setStepPageSelected, resetStepPage } = await import('../dist/esm/seq/step-page.js');
const { seqState, resetSeqState }      = await import('../dist/esm/seq/state.js');
const { appState }                     = await import('../dist/esm/app/state.js');
const { keyboardState }                = await import('../dist/esm/keyboard/state.js');
const { resetStepRec, stepRecDownAt } = await import('../dist/esm/seq/step-rec.js');
const { stepRecTick }      = await import('../dist/esm/seq/step-rec-view.js');
const { drawSeqHeader, resetSeqHeader, seqHeaderAnnounce, drawLoopStrip, drawSongBand, resetSongBand } =
    await import('../dist/esm/seq/render.js');
const { noteViewTick, resetNoteView, seedNoteViewForTest } = await import('../dist/esm/seq/note-view.js');
const { NOTE_VIEW_SCENES } = await import('./fixtures/note-view-scenes.mjs');
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
/* Automation snapshot: lane 0 bound to knob 0's param. */
function autoView({ held = false, poolFull = false, assignedLanes = 1, heldVal = null, liveVal = null } = {}) {
    const key = model.dumpLayout().params.find(Boolean)?.key;
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
 * N quiet ticks in a row: nine, enough to cover a page cache refill. */
function settle() {
    let idle = 0, total = 0;
    const quietFor = 9;
    while (idle < quietFor && total < 200) {
        const dirty = model.tick();
        if (dirty) lastRender();
        idle = dirty ? 0 : idle + 1;
        total++;
    }
}

function applyView(preset) {
    switch (preset) {
        case 'keys_view':        showKeys(); break;
        /* The three states movy shows before it is live. The failed one names
         * what broke and what the jog click will do, because that click wipes
         * the Set's sequencer state. */
        case 'session_booting':  lastRender = () => renderLoadingView('booting', ''); lastRender(); break;
        case 'session_loading':  lastRender = () => renderLoadingView('loading', ''); lastRender(); break;
        /* The two halves of settling: the Set is loaded but its modules are
         * still arriving one per audio callback, then the tail where their
         * payloads land. */
        case 'session_modules':  lastRender = () => renderLoadingView('settling', '', 7); lastRender(); break;
        case 'session_preparing': lastRender = () => renderLoadingView('settling', '', 0); lastRender(); break;
        case 'session_failed':
            lastRender = () => renderLoadingView('failed', 'SET FILE UNREADABLE', 0, 'set');
            lastRender(); break;
        /* The other failure, and it must not look like the one above: nothing
         * is wrong with the set, and no button here wipes anything. */
        case 'session_failed_mismatch':
            lastRender = () => renderLoadingView('failed', 'ENGINE MISMATCH', 0, 'engine');
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
        /* movy's own Sets (WP4): [NEW], newest first, a duplicate after its
         * source, the open Set's dot at the end, the icon footer. */
        case 'sets_list': {
            const rows = [
                { id: 'c', clips: 3, depth: 0, name: '2026-10-10_02' },
                { id: 'b', clips: 12, depth: 0, name: 'Night Drive' },
                { id: 'b2', clips: 12, depth: 1, name: 'Night Drive Copy' },
                { id: 'a', clips: 0, depth: 0, name: '2026-10-10_01' },
                { id: 'o', clips: 7, depth: 0, name: 'Set 39' },
            ];
            lastRender = () => renderSetsView(buildSetsPageVM(rows, 'b', 2, false));
            lastRender(); break;
        }
        /* A name too long for its count gives up the count, never its end;
         * the open Set keeps its dot either way. */
        case 'sets_long_names': {
            const rows = [
                { id: 'l', clips: 4, depth: 0, name: 'A very long set name that runs out of room' },
                { id: 'm', clips: 9, depth: 0, name: 'Medium length name here' },
                { id: 's', clips: 1, depth: 0, name: 'Short' },
            ];
            lastRender = () => renderSetsView(buildSetsPageVM(rows, 'l', 1, false));
            lastRender(); break;
        }
        case 'sets_confirm': {
            const rows = [
                { id: 'b', clips: 12, depth: 0, name: 'Night Drive' },
                { id: 'a', clips: 0, depth: 0, name: '2026-10-10_01' },
            ];
            lastRender = () => renderSetsView(buildSetsPageVM(rows, 'a', 1, true));
            lastRender(); break;
        }
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
            resetSeqState();
            seqState.clipScaleIdx = 4; seqState.lenSteps = 16; seqState.clipTranspose = 0;
            const three = preset === 'quant-overlay-three';
            seqState.defaultQuant = three ? 70 : 0;
            seqState.clipQuant = three ? 70 : 100;
            armQuantOverlay(Date.now());
            lastRender = () => {
                renderKnobsView(headerOnlyVM('CLIP PARAMETERS'), false, 0);
                drawQuantOverlay(buildQuantOverlayVM());
            };
            lastRender();
            break;
        }
        /* The preview (design §5.2): the candidate in the note view, the
         * selector in the bottom band with the option showing boxed. */
        case 'ai_preview_orig': case 'ai_preview_opt1': case 'ai_preview_opt3': case 'ai_preview_var8': {
            const sc = NOTE_VIEW_SCENES.note_view_chords;
            const idx = { ai_preview_orig: 0, ai_preview_opt1: 1, ai_preview_opt3: 3, ai_preview_var8: 6 }[preset];
            /* Variation's eight with option 5 dropped by the validator:
             * the strip keeps the ladder numbers, option 7 showing. */
            const labels = preset === 'ai_preview_var8' ? ['1', '2', '3', '4', '6', '7', '8'] : ['1', '2', '3'];
            resetSeqState(); resetSeqHeader(); resetNoteView();
            seqState.loopMode = true;
            seqState.loopStart = sc.loopStart; seqState.lenSteps = sc.lenSteps;
            seqState.barOffset = sc.barOffset;
            seqState.playing = true; seqState.posTick = sc.posTick;
            seqState.noteHash = preset;
            seedNoteViewForTest(sc.notes);
            lastRender = () => { clear_screen(); noteViewTick(true); drawPreviewStrip(idx, labels); };
            lastRender();
            break;
        }
        /* An algorithmic option's knob held (design §5): its name and value
         * in the top strip, the note view below it, six options in the band. */
        case 'gen_preview_knob': {
            const sc = NOTE_VIEW_SCENES.note_view_chords;
            resetSeqState(); resetSeqHeader(); resetNoteView();
            seqState.loopMode = true;
            seqState.loopStart = sc.loopStart; seqState.lenSteps = sc.lenSteps;
            seqState.barOffset = sc.barOffset;
            seqState.playing = true; seqState.posTick = sc.posTick;
            seqState.noteHash = preset;
            seedNoteViewForTest(sc.notes);
            seqHeaderAnnounce('HARMONY', 196, 'IV SEQ');
            lastRender = () => { clear_screen(); drawSeqHeader(); noteViewTick(true); drawPreviewStrip(2, ['1', '2', '3', '4', '5', '6']); };
            lastRender();
            break;
        }
        /* Shift + Step 16 held half way to Smart Quantize. */
        case 'ai_hold_progress_50': {
            resetSeqState();
            lastRender = () => { renderKnobsView(model.getViewModel()); drawHoldProgress(0.5, 'SMART QUANTIZE'); };
            lastRender();
            break;
        }
        /* Shift + Step 14 held half way to a Variation. */
        case 'ai_hold_variation_50': {
            resetSeqState();
            lastRender = () => { renderKnobsView(model.getViewModel()); drawHoldProgress(0.5, 'VARIATION'); };
            lastRender();
            break;
        }
        /* Shift + Step 15 held half way to Smart Double. */
        case 'ai_hold_double_50': {
            resetSeqState();
            lastRender = () => { renderKnobsView(model.getViewModel()); drawHoldProgress(0.5, 'SMART DOUBLE'); };
            lastRender();
            break;
        }
        /* Shift + Step 14 held on a track with nothing to vary: a New Clip. */
        case 'ai_hold_newclip_50': {
            resetSeqState();
            lastRender = () => { renderKnobsView(model.getViewModel()); drawHoldProgress(0.5, 'NEW CLIP'); };
            lastRender();
            break;
        }
        /* No key yet: the toast points at the web page that takes one. */
        case 'ai_error_nokey': {
            resetSeqState();
            seqToast(MSG_NO_KEY);
            lastRender = () => { renderKnobsView(model.getViewModel()); drawSeqToast(); };
            lastRender();
            break;
        }
        /* The Settings page. Two states, because the selection band and the
         * hint that follows it are what the page IS — `top` has the selection
         * on BACKUPS, `scrolled` on the LAST row. */
        case 'flags-top':
        case 'flags-scrolled':
        case 'flags-generators':
        case 'flags-genmode': {
            resetFlagsPage();
            const scrolled = preset === 'flags-scrolled';
            flagsPageState.selected = scrolled ? flagsRowCount() - 1 : preset === 'flags-generators' ? 1 : preset === 'flags-genmode' ? 2 : 0;
            lastRender = () => renderFlagsView(buildFlagsPageVM());
            lastRender();
            break;
        }
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
        /* movy's own master chain holding a module: a fourth FX column joins
         * the send region at the narrow pitch, labelled `M`. */
        case 'cpu-master': {
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
            seqState.cpuMaster = preset === 'cpu-master' ? '420/610' : '-';
            seqState.cpuSend =
                preset === 'cpu-sends' || preset === 'cpu-master' ? '760/1180,190/240,-'
                : preset === 'cpu-sends-quiet' ? '0/1180,-,-'
                : '-,-,-';
            lastRender = () => renderCpuView(buildCpuPageVM());
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
        /* Standalone's shutdown dialog: the leave menu, retitled. */
        case 'power_modal': {
            showChain(1, false);
            const base = lastRender;
            lastRender = () => { base(); drawLeaveModal(['Power off', 'Cancel'], 0, 'Power off?'); };
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
            const vm = { title: 'T' + (trk + 1) + ' VOLUME', value: vol, frac: volumeFrac(vol), unityFrac: volumeFrac(1) };
            lastRender = () => { base(); drawVolumeOverlay(vm); };
            lastRender();
            break;
        }
        /* Standalone's knob alone (mixer/master-volume.ts): topped at unity,
         * so the unity mark is the far end. -12 dB is the factory level. */
        case 'master_volume': {
            showChain(1, false, 0);
            const base = lastRender;
            const vol = 10 ** (-12 / 20);
            const vm = { title: 'MASTER VOLUME', value: vol, frac: dbFrac(vol, 0), unityFrac: 1 };
            lastRender = () => { base(); drawVolumeOverlay(vm); };
            lastRender();
            break;
        }
        case 'chain_t2':         showChain(1, false, 1); break;
        case 'chain_t4':         showChain(1, false, 3); break;
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
        case 'note_view_bass': case 'note_view_chords': case 'note_view_drums':
        case 'note_view_plus': case 'note_view_dense': case 'note_view_wide': {
            // Loop mode's folded note view over the strip (seq/note-view.ts):
            // the six cases of the approved mock.
            const sc = NOTE_VIEW_SCENES[preset];
            resetSeqState(); resetSeqHeader(); resetNoteView();
            seqState.loopMode = true;
            seqState.loopStart = sc.loopStart; seqState.lenSteps = sc.lenSteps;
            seqState.barOffset = sc.barOffset;
            seqState.playing = true; seqState.posTick = sc.posTick;
            seqState.noteHash = preset;
            seedNoteViewForTest(sc.notes);
            lastRender = () => { clear_screen(); noteViewTick(true); drawLoopStrip(); };
            lastRender();
            break;
        }
        /* The held-step piano under the knob view, from the real VM: a held
         * step and its notes as the engine reports them. One scene per zoom
         * (5/4/3/2 px slots), plus filled neighbours and an empty step. */
        case 'step_piano_triad': case 'step_piano_adjacent': case 'step_piano_wide':
        case 'step_piano_spread': case 'step_piano_empty': {
            const notes = {
                step_piano_triad: [60, 64, 67], step_piano_adjacent: [60, 61, 62, 63, 64, 66],
                step_piano_wide: [40, 55, 62, 71], step_piano_spread: [31, 50, 66, 73, 81, 90],
                step_piano_empty: [],
            }[preset];
            resetSeqState(); resetStepEdit(); resetStepPiano();
            editStepDown(2);
            seqState.holdStep = 2; seqState.holdNotes = notes;
            const vm = stepPianoVM();
            resetStepEdit();
            lastRender = () => { renderKnobsView(model.getViewModel()); drawStepPiano(vm); };
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
        /* The undo toast over the Clip Params page: it is drawn after every view
         * branch, so a page that is not the chain view still shows it. */
        case 'clip-undo-toast': {
            resetSeqState();
            seqState.clipScaleIdx = 4; seqState.lenSteps = 16; seqState.clipTranspose = 0;
            const vm = undoToastVM(
                { ok: true, verb: 'CLIP LENGTH', target: 'T1', detail: '16 -> 9' }, false);
            lastRender = () => { renderKnobsView(headerOnlyVM('CLIP PARAMETERS'), false, 0); drawUndoOverlay(vm); };
            lastRender();
            break;
        }
        case 'lfo_chain':
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
        case 'mix_page_chain': {
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
            lastRender = () => renderChainView(mx.getViewModel(), 5, false, 'T' + (mtrk + 1), 'MIX');
            lastRender();
            globalThis.host_module_get_param = oldGet;
            break;
        }
        /* The master chain's own LFO page: same eight positions, but knob 7 is
         * blank — the master bus has no notes to retrigger on. */
        case 'lfo_master_chain': {
            env.setParams({
                'mfx:fx1:chain_params': JSON.stringify([{ key: 'mix', name: 'Mix', type: 'float' }]),
                'mfx:lfo1:sync': '0', 'mfx:lfo1:rate_hz': '2.0',
                'mfx:lfo1:depth': '0.65', 'mfx:lfo1:shape': '0',
                'mfx:lfo1:polarity': '1', 'mfx:lfo1:phase_offset': '0',
                'mfx:lfo1:target': 'fx1', 'mfx:lfo1:target_param': 'mix',
            });
            resetPorts();
            const mlm = createScopedLfoModel(masterScope());
            mlm.tick();
            lastRender = () => renderChainView(mlm.getViewModel(), MASTER_LFO_INDEX, false, 'MASTER', 'LFO', MASTER_FX_SLOTS);
            lastRender();
            break;
        }
        case 'lfo_assign_toast': {
            loadPreset('test8');
            for (let i = 0; i < 6; i++) chainModels[1].tick();
            const realNow = Date.now; let t = 1000; Date.now = () => t;
            resetAssignMode();
            /* The hold needs the param's facts, as the page's knobParamInfo gives them. */
            const p0 = chainModels[1].dumpLayout().params.find(Boolean);
            holdTouch(trackScope(0), 0, { ...p0, gi: 0, ioKey: p0.key, target: 'synth', value: p0.min });
            t = 2100; holdTick();
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
        case 'page_voice_pad':
        case 'page_voice_global':
        case 'page_config_pad':
        case 'page_config_filter':
        case 'page_config_mix':
        case 'page_config_mod': {
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
            /* THE SAME RACK ON ITS REVERB PAGE, which no pad press re-targets:
             * the header draws no pad icon there — the seat's answer. */
            if (preset === 'page_voice_global') {
                const onReverb = () => /reverb/i.test(sp.ctl.pages[sp.ctl.pageIndex]?.name || '');
                for (let i = 0; i < sp.pageCount && !onReverb(); i++) { sp.goToPage(i); sp.tick(); model.tick(); }
                if (!onReverb()) throw new Error('page_voice_global: voice-poc no longer plans a Reverb page');
                model.updateDrumPad(2, 38);
                if (sp.chrome(true).padScoped) throw new Error(
                    'page_voice_global: the seat calls Reverb a per-pad page');
            }
            /* A CONFIG RACK'S PER-PAD BANK (drum plan §7): forge plans from
             * movy's config, has no declared voices for the seat, and still
             * draws the pad icon on Osc, which is a `padSpecific` bank. */
            /* ...and its config's graphic tags as Schwung's `viz`: Filter's
             * cutoff/resonance/mode as a filter response, Mix's bars as faders. */
            const CONFIG_PAGE = { page_config_pad: 'Osc', page_config_filter: 'Filter', page_config_mix: 'Mix',
                                  page_config_mod: 'Mod' };
            if (CONFIG_PAGE[preset]) {
                const want = CONFIG_PAGE[preset];
                const onIt = () => sp.ctl.pages[sp.ctl.pageIndex]?.name === want;
                for (let i = 0; i < sp.ctl.pages.length && !onIt(); i++) { sp.goToPage(i); sp.tick(); model.tick(); }
                if (!onIt()) throw new Error(`${preset}: forge no longer plans a ${want} page`);
                model.updateDrumPad(3, 38);
                for (let i = 0; i < 4; i++) { sp.tick(); model.tick(); }
                if (preset === 'page_config_pad' && !sp.chrome(true).padScoped) throw new Error(
                    'page_config_pad: the chrome does not call Osc a per-pad page');
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
            break;
        }

        /* SP-60: the LFO chain slot under `page` draws SCHWUNG'S OWN LFO page
         * (Slot Settings / Master FX Settings'), not movy's lookalike — the
         * waveform across the second row, one Rate cell chosen by Sync, and
         * Target named. Track: LFO 1 free-running into the synth's Cutoff.
         * Master: LFO 2 synced, on the chain view's frame. */
        /* Schwung's enum list (picker and peek) drawn through MOVY's ctx, whose
         * 5px face declares its height so the rows are sized to it: 7px rows,
         * the text centred in the highlight, six options on screen. */
        case 'page_enum_list': {
            const opts = ['16 bar', '8 bar', '4 bar', '2 bar', '1/1', '1/2', '1/4', '1/8', '1/16', '1/32'];
            lastRender = () => {
                clear_screen();
                schwungLib().drawEnumList(movyCtx(), {
                    title: 'Rate', headerRight: 'SELECT', options: opts, index: 6, markIndex: 5,
                    footer: [['BACK', 'CANCEL'], ['CLICK', 'SET']],
                });
            };
            lastRender();
            break;
        }

        case 'page_lfo':
        case 'page_lfo_master': {
            const master = preset === 'page_lfo_master';
            const P = master ? 'mfx:' : '';
            env.setParams({
                'synth:chain_params': JSON.stringify([{ key: 'cutoff', name: 'Cutoff', type: 'float' }]),
                'mfx:fx1:chain_params': JSON.stringify([{ key: 'mix', name: 'Mix', type: 'float' }]),
                [P + 'lfo1:sync']: '0', [P + 'lfo1:rate_hz']: '2.0', [P + 'lfo1:depth']: '0.65',
                [P + 'lfo1:shape']: '0', [P + 'lfo1:polarity']: '1', [P + 'lfo1:enabled']: '1',
                [P + 'lfo1:target']: master ? 'fx1' : 'synth',
                [P + 'lfo1:target_param']: master ? 'mix' : 'cutoff',
                [P + 'lfo2:sync']: '1', [P + 'lfo2:rate_div']: '19', [P + 'lfo2:shape']: '3',
                [P + 'lfo2:depth']: '-0.4', [P + 'lfo2:polarity']: '0', [P + 'lfo2:enabled']: '0',
            });
            resetPorts();
            schwungGridReload();
            const ck = P + 'lfo';
            const sp = schwungPageFor(0, ck);
            for (let i = 0; i < 12 * 60 && !sp.ready; i++) sp.tick();
            if (!sp.ready) throw new Error(preset + ': the contract never resolved');
            if (master) sp.goToPage(1);
            for (let i = 0; i < 40; i++) sp.tick();
            const lm = master ? createScopedLfoModel(masterScope()) : createLfoModel(0);
            lm.tick();
            lastRender = master
                ? () => renderChainView(lm.getViewModel(), MASTER_LFO_INDEX, false, 'MASTER', 'LFO',
                                        MASTER_FX_SLOTS, () => sp.render(''), sp.chrome(false))
                : () => renderKnobsView(lm.getViewModel(), false, 0, () => sp.render('T1 > LFO'),
                                        { index: sp.pageIndex, count: sp.pageCount }, sp.chrome(true));
            lastRender();
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
            schwungGridReload();
            const sp = schwungPageFor(0, 'synth');
            for (let i = 0; i < 12 * 60 && !sp.ready; i++) { sp.tick(); model.tick(); }
            if (!sp.ready) throw new Error(preset + ': the contract never resolved');
            const mfx1 = MASTER_FX_SLOTS.findIndex((sl) => sl.componentKey === 'mfx:fx1');
            lastRender = () => renderChainView(model.getViewModel(), mfx1, false, 'MASTER',
                MASTER_FX_SLOTS[mfx1].label, MASTER_FX_SLOTS,
                () => sp.render(''), sp.chrome(false));
            lastRender();
            break;
        }

        /* SP-42: the sample cell drawn through SCHWUNG'S OWN render path
         * (viz_draw.mjs's drawSample), not movy's — that path already has
         * baselines (wav_sample/wav_loop/wav_beside_filter). A waveform is
         * pixels, so this is the only baseline that can show the difference
         * between "wired" and "the flat no-envelope fallback" by eye. */
        case 'page_sample': {
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
            resetSeqState();
            seqState.clipScaleIdx = 4; seqState.lenSteps = 16; seqState.clipTranspose = 0;
            schwungGridReload();
            const owner = pageOwnerForComponent(CLIP_PARAMS_COMPONENT);
            for (let i = 0; i < 12 * 60 && !owner.page; i++) owner.poll();
            if (!owner.page) throw new Error(preset + ': the contract never resolved');
            const body = schwungBodyFor(owner, false);
            if (!body) throw new Error(preset + ': claimed but no body — schwungBodyFor declined');
            lastRender = () => renderKnobsView(headerOnlyVM('CLIP PARAMETERS'), false, 0,
                body, schwungBankFor(owner, body), schwungChromeFor(owner, body, false));
            lastRender();
            break;
        }
        case 'page_setparams': {
            resetSeqState();
            keyboardState.rootPc = 0; keyboardState.octave = [4, 4, 4, 4];
            keyboardState.mode = 0; keyboardState.layout = 0; keyboardState.scale = 0;
            seqState.bpmX100 = 12000; seqState.swingPct = 50;
            schwungGridReload();
            const owner = pageOwnerForComponent(SET_PARAMS_COMPONENT);
            for (let i = 0; i < 12 * 60 && !owner.page; i++) owner.poll();
            if (!owner.page) throw new Error(preset + ': the contract never resolved');
            const body = schwungBodyFor(owner, false);
            if (!body) throw new Error(preset + ': claimed but no body — schwungBodyFor declined');
            lastRender = () => renderKnobsView(headerOnlyVM('SET PARAMETERS'), false, 0,
                body, schwungBankFor(owner, body), schwungChromeFor(owner, body, false));
            lastRender();
            break;
        }
        /* SP-54: the step page under `page` — same shape as its two siblings
         * above (a virtual component with no module port), through the same
         * `pageOwnerForComponent` accessor `app/tick.ts` uses. `vm` still
         * comes from `buildStepPageVM` (the header fallback and the "step is
         * a bank of its own" bar read it regardless of who draws the body —
         * see `app/tick.ts`'s own comment on this), only its ROWS are
         * replaced by Schwung's `body`. */
        /* The Session mixer: Schwung's custom page, movy's strips. One meter
         * text for all three — fader crossings (3, 5, 7, 11, 14, 16), a
         * silent track (10) and a fader above unity (13). */
        case 'mixer_p1': case 'mixer_p2': case 'mixer_held': {
            resetSeqState();
            const mix = [[0, 2, -1], [-3, -10, -9], [-6, -2, -4], [-1.5, -4, -5], [-12, -6, -9],
                [-9, -30, -28], [-4.5, -1, -3], [0, -2, -3], [-6, -12, -12], [-99, -99, -99],
                [-18, -10, -14], [-3, -7, -6], [2, -1, -2], [-24, -16, -19], [-7.5, -15, -14], [-10, -4, -8]];
            const byte = (db) => db <= -60 ? 0 : Math.round(1 + (db + 60) * 2);
            seqState.mixMeter = mix.flat().map((db) => byte(db).toString(16).padStart(2, '0')).join('');
            schwungGridReload();
            const owner = pageOwnerForComponent(MIXER_COMPONENT);
            for (let i = 0; i < 12 * 60 && !owner.page; i++) owner.poll();
            if (!owner.page) throw new Error(preset + ': the contract never resolved');
            if (preset === 'mixer_p2') { owner.page.changePage(1); for (let i = 0; i < 30; i++) owner.poll(); }
            if (preset === 'mixer_held') owner.page.knobTouch(2, true);
            const body = schwungBodyFor(owner, false);
            if (!body) throw new Error(preset + ': claimed but no body — schwungBodyFor declined');
            lastRender = () => renderKnobsView(headerOnlyVM('MIXER'), false, 0,
                body, schwungBankFor(owner, body), schwungChromeFor(owner, body, false));
            lastRender();
            if (preset === 'mixer_held') owner.page.knobTouch(2, false);
            break;
        }
        case 'page_stepparams': {
            resetSeqState(); resetStepPage();
            seqState.holdVel = 100; seqState.holdGate = 96; seqState.holdGateMixed = false;
            seqState.holdProb = 100; seqState.holdCondA = 1; seqState.holdCondB = 1;
            seqState.holdInvert = false;
            setStepPageSelected(true);
            schwungGridReload();
            const owner = pageOwnerForComponent(STEP_PARAMS_COMPONENT);
            for (let i = 0; i < 12 * 60 && !owner.page; i++) owner.poll();
            if (!owner.page) throw new Error(preset + ': the contract never resolved');
            const body = schwungBodyFor(owner);
            if (!body) throw new Error(preset + ': claimed but no body — schwungBodyFor declined');
            lastRender = () => renderKnobsView(buildStepPageVM(), false, 0,
                body, schwungBankFor(owner, body), schwungChromeFor(owner, body, false));
            lastRender();
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
        case 'page_held_enum':
        case 'page_lane_unheld':
        case 'page_held_unassignable': {
            const modded = preset === 'page_mod_cell' || preset === 'page_mod_cell_held';
            /* `modulatedKeysOf` resolves the model through `appState.trackModels`
             * — the registry `app/init.ts` fills and the one production runs on
             * — so the scene has to be under it too, or it would be grading a
             * lookup that never finds anything. Restored on the way out: other
             * scenes read this. */
            const savedModels = appState.trackModels;
            appState.trackModels = [chainModels];
            try {
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
                } else if (preset === 'page_held_lock' || preset === 'page_held_enum') {
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
                    /* `page_held_enum`: an enum lock is its OPTION INDEX (D14) —
                     * HP, two past the LP the page shows at rest. */
                    const heldVal = preset === 'page_held_enum' ? 2 : info.max;
                    const auto = { ...autoView({ held: true, heldVal }),
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
         * The cell wears #541's 2x2 beside its label and no tilde, the
         * pointer at the base and the dot on the lane. `_held` adds the step:
         * the lock's value where the name was (inverted, #509), the mark
         * beside it. */
        case 'page_lane_mark':
        case 'page_lane_mark_held': {
            const savedModels = appState.trackModels;
            appState.trackModels = [chainModels];
            try {
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
                seqState.autoActive = 0;
                resetAutomation();
                appState.trackModels = savedModels;
            }
            break;
        }
        /* ── page_held_drum (drum-modules plan, Phase 3) ───────────────────────
         * A held step on a TEMPLATE drum rack's per-pad page: simian, pad 3's
         * Tone page, the lock on pad 3's own `pad3_tune`. The cell is a template
         * (`tune`) the controller resolves per pad, and before Phase 3 the lane
         * bound that template — it played into whichever pad had focus, and the
         * decoration matched every pad's page alike. Everything here is the
         * app's own path: the owner's page, a lane in the real registry, the
         * automation view `app/tick.ts` builds. Bound to the template again,
         * the scene throws; decorated by template, the cell loses its lock. */
        case 'page_held_drum': {
            const savedModels = appState.trackModels;
            appState.trackModels = [chainModels];
            try {
                schwungGridReload();
                resetAutomation();
                for (let i = 0; i < 20; i++) model.tick();
                const sp = pageOwnerOf(model).page;
                if (!sp) throw new Error(preset + ': the page is not delegated');
                for (let i = 0; i < 12 * 60 && !sp.ready; i++) { sp.tick(); model.tick(); }
                if (!sp.ready) throw new Error(preset + ': the contract never resolved');
                if (!sp.focusVoice(3)) throw new Error(preset + ': pad 3 has no page');
                model.updateDrumPad(3, 3);
                for (let i = 0; i < 24; i++) { sp.tick(); model.tick(); }
                const slot = sp.ctl.page.keys.indexOf('tune');
                if (slot < 0) throw new Error(preset + ': no tune cell on ' + sp.ctl.page.name);
                const info = pageOwnerOf(model).knobParamInfo(slot);
                if (!info || info.ioKey !== 'pad3_tune') throw new Error(
                    preset + ': the lane binds ' + (info && info.ioKey) + ', not pad 3’s own pad3_tune');
                const lane = assignLane(0, 0, info, () => true);
                if (lane < 0) throw new Error(preset + ': no lane');
                seqState.autoActive |= 1 << lane;
                seqState.stepAutoMode = true;
                seqState.heldLocks = new Map([[lane, 127]]);
                for (let i = 0; i < 80; i++) { sp.tick(); model.tick(); }
                lastRender = () => {
                    const auto = buildAutomationView(0, model);
                    renderKnobsView(model.getViewModel(auto), false, 0,
                        () => sp.render('T1 > ' + model.getModuleName(), auto),
                        { index: sp.pageIndex, count: sp.pageCount }, sp.chrome(true));
                };
                lastRender();
            } finally {
                seqState.autoActive = 0;
                seqState.stepAutoMode = false;
                seqState.heldLocks = new Map();
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
        case 'page_chrome_flip':
        case 'page_chrome_file': {
            const savedModels = appState.trackModels;
            appState.trackModels = [chainModels];
            try {
                schwungGridReload();
                const sp = schwungPageFor(0, 'synth');
                for (let i = 0; i < 12 * 60 && !sp.ready; i++) { sp.tick(); model.tick(); }
                if (!sp.ready) throw new Error(preset + ': the contract never resolved');

                /* By KEY, not by slot: which cell a param lands in is the
                 * planner's business, and a scene pinned to slot 0 would keep
                 * rendering green if the planner moved it. */
                /* A trigger and a two-way draw NO hint — the knob does what
                 * the click would — and a file is the one cell that keeps it. */
                const WANT = { page_chrome_held: 'rnd_patch', page_chrome_flip: 'legato',
                               page_chrome_file: 'sample_path' }[preset];
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


    clear_screen();
    nowOverride = null;            // every scene starts on the real clock
    /* A READER CHANGES WHAT THE MODEL BELIEVES EVERY MODULE DECLARED, so it is
     * registered for the one scene that needs it and cleared for every other:
     * each baseline in this file was written with no reader at all, which is
     * also the state a real movy boots in until `app/globals.ts` runs. */
    setSurfaceReader(preset === 'page_voice_pad' || preset === 'page_voice_global' || preset === 'page_held_drum' ? surfaceOf : null);
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
