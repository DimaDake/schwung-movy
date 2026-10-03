/* drum-focus.mjs — movy owns the drum focus under SCHWUNG pages (plan
 * 2026-09-30-drum-modules-schwung-pages.md, Phase 4, D8).
 *
 * The module's own focus reports — `focus_param` on a sibling rack,
 * `child_index_param` on a template rack — must never move the page or re-key
 * its cells; only a physical press (or the controller's own picker) does. Each
 * case below stages the module moving its focus by itself, as 9w9 does on every
 * note-on while Move's clock is stopped and mrdrums does with auto-select, and
 * asserts the page stayed on movy's pad. Real controller, real dumped contract.
 *
 * Run by browser-test/logic.mjs. SKIPPED without a SCHWUNG checkout.
 */

import { join, resolve } from 'node:path';
import { schwungLibAvailable, bootModel, settleModel, ok, eq, fail, _log, env, MOCK_SYNTHS, appState, portFor,
         setSchwungGridMode, schwungGridReload, schwungPageFor } from './harness.mjs';
import { dumpEntry, dumpFixture } from '../dump-fixture.mjs';
import { serveModuleFiles } from './drum-automation.mjs';

export async function run() {

if (!schwungLibAvailable()) {
    _log('\nlogic: drum focus — SKIPPED (no param_pages; set SCHWUNG=)');
    return;
}

const pp = join(resolve(process.env.SCHWUNG), 'src', 'shared', 'param_pages');
const { voicesOf } = await import(join(pp, 'voices.mjs'));
const { resolveChildKey } = await import(join(pp, 'child_key.mjs'));
const { automationFor } = await import('../../dist/esm/app/automated-keys.js');
const { padFocusWrite } = await import('../../dist/esm/keyboard/drum-handler.js');

const prevModels = appState.trackModels[0];
/* The page exactly as the app builds it for track 0 — the matrix's setup. */
function boot(id) {
    const restoreFs = serveModuleFiles(dumpEntry(id));
    setSchwungGridMode('page');
    schwungGridReload();
    const fixture = dumpFixture(id);
    const model = settleModel(bootModel(fixture));
    appState.trackModels[0] = [model];
    env.setParams(fixture);
    const p = schwungPageFor(0, 'synth', null, automationFor);
    for (let i = 0; i < 12 * 60 && !p.ready; i++) p.tick();
    if (!p.ready) fail(`drum focus: ${id} page never resolved`);
    return { p, model, fixture, restoreFs };
}
const ticks = (p, n) => { for (let i = 0; i < n; i++) p.tick(); };
/* The module reporting a focus of its own. Through the track's port, which is
 * what the page reads from: the port remembers movy's press write, so the
 * mock's param store alone would never reach the controller. */
const moduleSays = (key, value) => portFor(0).setParam('synth:' + key, value);
const done = (restoreFs) => {
    restoreFs();
    appState.trackModels[0] = prevModels;
    schwungGridReload();
    setSchwungGridMode(null);
    env.setParams(MOCK_SYNTHS.test16);
};

_log('\nTest: 9w9 — the module moving its own focus does not turn the page (D8)');
{
    const { p, fixture, restoreFs } = boot('9w9');
    const hier = JSON.parse(fixture['synth:ui_pages']);
    const voices = voicesOf(hier);
    const fp = hier.focus_param;
    ok('9w9 declares a focus param and voices', !!fp && voices.length >= 5);
    ok('a finger on pad 3 turns to its voice', p.focusVoice(3));
    ticks(p, 4);
    const at = p.pageIndex;
    eq('...the voice’s page', p.ctl.pages[at].level, voices[2].level);
    /* A sequenced hit on pad 5: 9w9 moves `focus_voice` and bumps its count,
     * answering "<count>:<level>" — a fresh token the controller would follow. */
    moduleSays(fp, '9:' + voices[4].level);
    ticks(p, 80);
    eq('a sequenced note does not move the page', p.pageIndex, at);
    ok('a finger on pad 5 does', p.focusVoice(5));
    ticks(p, 4);
    eq('...to pad 5’s voice', p.ctl.pages[p.pageIndex].level, voices[4].level);
    done(restoreFs);
}

_log('\nTest: simian — the module’s index report does not re-key the pad’s page (D8)');
{
    const { p, restoreFs } = boot('simian');
    p.focusVoice(3);
    ticks(p, 80);
    const pg = p.ctl.pages[p.pageIndex];
    const cip = pg.childLevel.child_index_param;
    const slot = pg.keys.findIndex((k) => k && k !== cip);
    const want = (i) => resolveChildKey(pg.childLevel, i, pg.keys[slot]);
    eq('the press focused pad 3', p.ctl.childIndexOf(pg.level), 2);
    /* The module auto-selects pad 9 on a note — its index param says so. */
    moduleSays(cip, '9');
    ticks(p, 80);
    eq('the module’s report does not move the controller’s pad', p.ctl.childIndexOf(pg.level), 2);
    eq('...and the knob still binds pad 3’s key', p.knobParamInfo(slot).ioKey, want(2));
    /* Every level sharing the index param is on the same pad: simian's
     * `pad_noise` and `pad_mix` name `ui_current_voice` too. */
    const other = p.ctl.pages.findIndex((q) => q && q.childLevel && q.level !== pg.level
        && q.childLevel.child_index_param === cip && Array.isArray(q.keys));
    ok('simian has a second level on the same index param', other >= 0);
    p.goToPage(other);
    ticks(p, 80);
    const q = p.ctl.pages[other];
    const s2 = q.keys.findIndex((k) => k && k !== cip);
    eq('...and it edits pad 3 as well', p.knobParamInfo(s2).ioKey, resolveChildKey(q.childLevel, 2, q.keys[s2]));
    /* A write movy makes — the picker's, or a config rack's press — is focus. */
    p.focusWritten('synth:' + cip, '7');
    ticks(p, 80);
    eq('a focus WRITE moves it', p.ctl.childIndexOf(q.level), 6);
    done(restoreFs);
}

_log('\nTest: sophie — its config’s press write is the focus, its reports are not (D8)');
{
    const { p, model, restoreFs } = boot('sophie');
    const fw = padFocusWrite(model.getDrumConfig(), 5);
    eq('sophie’s config press writes focused_pad = 5', fw && fw.key + '=' + fw.value, 'focused_pad=5');
    p.focusWritten('synth:' + fw.key, fw.value);
    moduleSays('focused_pad', '2');
    ticks(p, 80);
    const pg = p.ctl.pages[p.pageIndex];
    ok('sophie’s page is a child level', !!(pg && pg.childLevel));
    eq('the page edits movy’s pad 5, not the module’s pad 2', p.ctl.childIndexOf(pg.level), 4);
    done(restoreFs);
}

_log('\nTest: mrdrums — an alias page reads and writes movy’s pad, not the module’s (D8)');
{
    const { p, model, restoreFs } = boot('mrdrums');
    const ps = model.getDrumConfig().padScoping;
    const idx = p.ctl.pages.findIndex((pg) => Array.isArray(pg.keys)
        && pg.keys.some((k) => k && k.startsWith(ps.aliasPrefix) && !/sample|file|path/.test(k)));
    ok('mrdrums has an alias page', idx >= 0);
    p.goToPage(idx);
    ticks(p, 4);
    const slot = p.ctl.pages[idx].keys.findIndex((k) => k && k.startsWith(ps.aliasPrefix)
        && p.knobParamInfo(p.ctl.pages[idx].keys.indexOf(k))?.automatable);
    const alias = p.ctl.pages[idx].keys[slot];
    const suf = alias.slice(ps.aliasPrefix.length);
    const k3 = 'synth:p03_' + suf, k7 = 'synth:p07_' + suf, ka = 'synth:' + alias;
    model.updateDrumPad(3, 3);
    /* The module auto-selected pad 7 — the alias answers pad 7's value. */
    env.params['synth:ui_current_pad'] = '7';
    env.params[k3] = '0.2'; env.params[k7] = '0.9'; env.params[ka] = '0.9';
    const sets = [];
    const realSet = globalThis.shadow_set_param;
    globalThis.shadow_set_param = (s, k, v) => { sets.push(k); return realSet(s, k, v); };
    try {
        ticks(p, 80);
        p.knobTurn(slot, 4);
        ticks(p, 20);
    } finally { globalThis.shadow_set_param = realSet; }
    ok(`a turn writes pad 3’s key (${k3})`, sets.includes(k3));
    ok('...never the alias or the module’s pad', !sets.includes(ka) && !sets.includes(k7));
    done(restoreFs);
}
}
