/* browser-test/logic/page-automation.mjs — SP-36: what a delegated page shows
 * for a parameter a LANE is driving.
 *
 * The complaint this grades, in the reporter's words: while the transport
 * plays, an automated parameter's knob JUMPS — the pointer chases the lane —
 * and it should instead "stay where you set it", with the automation showing as
 * "a mark moving across the knob, like with lfo".
 *
 * Schwung's controller already draws exactly that, for any key movy reports as
 * modulated: the POINTER takes `<key>:base` and a 5-pixel plus rides the arc at
 * `<key>:effective` (`page_controller.mjs`, `drawModDot`). Under `page` both of
 * those reads come back to movy's own io, and the port has only ONE value for
 * an automated parameter — the one the lane is driving it to. So the three
 * things this suite holds are the three things movy had to supply:
 *
 *   1. the key is reported modulated at all (no mark otherwise),
 *   2. `:base` answers movy's own record of what the user dialled in,
 *   3. `:effective` answers the live value, AND the page notices it moved —
 *      `knobLevels()` is the only thing that asks for the frame back
 *      (`app/page-poll.ts`), so a mark whose value moves while the levels stand
 *      still is drawn once and then freezes.
 *
 * Run by browser-test/logic.mjs.
 */

import { schwungLibAvailable, bootModel, eq, ok, _log,
         env, portFor, MOCK_SYNTHS, setSchwungGridMode, schwungGridReload,
         resetSeqEngine } from './harness.mjs';

