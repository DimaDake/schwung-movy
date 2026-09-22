/* browser-test/logic/step-params-source.mjs — SP-54's step-page contract:
 * the virtual source `createVirtualSource` synthesises for the held-trig
 * mirror, the one-writer invariant with the delta path (`editStepPageKnob`),
 * and the lost-release non-latching claim itself (the page's cache entry is
 * dropped on BOTH the happy-path release and the recovery path, never left
 * to a cleanup that only runs on one of them).
 *
 * The first two blocks need no schwung checkout — pure functions over
 * `seqState`. The third is guarded (`schwungLibAvailable()`) and drives the
 * REAL press→hold→release production functions (`editStepDown`/
 * `beginStepAutomation`/`editStepUp`/`endStepAutomation`), not a shortcut.
 *
 * Run by browser-test/logic.mjs.
 */

import { appState, trackRef, resetPorts, ok, eq, _log,
         schwungLibAvailable, schwungGridMode, setSchwungGridMode, schwungGridDrop,
         schwungPageFor } from './harness.mjs';

export async function run() {

_log('\nlogic: step page virtual source (SP-54)');

const { STEP_PARAMS_COMPONENT, isVirtualPageComponent } = await import('../../dist/esm/chain/config.js');
const { stepParamsSource } = await import('../../dist/esm/seq/step-params-contract.js');
const { LENGTH_LABELS, PROB_LABELS, COND_LABELS, LENGTH_TICKS, PROB_VALUES }
    = await import('../../dist/esm/seq/step-page-vm.js');
const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');
const { peekSeqCmdQueue, resetSeqEngine } = await import('../../dist/esm/seq/engine.js');
const {
    editStepPageKnob, editStepDown, editStepUp, beginStepAutomation,
    endStepAutomation, resetStepEdit,
} = await import('../../dist/esm/seq/step-edit.js');
const { stepPageState, setStepPageSelected, resetStepPage } = await import('../../dist/esm/seq/step-page.js');
const { MASTER_PAGE_TRACK } = await import('../../dist/esm/app/page-owner.js');

function reset() {
    resetSeqState(); resetSeqEngine(); resetStepEdit(); resetStepPage();
    appState.activeTrack = trackRef(0);
}

const key = (k) => STEP_PARAMS_COMPONENT + ':' + k;

/* ── the contract is config-first, and its SHAPE is the library's ────────── */
_log('\nTest: the synthesised contract');
{
    reset();
    ok('is a registered virtual component', isVirtualPageComponent(STEP_PARAMS_COMPONENT));

    const source = stepParamsSource();
    const hier = JSON.parse(source.getParam(key('ui_hierarchy')));
    eq('the root level lists all five keys', hier.levels.root.knobs.join(','),
       'vel,len,prob,cond,invert');

    const params = JSON.parse(source.getParam(key('chain_params')));
    ok('chain_params is an ARRAY, not a keyed object', Array.isArray(params));
    eq('one entry per cell', params.length, 5);
    eq('every cell declares its own short_name', params.map((p) => p.short_name).join(','),
       'VEL,LEN,PROB,COND,INV');

    const len = params.find((p) => p.key === 'len');
    /* FURTHER NATIVE THAN SP-53's Clip/Set Params could go: LENGTH already has
     * a fixed label array, so it needs no widget at all — a correction of the
     * ledger's assumption that these five cells "are the page", not a restyle. */
    eq('LEN is an enum sized off the real LENGTH_LABELS array', len.type + ':' + len.options.length,
       'enum:' + LENGTH_LABELS.length);
    const prob = params.find((p) => p.key === 'prob');
    eq('PROB is an enum sized off PROB_LABELS', prob.type + ':' + prob.options.length,
       'enum:' + PROB_LABELS.length);
    const cond = params.find((p) => p.key === 'cond');
    eq('COND is an enum sized off COND_LABELS', cond.type + ':' + cond.options.length,
       'enum:' + COND_LABELS.length);
    const invert = params.find((p) => p.key === 'invert');
    eq('INVERT is a toggle', invert.type, 'toggle');
    const vel = params.find((p) => p.key === 'vel');
    eq('VELOCITY is an int 0-127', vel.type + ':' + vel.min + ':' + vel.max, 'int:0:127');

    /* SP-57 H1. The fader is DECLARED, not detected: no detector claims `vel`
     * (the fader detector matches on NAME and `vel` is not one of the fourteen
     * it takes), so without this the cell draws Schwung's ordinary arc — which
     * is what made SP-54 record the vbar as lost. The assertion is on the
     * contract string because that is the whole of movy's side of it; the
     * pixels are pinned by the `page_stepparams` baseline. */
    ok('VELOCITY declares the fader viz', !!vel.viz && vel.viz.kind === 'fader');
    ok('no other cell declares a viz', params.filter((p) => p.viz).length === 1);
}

/* ── one writer: the virtual source's set() and editStepPageKnob agree ───── */
_log('\nTest: the virtual source and editStepPageKnob write the SAME field');
{
    reset();
    const source = stepParamsSource();

    // LEN — editStepPageKnob is a no-op with nothing held (`anyStepHeld()`
    // guard), same as the real gesture: the knob only edits a held step.
    editStepDown(0);
    seqState.holdGate = LENGTH_TICKS[5];
    editStepPageKnob(1, 8);   // knob 1 (LEN), +1 detent (DETENT_DIV=8)
    eq('the delta path advances one LENGTH_TICKS index', seqState.holdGate, LENGTH_TICKS[6]);
    reset();
    source.setParam(key('len'), '6');
    eq('the source lands on the same index', seqState.holdGate, LENGTH_TICKS[6]);

    // PROB_VALUES is DESCENDING (100% first) to match the delta path's own
    // "CW raises probability" math (subtracts a CW detent from the index).
    // The WIRE index is the reverse of that — Schwung's turn convention is
    // fixed (CW always INCREASES the wire index), so `source`'s get/set
    // invert index-space at the boundary. Same field, same final percentage;
    // only the wire index handed to `set()` differs from the internal one.
    reset();
    editStepDown(0);
    seqState.holdProb = PROB_VALUES[5];
    editStepPageKnob(2, 8);
    eq('the delta path raises probability by one step', seqState.holdProb, PROB_VALUES[4]);
    reset();
    source.setParam(key('prob'), String(PROB_VALUES.length - 1 - 4));
    eq('the source lands on the same percentage', seqState.holdProb, PROB_VALUES[4]);

    // INVERT
    reset();
    editStepDown(0);
    seqState.holdInvert = false;
    editStepPageKnob(4, 8);   // CW = on
    eq('the delta path turns invert on', seqState.holdInvert, true);
    reset();
    source.setParam(key('invert'), '1');
    eq('the source writes the same field', seqState.holdInvert, true);

    /* VELOCITY has no optimistic seqState mirror (matches the `off` arm,
     * which relies on the engine's next status poll) — so the proof is the
     * EMITTED COMMAND, over a real held step so `forEach` has something to
     * iterate. Both paths must compute the identical delta from the identical
     * starting value: that IS `applyStepVelocityAbs`, not two guesses that
     * happen to agree today. */
    reset();
    editStepDown(0);           // registers step 0 as held (Note mode, watchLane<0)
    seqState.holdVel = 60;
    editStepPageKnob(0, 1);    // any positive delta — only the sign matters
    const deltaOp = peekSeqCmdQueue().find((o) => o.startsWith('evel'));
    ok('the delta path emitted an evel command', !!deltaOp);

    reset();
    editStepDown(0);
    seqState.holdVel = 60;
    source.setParam(key('vel'), '64');   // holdVel(60) + VEL_STEP(4)
    const sourceOp = peekSeqCmdQueue().find((o) => o.startsWith('evel'));
    eq('the source emits the identical evel command', sourceOp, deltaOp);
}

/* ── the lost-release claim: non-latching by construction ─────────────────
 * Both the happy-path release (`endStepAutomation` -> `onSessionEnd`) and the
 * lost-release recovery path (`app/input-reset.ts`'s `resetHeldInput` ->
 * `resetStepPage`) call the SAME drop — proven here by driving each and
 * checking the cached SchwungPage identity changes. Removing the
 * `schwungGridDrop` call from either function (not just one) is what should
 * redden this block; it is written against BOTH on purpose. */
if (!schwungLibAvailable()) {
    _log('\nlogic: step page lifecycle — SKIPPED (no param_pages; set SCHWUNG=)');
} else {
    _log('\nTest: a step-hold contract does not survive its own release');
    const savedMode = schwungGridMode();
    setSchwungGridMode('page');

    // Deliberately no `reset()` between captures below — `resetStepPage()` ALSO
    // drops the cache (it is the recovery path's own drop), so calling it
    // between every grab would mask a missing drop in `onSessionEnd` and prove
    // nothing. Isolating each path means starting clean once, then holding a
    // NEW step for each capture through only the function under test.
    reset();
    const grab = () => schwungPageFor(MASTER_PAGE_TRACK, STEP_PARAMS_COMPONENT, null, null);
    // `beginStepAutomation()` runs `onSessionStart()`, which re-opens the step
    // page from `lastSessionStepPage` — true from the SECOND hold on, once the
    // first explicit `setStepPageSelected(true)` below has set it (a fresh
    // `reset()` starts that flag false, so the first hold needs it explicitly).
    const holdAStep = (button) => { editStepDown(button); beginStepAutomation(); };

    holdAStep(0);
    setStepPageSelected(true);
    eq('the session actually opened the step page', stepPageState.selected, true);
    const first = grab();
    // Happy path: editStepUp + endStepAutomation, the router's own sequence
    // (seq/router-steps.ts) when the last held step is released.
    editStepUp(0);
    endStepAutomation();
    holdAStep(1);   // a NEW hold, nothing else touched the cache in between
    eq('the step page reopens on the next hold, remembered', stepPageState.selected, true);
    const second = grab();
    ok('a released hold does not hand the next hold a stale page', first !== second);

    // Lost-release recovery: `resetStepEdit()` + `resetStepPage()` are what
    // `app/input-reset.ts`'s `resetHeldInput()` calls, in that order, on tool
    // open / Leave-Movy — no `editStepUp`/`endStepAutomation` at all,
    // simulating a release the host never delivered (button 1 is still
    // "held" in step-edit's own bookkeeping until this clears it).
    resetStepEdit();
    resetStepPage();
    setStepPageSelected(true);   // resetStepPage() cleared the memory too
    holdAStep(2);
    const third = grab();
    ok('the recovery path drops the same cache entry', second !== third);

    setSchwungGridMode(savedMode);
    schwungGridDrop(MASTER_PAGE_TRACK, STEP_PARAMS_COMPONENT);
}

resetStepPage();
resetPorts();
}
