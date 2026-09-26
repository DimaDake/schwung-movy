/* schwung-canvas-page.mjs — a module-drawn PAGE reaches movy's screen.
 *
 * A `type: "canvas"` param with `as_page: true` is a page the module paints
 * itself (monksynth's big face is one). Schwung's planner already makes the
 * page and its controller already asks for the body — through
 * `io.drawCanvasPage` and, for a page you can enter, `io.canvasPageHook`. Those
 * two are the HOST's to supply (shadow_ui_param_pages.mjs does), and movy
 * supplied neither, so the page planned, paged, and drew an empty band.
 *
 * The two device globals the path touches are faked exactly as the widgets
 * suite fakes them: `host_read_file` serves the module layout and
 * `shadow_load_ui_module` "evaluates" a canvas.js by assigning its globals.
 *
 * Run by browser-test/logic.mjs.
 */
import { schwungLibAvailable, eq, ok, _log, env, MOCK_SYNTHS,
         schwungPageFor, schwungGridReload, setSchwungGridMode } from './harness.mjs';

const DIR = '/data/UserData/schwung/modules/sound_generators/facesynth';

const layout = {};
const scripts = {};
let loads = 0;
let realRead = null;

function installFakes() {
    realRead = globalThis.host_read_file;
    globalThis.host_read_file = (p) => (p in layout ? layout[p] : realRead(p));
    globalThis.shadow_load_ui_module = (p) => {
        const g = scripts[p];
        if (!g) return false;
        loads++;
        for (const k of Object.keys(g)) globalThis[k] = g[k];
        return true;
    };
}
function restoreFakes() {
    globalThis.host_read_file = realRead;
    delete globalThis.shadow_load_ui_module;
    delete globalThis.canvas_overlay;
}

/* monksynth's own shape, trimmed: one canvas param that is a page AND the
 * level's preset browser, beside ordinary knobs. */
function faceParams(canvasExtra) {
    return {
        ...MOCK_SYNTHS.test16,
        'synth:name': 'facesynth', 'synth_module': 'facesynth',
        'synth:ui_hierarchy': JSON.stringify({ levels: { root: {
            label: 'FaceSynth', list_param: 'preset', count_param: 'preset_count',
            name_param: 'preset_name', knobs: ['vowel', 'level'],
            params: [{ key: 'big_face' }, { key: 'vowel' }, { key: 'level' }],
        } } }),
        'synth:chain_params': JSON.stringify([
            { key: 'vowel', name: 'Vowel', type: 'float', min: 0, max: 1 },
            { key: 'level', name: 'Level', type: 'float', min: 0, max: 1 },
            { key: 'big_face', name: 'Face', type: 'canvas', canvas_script: 'canvas.js',
              as_page: true, show_value: false, ...canvasExtra },
        ]),
        'synth:vowel': '0.25', 'synth:level': '1',
        'synth:preset': '2', 'synth:preset_count': '12', 'synth:preset_name': 'Fish',
    };
}

function pageFor(params) {
    schwungGridReload();
    env.setParams(params);
    schwungGridReload();
    const pg = schwungPageFor(0, 'synth');
    for (let i = 0; i < 12 * 60 && !pg.ready; i++) pg.tick();
    return pg;
}

export async function run() {
    if (!schwungLibAvailable()) {
        _log('\nlogic: schwung canvas pages — SKIPPED (no param_pages; set SCHWUNG=)');
        return;
    }
    installFakes();
    setSchwungGridMode('page');
    try { await suite(); } finally {
        restoreFakes();
        schwungGridReload();
        setSchwungGridMode(null);
        env.setParams(MOCK_SYNTHS.test16);
    }
}

