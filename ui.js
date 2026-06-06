/*
 * Movy — piano keyboard + module host for Schwung
 * Tool module: runs in the shadow-UI QuickJS context.
 * Install at: /data/UserData/schwung/modules/tools/movy/
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
import {
    drawMenuList, menuLayoutDefaults,
} from '/data/UserData/schwung/shared/menu_layout.mjs';
import { fontPrint, fontWidth, FONT_HEIGHT } from './ui_font.mjs';

/* ---- Debug log ----------------------------------------------------------- */
function mlog(msg) { console.log('[movy] ' + msg); }

/* ---- Constants ----------------------------------------------------------- */

const PAD_MIN = MovePads[0];   /* 68 */
const PAD_MAX = MovePads[MovePads.length - 1]; /* 99 */

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

const NAME_POLL_TICKS  = 344;  /* poll module name once per second */
const KNOB_REFRESH_TICKS = 69; /* refresh displayed knob values every ~0.2s */
const LED_INIT_BATCH   = 8;

const KNOBS_PER_PAGE = 8;
const KNOBS_PER_ROW  = 4;
const NUM_KNOBS      = KNOBS_PER_PAGE;
const KNOB_CC_BASE   = MoveKnob1;  /* 71 — knob CCs are 71..78 */

/* ---- State ---------------------------------------------------------------- */

let rootNote    = 48;  /* C3 */
let currentView = VIEW_KNOBS;
let shiftHeld   = false;

const held = {};

let modules      = [];
let browseIndex  = 0;
let activeModuleName = "—";
let pollCountdown = NAME_POLL_TICKS;

let initLedIndex = 0;
let initLedsDone = false;
let dirty        = true;

/* Knob params: loaded from synth:ui_hierarchy when module changes */
let knobParams   = [];  /* all params [{key, label, type, min, max, step, options}] */
let knobValues   = [];  /* parallel to knobParams, null = not yet fetched */
let pendingKnobDeltas = new Array(NUM_KNOBS).fill(0);
let hierarchyKey = "";  /* activeModuleName we last loaded hierarchy for */
let knobRefreshCountdown = 0;
let lastTouchedKnob = -1; /* physical knob index 0-7 last turned */
let knobPage     = 0;    /* current page of params (0-indexed) */
let activeSlot   = 0;    /* shadow chain slot index, set from shadow_get_ui_slot() on init */

/* ---- LED helpers ---------------------------------------------------------- */

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

/* ---- Display helpers ------------------------------------------------------ */

const HEADER_H = 8;   /* header bar height */
const FOOTER_Y = 57;  /* footer text top y */

function drawHeader(left, right) {
    fill_rect(0, 0, 128, HEADER_H, 1);
    fontPrint(2, 1, left, 0);
    if (right) {
        fontPrint(128 - fontWidth(right) - 2, 1, right, 0);
    }
}

function drawFooter(text) {
    fill_rect(0, FOOTER_Y, 128, FONT_HEIGHT + 2, 1);
    fontPrint(2, FOOTER_Y + 1, text, 0);
}

function midiNoteName(note) {
    const names = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
    return names[note % 12] + (Math.floor(note / 12) - 1);
}

function moduleAbbrev() {
    /* Fit module name in remaining header space after "Movy " */
    const prefix = fontWidth("Movy ");
    let name = activeModuleName;
    while (name.length > 1 && prefix + fontWidth("[" + name + "]") > 126) {
        name = name.substring(0, name.length - 1);
    }
    return name === activeModuleName ? name : name + "~";
}

function numPages() {
    return Math.max(1, Math.ceil(knobParams.length / KNOBS_PER_PAGE));
}

function changePage(delta) {
    const n = numPages();
    knobPage = Math.max(0, Math.min(n - 1, knobPage + delta));
    dirty = true;
}

function drawKeysView() {
    clear_screen();
    drawHeader("Movy", "[" + moduleAbbrev() + "]");
    const rootName = midiNoteName(rootNote);
    const topName  = midiNoteName(rootNote + 24);
    fontPrint(2, HEADER_H + 5, rootName, 1);
    fontPrint(128 - fontWidth(topName) - 2, HEADER_H + 5, topName, 1);
    drawFooter("L/R:oct  U/D:semi  S+L:mod");
}

function formatKnobValue(gi) {
    const p = knobParams[gi];
    if (!p) return "   ";
    const v = knobValues[gi];
    if (v === null || v === undefined) return "...";
    if (p.type === "enum") {
        if (p.options && p.options[Math.round(v)]) {
            return p.options[Math.round(v)].substring(0, 5);
        }
        return String(Math.round(v));
    }
    if (p.type === "int") return String(Math.round(v));
    const range = (p.max - p.min) || 1;
    return Math.round((v - p.min) / range * 100) + "%";
}

