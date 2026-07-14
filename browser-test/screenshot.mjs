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
    'test8', 'test16', 'test_enum', 'plaits', 'wurl',
    'enum_overlay', 'knob_toast', 'no_params', 'keys_view', 'browse_view',
    'obxd_preset_page', 'obxd_main_page', 'obxd_filter_page',
    'lfo_prefix',
    'chain_synth', 'chain_empty', 'chain_jog_toast', 'knobs_jog_toast',
    'chain_t2', 'chain_t4',
    'lfo_chain', 'lfo_lfo1', 'lfo_lfo2', 'lfo_target_overlay', 'lfo_viz_unipolar', 'lfo_viz_retrig',
    'lfo_mod_mark', 'lfo_mod_and_auto', 'lfo_assign_toast',
    'drum-mrdrums-pad5', 'drum-mrdrums-global',
    'auto_dot', 'auto_held', 'auto_live', 'auto_limit',
    'step_page_knobs', 'step_page_chain', 'step_indicator',
    'main-default', 'main-tempo-touched', 'main-swing-touched',
    'main-root-touched', 'main-key-overlay', 'main-ext-sync',
    'clip-default', 'clip-fraction', 'clip-overlay',
    'env_dual', 'env_touched',
    'leave_modal',
];

/* Which mock preset backs each (possibly synthetic) screenshot. */
const BASE = {
    enum_overlay: 'plaits', knob_toast: 'test8', no_params: 'no_params',
    keys_view: 'test8', browse_view: 'test8',
    obxd_preset_page: 'obxd_like', obxd_main_page: 'obxd_like', obxd_filter_page: 'obxd_like',
    chain_synth: 'test8', chain_empty: 'test8', chain_jog_toast: 'test8',
    knobs_jog_toast: 'test8', chain_t2: 'test8', chain_t4: 'test8',
    'drum-mrdrums-pad5': 'mrdrums', 'drum-mrdrums-global': 'mrdrums',
    auto_dot: 'test8', auto_held: 'test8', auto_live: 'test8', auto_limit: 'test8',
    step_page_knobs: 'test8', step_page_chain: 'test8', step_indicator: 'test8',
    'main-default': 'test8', 'main-tempo-touched': 'test8',
    'main-swing-touched': 'test8', 'main-root-touched': 'test8',
    'main-key-overlay': 'test8', 'main-ext-sync': 'test8',
    'clip-default': 'test8', 'clip-fraction': 'test8', 'clip-overlay': 'test8',
    env_dual: 'env_dual', env_touched: 'env_dual',
    lfo_chain: 'test8', lfo_lfo1: 'test8', lfo_lfo2: 'test8',
    lfo_target_overlay: 'test8', lfo_viz_unipolar: 'test8', lfo_viz_retrig: 'test8',
    lfo_mod_mark: 'test8', lfo_mod_and_auto: 'test8', lfo_assign_toast: 'test8',
    leave_modal: 'test8',
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
const { createLfoModel }   = await import('../dist/esm/lfo/model.js');
const { holdTouch, holdTick, assignToastText, resetAssignMode } = await import('../dist/esm/lfo/assign-mode.js');
const { drawJogToast }     = await import('../dist/esm/renderer/overlay.js');
const { drawLeaveModal }   = await import('../dist/esm/renderer/leave-modal-view.js');
const { renderKnobsView }  = await import('../dist/esm/renderer/knob-view.js');
const { renderKeysView }   = await import('../dist/esm/renderer/keys-view.js');
const { renderBrowseView } = await import('../dist/esm/renderer/browse-view.js');
const { renderChainView }  = await import('../dist/esm/renderer/chain-view.js');
const { buildStepPageVM }  = await import('../dist/esm/seq/step-page-vm.js');
const { buildMainPageVM }  = await import('../dist/esm/seq/main-page-vm.js');
const { mainPageState, resetMainPage } = await import('../dist/esm/seq/main-page.js');
const { buildClipPageVM }  = await import('../dist/esm/seq/clip-page-vm.js');
const { clipPageState, resetClipPage } = await import('../dist/esm/seq/clip-page.js');
const { seqState, resetSeqState }      = await import('../dist/esm/seq/state.js');
const { keyboardState }                = await import('../dist/esm/keyboard/state.js');
const { MOCK_SYNTHS }      = await import('./mock-synth.mjs');

const COMPONENT_KEYS = ['midi_fx1', 'synth', 'fx1', 'fx2'];
const chainModels = COMPONENT_KEYS.map(k => createModel(0, k));
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
        case 'knob_toast':       model.handleKnobTouch(2); forceRender(); break;
        case 'keys_view':        showKeys(); break;
        case 'browse_view':      showBrowse([{ name: 'Plaits' }, { name: 'Wurl' }, { name: 'Bass' }], 1); break;
        case 'env_dual':    forceRender(); break;
        case 'env_touched': model.handleKnobTouch(2); forceRender(); break;   // touch Sustain
        case 'obxd_preset_page': forceRender(); break;                       // page 0
        case 'obxd_main_page':   model.changePage(1); forceRender(); break;
        case 'obxd_filter_page': model.changePage(3); forceRender(); break;
        case 'chain_synth':      showChain(1, false); break;
        case 'chain_empty':      showChain(2, false); break;                 // fx1 = empty
        case 'chain_jog_toast':  showChain(1, true); break;
        case 'knobs_jog_toast':  showKnobsJogToast(); break;
        case 'leave_modal': {
            showChain(1, false);
            const base = lastRender;
            lastRender = () => { base(); drawLeaveModal(['Background', 'Close Movy'], 0); };
            lastRender();
            break;
        }
        case 'chain_t2':         showChain(1, false, 1); break;
        case 'chain_t4':         showChain(1, false, 3); break;
        case 'drum-mrdrums-pad5':   model.tick(); model.tick(); model.updateDrumPad(5, 76); forceRender(); break;
        case 'drum-mrdrums-global': model.tick(); model.tick(); model.changePage(1); forceRender(); break;
        case 'auto_dot':         showKnobsAuto(autoView()); break;
        case 'auto_held':        showKnobsAuto(autoView({ held: true, heldVal: model.getKnobParamInfo(0).max })); break;
        case 'auto_live':        showKnobsAuto(autoView({ held: false, liveVal: model.getKnobParamInfo(0).max })); break;
        case 'auto_limit':       showKnobsAuto(autoView({ held: true, poolFull: true, assignedLanes: 0xFF })); break;
        case 'step_page_knobs':  lastRender = () => renderKnobsView(buildStepPageVM(STEP_VM_A, 4), false, 0); lastRender(); break;
        case 'step_page_chain':  lastRender = () => renderChainView(buildStepPageVM(STEP_VM_B), 1, false, 'T1'); lastRender(); break;
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
        case 'main-default': {
            resetSeqState(); resetMainPage();
            keyboardState.rootNote = 48; keyboardState.scale = 0;
            seqState.bpmX100 = 12000; seqState.swingPct = 50;
            lastRender = () => renderKnobsView(buildMainPageVM(), false, 0);
            lastRender();
            break;
        }
        case 'main-tempo-touched': {
            resetSeqState(); resetMainPage();
            keyboardState.rootNote = 48; keyboardState.scale = 0;
            seqState.bpmX100 = 12000; seqState.swingPct = 50;
            mainPageState.touchedKnob = 0;
            lastRender = () => renderKnobsView(buildMainPageVM(), false, 0);
            lastRender();
            break;
        }
        case 'main-swing-touched': {
            resetSeqState(); resetMainPage();
            keyboardState.rootNote = 48; keyboardState.scale = 0;
            seqState.bpmX100 = 12000; seqState.swingPct = 50;
            mainPageState.touchedKnob = 1;
            lastRender = () => renderKnobsView(buildMainPageVM(), false, 0);
            lastRender();
            break;
        }
        case 'main-root-touched': {
            resetSeqState(); resetMainPage();
            keyboardState.rootNote = 51; keyboardState.scale = 0;   // D#
            seqState.bpmX100 = 12000; seqState.swingPct = 50;
            mainPageState.touchedKnob = 2;
            lastRender = () => renderKnobsView(buildMainPageVM(), false, 0);
            lastRender();
            break;
        }
        case 'main-key-overlay': {
            resetSeqState(); resetMainPage();
            keyboardState.rootNote = 48; keyboardState.scale = 0;
            seqState.bpmX100 = 12000; seqState.swingPct = 50;
            mainPageState.scaleOverlay = true; mainPageState.scaleSel = 1;
            lastRender = () => renderKnobsView(buildMainPageVM(), false, 0);
            lastRender();
            break;
        }
        case 'main-ext-sync': {      // following Move: tempo cell shows EXT
            resetSeqState(); resetMainPage();
            keyboardState.rootNote = 48; keyboardState.scale = 0;
            seqState.bpmX100 = 12500; seqState.swingPct = 50;
            seqState.extSync = true;
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
            holdTouch(0, 0, chainModels[1].getKnobParamInfo(0)); t = 2100; holdTick();
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
