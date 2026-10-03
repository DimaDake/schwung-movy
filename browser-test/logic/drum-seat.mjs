/* drum-seat.mjs — the per-pad seat, the pad-switch rule, the background warm and
 * the per-voice copy (plan 2026-09-30-drum-modules-schwung-pages.md, Phases 5
 * and 5b: D5, D6, D7, D12, D16).
 *
 * Real controller, real dumped contracts (9w9 sibling, simian template). The
 * jog position is the SEAT's (`p.pageIndex`); the page actually drawn is read
 * off the controller (`p.ctl.pageIndex`) — SP-45: `probe.page().cells` is
 * blind to Schwung's cursor.
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
    _log('\nlogic: drum seat — SKIPPED (no param_pages; set SCHWUNG=)');
    return;
}

const sh = resolve(process.env.SCHWUNG, 'src', 'shared');
const { voicesOf } = await import(join(sh, 'param_pages', 'voices.mjs'));
const { resolveChildKey, childCount } = await import(join(sh, 'param_pages', 'child_key.mjs'));
const { automationFor } = await import('../../dist/esm/app/automated-keys.js');
const { setVoiceMapReader } = await import('../../dist/esm/model/voice-keys.js');
const { setSurfaceReader } = await import('../../dist/esm/model/drum-declared.js');
const { surfaceOf, rackVoiceMap } = await import('../../dist/esm/renderer/schwung-voices.js');
const { setChildKeyResolver } = await import('../../dist/esm/model/child-keys.js');
const { resetAutomation, assignLane, automationRegistry } = await import('../../dist/esm/seq/automation.js');
const { seqState } = await import('../../dist/esm/seq/state.js');
const { buildAutomationView } = await import('../../dist/esm/app/tick.js');
const { voiceCopyArgs } = await import('../../dist/esm/seq/voice-copy.js');
/* What app/globals.ts registers at start-up. */
setSurfaceReader(surfaceOf);
setChildKeyResolver(resolveChildKey, childCount);
setVoiceMapReader(rackVoiceMap);

const prevModels = appState.trackModels[0];
function boot(id, edit = null) {
    const restoreFs = serveModuleFiles(dumpEntry(id));
    setSchwungGridMode('page');
    schwungGridReload();
    const fixture = { ...dumpFixture(id) };
    if (edit) edit(fixture);
    const model = settleModel(bootModel(fixture));
    appState.trackModels[0] = [model];
    env.setParams(fixture);
    const p = schwungPageFor(0, 'synth', null, automationFor);
    for (let i = 0; i < 12 * 60 && !p.ready; i++) p.tick();
    if (!p.ready) fail(`drum seat: ${id} page never resolved`);
    ticks(p, 4);
    return { p, model, fixture, restoreFs };
}
const ticks = (p, n) => { for (let i = 0; i < n; i++) p.tick(); };
const shown = (p) => p.ctl.pages[p.ctl.pageIndex];
const jog = (p, d) => { for (let i = 0; i < Math.abs(d); i++) { p.changePage(d); ticks(p, 2); } };
const press = (p, pad) => { const r = p.focusVoice(pad); ticks(p, 2); return r; };
const done = (restoreFs) => {
    restoreFs();
    appState.trackModels[0] = prevModels;
    resetAutomation();
    seqState.heldLocks = new Map(); seqState.stepAutoMode = false;
    seqState.autoActive = 0; seqState.autoAssigned = 0; seqState.watchLane = -1;
    schwungGridReload();
    setSchwungGridMode(null);
    env.setParams(MOCK_SYNTHS.test16);
};
/* Every live read the press costs: singles and bulk requests through the
 * track's port, which is what the page's read cache talks to. */
function countReads(fn) {
    const port = portFor(0);
    const g = port.getParam, m = port.getMany;
    const n = { single: 0, bulk: 0, keys: [] };
    port.getParam = (...a) => { n.single++; n.keys.push(a[0]); return g.apply(port, a); };
    port.getMany = (...a) => { n.bulk++; return m.apply(port, a); };
    try { fn(); } finally { port.getParam = g; port.getMany = m; }
    return n;
}

