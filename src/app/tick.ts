import { appState, VIEW_KEYS, VIEW_KNOBS, VIEW_BROWSE, VIEW_CHAIN, VIEW_FILE_BROWSE } from './state.js';
import { keyboardState } from '../keyboard/state.js';
import { browserState } from '../browser/state.js';
import { MASTER_FX_SLOTS } from '../chain/config.js';
import { drumPadLedColor } from '../keyboard/leds.js';
import { chromaticPadColor, chromaticPitch } from '../seq/pads.js';
import { midiNoteName } from '../keyboard/notes.js';
import { renderKnobsView } from '../renderer/knob-view.js';
import { renderKeysView }  from '../renderer/keys-view.js';
import { renderBrowseView } from '../renderer/browse-view.js';
import { renderChainView }    from '../renderer/chain-view.js';
import { renderFileBrowseView } from '../renderer/file-browse-view.js';
import { updateKnobLEDs }  from '../renderer/knob-leds.js';
import { seqEngineTick, takeLabelSync } from '../seq/engine.js';
import { syncLabelsFromEngine, rangeFromChainParams, automationRegistry, denorm7, laneKeysForTrack } from '../seq/automation.js';
import type { AutomationView } from '../types/viewmodel.js';
import { seqPersistTick } from '../seq/persist.js';
import { seqLedsTick, seqLedsInvalidate } from '../seq/leds.js';
import { seqSetLane } from '../seq/router.js';
import { stepAutoTick } from '../seq/step-edit.js';
import { activeHasNote, maxBarOffset, seqState } from '../seq/state.js';
import { engineReady } from '../seq/engine.js';
import {
    drawLoopStrip, drawSeqToast, drawSeqHeader,
    seqToastActive, seqToastTick,
    seqHeaderActive, seqHeaderTick,
} from '../seq/render.js';

const PAD_MIN        = MovePads[0];
const PAD_MAX        = MovePads[MovePads.length - 1];
const LED_INIT_BATCH = 8;

let lastToastShowing = false;
let lastHeaderShowing = false;
let lastSessionMode = false;
let jogToastShown = false;   // a bottom jog/browse toast is on screen (strip yields to it)

/* Per-pad color cache for the chromatic layout: avoids resending unchanged
 * LED colors every tick. Initialized to 0 (C_BLACK); first tick syncs all. */
const chromaticCache = new Uint8Array(32);

/* Assemble the automation snapshot for the param viewmodel from the seq mirror
 * + the lane registry. Kept here (app layer) so model/ stays free of seq/. */
function buildAutomationView(track: number): AutomationView {
    const reg = automationRegistry()[track];
    const heldValues = new Map<number, number>();
    for (const [lane, v] of seqState.heldLocks) {
        const e = reg[lane];
        if (e) heldValues.set(lane, denorm7(v, e.min, e.max));
    }
    const laneForKey = (key: string): number => {
        for (let l = 0; l < 8; l++) if (reg[l] && reg[l]!.shortName === key) return l;
        return -1;
    };
    return {
        assignedLanes: seqState.autoAssigned,
        activeLanes:   seqState.autoActive,
        held:          seqState.stepAutoMode,
        poolFull:      seqState.autoPoolFull,
        heldValues, laneForKey,
    };
}

/* Same idea for the 4×4 drum grid: the drum-pad colors update at poll rate
 * (green follows the sequencer gate / held pads), so cache-diffing keeps the
 * LED traffic to actual changes. */
const drumCache = new Uint8Array(32);