export async function run() {

const { resetLaneBases, laneBase, seedFromEngine } =
    await import('../../dist/esm/seq/automation-base.js');

/* ── the mirror itself: host-only, and it runs in every arm ───────────────── */

_log('\nlogic: the base an automated parameter reverts to (SP-36)');
{
    const { resetAutomation, assignLane, syncLabelsFromEngine } =
        await import('../../dist/esm/seq/automation.js');
    resetAutomation(); resetSeqEngine(); resetLaneBases();

    const info = { gi: 0, key: 'cutoff', ioKey: 'cutoff', target: 'synth',
                   value: 0.75, min: 0, max: 1, type: 'float', automatable: true };
    eq('a lane is assigned', assignLane(0, 0, info, () => true), 0);
    /* The value the user had dialled in AT THE ASSIGNMENT, in the parameter's
     * own units — not the 7 bits the wire carries. */
    eq('and the base is recorded exactly, not through norm7', laneBase(0, 0), 0.75);

    /* The one case a mirror cannot cover: a Set the engine restored, whose
     * lanes the UI rebuilds from `alabels` having never sent their bases. */
    resetLaneBases();
    eq('a restored lane starts with no base', laneBase(0, 0), null);
    seedFromEngine('64.-.-.-.-.-.-.-', (t, l) => (t === 0 && l === 0 ? { min: 0, max: 1 } : null));
    ok('and the engine’s abases seed it', Math.abs((laneBase(0, 0) ?? -1) - 64 / 127) < 1e-9);

    /* A seed never overwrites what movy holds exactly — the same number after a
     * 7-bit round trip is a blurrier answer, not a newer one. */
    resetLaneBases();
    assignLane(0, 1, { ...info, gi: 1, key: 'res', ioKey: 'res', value: 0.75 }, () => true);
    seedFromEngine('-.0.-.-.-.-.-.-', () => ({ min: 0, max: 1 }));
    eq('and it does not overwrite a base movy already holds', laneBase(0, 1), 0.75);

    /* A lane that comes back pointing at a DIFFERENT parameter is a different
     * parameter on the same slot: its predecessor's base would put the pointer
     * at a value this one never held. */
    syncLabelsFromEngine('-.synth:other.-.-.-.-.-.-', () => {}, () => ({ min: 0, max: 1, type: 'float' }));
    eq('a lane retargeted by a sync drops the old base', laneBase(0, 1), null);

    resetAutomation(); resetLaneBases();
}

if (!schwungLibAvailable()) {
    _log('\nlogic: page automation — SKIPPED (no param_pages; set SCHWUNG=)');
    return;
}

/* ── the page: pointer, mark, and the frame the mark needs ───────────────── */

const { pageOwnerOf } = await import('../../dist/esm/app/page-owner.js');
const { resetAutomation, assignLane } = await import('../../dist/esm/seq/automation.js');
const { seqState } = await import('../../dist/esm/seq/state.js');

_log('\nlogic: an automated parameter under `page` — the pointer keeps the base');
{
    setSchwungGridMode('page');
    schwungGridReload();
    resetAutomation(); resetSeqEngine(); resetLaneBases();

    /* One float parameter, declared by the module itself so the plan is
     * Schwung's own and the cell is a KNOB (the widget that carries the mark). */
    const model = bootModel({
        'synth:name': 'Mock',
        'synth:ui_hierarchy': JSON.stringify({
            levels: { root: { name: 'Main', knobs: ['cutoff'], params: ['cutoff'] } },
        }),
        'synth:chain_params': JSON.stringify([
            { key: 'cutoff', name: 'Cutoff', type: 'float', min: 0, max: 1, step: 0.01, default: 0.5 },
        ]),
        'synth:cutoff': '0.50',
    });
    for (let i = 0; i < 20; i++) model.tick();
    const owner = pageOwnerOf(model);
    const page = owner.page;
    ok('the page is delegated', !!page);
    if (!page) return;
    for (let i = 0; i < 12 * 60 && !page.ready; i++) page.tick();
    eq('the page resolved', page.ready, true);

    /* The lane, assigned the way the gesture assigns it: the base is 0.50,
     * which is what the port holds right now. Active, because that is the test
     * movy's own renderer applies for its automation dot. */
    const info = page.knobParamInfo(0);
    eq('the page names the parameter the lane will drive', info && info.ioKey, 'cutoff');
    eq('a lane takes it', assignLane(0, 0, info, () => true), 0);
    seqState.autoActive |= 1;

    /* PLAYBACK, as the port sees it: the engine emitted the lane's value, the
     * chain applied it inside the DSP, and a read of the plain key now answers
     * the LANE. There is no second value to read — which is the whole item. */
    const port = portFor(0);
    /* WHAT THE `:effective` ANSWER IS FOR, and it is not the dot — the
     * controller already falls back to the plain key, so the dot appears either
     * way (measured: removing the answer reddens nothing below). It is the
     * READ. `:effective` is a key the engine does not serve, a null is never
     * cached (`schwung-page-cache.ts`), and the controller asks for one
     * modulated key EVERY tick — so with no answer every tick spends a live
     * blocking engine GET on a key that will never answer. That is the ~3.4 ms
     * round trip SP-26 exists to remove, back once per tick. */
    const realGet = port.getParam.bind(port);
    let effAsks = 0;
    port.getParam = (k) => { if (String(k).endsWith(':effective')) effAsks++; return realGet(k); };
    port.setParam('synth:cutoff', '0.90');
    for (let i = 0; i < 40; i++) page.tick();
    eq('the driven value costs no round trip: `:effective` never reaches the port',
       effAsks, 0);
    port.getParam = realGet;

    const key = 'cutoff';
    ok('the key reports as modulated, so the cell is marked at all',
       !!page.ctl.isModulatedCached(key));
    eq('the POINTER keeps the base the user dialled in',
       String(page.ctl.state.values[key]), String(0.5));
    eq('and the MARK is at the value the lane is driving',
       String(page.ctl.state.modValues[key]), '0.90');

    /* The frame the mark needs. `knobLevels()` is what `app/page-poll.ts` reads
     * to decide whether to repaint, and the base does not move while a lane
     * plays — so if the levels answered the base, the mark would be drawn once
     * and freeze there. Teeth: point `knobLevels` back at `state.values` and
     * this pair goes flat. */
    const before = page.knobLevels()[0];
    port.setParam('synth:cutoff', '0.10');
    for (let i = 0; i < 40; i++) page.tick();
    const after = page.knobLevels()[0];
    ok('the levels follow the driven value, which is what asks for the frame back',
       before !== null && after !== null && Math.abs(before - after) > 0.5);
    eq('and the pointer STILL has not moved', String(page.ctl.state.values[key]), String(0.5));

    /* A turn under the page is an edit of the base — the pointer follows the
     * hand, and does not snap back when the next `:base` read comes round. */
    page.knobTurn(0, 4);
    for (let i = 0; i < 40; i++) page.tick();
    ok('a turn moves the base with it',
       Math.abs(parseFloat(String(page.ctl.state.values[key])) - 0.5) > 1e-9);

    seqState.autoActive = 0;
    resetAutomation(); resetLaneBases();
    schwungGridReload();
    setSchwungGridMode(null);
    env.setParams(MOCK_SYNTHS.test16);
}

}
