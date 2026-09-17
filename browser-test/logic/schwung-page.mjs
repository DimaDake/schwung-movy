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

import { schwungLibAvailable, bootModel, eq, ok, _log,
         env, portFor, MOCK_SYNTHS, schwungPageFor, schwungGridReload,
         setSchwungGridMode } from './harness.mjs';

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

/* ── the embedded grid's rect ─────────────────────────────────────────────── */

_log('\nTest: the embedded body rect seats Schwung’s widget rows on movy’s own rows');
{
    const { schwungLib } = await import('../../dist/esm/renderer/schwung-lib.js');
    const { BAND_H } = schwungLib();
    const { GRID_BODY_RECT, ROW0_Y, ROW1_Y, BAR_Y, BAR_H, TOAST_Y } =
        await import('../../dist/esm/renderer/layout.js');

    /* This is the whole reason for supplying a rect at all: upstream reflows
     * ONLY when one is given (render_page_movy.mjs, `const reflow = !!o.rect`),
     * so passing none is not a default — it leaves the body on Schwung's own
     * vertical rhythm, on top of movy's bank bar.
     *
     * The arithmetic is asserted rather than the literal, so this fails if
     * EITHER side moves: movy's row constants or Schwung's band heights. */
    const row0 = GRID_BODY_RECT.y + BAND_H.gutter0;
    const row1 = row0 + BAND_H.widget + BAND_H.label + BAND_H.gutter1;
    const end  = row1 + BAND_H.widget + BAND_H.label;

    eq('widget row 0 is movy’s ROW0_Y', row0, ROW0_Y);
    eq('widget row 1 is movy’s ROW1_Y', row1, ROW1_Y);
    eq('the body clears the bank bar', GRID_BODY_RECT.y >= BAR_Y + BAR_H, true);
    eq('and stops above the toast band', end <= TOAST_Y, true);
    eq('the rect is exactly the room a body needs', GRID_BODY_RECT.h,
       BAND_H.gutter0 + BAND_H.widget + BAND_H.label
       + BAND_H.gutter1 + BAND_H.widget + BAND_H.label);
}

/* ── SP-12/SP-26: what one tick of a delegated page costs ────────────────── */

/* Count ROUND TRIPS, not params.
 *
 * SP-26 is the difference between the two: `shadow_get_params` reads a whole
 * page in ONE blocking IPC where `shadow_get_param` reads one key in one, and
 * on device each of those is ~3.4 ms whatever it carries. A counter on the
 * single-key call alone therefore cannot see the thing this budget is about —
 * it counted 80 before SP-26 and 125 after, while the real cost went the other
 * way. The bulk call's own per-key delegation is suppressed for the same
 * reason: inside one request it is one trip. */
function countTrips(fn) {
    /* Suites before this one delete the param globals rather than restoring
     * them (SP-02's deferred list), so wrapping whatever is there would wrap
     * `undefined`. The env's own restorer is what that cleanup meant. */
    env.restoreParamGlobals();
    const realGet = globalThis.shadow_get_param;
    const realBulk = globalThis.shadow_get_params;
    let trips = 0, depth = 0;
    globalThis.shadow_get_params = (...a) => {
        trips++; depth++;
        try { return realBulk(...a); } finally { depth--; }
    };
    globalThis.shadow_get_param = (...a) => { if (!depth) trips++; return realGet(...a); };
    try { fn(); } finally {
        globalThis.shadow_get_param = realGet;
        globalThis.shadow_get_params = realBulk;
    }
    return trips;
}

/** A settled, delegated page for track 0, ticked until its contract resolves. */
function settledPage() {
    setSchwungGridMode('page');
    schwungGridReload();
    env.setParams(MOCK_SYNTHS.test16);
    const p = schwungPageFor(0, 'synth');
    for (let i = 0; i < 12 * 60 && !p.ready; i++) p.tick();
    return p;
}

_log('\nTest: a settled page costs ONE round trip for a page, not one per tick');
{
    /* SP-12 made the poll PER-TICK — it had to, or the page's read cursor never
     * advances and the cells on screen stop moving. SP-13 then measured what
     * that cost on device: 9.1 ms a tick against `off`'s 4.9, because Schwung's
     * cursor asks ONE key per tick and `page_controller.mjs:526` has no bulk
     * read at all. SP-26 serves those asks from a batch movy refills on a
     * divider, so the page costs a round trip per FILL_TICKS rather than one
     * per tick.
     *
     * THE CEILING IS 54 OVER 64 TICKS, AND IT IS DERIVED. Measured here: 36 —
     * eight fills (one per FILL_TICKS), fifteen first-touch misses as this
     * page's keys enter the batch, and the keys this MOCK answers null for. The
     * last group is an artefact of the env rather than a cost the device pays:
     * a key the device does not serve answers "" (the shim replies with an
     * error and a zeroed buffer) and "" IS cached, where the mock's store
     * answers null and a null is never cached. 54 is the midpoint of 36 and 72
     * — a doubling of the measurement — rounded down. The regression it exists
     * to catch is further out still: with the cache bypassed the same 64 ticks
     * cost 80 trips, which is what SP-13 measured on device as 9.1 ms a tick. */
    const p = settledPage();
    ok('the page resolved', p.ready);

    const TICKS = 64;
    const trips = countTrips(() => { for (let i = 0; i < TICKS; i++) p.tick(); });

    _log(`    (${trips} round trips over ${TICKS} ticks)`);
    eq('a settled page stays under one round trip per two ticks',
       trips <= 54, true);

    schwungGridReload();
    setSchwungGridMode(null);
    env.setParams(MOCK_SYNTHS.test16);
}

