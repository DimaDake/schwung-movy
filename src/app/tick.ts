import { portFor } from '../track/registry.js';
import { appState, VIEW_KEYS, VIEW_KNOBS, VIEW_BROWSE, VIEW_CHAIN, VIEW_FILE_BROWSE, VIEW_MAIN_PARAMS, VIEW_CLIP_PARAMS, VIEW_FLAGS } from './state.js';
import { mainPageActive, mainPageState } from '../seq/main-page.js';
import { buildMainPageVM } from '../seq/main-page-vm.js';
import { clipPageActive, clipPageState } from '../seq/clip-page.js';
import { buildClipPageVM } from '../seq/clip-page-vm.js';
import { buildFlagsPageVM } from '../seq/flags-page-vm.js';
import { FLAG_KNOB } from '../seq/flags-page.js';
import { renderFlagsView } from '../renderer/flags-view.js';
import { keyboardState, baseNoteFor, padMapFor } from '../keyboard/state.js';
import { isSounding } from '../keyboard/held-notes.js';
import { browserState } from '../browser/state.js';
import { MASTER_FX_SLOTS } from '../chain/config.js';
import { drumPadLedColor } from '../keyboard/leds.js';
import { drumNoteOfPhys } from '../keyboard/drum-grid.js';
import { WHITE_DIM } from '../seq/colors.js';
import { padColor } from '../seq/pads.js';
import { midiNoteName } from '../keyboard/notes.js';
import { renderKnobsView } from '../renderer/knob-view.js';
import { renderKeysView }  from '../renderer/keys-view.js';
import { renderBrowseView } from '../renderer/browse-view.js';
import { renderChainView }    from '../renderer/chain-view.js';
import { renderFileBrowseView } from '../renderer/file-browse-view.js';
import { updateKnobLEDs, updateSingleKnobLED, resetKnobLedCache } from '../renderer/knob-leds.js';
import { seqEngineTick, takeLabelSync, requestLabelSync } from '../seq/engine.js';
import { drumSyncTick, resetDrumSync } from '../seq/drum-sync.js';
import { syncLabelsFromEngine, validateLane, automationRegistry, denorm7, laneKeysForTrack, automationDisplayDirty, liveTurnValues, poolIsFull, verifyLaneMappings, requestLaneWarm, laneWarmTick } from '../seq/automation.js';
import type { AutomationView, ViewModel } from '../types/viewmodel.js';
import type { Model } from '../model/index.js';
import { concreteKey } from '../model/pad-scope.js';
import { mlog } from '../log.js';
import { chainLoadsPending, sessionError, sessionPhase, sessionReady, sessionTick } from '../seq/set-session.js';
import { takeSurfaceReturn } from '../seq/set-commit.js';
import { claimLedOwnership } from './led-ownership.js';
import { renderLoadingView } from '../renderer/loading-view.js';
import { tempoOverrideTick } from '../seq/tempo-override.js';
import { captureTick } from '../seq/capture.js';
import { seqLedsTick, seqLedsInvalidate, displayHoldNotes } from '../seq/leds.js';
import { ledBudgetTake, ledFrameReset } from '../seq/led-cache.js';
import { seqSetLane } from '../seq/router.js';
import { stepAutoTick } from '../seq/step-edit.js';
import { stepRecTick } from '../seq/step-rec-view.js';
import { holdTick, assignActive, assignToastText } from '../lfo/assign-mode.js';
import { jogHintTick, jogHintVisible } from './jog-hint.js';
import { drawJogToast } from '../renderer/overlay.js';
import { volumeOverlay } from '../mixer/track-volume.js';
import { drawVolumeOverlay } from '../renderer/volume-overlay.js';
import { leaveModalActive, leaveModalLabels, leaveModalSel } from './leave-modal.js';
import { drawLeaveModal } from '../renderer/leave-modal-view.js';
import { captureOverlayActive } from '../seq/capture.js';
import { buildCaptureVM } from '../seq/capture-vm.js';
import { drawCaptureOverlay } from '../renderer/capture-overlay.js';
import {
    quantOverlayActive, quantOverlayTickAt, buildQuantOverlayVM,
} from '../seq/quant-overlay.js';
import { drawQuantOverlay } from '../renderer/quant-overlay.js';
import { drawUndoOverlay } from '../renderer/undo-overlay.js';
import { undoTick } from '../undo/group.js';
import { moduleRestoreTick } from '../undo/module-apply.js';
import { recPassTick } from '../undo/rec-pass.js';
import { flushOrphanedSnaps, onEngineNoop, undoWatchContext } from '../undo/apply.js';
import { undoToast, undoToastActive, undoToastTick } from '../undo/toast.js';
import { takeNoopSnapId } from '../seq/engine.js';
import { stepPageState, stepPageAvailable } from '../seq/step-page.js';
import { buildStepPageVM } from '../seq/step-page-vm.js';
import { activeHasNote, maxBarOffset, seqState } from '../seq/state.js';
import { engineReady } from '../seq/engine.js';
import { perfProbeEnter, perfProbeTick, perfPhase, perfPhaseEnd } from './perf-probe.js';
import {
    drawLoopStrip, drawLoopHeader, drawSeqToast, drawSeqHeader,
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

/* Last-seen module name per "track:chainIdx", to detect a module swap on a
 * focused component (its param set changed → re-validate that track's automation
 * lanes). Keyed by component so navigating the chain view never false-triggers. */
const lastModuleName = new Map<string, string>();

/* Per-pad color cache for the chromatic layout: avoids resending unchanged
 * LED colors every tick. Initialized to 0 (C_BLACK); first tick syncs all. */
const chromaticCache = new Uint8Array(32);

/* Assemble the automation snapshot for the param viewmodel from the seq mirror
 * + the lane registry. Kept here (app layer) so model/ stays free of seq/. */
function buildAutomationView(track: number, model: Model): AutomationView {
    const reg = automationRegistry()[track];
    const heldValues = new Map<number, number>();
    for (const [lane, v] of seqState.heldLocks) {
        const e = reg[lane];
        if (e) heldValues.set(lane, denorm7(v, e.min, e.max));
    }
    const liveValues = new Map<number, number>();
    for (const [lane, v] of liveTurnValues(track)) {
        const e = reg[lane];
        if (e) liveValues.set(lane, denorm7(v, e.min, e.max));
    }
    // Resolve the dot/value lane through the focused pad's concrete key, so a
    // lane belonging to a different pad matches no key on the current page (its
    // dot vanishes) — switching the focused pad re-scopes the display for free.
    const ps   = model.getDrumConfig()?.padScoping;
    const pad  = model.getDrumCurrentPad();
    const ck   = model.getComponentKey();
    const laneForKey = (key: string): number => {
        const tp = ck + ':' + concreteKey(ps, pad, key);
        for (let l = 0; l < 8; l++) if (reg[l] && reg[l]!.targetParam === tp) return l;
        return -1;
    };
    return {
        assignedLanes: seqState.autoAssigned,
        activeLanes:   seqState.autoActive,
        held:          seqState.stepAutoMode,
        poolFull:      poolIsFull(track),
        heldValues, liveValues, laneForKey,
    };
}

let _autoLanesLog = '';
let _autoRenderLog = '';
/* Diagnostic (off unless debug_log_on): the per-knob automation render decision
 * — automated (a, the dot) and touched (t, showing the held value) — so the
 * device automation test can assert the dot + held-value highlight without
 * reading pixels. Throttled to changes, so it is silent at steady state. */
function diagAutoRender(vm: ViewModel): void {
    let line = 'held=' + (vm.automationHeld ? 1 : 0) + ' |';
    for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) {
        const pv = vm.rows[r][c];
        if (!pv) continue;
        line += ' ' + pv.shortName + ':a' + (pv.automated ? 1 : 0) + 't' + (pv.touched ? 1 : 0)
            + '=' + (pv.touched ? pv.displayValue : '-');
    }
    if (line !== _autoRenderLog) { _autoRenderLog = line; mlog('auto render ' + line); }
}

