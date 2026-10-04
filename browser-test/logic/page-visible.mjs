/* page-visible.mjs — a module's `visible_if` gates hold on its Schwung pages.
 *
 * With no `visible` hook the planner fails OPEN, so every gated level showed:
 * DR32 planned 52 pages (every engine's) where Schwung plans the 8-11 of the
 * focused pad's engine. Real controller, DR32's dumped contract; the two gate
 * keys the DSP derives per pad (`ui_engine`, `ui_family`) are staged in the
 * env, since the dump never read them.
 *
 * Run by browser-test/logic.mjs. SKIPPED without a SCHWUNG checkout.
 */

import { schwungLibAvailable, bootModel, settleModel, ok, eq, fail, _log, env, MOCK_SYNTHS, appState,
         setSchwungGridMode, schwungGridReload, schwungPageFor } from './harness.mjs';
import { dumpEntry, dumpFixture } from '../dump-fixture.mjs';
import { serveModuleFiles } from './drum-automation.mjs';

export async function run() {

if (!schwungLibAvailable()) {
    _log('\nlogic: page visible_if — SKIPPED (no param_pages; set SCHWUNG=)');
    return;
}
_log('\nlogic: page visible_if (DR32 engine pages)');

const { automationFor } = await import('../../dist/esm/app/automated-keys.js');
const prevModels = appState.trackModels[0];

function boot(gates) {
    const restoreFs = serveModuleFiles(dumpEntry('dr32'));
    setSchwungGridMode('page');
    schwungGridReload();
    const fixture = { ...dumpFixture('dr32') };
    for (const [k, v] of Object.entries(gates)) {
        if (v === null) delete fixture['synth:' + k]; else fixture['synth:' + k] = v;
    }
    const model = settleModel(bootModel(fixture));
    appState.trackModels[0] = [model];
    env.setParams(fixture);
    const p = schwungPageFor(0, 'synth', null, automationFor);
    for (let i = 0; i < 12 * 60 && !p.ready; i++) p.tick();
    if (!p.ready) fail('page visible_if: dr32 page never resolved');
    ticks(p, 4);
    return { p, restoreFs };
}
const ticks = (p, n) => { for (let i = 0; i < n; i++) p.tick(); };
const names = (p) => p.ctl.pages.map((x) => String(x.name));
const has = (p, n) => names(p).some((x) => x === n || x.startsWith(n + ' - '));
const keysOn = (p, n) => (p.ctl.pages.find((x) => x.name === n)?.keys || []).filter(Boolean);
const done = (restoreFs) => {
    restoreFs();
    appState.trackModels[0] = prevModels;
    schwungGridReload();
    setSchwungGridMode(null);
    env.setParams(MOCK_SYNTHS.test16);
};

{
    const { p, restoreFs } = boot({ ui_engine: '0', ui_family: '0' });
    eq('sample pad: only its own pages', names(p).join('|'),
       'Category|Kit|Pad|Shape|Shape - 2|Mix|Stereo|Master|Resample');
    eq('sample pad: the seat counts the same pages', p.pageCount, 9);

    /* Pad 5 runs an urchin drum. The DSP derives both gates from the focused
     * pad; nothing in the declared contract moves, so only the controller's
     * gate lane (marked due by the focus move) can see it, and the evaluator
     * must answer from what that lane read. */
    env.params['synth:ui_engine'] = '2';
    env.params['synth:ui_family'] = '2';
    p.focusVoice(5);
    let waited = 0;
    for (; waited < 60 && has(p, 'Shape'); waited++) p.tick();
    _log(`    (re-planned after ${waited} ticks)`);
    ok('engine change re-plans: Shape gone', !has(p, 'Shape'));
    ok('engine change re-plans: urchin pages in', ['Drum', 'Shell', 'Chop', 'Media'].every((n) => has(p, n)));
    ok('engine change re-plans: no other engine', !has(p, 'Tone') && !has(p, 'Voice'));
    done(restoreFs);
}
{
    /* CELL gates use the same hook: 9W9's Voice page shows the kick's own
     * knobs only on a kick lane (ui_engine 5), the snare's only on 6. */
    const kick = boot({ ui_engine: '5', ui_family: '3' });
    const kk = keysOn(kick.p, 'Voice');
    ok('9W9 kick lane: kick knobs', kk.includes('n9_bd_attack') && !kk.includes('n9_sd_snappy'));
    eq('9W9 kick lane: one Voice page', names(kick.p).filter((n) => n.startsWith('Voice')).length, 1);
    done(kick.restoreFs);
    const snare = boot({ ui_engine: '6', ui_family: '3' });
    const sk = keysOn(snare.p, 'Voice');
    ok('9W9 snare lane: snare knobs', sk.includes('n9_sd_snappy') && !sk.includes('n9_bd_attack'));
    done(snare.restoreFs);
}
{
    /* Never hide what was never read: an unanswered gate fails open, as
     * Schwung's evaluator does. */
    const { p, restoreFs } = boot({ ui_engine: null, ui_family: null });
    ok('unread gate fails open', has(p, 'Tone') && has(p, 'Shape') && has(p, 'Voice'));
    done(restoreFs);
}

}
