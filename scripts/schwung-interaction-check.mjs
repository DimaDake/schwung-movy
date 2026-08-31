#!/usr/bin/env node
/* schwung-interaction-check.mjs — movy's input reaches Schwung's page.
 *
 * Drawing was the easy half. This is the half where being wrong is INVISIBLE:
 * an automation lane bound from movy's idea of "the param under knob k" works
 * perfectly, on the wrong parameter, because the two planners put different
 * keys in the same cell.
 *
 *   SCHWUNG=/path/to/schwung node scripts/schwung-interaction-check.mjs
 */
import { installEnv } from '../browser-test/env.mjs';
import { readFileSync } from 'node:fs';

const W = 128, H = 64;
globalThis.fill_rect = () => {};
globalThis.clear_screen = () => {};
const env = installEnv();

const { portFor } = await import('../dist/esm/track/registry.js');
const { createSchwungPage } = await import('../dist/esm/renderer/schwung-page.js');
const { createModel } = await import('../dist/esm/model/index.js');
const { MOCK_SYNTHS } = await import('../browser-test/mock-synth.mjs');

const fail = (m) => { console.log('FAIL: ' + m); process.exit(1); };

/* ---- 1. the two planners disagree about a cell, and the info follows the
 *         one that DREW it -------------------------------------------------- */
{
    env.setParams(MOCK_SYNTHS.obxd_like);
    const port = portFor(0);
    const model = createModel(port, 'synth');
    model.reset(); model.reload();
    for (let i = 0; i < 60; i++) model.tick();

    const sp = createSchwungPage(port, 'synth');
    for (let i = 0; i < 60 && !sp.ready; i++) sp.tick();
    if (!sp.ready) fail('page never became ready');

    /* Find a page where a cell holds different params under the two planners.
     * obxd_like page 1 is the known case: alignGroupsToRows swaps the rows. */
    model.changePage(1); for (let i = 0; i < 30; i++) model.tick();
    sp.goToPage(1);      for (let i = 0; i < 30; i++) sp.tick();

    let disagreed = -1;
    for (let k = 0; k < 8; k++) {
        const mi = model.getKnobParamInfo(k);
        const si = sp.knobParamInfo(k);
        if (mi && si && mi.ioKey !== si.ioKey) { disagreed = k; break; }
    }
    if (disagreed < 0) {
        fail('no knob where the two planners disagree — this check cannot see the '
           + 'mis-target it exists for. obxd_like page 1 should disagree.');
    }
    const mi = model.getKnobParamInfo(disagreed);
    const si = sp.knobParamInfo(disagreed);
    console.log(`  knob ${disagreed}: movy says "${mi.ioKey}", schwung says "${si.ioKey}"`);

    if (!si.target) fail('schwung knobParamInfo has no target — a lane could not bind');
    if (typeof si.min !== 'number' || typeof si.max !== 'number') {
        fail('schwung knobParamInfo has no range — the lane could not scale');
    }
    if (si.ioKey !== sp.keyAt(disagreed)) {
        fail('knobParamInfo disagrees with keyAt for the same slot — two answers '
           + 'to "which param is under this knob"');
    }
}

/* ---- 2. a knob turn goes through Schwung and WRITES ---------------------- */
{
    env.setParams(MOCK_SYNTHS.test8);
    const port = portFor(0);
    const sp = createSchwungPage(port, 'synth');
    for (let i = 0; i < 60 && !sp.ready; i++) sp.tick();
    if (!sp.ready) fail('test8 page never became ready');

    const writes = [];
    const realSet = port.setParam.bind(port);
    port.setParam = (k, v) => { writes.push([k, v]); return realSet(k, v); };

    const key = sp.keyAt(0);
    if (!key) fail('no param at knob 0');
    sp.knobTouch(0, true);
    for (let i = 0; i < 12; i++) { sp.knobTurn(0, 1); sp.tick(); }
    sp.knobTouch(0, false);
    for (let i = 0; i < 30; i++) sp.tick();      /* let the write throttle flush */
    port.setParam = realSet;

    const hit = writes.filter(([k]) => k === 'synth:' + key);
    if (!hit.length) {
        fail(`turning knob 0 wrote nothing for ${key}. Writes seen: `
           + (writes.length ? writes.slice(0, 4).map(([k]) => k).join(', ') : 'none'));
    }
    console.log(`  a knob turn writes through Schwung: ${hit.length} write(s) to synth:${key}`);
}

