/* browser-test/logic/session-mixer.mjs — the Session mixer (hold Session).
 *
 * The contract plans exactly two custom pages through the real planner (the
 * grids it also plans are dropped from the jog), a knob writes its track's
 * fader through the MIX page's writer, the engine's `mtr` field decodes onto
 * the fader's own travel, and the hold opens the mixer only from a latched
 * Session without costing the tap its Session -> Note toggle.
 *
 * Run by browser-test/logic.mjs.
 */

import { appState, resetPorts, ok, eq, _log, schwungGridReload } from './harness.mjs';

export async function run() {

_log('\nlogic: Session mixer');

const { MIXER_COMPONENT, isVirtualPageComponent } = await import('../../dist/esm/chain/config.js');
const { mixerSource, trackOfMixerKey } = await import('../../dist/esm/mixer/mixer-contract.js');
const { decodeMeter, byteToFrac } = await import('../../dist/esm/mixer/meter.js');
const { UNITY_FRAC } = await import('../../dist/esm/mixer/db-ladder.js');
const { readMix } = await import('../../dist/esm/mixer/mix-io.js');
const { pageOwnerForComponent } = await import('../../dist/esm/app/page-owner-virtual.js');
const { mixerHoldTick, mixerPageActive, mixerRelease, resetMixerPage, MIXER_HOLD_MS }
    = await import('../../dist/esm/seq/mixer-page.js');
const { mixerKnobTurn, mixerKnobTouch, mixerJog } = await import('../../dist/esm/seq/mixer-input.js');
const { groupOpen, openGroupKey, resetUndoGroups } = await import('../../dist/esm/undo/group.js');
const { seqHandleMidi } = await import('../../dist/esm/seq/router.js');
const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');
const { resetMomentary } = await import('../../dist/esm/seq/momentary.js');
const { VIEW_CHAIN, VIEW_MIXER } = await import('../../dist/esm/app/state.js');

/* ── the contract ─────────────────────────────────────────────────────────── */
_log('\nTest: two custom pages of eight, and nothing else to jog to');
{
    resetPorts(); resetSeqState();
    ok('is a registered virtual component', isVirtualPageComponent(MIXER_COMPONENT));
    const src = mixerSource();
    const hier = JSON.parse(src.getParam(MIXER_COMPONENT + ':ui_hierarchy'));
    eq('two levels, root first', Object.keys(hier.levels).join(','), 'root,mix2');
    eq('page 1 knobs are tracks 1-8', hier.levels.root.knobs.join(','), 't1,t2,t3,t4,t5,t6,t7,t8');
    const params = JSON.parse(src.getParam(MIXER_COMPONENT + ':chain_params'));
    eq('sixteen faders and two canvas pages', params.length, 18);
    ok('each canvas is a leading custom page',
       params.filter((p) => p.type === 'canvas').every((p) => p.as_page && p.page_first));
    eq('the cell reads as the track, full name in the header',
       params.find((p) => p.key === 't9').name, 'Track 9 Volume');
    eq('trackOfMixerKey', [trackOfMixerKey('t1'), trackOfMixerKey('t16'), trackOfMixerKey('t17'),
        trackOfMixerKey('mix1'), trackOfMixerKey(undefined)].join(','), '0,15,-1,-1,-1');

    schwungGridReload();
    const owner = pageOwnerForComponent(MIXER_COMPONENT);
    for (let i = 0; i < 12 * 60 && !owner.page; i++) owner.poll();
    ok('the contract resolves', !!owner.page);
    /* Teeth: without `canvasOnly` the seat counts the planner's four pages
     * (canvas, grid, canvas, grid). */
    eq('the jog sees two pages, not four', owner.page.pageCount, 2);
    eq('page 1 knob 1 is track 1', owner.page.keyAt(0), 't1');
    eq('the page carries a drawer', !!owner.page.ctl.pages[owner.page.ctl.pageIndex].canvas, true);

    appState.currentView = VIEW_MIXER;
    mixerJog(1);
    eq('the jog turns to page 2', owner.page.pageIndex, 1);
    eq('page 2 knob 1 is track 9', owner.page.keyAt(0), 't9');
    ok('and page 2 is a custom page too', !!owner.page.ctl.pages[owner.page.ctl.pageIndex].canvas);
    mixerJog(1);
    eq('no third page past the end', owner.page.pageIndex, 1);

    /* A knob writes its OWN track: page 2, knob 3 = track 11. The mock ports
     * share one `mix` value, so WHICH track is read off the undo gesture the
     * write opened — the MIX page's own key, closed by the knob's release. */
    resetUndoGroups();
    const before = readMix(10).gain;
    mixerKnobTouch(2, true);
    mixerKnobTurn(2, -20);
    ok('page 2 knob 3 moved the fader', readMix(10).gain < before);
    eq('as track 11\'s gesture', openGroupKey(), 'mix:10:gain');
    mixerKnobTouch(2, false);
    ok('the release closes it', !groupOpen());
    mixerJog(-1);
    eq('back on page 1', owner.page.keyAt(2), 't3');
    appState.currentView = VIEW_CHAIN;
}

/* ── the meters ───────────────────────────────────────────────────────────── */
_log('\nTest: `mtr` decodes onto the fader travel');
{
    eq('byte 0 is silence', byteToFrac(0), 0);
    ok('byte 121 (0 dB) sits on unity', Math.abs(byteToFrac(121) - UNITY_FRAC) < 1e-6);
    ok('half-dB steps rise', byteToFrac(122) > byteToFrac(121));
    const raw = '79' + '00' + 'ff' + '00'.repeat(45);
    const lv = decodeMeter(raw);
    ok('track 1: fader at unity, L silent, R pinned high',
       Math.abs(lv[0] - UNITY_FRAC) < 1e-6 && lv[1] === 0 && lv[2] === 1);
    eq('a short field reads as silence, not last tick', decodeMeter('79')[3], 0);
    seqState.mixMeter = '';
}

/* ── the hold ─────────────────────────────────────────────────────────────── */
_log('\nTest: hold Session (latched) opens the mixer; release returns');
{
    const realNow = Date.now;
    let t = 10_000; Date.now = () => t;
    const press = () => seqHandleMidi([0xB0, 50, 127], false);
    const release = () => seqHandleMidi([0xB0, 50, 0], false);
    const reset = () => { resetSeqState(); resetMomentary(); resetMixerPage(); appState.currentView = VIEW_CHAIN; };

    reset(); seqState.sessionMode = true;
    press();
    t += MIXER_HOLD_MS - 50; mixerHoldTick(t);
    ok('not before the hold matures', !mixerPageActive());
    t += 50; mixerHoldTick(t);
    ok('opens at MIXER_HOLD_MS', mixerPageActive());
    t += 2000; release();
    ok('release closes it', !mixerPageActive());
    eq('back on the view it opened from', appState.currentView, VIEW_CHAIN);
    eq('and still in Session — the release is not a tap', seqState.sessionMode, true);

    reset(); seqState.sessionMode = true;
    press(); t += 100; release(); mixerHoldTick(t + 1000);
    eq('a tap still toggles Session -> Note', seqState.sessionMode, false);
    ok('and never opens the mixer', !mixerPageActive());

    reset(); seqState.sessionMode = false;
    press(); t += 1000; mixerHoldTick(t);
    ok('an unlatched hold is the Session peek, not the mixer', !mixerPageActive());
    release();
    eq('the peek reverts to Note', seqState.sessionMode, false);

    reset(); seqState.sessionMode = true;
    press();
    seqHandleMidi([0x90, 17, 127], false);   // step 2 under the held Session: a track select
    seqHandleMidi([0x80, 17, 0], false);
    t += 1000; mixerHoldTick(t);
    ok('a step pressed under the hold makes it a modifier press', !mixerPageActive());
    release();

    ok('mixerRelease with nothing open says so', mixerRelease() === false);
    reset();
    Date.now = realNow;
}

}