export function tick(): void {
    seqEngineTick();
    stepAutoTick(); // promote a long single-step hold to step-automation mode
    // Engine (re)booted: rebuild the automation registry from its labels and
    // re-apply each lane's chain knob mapping so playback CCs land.
    if (engineReady() && takeLabelSync()) {
        const labels = host_module_get_param('alabels');
        if (labels) {
            syncLabelsFromEngine(
                labels,
                (slot, lane, tp) => shadow_set_param(slot, 'knob_' + (lane + 1) + '_set', tp),
                (tp) => rangeFromChainParams(appState.activeSlot, tp),
            );
        }
    }
    seqPersistTick();
    /* Session toggle changes pad ownership: invalidate the seq LED cache and
     * re-init the instrument pad LEDs when returning to Note mode. */
    if (seqState.sessionMode !== lastSessionMode) {
        lastSessionMode = seqState.sessionMode;
        seqLedsInvalidate();
        if (!seqState.sessionMode) { appState.initLedsDone = false; appState.initLedIndex = 0; chromaticCache.fill(0); }
        appState.dirty = true;
    }
    seqLedsTick(appState.shiftHeld, appState.currentView, seqState.barOffset, maxBarOffset());

    /* Drum status comes from the synth slot (index 1) regardless of which
     * chain module is currently selected — drum pads and step lane stay active
     * even when the user is browsing FX parameters on the same track. */
    const synthModel = appState.trackModels[appState.activeSlot]?.[1];
    const synthDvm   = synthModel?.getViewModel();
    const isDrum     = (synthDvm?.drumPadCount ?? 0) > 0;
    if (isDrum) {
        const cfg = synthModel!.getDrumConfig();
        seqSetLane(cfg ? cfg.padNoteStart + (synthDvm!.drumCurrentPad - 1) : -1);
    } else {
        seqSetLane(-1);
    }

    /* Chromatic instrument-pad init batch. Skipped for a drum track whose synth
     * is already loaded: the drum-grid paint below owns those pads, so painting
     * chromatic first would flash the chromatic layout on (re)select. */
    if (!appState.initLedsDone && !seqState.sessionMode && !isDrum) {
        const total = PAD_MAX - PAD_MIN + 1;
        const end   = Math.min(appState.initLedIndex + LED_INIT_BATCH, total);
        const base  = keyboardState.rootNote;
        for (let i = appState.initLedIndex; i < end; i++) {
            const p = PAD_MIN + i;
            const color = chromaticPadColor(p, PAD_MIN, base, appState.activeSlot, false);
            chromaticCache[i] = color;
            setLED(p, color, true);
        }
        appState.initLedIndex = end;
        if (appState.initLedIndex >= total) { appState.initLedsDone = true; appState.dirty = true; }
        return;
    }

    const chainIdx    = appState.trackChainIndex[appState.activeSlot];
    const activeModel = appState.trackModels[appState.activeSlot]?.[chainIdx];
    // Automation lanes are driven by playback — keep the page from reading them
    // back (decouples display from automation; avoids per-step repaints).
    activeModel?.setNoRefreshKeys(laneKeysForTrack(appState.activeSlot));
    const modelDirty  = activeModel?.tick() ?? false;

    const mIdx        = appState.masterChainIndex;
    const masterModel = seqState.sessionMode ? appState.masterFxModels[mIdx] : null;
    const masterDirty = masterModel?.tick() ?? false;

    seqToastTick();
    seqHeaderTick();
    const toastShowing = seqToastActive();
    const headerShowing = seqHeaderActive();

    if (modelDirty || masterDirty || appState.dirty || toastShowing !== lastToastShowing
        || headerShowing !== lastHeaderShowing) {
        /* A bottom jog/browse toast (drawn by the param/chain renderers) shares
         * the bottom rows with the Loop strip; track it so the per-tick strip
         * below doesn't paint over it. Recomputed each rendered frame; persists
         * across non-dirty ticks since the on-screen toast persists too. */
        jogToastShown = false;
        if (appState.currentView === VIEW_BROWSE) {
            // A browser opened from the master chain shows the master slot label.
            const browseTitle = seqState.sessionMode
                ? (MASTER_FX_SLOTS[mIdx]?.label ?? 'Module')
                : (activeModel?.getModuleName() ?? 'Module');
            renderBrowseView(browserState.modules, browserState.browseIndex, browseTitle);
        } else if (appState.currentView === VIEW_FILE_BROWSE) {
            if (appState.fileBrowserState) renderFileBrowseView(appState.fileBrowserState);
        } else if (seqState.sessionMode) {
            const vm = masterModel!.getViewModel();
            renderChainView(vm, mIdx, appState.jogTouched, 'MASTER', MASTER_FX_SLOTS[mIdx]?.label);
            jogToastShown = appState.jogTouched;
            updateKnobLEDs(vm);
        } else if (appState.currentView === VIEW_KEYS) {
            renderKeysView(activeModel?.getModuleName() ?? '—', keyboardState.rootNote, midiNoteName);
        } else if (appState.currentView === VIEW_KNOBS) {
            const vm = activeModel!.getViewModel(buildAutomationView(appState.activeSlot));
            renderKnobsView(vm, appState.jogTouched, appState.activeSlot);
            jogToastShown = !!vm.toast?.browseHint || appState.jogTouched;
            updateKnobLEDs(vm);
        } else if (appState.currentView === VIEW_CHAIN) {
            const vm = activeModel!.getViewModel();
            renderChainView(vm, chainIdx, appState.jogTouched, 'T' + (appState.activeSlot + 1));
            jogToastShown = appState.jogTouched;
            updateKnobLEDs(vm);
        }
        if (toastShowing) drawSeqToast();
        if (headerShowing) drawSeqHeader();
        lastToastShowing = toastShowing;
        lastHeaderShowing = headerShowing;
        appState.dirty = false;
    }

    /* ── Drum pad LEDs ──────────────────────────────────────────────────────
     * Painted every tick (not just on dirty frames) so a pad turns green the
     * moment its note sounds — from the sequencer gate (activeHasNote) or from
     * the user physically holding it (keyboardState.held) — and reverts when it
     * stops. Green wins over the white "selected" pad and the resting track
     * color (priority lives in drumPadLedColor). In Session mode the clip grid
     * owns the pads (painted by seqLedsTick). synthModel/synthDvm/isDrum come
     * from the synth slot regardless of the active chain index, so drum pads
     * light up even on FX parameter pages. */
    const drumNow = !seqState.sessionMode && isDrum;
    if (drumNow) {
        const drumCfg = synthModel!.getDrumConfig()!;
        const track   = seqState.watchTrack;
        const sel     = synthDvm!.drumCurrentPhysPad;
        for (let i = 0; i <= PAD_MAX - PAD_MIN; i++) {
            const p = PAD_MIN + i;
            // Derive the pad's MIDI note to check activeHasNote (mirrors drumPadLedColor's mapping).
            const idx = p - PAD_MIN, col = idx % 8, row = Math.floor(idx / 8);
            const dp  = drumCfg.rawMidi ? p - drumCfg.padNoteStart + 1 : row * 4 + col + 1;
            const note = drumCfg.rawMidi ? p : drumCfg.padNoteStart + dp - 1;
            const playing = activeHasNote(track, note) || keyboardState.held[p] !== undefined;
            const color = drumPadLedColor(p, PAD_MIN, drumCfg, keyboardState.rootNote, sel, track, playing);
            if (drumCache[i] !== color) {
                drumCache[i] = color;
                setLED(p, color, true);
            }
        }
        appState.drumActive = true;
    } else if (appState.drumActive) {
        appState.drumActive = false;
        appState.initLedsDone = false;
        appState.initLedIndex = 0;
        chromaticCache.fill(0);
        drumCache.fill(0);
    }

    /* Per-tick chromatic pad update: green for sequencer-active or physically-
     * held notes, white for lastHeld set or step-hold overlay (holdNotes),
     * normal scale coloring otherwise. Runs outside the dirty-frame guard so
     * the sequencer's active-note LEDs update at poll rate (~24 Hz) without
     * requiring a full UI redraw. Cache diff prevents redundant LED sends. */
    if (!seqState.sessionMode && !isDrum && appState.initLedsDone) {
        const base      = keyboardState.rootNote;
        const track     = appState.activeSlot;
        const holdNotes = seqState.holdStep >= 0 && seqState.holdNotes.length > 0
            ? seqState.holdNotes : null;
        for (let i = 0; i <= PAD_MAX - PAD_MIN; i++) {
            const p     = PAD_MIN + i;
            const pitch = chromaticPitch(p, PAD_MIN, base);
            const isPlaying = keyboardState.held[p] !== undefined
                || (pitch >= 0 && pitch <= 127 && activeHasNote(track, pitch));
            const color = chromaticPadColor(p, PAD_MIN, base, track, isPlaying, holdNotes);
            if (chromaticCache[i] !== color) {
                chromaticCache[i] = color;
                setLED(p, color, true);
            }
        }
    }

    /* Loop Overview strip overlays the bottom of the param view whenever the
     * sequencer is live; a toast temporarily covers it. Drawn every tick (not
     * just on dirty frames) so the playhead sweeps continuously. Hidden on the
     * master chain (Session mode) — it tracks the watched track's clip, which
     * is irrelevant while editing master FX. */
    if (engineReady() && !seqToastActive() && !jogToastShown && !seqState.sessionMode) {
        drawLoopStrip();
    }
}
