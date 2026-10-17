/* browser-test/logic/step-params-source.mjs — SP-54's step-page contract:
 * the virtual source `createVirtualSource` synthesises for the held-trig
 * mirror, the fields its set() reaches,
 * and the lost-release non-latching claim itself (the page's cache entry is
 * dropped on BOTH the happy-path release and the recovery path, never left
 * to a cleanup that only runs on one of them).
 *
 * The first two blocks are pure functions over `seqState`. The third drives the
 * REAL press→hold→release production functions (`editStepDown`/
 * `beginStepAutomation`/`editStepUp`/`endStepAutomation`), not a shortcut.
 *
 * Run by browser-test/logic.mjs.
 */

import { appState, trackRef, resetPorts, ok, eq, _log,
         schwungGridDrop,
         schwungPageFor } from './harness.mjs';

export async function run() {

_log('\nlogic: step page virtual source (SP-54)');

const { STEP_PARAMS_COMPONENT, isVirtualPageComponent } = await import('../../dist/esm/chain/config.js');
const { stepParamsSource } = await import('../../dist/esm/seq/step-params-contract.js');
const { LENGTH_LABELS, PROB_LABELS, COND_LABELS, LENGTH_TICKS, PROB_VALUES, lengthIndexForTicks }
    = await import('../../dist/esm/seq/step-page-vm.js');
const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');
const { peekSeqCmdQueue, resetSeqEngine } = await import('../../dist/esm/seq/engine.js');
const {
    editStepDown, editStepUp, beginStepAutomation,
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
    /* ONE cell declares a graphic, and no more: VEL's fader. LEN and PROB
     * stay Schwung's plain enum square — the page is still native everywhere
     * a native widget reads right. */
    eq('exactly one cell declares a viz', params.filter((p) => p.viz).length, 1);

    /* SP-57: COND draws in Schwung's big face (`display: "big"`, 1.5.0), which
     * raises no panel on its own; LEN and PROB fit their square and decline it. */
    eq('COND declares the big face', cond.display, 'big');
    const sup = (k) => source.peekSuppressed(key(k));
    ok('LEN and PROB suppress the panel', sup('len') && sup('prob'));

    /* SP-57 H2, the DIVISOR half of the knob rule. Stated in raw CC units per
     * STEP — 8, the number `seq/detent.ts` has always charged on these pages —
     * but spent per DETENT, and a detent is worth different amounts by kind:
     * Schwung burns 4 of them per enum option and 1 per int step. So the
     * divisors differ and the felt rate does not. */
    const per = (k) => source.rawPerDetent(key(k));
    eq('an enum cell costs 2 raw units per detent', per('len') + ',' + per('prob'), '2,2');
    eq('a toggle costs the same as an enum', per('invert'), 2);
    eq('an int cell costs 8 raw units per detent', per('vel'), 8);
    eq('a key this source does not own falls through', per('nosuchkey'), null);

    /* The STEP half. `perDetentStep` is round(max(step, range * 0.01) * 0.5),
     * so the declared 4 moved velocity by TWO per detent — half a step, and
     * half what every neighbouring cell moves. */
    const perDetentStep = Math.round(Math.max(vel.step, (vel.max - vel.min) * 0.01) * 0.5);
    eq('one detent moves velocity by a whole VEL_STEP', perDetentStep, 4);
}

/* ── the virtual source's set() reaches the held-trig fields ───────────── */
_log('\nTest: the virtual source writes the held trig');
{
    reset();
    const source = stepParamsSource();
    source.setParam(key('len'), '6');
    eq('LEN lands on its LENGTH_TICKS index', seqState.holdGate, LENGTH_TICKS[6]);

    /* PROB_VALUES is DESCENDING (100% first); Schwung's turn convention is
     * fixed (CW always INCREASES the wire index), so the source inverts
     * index-space at the boundary. */
    reset();
    source.setParam(key('prob'), String(PROB_VALUES.length - 1 - 4));
    eq('PROB lands on its percentage', seqState.holdProb, PROB_VALUES[4]);

    reset();
    source.setParam(key('invert'), '1');
    eq('INVERT writes the field', seqState.holdInvert, true);

    /* VELOCITY has no optimistic mirror, so the proof is the EMITTED COMMAND,
     * over a real held step so `forEach` has something to iterate. */
    reset();
    editStepDown(0);
    seqState.holdVel = 60;
    source.setParam(key('vel'), '64');
    const op = peekSeqCmdQueue().find((o) => o.startsWith('evel'));
    eq('VEL emits the delta from the held value', op && op.split(' ').pop(), '4');
}

/* ── the lost-release claim: non-latching by construction ─────────────────
 * Both the happy-path release (`endStepAutomation` -> `onSessionEnd`) and the
 * lost-release recovery path (`app/input-reset.ts`'s `resetHeldInput` ->
 * `resetStepPage`) call the SAME drop — proven here by driving each and
 * checking the cached SchwungPage identity changes. Removing the
 * `schwungGridDrop` call from either function (not just one) is what should
 * redden this block; it is written against BOTH on purpose. */
{
    _log('\nTest: a step-hold contract does not survive its own release');

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

    schwungGridDrop(MASTER_PAGE_TRACK, STEP_PARAMS_COMPONENT);
}

/* ── SP-57 H2: the knob rule, end to end through the real controller ────── */

{
    _log('\nTest: eight raw units are one step, through the real page');
    reset();

    editStepDown(0); beginStepAutomation(); setStepPageSelected(true);
    const page = schwungPageFor(MASTER_PAGE_TRACK, STEP_PARAMS_COMPONENT, null, null);
    /* The contract resolves over a few ticks (the read cursor serves one key at
     * a time), so wait for the cell rather than for a tick count. */
    for (let i = 0; i < 12 * 60 && page.keyAt(1) !== 'len'; i++) page.tick();
    eq('knob 1 drives LEN', page.keyAt(1), 'len');

    /* THE ASSERTION THAT CATCHES EITHER HALF BEING WRONG — this divisor, or
     * ENUM_DELTA_DIV upstream. Four raw units is half a step and must move
     * NOTHING; the next four complete it. That is old movy's DETENT_DIV = 8,
     * which is what these pages felt like before delegation. */
    /* EVERY MEASUREMENT IS A WHOLE GESTURE — touch, turn, release — and that is
     * not ceremony. A turn's write is throttled (`SETPARAM_THROTTLE_MS = 20`)
     * and parked in `pendingWrite`; the RELEASE is what flushes it
     * unconditionally. Asserting between two turns with no release reads the
     * state before the write lands, which is the trap SP-53 already fell into
     * and recorded — and it would make the first assertion below pass for the
     * wrong reason, since an unflushed write looks exactly like no write. */
    const idx = () => lengthIndexForTicks(seqState.holdGate);
    const turn = (raw) => { page.knobTouch(1, true); page.knobTurn(1, raw); page.knobTouch(1, false); };

    const before = idx();
    turn(4);
    eq('four raw units do not move an enum cell', idx(), before);
    turn(4);
    eq('eight move it exactly one option', idx(), before + 1);

    /* THE FINGER IS ON THE STEP, as it always is on hardware — and the shim
     * says so (`shadow_get_held_step`). The controller's own fallback reads
     * that byte and, with a step down, sends every write as Schwung's p-lock
     * (`lanes:plock_step`) instead of to the cell, so the turn above moved
     * nothing on the device while every injected test passed: an injected
     * step press never reaches the shim's held mask. */
    const savedHeld = globalThis.shadow_get_held_step;
    const realNow = Date.now;
    globalThis.shadow_get_held_step = () => 0;
    try {
        for (let i = 0; i < 4; i++) page.tick();   // the controller re-reads the held step on its rotation
        /* A HAND'S TURN: detents spread past the write throttle, read BEFORE
         * the release. A turn inside the window is parked and the release
         * flush writes it to the cell directly — the one path the p-lock
         * branch never touches, which is the shape a fast test turn has and
         * a hand does not. How FAR it moves is the knob-feel test's business
         * (above); this one asks only whether the cell hears it at all. */
        let clock = realNow() + 1000;
        Date.now = () => clock;
        const held = idx();
        page.knobTouch(1, true);
        for (let i = 0; i < 6; i++) { clock += 30; page.knobTurn(1, 4); page.tick(); }
        ok('a physically held step does not divert the turn', idx() > held);
        page.knobTouch(1, false);
    } finally {
        Date.now = realNow;
        globalThis.shadow_get_held_step = savedHeld;
    }

    editStepUp(0); endStepAutomation();
    schwungGridDrop(MASTER_PAGE_TRACK, STEP_PARAMS_COMPONENT);
}

resetStepPage();
resetPorts();
}