function drawKnobsView() {
    clear_screen();

    /* Header: instrument name left, page number right */
    const nPages = numPages();
    const pageStr = nPages > 1 ? "PG" + (knobPage + 1) : "";
    let dispName = activeModuleName;
    const maxNameW = 128 - (pageStr ? fontWidth(pageStr) + 4 : 0) - 4;
    while (dispName.length > 1 && fontWidth(dispName) > maxNameW) {
        dispName = dispName.slice(0, -1);
    }
    drawHeader(dispName, pageStr);

    /* Page indicator bar (below header) */
    const PAGE_BAR_Y = HEADER_H + 1;
    if (nPages > 1) {
        const segW = Math.floor((128 - (nPages - 1)) / nPages);
        for (let p = 0; p < nPages; p++) {
            const sx = p * (segW + 1);
            const sw = p === nPages - 1 ? 128 - sx : segW;
            if (p === knobPage) {
                fill_rect(sx, PAGE_BAR_Y, sw, 2, 1);      /* selected: 2px thick */
            } else {
                fill_rect(sx, PAGE_BAR_Y + 1, sw, 1, 1);  /* others: 1px at bottom */
            }
        }
    }

    if (knobParams.length === 0) {
        fontPrint(2, HEADER_H + 8, "No params", 1);
        return;
    }

    /* Two rows × 4 cols; labels and values on separate lines */
    const cellW    = 32;
    const ROW0_LBL = HEADER_H + 6;                  /* 14 */
    const ROW0_VAL = ROW0_LBL + FONT_HEIGHT + 2;    /* 21 */
    const ROW1_LBL = ROW0_VAL + FONT_HEIGHT + 6;    /* 32 */
    const ROW1_VAL = ROW1_LBL + FONT_HEIGHT + 2;    /* 39 */

    for (let row = 0; row < 2; row++) {
        const lblY  = row === 0 ? ROW0_LBL : ROW1_LBL;
        const valY  = row === 0 ? ROW0_VAL : ROW1_VAL;
        for (let col = 0; col < KNOBS_PER_ROW; col++) {
            const physK = row * KNOBS_PER_ROW + col;
            const gi    = knobPage * KNOBS_PER_PAGE + physK;
            const p     = knobParams[gi];
            if (!p) continue;
            const x   = col * cellW + 1;
            const lbl = p.label.substring(0, 5);
            const val = formatKnobValue(gi);
            if (physK === lastTouchedKnob) {
                fill_rect(col * cellW, lblY - 1, cellW, FONT_HEIGHT + 2, 1);
                fill_rect(col * cellW, valY - 1, cellW, FONT_HEIGHT + 2, 1);
                fontPrint(x, lblY, lbl, 0);
                fontPrint(x, valY, val, 0);
            } else {
                fontPrint(x, lblY, lbl, 1);
                fontPrint(x, valY, val, 1);
            }
        }
    }
}

function drawBrowseView() {
    clear_screen();
    drawHeader("Sound module");
    const LIST_TOP = HEADER_H + 2;
    const LIST_BOT = FOOTER_Y - 2;
    const rowH = FONT_HEIGHT + 2;

    if (modules.length === 0) {
        fontPrint(2, LIST_TOP, "No modules found", 1);
    } else {
        /* How many items fit */
        const visible = Math.floor((LIST_BOT - LIST_TOP) / rowH);
        const halfVis = Math.floor(visible / 2);
        let startIdx = Math.max(0, Math.min(browseIndex - halfVis, modules.length - visible));
        for (let i = 0; i < visible; i++) {
            const idx = startIdx + i;
            if (idx >= modules.length) break;
            const y = LIST_TOP + i * rowH;
            if (idx === browseIndex) {
                fill_rect(0, y - 1, 128, rowH, 1);
                fontPrint(2, y, modules[idx].name, 0);
            } else {
                fontPrint(2, y, modules[idx].name, 1);
            }
        }
    }
    drawFooter("Back:cancel  Click:load");
}

/* ---- Module scanning ------------------------------------------------------ */

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
            } catch (e) { /* skip unreadable entries */ }
        }
    } catch (e) { /* directory not accessible */ }
    result.sort((a, b) => a.name.localeCompare(b.name));
    return result;
}

