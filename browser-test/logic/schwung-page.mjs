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
         setSchwungGridMode, countTrips } from './harness.mjs';

export async function run() {

if (!schwungLibAvailable()) {
    _log('\nlogic: schwung page mode — SKIPPED (no param_pages; set SCHWUNG=)');
    return;
}

_log('\nlogic: schwung page mode');

const { surfaceOf } = await import('../../dist/esm/renderer/schwung-voices.js');
const { setSurfaceReader } = await import('../../dist/esm/model/drum-declared.js');
const { pageOwnerOf } = await import('../../dist/esm/app/page-owner.js');
const { headerRightText } = await import('../../dist/esm/renderer/knob-view.js');
const { dumpFixture } = await import('../dump-fixture.mjs');

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

/* `countTrips` is the shared counter — harness.mjs owns what a round trip is,
 * and the contract suite budgets against the same one. */

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

/* ── SP-14: a rack movy has a config for, under a delegated page ──────────── */

_log('\nTest: a rack that declares nothing is paged from movy’s own config');
{
    /*
     * CAUSE E, END TO END. 6W6 publishes no `ui_hierarchy` at all, so Schwung
     * planned it from `chain_params`: ten pages named "Params" to "Params - 10",
     * no level on any of them, and a pad press with nowhere to jump — while
     * movy's own header went on naming the right pad, which is what made it
     * look like it should be working.
     *
     * The config is the SHIPPED one (browser-test/env.mjs serves
     * src/module-configs through host_read_file), so this asserts against the
     * file that deploys rather than a fixture that agrees with the code.
     */
    setSchwungGridMode('page');
    schwungGridReload();
    env.setParams(MOCK_SYNTHS['6w6']);

    const p = schwungPageFor(0, 'synth');
    for (let i = 0; i < 12 * 60 && !p.ready; i++) p.tick();
    ok('the page resolved', p.ready);

    const names = (p.ctl.pages || []).map((x) => x.name).join(',');
    eq('every bank is a page, in the config’s order', names,
       'Kick,Snare,Lo Tom,Hi Tom,Cl Hat,Op Hat,Cymbal,Clap,Reverb,Delay,Master');

    /* THE FOLLOW. `focusVoice` is movy's pad press arriving at the delegated
     * page: voice -> level -> page. It is the half that reads the contract a
     * SECOND time, so a translation that reached only the planner would leave
     * this false and the page parked on the kick. */
    p.goToPage(0);
    ok('a pad press moves the page', p.focusVoice(3));
    eq('...to the voice it hit', p.ctl.pages[p.pageIndex].name, 'Lo Tom');
    ok('and the last pad reaches the last voice', p.focusVoice(8));
    eq('...which is the clap', p.ctl.pages[p.pageIndex].name, 'Clap');

    /* A PAGE IS NOT A VOICE. Reverb sits at bank 9 with no pad behind it; a
     * ninth pad addresses nothing, and must not scroll the page to it. */
    const before = p.pageIndex;
    eq('a pad the rack does not have moves nothing', p.focusVoice(9), false);
    eq('...and the page stayed put', p.pageIndex, before);

    schwungGridReload();
    setSchwungGridMode(null);
    env.setParams(MOCK_SYNTHS.test16);
}

_log('\nTest: a module that declares its own hierarchy is never spoken for');
{
    /*
     * THE TRANSLATION IS A FALLBACK, AND THIS IS WHERE THAT IS ENFORCED. Same
     * module, same shipped config — but the module now publishes a contract of
     * its own, and it must be the one that plans. movy filling in where a module
     * said nothing is the migration's direction; movy OVERRIDING what a module
     * said would be the second implementation this whole exercise removes,
     * reinstalled one layer down.
     *
     * 6W6 is the subject precisely because its config WOULD translate: a module
     * whose config movy cannot use proves nothing here.
     */
    setSchwungGridMode('page');
    schwungGridReload();
    env.setParams({
        ...MOCK_SYNTHS['6w6'],
        'synth:ui_hierarchy': JSON.stringify({
            levels: { root: { name: 'Mine', knobs: ['bd_tune', 'bd_decay'] } },
        }),
    });

    const p = schwungPageFor(0, 'synth');
    for (let i = 0; i < 12 * 60 && !p.ready; i++) p.tick();
    ok('the page resolved', p.ready);
    /* The KEYS, not the page name: the planner titles a root-only contract
     * "Main" itself, so a name check would assert its chrome rather than whose
     * contract it planned. Two knobs the module declared, against the eight the
     * config's Kick bank would have put here \u2014 and one page, not eleven. */
    eq('the module\u2019s own contract plans it', p.pageCount, 1);
    eq('...with the knobs IT declared',
       [p.keyAt(0), p.keyAt(1), p.keyAt(2)].join(','), 'bd_tune,bd_decay,');
    eq('a pad has no voice to follow, because the module declared none',
       p.focusVoice(1), false);

    schwungGridReload();
    setSchwungGridMode(null);
    env.setParams(MOCK_SYNTHS.test16);
}

_log('\nTest: the header names the page — on a declared drum rack too');
{
    /*
     * WHAT THE HEADER'S RIGHT-HAND END SAYS (SP-37), ON THE MODULE THAT MADE
     * IT WRONG. `vm.drumPadName` is the focused pad's name — a property of the
     * MODULE, not of the page — so a precedence that lets it lead prints one
     * word for the whole module: the jog moves the bar and the body while the
     * only text that says where you are stands still. That was the report's
     * symptom, and it was still true on a declared drum rack after the first
     * fix.
     *
     * THE RACK IS THE DEVICE'S OWN. `voice-poc` in `docs/module-dump/` declares
     * `pad_layout: "drums"` with named voices AND a page per voice, so the
     * pad's own page and the page on screen are two different names without a
     * mock inventing the difference — and the assertion below is stated over
     * WHICH of the two names came out, page by page, so it holds for a rack
     * whose names change.
     */
    setSurfaceReader(surfaceOf);
    setSchwungGridMode('page');
    schwungGridReload();
    const m = bootModel(dumpFixture('voice-poc'));
    for (let i = 0; i < 20; i++) m.tick();
    m.updateDrumPad(2, 38);            /* pad 2 is "Snare" on this rack */
    const p = schwungPageFor(0, 'synth');
    for (let i = 0; i < 12 * 60 && !p.ready; i++) { p.tick(); m.tick(); }
    ok('the rack’s page resolved', p.ready);

    const pad = m.getViewModel().drumPadName;
    ok('the rack named the focused pad', pad.length > 0, JSON.stringify(pad));
    ok('...and it is not the module’s first page’s name',
       pad !== p.chrome(true).pageLabel, JSON.stringify(p.chrome(true).pageLabel));

    const own = [], other = [], words = [];
    for (let i = 0; i < p.pageCount; i++) {
        p.goToPage(i);
        const label = p.chrome(true).pageLabel;
        if (label === null) continue;      /* nothing to name this page with */
        const drawn = headerRightText(m.getViewModel(), p.chrome(true));
        eq('page ' + i + ' draws its own name', drawn, label);
        words.push(drawn);
        (label === pad ? own : other).push({ label, drawn });
    }
    /* Both halves of the ruling, on one module: the page that IS the pad's own
     * — where the pad's name wins because the page's label carries the same
     * word — and every page that is not, where the label wins and the pad's
     * name would have hidden it. */
    ok('one of those pages IS the pad’s own', own.length > 0, JSON.stringify(own));
    ok('and another is not', other.length > 0, JSON.stringify(other));
    for (const q of other) ok('...and there the pad’s name did NOT win',
        q.drawn !== pad, JSON.stringify(q));

    /* THE REQUIRED BEHAVIOUR, IN ONE LINE: the text MOVES when the jog does.
     * With the pad's name leading, `words` is one repeated string. */
    ok('the header’s right-hand end CHANGES across the pages of one module',
       new Set(words).size > 1, JSON.stringify(words));

    /* AND WHERE THERE IS NO PAGE, THE PAD FALLS BACK IN — `off`, and every
     * frame whose delegated page is not the body. */
    eq('no chrome, the pad’s name stands',
       headerRightText(m.getViewModel(), undefined), pad);

    p.goToPage(0);
    schwungGridReload();
    setSchwungGridMode(null);
    setSurfaceReader(null);
    env.setParams(MOCK_SYNTHS.test16);
}

_log('\nTest: the header readout and the footer hints come from the controller');
{
    /*
     * THE BANDS MOVY KEEPS. `bands.header`/`bands.footer` stay false — Schwung's
     * own chrome needs 56 rows and movy leaves 54 — so movy draws both, and the
     * one thing it must not do is INVENT what they say. The header is
     * `describePage().header.left`, built by the same `movyHeaderFor` the
     * shadow host draws its own with. The footer's WORDS are movy's (Schwung's
     * vocabulary lives in the shadow-side host, which movy may not import) and
     * its every CONDITION is the controller's.
     *
     * So the assertion with teeth is not "the footer says OPEN" — that is the
     * code read back to itself. It is that the verb it prints is the
     * CONSEQUENCE the click actually has, observed by clicking.
     */
    setSchwungGridMode('page');
    schwungGridReload();
    env.setParams(MOCK_SYNTHS['6w6']);
    const p = schwungPageFor(0, 'synth');
    for (let i = 0; i < 12 * 60 && !p.ready; i++) p.tick();
    ok('the page resolved', p.ready);

    const showed = p.chrome(true);
    eq('nothing held, no readout — movy’s own header stands',
       showed.header === null && showed.footer === null, true);

    /* THE HEADER'S RIGHT-HAND END IS THE PAGE'S NAME (SP-37), and it is the
     * CONTROLLER's answer rather than `page.name`: a page belonging to a child
     * level is named after WHICH CHILD it shows, which the planned name cannot
     * know. Checked against the controller at the index that is on screen, and
     * then against its own earlier value one page later — the reported symptom
     * is a label that NEVER MOVES while the bar and the body do, and "it equals
     * the line we just wrote" is not a claim about that. */
    const label0 = showed.pageLabel;
    ok('the chrome carries the page’s own name',
       typeof label0 === 'string' && label0.length > 0, JSON.stringify(label0));
    eq('...and it is the controller’s, for the page on screen',
       label0, p.ctl.pageLabel());
    p.changePage(1);
    ok('...and the jog moves it',
       p.chrome(true).pageLabel !== label0,
       'still ' + JSON.stringify(p.chrome(true).pageLabel) + ' one page on');
    p.goToPage(0);

    /* AND THE `off` HALF, FROM THE APP'S OWN OWNER. Under `off` there is no
     * delegated page at all — `owner.page` is null — and the app's
     * `schwungChromeFor` is `body && owner.page ? owner.page.chrome(paging)
     * : undefined`, so the renderer is handed no object and its
     * `chrome?.pageLabel` cannot fire: the header stays the bank name it was
     * before this item, which is what "where the delegated page is not what is
     * drawn, nothing changes" means in code.
     *
     * THE PAIRED ASSERTION IS WHAT GIVES THIS TEETH: the same model and the
     * same settled page are delegated while the grid pages them, and movy's own
     * the moment the grid is off. Asserted on the OWNER rather than on the
     * renderer's null-coalescing — a blank header test would pass for a label
     * that was never there. */
    const offModel = bootModel(MOCK_SYNTHS['6w6']);
    for (let i = 0; i < 20; i++) offModel.tick();
    ok('while the grid pages, this model’s page is delegated',
       pageOwnerOf(offModel).page !== null);
    setSchwungGridMode(null);
    eq('the grid off, the page is movy’s own — no chrome can name a page',
       pageOwnerOf(offModel).page, null);
    setSchwungGridMode('page');

    const bound = [];
    for (let k = 0; k < 8; k++) if (p.keyAt(k)) bound.push(k);
    ok('the page has knobs to hold', bound.length > 0);
    eq('a knob over an unbound cell says nothing either',
       p.chrome(true).header, null);

    const k = bound[0];
    p.knobTouch(k, true);
    const held = p.chrome(true);
    const own = p.ctl.describePage({}).header;
    eq('held, the readout is the controller’s own, verbatim',
       held.header && held.header.left, own.left);
    eq('...and its second half too', held.header && held.header.right, own.right);
    ok('...and it is the branch that says a param is under the hand',
       !!(held.header && held.header.inverted));
    ok('...beside a hint band', Array.isArray(held.footer) && held.footer.length > 0);
    eq('the chain view keeps its own footer, where the jog is not paging',
       p.chrome(false).footer, null);
    eq('...but the readout is still the page’s',
       p.chrome(false).header.left, held.header.left);
    p.knobTouch(k, false);
    eq('and letting go takes the band with it', p.chrome(true).footer, null);
    /* THE CLICK IS THE SUBJECT. One knob at a time, and the verb printed for it
     * has to match what pressing the jog DOES to the parameter — an `open`
     * intent, a flip, a write, or nothing at all. Asserting the verb the code
     * chose would be the code read back to itself; asserting it against the
     * consequence is what catches a footer that promises OPEN on a cell whose
     * click does nothing.
     *
     * A page of floats exercises only the fallback, so the walk runs over a
     * whole module's pages and the tally at the end is the point: a run where
     * every verb was MENU proves the default and nothing about the branches
     * this file exists for.
     *
     * A TRIGGER'S WRITE LEAVES NO TRACE — it bangs and returns to idle — so the
     * fire branch is read from the parameter's own declaration, not from the
     * value map. The flip branch IS read from the consequence, and that is the
     * half with teeth: a two-way enum that moved while the footer said
     * something else fails here. */
    const verbs = new Set();
    const walk = (name, params) => {
        env.setParams(params);
        schwungGridReload();
        const pg = schwungPageFor(0, 'synth');
        for (let i = 0; i < 12 * 60 && !pg.ready; i++) pg.tick();
        ok(name + ': the page resolved', pg.ready);
        for (let page = 0; page < pg.pageCount; page++) {
            pg.goToPage(page);
            for (let slot = 0; slot < 8; slot++) {
                const key = pg.keyAt(slot);
                if (!key) continue;
                pg.knobTouch(slot, true);
                const foot = pg.chrome(true).footer.find((h) => h[0] === 'CLK');
                const before = JSON.stringify(pg.ctl.state.values);
                const intent = pg.click();
                const wrote = before !== JSON.stringify(pg.ctl.state.values);
                const meta = pg.ctl.metaAt(slot);
                const twoWay = !!(meta && Array.isArray(meta.options)
                                  && meta.options.length === 2);
                const want = (intent && intent.action === 'open') ? 'OPEN'
                           : (meta && meta.writeOnly) ? 'FIRE'
                           : (twoWay && wrote) ? 'FLIP' : 'MENU';
                eq(name + ' ' + key + ' hands the click to ' + want,
                   foot ? foot[1] : null, want);
                verbs.add(want);
                pg.knobTouch(slot, false);
            }
        }
    };
    walk('switches', MOCK_SYNTHS.switches);
    ok('a two-way enum was reached, so the flip branch ran (' + [...verbs].join('/') + ')',
       verbs.has('FLIP'));
    ok('and a trigger, so the fire branch ran', verbs.has('FIRE'));

    schwungGridReload();
    setSchwungGridMode(null);
    env.setParams(MOCK_SYNTHS.test16);
}

_log('\nTest: under `page` the plan is the module’s declaration, and nothing else');
{
    /* The burn-down's remaining labels are a FIXTURE limit: the suite's mrdrums
     * mock declares no `ui_hierarchy`, so the plan is one fallback page named
     * Main while movy's config has four banks. That is a statement about the
     * MOCK unless the REAL shape is read back too — and the real shape is what
     * SP-30's default flip will meet. `docs/module-dump/…--mrdrums.json` has it:
     * `ui_preset_path` (root level, in `params`) and `pad_sample_path` (the
     * `pad_settings` level) are both `type: "filepath"` — real DSP params
     * mrdrums declares for ITSELF. So "a movy-config file param can never be on
     * a Schwung page" is false, and the true statement is narrower: what has no
     * page under `page` is whatever exists ONLY in movy's config. Both halves
     * are asserted here because only the pair says which is which. */
    setSchwungGridMode('page');
    schwungGridReload();
    env.setParams({ ...MOCK_SYNTHS.mrdrums,
        'synth:ui_hierarchy': JSON.stringify({
            levels: {
                root: { name: 'MrDrums', knobs: ['pad_vol'],
                        params: [{ label: 'Pad Settings', level: 'pad_settings' },
                                 'ui_preset_path'] },
                pad_settings: { name: 'Pad Settings', knobs: ['pad_vol'],
                                params: ['pad_sample_path', 'pad_vol'] },
            },
        }),
        'synth:chain_params': JSON.stringify([
            { key: 'ui_preset_path',  name: 'Load Preset', type: 'filepath', default: '' },
            { key: 'pad_sample_path', name: 'Sample',      type: 'filepath', default: '' },
            { key: 'pad_vol',         name: 'Volume',      type: 'float', min: 0, max: 2, step: 0.01 },
        ]),
    });
    const declared = schwungPageFor(0, 'synth');
    for (let i = 0; i < 12 * 60 && !declared.ready; i++) declared.tick();

    eq('the declared plan resolved', declared.ready, true);
    eq('a declared level becomes its own page',
       declared.ctl.pages.map((x) => x.name).join(','), 'Main,Pad Settings');
    eq('and the declared filepath IS a page key',
       declared.ctl.pages.map((x) => (x.keys || []).join('+')).join(','),
       'pad_vol,pad_sample_path');
    const fm = declared.ctl.metaIndex.getOrGuess('pad_sample_path');
    eq('so a click on it is a dive, which is the route `off` gets from movy’s config',
       !!(fm && fm.divable), true);

    /* THE OTHER HALF IS NOT HERE, and deliberately. A page built for a module
     * that declares NOTHING does not resolve outside the app (measured: this
     * harness leaves `ready=false` and `pages=[]` for `MOCK_SYNTHS.mrdrums`),
     * so its half of the pair is read back where the app is running:
     * `app-loop.mjs`'s permanent `[page-plan]` line prints `ctlPages=1
     * names=["Main"]` against `movyBanks=4` for exactly this fixture, on BOTH
     * arms. That line is cited by the burn-down section and by
     * `page-mode-expected-fail.json`; this test is the other half — the
     * declaration that makes the route exist. */

    schwungGridReload();
    setSchwungGridMode(null);
    env.setParams(MOCK_SYNTHS.test16);
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
