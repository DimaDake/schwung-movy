import { createModel }  from '../model/index.js';
import { portFor }      from '../track/registry.js';
import { trackRef, TRACK_COUNT } from '../track/ref.js';
import { createLfoModel } from '../lfo/model.js';
import { appState, VIEW_CHAIN } from './state.js';
import { jogHintTouch } from './jog-hint.js';
import { keyboardState } from '../keyboard/state.js';
import { drainAll } from '../keyboard/held-notes.js';
import { browserState } from '../browser/state.js';
import { CHAIN_SLOTS, MASTER_FX_SLOTS, isLfoSlot } from '../chain/config.js';
import { resetTrackMutes } from '../mixer/track-mutes.js';
import { resetDrumSync } from '../seq/drum-sync.js';
import { claimLedOwnership } from './led-ownership.js';
import { resetHeldInput } from './input-reset.js';
import { installEditGuard } from '../undo/record.js';
import { resetUndoState } from '../undo/state.js';
import { resetUndoGroups } from '../undo/group.js';
import { resetUndoToast } from '../undo/toast.js';
import { mlog } from '../log.js';
import { installPerfProbe } from './perf-probe.js';

export function init(): void {
    installPerfProbe();   // wrap the host globals before anything calls them
    appState.activeTrack = trackRef((typeof shadow_get_ui_slot === 'function') ? shadow_get_ui_slot() : 0);
    mlog('init: activeTrack=' + appState.activeTrack.index);

    claimLedOwnership();

    /* Undo history is in-memory and per session: a fresh open starts empty, and
     * the guard that reports un-grouped edits is installed before any input can
     * arrive. */
    installEditGuard();
    resetUndoState();
    resetUndoGroups();
    resetUndoToast();

    /* One entry per track, not per schwung slot. A movy track with no state
     * here left currentView undefined the moment its track button was pressed,
     * which is what made selection look unreliable.
     *
     * Building all 16 costs memory, not time: only the ACTIVE track's model
     * ticks (see app/tick.ts and seq/drum-sync.ts), so idle tracks are inert. */
    appState.trackModels = Array.from({ length: TRACK_COUNT }, (_, slot) =>
        CHAIN_SLOTS.map((s, i) => isLfoSlot(i)
            ? createLfoModel(slot)
            : createModel(portFor(slot), s.componentKey))
    );
    appState.masterFxModels  = MASTER_FX_SLOTS.map(s => createModel(portFor(0), s.componentKey));
    appState.masterChainIndex = 0;
    appState.masterDetail     = false;
    appState.trackChainIndex = new Array(TRACK_COUNT).fill(1) as number[];
    appState.trackView       = new Array(TRACK_COUNT).fill(VIEW_CHAIN) as number[];
    appState.currentView     = VIEW_CHAIN;
    appState.shiftHeld    = false;
    jogHintTouch(false);
    appState.browseOrigin = VIEW_CHAIN;
    appState.dirty           = true;
    appState.initLedIndex    = 0;
    appState.initLedsDone    = false;
    appState.fileBrowserState = null;

    for (const trackSlots of appState.trackModels) {
        for (const m of trackSlots) m.reset();
    }
    for (const m of appState.masterFxModels) m.reset();

    resetDrumSync();   // fresh models: re-tell the engine which tracks are drums
    resetTrackMutes(); // solo is a live control — never persisted, starts clear
    // Nothing is held at open. Today the esbuild bundle is re-evaluated on every
    // tool open so these module-level latches start clear anyway — but that is a
    // property of the host's module cache, not of movy, and "close and reopen"
    // is the user's only cure for a stranded hold. Make the cure explicit.
    resetHeldInput(false);   // engine not booted yet — nothing to notify

    keyboardState.rootPc = 0;
    keyboardState.mode   = 0;
    keyboardState.layout = 0;
    keyboardState.octave = [4, 4, 4, 4];
    drainAll();   // fresh process: discard, do not emit — nothing sounding is ours yet

    browserState.modules      = [];
    browserState.browseIndex  = 0;
    browserState.componentKey = 'synth';
}
