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
import { portFor } from '../dist/esm/track/registry.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { installEnv } from './env.mjs';

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
    'session_booting', 'session_loading', 'session_failed',
    'obxd_preset_page', 'obxd_main_page', 'obxd_filter_page',
    'items_cell', 'items_overlay',
    'lfo_prefix', 'collide_osc',
    'chain_synth', 'chain_empty', 'chain_jog_toast', 'knobs_jog_toast',
    'chain_t2', 'chain_t4',
    'lfo_chain', 'lfo_lfo1', 'lfo_lfo2', 'lfo_target_overlay', 'lfo_viz_unipolar', 'lfo_viz_retrig',
    'lfo_master', 'lfo_master_chain',
    'lfo_mod_mark', 'lfo_mod_and_auto', 'lfo_assign_toast',
    'drum-mrdrums-pad5', 'drum-mrdrums-global',
    'chordism-chordb', 'sfz-amp',
    'params-overflow-page', 'params-extras-settings',
    'bankbar-mid', 'bankbar-surge', 'bankbar-dense',
    'auto_dot', 'auto_held', 'auto_live', 'auto_limit',
    'step_page_knobs', 'step_page_chain', 'step_indicator', 'step_rec_header',
    'loop_strip_midclip', 'loop_strip_outside', 'loop_header',
    'main-default', 'main-tempo-touched', 'main-swing-touched',
    'main-root-touched', 'main-key-overlay', 'main-mode-overlay', 'main-layout-overlay',
    'main-ext-sync', 'main-link-on',
    'clip-default', 'clip-fraction', 'clip-overlay', 'clip-drum', 'clip-quant',
    'main-quant', 'quant-overlay-three', 'quant-overlay-two',
    'flags-top', 'flags-scrolled',
    'env_dual', 'env_touched', 'env_ad', 'env_asr', 'lfo_mod',
    'filter_lp', 'filter_lp_reso', 'filter_hp', 'filter_bp', 'filter_notch',
    'filter_slope24', 'filter_dual', 'filter_open',
    'deep_page', 'lfo_helm_step', 'lfo_helm_pyramid',
    'signal_voice', 'forge_voice', 'forge_filter', 'forge_mod', 'forge_send', 'forge_mix',
    'leave_modal', 'capture_select', 'capture_fixed',
    'undo_toast', 'redo_toast', 'undo_empty', 'undo_unavailable', 'clip-undo-toast',
    'track_volume_unity', 'track_volume_quiet', 'track_volume_min', 'track_volume_max',
    'trigger_armed', 'trigger_fired', 'trigger_blink_off', 'trigger_touched',
    'trigger_cooling', 'trigger_cooling_low',
    'font_5x3_all', 'font_small_all', 'font_big_all_1', 'font_big_all_2',
    'wave_cells', 'wave_overlay', 'wave_helm', 'wave_toggles',
    'env_stages', 'eq_bands', 'cut_filters', 'faders', 'wav_sample', 'wav_loop', 'wav_loop_off', 'wav_beside_filter',
    'switches', 'spray_saturated',
];

/* Which mock preset backs each (possibly synthetic) screenshot. */
const BASE = {
    enum_overlay: 'plaits', knob_toast: 'test8', no_params: 'no_params',
    keys_view: 'test8', browse_view: 'test8',
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
    'flags-top': 'test8', 'flags-scrolled': 'test8',
    trigger_armed: 'triggers', trigger_fired: 'triggers',
    trigger_blink_off: 'triggers', trigger_touched: 'triggers',
    trigger_cooling: 'triggers', trigger_cooling_low: 'triggers',
    env_dual: 'env_dual', env_touched: 'env_dual', env_ad: 'env_ad', env_asr: 'env_asr', lfo_mod: 'lfo_mod',
    filter_lp: 'filter_demo', filter_lp_reso: 'filter_demo', filter_hp: 'filter_demo',
    filter_bp: 'filter_demo', filter_notch: 'filter_demo', filter_slope24: 'filter_demo',
    filter_dual: 'filter_dual', filter_open: 'filter_demo',
    deep_page: 'hier_knobs_and_children',
    lfo_helm_step: 'lfo_helm', lfo_helm_pyramid: 'lfo_helm',
    wave_cells: 'wave_cells', wave_overlay: 'wave_cells', wave_helm: 'helm_waves',
    wave_toggles: 'wave_toggles', env_stages: 'env_stages', eq_bands: 'eq_bands', cut_filters: 'cut_filters',
    faders: 'faders', switches: 'switches',
    spray_saturated: 'wav_sample', wav_sample: 'wav_sample', wav_loop: 'wav_loop', wav_loop_off: 'wav_loop',
    wav_beside_filter: 'wav_beside_filter',
    signal_voice: 'signal', forge_voice: 'forge',
    forge_filter: 'forge', forge_mod: 'forge', forge_send: 'forge', forge_mix: 'forge',
    lfo_chain: 'test8', lfo_lfo1: 'test8', lfo_lfo2: 'test8',
    lfo_target_overlay: 'test8', lfo_viz_unipolar: 'test8', lfo_viz_retrig: 'test8',
    lfo_mod_mark: 'test8', lfo_mod_and_auto: 'test8', lfo_assign_toast: 'test8',
    leave_modal: 'test8',
    track_volume_unity: 'test8', track_volume_quiet: 'test8',
    track_volume_min: 'test8', track_volume_max: 'test8',
};

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
const { buildFlagsPageVM } = await import('../dist/esm/seq/flags-page-vm.js');
const { flagsPageState, resetFlagsPage } = await import('../dist/esm/seq/flags-page.js');
const { FLAGS } = await import('../dist/esm/seq/flags-def.js');
const { setFlag, resetFlags } = await import('../dist/esm/seq/flags.js');
const { armQuantOverlay, buildQuantOverlayVM, resetQuantOverlay } =
    await import('../dist/esm/seq/quant-overlay.js');
