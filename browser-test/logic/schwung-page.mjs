/* browser-test/logic/schwung-page.mjs — what movy still owes the Schwung
 * renderer under `schwunggrid = page`, where Schwung plans AND draws.
 *
 * Under `page` most of the module contract is Schwung's to read: `short_name`
 * (page_plan.mjs), the viz groups (viz.mjs resolveViz) and the enum wire format
 * (param_format.mjs) are all resolved inside param_pages, so movy reading them
 * a second time would be two implementations of one contract. What is left for
 * movy is the half that depends on who owns the HARDWARE — only the surface
 * owner sees a pad — plus the embedding API movy was not using.
 *
 * EVERY ASSERTION IS GUARDED on schwungLibAvailable(). The default build swaps
 * param_pages for a stub that throws on import, which is the whole point: a
 * Schwung that cannot serve the library must cost movy nothing but this
 * feature. Run with SCHWUNG=/path/to/schwung to actually exercise these — a
 * guarded block that never ran is not coverage.
 *
 * Run by browser-test/logic.mjs.
 */

import { schwungLibAvailable, bootModel, eq, _log } from './harness.mjs';

export async function run() {

if (!schwungLibAvailable()) {
    _log('\nlogic: schwung page mode — SKIPPED (no param_pages; set SCHWUNG=)');
    return;
}

_log('\nlogic: schwung page mode');

const { surfaceOf } = await import('../../dist/esm/renderer/schwung-voices.js');
const { setSurfaceReader } = await import('../../dist/esm/model/drum-declared.js');

/* `model/` imports nothing from `renderer/`, so the reader is PUSHED IN at
 * start-up — app/globals.ts does exactly this line. Without it `readSurface`
 * answers null and every module falls back to movy's table, which is the
 * correct behaviour with the grid off and the wrong thing to assert against
 * here. Unregistered at the end so the suites after this one see the world
 * they booted in. */
setSurfaceReader(surfaceOf);

/* ── the live-press vouch: reading the declaration ────────────────────────── */

_log('\nTest: a sibling-shape focus_press_param is read off the hierarchy root');
{
    const s = surfaceOf({
        pad_layout: 'drums',
        focus_param: 'ui_voice',
        focus_press_param: 'live_press',
        levels: {
            bass_drum: { name: 'Bass Drum', note: 36, knobs: ['vol'] },
            snare:     { name: 'Snare',     note: 38, knobs: ['vol'] },
        },
    });
    eq('the press param is read', s.pressParam, 'live_press');
    eq('and the focus param still is', s.focusParam, 'ui_voice');
}

_log('\nTest: a template-shape child_press_param is read off the child level');
{
    const s = surfaceOf({
        pad_layout: 'drums',
        levels: {
            pads: {
                child_count: 4, child_key_template: 'p{index}_{key}',
                child_index_param: 'focused_pad',
                child_press_param: 'live_press',
                child_note_base: 36,
                knobs: ['vol'],
            },
        },
    });
    eq('the child level’s press param is read', s.pressParam, 'live_press');
}

_log('\nTest: a module that declares neither has no press param');
{
    /* Absent is the answer for all 78 modules in docs/module-dump/, so this is
     * the case that must cost nothing — no write is ever made. */
    const s = surfaceOf({
        pad_layout: 'drums',
        levels: { bass_drum: { name: 'Bass Drum', note: 36, knobs: ['vol'] } },
    });
    eq('absent stays absent', s.pressParam, null);
}

_log('\nTest: a malformed declaration is an absent one');
{
    eq('non-string root field', surfaceOf({ focus_press_param: 7, levels: {} }).pressParam, null);
    eq('empty string', surfaceOf({ focus_press_param: '', levels: {} }).pressParam, null);
    eq('no hierarchy at all', surfaceOf(null).pressParam, null);
}

/* ── the live-press vouch: reaching the model ─────────────────────────────── */

const RACK_PARAMS = JSON.stringify([
    { key: 'vol', name: 'Vol', type: 'float', min: 0, max: 1 },
]);

_log('\nTest: the declared press param reaches the model');
{
    const m = bootModel({
        'synth:name': 'vouchrack', 'synth_module': 'vouchrack',
        'synth:ui_hierarchy': JSON.stringify({
            pad_layout: 'drums',
            focus_param: 'ui_voice',
            focus_press_param: 'live_press',
            levels: {
                bass_drum: { name: 'Bass Drum', note: 36, knobs: ['vol'] },
                snare:     { name: 'Snare',     note: 38, knobs: ['vol'] },
            },
        }),
        'synth:chain_params': RACK_PARAMS,
        'synth:vol': '0.5',
    });
    for (let i = 0; i < 20; i++) m.tick();
    eq('the model carries the press param', m.getPressParam(), 'live_press');
}

_log('\nTest: a module declaring none leaves the model with null');
{
    const m = bootModel({
        'synth:name': 'plainrack', 'synth_module': 'plainrack',
        'synth:ui_hierarchy': JSON.stringify({
            pad_layout: 'drums',
            levels: { bass_drum: { name: 'Bass Drum', note: 36, knobs: ['vol'] } },
        }),
        'synth:chain_params': RACK_PARAMS,
        'synth:vol': '0.5',
    });
    for (let i = 0; i < 20; i++) m.tick();
    eq('nothing declared, nothing carried', m.getPressParam(), null);
}

setSurfaceReader(null);

}
