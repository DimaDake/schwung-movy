/* schwung-canvas-dive.mjs — a held canvas knob's click opens the module's screen.
 *
 * DR32's ENGN knob is `type: "canvas"`, `enterable: true`: the click asks the
 * host to open the module's own fullscreen picker (browser.js). movy logged the
 * intent and dropped it, so a pad's sample or engine could not be chosen at
 * all. This drives the real controller to the intent, opens the dive, and
 * holds it to upstream's contract (shadow_ui.js openCanvasPreview and its
 * input steal): the jog and knobs reach `onMidi`, an enterable dive's click
 * does too, Back climbs through `handleBack` before it closes, Shift+jog always
 * closes, `ctx.close()` is honoured after the hook, the draw path gets no param
 * accessors, a throwing hook is retired, and pads play AND are told.
 *
 * Closing also re-asks the module's gates: the fake's pick flips `mode`, which
 * gates a level — the DR32 shape, where the picked engine decides the pages.
 *
 * Fakes as schwung-canvas-page.mjs's. Run by browser-test/logic.mjs.
 */
import { schwungLibAvailable, eq, ok, _log, env, MOCK_SYNTHS, appState,
         schwungPageFor, schwungGridReload, setSchwungGridMode } from './harness.mjs';

const DIR = '/data/UserData/schwung/modules/sound_generators/divesynth';
let realRead = null;
let script = {};

function installFakes() {
    realRead = globalThis.host_read_file;
    const layout = { [`${DIR}/module.json`]: JSON.stringify({ id: 'divesynth' }) };
    globalThis.host_read_file = (p) => (p in layout ? layout[p] : realRead(p));
    globalThis.shadow_load_ui_module = (p) => {
        if (p !== `${DIR}/browser.js`) return false;
        globalThis.canvas_overlay = script;
        return true;
    };
}
function restoreFakes() {
    globalThis.host_read_file = realRead;
    delete globalThis.shadow_load_ui_module;
    delete globalThis.canvas_overlay;
}

/* A picker two levels deep: Back climbs once, then leaves; a click picks. */
function picker(log) {
    return {
        wantsPads: true,
        onOpen(ctx) { ctx.state.opened = (ctx.state.opened || 0) + 1; ctx.state.depth = 1; log.push('open:' + ctx.state.opened); },
        handleBack(ctx) { if (ctx.state.depth > 0) { ctx.state.depth--; return true; } return false; },
        onMidi(ctx, msg) {
            log.push(msg.data.join(','));
            if (msg.data[0] === 0xB0 && msg.data[1] === 3) { ctx.setParam('mode', '1'); ctx.close(); }
        },
        draw(ctx) { log.push('draw:' + typeof ctx.setParam); ctx.fillRect(0, 0, 4, 4, 1); ctx.print(0, 8, 'HI', 1); },
        tick(ctx) { ctx.state.ticks = (ctx.state.ticks || 0) + 1; },
    };
}

function params(extra) {
    return {
        ...MOCK_SYNTHS.test16,
        'synth:name': 'divesynth', 'synth_module': 'divesynth',
        'synth:ui_hierarchy': JSON.stringify({ levels: {
            root: { label: 'Dive', knobs: ['sample', 'level'],
                    params: [{ key: 'sample' }, { key: 'level' }, { level: 'eng', label: 'Eng' }] },
            eng: { label: 'Eng', visible_if: { param: 'mode', equals: 1 }, knobs: ['tone'], params: ['tone'] },
        } }),
        'synth:chain_params': JSON.stringify([
            { key: 'sample', name: 'Engine', type: 'canvas', canvas_script: 'browser.js', show_footer: false, ...extra },
            { key: 'level', name: 'Level', type: 'float', min: 0, max: 1 },
            { key: 'tone', name: 'Tone', type: 'float', min: 0, max: 1 },
        ]),
        'synth:level': '1', 'synth:tone': '0.5', 'synth:mode': '0', 'synth:sample': '',
    };
}

