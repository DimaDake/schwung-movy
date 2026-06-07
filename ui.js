/*
 * Movy — piano keyboard + module host for Schwung
 * Tool module: runs in the shadow-UI QuickJS context.
 * Install at: /data/UserData/schwung/modules/tools/movy/
 *
 * All movy logic is in one file (model, renderer, module configs) so that
 * shadow_load_ui_module re-evaluates everything fresh on each tool open.
 * Imported modules in QuickJS are cached for the shadow_ui process lifetime,
 * so splitting into multiple files causes stale-code bugs after hot deployment.
 *
 * Browser tests still import the canonical split files under view/ and modules/.
 */
import * as os from 'os';
import {
    Black, DarkGrey, White, NeonGreen, BrightRed,
    MidiNoteOn, MidiNoteOff,
    MoveShift, MoveBack, MoveLeft, MoveRight, MoveUp, MoveDown,
    MoveMainKnob, MoveMainButton,
    MoveKnob1,
    MovePads,
} from '/data/UserData/schwung/shared/constants.mjs';
import { setLED, decodeDelta } from '/data/UserData/schwung/shared/input_filter.mjs';
import { fontPrint, fontWidth, FONT_HEIGHT } from './ui_font.mjs';

/* ── Debug log ─────────────────────────────────────────────────────────────── */
function mlog(msg) { console.log('[movy] ' + msg); }

/* ═══════════════════════════════════════════════════════════════════════════
 * MODULE CONFIGS  (canonical source: modules/index.mjs, used by browser tests)
 * ═══════════════════════════════════════════════════════════════════════════ */

const MOVY_SG_ROOT = '/data/UserData/schwung/modules/sound_generators';

function _tryFile(path) {
    if (typeof host_read_file !== 'function') return null;
    try { const s = host_read_file(path); if (s) return JSON.parse(s); } catch {}
    return null;
}

const MODULE_CONFIGS = {

    plaits: {
        id: 'plaits', name: 'Plaits',
        banks: [
            {
                name: 'OSC',
                rows: [
                    [
                        { key: 'engine',    short: 'ENGI', full: 'Engine',    type: 'enum'  },
                        { key: 'harmonics', short: 'HARM', full: 'Harmonics', type: 'float' },
                        { key: 'timbre',    short: 'TIMB', full: 'Timbre',    type: 'float' },
                        { key: 'morph',     short: 'MRPH', full: 'Morph',     type: 'float' },
                    ],
                    [
                        { key: 'decay',     short: 'DCAY', full: 'Decay',     type: 'float' },
                        { key: 'lpg_colour',short: 'LPGC', full: 'LPG Color', type: 'float' },
                        { key: 'fm_amount', short: 'FM',   full: 'FM Amount', type: 'float' },
                        { key: 'aux_mix',   short: 'MIX',  full: 'Aux Mix',   type: 'float' },
                    ],
                ],
            },
            {
                name: 'MOD',
                rows: [
                    [
                        { key: 'attack',               short: 'ATK',  full: 'Attack',     type: 'float' },
                        { key: 'timbre_mod',           short: 'TMOD', full: 'Timbre Mod', type: 'float' },
                        { key: 'morph_mod',            short: 'MMOD', full: 'Morph Mod',  type: 'float' },
                        { key: 'velocity_sensitivity', short: 'VEL',  full: 'Vel Sens',   type: 'float' },
                    ],
                    [
                        { key: 'legato',           short: 'LGTO', full: 'Legato', type: 'enum' },
                        { key: 'octave_transpose', short: 'OCT',  full: 'Octave', type: 'int'  },
                        null,
                        null,
                    ],
                ],
            },
        ],
    },

    wurl: {
        id: 'wurl', name: 'Wurl',
        banks: [
            {
                name: 'WURL',
                rows: [
                    [
                        { key: 'volume',     short: 'VOL',  full: 'Volume',     type: 'float' },
                        { key: 'tremolo',    short: 'TREM', full: 'Tremolo',    type: 'float' },
                        { key: 'attack',     short: 'ATK',  full: 'Attack',     type: 'float' },
                        { key: 'decay',      short: 'DCY',  full: 'Decay',      type: 'float' },
                    ],
                    [
                        { key: 'brightness', short: 'BGHT', full: 'Brightness', type: 'float' },
                        { key: 'darken',     short: 'DARK', full: 'Darken',     type: 'float' },
                        { key: 'bark',       short: 'BARK', full: 'Bark',       type: 'float' },
                        { key: 'reverb',     short: 'REVB', full: 'Reverb',     type: 'float' },
                    ],
                ],
            },
            {
                name: 'FX',
                rows: [
                    [
                        { key: 'speaker', short: 'SPKR', full: 'Speaker', type: 'float' },
                        { key: 'tune',    short: 'TUNE', full: 'Tune',    type: 'float' },
                        null,
                        null,
                    ],
                    [null, null, null, null],
                ],
            },
        ],
    },

};