function pollModuleName() {
    const name = shadow_get_param(activeSlot, "synth:name")
              || shadow_get_param(activeSlot, "synth_module")
              || "—";
    if (name !== activeModuleName) {
        activeModuleName = name;
        hierarchyKey = "";  /* force hierarchy reload */
        if (currentView === VIEW_KEYS || currentView === VIEW_KNOBS) dirty = true;
    }
}

/* ---- Knob param management ------------------------------------------------ */

function loadHierarchy() {
    knobParams   = [];
    knobValues   = [];
    hierarchyKey = activeModuleName;

    mlog("loadHierarchy: slot=" + activeSlot + " module=" + activeModuleName);
    const raw = shadow_get_param(activeSlot, "synth:ui_hierarchy");
    if (!raw) {
        mlog("loadHierarchy: ui_hierarchy null — using test params");
        knobParams = [
            { key: 'test_a', label: 'TestA', type: 'float', min: 0, max: 1,   step: 0.02, options: null },
            { key: 'test_b', label: 'TestB', type: 'int',   min: 0, max: 127, step: 1,    options: null },
        ];
        knobValues = [0.5, 64];
        return;
    }

    try {
        const hier = JSON.parse(raw);
        if (!hier.levels) return;

        /* Collect param definitions indexed by key */
        const paramDefs = {};
        for (const lvl of Object.values(hier.levels)) {
            if (!lvl.params) continue;
            for (const p of lvl.params) {
                if (!p || !p.key) continue;
                paramDefs[p.key] = p;
            }
        }

        /* Walk knobs array if present, else all root params */
        const rootLevel = hier.levels.root || Object.values(hier.levels)[0];
        if (!rootLevel) return;
        const knobSources = rootLevel.knobs
            ? rootLevel.knobs
            : (rootLevel.params || []);

        for (const knob of knobSources) {
            const key   = typeof knob === 'string' ? knob : knob.key;
            const label = typeof knob === 'string' ? knob : (knob.label || knob.key);
            if (!key) continue;

            const def     = (typeof knob === 'object' && knob.type) ? knob : (paramDefs[key] || {});
            const type    = def.type || 'float';
            const options = def.options || null;
            let min  = def.min  != null ? def.min  : 0;
            let max  = def.max  != null ? def.max  : 1;
            let step = def.step != null ? def.step : (type === 'float' ? 0.02 : 1);

            if (type === 'enum') { min = 0; max = options ? options.length - 1 : 127; step = 1; }

            knobParams.push({ key, label: def.label || label, type, min, max, step, options });
        }
    } catch (e) { mlog("loadHierarchy: parse error " + e); }

    knobValues = new Array(knobParams.length).fill(null);
    mlog("loadHierarchy: loaded " + knobParams.length + " params: " + knobParams.map(p=>p.key).join(","));
}

function refreshKnobValues() {
    for (let gi = 0; gi < knobParams.length; gi++) {
        const raw = shadow_get_param(activeSlot, "synth:" + knobParams[gi].key);
        if (raw !== null) {
            const v = parseFloat(raw);
            if (!isNaN(v)) knobValues[gi] = v;
        }
    }
}

function applyKnobDelta(physK, delta) {
    const gi = knobPage * KNOBS_PER_PAGE + physK;
    const p  = knobParams[gi];
    if (!p) { mlog("applyKnobDelta physK=" + physK + " gi=" + gi + " no param (total=" + knobParams.length + ")"); return; }

    /* Fetch current value if not cached (skip for test params — values are JS-authoritative) */
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
}

/* ---- Note injection ------------------------------------------------------- */

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

/* ---- Root note shift ------------------------------------------------------ */

function changeRoot(semitones) {
    releaseAllNotes();
    rootNote = Math.max(0, Math.min(103, rootNote + semitones));
    for (let pad = PAD_MIN; pad <= PAD_MAX; pad++) {
        setLED(pad, padLedColor(pad), true);
    }
    dirty = true;
}

/* ---- Browser -------------------------------------------------------------- */

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
    activeModuleName = mod.name;
    hierarchyKey = "";  /* force hierarchy reload */
    currentView = VIEW_KNOBS;
    dirty = true;
}

/* ---- MIDI handler --------------------------------------------------------- */

