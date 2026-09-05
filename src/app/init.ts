import { createModel }  from '../model/index.js';
import { resetSong } from '../seq/song.js';
import { portFor, componentPort } from '../track/registry.js';
import { TRACK_COUNT } from '../track/ref.js';
import { selectTrack } from '../track/focus.js';
import { resetWatchPush } from '../seq/watch.js';
import { createLfoModel, createScopedLfoModel } from '../lfo/model.js';
import { masterScope } from '../lfo/scope.js';
import { appState, VIEW_CHAIN } from './state.js';
import { buildTrackModels } from './track-models.js';
import { jogHintTouch } from './jog-hint.js';
import { keyboardState, resetOctaves } from '../keyboard/state.js';
import { drainAll } from '../keyboard/held-notes.js';
import { browserState } from '../browser/state.js';
import { CHAIN_SLOTS, MASTER_FX_SLOTS, isLfoSlot, isMasterLfoSlot } from '../chain/config.js';
import { resetTrackMutes } from '../mixer/track-mutes.js';
import { resetDrumSync } from '../seq/drum-sync.js';
import { loadFullVelocityPref } from '../seq/state.js';
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
    /* Movy opens on the track Move had selected. Through `selectTrack`, not a
     * bare assignment: the focus group has to follow (or the four track buttons
     * address a different quartet than the screen), and so does the sequencer —
     * seq/watch.ts derives the engine's watched track from this one. Before
     * that, opening on track 2 left the step row on track 1, so the module you
     * selected and heard was track 2's while step recording wrote into track
     * 1's clip. */
    selectTrack((typeof shadow_get_ui_slot === 'function') ? shadow_get_ui_slot() : 0);
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
    appState.trackModels = Array.from({ length: TRACK_COUNT },
        (_, slot) => buildTrackModels(slot));
    /* `componentPort` and not `portFor(0)`: a `master_fx:` key is global, and the
     * slot it rides on is only a carrier. Track 0 can become a movy chain
     * (`chtracks`), and the chain port would namespace those keys as
     * `ch0:master_fx:…` and send the master chain's edits into a synth. The two
     * SEND slots on this page are movy's own and need a third destination
     * again, which is exactly the choice componentPort exists to make. */
    appState.masterFxModels  = MASTER_FX_SLOTS.map((s, i) => isMasterLfoSlot(i)
        ? createScopedLfoModel(masterScope())
        : createModel(componentPort(0, s.componentKey), s.componentKey));
    appState.masterChainIndex = 0;
    appState.masterDetail     = false;
    appState.trackChainIndex = new Array(TRACK_COUNT).fill(1) as number[];
    appState.trackView       = new Array(TRACK_COUNT).fill(VIEW_CHAIN) as number[];
    appState.currentView     = VIEW_CHAIN;
    appState.shiftHeld    = false;
    resetSong();
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
    /* Full velocity is the opposite: a machine-level preference, so it is read
     * back here rather than reset. Before any pad can be hit — a note that left
     * at the wrong velocity cannot be un-played. */
    loadFullVelocityPref();
    // Nothing is held at open. Today the esbuild bundle is re-evaluated on every
    // tool open so these module-level latches start clear anyway — but that is a
    // property of the host's module cache, not of movy, and "close and reopen"
    // is the user's only cure for a stranded hold. Make the cure explicit.
    resetHeldInput(false);   // engine not booted yet — nothing to notify
    /* Same reasoning for what the engine has been told: a fresh open knows
     * nothing about the DSP it is about to find, which may have been sequencing
     * on its own for hours. Clearing this makes the next tick say it all again
     * rather than trusting a belief carried over from a previous session. */
    resetWatchPush();

    keyboardState.rootPc = 0;
    keyboardState.mode   = 0;
    keyboardState.layout = 0;
    resetOctaves();
    drainAll();   // fresh process: discard, do not emit — nothing sounding is ours yet

    browserState.modules      = [];
    browserState.browseIndex  = 0;
    browserState.componentKey = 'synth';
}