async function suite() {
_log('\nlogic: schwung canvas pages');

layout[`${DIR}/module.json`] = JSON.stringify({ id: 'facesynth',
    capabilities: { canvas_script: 'canvas.js' } });

_log('\nTest: an as_page canvas that is also the preset browser draws the module’s body');
{
    const calls = [];
    scripts[`${DIR}/canvas.js`] = { canvas_overlay: {
        drawPage(ctx, info) {
            calls.push({ w: ctx.width, h: ctx.height, info });
            ctx.fillRect(0, 0, 4, 4, 1);
        },
    } };
    loads = 0;
    const pg = pageFor(faceParams({ preset_browser: true }));
    ok('the page resolved', pg.ready);
    const idx = pg.ctl.pages.findIndex((p) => p.canvas);
    ok('the planner made the canvas page', idx >= 0);
    pg.goToPage(idx);
    /* The browser's name is a READ the controller makes on its own rotation. */
    for (let i = 0; i < 60; i++) pg.tick();
    pg.render('FaceSynth');
    eq('the module’s drawPage was called', calls.length, 1);
    const c = calls[0] || { info: {} };
    ok('...on a frame-scoped ctx inside the screen', !!(c.w > 0 && c.w <= 128 && c.h > 0 && c.h < 64));
    eq('...told which param it is', c.info.key, 'big_face');
    eq('...handed the preset it browses', c.info.preset && c.info.preset.name, 'Fish');
    ok('...and the level’s values', !!(c.info.values && 'vowel' in c.info.values));
    ok('...with a state object', !!(c.info.state && typeof c.info.state === 'object'));

    for (let i = 0; i < 5; i++) pg.render('FaceSynth');
    eq('it is redrawn every frame so it can animate', calls.length, 6);
    eq('...from ONE evaluation of the script', loads, 1);
    ok('movy’s own globals survived the evaluation', typeof globalThis.canvas_overlay === 'undefined');
}

_log('\nTest: a drawPage that throws is retired, not retried every frame');
{
    let n = 0;
    scripts[`${DIR}/canvas.js`] = { canvas_overlay: {
        drawPage() { n++; throw new Error('bad art'); },
    } };
    const pg = pageFor(faceParams({ preset_browser: true, canvas_overlay: 'strike' }));
    pg.goToPage(pg.ctl.pages.findIndex((p) => p.canvas));
    pg.render('FaceSynth');
    pg.render('FaceSynth');
    eq('one strike', n, 1);
}

_log('\nTest: an enterable canvas page is a door the module walks');
{
    const seen = [];
    const ov = {
        drawPage(_ctx, info) { seen.push('draw:' + (info.state.depth | 0)); },
        onMidi(ctx, ev) {
            const d = ev.data;
            if (d[1] === 3 && d[2] > 0) { ctx.state.depth = (ctx.state.depth | 0) + 1; seen.push('enter'); }
            if (d[1] === 14) seen.push('jog:' + ctx.getParam('vowel'));
        },
        handleBack(ctx) {
            if ((ctx.state.depth | 0) > 1) { ctx.state.depth--; return true; }
            return false;
        },
    };
    scripts[`${DIR}/canvas.js`] = { canvas_overlay: ov };
    const pg = pageFor(faceParams({ enterable: true, canvas_overlay: 'door' }));
    const idx = pg.ctl.pages.findIndex((p) => p.canvas);
    ok('the door page exists', idx >= 0);
    /* Enterable canvas pages are newer than canvas pages. A library whose
     * planner never marks one has no door to walk — skipped, and said so. */
    if (!(idx >= 0 && pg.ctl.pages[idx].canvas.enterable === true)) {
        _log('  SKIPPED — this param_pages predates enterable canvas pages');
        return;
    }
    /* Not pg.goToPage: that restores the section's last page, and the door
     * shares its section with Main. */
    pg.ctl.goToPage(idx, { remember: false });
    eq('...and is on screen', pg.pageIndex, idx);
    pg.render('FaceSynth');
    pg.click();                 /* enters the door */
    pg.click();                 /* the module's own click */
    pg.changePage(1);           /* jog while entered belongs to the module */
    ok('the module heard the click', seen.includes('enter'));
    ok('...and the jog, with param reads through movy', seen.includes('jog:0.25'));
    eq('the jog did not page away', pg.pageIndex, idx);
    pg.click();
    const r = pg.back();
    ok('Back the module claims keeps the door open', !(r && r.action === 'exit'));
    ok('...still entered', !!pg.ctl.menuEntered && pg.ctl.menuEntered());
    pg.render('FaceSynth');
    ok('...and the draw sees the state the hooks moved', seen[seen.length - 1] === 'draw:1');
}
}
