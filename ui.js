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
import { createModel } from './view/model.mjs';
import { renderKnobsView, renderKeysView, renderBrowseView } from './view/renderer.mjs';

/* ---- Debug log ----------------------------------------------------------- */
function mlog(msg) { console.log('[movy] ' + msg); }

/* ---- Constants ----------------------------------------------------------- */

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
const KNOB_CC_BASE   = MoveKnob1;  /* 71 */

/* ---- State ---------------------------------------------------------------- */

let model       = null;
let activeSlot  = 0;
let rootNote    = 48;  /* C3 */
let currentView = VIEW_KNOBS;
let shiftHeld   = false;
let dirty       = true;

const held = {};

let modules     = [];
let browseIndex = 0;

let initLedIndex = 0;
let initLedsDone = false;

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

/* ---- Note handling -------------------------------------------------------- */

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

/* ---- Root note shift ------------------------------------------------------ */

function changeRoot(semitones) {
    releaseAllNotes();
    rootNote = Math.max(0, Math.min(103, rootNote + semitones));
    for (let pad = PAD_MIN; pad <= PAD_MAX; pad++) {
        setLED(pad, padLedColor(pad), true);
    }
    dirty = true;
}

/* ---- Module browser ------------------------------------------------------- */

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

/* ---- MIDI handler --------------------------------------------------------- */

globalThis.onMidiMessageInternal = function(data) {
    if (!data || data.length < 3) return;

    const status = data[0];
    const d1     = data[1];
    const d2     = data[2];

    /* Ignore capacitive knob touch events (notes 0-9) */
    if ((status & 0xF0) === 0x90 && d1 < 10) return;

    /* --- Pads: note-on/off only; CC messages in pad range fall through --- */
    if (d1 >= PAD_MIN && d1 <= PAD_MAX) {
        if ((status & 0xF0) === 0x90 && d2 > 0) { noteOn(d1);  return; }
        if ((status & 0xF0) === 0x80 || ((status & 0xF0) === 0x90 && d2 === 0)) {
            noteOff(d1); return;
        }
    }

    /* --- Knob CCs (71-78): accumulate in model, applied in tick() --- */
    if ((status & 0xF0) === 0xB0 && d1 >= KNOB_CC_BASE && d1 < KNOB_CC_BASE + NUM_KNOBS) {
        const k     = d1 - KNOB_CC_BASE;
        const delta = decodeDelta(d2);
        mlog("knobCC k=" + k + " d2=" + d2 + " delta=" + delta + " params=" + (model ? "model" : "none"));
        model.handleKnobDelta(k, delta);
        return;
    }

    if ((status & 0xF0) !== 0xB0) return;

    /* --- CC messages --- */
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

/* ---- Lifecycle ------------------------------------------------------------ */

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
    /* Phase 1: progressive LED init */
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