globalThis.onMidiMessageInternal = function(data) {
    if (!data || data.length < 3) return;

    const status = data[0];
    const d1     = data[1];
    const d2     = data[2];

    /* Ignore capacitive knob touch events (notes 0-9) */
    if ((status & 0xF0) === 0x90 && d1 < 10) return;

    /* --- Pads (note-on/off only; CC messages with d1 in pad range fall through) --- */
    if (d1 >= PAD_MIN && d1 <= PAD_MAX) {
        if ((status & 0xF0) === 0x90 && d2 > 0) {
            noteOn(d1);
            return;
        } else if ((status & 0xF0) === 0x80 || ((status & 0xF0) === 0x90 && d2 === 0)) {
            noteOff(d1);
            return;
        }
    }

    /* --- Knobs (CC71-78): accumulate delta, apply in tick() --- */
    if ((status & 0xF0) === 0xB0 && d1 >= KNOB_CC_BASE && d1 < KNOB_CC_BASE + NUM_KNOBS) {
        const k = d1 - KNOB_CC_BASE;
        const delta = decodeDelta(d2);
        mlog("knobCC k=" + k + " d2=" + d2 + " delta=" + delta + " params=" + knobParams.length);
        pendingKnobDeltas[k] += delta;
        lastTouchedKnob = k;
        return;
    }

    if ((status & 0xF0) !== 0xB0) return;

    /* --- CC messages --- */
    if (d1 === MoveShift) {
        shiftHeld = d2 > 0;
        return;
    }

    if (d1 === MoveBack && d2 > 0) {
        if (currentView === VIEW_BROWSE || currentView === VIEW_KEYS) {
            currentView = VIEW_KNOBS;
            dirty = true;
        } else {
            releaseAllNotes();
            host_exit_module();
        }
        return;
    }

    /* --- Jog click: toggle KEYS ↔ KNOBS --- */
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
        if (d1 === MoveLeft  && d2 > 0) { shiftHeld ? openBrowser() : changePage(-1); return; }
        if (d1 === MoveRight && d2 > 0) { shiftHeld ? openBrowser() : changePage(1);  return; }
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
            if (delta !== 0) {
                browseIndex = Math.max(0, Math.min(modules.length - 1, browseIndex + delta));
                dirty = true;
            }
            return;
        }
    }
};

/* ---- Lifecycle ------------------------------------------------------------ */

globalThis.init = function() {
    activeSlot = (typeof shadow_get_ui_slot === 'function') ? shadow_get_ui_slot() : 0;
    mlog("init: activeSlot=" + activeSlot);
    currentView   = VIEW_KNOBS;
    shiftHeld     = false;
    pollCountdown = NAME_POLL_TICKS;
    knobRefreshCountdown = 0;
    lastTouchedKnob = -1;
    knobPage = 0;
    for (const k of Object.keys(held)) delete held[k];
    for (let i = 0; i < NUM_KNOBS; i++) pendingKnobDeltas[i] = 0;

    initLedIndex = 0;
    initLedsDone = false;
    dirty = true;
};

globalThis.tick = function() {
    /* Phase 1: progressive LED init */
    if (!initLedsDone) {
        const total = PAD_MAX - PAD_MIN + 1;
        const end = Math.min(initLedIndex + LED_INIT_BATCH, total);
        for (let i = initLedIndex; i < end; i++) {
            setLED(PAD_MIN + i, padLedColor(PAD_MIN + i), true);
        }
        initLedIndex = end;
        if (initLedIndex >= total) { initLedsDone = true; dirty = true; }
        return;
    }

    /* Load hierarchy when module changes */
    if (hierarchyKey !== activeModuleName) {
        knobPage = 0;
        loadHierarchy();
        knobRefreshCountdown = 0;
        dirty = true;
    }

    /* Apply pending knob deltas */
    for (let k = 0; k < NUM_KNOBS; k++) {
        if (pendingKnobDeltas[k] !== 0) {
            applyKnobDelta(k, pendingKnobDeltas[k]);
            pendingKnobDeltas[k] = 0;
            if (currentView === VIEW_KNOBS) dirty = true;
        }
    }

    /* Periodic tasks */
    if (--pollCountdown <= 0) {
        pollCountdown = NAME_POLL_TICKS;
        pollModuleName();
    }
    if (--knobRefreshCountdown <= 0) {
        knobRefreshCountdown = KNOB_REFRESH_TICKS;
        if (knobParams.length > 0) {
            const prevVals = knobValues.slice();
            refreshKnobValues();
            /* Only redraw knob view if values changed */
            if (currentView === VIEW_KNOBS) {
                for (let k = 0; k < knobParams.length; k++) {
                    if (knobValues[k] !== prevVals[k]) { dirty = true; break; }
                }
            }
        }
    }

    if (dirty) {
        if (currentView === VIEW_KEYS)   drawKeysView();
        else if (currentView === VIEW_KNOBS)  drawKnobsView();
        else                              drawBrowseView();
        dirty = false;
    }
};
