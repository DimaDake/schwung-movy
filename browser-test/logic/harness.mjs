/* browser-test/logic/harness.mjs — shared kit for the logic suites.
 *
 * Owns the mock globals, the assertion helpers and the single failure
 * counter that every logic/*.mjs module reports into. Imported first by
 * logic.mjs so the dist/esm modules evaluate before installEnv() runs,
 * exactly as they did when this was one file.
 *
 * Every suite module imports what it needs from here — the preamble is
 * re-exported wholesale so no dist/esm path is spelled out twice.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { createModel }    from '../../dist/esm/model/index.js';
import { portFor }        from '../../dist/esm/track/registry.js';
import { trackRef, TRACK_COUNT } from '../../dist/esm/track/ref.js';
import { enumUsesIndex } from '../../dist/esm/model/enum-value.js';
import { MOCK_SYNTHS }    from '../mock-synth.mjs';
import { drumPadOn, drumPadOff } from '../../dist/esm/keyboard/drum-handler.js';
import { ENGINE_VERSION } from '../../dist/esm/seq/constants.js';
import { NAME_POLL_TICKS, META_RETRY_LIMIT, KNOBS_PER_PAGE, HIERARCHY_RETRY_TICKS } from '../../dist/esm/model/constants.js';
import { OVERRIDES_MODULE_FILE } from '../../dist/esm/modules/loader.js';
import {
    uuidToStatePath, uuidToUiStatePath,
} from '../../dist/esm/seq/set-context.js';
import { sessionTick, resetSetSession } from '../../dist/esm/seq/set-session.js';
import { wrapState, parseState, adler32 } from '../../dist/esm/seq/persist-blob.js';
import { installMockFs, uninstallMockFs } from '../mock-fs.mjs';
import {
    safeWrite, readUiBlob,
} from '../../dist/esm/seq/persist-store.js';
import { keyboardState } from '../../dist/esm/keyboard/state.js';
import {
    quantCandidates, nextQuantCandidate, quantIndexForPct, candidateIndex,
} from '../../dist/esm/seq/quant.js';
import {
    readPrefDefaultQuant, writePrefDefaultQuant, readPrefFileDir, writePrefFileDir,
    PREFS_PATH, FACTORY_DEFAULT_QUANT,
} from '../../dist/esm/seq/prefs.js';
import {
    flagsPageState, flagsPageActive, flagsPageJog, resetFlagsPage,
    flagsRowCount, backupsRowSelected, clickRowSelected, migrateRowSelected, actionRowSelected,
} from '../../dist/esm/seq/flags-page.js';
import { buildFlagsPageVM } from '../../dist/esm/seq/flags-page-vm.js';
import { schwungPageFor,
         schwungGridReload, schwungGridDrop } from '../../dist/esm/renderer/schwung-grid.js';
import {
    batchKeys, fill, KEEP_EPOCHS, BATCH_MAX_KEYS, BATCH_VALUE_MAX,
} from '../../dist/esm/renderer/schwung-page-batch.js';
import { resetPorts } from '../../dist/esm/track/registry.js';
import { serializeUiState, applyUiState, resetUiState } from '../../dist/esm/seq/ui-state.js';
import { VISIBLE_ROWS, firstVisibleRow, HINT_W, HINT_LINES } from '../../dist/esm/renderer/flags-view.js';
import { wrapWords } from '../../dist/esm/renderer/wrap.js';
import { fontWidth } from '../../dist/esm/font/index.js';
import { W } from '../../dist/esm/renderer/layout.js';
import { DETENT_DIV } from '../../dist/esm/seq/detent.js';
import { readPrefModuleBlacklist, readPrefClickDb } from '../../dist/esm/seq/prefs.js';
import { clickVolumeTurn, clickVolumeLabel, resetClickVolume } from '../../dist/esm/seq/click-volume.js';
import { openParamPage, closeParamPage, paramPageActive } from '../../dist/esm/seq/param-page.js';
import { VIEW_FLAGS, VIEW_CHAIN, VIEW_MAIN_PARAMS } from '../../dist/esm/app/state.js';
import {
    armQuantOverlay, quantOverlayActive, quantOverlayTickAt, quantOverlayJog,
    quantOverlayAction, buildQuantOverlayVM, dismissQuantOverlay, resetQuantOverlay,
} from '../../dist/esm/seq/quant-overlay.js';
import { installMockEngine, uninstallMockEngine } from '../mock-engine.mjs';
import {
    pushEntry, popUndo, pushRedo, canUndo, canRedo, undoDepth, retractEntry, peekUndo,
    invalidateUndo, takeOrphanedSnaps, resetUndoState, MAX_ENTRIES,
} from '../../dist/esm/undo/state.js';
import {
    beginEdit, endEdit, groupOpen, undoTick, onLoopWrap, CLOSE, resetUndoGroups,
} from '../../dist/esm/undo/group.js';
import {
    installEditGuard, recordParamOp, seqEdit, seqCtl, seqSideEffect, setUndoStrict,
    takeUndoViolation, resetUndoRecord,
} from '../../dist/esm/undo/record.js';
import {
    isUndoableVerb, isControlVerb, UNDOABLE_VERBS,
} from '../../dist/esm/undo/verbs.js';
import {
    undoOnce, redoOnce, undoWatchContext, resetUndoApply,
} from '../../dist/esm/undo/apply.js';
import {
    undoToastVM, noteCount, clipTarget, valueChange,
} from '../../dist/esm/undo/label.js';
import { seqCmd, takeLabelSync, seqEngineTick, resetSeqEngine } from '../../dist/esm/seq/engine.js';
import { installEnv, SHADOW_UI_SLOTS } from '../env.mjs';
import {
    buildTargetOptions, shortenTarget, targetIndex, LFO_SHAPES, LFO_DIVISIONS, compLabel,
} from '../../dist/esm/lfo/params.js';
import { createLfoModel } from '../../dist/esm/lfo/model.js';
import { isToggleParam, isActionParam } from '../../dist/esm/model/toggle.js';
import { renderKnobsView } from '../../dist/esm/renderer/knob-view.js';
import { renderChainView } from '../../dist/esm/renderer/chain-view.js';
import { lfoTargetsParam, assignLfoTarget, clearLfoTarget } from '../../dist/esm/lfo/assign.js';
import { trackScope, masterScope } from '../../dist/esm/lfo/scope.js';
import { holdTouch, holdRelease, holdTurnCancel, holdTick, assignActive, assignCycle, assignCommit, assignToastText, resetAssignMode } from '../../dist/esm/lfo/assign-mode.js';
import { jogHintTouch, jogHintTick, jogHintVisible } from '../../dist/esm/app/jog-hint.js';
import { CHAIN_SLOTS, LFO_CHAIN_INDEX, isLfoSlot } from '../../dist/esm/chain/config.js';
import { init } from '../../dist/esm/app/init.js';
import { appState } from '../../dist/esm/app/state.js';
import { perfPhase, perfPhaseEnd, perfProbeTick } from '../../dist/esm/app/perf-probe.js';
import { buildCpuPageVM, buildSendColumns, USABLE_BLOCK } from '../../dist/esm/seq/cpu-page-vm.js';
import { FULL_SCALE_US, scaleFor, scaleLabel } from '../../dist/esm/seq/cpu-scale.js';
/* The sequencer's track is the SELECTED track — a suite that wants the step row
 * on track N selects track N, the way a user does. There is no separate field
 * to set: seq/watch.ts derives the engine's watch from this one. */
