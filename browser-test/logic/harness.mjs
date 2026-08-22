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
import { dedupShortNames } from '../../dist/esm/renderer/shorten.js';
import { detectEnvelopes } from '../../dist/esm/model/envelope.js';
import { planPageLayout } from '../../dist/esm/model/page-layout.js';
import { enumRawToIndex, enumUsesIndex, enumSetValue } from '../../dist/esm/model/enum-value.js';
import { MOCK_SYNTHS }    from '../mock-synth.mjs';
import { drumPadOn, drumPadOff } from '../../dist/esm/keyboard/drum-handler.js';
import { ENGINE_VERSION } from '../../dist/esm/seq/constants.js';
import { NAME_POLL_TICKS, META_RETRY_LIMIT } from '../../dist/esm/model/constants.js';
import {
    readActiveSet, uuidToStatePath, uuidToUiStatePath,
    loadNameIndex, rememberSet, BLANK_STATE,
} from '../../dist/esm/seq/set-context.js';
import {
    stripCopySuffix, findInheritCandidates, resolveState,
} from '../../dist/esm/seq/set-inherit.js';
import { sessionTick, resetSetSession } from '../../dist/esm/seq/set-session.js';
import { wrapState, parseState, adler32 } from '../../dist/esm/seq/persist-blob.js';
import { installMockFs, uninstallMockFs } from '../mock-fs.mjs';
import {
    safeWrite, readBestState, readUiBlob, writeStateBlob, resetStoreRotation,
} from '../../dist/esm/seq/persist-store.js';
import { shadowPath } from '../../dist/esm/seq/set-context.js';
import { keyboardState } from '../../dist/esm/keyboard/state.js';
import {
    quantCandidates, nextQuantCandidate, quantIndexForPct, candidateIndex,
} from '../../dist/esm/seq/quant.js';
import {
    readPrefDefaultQuant, writePrefDefaultQuant, readPrefFileDir, writePrefFileDir,
    PREFS_PATH, FACTORY_DEFAULT_QUANT,
} from '../../dist/esm/seq/prefs.js';
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
    buildTargetOptions, shortenTarget, targetIndex, formatDepth, formatPhase,
    LFO_SHAPES, LFO_DIVISIONS, compLabel,
} from '../../dist/esm/lfo/params.js';
import { createLfoModel } from '../../dist/esm/lfo/model.js';
import { detectLfoViz } from '../../dist/esm/model/lfo-viz.js';
import { buildLfoViz } from '../../dist/esm/model/lfo-vm.js';
import { detectFilterViz } from '../../dist/esm/model/filter-viz.js';
import { buildFilterViz } from '../../dist/esm/model/filter-vm.js';
import { normalizeFilterOption, isFilterModeEnum, filterModeFromEnum, isSlopeEnum, staticModeFromTokens } from '../../dist/esm/model/filter-mode.js';
import { shapeId as lfoShapeId, isShapeEnum } from '../../dist/esm/model/lfo-shapes.js';
import { enumClassOf } from '../../dist/esm/model/enum-class.js';
import { waveCellIndices } from '../../dist/esm/model/wave-viz.js';
import { waveToggleOf } from '../../dist/esm/model/wave-toggle.js';
import { envStageOf } from '../../dist/esm/model/env-stage.js';
import { detectEqViz } from '../../dist/esm/model/eq-viz.js';
import { cutKindOf, detectCutPair } from '../../dist/esm/model/cut-viz.js';
import { drawCutCurve } from '../../dist/esm/renderer/cut-curve.js';
import { detectWavViz } from '../../dist/esm/model/wav-viz.js';
import { wavPeaksTick, wavPeaks, resetWavPeaks, resamplePeaks, PEAK_WIDTH } from '../../dist/esm/model/wav-peaks.js';
import { drawWavForm } from '../../dist/esm/renderer/wav-form.js';
import { drawFilterCurve } from '../../dist/esm/renderer/filter-curve.js';
import { isFaderParam } from '../../dist/esm/model/fader.js';
import { isToggleParam, isActionParam } from '../../dist/esm/model/toggle.js';
import { triggerIndices } from '../../dist/esm/model/trigger.js';
import { renderKnobsView } from '../../dist/esm/renderer/knob-view.js';
import { renderChainView } from '../../dist/esm/renderer/chain-view.js';
import { lfoTargetsParam, assignLfoTarget, clearLfoTarget } from '../../dist/esm/lfo/assign.js';
import { trackScope, masterScope } from '../../dist/esm/lfo/scope.js';
import { holdTouch, holdRelease, holdTurnCancel, holdTick, assignActive, assignCycle, assignCommit, assignToastText, resetAssignMode } from '../../dist/esm/lfo/assign-mode.js';
import { jogHintTouch, jogHintTick, jogHintVisible } from '../../dist/esm/app/jog-hint.js';
import { shapeSample, drawWave } from '../../dist/esm/renderer/lfo-wave.js';
import { CHAIN_SLOTS, LFO_CHAIN_INDEX, isLfoSlot } from '../../dist/esm/chain/config.js';
import { init } from '../../dist/esm/app/init.js';
import { appState } from '../../dist/esm/app/state.js';

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