/* The held-step trig mirror as the step-page VM input. */
function heldTrigInput() {
    return {
        holdVel: seqState.holdVel, holdGate: seqState.holdGate, holdGateMixed: seqState.holdGateMixed,
        holdProb: seqState.holdProb, holdCondA: seqState.holdCondA, holdCondB: seqState.holdCondB,
        holdInvert: seqState.holdInvert,
    };
}

let lastStepTrigSig = '';
function stepTrigSig(): string {
    return [seqState.holdVel, seqState.holdGate, seqState.holdGateMixed,
        seqState.holdProb, seqState.holdCondA, seqState.holdCondB, seqState.holdInvert,
        seqState.holdMaxGate, stepPageState.selected, stepPageState.touchedKnob].join(',');
}

let lastMainSig = '';
function mainSig(): string {
    return [mainPageActive(), mainPageState.touchedKnob, mainPageState.overlayKnob,
        mainPageState.overlaySel, seqState.bpmX100, seqState.swingPct,
        keyboardState.rootPc, keyboardState.scale,
        keyboardState.mode, keyboardState.layout,
        keyboardState.octave[appState.activeTrack.index]].join(',');
}

let lastClipSig = '';
function clipSig(): string {
    return [clipPageActive(), clipPageState.touchedKnob, clipPageState.scaleOverlay,
        clipPageState.scaleSel, seqState.clipScaleIdx, seqState.lenSteps,
        seqState.clipTranspose].join(',');
}