_log('\nTest: 9w9 — the voice pages collapse into one seat, first in the jog (D5, D6)');
{
    const { p, fixture, restoreFs } = boot('9w9');
    const voices = voicesOf(JSON.parse(fixture['synth:ui_pages']));
    const others = p.ctl.pages.filter((pg) => !voices.some((v) => v.level === pg.level)).length;
    eq('the module opens on the seat', p.pageIndex, 0);
    eq('...showing the first voice', shown(p).level, voices[0].level);
    eq('the jog counts one seat plus the rest', p.pageCount, 1 + others);
    jog(p, 1);
    ok('one detent leaves the seat for a non-voice page', !voices.some((v) => v.level === shown(p).level));
    eq('...and the bar says page 2', p.pageIndex, 1);
    jog(p, -1);
    eq('jogging back lands on the seat', shown(p).level, voices[0].level);

    _log('Test: 9w9 — the pad-switch rule (D7)');
    press(p, 3);
    eq('on the seat a press shows the pad’s voice', shown(p).level, voices[2].level);
    eq('...still the seat', p.pageIndex, 0);
    jog(p, 2);
    const off = shown(p);
    press(p, 5);
    eq('off the seat a press does not move the page', shown(p), off);
    jog(p, -2);
    eq('...but the seat followed: jogging back shows pad 5', shown(p).level, voices[4].level);
    done(restoreFs);
}

_log('\nTest: 9w9 — a longer voice keeps the offset, clamped to the shorter one (D7)');
{
    /* Snare given a second page: ten knobs plan as "Snare" + "Snare - 2". */
    const { p, fixture, restoreFs } = boot('9w9', (f) => {
        const h = JSON.parse(f['synth:ui_pages']);
        const sd = voicesOf(h)[1].level;
        h.levels[sd].knobs = h.levels[sd].knobs.concat(['sd_x1', 'sd_x2', 'sd_x3', 'sd_x4', 'sd_x5']);
        f['synth:ui_pages'] = JSON.stringify(h);
    });
    const voices = voicesOf(JSON.parse(fixture['synth:ui_pages']));
    const n = p.pageCount;
    press(p, 2);
    eq('the snare seat is two pages long', p.pageCount, n + 1);
    jog(p, 1);
    eq('...its second page', shown(p).level, voices[1].level);
    eq('...is jog position 2', p.pageIndex, 1);
    press(p, 1);
    eq('a one-page voice clamps to its last page', shown(p).level, voices[0].level);
    eq('...the seat', p.pageIndex, 0);
    jog(p, 1);
    ok('...and the next detent leaves the seat', shown(p).level !== voices[0].level);
    /* The section picker lands on another voice's page: the seat adopts it. */
    p.ctl.goToPage(p.ctl.pages.findIndex((pg) => pg.level === voices[1].level), { remember: false });
    ticks(p, 2);
    eq('a picker jump onto a voice page makes it the seat', p.pageIndex, 0);
    eq('...with that voice’s page count', p.pageCount, n + 1);
    done(restoreFs);
}

_log('\nTest: simian — a template rack’s block is every pad level, the press keeps the page (D6, D7)');
{
    const { p, restoreFs } = boot('simian');
    const block = p.ctl.pages.filter((pg) => pg.childLevel).map((pg) => pg.level);
    ok('simian has three pad levels ahead of its kit page', block.length === 3 && !p.ctl.pages[0].childLevel);
    eq('the module opens on the first pad level', shown(p).level, block[0]);
    eq('...at jog position 1', p.pageIndex, 0);
    jog(p, 1);
    eq('...the jog walks the pad levels first', shown(p).level, block[1]);
    press(p, 9);
    ticks(p, 12);                        // the controller reads the index back
    eq('a press on a pad level keeps the level', shown(p).level, block[1]);
    eq('...and re-keys it to pad 9', p.ctl.childIndexOf(shown(p).level), 8);
    jog(p, 2);
    ok('past the block are the rack’s other pages', !shown(p).childLevel);
    done(restoreFs);
}

_log('\nTest: a pad switch reads nothing on the press (D12)');
for (const [id, from, to] of [['simian', 3, 9], ['9w9', 1, 5]]) {
    const { p, restoreFs } = boot(id);
    press(p, from);
    ticks(p, 400);                       // the background set cycles through
    let pressRead, after;
    pressRead = countReads(() => { p.focusVoice(to); });
    after = countReads(() => { ticks(p, 7); });       // short of the next fill
    /* The arriving page's cells at the new pad — what a switch has to show.
     * Other reads in the window (an unserved `preset_name`) are the page's
     * own cadence, not the press's. */
    const pg = shown(p);
    const cells = new Set((pg.keys || []).filter(Boolean).map((k) => 'synth:'
        + (pg.childLevel ? (resolveChildKey(pg.childLevel, to - 1, k) || k) : k)));
    eq(`${id}: the press itself reads nothing`, pressRead.single + pressRead.bulk, 0);
    const cold = after.keys.filter((k) => cells.has(k));
    eq(`${id}: the arriving page’s cells are served without a live read [${cold.join(',')}]`, cold.length, 0);
    done(restoreFs);
}

