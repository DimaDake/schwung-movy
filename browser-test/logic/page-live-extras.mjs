/* browser-test/logic/page-live-extras.mjs — a widget's `live` extra key under
 * a delegated page.
 *
 * Schwung #668 (v1.9.0): a viz `extra_keys` entry the module marks
 * `"live": true` in chain_params is re-read every tick by
 * `refreshModulatedValues` — `<key>:effective` first, the plain key when that
 * does not answer — and handed to the widget in `values`. The Ducker's meter
 * is the case: `duck_level` is "<level>,<epoch ms>", and the widget treats a
 * reading older than 150 ms as stale.
 *
 * Under movy that read comes back to movy's io, so movy owes two things:
 *
 *   1. `:effective` for a key nothing drives must not cost a round trip. The
 *      engine does not serve it and a null is never cached, so every tick
 *      would spend a blocking engine GET on a key that never answers.
 *   2. a live value that MOVES asks for the frame back. `page-poll.ts`
 *      repaints on the drawn knobs' levels, and an extra key is on no knob,
 *      so a meter fed fresh values was still drawn only when something else
 *      happened to repaint.
 *
 * Run by browser-test/logic.mjs.
 */

import { bootModel, settleModel, eq, ok, _log, env, portFor, appState,
         MOCK_SYNTHS, schwungGridReload } from './harness.mjs';

export async function run() {

const { pageOwnerOf } = await import('../../dist/esm/app/page-owner.js');
const { pollDrawnPage } = await import('../../dist/esm/app/page-poll.js');
const { registerWidget, clearWidgets } = await import('../../dist/esm/renderer/schwung-widgets.js');

/* The Ducker's shape: the widget sits on a knob and names extra keys, one of
 * them live and read-only, on no knob. */
const preset = {
    'synth:name': 'Meter',
    'synth:ui_hierarchy': JSON.stringify({
        levels: { root: { name: 'Main', knobs: ['level', 'b'], params: ['level', 'b'] } },
    }),
    'synth:chain_params': JSON.stringify([
        { key: 'level', name: 'Level', type: 'float', min: 0, max: 1, step: 0.01,
          viz: { kind: 'custom:meter', extra_keys: ['peak', 'slow'] } },
        { key: 'b', name: 'B', type: 'float', min: 0, max: 1, step: 0.01 },
        { key: 'peak', name: 'Peak', type: 'string', access: 'read', live: true },
        { key: 'slow', name: 'Slow', type: 'string', access: 'read' },
    ]),
    'synth:level': '0.5', 'synth:b': '0.5', 'synth:peak': '0.10', 'synth:slow': '0.25',
};

_log('\nlogic: a widget\'s live extra key under a delegated page (schwung #668)');
{
    schwungGridReload();
    clearWidgets();
    registerWidget('custom:meter', { draw() {} });
    appState.activeTrack.index = 0;
    const m = settleModel(bootModel(preset));
    appState.trackModels[0] = [m];
    const owner = pageOwnerOf(m);
    for (let i = 0; i < 12 * 60 && !(owner.page && owner.page.ready); i++) pollDrawnPage(owner);
    const page = owner.page;
    ok('the page is delegated and ready', !!(page && page.ready));
    if (!page) return;

    /* The engine moving the value: straight into the store, no write logged,
     * which is what a DSP-side change looks like to the port. */
    const engineSet = (k, v) => { env.params[k] = v; };
    let clock = Date.now();
    /* Past any repaint cap: what is asked here is WHETHER a frame is due. */
    const poll = () => pollDrawnPage(owner, () => (clock += 1000));
    const quiet = (n) => { for (let i = 0; i < n; i++) if (poll()) return false; return true; };

    const port = portFor(0);
    const realGet = port.getParam.bind(port);
    let effAsks = 0;
    port.getParam = (k) => { if (String(k).endsWith(':effective')) effAsks++; return realGet(k); };

    for (let i = 0; i < 40; i++) poll();
    eq('the live key\'s `:effective` never reaches the port', effAsks, 0);

    /* Freshness: a value the engine moved reaches the widget within two fills. */
    engineSet('synth:peak', '0.80');
    for (let i = 0; i < 16; i++) poll();
    eq('the widget is handed the moved value within two fills',
       String(page.ctl.state.modValues.peak), '0.80');

    /* The repaint: settle, then move ONLY the live value. */
    let still = false;
    for (let i = 0; i < 300 && !still; i += 3) still = quiet(3);
    ok('control: a page whose live value stands still asks for no frame', still);
    engineSet('synth:peak', '0.20');
    let asked = false;
    for (let i = 0; i < 16 && !asked; i++) asked = poll();
    ok('a moving live value asks for the frame back', asked);
    port.getParam = realGet;

    appState.trackModels[0] = [];
    clearWidgets();
    schwungGridReload();
    env.setParams(MOCK_SYNTHS.test16);
}

}