/* Same idea for the 4×4 drum grid: the drum-pad colors update at poll rate
 * (green follows the sequencer gate / held pads), so cache-diffing keeps the
 * LED traffic to actual changes. */
const drumCache = new Uint8Array(32);

/* A track switch invalidates the drum grid cache once. It used to re-assert the
 * whole grid for 40 ticks to outlast Move's native pad repaint on a track-button
 * press — but movy now owns the pad LEDs outright (the host strips Move's
 * cable-0 note LEDs unconditionally, and its RGB sysex via the suppression we
 * claim at init), so there is no race left to win. The one-shot invalidation
 * stays: it is what makes the grid overwrite colours left by the previous
 * layout, which the per-pad cache would otherwise consider already correct. */
let drumCacheStale = false;
let lastActiveSlot   = -1;
let lastShownKey     = '';   // identity of the on-screen param page (for touch reset)

/* Device ticks ~90-205 Hz → verify one track's lane mappings every ~2-5 s;
 * full 4-track coverage inside ~20 s of a module reload. */
const LANE_VERIFY_TICKS = 400;
let laneVerifyTicks = 0;

/* Reading a mapped knob's `_value` routes through the host's find_param_by_key,
 * which repopulates the per-component param cache abs-CC needs after a reload. */
const warmReadValue = (slot: number, lane: number): void => {
    portFor(slot).getParam( 'knob_' + (lane + 1) + '_value');
};

/* Return from background: the host restored the suspend-time LED snapshot to
 * hardware, but the sequencer advanced while we were parked, so every on-change
 * LED cache is now stale. Drop them all and force a full repaint so the first
 * active frame repaints the pads, knob LEDs, and screen from current state. */
/* The LED repair is several layers deep — the chromatic init batch, the drum
 * grid, the session painter, the knob rings — and each has its own gate, so a
 * repaint that only half happens says which gate was shut. Logged on both paths
 * that need the repair (resume, and the set-commit surface window), then again
 * once it should have finished. */
let ledWatchTicks = -1;
/* schwung clears the LEDs when it observes the overtake re-entry, and that can
 * land AFTER movy has finished repainting — the device showed all 32 pads
 * painted (initIdx=32, twice) with the hardware still dark. Rather than race
 * it, repaint a second time once the entry has settled. One extra pass over 32
 * pads and the step row is nothing next to a surface that looks broken. */
let ledRepeatTicks = -1;
const LED_REPEAT_TICKS = 45;

function ledContext(): string {
    /* The selected track AND the one the engine says it is reporting on. They
     * are the same number whenever the subscription has landed, which is the
     * point: a repaint log showing only the first could not tell a working open
     * from the one that recorded track 2's take into track 1. */
    return 'session=' + (seqState.sessionMode ? 1 : 0)
        + ' track=' + appState.activeTrack.index
        + ' engine=' + seqState.reportedTrack
        + ' initDone=' + (appState.initLedsDone ? 1 : 0)
        + ' initIdx=' + appState.initLedIndex
        + ' drumStale=' + (drumCacheStale ? 1 : 0);
}

export function logLedRepaint(why: string): void {
    mlog('leds: repaint (' + why + ') ' + ledContext());
    ledWatchTicks = 90;
    ledRepeatTicks = LED_REPEAT_TICKS;
}

export function ledRepaintWatch(): void {
    if (ledRepeatTicks >= 0 && --ledRepeatTicks <= 0) {
        ledRepeatTicks = -1;
        claimLedOwnership();
        invalidateLedCachesOnResume();
        mlog('leds: repainting again ' + ledContext());
    }
    if (ledWatchTicks < 0) return;
    if (--ledWatchTicks > 0) return;
    ledWatchTicks = -1;
    mlog('leds: after repaint ' + ledContext());
}

