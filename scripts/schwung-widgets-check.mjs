#!/usr/bin/env node
/*
 * schwung-widgets-check.mjs — module-supplied widgets, in movy.
 *
 * A module can ship a canvas.js that draws its own cell (Schwung #405). movy
 * gets the drawing for free: viz.mjs claims the cell and the controller's own
 * vizGroups() carries it into the render movy already asks for. The one thing
 * movy must do is REGISTER the widget, and this asserts both halves of that.
 *
 * 1. A REGISTERED KIND ACTUALLY DRAWS THROUGH MOVY'S PAGE. Not through
 *    resolveViz in isolation — that is the "proving the piece instead of the
 *    wiring" trap this project has been caught by twice. The widget is asked
 *    for pixels and the page is rendered; if it never draws, the assertion
 *    fails whatever the registry says.
 *
 * 2. LOADING A canvas.js DOES NOT COST MOVY ITS OWN ENTRY POINTS.
 *    `shadow_load_ui_module` evaluates into the SAME globals movy lives in — it
 *    is how movy itself was loaded — so a script that assigns `tick`, by
 *    accident or by being copied from a UI module, would replace movy's and the
 *    device would run a tool whose tick belonged to someone else, with no
 *    error. The loader saves and restores, and this proves it on the throwing
 *    path too, which is the one a careless `finally` would miss.
 *
 *   SCHWUNG=/path/to/schwung node scripts/schwung-widgets-check.mjs
 */
import { installEnv } from '../browser-test/env.mjs';
import { MOCK_SYNTHS } from '../browser-test/mock-synth.mjs';

const W = 128, H = 64;
let fb = new Uint8Array(W * H);
const env = installEnv();
globalThis.fill_rect = (x, y, w, h, v) => {
    const x0 = Math.max(0, x | 0), y0 = Math.max(0, y | 0);
    const x1 = Math.min(W, (x | 0) + (w | 0)), y1 = Math.min(H, (y | 0) + (h | 0));
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) fb[yy * W + xx] = v ? 1 : 0;
};
globalThis.clear_screen = () => { fb = new Uint8Array(W * H); };

const REAL_NOW = Date.now;
let clock = REAL_NOW();
Date.now = () => clock;

const SCHWUNG = process.env.SCHWUNG;
if (!SCHWUNG) { console.log('SKIP: SCHWUNG is not set'); process.exit(0); }

const { portFor } = await import('../dist/esm/track/registry.js');
const { createSchwungPage } = await import('../dist/esm/renderer/schwung-page.js');
const WID = await import('../dist/esm/renderer/schwung-widgets.js');
/* THROUGH MOVY'S BINDING, not from the schwung checkout. The registry is module
 * state, and importing widget_registry.mjs by a different specifier yields a
 * second instance with its own empty map — registering there leaves the
 * controller's copy untouched and vizGroups() empty, which looks exactly like
 * a broken renderer. This check failed that way first. */
const { registerWidget, clearWidgets, isWidgetAvailable } = WID;

const _log = console.log.bind(console);
console.log = (...a) => { if (typeof a[0] === 'string' && a[0].startsWith('[movy]')) return; _log(...a); };

let failed = 0;
const ok   = (m) => _log(`  \x1b[32m✓\x1b[0m ${m}`);
const fail = (m) => { _log(`  \x1b[31m✗\x1b[0m ${m}`); failed++; };

_log('schwung-widgets-check: a module-supplied widget draws in movy\n');