_log('\nTest: a cached read never outlives movy’s own write');
{
    /*
     * THE HAZARD SP-13 NAMED, and the one a read cache has to answer for: on a
     * delegated page movy is the writer — the knob under the hand, the
     * sequencer, an automation lane, undo — so a page served from a batch taken
     * before the write shows the value SNAPPING BACK to what it was, which is a
     * worse bug than a slow tick. Every one of those writers goes through the
     * one memoized port for the track, which is why the cache drains that
     * port's write log before it serves anything.
     *
     * Asserted here rather than through the page because this is the level the
     * hazard lives at and the only one where it is deterministic: through the
     * page it would race Schwung's own settle window against the fill divider,
     * and a test that passes because two timers happened to line up is not a
     * test. What ties this to the page is structural — page-owner.mjs greps
     * schwung-page-io.ts for a read that walks around the cache.
     */
    const { createPageReadCache } =
        await import('../../dist/esm/renderer/schwung-page-cache.js');
    env.restoreParamGlobals();
    const port = portFor(0);
    const cache = createPageReadCache(port);
    const KEY = 'synth:sp26_probe';

    port.setParam(KEY, '0.25');
    eq('the first read answers what the port holds', cache.get(KEY), '0.25');

    port.setParam(KEY, '0.75');
    eq('a write movy made is visible on the very next read', cache.get(KEY), '0.75');

    /* The same, for the two other faces of one parameter: Schwung reads a
     * modulated cell as `k:base` and its driven value as `k:effective`, so a
     * write to `k` has to take all three. */
    globalThis.shadow_set_param(0, KEY + ':base', '0.75');
    eq('and its :base reads through', cache.get(KEY + ':base'), '0.75');
    port.setParam(KEY, '0.1');
    globalThis.shadow_set_param(0, KEY + ':base', '0.1');
    eq('a write takes the parameter’s other faces with it',
       cache.get(KEY + ':base'), '0.1');

    /* Back into the cache after that write, so the control below is testing
     * the cache and not an entry the write had just dropped. */
    eq('and the parameter itself reads back', cache.get(KEY), '0.1');

    /*
     * A NO-ANSWER IS NEVER CACHED, AND THIS IS THE CHECK THAT COST A PAGE.
     *
     * null is the channel saying it did not answer — the state the controller's
     * tri-state re-asks about — while "" is a real answer and is cached like any
     * other. Cache the null and "I do not know yet" becomes "there is nothing
     * there" for the rest of the epoch: measured in app-loop, a module that
     * arrived while the grid was off screen was read as having NO hierarchy, so
     * the controller paginated `chain_params` into one page and the jog had
     * nowhere to go. The burn-down grew 6 -> 7 on exactly that.
     */
    const ABSENT = 'synth:sp26_absent';
    eq('a key nobody serves reads as no answer', cache.get(ABSENT), null);
    globalThis.shadow_set_param(0, ABSENT, '0.5');
    eq('...and the value that arrives is seen at once, not after a fill',
       cache.get(ABSENT), '0.5');

    /* THE CONTROL, without which every check above passes with no cache at all:
     * a value that moved behind movy's back — the engine's own LFO, another
     * writer — is NOT seen until the next fill, and then it is. */
    globalThis.shadow_set_param(0, KEY, '0.9');
    eq('a change movy did not make waits for the fill', cache.get(KEY), '0.1');
    for (let i = 0; i < 8; i++) cache.tick();
    eq('...and the fill picks it up', cache.get(KEY), '0.9');
}

_log('\nTest: both embedded modes, and the off stand-in, use ONE rect');
{
    /* `body` and `page` embed the same grid under the same chrome, and the off
     * stand-in has to stay surface-identical. Three copies of two numbers is
     * how they came to disagree by 2 px in the first place. */
    const { GRID_BODY_RECT } = await import('../../dist/esm/renderer/layout.js');
    const { BODY_Y, BODY_H } = await import('../../dist/esm/renderer/schwung-body.js');
    eq('body mode shares the rect’s y', BODY_Y, GRID_BODY_RECT.y);
    eq('body mode shares the rect’s h', BODY_H, GRID_BODY_RECT.h);
}

}