export function invalidateLedCachesOnResume(): void {
    chromaticCache.fill(0);
    drumCache.fill(0);
    resetKnobLedCache();
    seqLedsInvalidate();
    lastActiveSlot = -1;      // forces the grid invalidation on the next tick
    drumCacheStale = true;
    appState.drumActive = false;
    appState.initLedsDone = false;
    appState.initLedIndex = 0;
    appState.dirty = true;
}

export function tick(): void {
    perfProbeEnter();
    tickBody();
    /* Outside tickBody so the parked early-return is still accounted for. */
    perfProbeTick();
}

function tickBody(): void {
    /* One LED frame per app tick. This used to live at the top of seqLedsTick,
     * which was fine while that was the only budgeted writer — now the pad
     * painters and the knob rings share the budget too, and any tick that did
     * not reach seqLedsTick would leave it exhausted and silently stop every
     * LED on the device. */
    ledFrameReset();
    perfPhase('seqengine');
    // Keep the engine mirror synced first (flushes any queued command, polls
    // status) — the mock/real engine reports transport + step state regardless
    // of whether we are on screen.
    seqEngineTick();
    // Tell the engine which tracks are drum tracks (it suppresses clip transpose
    // on those). Queued as a command, so it rides the same batch as everything
    // else and is held through engine boot.
    perfPhase('drumsync');
    drumSyncTick();
    // Flush a debounced tempo-knob change to Move's Link override before the
    // parked early-return, so a tempo edit made just before backgrounding
    // still reaches Move (the write is cheap and independent of the display).
    perfPhase('tempocap');
    tempoOverrideTick();
    captureTick();
    perfPhase('rest');
    // Parked in the background: Move's native UI is on screen and the host
    // no-ops our draw calls. The DSP keeps sequencing + emitting Phase 1 clock
    // on its own, so the JS side only has to stay synced (above) and keep
    // autosaving. Skip the whole render + LED pipeline — this saves the
    // per-frame ViewModel build and LED diffs. onResume() forces a full repaint
    // when we return, so nothing on screen is stale.
    if (globalThis.overtakeParked === true) {
        sessionTick();
        return;
    }
    stepAutoTick(); // promote a long single-step hold to step-automation mode
    stepRecTick();  // keep the step-record header band alive while Rec is held
    if (holdTick()) appState.dirty = true;    // knob-hold → LFO assign mode
    if (jogHintTick()) appState.dirty = true; // jog rested without turning → CLICK JOG hint
    // The held-step value display is driven by stepAutoMode + heldLocks, which
    // change via consumed knob turns and the status poll — both outside the
    // param page's normal dirty path. Repaint when that display state changes.
    if (automationDisplayDirty()) appState.dirty = true;
    // Repaint when the step page's selection or mirrored trig values change.
    if (stepTrigSig() !== lastStepTrigSig) { lastStepTrigSig = stepTrigSig(); appState.dirty = true; }
    // Repaint when main params page values or touch/overlay state change.
    if (mainSig() !== lastMainSig) { lastMainSig = mainSig(); appState.dirty = true; }
    // Repaint when clip params page values or touch/overlay state change.
    if (clipSig() !== lastClipSig) { lastClipSig = clipSig(); appState.dirty = true; }
    // Diagnostic (off unless debug_log_on): the UI lane registry mirrors the
    // engine's assigned lanes. Empty here means automation display + read-back
    // suppression are dead — the device automation test asserts it is populated.
    const laneKeys = laneKeysForTrack(appState.activeTrack.index).join(',');
    if (laneKeys !== _autoLanesLog) { _autoLanesLog = laneKeys; mlog('auto lanes t=' + appState.activeTrack.index + ' [' + laneKeys + ']'); }
    // Engine (re)booted: rebuild the automation registry from its labels and
    // re-apply each lane's chain knob mapping so playback CCs land.
    if (engineReady() && takeLabelSync()) {
        resetDrumSync();   // a rebooted engine has lost the drum flags too
        const labels = host_module_get_param('alabels');
        if (labels) {
            syncLabelsFromEngine(
                labels,
                (slot, lane, tp) => portFor(slot).setParam('knob_' + (lane + 1) + '_set', tp),
                (track, tp) => {
                    // Validate against the lane's own (track, component) model param
                    // set — authoritative even for config-driven drum modules. Keep
                    // the lane (`unknown`) when that model isn't loaded yet, so a
                    // transient never wipes valid automation.
                    const comp  = tp.slice(0, tp.indexOf(':'));
                    const model = appState.trackModels[track]?.find((m) => m.getComponentKey() === comp);
                    if (!model || !model.hasLoadedParams()) return 'unknown';
                    const ps = model.getDrumConfig()?.padScoping ?? null;
                    return validateLane(tp, ps, (key) => model.paramRangeByKey(key));
                },
            );
        }
    }
    // A chain module reload (user swap, dev redeploy) clears the chain-side
    // knob mappings while the lane registry lives on — automation then no-ops
    // with an intact UI. Slow round-robin verify + re-apply (1 IPC read per
    // window, tracks with no lanes cost nothing).
    if (++laneVerifyTicks >= LANE_VERIFY_TICKS) {
        laneVerifyTicks = 0;
        verifyLaneMappings(
            (slot, lane) => portFor(slot).getParam( 'knob_' + (lane + 1) + '_name'),
            (slot, lane, tp) => {
                mlog('auto remap t=' + slot + ' lane=' + lane + ' ' + tp);
                portFor(slot).setParam('knob_' + (lane + 1) + '_set', tp);
            },
        );
    }
    // Drive any scheduled param-cache warms (spread across a short window after a
    // reselect/reload; idle-cheap). Recovers abs-CC audibility without a restart.
    // On window close, log the resulting cache state (knob_N_max is the fallback
    // "1.00"/float when the host cache is still empty → abs-CC would be silent):
    // field observability for this failure mode, and the reselect e2e's assertion.
    laneWarmTick(warmReadValue, (t, l) => {
        mlog('auto warm t=' + t
            + ' cache=' + portFor(t).getParam( 'knob_' + (l + 1) + '_max')
            + ' type=' + portFor(t).getParam( 'knob_' + (l + 1) + '_type'));
    });
    sessionTick();
    /* The set-commit window lends Move the surface for a moment, and Move
     * repaints the pads while it holds it. Same repair a resume needs, for the
     * same reason — see seq/set-commit.ts. Only ever armed while movy is in
     * front, which is why it lives on this side of the parked return. */
    if (takeSurfaceReturn()) {
        claimLedOwnership();
        invalidateLedCachesOnResume();
        logLedRepaint('surface returned');
    }
    ledRepaintWatch();
    /* Undo housekeeping, after seqPersistTick so the set uuid it watches is the
     * one this tick resolved. Order within: close timed-out groups, notice a
     * set/engine change, drop snapshots the stacks have released, retract a
     * group the engine reported as a no-op. */
    recPassTick();
    undoTick();
    moduleRestoreTick();
    undoWatchContext();
    flushOrphanedSnaps();
    const noop = takeNoopSnapId();
    if (noop >= 0) onEngineNoop(noop);
    if (undoToastTick()) appState.dirty = true;
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
    const synthModel = appState.trackModels[appState.activeTrack.index]?.[1];
    const isDrum     = (synthModel?.getDrumPadCount() ?? 0) > 0;

    /* A track switch changes what the pads mean, so the grid must repaint even
     * where the new colour matches the cached one. Detected here (before the
     * chromatic-init early-return below) so it fires regardless of whether the
     * new track is a drum or melodic track. */
    if (appState.activeTrack.index !== lastActiveSlot) {
        lastActiveSlot = appState.activeTrack.index;
        drumCacheStale = true;
    }
    if (isDrum) {
        const cfg = synthModel!.getDrumConfig();
        seqSetLane(cfg ? cfg.padNoteStart + (synthModel!.getDrumCurrentPad() - 1) : -1);
    } else {
        seqSetLane(-1);
    }

    /* Chromatic instrument-pad init batch. Skipped for a drum track whose synth
     * is already loaded: the drum-grid paint below owns those pads, so painting
     * chromatic first would flash the chromatic layout on (re)select. */
    if (!appState.initLedsDone && !seqState.sessionMode && !isDrum) {
        const total = PAD_MAX - PAD_MIN + 1;
        const end   = Math.min(appState.initLedIndex + LED_INIT_BATCH, total);
        let i = appState.initLedIndex;
        for (; i < end; i++) {
            /* Stop at the frame budget rather than sending into a full output
             * buffer — the overflow is dropped silently, and the cache write
             * below would then claim the pad was painted. */
            if (!ledBudgetTake()) break;
            const p = PAD_MIN + i;
            const color = padColor(p, PAD_MIN, appState.activeTrack.index, false);
            chromaticCache[i] = color;
            setLED(p, color, true);
        }
        appState.initLedIndex = i;
        /* The octave arrows finish the layout, so they are part of it: if the
         * budget cannot take them, do not mark the init done — retry next tick
         * rather than leave them dark for good. */
        if (appState.initLedIndex >= total && ledBudgetTake(2)) {
            setButtonLED(MoveUp, WHITE_DIM, true);
            setButtonLED(MoveDown, WHITE_DIM, true);
            appState.initLedsDone = true; appState.dirty = true;
        }
        return;
    }

    const chainIdx    = appState.trackChainIndex[appState.activeTrack.index];
    const activeModel = appState.trackModels[appState.activeTrack.index]?.[chainIdx];
    // Automation lanes are driven by playback — keep the page from reading them
    // back (decouples display from automation; avoids per-step repaints).
    activeModel?.setNoRefreshKeys(laneKeysForTrack(appState.activeTrack.index));
    perfPhase('modeltick');
    const modelDirty  = activeModel?.tick() ?? false;
    perfPhaseEnd();

    /* A module swap on the focused component changes its param set → re-validate
     * this track's automation lanes (the label sync drops lanes the new module
     * no longer has). Skipped on the first sighting (boot sync covers it) and on
     * empty transients during load. */
    const mnKey = appState.activeTrack.index + ':' + chainIdx;
    const mn    = activeModel?.getModuleName() ?? '';
    if (mn && lastModuleName.get(mnKey) !== mn) {
        if (lastModuleName.has(mnKey)) {
            requestLabelSync();
            // The reload emptied the host's static param cache; schedule the warm
            // so abs-CC automation becomes audible again (see warmLaneParams).
            requestLaneWarm(appState.activeTrack.index);
        }
        lastModuleName.set(mnKey, mn);
    }

    const mIdx        = appState.masterChainIndex;
    const masterModel = seqState.sessionMode ? appState.masterFxModels[mIdx] : null;
    const masterDirty = masterModel?.tick() ?? false;

    // Reset knob touch/hold state whenever the shown param page changes, so a
    // held knob's highlight never persists after navigating away and back (e.g.
    // after assigning an LFO from a held knob — the release lands on the LFO
    // model, not the module, so the module's touch would otherwise stick).
    const shownKey = seqState.sessionMode
        ? 'M' + mIdx + (appState.masterDetail ? 'd' : '')
        : appState.activeTrack.index + ':' + chainIdx;
    if (shownKey !== lastShownKey) {
        lastShownKey = shownKey;
        (seqState.sessionMode ? masterModel : activeModel)?.clearTouch();
    }

    seqToastTick();
    /* Wall-clock, unlike the toast's tick counter — see quant-overlay.ts. The
     * expiry sets appState.dirty itself, so the view underneath repaints once. */
    quantOverlayTickAt(Date.now());
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
        } else if (!sessionReady()) {
            /* Ahead of every view: until the Set is in the engine there is
             * nothing truthful to draw, and input is refused anyway. */
            renderLoadingView(sessionPhase(), sessionError(), chainLoadsPending());
        } else if (appState.currentView === VIEW_MAIN_PARAMS) {
            const vm = buildMainPageVM();
            renderKnobsView(vm, false, appState.activeTrack.index);
            updateKnobLEDs(vm); // knobs 0-3 reflect value; 4-7 (null cells) off
        } else if (appState.currentView === VIEW_CLIP_PARAMS) {
            const vm = buildClipPageVM();
            renderKnobsView(vm, false, appState.activeTrack.index);
            updateKnobLEDs(vm); // knobs 0-2 reflect value; 3-7 (null cells) off
        } else if (appState.currentView === VIEW_FLAGS) {
            const vm = buildFlagsPageVM();
            renderFlagsView(vm);
            // Only knob 1 lights, and its brightness is the value — the page is
            // a list, so the LED is the only thing saying which knob edits it.
            updateSingleKnobLED(FLAG_KNOB, vm.knobNormalized);
        } else if (seqState.sessionMode) {
            const vm = masterModel!.getViewModel();
            if (appState.masterDetail) {
                // Drilled into the focused master slot's module: show its knob
                // detail page (param banks scroll via jog), same as a track slot.
                renderKnobsView(vm, jogHintVisible(), appState.activeTrack.index);
            } else {
                renderChainView(vm, mIdx, jogHintVisible(), 'MASTER', MASTER_FX_SLOTS[mIdx]?.label, MASTER_FX_SLOTS);
            }
            jogToastShown = jogHintVisible();
            updateKnobLEDs(vm);
        } else if (appState.currentView === VIEW_KEYS) {
            renderKeysView(activeModel?.getModuleName() ?? '—', baseNoteFor(appState.activeTrack.index), midiNoteName);
        } else if (appState.currentView === VIEW_KNOBS) {
            const stepAvail = stepPageAvailable();
            let vm;
            if (stepAvail && stepPageState.selected) {
                vm = buildStepPageVM(heldTrigInput(), activeModel!.getBankCount());
            } else {
                perfPhase('autoview');
                const av = buildAutomationView(appState.activeTrack.index, activeModel!);
                perfPhase('buildvm');
                vm = activeModel!.getViewModel(av);
                perfPhaseEnd();
                if (stepAvail) { vm.stepPagePresent = true; vm.stepPageSelected = false; }
            }
            diagAutoRender(vm);
            perfPhase('render');
            renderKnobsView(vm, jogHintVisible(), appState.activeTrack.index);
            perfPhaseEnd();
            // The pool-full toast shares the bottom rows with the Loop strip;
            // claim them so the strip yields to it (like every other toast).
            jogToastShown = (vm.automationHeld && vm.automationPoolFull)
                || !!vm.toast?.browseHint || jogHintVisible();
            perfPhase('leds');
            updateKnobLEDs(vm);
            perfPhaseEnd();
        } else if (appState.currentView === VIEW_CHAIN) {
            const stepAvail = stepPageAvailable();
            let vm;
            if (stepAvail && stepPageState.selected) {
                vm = buildStepPageVM(heldTrigInput(), activeModel?.getBankCount() ?? 1);
            } else {
                vm = activeModel!.getViewModel(buildAutomationView(appState.activeTrack.index, activeModel!));
                if (stepAvail) { vm.stepPagePresent = true; vm.stepPageSelected = false; }
            }
            diagAutoRender(vm);
            renderChainView(vm, chainIdx, jogHintVisible(), 'T' + (appState.activeTrack.index + 1));
            /* Must match what renderChainView actually drew: the Loop strip
             * clears rows 60-63 every tick and would erase a toast it was not
             * told about. */
            jogToastShown = !!vm.toast?.browseHint || jogHintVisible();
            updateKnobLEDs(vm);
        }
        /* Track-volume slider sits above the view it was invoked from. Only
         * visible in the Shift variant — without Shift the shim has handed the
         * panel to Move for the duration of the knob touch (see
         * mixer/track-volume.ts), so this frame is drawn but never pushed. */
        const vol = volumeOverlay();
        if (vol) drawVolumeOverlay(vol);
        if (assignActive()) { drawJogToast(assignToastText()); jogToastShown = true; }
        if (toastShowing) drawSeqToast();
        if (headerShowing) drawSeqHeader();
        /* Quantize panel: a strip over the view, below every overlay that owns
         * the screen — it is a confirmation, not a decision. */
        if (quantOverlayActive()) drawQuantOverlay(buildQuantOverlayVM());
        // The post-capture overlay owns the screen until it is dismissed.
        if (captureOverlayActive()) drawCaptureOverlay(buildCaptureVM());
        /* Undo toast sits above the views but below the capture overlay and the
         * leave modal, both of which own the screen while they are up. */
        if (undoToastActive()) drawUndoOverlay(undoToast()!);
        // Leave-Movy modal draws on top of everything else.
        if (leaveModalActive()) drawLeaveModal(leaveModalLabels(), leaveModalSel());
        lastToastShowing = toastShowing;
        lastHeaderShowing = headerShowing;
        appState.dirty = false;
    }

    /* ── Drum pad LEDs ──────────────────────────────────────────────────────
     * Painted every tick (not just on dirty frames) so a pad turns green the
     * moment its note sounds — from the sequencer gate (activeHasNote) or from
     * the user physically holding it (the live-note ledger) — and reverts when it
     * stops. Green wins over the white "selected" pad and the resting track
     * color (priority lives in drumPadLedColor). In Session mode the clip grid
     * owns the pads (painted by seqLedsTick). synthModel/isDrum come
     * from the synth slot regardless of the active chain index, so drum pads
     * light up even on FX parameter pages. */
    const drumNow = !seqState.sessionMode && isDrum;
    if (drumNow) {
        // isDrum was sampled before activeModel.tick() ran. If tick() called
        // loadHierarchy (module just changed), getDrumConfig() returns null even
        // though isDrum is true. Skip this one transition tick — next tick isDrum
        // will be false and the else-if branch cleans up normally.
        const drumCfg = synthModel!.getDrumConfig();
        if (drumCfg) {
            // On entry from a non-drum track, force a full repaint so non-grid pads
            // (col >= 4 → Black) overwrite any stale chromatic colors left behind.
            // On entry from a non-drum view (e.g. Session clip grid → Note), open
            // a repaint window too, so the grid fully overwrites whatever owned the
            // pads. (A track switch already opened one above.)
            if (!appState.drumActive) {
                drumCacheStale = true;
                setButtonLED(MoveUp, Black, true);
                setButtonLED(MoveDown, Black, true);
            }
            // Invalidate once so non-grid pads (col >= 4 → Black) and every grid
            // pad overwrite colours left by the previous layout, which the
            // per-pad cache would otherwise treat as already correct.
            if (drumCacheStale) {
                drumCache.fill(0xFF);
                drumCacheStale = false;
            }
            const track = appState.activeTrack.index;
            const sel   = synthModel!.getDrumCurrentPhysPad();
            for (let i = 0; i <= PAD_MAX - PAD_MIN; i++) {
                const p = PAD_MIN + i;
                // The note this pad plays — the same lookup drumPadLedColor and
                // the engine's pad map use, so "is it sounding" cannot disagree
                // with what a press sends. -1 = not part of the rack.
                const note = drumNoteOfPhys(p, PAD_MIN, drumCfg);
                const playing = note >= 0 && (activeHasNote(track, note) || isSounding(p));
                const color = drumPadLedColor(p, PAD_MIN, drumCfg, sel, track, playing);
                if (drumCache[i] !== color) {
                    if (!ledBudgetTake()) continue;   // cache left stale: retries next tick
                    drumCache[i] = color;
                    setLED(p, color, true);
                }
            }
            appState.drumActive = true;
        }
    } else if (appState.drumActive) {
        appState.drumActive = false;
        appState.initLedsDone = false;
        appState.initLedIndex = 0;
        chromaticCache.fill(0);
        drumCache.fill(0);
        if (!seqState.sessionMode) {
            setButtonLED(MoveUp, WHITE_DIM, true);
            setButtonLED(MoveDown, WHITE_DIM, true);
        }
    }

    /* Per-tick chromatic pad update: green for sequencer-active or physically-
     * held notes, white for lastHeld set or step-hold overlay (holdNotes),
     * normal scale coloring otherwise. Runs outside the dirty-frame guard so
     * the sequencer's active-note LEDs update at poll rate (~24 Hz) without
     * requiring a full UI redraw. Cache diff prevents redundant LED sends. */
    if (!seqState.sessionMode && !isDrum && appState.initLedsDone) {
        const track     = appState.activeTrack.index;
        const map       = padMapFor(track);
        const holdNotes = seqState.holdStep >= 0 && seqState.holdNotes.length > 0
            ? displayHoldNotes() : null;
        for (let i = 0; i <= PAD_MAX - PAD_MIN; i++) {
            const p     = PAD_MIN + i;
            const pitch = map[i];
            const isPlaying = isSounding(p) || (pitch >= 0 && activeHasNote(track, pitch));
            const color = padColor(p, PAD_MIN, track, isPlaying, holdNotes);
            if (chromaticCache[i] !== color) {
                if (!ledBudgetTake()) continue;   // cache left stale: retries next tick
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
    const isBrowseView = appState.currentView === VIEW_BROWSE || appState.currentView === VIEW_FILE_BROWSE;
    // The strip repaints every tick, outside the dirty-frame block, so anything
    // that owns the whole screen has to be excluded here or the strip draws back
    // over it a few milliseconds later.
    if (engineReady() && !seqToastActive() && !jogToastShown && !seqState.sessionMode
        && !isBrowseView && !captureOverlayActive()) {
        /* Loop mode's readout runs on the same per-tick schedule as the strip:
         * both track state that moves without a dirty frame (bar navigation, the
         * sweep). While it is up it supersedes the timed announcement. */
        if (seqState.loopMode) drawLoopHeader();
        drawLoopStrip();
    }
}
