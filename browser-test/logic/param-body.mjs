/* browser-test/logic/param-body.mjs — the knob body is Schwung's page or
 * nothing.
 *
 * SP-58. `app/param-body.ts` is the one place the body is chosen, so a render
 * site cannot draw something other than the page its knobs write through.
 *
 * Run by browser-test/logic.mjs.
 */

import { readFileSync, ok, eq, _log } from './harness.mjs';

export async function run() {

const { paramBodyFor, lastParamBody, lastSchwungPage, lastDrawnCells } =
    await import('../../dist/esm/app/param-body.js');

const owner = (page) => ({
    ref: { track: 0, componentKey: 'snd0' }, page, reason: '', pageIndex: 0, pageCount: 1,
    poll() {}, knobParamInfo() { return null; }, changePage() {}, goToPage() {},
});

{
    _log('\nlogic: param body — Schwung\'s page, or nothing while it loads');
    const schwung = () => {};
    ok("Schwung's body is passed through as-is", paramBodyFor(owner(null), schwung) === schwung);
    eq('...and the probe says so', lastParamBody(), 'schwung');

    /* A page still loading draws NO rows — not a guess at them. */
    let drew = false;
    const realFill = globalThis.fill_rect, realPrint = globalThis.print;
    globalThis.fill_rect = () => { drew = true; };
    globalThis.print = () => { drew = true; };
    paramBodyFor(owner(null), undefined)();
    globalThis.fill_rect = realFill; globalThis.print = realPrint;
    eq('a loading page draws nothing', drew, false);
    eq('...and the probe says none', lastParamBody(), 'none');
}

{
    _log('\nlogic: param body — the probe reads the Schwung page that was drawn');
    /* The device's page-dive sweep pages Schwung's grid with the jog, so the
     * keys under the knobs have to come from the page that DREW them. */
    const page = { pageIndex: 1, pageCount: 7,
                   keyAt: (s) => ['sample_start', 'loop_mode', 'sample_path'][s] ?? null };
    paramBodyFor(owner(page), () => {});
    eq('a Schwung-drawn frame reports that page\'s keys and position',
       JSON.stringify(lastSchwungPage()),
       JSON.stringify({ pageIndex: 1, pageCount: 7,
                        keys: ['sample_start', 'loop_mode', 'sample_path',
                               null, null, null, null, null] }));
    paramBodyFor(owner(page), undefined);
    eq('a loading frame reports none', lastSchwungPage(), null);
}

{
    _log('\nlogic: param body — the probe\'s cells follow a lane the automation layer writes');
    /* A held step's turn is consumed by the automation layer and never reaches
     * the controller, so the lane's held value is what the cell shows. */
    const page = { pageIndex: 0, pageCount: 1, ctl: { state: { touched: -1 } },
                   keyAt: (s) => ['cutoff', 'reso'][s] ?? null,
                   labelAt: (s) => ['Cutoff', 'Reso'][s] ?? null,
                   knobLevels: () => [0.25, 0.5, null, null, null, null, null, null],
                   marks: () => 0, chrome: () => ({ header: null }) };
    const auto = { assignedLanes: 1, activeLanes: 1, held: true, poolFull: false,
                   heldValues: new Map([[0, 0.9]]), liveValues: new Map(),
                   laneForKey: (k) => (k === 'cutoff' ? 0 : -1) };
    paramBodyFor(owner(page), () => {}, auto);
    const cells = lastDrawnCells();
    eq('the locked cell is touched, with the held value',
       cells[0].touched + ':' + cells[0].value + ':' + cells[0].automated, 'true:0.9:true');
    eq('its neighbour is neither', cells[1].touched + ':' + cells[1].automated, 'false:false');
    paramBodyFor(owner(page), () => {});
    eq('without an automation view the cell reads its level', lastDrawnCells()[0].value, '0.250');
}

{
    _log('\nlogic: param body — every app render site goes through the one door');
    /* Structural, because the defect this exists for was a site that was never
     * written to ask. */
    const code = readFileSync('src/app/tick.ts', 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
    const calls = [...code.matchAll(/render(?:Knobs|Chain)View\(([\s\S]*?)\);/g)];
    ok('tick.ts has render sites to check', calls.length >= 6);
    const bare = calls.filter((m) => !m[1].includes('paramBodyFor('));
    eq('no render site passes a body that skipped paramBodyFor', bare.length, 0);
}

}
