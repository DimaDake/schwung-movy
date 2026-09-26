/* browser-test/logic/param-body.mjs — movy's own knob body never draws over a
 * page Schwung owns.
 *
 * SP-58. The master chain view drew movy's body while its knobs already wrote
 * through Schwung's page: the render site was never asked for Schwung's body,
 * so the fallback ran and nothing said so. `app/param-body.ts` is the one place
 * the choice is made, and a live delegated owner reaching the fallback is a
 * defect by definition — this pins that it is reported, and that the three
 * legitimate fallbacks are not.
 *
 * Run by browser-test/logic.mjs.
 */

import { readFileSync, ok, eq, _log } from './harness.mjs';

export async function run() {

const { paramBodyFor, movyBodyUnderPage, resetMovyBodyUnderPage } =
    await import('../../dist/esm/app/param-body.js');

const owner = (claimed, delegated) => ({
    ref: { track: 0, componentKey: 'snd0' }, claimed, delegated,
    page: null, reason: '', pageIndex: 0, pageCount: 1,
    poll() {}, knobParamInfo() { return null; }, changePage() {},
});
const vm = { rows: [[], []] };

{
    _log('\nlogic: param body — the fallback never draws over a live page');
    resetMovyBodyUnderPage();

    const schwung = () => {};
    ok("Schwung's body is passed through as-is",
       paramBodyFor(owner(true, true), vm, schwung) === schwung);
    eq('...and that is not a trip', movyBodyUnderPage().count, 0);

    /* The three legitimate fallbacks: mode off / unclaimed, and the window
     * before a claimed page's contract resolves. */
    ok('an unclaimed owner gets movy\'s body',
       typeof paramBodyFor(owner(false, false), vm, undefined) === 'function');
    paramBodyFor(owner(true, false), vm, undefined);
    eq('neither unclaimed nor not-yet-ready trips', movyBodyUnderPage().count, 0);

    paramBodyFor(owner(true, true), vm, undefined);
    eq('a LIVE delegated owner reaching the fallback trips', movyBodyUnderPage().count, 1);
    eq('...and names the page it happened on', movyBodyUnderPage().last, '0:snd0');
    resetMovyBodyUnderPage();
}

{
    _log('\nlogic: param body — every app render site goes through the one door');
    /* Structural, because the defect this exists for was a site that was never
     * written to ask. A renderer called without `paramBodyFor` gets movy's body
     * by default — the optional argument survives only for screenshot.mjs. */
    const code = readFileSync('src/app/tick.ts', 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
    const calls = [...code.matchAll(/render(?:Knobs|Chain)View\(([\s\S]*?)\);/g)];
    ok('tick.ts has render sites to check', calls.length >= 6, `found ${calls.length}`);
    const bare = calls.filter((m) => !m[1].includes('paramBodyFor('));
    eq('no render site passes a body that skipped paramBodyFor', bare.length, 0);
}

}