_log('\nTest: per-voice keys come from Schwung’s voice map (D16)');
{
    const { p, model, restoreFs } = boot('simian');
    const pg = p.ctl.pages.find((q) => q.childLevel);
    const k = pg.keys.find((x) => x && x !== pg.childLevel.child_index_param);
    const k3 = resolveChildKey(pg.childLevel, 2, k), k4 = resolveChildKey(pg.childLevel, 3, k);
    ok(`pad 3 owns ${k3}`, model.voiceKeysOf(3).includes(k3));
    ok(`...not pad 4’s ${k4}`, !model.voiceKeysOf(3).includes(k4));
    ok('the shared index param is nobody’s', !model.voiceKeysOf(3).includes(pg.childLevel.child_index_param));

    _log('Test: a drum step copy carries only the selected voice’s lanes (D16)');
    resetAutomation();
    const slot = pg.keys.indexOf(k);
    const laneOn = (pad) => {
        press(p, pad); model.updateDrumPad(pad, 35 + pad);
        while (shown(p) !== pg) jog(p, -1);
        return assignLane(0, 0, p.knobParamInfo(slot), () => true);
    };
    const l3 = laneOn(3), l4 = laneOn(4);
    eq('the two lanes bind the two pads’ keys',
       automationRegistry()[0][l3].targetParam + ' ' + automationRegistry()[0][l4].targetParam, `synth:${k3} synth:${k4}`);
    model.updateDrumPad(3, 38);
    seqState.watchLane = 38;
    eq('a copy on pad 3 names its note and only its lane', voiceCopyArgs(0), ` 38 ${(1 << l3) >>> 0}`);
    seqState.watchLane = -1;
    eq('a melodic view copies whole steps', voiceCopyArgs(0), '');

    _log('Test: the held step shows the focused pad’s locks only (D16)');
    seqState.stepAutoMode = true;
    seqState.heldLocks = new Map([[l3, 100], [l4, 10]]);
    seqState.autoActive = (1 << l3) | (1 << l4); seqState.autoAssigned = seqState.autoActive;
    const decorated = (pad) => {
        press(p, pad); model.updateDrumPad(pad, 35 + pad);
        p.render('T', buildAutomationView(0, model));
        const d = p.ctl.decorations;
        return d && d[slot] ? d[slot].value : null;
    };
    const v3 = decorated(3), v4 = decorated(4);
    ok('pad 3’s lock is on pad 3’s cell', v3 !== null);
    ok('...pad 4 shows its own, not pad 3’s', v4 !== null && v4 !== v3);
    done(restoreFs);
}

_log('\nTest: the header pad icon only on pages a pad press re-targets');
/* The icon asks "do these knobs belong to the selected pad?". The model's
 * `isPadScoped` is rack-wide (any declared voices), so on a rack's Reverb or
 * Kit page it says yes; only the seat knows which of Schwung's pages are the
 * pad's. Expected blocks are spelled independently of the seat: a sibling
 * rack's voice levels, a template rack's child-level pages, and every page of
 * sophie, which has nothing global. */
for (const [id, perPad] of [
    ['9w9',       (pg, voices) => voices.some((v) => v.level === pg.level)],
    ['voice-poc', (pg, voices) => voices.some((v) => v.level === pg.level)],
    ['simian',    (pg) => !!pg.childLevel],
    ['sophie',    () => true],
]) {
    const { p, model, fixture, restoreFs } = boot(id);
    const voices = voicesOf(JSON.parse(fixture['synth:ui_pages'] || fixture['synth:ui_hierarchy']));
    let on = 0, off = 0;
    for (let i = 0; i < p.pageCount; i++) {
        p.goToPage(i); ticks(p, 2);
        const want = perPad(shown(p), voices);
        want ? on++ : off++;
        eq(`${id}: ${shown(p).name || shown(p).level} ${want ? 'shows' : 'hides'} the pad icon`,
           p.chrome(true).padScoped, want);
    }
    ok(`${id}: has a per-pad page`, on > 0);
    if (id !== 'sophie') {
        ok(`${id}: has a global page`, off > 0);
        ok(`${id}: ...where the rack-wide model flag would still say yes`, model.getViewModel().isPadScoped);
    }
    done(restoreFs);
}

_log('\nTest: a module with no voice map copies whole steps (D16)');
{
    const { restoreFs } = boot('weird-dreams');
    seqState.watchLane = 36;
    eq('no declared voices, no per-voice copy', voiceCopyArgs(0), '');
    done(restoreFs);
}
}
