/* drum-racks.mjs — which rack a drum module is, and how wide it sits on the
 * grid (plan 2026-09-30-drum-modules-schwung-pages.md, Phases 6 and 7).
 *
 *   D4   a movy_config (bundled or shipped) always wins over a declaration;
 *   D9   a child level with `child_index_param` is a rack with no config, an
 *        explicit `pad_layout: "chromatic"` never is;
 *   D10  a rack of more than 16 pads is 8 wide over all 32 pads.
 *
 * The pure halves run everywhere; the module halves boot the real controller
 * on the dumped contracts (sophie with and without its config, 9w9 under its
 * bundled config, dr32) and are SKIPPED without a SCHWUNG checkout.
 *
 * Run by browser-test/logic.mjs.
 */

import { join, resolve } from 'node:path';
import { schwungLibAvailable, bootModel, settleModel, ok, eq, fail, _log, env, MOCK_SYNTHS, appState, portFor,
         setSchwungGridMode, schwungGridReload, schwungPageFor } from './harness.mjs';
import { dumpEntry, dumpFixture } from '../dump-fixture.mjs';
import { serveModuleFiles } from './drum-automation.mjs';

export async function run() {

const { effectiveDrumConfig, padVoices } = await import('../../dist/esm/model/drum-declared.js');
const { drumCols, drumPadOfPhys, drumNoteOfPhys, drumNoteOfPad, physPadOfDrumPad } =
    await import('../../dist/esm/keyboard/drum-grid.js');
const { drumPadLedColor } = await import('../../dist/esm/keyboard/leds.js');

_log('\nTest: a movy_config always wins over a declared rack (D4)');
{
    const declared = { layout: 'drums', focusParam: 'ui_focus_level', pressParam: null,
                       voices: [{ note: 36, name: 'BD', level: 'bd' }, { note: 38, name: 'SD', level: 'sd' }] };
    const config = { padCount: 11, padNoteStart: 36, rawMidi: false };
    eq('the config is the rack, untouched', effectiveDrumConfig(declared, config), config);
    const own = effectiveDrumConfig(declared, null);
    eq('with no config the declaration is', JSON.stringify(own.padNotes), '[36,38]');
    eq('...its focus param written a level name', JSON.stringify(own.padFocusValues), '["bd","sd"]');
    eq('a chromatic declaration is no rack', effectiveDrumConfig({ ...declared, layout: 'chromatic' }, null), null);
    eq('nor is silence', effectiveDrumConfig(null, null), null);
}

_log('\nTest: a pad is the voice it SOUNDS, matched by note (D4)');
{
    /* 9w9 declares its last two voices 46, 45; its bundled config plays 36 + i. */
    const voices = [36, 37, 38, 39, 40, 41, 42, 43, 44, 46, 45].map((note, i) => ({ note, name: 'v' + i }));
    const pv = padVoices({ padCount: 12, padNoteStart: 36, rawMidi: false }, voices);
    eq('pad 10 (note 45) is the voice declaring 45', pv[9] && pv[9].name, 'v10');
    eq('pad 11 (note 46) is the voice declaring 46', pv[10] && pv[10].name, 'v9');
    eq('a pad no voice declares has none', pv[11], null);
}

_log('\nTest: more than 16 pads ⇒ the rack is 8 wide over all 32 pads (D10)');
{
    const rack = (n) => ({ padCount: n, padNoteStart: 36, rawMidi: false });
    eq('16 pads stay in the left half', drumCols(rack(16)), 4);
    eq('17 take the whole grid', drumCols(rack(17)), 8);
    eq('a rawMidi module keeps its own map', drumCols({ ...rack(32), rawMidi: true }), 4);
    const cfg = rack(32);
    let trips = 0;
    for (let pad = 1; pad <= 32; pad++) {
        const phys = physPadOfDrumPad(pad, 68, cfg);
        if (drumPadOfPhys(phys, 68, cfg) === pad && drumNoteOfPhys(phys, 68, cfg) === 35 + pad) trips++;
    }
    eq('every pad round-trips through its grid position', trips, 32);
    eq('the bottom row runs left to right', drumPadOfPhys(75, 68, cfg), 8);
    eq('the second row starts at pad 9', drumPadOfPhys(76, 68, cfg), 9);
    eq('the top-right pad is pad 32', drumPadOfPhys(99, 68, cfg), 32);
    const dark = drumPadLedColor(75, 68, rack(16), 0, 0, false, false);
    ok('a right-half pad is dark on a 16-pad rack', drumPadOfPhys(75, 68, rack(16)) === -1);
    ok('...and lit on a 32-pad one', drumPadLedColor(75, 68, cfg, 0, 0, false, false) !== dark);
}

if (!schwungLibAvailable()) {
    _log('\nlogic: drum racks (modules) — SKIPPED (no param_pages; set SCHWUNG=)');
    return;
}

const pp = join(resolve(process.env.SCHWUNG), 'src', 'shared', 'param_pages');
const { voicesOf } = await import(join(pp, 'voices.mjs'));
const { childIndexToWire } = await import(join(pp, 'child_key.mjs'));
const { automationFor } = await import('../../dist/esm/app/automated-keys.js');
const { setSurfaceReader } = await import('../../dist/esm/model/drum-declared.js');
const { surfaceOf, rackVoiceMap } = await import('../../dist/esm/renderer/schwung-voices.js');
const { setVoiceMapReader } = await import('../../dist/esm/model/voice-keys.js');
/* What app/globals.ts registers at start-up. */
setSurfaceReader(surfaceOf);
setVoiceMapReader(rackVoiceMap);

_log('\nTest: an explicit chromatic layout is never seated as a rack (D9)');
{
    const lvl = { child_count: 4, child_key_template: 'p{index}_{key}', child_index_param: 'cur', params: ['a'] };
    const notes = (h) => surfaceOf(h).voices.map((v) => v.note).join(',');
    eq('an index param seats the level, from note 36', notes({ levels: { root: lvl } }), '36,37,38,39');
    eq('...its own note base where it has one', notes({ levels: { root: { ...lvl, child_note_base: 60 } } }), '60,61,62,63');
    eq('"chromatic" said outright wins', notes({ pad_layout: 'chromatic', levels: { root: lvl } }), '');
    eq('no index param, no rack', notes({ levels: { root: { ...lvl, child_index_param: undefined } } }), '');
}

const prevModels = appState.trackModels[0];
function boot(id, entry = dumpEntry(id)) {
    const restoreFs = serveModuleFiles(entry);
    setSchwungGridMode('page');
    schwungGridReload();
    const fixture = dumpFixture(id);
    const model = settleModel(bootModel(fixture));
    appState.trackModels[0] = [model];
    env.setParams(fixture);
    const p = schwungPageFor(0, 'synth', null, automationFor);
    for (let i = 0; i < 12 * 60 && !p.ready; i++) p.tick();
    if (!p.ready) fail(`drum racks: ${id} page never resolved`);
    return { p, model, fixture, restoreFs };
}
const ticks = (p, n) => { for (let i = 0; i < n; i++) p.tick(); };
const done = (restoreFs) => {
    restoreFs();
    appState.trackModels[0] = prevModels;
    schwungGridReload();
    setSchwungGridMode(null);
    env.setParams(MOCK_SYNTHS.test16);
};
/* The pad's page, after a press as the router makes it: the knob bound on the
 * first per-pad cell, and the pad the page edits. */
function press(p, model, pad) {
    const cfg = model.getDrumConfig();
    model.updateDrumPad(pad, pad);
    const moved = p.focusVoice(pad, drumNoteOfPad(pad, cfg));
    ticks(p, 80);
    const pg = p.ctl.pages[p.ctl.pageIndex];
    const cip = pg && pg.childLevel ? pg.childLevel.child_index_param : null;
    const slot = pg && Array.isArray(pg.keys) ? pg.keys.findIndex((k) => k && k !== cip) : -1;
    return { moved, pg, cip, slot, ioKey: slot >= 0 ? p.knobParamInfo(slot).ioKey : null,
             child: pg ? p.ctl.childIndexOf(pg.level) : null };
}

_log('\nTest: sophie WITHOUT its movy_config is a 16-pad rack (D9)');
{
    const { movy_config: _gone, ...bare } = dumpEntry('sophie');
    const { p, model, fixture, restoreFs } = boot('sophie', bare);
    const cfg = model.getDrumConfig();
    ok('it is a drum rack', !!cfg);
    eq('16 pads', cfg && cfg.padCount, 16);
    eq('notes 36 upward', cfg && JSON.stringify(cfg.padNotes),
       JSON.stringify(Array.from({ length: 16 }, (_, i) => 36 + i)));
    eq('no alias scoping: the pages are the module’s', cfg && cfg.padScoping, undefined);
    const hier = JSON.parse(fixture['synth:ui_pages'] || fixture['synth:ui_hierarchy']);
    eq('pad 5 carries Schwung’s name for it', model.getDrumPadNames()[4], surfaceOf(hier).voices[4].name);
    const a = press(p, model, 5);
    ok('a press on pad 5 turns to a pad page', a.moved && !!a.cip);
    eq('...which edits pad 5', a.child, 4);
    eq('...and the knob binds pad 5’s key', a.ioKey, 'p05_' + a.pg.keys[a.slot]);
    eq('the module is told pad 5', portFor(0).getParam('synth:' + a.cip),
       childIndexToWire(a.pg.childLevel, 4));
    const b = press(p, model, 16);
    eq('pad 16 binds pad 16’s key (the one past the param cap)', b.ioKey, 'p16_' + b.pg.keys[b.slot]);
    const keys = model.voiceKeysOf(5) || [];
    ok('a per-voice copy knows pad 5’s keys', keys.includes('p05_tune') && !keys.includes('p06_tune'));
    done(restoreFs);
}

_log('\nTest: sophie WITH its movy_config stays on the config, and its page follows the pad (D4)');
{
    const { p, model, restoreFs } = boot('sophie');
    const cfg = model.getDrumConfig();
    eq('the config’s scoping is in force', cfg && cfg.padScoping && cfg.padScoping.aliasPrefix, 'pad_');
    eq('...and its focus param', cfg && cfg.currentPadParam, 'focused_pad');
    const a = press(p, model, 7);
    ok('a press on pad 7 turns to a pad page', a.moved && !!a.cip);
    eq('...which edits pad 7', a.child, 6);
    eq('...and the knob binds pad 7’s key', a.ioKey, 'p07_' + a.pg.keys[a.slot]);
    done(restoreFs);
}

_log('\nTest: 9w9 — its bundled config wins, and a pad shows the voice it sounds (D4)');
{
    const { p, model, fixture, restoreFs } = boot('9w9');
    const voices = voicesOf(JSON.parse(fixture['synth:ui_pages']));
    const cfg = model.getDrumConfig();
    eq('the config’s numbering, not the declaration’s', cfg && cfg.padNotes, undefined);
    const v = voices.find((x) => x.note === drumNoteOfPad(10, cfg));
    ok('9w9 numbers pad 10’s note differently from its position', !!v && voices.indexOf(v) !== 9);
    eq('pad 10 is named for the voice it sounds', model.getDrumPadNames()[9], v && v.name);
    const a = press(p, model, 10);
    eq('...and shows that voice’s page', a.pg && a.pg.level, v && v.level);
    done(restoreFs);
}

_log('\nTest: dr32 — 32 declared pads cover the whole grid (D10)');
{
    const { model, restoreFs } = boot('dr32');
    const cfg = model.getDrumConfig();
    eq('32 pads', cfg && cfg.padCount, 32);
    const notes = new Set();
    for (let phys = 68; phys <= 99; phys++) notes.add(drumNoteOfPhys(phys, 68, cfg));
    eq('every grid pad plays its own voice', notes.size, 32);
    ok('...none of them dead', !notes.has(-1));
    eq('the top-right pad is the 32nd voice', drumNoteOfPhys(99, 68, cfg), cfg && cfg.padNotes[31]);
    done(restoreFs);
}
}