export async function run() {
    if (!schwungLibAvailable()) {
        _log('\nlogic: schwung canvas dive — SKIPPED (no param_pages; set SCHWUNG=)');
        return;
    }
    _log('\nlogic: schwung canvas dive (DR32 ENGN)');
    const dive = await import('../../dist/esm/renderer/schwung-canvas-dive.js');
    const { canvasDiveTakes, canvasDiveDeliverPads } = await import('../../dist/esm/midi/canvas-dive-input.js');
    const MB = globalThis.MoveBack, MC = globalThis.MoveMainButton, MJ = globalThis.MoveMainKnob;
    installFakes();
    setSchwungGridMode('page');
    const open = (extra) => {
        const log = [];
        script = picker(log);
        schwungGridReload(); env.setParams(params(extra)); schwungGridReload();
        const pg = schwungPageFor(0, 'synth');
        for (let i = 0; i < 12 * 60 && !pg.ready; i++) pg.tick();
        pg.knobTouch(0, true);
        const intent = pg.click();
        pg.knobTouch(0, false);
        return { pg, log, intent, opened: !!(intent && pg.canvasDive(intent)) };
    };
    try {
        const { pg, log, intent, opened } = open({ enterable: true });
        eq('held canvas knob + click asks to open it', intent && intent.meta && intent.meta.type, 'canvas');
        ok('...and movy opens the module screen', opened && dive.canvasDiveActive());
        ok('no Eng page while mode is 0', !pg.ctl.pages.some((p) => p.name === 'Eng'));

        ok('jog is the module’s', canvasDiveTakes([0xB0, MJ, 1]) && log.includes(`176,14,1`));
        canvasDiveTakes([0xB0, MJ, 127]);
        ok('...both ways, as the hardware encodes it', log.includes('176,14,127'));
        ok('knob turns go to the module, not the page', canvasDiveTakes([0xB0, 71, 1]) && log.includes('176,71,1'));
        eq('a knob release is heard but never taken', canvasDiveTakes([0x90, 0, 0]), false);

        ok('a pad still plays', !canvasDiveTakes([0x90, 70, 100]));
        ok('...and is told after the press is routed', !log.includes('144,70,100'));
        canvasDiveDeliverPads();
        ok('...on the next tick', log.includes('144,70,100'));

        dive.renderCanvasDive();
        ok('draw gets no param accessors', log.includes('draw:undefined'));

        canvasDiveTakes([0xB0, MB, 127]);
        ok('Back climbs first (handleBack true)', dive.canvasDiveActive());
        canvasDiveTakes([0xB0, MB, 127]);
        ok('...then leaves', !dive.canvasDiveActive());

        const again = open({ enterable: true });
        ok('reopened: the dive keeps its state per track', again.opened && again.log.includes('open:2'));
        canvasDiveTakes([0xB0, MC, 127]);
        ok('an enterable dive’s click is the module’s, and close() leaves', !dive.canvasDiveActive());
        eq('...after the pick was written', env.params['synth:mode'], '1');
        for (let i = 0; i < 60 && !again.pg.ctl.pages.some((p) => p.name === 'Eng'); i++) again.pg.tick();
        ok('closing re-asks the gates: the picked mode’s page appears',
           again.pg.ctl.pages.some((p) => p.name === 'Eng'));

        open({ enterable: true });
        appState.shiftHeld = true;
        canvasDiveTakes([0xB0, MJ, 1]);
        appState.shiftHeld = false;
        ok('Shift+jog always leaves', !dive.canvasDiveActive());

        const plain = open({});
        canvasDiveTakes([0xB0, MC, 127]);
        ok('a non-enterable dive closes on click', !dive.canvasDiveActive() && !plain.log.includes('176,3,127'));

        const bad = open({ enterable: true });
        script.onMidi = () => { throw new Error('boom'); };
        canvasDiveTakes([0xB0, MJ, 1]);
        let threw = false;
        try { dive.renderCanvasDive(); } catch (_e) { threw = true; }
        ok('a throwing hook is retired, the screen still draws', bad.opened && !threw);
        canvasDiveTakes([0xB0, MB, 127]);
        ok('...and Back still leaves', !dive.canvasDiveActive());
    } finally {
        if (dive.canvasDiveActive()) dive.closeCanvasDive(true);
        restoreFakes();
        schwungGridReload();
        setSchwungGridMode(null);
        env.setParams(MOCK_SYNTHS.test16);
    }
}
