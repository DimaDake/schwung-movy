/* browser-test/logic/probe.mjs — the device harness's ViewModel probe.
 *
 * Run by browser-test/logic.mjs. The probe's response shape is a CONTRACT the
 * device scenarios parse, so pinning it here means a rename in viewmodel.ts
 * fails locally instead of on hardware.
 */
import { ok, eq, _log } from './harness.mjs';
import { answer, noteRender, setProbeDeps, _resetForTest }
    from '../../dist/esm/test/probe.js';

const vmFixture = (over = {}) => ({
    moduleName: 'plaits',
    bankIndex: 2,
    bankCount: 5,
    automationHeld: true,
    rows: [
        [{ shortName: 'DCAY', displayValue: '69%', automated: true, touched: true,
           modulated: false, renderStyle: 'arc' }, null, null, null],
        [null, null, null, null],
    ],
    ...over,
});

export async function run() {
_log('\nTest: device probe');
{
    _resetForTest();
    setProbeDeps({
        renderer:      () => 'MOVY',
        lanesForTrack: (t) => (t === 0 ? ['octave_transpose', 'decay'] : []),
        activeTrack:   () => 0,
        parked:        () => false,
        setGridMode:   () => {},
    });

    const tick0 = JSON.parse(answer(JSON.stringify({ key: 'tick' })));
    eq('renderSeq starts at zero', tick0.renderSeq, 0);

    noteRender(vmFixture());
    const tick1 = JSON.parse(answer(JSON.stringify({ key: 'tick' })));
    eq('renderSeq advances per render', tick1.renderSeq, 1);
    noteRender(vmFixture());
    eq('renderSeq advances again',
        JSON.parse(answer(JSON.stringify({ key: 'tick' }))).renderSeq, 2);

    const page = JSON.parse(answer(JSON.stringify({ key: 'page' })));
    eq('page reports the held-step state', page.held, true);
    eq('page reports the bank index', page.pageIndex, 2);
    eq('page reports the bank count', page.pageCount, 5);
    eq('page reports the renderer', page.renderer, 'MOVY');
    eq('page always reports eight cells', page.cells.length, 8);
    eq('cell carries the short name', page.cells[0].name, 'DCAY');
    eq('cell carries the display value', page.cells[0].value, '69%');
    eq('cell carries the automation dot', page.cells[0].automated, true);
    eq('cell carries the touched flag', page.cells[0].touched, true);
    ok('an empty slot is null, not a blank cell', page.cells[1] === null,
        JSON.stringify(page.cells[1]));

    const auto = JSON.parse(answer(JSON.stringify({ key: 'auto' })));
    eq('auto reports the active track', auto.track, 0);
    eq('auto reports the lane registry', auto.lanes.join(','), 'octave_transpose,decay');

    /* An empty registry is the bug the device suite's P3 check exists to catch,
     * so it must be reported as empty rather than omitted. */
    setProbeDeps({
        renderer: () => 'PAGE', lanesForTrack: () => [], activeTrack: () => 1,
        parked: () => true, setGridMode: () => {},
    });
    const empty = JSON.parse(answer(JSON.stringify({ key: 'auto' })));
    eq('an empty lane registry reports as empty', empty.lanes.length, 0);
    eq('tick reports the parked state', JSON.parse(answer(JSON.stringify({ key: 'tick' }))).parked, true);
    eq('page reflects a renderer change',
        JSON.parse(answer(JSON.stringify({ key: 'page' }))).renderer, 'PAGE');

    const bad = JSON.parse(answer(JSON.stringify({ key: 'nope' })));
    ok('an unknown key answers with an error, not a throw', typeof bad.error === 'string', bad.error);
    const torn = JSON.parse(answer('{not json'));
    ok('malformed json answers with an error, not a throw', typeof torn.error === 'string', torn.error);

    let gridArg = 'unset';
    setProbeDeps({
        renderer: () => 'DRAW', lanesForTrack: () => [], activeTrack: () => 0,
        parked: () => false, setGridMode: (m) => { gridArg = m; },
    });
    const verb = JSON.parse(answer(JSON.stringify({ verb: 'setGridMode', arg: 'PAGE' })));
    eq('setGridMode reaches the renderer override', gridArg, 'PAGE');
    eq('setGridMode answers with the resulting renderer', verb.renderer, 'DRAW');

    /* No render yet must be distinguishable from a page with no cells. */
    _resetForTest();
    const none = JSON.parse(answer(JSON.stringify({ key: 'page' })));
    ok('page before any render reports an error', typeof none.error === 'string', none.error);
}
}