function loadModuleConfig(moduleId) {
    if (!moduleId) return null;
    return _tryFile(`${MOVY_SG_ROOT}/${moduleId}/movy_config.json`)
        ?? MODULE_CONFIGS[moduleId]
        ?? null;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * MODEL  (canonical source: view/model.mjs, used by browser tests)
 * ═══════════════════════════════════════════════════════════════════════════ */

const NAME_POLL_TICKS    = 344;
const KNOB_REFRESH_TICKS = 69;
const LONG_PRESS_TICKS   = 172;   // ~0.5 s
const KNOBS_PER_PAGE     = 8;
const KNOBS_PER_ROW      = 4;

function _formatValue(p, v) {
    if (v === null || v === undefined) return "...";
    if (p.type === "enum") {
        if (p.options && p.options[Math.round(v)]) return p.options[Math.round(v)].substring(0, 5);
        return String(Math.round(v));
    }
    if (p.type === "int") return String(Math.round(v));
    const range = (p.max - p.min) || 1;
    return Math.round((v - p.min) / range * 100) + "%";
}

function createModel(slot) {
    let activeSlot   = slot;
    let knobParams   = [];
    let knobValues   = [];
    let pendingDeltas = new Array(KNOBS_PER_PAGE).fill(0);
    let knobPage     = 0;
    let touchedSlot  = -1;
    let longPressCountdown = -1;
    let enumOverlay  = null;    // null | {slot, gi, options, selected}
    let activeModuleName = "—";
    let moduleId     = "";
    let moduleConfig = null;
    let hierarchyKey = "";
    let pollCountdown    = NAME_POLL_TICKS;
    let refreshCountdown = 0;
    let dirty        = false;

    function numBanks() {
        return Math.max(1, Math.ceil(knobParams.length / KNOBS_PER_PAGE));
    }

    function loadHierarchy() {
        knobParams   = [];
        knobValues   = [];
        moduleConfig = null;
        hierarchyKey = activeModuleName;

        mlog("loadHierarchy: slot=" + activeSlot + " module=" + activeModuleName);

        moduleId = shadow_get_param(activeSlot, "synth_module") || "";

        const chainParamsRaw = shadow_get_param(activeSlot, "synth:chain_params");
        const cpMap = {};
        if (chainParamsRaw) {
            try {
                const arr = JSON.parse(chainParamsRaw);
                for (const cp of arr) { if (cp.key) cpMap[cp.key] = cp; }
                mlog("loadHierarchy: chain_params " + arr.length + " entries");
            } catch (e) { mlog("chain_params parse error: " + e); }
        }

        const raw = shadow_get_param(activeSlot, "synth:ui_hierarchy");
        if (!raw) {
            mlog("loadHierarchy: ui_hierarchy null — using test params");
            knobParams = [
                { key: 'test_a', label: 'TestA', shortLabel: null, type: 'float', min: 0, max: 1,   step: 0.02, options: null },
                { key: 'test_b', label: 'TestB', shortLabel: null, type: 'int',   min: 0, max: 127, step: 1,    options: null },
            ];
            knobValues = [0.5, 64];
            dirty = true;
            return;
        }

        let paramDefs = {};
        try {
            const hier = JSON.parse(raw);
            if (hier.levels) {
                for (const lvl of Object.values(hier.levels)) {
                    if (!lvl.params) continue;
                    for (const p of lvl.params) {
                        if (p && p.key) paramDefs[p.key] = p;
                    }
                }
            }
        } catch (e) { mlog("ui_hierarchy parse error: " + e); }

        moduleConfig = loadModuleConfig(moduleId);

        if (moduleConfig) {
            for (const bank of moduleConfig.banks) {
                for (const row of bank.rows) {
                    for (const sl of row) {
                        if (!sl || !sl.key) { knobParams.push(null); continue; }
                        const cp   = cpMap[sl.key]  || {};
                        const hier = paramDefs[sl.key] || {};
                        const type = sl.type || cp.type || hier.type || 'float';
                        let options = cp.options || hier.options || null;
                        let min  = cp.min  != null ? cp.min  : (hier.min  != null ? hier.min  : 0);
                        let max  = cp.max  != null ? cp.max  : (hier.max  != null ? hier.max  : 1);
                        let step = cp.step != null ? cp.step : (hier.step != null ? hier.step : (type === 'float' ? 0.01 : 1));
                        if (type === 'enum') { min = 0; max = options ? options.length - 1 : 127; step = 1; }
                        knobParams.push({
                            key:        sl.key,
                            label:      sl.full  || cp.name || hier.label || sl.key,
                            shortLabel: sl.short || null,
                            type, options, min, max, step,
                        });
                    }
                }
            }
            mlog("loadHierarchy: config loaded for " + moduleId + ", " + moduleConfig.banks.length + " banks");
        } else {
            let rootLevel = null;
            try {
                const hier = JSON.parse(raw);
                rootLevel = hier.levels && (hier.levels.root || Object.values(hier.levels)[0]);
            } catch {}

            if (rootLevel) {
                const knobSources = rootLevel.knobs || rootLevel.params || [];
                for (const knob of knobSources) {
                    const key   = typeof knob === 'string' ? knob : knob.key;
                    const label = typeof knob === 'string' ? knob : (knob.label || knob.key);
                    if (!key) continue;
                    const def     = (typeof knob === 'object' && knob.type) ? knob : (paramDefs[key] || {});
                    const cp      = cpMap[key] || {};
                    const type    = def.type || cp.type || 'float';
                    const options = cp.options || def.options || null;
                    let min  = cp.min  != null ? cp.min  : (def.min  != null ? def.min  : 0);
                    let max  = cp.max  != null ? cp.max  : (def.max  != null ? def.max  : 1);
                    let step = cp.step != null ? cp.step : (def.step != null ? def.step : (type === 'float' ? 0.02 : 1));
                    if (type === 'enum') { min = 0; max = options ? options.length - 1 : 127; step = 1; }
                    knobParams.push({ key, label: def.label || label, shortLabel: null, type, options, min, max, step });
                }
            }
        }

        knobValues = new Array(knobParams.length).fill(null);
        mlog("loadHierarchy: " + knobParams.filter(Boolean).length + " params loaded");
        dirty = true;
    }

    function refreshKnobValues() {
        for (let gi = 0; gi < knobParams.length; gi++) {
            const p = knobParams[gi];
            if (!p) continue;
            const raw = shadow_get_param(activeSlot, "synth:" + p.key);
            if (raw !== null) {
                const v = parseFloat(raw);
                if (!isNaN(v)) knobValues[gi] = v;
            }
        }
    }

    function applyKnobDelta(physK, delta) {
        const gi = knobPage * KNOBS_PER_PAGE + physK;
        const p  = knobParams[gi];
        if (!p) return;

        if (knobValues[gi] === null || knobValues[gi] === undefined) {
            const raw = shadow_get_param(activeSlot, "synth:" + p.key);
            if (raw === null && !p.key.startsWith('test_')) return;
            const v = parseFloat(raw);
            knobValues[gi] = (raw === null || isNaN(v)) ? p.min : v;
        }

        let newVal = knobValues[gi] + delta * p.step;
        newVal = Math.max(p.min, Math.min(p.max, newVal));
        if (p.type === 'int' || p.type === 'enum') newVal = Math.round(newVal);

        knobValues[gi] = newVal;

        const valStr = (p.type === 'float') ? newVal.toFixed(4) : String(Math.round(newVal));
        mlog("set slot=" + activeSlot + " gi=" + gi + " key=synth:" + p.key + " val=" + valStr);
        const ok = p.key.startsWith('test_') ? true : shadow_set_param(activeSlot, "synth:" + p.key, valStr);
        mlog("set_param returned " + ok);
        dirty = true;
    }

    function pollModuleName() {
        const name = shadow_get_param(activeSlot, "synth:name")
                  || shadow_get_param(activeSlot, "synth_module")
                  || "—";
        if (name !== activeModuleName) {
            activeModuleName = name;
            hierarchyKey = "";
            dirty = true;
        }
    }

    function getViewModel() {
        const nBanks   = numBanks();
        const bankName = moduleConfig && moduleConfig.banks[knobPage]
            ? moduleConfig.banks[knobPage].name
            : (nBanks > 1 ? "PG" + (knobPage + 1) : "");

        const rows = [[], []];
        for (let row = 0; row < 2; row++) {
            for (let col = 0; col < KNOBS_PER_ROW; col++) {
                const physK = row * KNOBS_PER_ROW + col;
                const gi    = knobPage * KNOBS_PER_PAGE + physK;
                const p     = knobParams[gi];
                if (!p) { rows[row].push(null); continue; }
                const v  = knobValues[gi];
                const nv = (p.min === p.max || v === null || v === undefined)
                    ? 0
                    : Math.max(0, Math.min(1, (v - p.min) / (p.max - p.min)));
                rows[row].push({
                    shortName:       p.shortLabel || p.label.substring(0, 4).toUpperCase(),
                    fullName:        p.label,
                    type:            p.type,
                    normalizedValue: nv,
                    displayValue:    _formatValue(p, v),
                    touched:         (touchedSlot === physK),
                });
            }
        }

        let toast = null;
        if (touchedSlot >= 0) {
            const gi = knobPage * KNOBS_PER_PAGE + touchedSlot;
            const p  = knobParams[gi];
            if (p) toast = { fullName: p.label, value: _formatValue(p, knobValues[gi]) };
        }

        return {
            moduleName:  activeModuleName,
            bankName,
            bankIndex:   knobPage,
            bankCount:   nBanks,
            rows,
            touchedSlot: touchedSlot >= 0 ? touchedSlot : null,
            toast,
            overlay:     enumOverlay
                ? { slot: enumOverlay.slot, options: enumOverlay.options, selected: enumOverlay.selected }
                : null,
        };
    }

    return {
        handleKnobDelta(k, delta) {
            if (enumOverlay && k === enumOverlay.slot) {
                const next = Math.max(0, Math.min(enumOverlay.options.length - 1,
                                                  enumOverlay.selected + delta));
                if (next !== enumOverlay.selected) {
                    enumOverlay.selected = next;
                    knobValues[enumOverlay.gi] = next;
                    dirty = true;
                }
                return;
            }
            longPressCountdown = -1;
            pendingDeltas[k] += delta;
            if (touchedSlot !== k) { touchedSlot = k; dirty = true; }
        },

        handleKnobTouch(k) {
            if (enumOverlay) { enumOverlay = null; dirty = true; }
            if (touchedSlot !== k) { touchedSlot = k; dirty = true; }
            const gi = knobPage * KNOBS_PER_PAGE + k;
            const p  = knobParams[gi];
            longPressCountdown = (p && p.type === 'enum' && p.options && p.options.length)
                ? LONG_PRESS_TICKS : -1;
        },

        handleKnobRelease() {
            if (enumOverlay) {
                const p = knobParams[enumOverlay.gi];
                if (p) {
                    knobValues[enumOverlay.gi] = enumOverlay.selected;
                    shadow_set_param(activeSlot, "synth:" + p.key,
                                     String(enumOverlay.selected));
                }
                enumOverlay = null;
                dirty = true;
            }
            if (touchedSlot >= 0) { touchedSlot = -1; dirty = true; }
            longPressCountdown = -1;
        },

        changePage(delta) {
            if (enumOverlay) return;
            const next = Math.max(0, Math.min(numBanks() - 1, knobPage + delta));
            mlog("changePage delta=" + delta + " " + knobPage + "→" + next + "/" + numBanks());
            if (next !== knobPage) { knobPage = next; dirty = true; }
        },

        getModuleName() { return activeModuleName; },

        reset() {
            knobPage       = 0;
            touchedSlot    = -1;
            longPressCountdown = -1;
            enumOverlay    = null;
            pollCountdown    = NAME_POLL_TICKS;
            refreshCountdown = 0;
            for (let i = 0; i < KNOBS_PER_PAGE; i++) pendingDeltas[i] = 0;
            dirty = true;
        },

        tick() {
            if (hierarchyKey !== activeModuleName) {
                knobPage = 0;
                loadHierarchy();
                refreshCountdown = 0;
            }

            for (let k = 0; k < KNOBS_PER_PAGE; k++) {
                if (pendingDeltas[k] !== 0) {
                    applyKnobDelta(k, pendingDeltas[k]);
                    pendingDeltas[k] = 0;
                }
            }

            if (longPressCountdown > 0) {
                longPressCountdown--;
                if (longPressCountdown === 0) {
                    const k = touchedSlot;
                    if (k >= 0) {
                        const gi = knobPage * KNOBS_PER_PAGE + k;
                        const p  = knobParams[gi];
                        if (p && p.type === 'enum' && p.options) {
                            enumOverlay = {
                                slot:     k,
                                gi,
                                options:  p.options,
                                selected: Math.round(knobValues[gi] ?? 0),
                            };
                            dirty = true;
                        }
                    }
                    longPressCountdown = -1;
                }
            }

            if (--pollCountdown <= 0) {
                pollCountdown = NAME_POLL_TICKS;
                pollModuleName();
            }

            if (--refreshCountdown <= 0) {
                refreshCountdown = KNOB_REFRESH_TICKS;
                if (knobParams.length > 0) {
                    const prev = knobValues.slice();
                    refreshKnobValues();
                    for (let k = 0; k < knobParams.length; k++) {
                        if (knobValues[k] !== prev[k]) { dirty = true; break; }
                    }
                }
            }

            const wasDirty = dirty;
            dirty = false;
            return wasDirty;
        },

        getViewModel,

        reload() {
            hierarchyKey  = "";
            pollCountdown = 1;
            dirty         = true;
        },
    };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * RENDERER  (canonical source: view/renderer.mjs, used by browser tests)
 * ═══════════════════════════════════════════════════════════════════════════ */

const _W = 128;
const _HEADER_H = 8;
const _BAR_Y    = 8;
const _BAR_H    = 3;
const _ROW0_Y   = 11;
const _LBL0_Y   = 24;
const _ROW1_Y   = 31;
const _LBL1_Y   = 44;
const _CELL_W   = 32;
const _LBL_H    = 7;
const _KW       = 10;

function _drawInvertedHeader(left, right) {
    fill_rect(0, 0, _W, _HEADER_H, 1);
    fontPrint(2, 1, left, 0);
    if (right) fontPrint(_W - fontWidth(right) - 2, 1, right, 0);
}

function _drawBankBar(bankIndex, bankCount) {
    if (bankCount <= 1) return;
    const segW = Math.floor((_W - (bankCount - 1)) / bankCount);
    for (let b = 0; b < bankCount; b++) {
        const sx = b * (segW + 1);
        const sw = b === bankCount - 1 ? _W - sx : segW;
        const y = b === bankIndex ? _BAR_Y     : _BAR_Y + _BAR_H - 1;
        const h = b === bankIndex ? 2          : 1;
        fill_rect(sx, y, sw, h, 1);
    }
}

/* Arc knob: 300° sweep from 7-o'clock (min) to 5-o'clock (max).
 * Angles measured clockwise from 12 o'clock.
 * Two passes: sparse track (full sweep) + dense fill (0..normVal). */
function _drawArcKnob(kx, ky, normVal) {
    const cx = kx + 4.5;
    const cy = ky + 4.5;
    const r  = 4.0;
    const START = 210;
    const RANGE = 300;
    for (let d = START; d <= START + RANGE; d += 22) {
        const rad = d * Math.PI / 180;
        fill_rect(Math.round(cx + r * Math.sin(rad)),
                  Math.round(cy - r * Math.cos(rad)), 1, 1, 1);
    }
    const fillEnd = START + normVal * RANGE;
    for (let d = START; d <= fillEnd; d += 6) {
        const rad = d * Math.PI / 180;
        fill_rect(Math.round(cx + r * Math.sin(rad)),
                  Math.round(cy - r * Math.cos(rad)), 1, 1, 1);
    }
    if (normVal > 0) {
        const rad = fillEnd * Math.PI / 180;
        fill_rect(Math.round(cx + r * Math.sin(rad)),
                  Math.round(cy - r * Math.cos(rad)), 1, 1, 1);
    }
}

function _drawEnumKnob(kx, ky) {
    fill_rect(kx + 1, ky + 1, _KW - 2, _KW - 2, 1);
}

function _drawKnobWidget(col, rowY, pvm) {
    const kx = col * _CELL_W + Math.floor((_CELL_W - _KW) / 2);
    const ky = rowY + 1;
    if (pvm.type === 'enum') {
        _drawEnumKnob(kx, ky);
    } else {
        _drawArcKnob(kx, ky, pvm.normalizedValue);
    }
}

function _drawLabelCell(col, lblY, pvm) {
    fill_rect(col * _CELL_W, lblY, _CELL_W, _LBL_H, 1);
    const text = pvm.touched ? pvm.displayValue : pvm.shortName;
    fontPrint(col * _CELL_W + 1, lblY + 1, text, 0);
}

function _drawKnobRow(params, rowY, lblY) {
    for (let col = 0; col < 4; col++) {
        const pvm = params[col];
        if (!pvm) continue;
        _drawKnobWidget(col, rowY, pvm);
        _drawLabelCell(col, lblY, pvm);
    }
}

function _drawEnumOverlay(vm) {
    const ov  = vm.overlay;
    const row = Math.floor(ov.slot / 4);
    const col = ov.slot % 4;
    const pvm = vm.rows[row] && vm.rows[row][col];
    const fullName = pvm ? pvm.fullName : "";
    const valueStr = ov.options[ov.selected] || String(ov.selected);

    clear_screen();
    _drawInvertedHeader(fullName, valueStr);

    const LIST_TOP = 8;
    const ROW_H    = 7;
    const VISIBLE  = Math.floor((64 - LIST_TOP) / ROW_H);   /* 8 rows */
    const n        = ov.options.length;
    const half     = Math.floor(VISIBLE / 2);
    const start    = Math.max(0, Math.min(ov.selected - half, n - VISIBLE));

    for (let i = 0; i < VISIBLE; i++) {
        const idx = start + i;
        if (idx >= n) break;
        const y = LIST_TOP + i * ROW_H;
        if (idx === ov.selected) {
            fill_rect(0, y, _W - 2, ROW_H, 1);
            fontPrint(2, y + 1, ov.options[idx], 0);
        } else {
            fontPrint(2, y + 1, ov.options[idx], 1);
        }
    }

    if (n > VISIBLE) {
        const trackH = 64 - LIST_TOP;
        const thumbH = Math.max(3, Math.round(trackH * VISIBLE / n));
        const thumbY = LIST_TOP + Math.round((trackH - thumbH) * start / Math.max(1, n - VISIBLE));
        fill_rect(_W - 1, LIST_TOP, 1, trackH, 1);
        fill_rect(_W - 1, thumbY,   1, thumbH, 0);
    }
}

function renderKnobsView(vm) {
    if (vm.overlay) { _drawEnumOverlay(vm); return; }
    clear_screen();
    if (vm.toast) {
        _drawInvertedHeader(vm.toast.fullName, vm.toast.value);
    } else {
        const rightW   = vm.bankName ? fontWidth(vm.bankName) + 4 : 0;
        const maxNameW = _W - rightW - 4;
        let dispName   = vm.moduleName;
        while (dispName.length > 1 && fontWidth(dispName) > maxNameW) {
            dispName = dispName.slice(0, -1);
        }
        _drawInvertedHeader(dispName, vm.bankName);
    }
    _drawBankBar(vm.bankIndex, vm.bankCount);

    const hasParams = vm.rows[0].some(Boolean) || vm.rows[1].some(Boolean);
    if (!hasParams) {
        fontPrint(2, _ROW0_Y + 4, "No params", 1);
        return;
    }
    _drawKnobRow(vm.rows[0], _ROW0_Y, _LBL0_Y);
    _drawKnobRow(vm.rows[1], _ROW1_Y, _LBL1_Y);
}

function renderKeysView(moduleName, rootNote, midiNoteName) {
    clear_screen();
    let abbrev = moduleName;
    const prefixW = fontWidth("Movy ");
    while (abbrev.length > 1 && prefixW + fontWidth("[" + abbrev + "]") > _W - 4) {
        abbrev = abbrev.slice(0, -1);
    }
    if (abbrev !== moduleName) abbrev += "~";
    _drawInvertedHeader("Movy", "[" + abbrev + "]");

    const rootName = midiNoteName(rootNote);
    const topName  = midiNoteName(rootNote + 24);
    fontPrint(2,                          _HEADER_H + 5, rootName, 1);
    fontPrint(_W - fontWidth(topName) - 2, _HEADER_H + 5, topName,  1);

    const FOOTER_Y = 57;
    fill_rect(0, FOOTER_Y, _W, FONT_HEIGHT + 2, 1);
    fontPrint(2, FOOTER_Y + 1, "L/R:oct  U/D:semi  S+L:mod", 0);
}

function renderBrowseView(modules, browseIndex) {
    clear_screen();
    _drawInvertedHeader("Sound module", null);

    const FOOTER_Y = 57;
    const LIST_TOP = _HEADER_H + 2;
    const LIST_BOT = FOOTER_Y - 2;
    const rowH     = FONT_HEIGHT + 2;

    if (modules.length === 0) {
        fontPrint(2, LIST_TOP, "No modules found", 1);
    } else {
        const visible = Math.floor((LIST_BOT - LIST_TOP) / rowH);
        const halfVis = Math.floor(visible / 2);
        const startIdx = Math.max(0, Math.min(browseIndex - halfVis, modules.length - visible));
        for (let i = 0; i < visible; i++) {
            const idx = startIdx + i;
            if (idx >= modules.length) break;
            const y = LIST_TOP + i * rowH;
            if (idx === browseIndex) {
                fill_rect(0, y - 1, _W, rowH, 1);
                fontPrint(2, y, modules[idx].name, 0);
            } else {
                fontPrint(2, y, modules[idx].name, 1);
            }
        }
    }

    fill_rect(0, FOOTER_Y, _W, FONT_HEIGHT + 2, 1);
    fontPrint(2, FOOTER_Y + 1, "Back:cancel  Click:load", 0);
}

/* ═══════════════════════════════════════════════════════════════════════════
 * CONSTANTS AND STATE
 * ═══════════════════════════════════════════════════════════════════════════ */

const PAD_MIN = MovePads[0];
const PAD_MAX = MovePads[MovePads.length - 1];

const PAD_MAP = [
    /* row 0: pads 68-75  — white keys oct+0 */
     0,  2,  4,  5,  7,  9, 11, 12,
    /* row 1: pads 76-83  — black keys oct+0 */
     1,  3, null, 6,  8, 10, null, null,
    /* row 2: pads 84-91  — white keys oct+1 */
    12, 14, 16, 17, 19, 21, 23, 24,
    /* row 3: pads 92-99  — black keys oct+1 */
    13, 15, null, 18, 20, 22, null, null,
];

const MODULES_DIR = "/data/UserData/schwung/modules/sound_generators";

const COLOR_DEAD      = Black;
const COLOR_BLACK_KEY = DarkGrey;
const COLOR_WHITE_KEY = White;
const COLOR_ROOT      = NeonGreen;
const COLOR_HELD      = BrightRed;

const VIEW_KEYS   = 0;
const VIEW_KNOBS  = 1;
const VIEW_BROWSE = 2;

const LED_INIT_BATCH = 8;
const NUM_KNOBS      = 8;
const KNOB_CC_BASE   = MoveKnob1;

let model       = null;
let activeSlot  = 0;
let rootNote    = 48;
let currentView = VIEW_KNOBS;
let shiftHeld   = false;
let dirty       = true;

const held = {};

let modules     = [];
let browseIndex = 0;

let initLedIndex = 0;
let initLedsDone = false;

/* ── LED helpers ──────────────────────────────────────────────────────────── */

function padLedColor(padNote) {
    const offset = PAD_MAP[padNote - PAD_MIN];
    if (offset === null || offset === undefined) return COLOR_DEAD;
    if (held[padNote] !== undefined) return COLOR_HELD;
    const semitone = offset % 12;
    if (semitone === 0) return COLOR_ROOT;
    if (semitone === 1 || semitone === 3 || semitone === 6 ||
        semitone === 8 || semitone === 10) return COLOR_BLACK_KEY;
    return COLOR_WHITE_KEY;
}

/* ── Note handling ────────────────────────────────────────────────────────── */

function midiNoteName(note) {
    const names = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
    return names[note % 12] + (Math.floor(note / 12) - 1);
}

function noteOn(padNote) {
    const offset = PAD_MAP[padNote - PAD_MIN];
    if (offset === null || offset === undefined) return;
    const midiNote = rootNote + offset;
    if (midiNote < 0 || midiNote > 127) return;
    held[padNote] = midiNote;
    shadow_send_midi_to_dsp([MidiNoteOn, midiNote, 100]);
    setLED(padNote, COLOR_HELD, true);
}

function noteOff(padNote) {
    const midiNote = held[padNote];
    if (midiNote === undefined) return;
    shadow_send_midi_to_dsp([MidiNoteOff, midiNote, 0]);
    delete held[padNote];
    setLED(padNote, padLedColor(padNote), true);
}

function releaseAllNotes() {
    for (const padNote of Object.keys(held)) {
        shadow_send_midi_to_dsp([MidiNoteOff, held[padNote], 0]);
    }
    for (const k of Object.keys(held)) delete held[k];
}

/* ── Root note shift ──────────────────────────────────────────────────────── */

function changeRoot(semitones) {
    releaseAllNotes();
    rootNote = Math.max(0, Math.min(103, rootNote + semitones));
    for (let pad = PAD_MIN; pad <= PAD_MAX; pad++) {
        setLED(pad, padLedColor(pad), true);
    }
    dirty = true;
}

/* ── Module browser ───────────────────────────────────────────────────────── */

function scanModules() {
    const result = [];
    try {
        const [entries] = os.readdir(MODULES_DIR);
        if (!Array.isArray(entries)) return result;
        for (const entry of entries) {
            if (entry === "." || entry === "..") continue;
            try {
                const raw = host_read_file(`${MODULES_DIR}/${entry}/module.json`);
                if (!raw) continue;
                const json = JSON.parse(raw);
                const ct = json.component_type
                        || (json.capabilities && json.capabilities.component_type);
                if (ct === "sound_generator") {
                    result.push({ id: json.id || entry, name: json.name || entry });
                }
            } catch (e) {}
        }
    } catch (e) {}
    result.sort((a, b) => a.name.localeCompare(b.name));
    return result;
}

function openBrowser() {
    modules = scanModules();
    browseIndex = 0;
    const activeId = shadow_get_param(activeSlot, "synth_module") || "";
    const idx = modules.findIndex(m => m.id === activeId);
    if (idx >= 0) browseIndex = idx;
    currentView = VIEW_BROWSE;
    dirty = true;
}

function loadSelectedModule() {
    if (modules.length === 0) return;
    const mod = modules[browseIndex];
    shadow_set_param(activeSlot, "synth:module", mod.id);
    currentView = VIEW_KNOBS;
    dirty = true;
}

/* ── MIDI handler ─────────────────────────────────────────────────────────── */

globalThis.onMidiMessageInternal = function(data) {
    if (!data || data.length < 3) return;

    const status = data[0];
    const d1     = data[1];
    const d2     = data[2];

    /* Capacitive knob touch: NoteOn note=0..7, vel>0 = touch, vel=0 = release */
    if ((status & 0xF0) === 0x90 && d1 < 8) {
        if (d2 > 0) model.handleKnobTouch(d1);
        else        model.handleKnobRelease();
        return;
    }
    /* Notes 8-9: ignore (e.g. main encoder touch) */
    if ((status & 0xF0) === 0x90 && d1 < 10) return;

    if (d1 >= PAD_MIN && d1 <= PAD_MAX) {
        if ((status & 0xF0) === 0x90 && d2 > 0) { noteOn(d1);  return; }
        if ((status & 0xF0) === 0x80 || ((status & 0xF0) === 0x90 && d2 === 0)) {
            noteOff(d1); return;
        }
    }

    if ((status & 0xF0) === 0xB0 && d1 >= KNOB_CC_BASE && d1 < KNOB_CC_BASE + NUM_KNOBS) {
        const k     = d1 - KNOB_CC_BASE;
        const delta = decodeDelta(d2);
        mlog("knobCC k=" + k + " d2=" + d2 + " delta=" + delta + " params=" + (model ? "model" : "none"));
        model.handleKnobDelta(k, delta);
        return;
    }

    if ((status & 0xF0) !== 0xB0) return;

    if (d1 === MoveShift) { shiftHeld = d2 > 0; return; }

    if (d1 === MoveBack && d2 > 0) {
        if (currentView === VIEW_BROWSE || currentView === VIEW_KEYS) {
            currentView = VIEW_KNOBS; dirty = true;
        } else {
            releaseAllNotes();
            host_exit_module();
        }
        return;
    }

    if (d1 === MoveMainButton && d2 > 0) {
        if (currentView === VIEW_BROWSE) {
            loadSelectedModule();
        } else {
            currentView = (currentView === VIEW_KNOBS) ? VIEW_KEYS : VIEW_KNOBS;
            dirty = true;
        }
        return;
    }

    if (currentView === VIEW_KNOBS) {
        if (d1 === MoveMainKnob) {
            const delta = decodeDelta(d2);
            if (delta !== 0) { mlog("jog bank delta=" + delta); model.changePage(delta > 0 ? 1 : -1); dirty = true; }
            return;
        }
        if (d1 === MoveLeft  && d2 > 0) { shiftHeld ? openBrowser() : model.changePage(-1); dirty = true; return; }
        if (d1 === MoveRight && d2 > 0) { shiftHeld ? openBrowser() : model.changePage(1);  dirty = true; return; }
    }

    if (currentView === VIEW_KEYS) {
        if (d1 === MoveLeft  && d2 > 0) { shiftHeld ? openBrowser() : changeRoot(-12); return; }
        if (d1 === MoveRight && d2 > 0) { shiftHeld ? openBrowser() : changeRoot(12);  return; }
        if (d1 === MoveUp    && d2 > 0) { changeRoot(1);  return; }
        if (d1 === MoveDown  && d2 > 0) { changeRoot(-1); return; }
    }

    if (currentView === VIEW_BROWSE) {
        if (d1 === MoveMainKnob) {
            const delta = decodeDelta(d2);
            if (delta !== 0) { browseIndex = Math.max(0, Math.min(modules.length - 1, browseIndex + delta)); dirty = true; }
            return;
        }
    }
};

/* ── Lifecycle ────────────────────────────────────────────────────────────── */

globalThis.init = function() {
    activeSlot = (typeof shadow_get_ui_slot === 'function') ? shadow_get_ui_slot() : 0;
    mlog("init: activeSlot=" + activeSlot);

    model = createModel(activeSlot);
    model.reset();

    currentView = VIEW_KNOBS;
    shiftHeld   = false;
    rootNote    = 48;
    dirty       = true;
    for (const k of Object.keys(held)) delete held[k];

    initLedIndex = 0;
    initLedsDone = false;
};

globalThis.tick = function() {
    if (!initLedsDone) {
        const total = PAD_MAX - PAD_MIN + 1;
        const end   = Math.min(initLedIndex + LED_INIT_BATCH, total);
        for (let i = initLedIndex; i < end; i++) {
            setLED(PAD_MIN + i, padLedColor(PAD_MIN + i), true);
        }
        initLedIndex = end;
        if (initLedIndex >= total) { initLedsDone = true; dirty = true; }
        return;
    }

    const modelDirty = model.tick();

    if (modelDirty || dirty) {
        if (currentView === VIEW_KEYS)        renderKeysView(model.getModuleName(), rootNote, midiNoteName);
        else if (currentView === VIEW_KNOBS)  renderKnobsView(model.getViewModel());
        else                                  renderBrowseView(modules, browseIndex);
        dirty = false;
    }
};
