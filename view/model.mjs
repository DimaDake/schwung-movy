/* view/model.mjs — all knob/param state and business logic
 * No display calls. Exports createModel(slot) factory.
 * Calls Schwung globals (shadow_get_param, shadow_set_param) directly;
 * in browser tests these are mocked on globalThis.
 */

import { loadModuleConfig } from '../modules/index.mjs';

const NAME_POLL_TICKS    = 344;   /* ~1 s at device tick rate */
const KNOB_REFRESH_TICKS = 69;    /* ~0.2 s */
const KNOBS_PER_PAGE     = 8;
const KNOBS_PER_ROW      = 4;

function mlog(msg) { console.log('[movy] ' + msg); }

function formatValue(p, v) {
    if (v === null || v === undefined) return "...";
    if (p.type === "enum") {
        if (p.options && p.options[Math.round(v)]) return p.options[Math.round(v)].substring(0, 5);
        return String(Math.round(v));
    }
    if (p.type === "int") return String(Math.round(v));
    const range = (p.max - p.min) || 1;
    return Math.round((v - p.min) / range * 100) + "%";
}

export function createModel(slot) {
    let activeSlot   = slot;
    let knobParams   = [];     /* flat array; null entries = empty slots */
    let knobValues   = [];
    let pendingDeltas = new Array(KNOBS_PER_PAGE).fill(0);
    let knobPage     = 0;
    let touchedSlot  = -1;
    let activeModuleName = "—";
    let moduleId     = "";
    let moduleConfig = null;
    let hierarchyKey = "";
    let pollCountdown    = NAME_POLL_TICKS;
    let refreshCountdown = 0;
    let dirty        = false;

    /* ── Internals ─────────────────────────────────────────────────────────── */

    function numBanks() {
        return Math.max(1, Math.ceil(knobParams.length / KNOBS_PER_PAGE));
    }

    function loadHierarchy() {
        knobParams   = [];
        knobValues   = [];
        moduleConfig = null;
        hierarchyKey = activeModuleName;

        mlog("loadHierarchy: slot=" + activeSlot + " module=" + activeModuleName);

        /* Read module ID for config lookup */
        moduleId = shadow_get_param(activeSlot, "synth:module") || "";

        /* Read chain_params for accurate min/max/step/options */
        const chainParamsRaw = shadow_get_param(activeSlot, "synth:chain_params");
        const cpMap = {};
        if (chainParamsRaw) {
            try {
                const arr = JSON.parse(chainParamsRaw);
                for (const cp of arr) { if (cp.key) cpMap[cp.key] = cp; }
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

        /* Parse ui_hierarchy to get paramDefs (label/type fallback) */
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

        /* Try to load a module config for named banks */
        moduleConfig = loadModuleConfig(moduleId);

        if (moduleConfig) {
            /* Config-driven layout: flatten banks → knobParams (null for empty slots) */
            for (const bank of moduleConfig.banks) {
                for (const row of bank.rows) {
                    for (const slot of row) {
                        if (!slot || !slot.key) { knobParams.push(null); continue; }
                        const cp   = cpMap[slot.key]  || {};
                        const hier = paramDefs[slot.key] || {};
                        const type = slot.type || cp.type || hier.type || 'float';
                        let options = cp.options || hier.options || null;
                        let min  = cp.min  != null ? cp.min  : (hier.min  != null ? hier.min  : 0);
                        let max  = cp.max  != null ? cp.max  : (hier.max  != null ? hier.max  : 1);
                        let step = cp.step != null ? cp.step : (hier.step != null ? hier.step : (type === 'float' ? 0.01 : 1));
                        if (type === 'enum') { min = 0; max = options ? options.length - 1 : 127; step = 1; }
                        knobParams.push({
                            key:        slot.key,
                            label:      slot.full  || cp.name || hier.label || slot.key,
                            shortLabel: slot.short || null,
                            type, options, min, max, step,
                        });
                    }
                }
            }
            mlog("loadHierarchy: config loaded for " + moduleId + ", " + moduleConfig.banks.length + " banks");
        } else {
            /* Auto-layout from ui_hierarchy knobs */
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
        if (!p) return;  /* empty slot */

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

    /* ── ViewModel ─────────────────────────────────────────────────────────── */

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
                    displayValue:    formatValue(p, v),
                    touched:         (touchedSlot === physK),
                });
            }
        }

        return {
            moduleName:  activeModuleName,
            bankName,
            bankIndex:   knobPage,
            bankCount:   nBanks,
            rows,
            touchedSlot: touchedSlot >= 0 ? touchedSlot : null,
        };
    }

    /* ── Public API ────────────────────────────────────────────────────────── */

    return {
        handleKnobDelta(k, delta) {
            pendingDeltas[k] += delta;
            if (touchedSlot !== k) { touchedSlot = k; dirty = true; }
        },

        handleKnobTouch(k) {
            if (touchedSlot !== k) { touchedSlot = k; dirty = true; }
        },

        changePage(delta) {
            const next = Math.max(0, Math.min(numBanks() - 1, knobPage + delta));
            if (next !== knobPage) { knobPage = next; dirty = true; }
        },

        getModuleName() { return activeModuleName; },

        reset() {
            knobPage     = 0;
            touchedSlot  = -1;
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
