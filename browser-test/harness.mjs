/* browser-test/harness.mjs — wires model + renderer to a browser canvas
 *
 * Sets up Schwung globals (fill_rect, clear_screen, shadow_*) before any
 * render calls, then runs a model + rAF tick loop.
 *
 * Serve the movy root with:  python3 -m http.server 8080
 * Then open:                  http://localhost:8080/browser-test/
 */

import { createModel }    from '../dist/esm/model/index.js';
import { renderKnobsView } from '../dist/esm/renderer/knob-view.js';
import { renderKeysView }  from '../dist/esm/renderer/keys-view.js';
import { renderBrowseView } from '../dist/esm/renderer/browse-view.js';
import { renderChainView } from '../dist/esm/renderer/chain-view.js';
import { MOCK_SYNTHS }     from './mock-synth.mjs';

/* ── Canvas + mock globals ───────────────────────────────────────────────── */

const canvas = document.getElementById('display');
const ctx2d  = canvas.getContext('2d');

let mockState = {};

/* Must be set before any render call; ES modules resolve bare globals from
 * globalThis at call time, so setting here (after imports) is safe. */
globalThis.host_read_file  = () => null;  /* no filesystem in browser */
globalThis.fill_rect    = (x, y, w, h, v) => {
    ctx2d.fillStyle = v ? '#d4d0c8' : '#000000';
    ctx2d.fillRect(x, y, w, h);
};
globalThis.clear_screen  = () => {
    ctx2d.fillStyle = '#000000';
    ctx2d.fillRect(0, 0, 128, 64);
};
globalThis.shadow_get_param   = (_slot, key) => mockState[key] ?? null;
globalThis.shadow_set_param   = (_slot, key, val) => { mockState[key] = val; return true; };
globalThis.shadow_get_ui_slot = () => 0;

/* ── Model ───────────────────────────────────────────────────────────────── */

const COMPONENT_KEYS = ['midi_fx1', 'synth', 'fx1', 'fx2'];
const chainModels    = COMPONENT_KEYS.map(k => createModel(0, k));
const model          = chainModels[1];   /* synth — backwards compat for existing test code */
globalThis.__movy_model = model;

function loadPreset(id) {
    mockState = { ...MOCK_SYNTHS[id] };
    for (const m of chainModels) { m.reset(); m.reload(); }
}

/* ── SVG knob arc (300° range, r=12, center 16,16) ──────────────────────── */
/* Start: (10, 26.4) at 120° from +x in SVG (7 o'clock)                     */
/* End:   (22, 26.4) at  60° from +x in SVG (5 o'clock)                     */
/* Clockwise via large-arc: 300°, circumference ≈ 62.83                      */
const ARC_LEN = 62.83;

function updateKnobArc(k, pvm) {
    const fillEl = document.getElementById('kfill-' + k);
    if (!fillEl) return;
    if (!pvm) { fillEl.style.strokeDashoffset = ARC_LEN; return; }
    const nv = Math.max(0, Math.min(1, pvm.normalizedValue ?? 0));
    fillEl.style.strokeDashoffset = (ARC_LEN * (1 - nv)).toFixed(2);
    fillEl.style.stroke = pvm.touched ? '#fff' : '#aaa';
}

/* ── Virtual knobs (drag up/down → delta) ────────────────────────────────── */

const NUM_KNOBS = 8;

for (let k = 0; k < NUM_KNOBS; k++) {
    const el = document.getElementById('knob-' + k);
    if (!el) continue;
    let lastY = 0;

    el.addEventListener('pointerdown', e => {
        lastY = e.clientY;
        el.setPointerCapture(e.pointerId);
        el.classList.add('active');
        model.handleKnobTouch(k);
    });
    el.addEventListener('pointermove', e => {
        if (!(e.buttons & 1)) return;
        const steps = Math.trunc(lastY - e.clientY);  /* up = positive */
        if (steps !== 0) { model.handleKnobDelta(k, steps); lastY = e.clientY; }
    });
    el.addEventListener('pointerup', () => {
        el.classList.remove('active');
        model.handleKnobRelease();
    });
    el.addEventListener('pointercancel', () => {
        el.classList.remove('active');
        model.handleKnobRelease();
    });
}

/* ── Page navigation ─────────────────────────────────────────────────────── */

document.getElementById('btn-prev')?.addEventListener('click', () => { model.changePage(-1); });
document.getElementById('btn-next')?.addEventListener('click', () => { model.changePage(1);  });

/* ── Preset selector ─────────────────────────────────────────────────────── */

const sel = document.getElementById('preset-select');
sel?.addEventListener('change', () => loadPreset(sel.value));

/* ── UI update helpers ───────────────────────────────────────────────────── */

const inspector = document.getElementById('vm-inspector');

function updateKnobWidgets(vm) {
    for (let k = 0; k < NUM_KNOBS; k++) {
        const row = Math.floor(k / 4);
        const col = k % 4;
        const pvm = vm.rows[row]?.[col];

        const nameEl = document.getElementById('kname-' + k);
        const valEl  = document.getElementById('kval-' + k);
        if (nameEl) nameEl.textContent = pvm?.shortName ?? '—';
        if (valEl)  valEl.textContent  = pvm?.displayValue ?? '';
        updateKnobArc(k, pvm);
    }
}

function updateInspector(vm) {
    if (!inspector) return;
    const rows = vm.rows.map(row =>
        row.map(p => p
            ? `<td class="cell${p.touched ? ' touched' : ''}">
                 <div class="pname">${p.shortName}</div>
                 <div class="pval">${p.displayValue}</div>
               </td>`
            : '<td class="cell empty">—</td>'
        ).join('')
    );
    inspector.innerHTML = `
        <div class="vm-header">
            <b>${vm.moduleName}</b>
            ${vm.bankName ? `<span class="bank">${vm.bankName}</span>` : ''}
            <span class="banks">${vm.bankIndex + 1} / ${vm.bankCount}</span>
        </div>
        <table class="vm-params">
            <tr>${rows[0]}</tr>
            <tr>${rows[1]}</tr>
        </table>`;
}

/* ── rAF tick loop ───────────────────────────────────────────────────────── */

function tick() {
    const dirty = model.tick();
    if (dirty) {
        const vm = model.getViewModel();
        renderKnobsView(vm);
        updateKnobWidgets(vm);
        updateInspector(vm);
    }
    requestAnimationFrame(tick);
}

globalThis.__movy_forceRender = () => {
    const vm = model.getViewModel();
    renderKnobsView(vm);
    updateKnobWidgets(vm);
    updateInspector(vm);
};

/* Exposed for screenshot.mjs to render alternate views */
globalThis.__movy_renderKeysView   = () => renderKeysView(
    model.getModuleName(), 60,
    n => { const names=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']; return names[n%12]+Math.floor(n/12-1); }
);
globalThis.__movy_renderBrowseView = (mods, idx) => renderBrowseView(mods, idx);

globalThis.__movy_renderChainView = (chainIndex, jogTouched) => {
    const m  = chainModels[chainIndex ?? 1];
    const vm = m.getViewModel();
    renderChainView(vm, chainIndex ?? 1, jogTouched ?? false);
};

globalThis.__movy_renderKnobsJogToast = () => {
    const vm = model.getViewModel();
    renderKnobsView(vm, true);
};

/* ── Boot ────────────────────────────────────────────────────────────────── */

clear_screen();
loadPreset(sel?.value ?? 'test8');
tick();