/* ---- 1. a registered widget draws through movy's own render ------------- */
{
    /* A preset whose contract declares a custom kind. Built here rather than
     * hunting for one in the fleet, so the check states its own fixture. */
    const base = MOCK_SYNTHS.plaits;
    const custom = JSON.parse(JSON.stringify(base));
    const params = custom['synth:chain_params'] ? JSON.parse(custom['synth:chain_params']) : null;
    if (!params || !params.length) {
        fail('the plaits fixture has no chain_params to decorate — cannot build the case');
    } else {
        /* Declared on a NUMERIC param, as the reference module does. */
        const fi = params.findIndex((x) => x.type === 'float' || x.type === 'int');
        if (fi < 0) { fail('no numeric param in the fixture to decorate'); }
        params[fi].viz = { kind: 'custom:probe' };
        custom['synth:chain_params'] = JSON.stringify(params);

        if (WID.declaresCustomWidget(params)) ok('the contract is seen to declare a custom kind');
        else fail('declaresCustomWidget missed a custom: kind in the contract');

        clearWidgets();
        env.setParams(custom);
        const unreg = createSchwungPage(portFor(0), 'synth');
        for (let i = 0; i < 80 && !unreg.ready; i++) { clock += 16; unreg.tick(); }
        globalThis.clear_screen(); unreg.render('T1');
        const without = fb.slice();

        let drew = 0;
        registerWidget('custom:probe', {
            draw: (c) => { drew++; c.fillRect(0, 0, 24, 20, 1); },
            nominal: null,
        });
        if (isWidgetAvailable('custom:probe')) ok('registerWidget makes the kind available');
        else fail('the kind is not available after registerWidget');

        env.setParams(custom);
        const reg = createSchwungPage(portFor(0), 'synth');
        for (let i = 0; i < 80 && !reg.ready; i++) { clock += 16; reg.tick(); }
        globalThis.clear_screen(); reg.render('T1');
        const withW = fb.slice();

        let moved = 0;
        for (let i = 0; i < withW.length; i++) if (withW[i] !== without[i]) moved++;
        if (drew > 0) ok(`movy's render asked the widget to draw (${drew} call(s))`);
        else fail('movy rendered the page and never called the widget — the controller\'s '
                + 'vizGroups() is not reaching the renderer through this binding');
        if (moved > 0) ok(`...and the page changed because of it (${moved} px)`);
        else fail('...but the frame is identical, so nothing it drew reached the screen');
        clearWidgets();
    }
}

/* ---- 2. loading a canvas.js does not cost movy its entry points --------- */
{
    const sentinelTick = () => 'movy';
    globalThis.tick = sentinelTick;
    globalThis.init = sentinelTick;

    /* The script assigns a tick AND throws — the case a careless restore
     * misses, because the throw happens after the damage. */
    globalThis.shadow_load_ui_module = (_p) => {
        globalThis.tick = () => 'stolen';
        globalThis.canvas_overlay = { widgetKind: 'custom:x', drawCell: () => {} };
        throw new Error('canvas.js blew up after assigning tick');
    };
    const ov = WID.loadOverlay('/nonexistent/canvas.js');

    if (ov === null) ok('a canvas.js that throws yields no overlay');
    else fail('a throwing canvas.js still returned an overlay');
    if (globalThis.tick === sentinelTick) ok('...and movy still owns globalThis.tick');
    else fail('...but globalThis.tick was left belonging to the canvas script. On device that '
            + 'is movy running someone else\'s tick, silently.');
    if (globalThis.init === sentinelTick) ok('...and globalThis.init');
    else fail('...but globalThis.init was clobbered');

    /* And the ordinary path restores too. */
    globalThis.shadow_load_ui_module = (_p) => {
        globalThis.tick = () => 'stolen';
        globalThis.canvas_overlay = { widgetKind: 'custom:y', drawCell: () => {} };
        return true;
    };
    const ov2 = WID.loadOverlay('/whatever/canvas.js');
    if (ov2 && ov2.widgetKind === 'custom:y') ok('a good canvas.js yields its overlay');
    else fail('a good canvas.js did not yield its overlay');
    if (globalThis.tick === sentinelTick) ok('...with movy\'s tick restored');
    else fail('...but movy\'s tick was left clobbered on the SUCCESS path');

    delete globalThis.shadow_load_ui_module;
}

Date.now = REAL_NOW;
if (failed) { _log(`\n\x1b[31m\x1b[1mFAIL: ${failed} check(s)\x1b[0m`); process.exit(1); }
_log('\n\x1b[32m\x1b[1mPASS: a registered widget draws through movy, and loading one costs movy nothing.\x1b[0m');