const { drawUndoOverlay } = await import('../dist/esm/renderer/undo-overlay.js');
const { undoToastVM } = await import('../dist/esm/undo/label.js');
const { buildCaptureVM }     = await import('../dist/esm/seq/capture-vm.js');
const { setCaptureStateForTest } = await import('../dist/esm/seq/capture.js');
const { drawVolumeOverlay } = await import('../dist/esm/renderer/volume-overlay.js');
const { volumeFrac }       = await import('../dist/esm/mixer/track-volume.js');
const { renderKnobsView }  = await import('../dist/esm/renderer/knob-view.js');
const { renderKeysView }   = await import('../dist/esm/renderer/keys-view.js');
const { renderLoadingView } = await import('../dist/esm/renderer/loading-view.js');
const { renderBrowseView } = await import('../dist/esm/renderer/browse-view.js');
const { renderChainView }  = await import('../dist/esm/renderer/chain-view.js');
const { buildStepPageVM }  = await import('../dist/esm/seq/step-page-vm.js');
const { buildMainPageVM }  = await import('../dist/esm/seq/main-page-vm.js');
const { mainPageState, resetMainPage } = await import('../dist/esm/seq/main-page.js');
const { buildClipPageVM }  = await import('../dist/esm/seq/clip-page-vm.js');
const { clipPageState, resetClipPage } = await import('../dist/esm/seq/clip-page.js');
const { seqState, resetSeqState }      = await import('../dist/esm/seq/state.js');
const { appState }                     = await import('../dist/esm/app/state.js');
const { keyboardState }                = await import('../dist/esm/keyboard/state.js');
const { resetStepRec, stepRecDownAt } = await import('../dist/esm/seq/step-rec.js');
const { stepRecTick }      = await import('../dist/esm/seq/step-rec-view.js');
const { drawSeqHeader, resetSeqHeader, drawLoopStrip, drawLoopHeader } =
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
    env.setParams(MOCK_SYNTHS[id]);
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
 * deterministic settle: 5 clean ticks, or a 200-tick cap). Only the synth
 * model ticks — matching the harness rAF loop — so chain slots that were never
 * ticked render as empty. */
function settle() {
    let idle = 0, total = 0;
    while (idle < 5 && total < 200) {
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
        case 'session_failed':
            lastRender = () => renderLoadingView('failed', 'ENGINE DID NOT START'); lastRender(); break;
        case 'browse_view':      showBrowse([{ name: 'Plaits' }, { name: 'Wurl' }, { name: 'Bass' }], 1); break;
        /* Trigger badge phases. Time is frozen so the fired flash and two drain
         * positions are deterministic; the drain is what makes the re-arm
         * debounce visible, so it needs more than one sample pinned. */
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
        case 'obxd_preset_page': forceRender(); break;                       // page 0
        case 'obxd_main_page':   model.changePage(1); forceRender(); break;
        case 'obxd_filter_page': model.changePage(3); forceRender(); break;
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
        /* The Global Params flags page (debug builds only). Two states, because
         * the value column and the selection band are what the page IS: `top`
         * has the selection on row 0 with the list unscrolled, `scrolled` puts
         * it on the last flag with a value that is not the default, so a row
         * whose number stopped tracking its flag shows up as a diff. */
        case 'flags-top':
        case 'flags-scrolled': {
            resetFlags(); resetFlagsPage();
            const scrolled = preset === 'flags-scrolled';
            setFlag('chparallel', scrolled ? 1 : 0);
            setFlag('chlanes', scrolled ? 4 : 3);
            setFlag('chpin', scrolled ? 1 : 0);
            flagsPageState.selected = scrolled ? FLAGS.length - 1 : 0;
            lastRender = () => renderFlagsView(buildFlagsPageVM());
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

let pass = 0, fail = 0;

for (const preset of PRESETS) {
    process.stdout.write(`  ${preset} ... `);

    clear_screen();
    nowOverride = null;            // every scene starts on the real clock
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

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