/* ---- 3. a door page opens on click -------------------------------------- */
{
    env.setParams(MOCK_SYNTHS.obxd_like);
    const sp = createSchwungPage(portFor(0), 'synth');
    for (let i = 0; i < 60 && !sp.ready; i++) sp.tick();

    let door = -1;
    for (let p = 0; p < sp.pageCount; p++) {
        sp.goToPage(p);
        if (sp.ctl.isDoor()) { door = p; break; }
    }
    if (door < 0) fail('no door page in obxd_like — this check cannot see the click');

    sp.goToPage(door);
    for (let i = 0; i < 20; i++) sp.tick();
    if (sp.ctl.menuEntered()) fail('a door page reported entered before any click');
    sp.click();
    if (!sp.ctl.menuEntered()) {
        fail('clicking a door page did not enter it — movy click is not reaching '
           + 'the controller');
    }
    console.log(`  clicking a door page (${sp.ctl.page.kind}) enters it`);
}


/* ---- 4. ONE answer to "which param is under knob k" ----------------------
 *
 * A source check, because the failure is not visible at runtime without a
 * device: the turn path asked Schwung while touch and release asked movy, so a
 * lane was CREATED against the parameter on screen and then cleared, armed and
 * reconciled against a different one. Under Schwung pagination those really are
 * different keys.
 *
 * Pinned by counting call sites rather than by behaviour, because behaviour
 * only diverges on a page where the two planners disagree — which is exactly
 * the condition a future edit would forget to test on.
 */
{
    const raw = readFileSync(new URL('../src/midi/router.ts', import.meta.url), 'utf8');
    /* CODE ONLY. The comments above these call sites NAME the function while
     * explaining why it must not be reached directly, so counting the raw file
     * counts the explanation as a violation — which is what it did first. */
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const direct = (src.match(/\.getKnobParamInfo\(/g) || []).length;
    if (direct !== 1) {
        fail(`router.ts reaches getKnobParamInfo directly ${direct} times; exactly one `
           + `(inside knobInfoFor) is allowed. Every gesture must get the same answer `
           + `to "which param is under this knob".`);
    }
    const viaHelper = (src.match(/knobInfoFor\(/g) || []).length;
    if (viaHelper < 4) {
        fail(`only ${viaHelper} references to knobInfoFor — the touch, release and turn `
           + `paths should all go through it`);
    }
    console.log(`  router asks one helper (${viaHelper} sites), never the model directly`);
}

/* ---- 5. a held step shows the LOCKED value, not the live one ------------ */
{
    env.setParams(MOCK_SYNTHS.test8);
    const sp = createSchwungPage(portFor(0), 'synth');
    for (let i = 0; i < 60 && !sp.ready; i++) sp.tick();
    const key = sp.keyAt(0);
    if (!key) fail('no param at knob 0');

    const auto = (held) => ({
        assignedLanes: 1, activeLanes: 1, held,
        poolFull: false,
        heldValues: new Map([[0, 0.9]]),
        liveValues: new Map(),
        laneForKey: (k) => (k === key ? 0 : -1),
    });

    const paint = (a) => {
        const px = [];
        globalThis.fill_rect = (x, y, w, h, v) => { if (v) px.push(x + ',' + y); };
        sp.render('T1', a, -1);
        globalThis.fill_rect = () => {};
        return px.join('|');
    };

    const notHeld = paint(auto(false));
    const heldNow = paint(auto(true));
    if (notHeld === heldNow) {
        fail('holding a step drew the same cell — the locked value is not reaching the '
           + 'widget, so the cell shows where the knob is rather than what the step plays');
    }
    console.log('  a held step draws the locked value, not the live one');
}

console.log('');
console.log('PASS: knob info comes from whoever drew the page, a turn writes through '
    + 'Schwung, a click enters a door, one helper answers for every gesture, and a '
    + 'held step shows its lock.');
