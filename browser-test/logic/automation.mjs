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
    // Pool of 8: filling all returns -1.
    for (let i = 1; i < 8; i++) assignLane(0, 0, { ...info, key: 'k' + i, ioKey: 'k' + i }, () => true);
    eq('pool full → -1', assignLane(0, 0, { ...info, key: 'k8', ioKey: 'k8' }, () => true), -1);
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
    eq('empty pool not full', poolIsFull(0), false);
    for (let i = 0; i < 7; i++) assignLane(0, 0, mk('k' + i), () => true);
    eq('7 lanes not full yet', poolIsFull(0), false);
    assignLane(0, 0, mk('k7'), () => true);            // 8th → full immediately
    eq('8 lanes → pool full', poolIsFull(0), true);
    clearLane(0, 3);                                   // freeing a lane → not full
    eq('after freeing one → not full', poolIsFull(0), false);
}

/* ── automation: lane param-cache warm after a chain reload ───────────────── */
/* A reselect empties the host's static param cache (find_param_info source) for
 * self-describing modules → abs-CC playback silently drops. Reading a mapped
 * knob's _value triggers the host's refreshing lookup; warmLaneParams does that,
 * scheduled over a short strided window so it spans the async reload. */
_log('\nautomation lane warm:');
{
    const { resetAutomation, assignLane, requestLaneWarm, laneWarmTick } =
        await import('../../dist/esm/seq/automation.js');
    const { resetSeqEngine } = await import('../../dist/esm/seq/engine.js');
    const mk = (k) => ({ gi: 0, key: k, ioKey: k, target: 'synth', value: 1, min: 0, max: 2, type: 'float', automatable: true });

    // Idle: no pending warm → no reads (zero idle IPC cost).
    resetAutomation(); resetSeqEngine();
    let reads = [];
    const rec = (t, l) => reads.push(t + ':' + l);
    for (let i = 0; i < 200; i++) laneWarmTick(rec);
    eq('idle warm does nothing', reads.length, 0);

    // One synth lane on track 0 → a scheduled window warms it a handful of times.
    assignLane(0, 0, mk('cutoff'), () => true);
    requestLaneWarm(0);
    reads = [];
    for (let i = 0; i < 96; i++) laneWarmTick(rec);
    eq('warm window fires ~6 strided reads', reads.length, 6);
    eq('warm reads the lane on its track', reads.every((r) => r === '0:0'), true);
    // Window closes: further ticks are silent until the next request.
    reads = [];
    for (let i = 0; i < 96; i++) laneWarmTick(rec);
    eq('warm stops after the window', reads.length, 0);

    // Two lanes on the SAME component → deduped to one read per warm (the refresh
    // repopulates the whole component's params, not just one param's).
    resetAutomation(); resetSeqEngine();
    assignLane(0, 0, mk('cutoff'), () => true);
    assignLane(0, 0, mk('attack'), () => true);
    requestLaneWarm(0);
    reads = [];
    for (let i = 0; i < 96; i++) laneWarmTick(rec);
    eq('same-component lanes deduped to one read/warm', reads.length, 6);
    eq('dedup keeps the first lane', reads.every((r) => r === '0:0'), true);

    // A track with no lanes costs nothing even when a warm is requested.
    resetAutomation(); resetSeqEngine();
    requestLaneWarm(2);
    reads = [];
    for (let i = 0; i < 96; i++) laneWarmTick(rec);
    eq('no-lane track warm is a no-op', reads.length, 0);
}

/* ── automation: knob-turn routing (hold-step / Rec / base) ──────────────── */
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

    // Non-automatable param is never consumed.
    resetAutomation(); resetSeqEngine(); resetSeqState();
    seqState.stepAutoMode = true; seqState.holdStep = 4;
    eq('non-automatable not consumed',
        handleAutomationKnob(0, 0, { ...info, automatable: false }, +1, () => true), false);

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
}

/* ── automation: chain-mapping verify/re-apply after a module reload ──────── */
_log('\nautomation verifyLaneMappings:');
{
    const { verifyLaneMappings, automationRegistry, resetAutomation } =
        await import('../../dist/esm/seq/automation.js');
    resetAutomation();
    const reg = automationRegistry();
    reg[0][0] = { targetParam: 'synth:pv1_f1_cut', shortName: 'pv1_f1_cut', min: 0, max: 1, type: 'float' };
    reg[0][3] = { targetParam: 'synth:v5_fx2', shortName: 'v5_fx2', min: 0, max: 1, type: 'float' };

    // Mapping intact ("target: param" format) → no re-apply.
    let applied = [];
    let reads = 0;
    const run = (name) => verifyLaneMappings(
        () => { reads++; return name; },
        (slot, lane, tp) => applied.push(slot + ':' + lane + ':' + tp),
    );
    // 4 calls round-robin all tracks; only track 0 has lanes → 1 read.
    reads = 0; applied = [];
    for (let i = 0; i < 4; i++) run('synth: pv1_f1_cut');
    eq('intact mapping: no re-apply', applied.length, 0);
    eq('only lane-bearing track reads', reads, 1);

    // Mapping cleared (null name = chain returned "knob not mapped") → every
    // assigned lane on that track re-applied.
    applied = [];
    for (let i = 0; i < 4; i++) run(null);
    eq('cleared mapping: re-applies all lanes',
        applied.join('|'), '0:0:synth:pv1_f1_cut|0:3:synth:v5_fx2');

    // Foreign mapping (module swapped, knob remapped elsewhere) → re-apply.
    applied = [];
    for (let i = 0; i < 4; i++) run('synth: cutoff');
    eq('foreign mapping: re-applies', applied.length, 2);
    resetAutomation();
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
        (slot, lane, tp) => applied.push(slot + ':' + lane + ':' + tp),
        (track, tp) => {
            if (tp === 'synth:cutoff') return { min: 0, max: 1, type: 'float' };
            if (tp === 'synth:pad_vol') return 'drop';   // obsolete alias
            if (tp === 'synth:timbre') return 'drop';    // stale param
            return 'unknown';
        },
    );
    eq('valid lane synced into registry', laneForParam(0, 'synth:cutoff'), 1);
    eq('re-applied valid knob mapping', applied.includes('0:1:synth:cutoff'), true);
    eq('obsolete-alias lane purged', laneForParam(0, 'synth:pad_vol'), -1);
    eq('stale lane purged', laneForParam(0, 'synth:timbre'), -1);
    // Purge emits aclr so the engine + persistence drop the lane too.
    const q = peekSeqCmdQueue();
    eq('aclr queued for obsolete-alias lane', q.includes('aclr 0 2'), true);
    eq('aclr queued for stale lane', q.includes('aclr 0 3'), true);
    eq('no aclr for the valid lane', q.includes('aclr 0 1'), false);
}

}