import { selectTrack } from '../../dist/esm/track/focus.js';
import { watchedTrack } from '../../dist/esm/seq/watch.js';

/* ── Mock globals ─────────────────────────────────────────────────────────── */

const env = installEnv();

const mockFsEntries = {};  // path → string[] of filenames

globalThis.os = {
    readdir: (path) => [mockFsEntries[path] ?? [], 0],
    stat:    (path) => {
        // treat paths without an extension as directories
        const mode = path.lastIndexOf('.') > path.lastIndexOf('/') ? 0x8000 : 0x4000;
        return [{ mode }, 0];
    },
};

const _log = console.log.bind(console);
console.log = (...args) => {
    if (typeof args[0] === 'string' && args[0].startsWith('[movy]')) return;
    _log(...args);
};

let failures = 0;
function failureCount() { return failures; }

/* `ok(label)` passes unconditionally — that is how `eq` reports a pass. With a
 * second argument it is an ASSERTION, and a falsy one fails.
 *
 * It used to take the label alone and ignore everything else, so ~50
 * `ok(label, condition)` calls across these suites printed a green tick without
 * ever evaluating the condition. Found by mutating a value the check was
 * supposed to catch and watching the suite stay green. */
function ok(label, cond = true, why = '') {
    if (cond) _log(`  \x1b[32m✓\x1b[0m ${label}`);
    else fail(label, why || 'expected a truthy value');
}
function fail(label, why) { _log(`  \x1b[31m✗\x1b[0m ${label}: ${why}`); failures++; }

