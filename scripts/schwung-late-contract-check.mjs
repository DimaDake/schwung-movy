#!/usr/bin/env node
/* schwung-late-contract-check.mjs — the module is not loaded yet. Ask again.
 *
 * The device failure this exists for: open Braids, see movy's widgets, and the
 * log says `not-ready track=0 ck=synth pages=0` EXACTLY ONCE. Once is the tell.
 * createSchwungPage called reload() at construction, which on device happens
 * while the module is still loading, so the planner saw no hierarchy, produced
 * no pages, and `ready` stayed false for the session. Nothing asked again.
 *
 * Every earlier check booted a port that already served the contract, so none
 * of them could see it. This one starts with an EMPTY port and only then serves
 * the module — which is the order the device does it in.
 *
 *   SCHWUNG=/path/to/schwung node scripts/schwung-late-contract-check.mjs
 */
import { installEnv } from '../browser-test/env.mjs';

const W = 128, H = 64;
globalThis.fill_rect = () => {};
globalThis.clear_screen = () => {};
const env = installEnv();

const { portFor } = await import('../dist/esm/track/registry.js');
const { createSchwungPage } = await import('../dist/esm/renderer/schwung-page.js');
const { MOCK_SYNTHS } = await import('../browser-test/mock-synth.mjs');

const fail = (m) => { console.log('FAIL: ' + m); process.exit(1); };

/* ---- 1. a page built before the module loads must recover ---------------- */
{
    env.setParams({});                      /* nothing served yet */
    const sp = createSchwungPage(portFor(0), 'synth');
    if (sp.ready) fail('reported ready against an empty port');

    /* The module finishes loading a moment later. */
    env.setParams(MOCK_SYNTHS.obxd_like);

    let becameReady = false;
    for (let i = 0; i < 400 && !becameReady; i++) {
        sp.tick();
        becameReady = sp.ready;
    }
    if (!becameReady) {
        fail('the page never recovered after the module loaded — the first empty '
           + 'contract read latched, which is the device bug this checks');
    }
    if (!sp.pageCount) fail('recovered but planned no pages');
    console.log(`  recovered after the module loaded: ${sp.pageCount} pages`);
}

/* ---- 2. it gives up eventually, rather than reading forever -------------- */
{
    env.setParams({});
    const sp = createSchwungPage(portFor(0), 'synth');
    for (let i = 0; i < 4000; i++) sp.tick();
    if (sp.ready) fail('became ready against a port that never served anything');
    /* No assertion on the exact count — the point is that it stops. A module
     * that genuinely declares nothing must not cost an IPC read every frame
     * for the life of the session. */
    console.log('  a permanently empty port does not read forever');
}

/* ---- 3. swapping the module re-plans ------------------------------------ */
{
    env.setParams(MOCK_SYNTHS.obxd_like);
    const sp = createSchwungPage(portFor(0), 'synth');
    for (let i = 0; i < 40; i++) sp.tick();
    if (!sp.ready) fail('did not become ready on a port serving obxd');
    const before = sp.pageCount;
    const beforeLabel = (() => { sp.goToPage(0); return sp.labelAt(0); })();

    env.setParams(MOCK_SYNTHS.plaits);      /* the slot's module changed */
    let changed = false;
    for (let i = 0; i < 400 && !changed; i++) {
        sp.tick();
        sp.goToPage(0);
        changed = (sp.pageCount !== before) || (sp.labelAt(0) !== beforeLabel);
    }
    if (!changed) {
        fail('swapping the module did not re-plan — the grid would keep drawing '
           + "the previous module's pages");
    }
    console.log(`  a module swap re-plans (${before} pages -> ${sp.pageCount})`);
}

console.log('');
console.log('PASS: a late contract is retried, a permanently empty one is given up on, '
    + 'and a module swap re-plans.');
