/* browser-test/logic/automation.mjs — automation lanes: registry, warm, knob routing, gestures, validation, labels
 *
 * Run by browser-test/logic.mjs. The suite body is deliberately left at its
 * original indentation inside run() so blame survives the split.
 */

import {
    takeLabelSync, resetSeqEngine, eq, _log,
} from './harness.mjs';

export async function run() {
/* ── automation: registry + lane assignment ──────────────────────────────── */
_log('\nautomation registry:');
{
    const {
        resetAutomation, laneForParam, assignLane, norm7, denorm7,
    } = await import('../../dist/esm/seq/automation.js');
    const { resetSeqEngine, peekSeqCmdQueue } = await import('../../dist/esm/seq/engine.js');
    resetAutomation(); resetSeqEngine();
    eq('norm7 mid → 64', norm7(1, 0, 2), 64);
    eq('denorm7 max → 2', denorm7(127, 0, 2), 2);

    const info = { gi: 0, key: 'cutoff', ioKey: 'cutoff', target: 'synth', value: 1, min: 0, max: 2, type: 'float', automatable: true };
    const lane = assignLane(0, 0, info, () => true);
    eq('first lane assigned', lane, 0);
    eq('lane lookup by target:param', laneForParam(0, 'synth:cutoff'), 0);
    // alabel + abase queued for the engine.
    const q = peekSeqCmdQueue().join('|');
    eq('alabel queued', q.includes('alabel 0 0 synth:cutoff'), true);
    eq('abase queued', q.includes('abase 0 0 64'), true);
    // Re-assigning the same param returns the same lane.
    eq('same param → same lane', assignLane(0, 0, info, () => true), 0);
    // Pool of AUTO_LANES (D13): filling all returns -1.
    const { AUTO_LANES } = await import('../../dist/esm/seq/constants.js');
    for (let i = 1; i < AUTO_LANES; i++) assignLane(0, 0, { ...info, key: 'k' + i, ioKey: 'k' + i }, () => true);
    eq('the 32nd lane is assigned', laneForParam(0, 'synth:k' + (AUTO_LANES - 1)), AUTO_LANES - 1);
    eq('pool full → -1', assignLane(0, 0, { ...info, key: 'kx', ioKey: 'kx' }, () => true), -1);
}

/* ── automation: pool-full derives from the live lane count ───────────────── */
/* (Not the old sticky autoPoolFull flag, which lagged a step behind reaching 8
 * and never reset when lanes were freed → params stayed hidden forever.) */
_log('\nautomation pool-full (lane count):');
{
    const { resetAutomation, assignLane, clearLane, poolIsFull } = await import('../../dist/esm/seq/automation.js');
    const { resetSeqEngine } = await import('../../dist/esm/seq/engine.js');
    resetAutomation(); resetSeqEngine();
    const mk = (k) => ({ gi: 0, key: k, ioKey: k, target: 'synth', value: 1, min: 0, max: 2, type: 'float', automatable: true });
    const { AUTO_LANES } = await import('../../dist/esm/seq/constants.js');
    eq('empty pool not full', poolIsFull(0), false);
    for (let i = 0; i < AUTO_LANES - 1; i++) assignLane(0, 0, mk('k' + i), () => true);
    eq('one short of the pool is not full', poolIsFull(0), false);
    assignLane(0, 0, mk('klast'), () => true);          // last → full immediately
    eq('a full pool reads full', poolIsFull(0), true);
    clearLane(0, 3);                                   // freeing a lane → not full
    eq('after freeing one → not full', poolIsFull(0), false);
    const { seqToastText } = await import('../../dist/esm/seq/render.js');
    eq('a user lane clear says so', seqToastText(), 'k3 lane cleared');
}

/* ── automation: knob-turn routing (hold-step / Rec / base) ──────────────── */
/* ── automation: enum + boolean lanes are stepped (D14) ─────────────────── */
/* The engine plays a stepped lane as option = ⌊v·n/128⌋ (auto_lane.rs); the UI
 * stores an option at its bin's centre, so what a lock draws is what it plays,
 * and a held-step detent moves one option, not one 128th. */
_log('\nautomation enum/boolean lanes (D14):');
{
    const { stepCount, binCentre, binOf, toLane7, fromLane7, stepLane7 } =
        await import('../../dist/esm/seq/lane-value.js');
    const enumOf = (n) => ({ type: 'enum', min: 0, max: n - 1, options: Array.from({ length: n }, (_, i) => 'o' + i) });

    let roundTrip = true, binsOk = true;
    for (let n = 2; n <= 64; n++) {
        for (let i = 0; i < n; i++) {
            if (fromLane7(toLane7(i, enumOf(n)), enumOf(n)) !== i) roundTrip = false;
            if (binOf(binCentre(i, n), n) !== i) binsOk = false;
        }
    }
    eq('every option of every enum (2..64) survives the 7-bit round trip', roundTrip, true);
    eq('every bin centre plays its own option', binsOk, true);
    /* The engine's rule, restated as numbers so a drift on either side shows. */
    eq('2 options: 0-63 → 0, 64-127 → 1', [binOf(63, 2), binOf(64, 2)].join(','), '0,1');
    eq('3 options split at 43 and 86', [binOf(42, 3), binOf(43, 3), binOf(85, 3), binOf(86, 3)].join(','), '0,1,1,2');

    eq('a boolean is an int over 0..1 and steps in two', stepCount({ type: 'int', min: 0, max: 1 }), 2);
    eq('any other int stays linear', stepCount({ type: 'int', min: 0, max: 4 }), 0);
    eq('a float stays linear', stepCount({ type: 'float', min: 0, max: 1 }), 0);
    eq('a linear lane still round-trips as before', toLane7(1, { type: 'float', min: 0, max: 2 }), 64);
    eq('an enum with no option list counts its range', stepCount({ type: 'enum', min: 0, max: 3 }), 4);

    const e3 = enumOf(3);
    eq('one detent up moves one option', fromLane7(stepLane7(toLane7(0, e3), 1, e3), e3), 1);
    eq('two detents down from the top', fromLane7(stepLane7(toLane7(2, e3), -2, e3), e3), 0);
    eq('past the last option it holds', fromLane7(stepLane7(toLane7(2, e3), 5, e3), e3), 2);
    const sw = { type: 'int', min: 0, max: 1 };
    eq('a switch flips on ONE detent (was 64)', fromLane7(stepLane7(toLane7(0, sw), 1, sw), sw), 1);

    // Through the real held-step path: the lock written is the option's centre.
    const { resetAutomation, handleAutomationKnob, automationRegistry } = await import('../../dist/esm/seq/automation.js');
    const { resetSeqEngine, peekSeqCmdQueue } = await import('../../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');
    const wave = { gi: 0, key: 'wave', ioKey: 'wave', target: 'synth', value: 1, min: 0, max: 2,
                   type: 'enum', options: ['Saw', 'Square', 'Tri'], wiresNames: true, automatable: true };
    resetAutomation(); resetSeqEngine(); resetSeqState();
    seqState.stepAutoMode = true; seqState.holdStep = 4;
    const binds = [];
    handleAutomationKnob(0, 0, wave, +1, (lane) => { binds.push(lane); return true; });
    const q = peekSeqCmdQueue();
    eq('the base is the current option\'s centre', q.includes('abase 0 0 64'), true);
    eq('one detent locks the NEXT option (Tri), quietly', q.includes('aset 0 0 4 106 1'), true);
    eq('the lane keeps the options and the wire form for its bind',
       JSON.stringify(automationRegistry()[0][0] && [automationRegistry()[0][0].options, automationRegistry()[0][0].wiresNames]),
       JSON.stringify([['Saw', 'Square', 'Tri'], true]));
    resetSeqState(); resetAutomation(); resetSeqEngine();
}

_log('\nautomation knob routing:');
{
    const { resetAutomation, handleAutomationKnob, automationKnobReleased, liveTurnValues } = await import('../../dist/esm/seq/automation.js');
    const { resetSeqEngine, peekSeqCmdQueue } = await import('../../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');
    const info = { gi: 0, key: 'cutoff', ioKey: 'cutoff', target: 'synth', value: 1, min: 0, max: 2, type: 'float', automatable: true };

    // Step-automation mode: knob turn writes a lock at the held step.
    resetAutomation(); resetSeqEngine(); resetSeqState();
    seqState.stepAutoMode = true; seqState.holdStep = 4;
    eq('step-auto knob consumed', handleAutomationKnob(0, 0, info, +1, () => true), true);
    eq('aset at held step 4', peekSeqCmdQueue().some((o) => o.startsWith('aset 0 0 4 ')), true);
    /* A held-step edit is not a performance: the lock is stored QUIET (trailing
     * 1) so the live parameter does not move until the step itself plays. */
    eq('held-step lock is quiet', peekSeqCmdQueue().some((o) => /^aset 0 0 4 \d+ 1$/.test(o)), true);
    resetAutomation(); resetSeqEngine(); resetSeqState();
    seqState.recording = seqState.playing = true; seqState.curStep = 7;
    handleAutomationKnob(0, 0, info, +1, () => true);
    eq('live-record lock auditions (no quiet flag)',
       peekSeqCmdQueue().some((o) => /^aset 0 0 7 \d+$/.test(o)), true);

    // SP-35: a cell that cannot take a lock says so — the <STEP_AUTO_MS window
    // before `stepAutoTick` promotes is the same assign attempt, not a second one.
    const { editStepDown, resetStepEdit } = await import('../../dist/esm/seq/step-edit.js');
    const { seqToastText } = await import('../../dist/esm/seq/render.js');
    const file = { ...info, ioKey: 'sample', automatable: false };
    resetAutomation(); resetSeqEngine(); resetSeqState(); resetStepEdit();
    editStepDown(0);                        // held; NOT yet promoted
    eq('non-automatable held-but-unpromoted IS consumed', handleAutomationKnob(0, 0, file, +1, () => true), true);
    seqState.recording = seqState.playing = true;
    eq('...but live record is a take, not an assign', handleAutomationKnob(0, 0, file, +1, () => true), false);
    resetStepEdit(); resetAutomation(); resetSeqEngine(); resetSeqState();
    seqState.stepAutoMode = true; seqState.holdStep = 4;
    eq('non-automatable under a held step IS consumed', handleAutomationKnob(0, 0, file, +1, () => true), true);
    eq('...and says why', seqToastText(), 'NO LOCK: sample');
    eq('...and writes no lock for it', peekSeqCmdQueue().some((o) => o.startsWith('aset')), false);

    resetAutomation(); resetSeqEngine(); resetSeqState();   // no step held (unchanged)
    eq('non-automatable with no step held is not consumed', handleAutomationKnob(0, 0, file, +1, () => true), false);

    // Normal mode (no step-auto, no Rec): not consumed → normal param path edits
    // the base immediately (no lag).
    resetAutomation(); resetSeqEngine(); resetSeqState();
    eq('normal-mode knob not consumed (even if a lane)',
        handleAutomationKnob(0, 0, info, +1, () => true), false);

    // Rec-armed + playing → lock at the current playing step.
    resetAutomation(); resetSeqEngine(); resetSeqState();
    seqState.recording = true; seqState.playing = true; seqState.curStep = 7;
    eq('rec knob consumed', handleAutomationKnob(0, 0, info, +1, () => true), true);
    eq('aset at playing step 7', peekSeqCmdQueue().some((o) => o.startsWith('aset 0 0 7 ')), true);
    resetSeqState();

    // Live-recorded automation latches: releasing the knob does NOT revert the
    // param to base — the recorded lock holds until its end trigger.
    resetAutomation(); resetSeqEngine(); resetSeqState();
    seqState.recording = true; seqState.playing = true; seqState.curStep = 7;
    handleAutomationKnob(0, 0, info, +1, () => true);   // assigns lane 0, records lock
    const beforeLen = peekSeqCmdQueue().length;
    automationKnobReleased(0, 0, info);
    const afterRelease = peekSeqCmdQueue().slice(beforeLen);
    eq('recorded-lane release issues no abase revert',
        afterRelease.some((o) => o.startsWith('abase 0 0')), false);
    resetSeqState();

    // Live take: the on-screen knob follows the turn (a live value exists for the
    // lane), then snaps back to base on release (the live value is cleared).
    resetAutomation(); resetSeqEngine(); resetSeqState();
    seqState.recording = true; seqState.playing = true; seqState.curStep = 3;
    handleAutomationKnob(0, 0, info, +5, () => true);
    eq('live take exposes a live knob value while turning', liveTurnValues(0).has(0), true);
    automationKnobReleased(0, 0, info);
    eq('release clears the live knob value (knob snaps to base)', liveTurnValues(0).has(0), false);
    resetSeqState();

    // A live take must ACCUMULATE across playback steps. The status poll clears
    // heldLocks each tick (no step held), and the playhead advances every step;
    // if the live seed came from heldLocks / a per-step context it would reset to
    // base on every turn (the "feedback loop back to the original position" bug).
    resetAutomation(); resetSeqEngine(); resetSeqState();
    seqState.recording = true; seqState.playing = true;
    seqState.curStep = 2;
    handleAutomationKnob(0, 0, info, +5, () => true);
    const v1 = liveTurnValues(0).get(0);
    seqState.heldLocks.clear();            // simulate the ~24Hz hauto poll wiping it
    seqState.curStep = 3;                  // playhead advanced to the next step
    handleAutomationKnob(0, 0, info, +5, () => true);
    const v2 = liveTurnValues(0).get(0);
    eq('live take accumulates across steps (not reset to base)', v2 > v1, true);
    eq('live take accumulated by both deltas', v2 - v1, 5);
    resetSeqState();

    // Step-automation does NOT leak a live value (held path drives the knob via
    // heldLocks instead, so the knob doesn't snap back while the step is held).
    resetAutomation(); resetSeqEngine(); resetSeqState();
    seqState.stepAutoMode = true; seqState.holdStep = 4;
    handleAutomationKnob(0, 0, info, +1, () => true);
    eq('step-auto turn does not set a live value', liveTurnValues(0).has(0), false);
    resetSeqState();
}

/* ── Clear + automation-knob clear must not delete the clip ──────────────── */
_log('\nclear + automation knob:');
{
    const { deleteButton, markDeleteActed, resetEditOps } =
        await import('../../dist/esm/seq/edit-ops.js');
    const { resetSeqEngine, peekSeqCmdQueue } = await import('../../dist/esm/seq/engine.js');
    resetEditOps(); resetSeqEngine();
    deleteButton(true);            // hold Clear
    markDeleteActed();             // automation-knob clear acted
    deleteButton(false);           // release Clear
    eq('clear+automation-knob does not delete clip',
        peekSeqCmdQueue().some((o) => o.startsWith('clipdel')), false);
}

/* ── toast shows a flat ~1s regardless of requested ttl ─────────────────── */
_log('\ntoast duration:');
{
    const { seqToast, seqToastActive, seqToastTick, resetSeqToast } =
        await import('../../dist/esm/seq/render.js');
    resetSeqToast();
    seqToast('hi', 10);            // request a short ttl (ignored)
    let ticks = 0;
    while (seqToastActive()) { seqToastTick(); ticks++; if (ticks > 1000) break; }
    // ~1s at the device's ~196 ticks/s; flat regardless of the requested ttl.
    eq('toast shows ~1s (180–210 ticks) regardless of requested ttl', ticks >= 180 && ticks <= 210, true);
}

/* ── duplicate gesture (Copy held → source → dest, replace) ──────────────── */
_log('\nduplicate gesture:');
{
    const { copyButton, onUnit, dupActive, resetDuplicate } =
        await import('../../dist/esm/seq/duplicate.js');
    const { resetSeqEngine, peekSeqCmdQueue } = await import('../../dist/esm/seq/engine.js');

    // Clip: copy source slot, paste-replace at dest (cross-track), source stays armed.
    resetDuplicate(); resetSeqEngine();
    copyButton(true);
    eq('dup active while held', dupActive(), true);
    onUnit({ kind: 'clip', track: 0, slot: 0 });
    onUnit({ kind: 'clip', track: 1, slot: 3 });
    onUnit({ kind: 'clip', track: 2, slot: 5 }); // second dest — source still armed
    const q = peekSeqCmdQueue();
    eq('clip copy emitted', q.includes('clipcopy 0 0'), true);
    eq('clip paste 1', q.includes('clippaste 1 3'), true);
    eq('clip paste 2 (armed)', q.includes('clippaste 2 5'), true);
    copyButton(false);
    eq('dup inactive after release', dupActive(), false);

    // Step: cpy single step, pst at dest.
    resetDuplicate(); resetSeqEngine();
    copyButton(true);
    onUnit({ kind: 'step', track: 0, step: 2 });
    onUnit({ kind: 'step', track: 0, step: 9 });
    const qs = peekSeqCmdQueue();
    eq('step copy', qs.includes('cpy 0 2 2'), true);
    eq('step paste', qs.includes('pst 0 9'), true);
    copyButton(false);

    // Bar: cpy the 16-step bar range, pst at dest bar start.
    resetDuplicate(); resetSeqEngine();
    copyButton(true);
    onUnit({ kind: 'bar', track: 0, bar: 0 });
    onUnit({ kind: 'bar', track: 0, bar: 2 });
    const qb = peekSeqCmdQueue();
    eq('bar copy', qb.includes('cpy 0 0 15'), true);
    eq('bar paste', qb.includes('pst 0 32'), true);
    copyButton(false);

    // No source captured yet → a press is the source, not a paste.
    resetDuplicate(); resetSeqEngine();
    copyButton(true);
    onUnit({ kind: 'clip', track: 0, slot: 1 });
    eq('first press is copy not paste',
        peekSeqCmdQueue().some((o) => o.startsWith('clippaste')), false);
    copyButton(false);

    // onUnit ignored when not held.
    resetDuplicate(); resetSeqEngine();
    onUnit({ kind: 'clip', track: 0, slot: 0 });
    eq('onUnit no-op when not held', peekSeqCmdQueue().length, 0);
}

/* ── automation: hold+knob gesture enters step-auto, release is not a tap ─── */
_log('\nautomation gesture (tap vs hold):');
{
    const { resetAutomation, handleAutomationKnob } = await import('../../dist/esm/seq/automation.js');
    const { editStepDown, editStepUp, endStepAutomation, resetStepEdit } =
        await import('../../dist/esm/seq/step-edit.js');
    const { resetSeqEngine, peekSeqCmdQueue } = await import('../../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');
    const info = { gi: 0, key: 'cutoff', ioKey: 'cutoff', target: 'synth', value: 1, min: 0, max: 2, type: 'float', automatable: true };

    resetAutomation(); resetSeqEngine(); resetSeqState(); resetStepEdit();
    editStepDown(0);                         // hold step 0 (barOffset 0)
    eq('not step-auto until a gesture', seqState.stepAutoMode, false);
    eq('hold+knob consumed', handleAutomationKnob(0, 0, info, +1, () => true), true);
    eq('entered step-auto mode', seqState.stepAutoMode, true);
    eq('aset at held step 0', peekSeqCmdQueue().some((o) => o.startsWith('aset 0 0 0 ')), true);
    eq('release after step-auto is NOT a tap', editStepUp(0), false);

    // A plain tap (no knob, no hold) stays a tap → toggles a note.
    resetStepEdit(); resetSeqState();
    editStepDown(1);
    eq('plain press is still a tap', editStepUp(1), true);

    // endStepAutomation clears the mode + held snapshot.
    seqState.stepAutoMode = true; seqState.heldLocks.set(0, 50);
    endStepAutomation();
    eq('endStepAutomation clears mode', seqState.stepAutoMode, false);
    eq('endStepAutomation clears heldLocks', seqState.heldLocks.size, 0);
}

/* ── automation: tap a knob (no turn) in step-auto clears that step ───────── */
_log('\nautomation tap-to-clear:');
{
    const { resetAutomation, handleAutomationKnob, automationKnobTouched, automationKnobReleased } =
        await import('../../dist/esm/seq/automation.js');
    const { resetStepEdit } = await import('../../dist/esm/seq/step-edit.js');
    const { resetSeqEngine, peekSeqCmdQueue } = await import('../../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');
    const info = { gi: 0, key: 'cutoff', ioKey: 'cutoff', target: 'synth', value: 1, min: 0, max: 2, type: 'float', automatable: true };

    resetAutomation(); resetSeqEngine(); resetSeqState(); resetStepEdit();
    seqState.stepAutoMode = true; seqState.holdStep = 4;
    handleAutomationKnob(0, 0, info, +1, () => true);    // create a lock by turning
    eq('lock present after a turn', seqState.heldLocks.has(0), true);

    // Tap = touch then release without turning → clears this step's lock.
    resetSeqEngine();
    automationKnobTouched(0);
    automationKnobReleased(0, 0, info);
    eq('tap queues aclrs at held step', peekSeqCmdQueue().some((o) => o.startsWith('aclrs 0 0 4')), true);
    eq('tap clears the optimistic held lock', seqState.heldLocks.has(0), false);

    // Touch + turn is NOT a tap → no clear.
    resetSeqEngine();
    automationKnobTouched(0);
    handleAutomationKnob(0, 0, info, +1, () => true);
    automationKnobReleased(0, 0, info);
    eq('touch+turn does not clear', peekSeqCmdQueue().some((o) => o.startsWith('aclrs')), false);
    resetSeqState();
}

/* ── automation: holding a bar in Loop mode sets the whole bar ────────────── */
_log('\nautomation bar-range (Loop mode):');
{
    const { resetAutomation, handleAutomationKnob } = await import('../../dist/esm/seq/automation.js');
    const { editStepDown, resetStepEdit } = await import('../../dist/esm/seq/step-edit.js');
    const { resetSeqEngine, peekSeqCmdQueue } = await import('../../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');
    const info = { gi: 0, key: 'cutoff', ioKey: 'cutoff', target: 'synth', value: 1, min: 0, max: 2, type: 'float', automatable: true };

    resetAutomation(); resetSeqEngine(); resetSeqState(); resetStepEdit();
    seqState.loopMode = true;
    editStepDown(1);                         // hold bar 1 → range steps 16..31
    eq('bar-knob consumed', handleAutomationKnob(0, 0, info, +1, () => true), true);
    eq('writes asetr across the bar', peekSeqCmdQueue().some((o) => o.startsWith('asetr 0 0 16 31 ')), true);
    eq('no single-step aset for a bar', peekSeqCmdQueue().some((o) => o.startsWith('aset 0 0 ')), false);
    resetSeqState(); resetStepEdit();
}

/* ── automation: held-step display change detection (repaint trigger) ─────── */
_log('\nautomation display-dirty:');
{
    const { resetAutomation, automationDisplayDirty, handleAutomationKnob, automationKnobReleased } = await import('../../dist/esm/seq/automation.js');
    const { resetSeqEngine } = await import('../../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');

    resetAutomation(); resetSeqState();
    eq('idle: not dirty', automationDisplayDirty(), false);

    seqState.stepAutoMode = true;
    eq('enter step-auto → dirty', automationDisplayDirty(), true);
    eq('unchanged → not dirty', automationDisplayDirty(), false);

    seqState.heldLocks.set(0, 100);          // a lock appears at the held step
    eq('new lock → dirty', automationDisplayDirty(), true);

    seqState.heldLocks.set(0, 50);           // turning the knob changes the value
    eq('lock value change → dirty', automationDisplayDirty(), true);
    eq('same value again → not dirty', automationDisplayDirty(), false);

    seqState.stepAutoMode = false;           // release the step
    eq('exit step-auto → dirty', automationDisplayDirty(), true);
    resetAutomation(); resetSeqState();

    // Live record (NOT step-auto): turning a knob must ALSO trigger a repaint so
    // the on-screen arc/value follows the live take; release snaps back to base
    // (also a repaint). Without this, the screen stays frozen while turning.
    resetAutomation(); resetSeqEngine(); resetSeqState();
    const liveInfo = { gi: 0, key: 'cutoff', ioKey: 'cutoff', target: 'synth', value: 1, min: 0, max: 2, type: 'float', automatable: true };
    seqState.recording = true; seqState.playing = true; seqState.curStep = 2;
    automationDisplayDirty();                 // settle the baseline signature
    handleAutomationKnob(0, 0, liveInfo, +5, () => true);
    eq('live take knob turn → dirty', automationDisplayDirty(), true);
    eq('live take unchanged → not dirty', automationDisplayDirty(), false);
    automationKnobReleased(0, 0, liveInfo);
    eq('live take release (snap to base) → dirty', automationDisplayDirty(), true);
    resetAutomation(); resetSeqEngine(); resetSeqState();
}

/* ── pad-scope: concrete→alias reverse mapping ───────────────────────────── */
_log('\npad-scope aliasFromConcrete:');
{
    const { aliasFromConcrete } = await import('../../dist/esm/model/pad-scope.js');
    const ps = { aliasPrefix: 'pad_', concreteKeyTemplate: 'p{pad}_{suffix}', padDigits: 2 };
    eq('p07_pan → pad_pan', aliasFromConcrete(ps, 'p07_pan'), 'pad_pan');
    eq('p01_decay_ms → pad_decay_ms', aliasFromConcrete(ps, 'p01_decay_ms'), 'pad_decay_ms');
    eq('bare alias is not concrete → null', aliasFromConcrete(ps, 'pad_pan'), null);
    eq('non-matching key → null', aliasFromConcrete(ps, 'timbre'), null);
    eq('no scoping → null', aliasFromConcrete(undefined, 'p07_pan'), null);
    // suffixOverrides reverse-map ONLY their own literal suffix: v3_fx1 is the
    // fx1 override's shape → cv_fx1, but v3_lvl (a Mix-bank concrete key that
    // happens to share the template shape) must NOT alias-map.
    const ov = {
        aliasPrefix: 'cv_', concreteKeyTemplate: 'pv{pad}_{suffix}', padDigits: 1,
        suffixOverrides: { fx1: { template: 'v{pad}_{suffix}', maxPad: 8 } },
    };
    eq('override concrete → alias', aliasFromConcrete(ov, 'v3_fx1'), 'cv_fx1');
    eq('foreign key sharing shape → null', aliasFromConcrete(ov, 'v3_lvl'), null);
    eq('main template still maps', aliasFromConcrete(ov, 'pv3_pwm'), 'cv_pwm');
    /* padDigits is a MINIMUM width: concreteKey writes forge's pad 16 as pv16. */
    eq('pad past the digit count maps', aliasFromConcrete(ov, 'pv16_pwm'), 'cv_pwm');
    /* padKeys entries are the module's OWN declared params, so they are NOT
     * reverse-mapped: bd_c_tune validates as itself. Aliasing it to pad_pitch —
     * a key 9W9 never declares — would purge every per-voice lane as stale. */
    const tbl = { aliasPrefix: 'pad_', padKeys: { pitch: ['bd_c_tune', 'sd_c_tune'] } };
    eq('padKeys key not reverse-mapped', aliasFromConcrete(tbl, 'bd_c_tune'), null);
    eq('padKeys-only config, foreign key → null', aliasFromConcrete(tbl, 'p07_pan'), null);
}

/* ── automation: lane validation (purge stale / obsolete-alias lanes) ─────── */
_log('\nautomation validateLane:');
{
    const { validateLane } = await import('../../dist/esm/seq/automation.js');
    const ps = { aliasPrefix: 'pad_', concreteKeyTemplate: 'p{pad}_{suffix}', padDigits: 2 };
    // The lookup mirrors the model's loaded param set (config-driven for drums:
    // it lists the ALIAS keys, never the concrete per-pad keys).
    const meta = { cutoff: { min: 0, max: 2, type: 'float' }, pad_pan: { min: -1, max: 1, type: 'float' } };
    const lookup = (k) => meta[k] ?? null;
    // Plain param present → keep with its range.
    eq('plain param kept (range)', validateLane('synth:cutoff', null, lookup).max, 2);
    // Bare pad-alias key (pre per-pad migration) → drop even though pad_pan exists.
    eq('obsolete alias dropped', validateLane('synth:pad_pan', ps, lookup), 'drop');
    // Concrete pad key whose alias IS a known param → KEEP (its alias' range).
    eq('valid per-pad lane kept', validateLane('synth:p07_pan', ps, lookup).max, 1);
    // Concrete pad key whose alias is unknown (module changed) → stale → drop.
    eq('stale per-pad lane dropped', validateLane('synth:p07_cutoff', ps, lookup), 'drop');
    // Plain param not in the set (cross-module leftover) → stale → drop.
    eq('stale plain param dropped', validateLane('synth:timbre', ps, lookup), 'drop');
    // A persisted lane on a suffix-override concrete key (Forge send: v3_fx1)
    // validates through its alias; a Mix-bank concrete key sharing the shape
    // (v3_lvl) validates as ITSELF (it's listed directly, never alias-mapped).
    const ovPs = {
        aliasPrefix: 'cv_', concreteKeyTemplate: 'pv{pad}_{suffix}', padDigits: 1,
        suffixOverrides: { fx1: { template: 'v{pad}_{suffix}', maxPad: 8 } },
    };
    const ovMeta = { cv_fx1: { min: 0, max: 1, type: 'float' }, v3_lvl: { min: 0, max: 1, type: 'float' } };
    const ovLookup = (k) => ovMeta[k] ?? null;
    eq('override send lane kept', validateLane('synth:v3_fx1', ovPs, ovLookup).max, 1);
    eq('direct concrete param kept', validateLane('synth:v3_lvl', ovPs, ovLookup).max, 1);
    eq('stale override-shaped lane dropped', validateLane('synth:v3_zzz', ovPs, ovLookup), 'drop');
    // padKeys: the per-voice key is declared by the module, so its lane keeps
    // its own range; the alias itself is still an obsolete lane target.
    const tblPs = { aliasPrefix: 'pad_', padKeys: { pitch: ['bd_c_tune', 'sd_c_tune'] } };
    const tblMeta = { bd_c_tune: { min: 0, max: 127, type: 'int' } };
    const tblLookup = (k) => tblMeta[k] ?? null;
    eq('per-voice lane kept', validateLane('synth:bd_c_tune', tblPs, tblLookup).max, 127);
    eq('alias lane dropped', validateLane('synth:pad_pitch', tblPs, tblLookup), 'drop');
    eq('undeclared voice key dropped', validateLane('synth:zz_c_tune', tblPs, tblLookup), 'drop');
    /* A template rack (simian, dr32): the lane names pad N's concrete key,
     * which the model never lists — it validates through the child-level
     * template it instantiates, with that template's range. */
    const tmplMeta = { tune: { min: -24, max: 24, type: 'float' } };
    const tmpl = (k) => (k === 'pad16_tune' ? 'tune' : null);
    eq('concrete child key kept by its template', validateLane('synth:pad16_tune', null, (k) => tmplMeta[k] ?? null, tmpl).max, 24);
    eq('child key with no template still dropped', validateLane('synth:pad16_zz', null, (k) => tmplMeta[k] ?? null, tmpl), 'drop');
}

/* ── model/child-keys: concrete instance key → its child-level template ──── */
_log('\nmodel child-keys:');
if (process.env.SCHWUNG) {
    const { join, resolve } = await import('node:path');
    const ck = await import(join(resolve(process.env.SCHWUNG), 'src', 'shared', 'param_pages', 'child_key.mjs'));
    const { setChildKeyResolver, childLevelsOf, childTemplateOf, declaredKeysOf } =
        await import('../../dist/esm/model/child-keys.js');
    const levels = {
        root: { knobs: ['master'], params: [{ level: 'pads' }] },
        pads: { child_count: 16, child_index_base: 1, child_key_template: 'pad{index}_{key}',
                knobs: ['tune', { key: 'decay' }], params: [{ key: 'pan' }] },
    };
    setChildKeyResolver(null, null);
    eq('no resolver registered → no child levels', childLevelsOf(levels).length, 0);
    setChildKeyResolver(ck.resolveChildKey, ck.childCount);
    const kids = childLevelsOf(levels);
    eq('only the repeating level is a child level', kids.length, 1);
    eq('pad16_tune → tune', childTemplateOf(kids, 'pad16_tune'), 'tune');
    eq('an object knob resolves too', childTemplateOf(kids, 'pad1_decay'), 'decay');
    eq('a level param resolves too', childTemplateOf(kids, 'pad3_pan'), 'pan');
    eq('past the instance count → null', childTemplateOf(kids, 'pad17_tune'), null);
    eq('the bare template is not an instance', childTemplateOf(kids, 'tune'), null);
    const keys = declaredKeysOf(['cutoff'], levels);
    eq('declared keys: chain_params, knobs and params, no level links',
       keys.has('cutoff') && keys.has('master') && keys.has('tune') && keys.has('decay')
       && keys.has('pan') && !keys.has('pads') && keys.size === 5, true);
} else {
    _log('    SKIPPED (no SCHWUNG checkout)');
}

/* ── automation: clearing a clip's automation re-requests a label sync ─────── */
/* The engine frees a lane when its last lock is removed; the UI must re-sync so
 * the freed lane leaves the registry (no phantom assigned lane). */
_log('\nautomation clear re-requests label sync:');
{
    const { resetAutomation, clearStepAllAutomation, automationKnobReleased, automationKnobTouched, assignLane } =
        await import('../../dist/esm/seq/automation.js');
    const { resetSeqEngine, takeLabelSync } = await import('../../dist/esm/seq/engine.js');
    const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');

    resetAutomation(); resetSeqEngine(); resetSeqState();
    takeLabelSync();                                   // drain any pending
    clearStepAllAutomation(0, 4);                      // Clear + step
    eq('clearStepAllAutomation requests a label sync', takeLabelSync(), true);

    // Tap-clear (touch + release without turning) clears a step's lock too.
    resetAutomation(); resetSeqEngine(); resetSeqState();
    takeLabelSync();
    seqState.stepAutoMode = true; seqState.holdStep = 4;
    const info = { gi: 0, key: 'cutoff', ioKey: 'cutoff', target: 'synth', value: 1, min: 0, max: 2, type: 'float', automatable: true };
    const tapLane = assignLane(0, 0, info, () => true); // lane must exist + hold a lock to clear
    seqState.heldLocks.set(tapLane, 60);
    takeLabelSync();                                   // drain the assign's sync, if any
    automationKnobTouched(0);                           // arm tap-to-clear
    automationKnobReleased(0, 0, info);                // tap (never turned) → aclrs
    eq('tap-clear requests a label sync', takeLabelSync(), true);
    resetSeqState();
}

/* ── automation: label re-sync from engine (validates + purges) ───────────── */
_log('\nautomation label sync:');
{
    const { resetAutomation, syncLabelsFromEngine, laneForParam, automationRegistry } =
        await import('../../dist/esm/seq/automation.js');
    const { resetSeqEngine, peekSeqCmdQueue } = await import('../../dist/esm/seq/engine.js');
    resetAutomation(); resetSeqEngine();
    const applied = [];
    // Lane 1 valid (cutoff), lane 2 obsolete-alias (pad_vol), lane 3 stale (timbre).
    syncLabelsFromEngine(
        '-.synth:cutoff.synth:pad_vol.synth:timbre.-.-.-.-,-.-.-.-.-.-.-.-,-.-.-.-.-.-.-.-,-.-.-.-.-.-.-.-',
        (slot, lane, e) => applied.push(slot + ':' + lane + ':' + e.targetParam),
        (track, tp) => {
            if (tp === 'synth:cutoff') return { min: 0, max: 1, type: 'float' };
            if (tp === 'synth:pad_vol') return 'drop';   // obsolete alias
            if (tp === 'synth:timbre') return 'drop';    // stale param
            return 'unknown';
        },
    );
    eq('valid lane synced into registry', laneForParam(0, 'synth:cutoff'), 1);
    eq('re-bound the valid lane', applied.includes('0:1:synth:cutoff'), true);
    eq('obsolete-alias lane purged', laneForParam(0, 'synth:pad_vol'), -1);
    eq('stale lane purged', laneForParam(0, 'synth:timbre'), -1);
    // Purge emits aclr so the engine + persistence drop the lane too.
    const q = peekSeqCmdQueue();
    eq('aclr queued for obsolete-alias lane', q.includes('aclr 0 2'), true);
    eq('aclr queued for stale lane', q.includes('aclr 0 3'), true);
    eq('no aclr for the valid lane', q.includes('aclr 0 1'), false);
}

/* ── automation: lane restore reaches every track ─────────────────────────── */
_log('\nautomation lane restore covers 16 tracks:');
{
    const { resetAutomation, syncLabelsFromEngine, automationRegistry } =
        await import('../../dist/esm/seq/automation.js');
    const { resetSeqEngine } = await import('../../dist/esm/seq/engine.js');
    const { TRACK_COUNT } = await import('../../dist/esm/track/ref.js');
    const { AUTO_LANES } = await import('../../dist/esm/seq/constants.js');

    /* The engine emits labels for all 16 tracks (engine.rs auto_labels), but the
     * UI read only the first four — a leftover from when movy had four. Lanes on
     * tracks 5-16 were therefore never rebuilt after a Set load: automation that
     * plays back in one session and is silently gone in the next. */
    resetAutomation(); resetSeqEngine();
    const row = Array.from({ length: AUTO_LANES }, (_, l) => l === 0 || l === AUTO_LANES - 1 ? 'synth:cutoff' + l : '-');
    const labels = Array.from({ length: TRACK_COUNT }, () => row.join('.')).join(',');
    const applied = [];
    syncLabelsFromEngine(labels, (slot, lane) => applied.push(slot + ':' + lane),
                         () => ({ min: 0, max: 1, type: 'float' }));
    eq('every track is restored', applied.filter((a) => a.endsWith(':0')).length, TRACK_COUNT);
    eq('the last track is restored', applied.includes((TRACK_COUNT - 1) + ':0'), true);
    eq('the last lane is restored (D13)', applied.includes('0:' + (AUTO_LANES - 1)), true);
    eq('the registry holds the last lane', automationRegistry()[0][AUTO_LANES - 1]?.targetParam,
       'synth:cutoff' + (AUTO_LANES - 1));
}

/* ── automation: a lane whose module is not loaded is kept, unbound ────────── */
/* The bind carries the param's range; binding a guessed one would write wrong
 * values. The lane waits, and the sync says a retry is owed. */
_log('\nautomation unknown lane waits for its module:');
{
    const { resetAutomation, syncLabelsFromEngine, laneForParam } =
        await import('../../dist/esm/seq/automation.js');
    const { resetSeqEngine, peekSeqCmdQueue } = await import('../../dist/esm/seq/engine.js');
    resetAutomation(); resetSeqEngine();
    const applied = [];
    const verdict = { 'synth:a': { min: 0, max: 1, type: 'float' }, 'synth:b': 'unknown' };
    const pending = syncLabelsFromEngine('synth:a.synth:b', (s, l, e) => applied.push(e.targetParam),
                                         (t, tp) => verdict[tp]);
    eq('an unknown lane is not bound', applied.join('|'), 'synth:a');
    eq('but it is kept', laneForParam(0, 'synth:b'), 1);
    eq('and not purged', peekSeqCmdQueue().includes('aclr 0 1'), false);
    eq('the sync reports a retry owed', pending, true);
    verdict['synth:b'] = { min: 0, max: 10, type: 'int' };
    applied.length = 0;
    eq('a later sync with the module loaded owes nothing',
       syncLabelsFromEngine('synth:a.synth:b', (s, l, e) => applied.push(e.targetParam), (t, tp) => verdict[tp]), false);
    eq('and binds it', applied.includes('synth:b'), true);
}

}