function eq(label, actual, expected) {
    if (actual === expected) ok(label);
    else fail(label, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function notMatch(label, str, pattern) {
    if (!pattern.test(str)) ok(label);
    else fail(label, `'${str}' should not match ${pattern}`);
}

/* Count ROUND TRIPS, not params.
 *
 * SP-26 is the difference between the two: `shadow_get_params` reads a whole
 * page in ONE blocking IPC where `shadow_get_param` reads one key in one, and
 * on device each of those is ~3.4 ms whatever it carries. A counter on the
 * single-key call alone therefore cannot see the thing a read-cost budget is
 * about — it counted 80 before SP-26 and 125 after, while the real cost went
 * the other way. The bulk call's own per-key delegation is suppressed for the
 * same reason: inside one request it is one trip.
 *
 * The two are counted SEPARATELY as well as together, because they are priced
 * separately on device (~2.3 ms for one key, the same for a whole page) and a
 * caller asking "did this gesture cost a page of reads" is asking about the
 * singles: SP-39's warm turns eight of them into one bulk, and the total alone
 * would hide which of the two it did. */
function countTripKinds(fn) {
    /* Suites before this one delete the param globals rather than restoring
     * them (SP-02's deferred list), so wrapping whatever is there would wrap
     * `undefined`. The env's own restorer is what that cleanup meant. */
    env.restoreParamGlobals();
    const realGet = globalThis.shadow_get_param;
    const realBulk = globalThis.shadow_get_params;
    let bulk = 0, single = 0, depth = 0;
    globalThis.shadow_get_params = (...a) => {
        bulk++; depth++;
        try { return realBulk(...a); } finally { depth--; }
    };
    globalThis.shadow_get_param = (...a) => { if (!depth) single++; return realGet(...a); };
    try { fn(); } finally {
        globalThis.shadow_get_param = realGet;
        globalThis.shadow_get_params = realBulk;
    }
    return { trips: bulk + single, bulk, single };
}

function countTrips(fn) { return countTripKinds(fn).trips; }

/* The last MUSICAL op. Undo brackets every edit with ring bookkeeping
 * (usnap/ucommit/udrop/uswap), which is never what a test asserting "the
 * command the gesture emitted" means — and neither is the view subscription
 * (`watch`/`wlane`) the engine tick reconciles at the end of every batch. Both
 * are bookkeeping on the engine's side too: seq-core/src/command.rs classifies
 * them as non-musical, so this list agrees with the engine's own. */
const UNDO_RING = /^(usnap|uswap|ucommit|udrop|uclr|watch|wlane)\b/;
function lastMusicalOp(ops) {
    for (let i = ops.length - 1; i >= 0; i--) if (!UNDO_RING.test(ops[i])) return ops[i];
    return undefined;
}
function musicalOps(ops) { return ops.filter((o) => !UNDO_RING.test(o)); }

function bootModel(preset, slot = 0, componentKey = 'synth') {
    env.setParams(preset);
    const m = createModel(portFor(slot), componentKey);
    m.reload();  // sets pollCountdown=1 so pollModuleName fires on next tick
    m.tick();    // tick 1: polls name, resets hierarchyKey
    m.tick();    // tick 2: reloads hierarchy with the real module name
    return m;
}

/* Tick a model far enough for its knob VALUES to arrive.
 *
 * A track is a movy chain now, and a chain port reads in BULK on a countdown
 * (REFRESH_BULK_TICKS) rather than one param per tick — two ticks were enough
 * only while a track was a shadow slot read per tick. Not folded into
 * `bootModel`: several suites assert on what is known EARLY, and handing them
 * a fully converged model changes what they are testing. */
function settleModel(m, ticks = 12) {
    for (let i = 0; i < ticks; i++) m.tick();
    return m;
}

function bankNames(m) { return m.dumpLayout().banks.map((b) => b.name); }

/* ── shared page-param fixture (envelope / viz suites) ────────────────────── */

const P = (key, label, env) => ({ key, label, shortLabel: null, type: 'float',
    min: 0, max: 1, step: 0.01, options: null, renderStyle: 'arc', automatable: true, env });

/* A Set's state file as the engine leaves it — the fixture for any test that
 * needs a Set on disk. The UI never writes this file itself. */
function seedStateFile(uuid, payload, gen) {
    globalThis.host_write_file(uuidToStatePath(uuid), wrapState(payload, gen));
}

/* ── the shared kit: the preamble's imports plus the helpers above ───────── */

export {
    readFileSync, readdirSync, createModel, portFor, trackRef, TRACK_COUNT,
    enumUsesIndex, MOCK_SYNTHS, drumPadOn, drumPadOff, ENGINE_VERSION, NAME_POLL_TICKS, META_RETRY_LIMIT, HIERARCHY_RETRY_TICKS,
    KNOBS_PER_PAGE, OVERRIDES_MODULE_FILE,
    uuidToStatePath, uuidToUiStatePath, sessionTick, resetSetSession, wrapState,
    parseState, adler32, installMockFs, uninstallMockFs, safeWrite,
    readUiBlob, seedStateFile, keyboardState, quantCandidates,
    nextQuantCandidate, quantIndexForPct, candidateIndex, readPrefDefaultQuant, writePrefDefaultQuant,
    readPrefFileDir, writePrefFileDir, PREFS_PATH,
    schwungPageFor, schwungGridReload, schwungGridDrop,
    batchKeys, fill, KEEP_EPOCHS, BATCH_MAX_KEYS, BATCH_VALUE_MAX,
    flagsPageState, flagsRowCount, backupsRowSelected, clickRowSelected, migrateRowSelected, actionRowSelected, flagsPageActive, flagsPageJog, resetFlagsPage,
    buildFlagsPageVM, VISIBLE_ROWS, firstVisibleRow, resetPorts,
    wrapWords, HINT_W, HINT_LINES, DETENT_DIV, fontWidth, W,
    serializeUiState, applyUiState, resetUiState,
    readPrefModuleBlacklist, readPrefClickDb, clickVolumeTurn, clickVolumeLabel, resetClickVolume,
    buildCpuPageVM, buildSendColumns, FULL_SCALE_US, USABLE_BLOCK, scaleFor, scaleLabel,
    openParamPage, closeParamPage, paramPageActive,
    perfPhase, perfPhaseEnd, perfProbeTick,
    VIEW_FLAGS, VIEW_CHAIN, VIEW_MAIN_PARAMS,
    FACTORY_DEFAULT_QUANT, armQuantOverlay, quantOverlayActive, quantOverlayTickAt, quantOverlayJog, quantOverlayAction,
    buildQuantOverlayVM, dismissQuantOverlay, resetQuantOverlay, installMockEngine, uninstallMockEngine, pushEntry,
    popUndo, pushRedo, canUndo, canRedo, undoDepth, retractEntry,
    peekUndo, invalidateUndo, takeOrphanedSnaps, resetUndoState, MAX_ENTRIES, beginEdit,
    endEdit, groupOpen, undoTick, onLoopWrap, CLOSE, resetUndoGroups,
    installEditGuard, recordParamOp, seqEdit, seqCtl, seqSideEffect, setUndoStrict,
    takeUndoViolation, resetUndoRecord, isUndoableVerb, isControlVerb, UNDOABLE_VERBS, undoOnce,
    redoOnce, undoWatchContext, resetUndoApply, undoToastVM, noteCount, clipTarget,
    valueChange, seqCmd, takeLabelSync, seqEngineTick, resetSeqEngine, installEnv,
    SHADOW_UI_SLOTS, buildTargetOptions, shortenTarget, targetIndex, LFO_SHAPES, LFO_DIVISIONS, compLabel, createLfoModel, isToggleParam, isActionParam, renderKnobsView,
    renderChainView, lfoTargetsParam, assignLfoTarget, clearLfoTarget, trackScope, masterScope,
    holdTouch, holdRelease, holdTurnCancel, holdTick, assignActive, assignCycle,
    assignCommit, assignToastText, resetAssignMode, jogHintTouch, jogHintTick, jogHintVisible,
    CHAIN_SLOTS, LFO_CHAIN_INDEX, isLfoSlot, init,
    appState, selectTrack, watchedTrack, countTrips, countTripKinds, ok, fail, eq, notMatch, bootModel, settleModel,
    bankNames, P, lastMusicalOp, musicalOps, UNDO_RING, _log,
    env, mockFsEntries, failureCount,
};