function ok(label)        { _log(`  \x1b[32m✓\x1b[0m ${label}`); }
function fail(label, why) { _log(`  \x1b[31m✗\x1b[0m ${label}: ${why}`); failures++; }

function eq(label, actual, expected) {
    if (actual === expected) ok(label);
    else fail(label, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function notMatch(label, str, pattern) {
    if (!pattern.test(str)) ok(label);
    else fail(label, `'${str}' should not match ${pattern}`);
}


/* The last MUSICAL op. Undo brackets every edit with ring bookkeeping
 * (usnap/ucommit/udrop/uswap), which is never what a test asserting "the
 * command the gesture emitted" means. */
const UNDO_RING = /^(usnap|uswap|ucommit|udrop|uclr)\b/;
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

function bankNames(m) {
    const n = m.getViewModel().bankCount;
    const names = [];
    for (let i = 0; i < n; i++) { if (i > 0) m.changePage(1); names.push(m.getViewModel().bankName); }
    return names;
}

/* ── shared page-param fixture (envelope / viz suites) ────────────────────── */

const P = (key, label, env) => ({ key, label, shortLabel: null, type: 'float',
    min: 0, max: 1, step: 0.01, options: null, renderStyle: 'arc', automatable: true, env });

/* ── the shared kit: the preamble's imports plus the helpers above ───────── */

export {
    readFileSync, readdirSync, createModel, portFor, trackRef, TRACK_COUNT,
    dedupShortNames, detectEnvelopes, planPageLayout, enumRawToIndex, enumUsesIndex, enumSetValue,
    MOCK_SYNTHS, drumPadOn, drumPadOff, ENGINE_VERSION, NAME_POLL_TICKS, META_RETRY_LIMIT,
    readActiveSet, uuidToStatePath, uuidToUiStatePath, loadNameIndex, rememberSet, BLANK_STATE,
    stripCopySuffix, findInheritCandidates, resolveState, sessionTick, resetSetSession, wrapState,
    parseState, adler32, installMockFs, uninstallMockFs, safeWrite, readBestState,
    readUiBlob, writeStateBlob, resetStoreRotation, shadowPath, keyboardState, quantCandidates,
    nextQuantCandidate, quantIndexForPct, candidateIndex, readPrefDefaultQuant, writePrefDefaultQuant,
    readPrefFileDir, writePrefFileDir, PREFS_PATH,
    FACTORY_DEFAULT_QUANT, armQuantOverlay, quantOverlayActive, quantOverlayTickAt, quantOverlayJog, quantOverlayAction,
    buildQuantOverlayVM, dismissQuantOverlay, resetQuantOverlay, installMockEngine, uninstallMockEngine, pushEntry,
    popUndo, pushRedo, canUndo, canRedo, undoDepth, retractEntry,
    peekUndo, invalidateUndo, takeOrphanedSnaps, resetUndoState, MAX_ENTRIES, beginEdit,
    endEdit, groupOpen, undoTick, onLoopWrap, CLOSE, resetUndoGroups,
    installEditGuard, recordParamOp, seqEdit, seqCtl, seqSideEffect, setUndoStrict,
    takeUndoViolation, resetUndoRecord, isUndoableVerb, isControlVerb, UNDOABLE_VERBS, undoOnce,
    redoOnce, undoWatchContext, resetUndoApply, undoToastVM, noteCount, clipTarget,
    valueChange, seqCmd, takeLabelSync, seqEngineTick, resetSeqEngine, installEnv,
    SHADOW_UI_SLOTS, buildTargetOptions, shortenTarget, targetIndex, formatDepth, formatPhase,
    LFO_SHAPES, LFO_DIVISIONS, compLabel, createLfoModel, detectLfoViz, buildLfoViz,
    detectFilterViz, buildFilterViz, normalizeFilterOption, isFilterModeEnum, filterModeFromEnum, isSlopeEnum,
    staticModeFromTokens, lfoShapeId, isShapeEnum, enumClassOf, waveCellIndices, waveToggleOf,
    envStageOf, detectEqViz, cutKindOf, detectCutPair, drawCutCurve, detectWavViz,
    wavPeaksTick, wavPeaks, resetWavPeaks, resamplePeaks, PEAK_WIDTH, drawWavForm,
    drawFilterCurve, isFaderParam, isToggleParam, isActionParam, triggerIndices, renderKnobsView,
    renderChainView, lfoTargetsParam, assignLfoTarget, clearLfoTarget, trackScope, masterScope,
    holdTouch, holdRelease, holdTurnCancel, holdTick, assignActive, assignCycle,
    assignCommit, assignToastText, resetAssignMode, jogHintTouch, jogHintTick, jogHintVisible,
    shapeSample, drawWave, CHAIN_SLOTS, LFO_CHAIN_INDEX, isLfoSlot, init,
    appState, ok, fail, eq, notMatch, bootModel,
    bankNames, P, lastMusicalOp, musicalOps, UNDO_RING, _log,
    env, mockFsEntries, failureCount,
};
