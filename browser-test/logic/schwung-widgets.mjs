/* schwung-widgets.mjs — what movy decides about a module's own widget.
 *
 * SP-28. Three of that item's four defects are on movy's side of the registry
 * door — which kinds an overlay publishes, which script the module ships them
 * in, and the clearing that has to precede a registration — and all three are
 * decidable with no Schwung checkout at all. They are also the three that fail
 * QUIETLY: a module drawing a built-in dial instead of its own art is a
 * perfectly reasonable-looking page, and nothing else in the repo notices.
 *
 * So this suite drives the REAL entry points (registerModuleWidgets, findOverlay,
 * loadOverlay, overlayWidgets) with the two device globals they touch faked:
 * `host_read_file`, which serves the module layout, and `shadow_load_ui_module`,
 * which is how a canvas.js gets EVALUATED rather than parsed. Nothing here
 * imports widget_registry.mjs by its own specifier — see the header of
 * schwung-widgets.ts for what that costs — and nothing here registers into a
 * second copy of a process-global map.
 *
 * WHAT THIS SUITE CANNOT SEE, and it is not pretended otherwise: the registry
 * exists only where the library does, so "the kinds movy handed over are the
 * ones that draw" is asserted where the library is — on the device
 * (test-device/scenarios/widgets.ts) and in scripts/schwung-widgets-check.mjs,
 * both of which drive the same entry point. Without a checkout the door answers
 * "no", and that answer IS the fall-through: it is asserted below instead.
 *
 * Run by browser-test/logic.mjs.
 */
import { eq, _log, schwungLibAvailable } from './harness.mjs';
import { overlayWidgets, declaresCustomWidget, registerModuleWidgets,
         registerWidget, clearWidgets, isWidgetAvailable }
    from '../../dist/esm/renderer/schwung-widgets.js';
import { findOverlay, loadOverlay } from '../../dist/esm/renderer/schwung-canvas.js';
import { createWidgetSync } from '../../dist/esm/renderer/schwung-page-widget-sync.js';

const MODULES = '/data/UserData/schwung/modules';

/* The fixture lives in two mutable maps, so a block can set up a case without
 * building a new mock: `layout` is what `host_read_file` serves (a module.json
 * per directory) and `scripts` is what evaluating a canvas.js would have left in
 * movy's globals. `asked` is the other half of every resolution assertion —
 * WHICH path movy asked for is the only way to see the search at all. */
const layout = {};
const scripts = {};
const asked = [];

/* INSTALLED INSIDE run(), NOT AT MODULE SCOPE. logic.mjs imports every suite
 * before running any of them, so a global assigned out here is assigned before
 * the FIRST suite's turn — and `host_read_file` is the harness's: it is how
 * every module layout in the repo is served (env-identity asserts exactly that,
 * and schwung-page pages a rack from the `movy_config.json` it reads). A fake
 * installed at load time answers null for both, with the whole suite still
 * looking like it ran. So the mock is a lifetime, not a file. */
let realRead = null;
function installFakes() {
    realRead = globalThis.host_read_file;
    globalThis.shadow_load_ui_module = (p) => {
        asked.push(p);
        const globals = scripts[p];
        if (!globals) return false;             /* the file is not there */
        for (const k of Object.keys(globals)) globalThis[k] = globals[k];
        return true;
    };
    globalThis.host_read_file = (p) => layout[p] ?? null;
}

function only(files, table) {
    for (const k of Object.keys(layout)) delete layout[k];
    for (const k of Object.keys(scripts)) delete scripts[k];
    asked.length = 0;
    Object.assign(layout, files);
    Object.assign(scripts, table || {});
}

export async function run() {
    installFakes();
    try { await suite(); } finally { restoreFakes(); }
}

/* THE FAKES COME OUT WHATEVER HAPPENS. `host_read_file` is the harness's and
 * every suite after this one is served a module layout by the real one —
 * env-identity asserts exactly that, and schwung-page pages a rack from the
 * `movy_config.json` it reads. An exception mid-suite that left the fake
 * installed would make the NEXT suite's failures look like its own. */
function restoreFakes() {
    globalThis.host_read_file = realRead;
    delete globalThis.shadow_load_ui_module;
    delete globalThis.myart;
    delete globalThis.canvas_overlay;
    delete globalThis.canvas_overlays;
}

async function suite() {
_log('\nlogic: module-supplied widgets (SP-28)');

/* Every direct call below is one page's ask, so they share one owner — the same
 * `(track, component)` the page cache keys by. The block that asserts what an
 * owner scopes builds its own. */
const OWNER = '0:synth';

/* ── the shapes an overlay may publish ─────────────────────────────────────── */
/* Mirrored from upstream's registerOverlayWidgets. Which shape a module uses is
 * the module author's choice, and a shape movy does not understand registers
 * NOTHING while the page still looks reasonable. */
{
    const ctx = () => ({});
    const ov = { widgetKind: 'custom:a', drawCell() { return this === ov; } };
    const one = overlayWidgets(ov);
    eq('the legacy single kind still registers', one.length, 1);
    eq('...under its own name', one[0].kind, 'custom:a');
    eq('...with drawCell bound to the overlay it came from', one[0].draw(), true);

    /* THE DEFECT: hank declares BOTH, and a module following today's docs
     * declares only the array. movy read the singular alone, so that module
     * registered nothing and its cell drew a built-in. */
    const many = overlayWidgets({ widgetKinds: ['custom:a', 'custom:b'], drawCell: ctx });
    eq('an array-only declaration registers every kind it names',
       many.map((w) => w.kind).join(','), 'custom:a,custom:b');
    eq('...all of them drawing the one drawCell',
       many.every((w) => w.draw === many[0].draw), true);

    const fn = (c) => c;
    const obj = overlayWidgets({ widgetKinds: {
        'custom:a': fn,
        'custom:b': { drawCell: fn, nominal: { w: 2, h: 3 } },
        'custom:c': { draw: fn, widgetNominal: { w: 1, h: 1 } },
    } });
    eq('an object declaration registers each entry',
       obj.map((w) => w.kind).join(','), 'custom:a,custom:b,custom:c');
    eq('...a bare function being a drawer', typeof obj[0].draw, 'function');
    eq('...and each entry carrying its own nominal', JSON.stringify(obj[1].nominal), '{"w":2,"h":3}');
    eq('...or the widgetNominal spelling', JSON.stringify(obj[2].nominal), '{"w":1,"h":1}');

    /* A module may spell both, and the explicit entry is the richer one. The
     * ORDER is the assertion, not object identity: the entries are bound to the
     * overlay they came from, so `===` against the published function is false
     * whichever one is last. Read as behaviour instead — the registry keys on
     * the kind, so whichever entry is written last is the one that draws. */
    const both = overlayWidgets({ widgetKind: 'custom:same',
                                  drawCell() { return 'singular'; },
                                  widgetKinds: { 'custom:same': () => 'explicit' } });
    eq('a module spelling both keeps an entry per spelling', both.length, 2);
    eq('...and the explicit one is written last, so it is the one that draws',
       both[1].draw(), 'explicit');

    /* Everything unusable is DROPPED, never thrown: a kind that claims nothing
     * leaves its cell to the built-in, which is the fall-through. */
    eq('a built-in kind in the list is dropped',
       overlayWidgets({ widgetKinds: ['lin', 'custom:a'], drawCell: ctx }).length, 1);
    eq('a custom kind with no drawer is dropped',
       overlayWidgets({ widgetKinds: ['custom:a'] }).length, 0);
    eq('an object entry that is neither drawer nor object is dropped',
       overlayWidgets({ widgetKinds: { 'custom:a': 42 } }).length, 0);
    eq('a widgetKinds that is a bare string is dropped',
       overlayWidgets({ widgetKinds: 'custom:a', drawCell: ctx }).length, 0);
    eq('nothing at all is nothing', overlayWidgets(null).length, 0);
    eq('and neither is a string', overlayWidgets('custom:a').length, 0);

    eq('the contract is read for custom: kinds only',
       declaresCustomWidget([{ viz: { kind: 'custom:x' } }, { viz: { kind: 'lin' } }]), true);
    eq('...and a contract with none says so',
       declaresCustomWidget([{ viz: { kind: 'lin' } }, { viz: { kind: 'lfo' } }]), false);
}

/* ── which script the module ships, and which global it left behind ────────── */
{
    /* hank's own spelling, both halves of it: the singular AND the array, with
     * the one drawCell the array needs. A kind published with no drawer is
     * dropped by design (asserted above), so a fixture without one would be
     * testing the drop rather than the resolution. */
    only({ [`${MODULES}/sound_generators/hank/module.json`]:
             JSON.stringify({ capabilities: { canvas_script: 'canvas.js' } }) },
         { [`${MODULES}/sound_generators/hank/canvas.js`]:
             { canvas_overlay: { widgetKind: 'custom:hank_wave',
                                 widgetKinds: ['custom:hank_wave'],
                                 drawCell() { /* hank's own art */ } } } });
    const ov = findOverlay('hank');
    eq('the module.json capability is what names the script', asked[0],
       `${MODULES}/sound_generators/hank/canvas.js`);
    eq('...and the overlay it published is handed back',
       overlayWidgets(ov)[0].kind, 'custom:hank_wave');

    /* A module that names nothing gets the DEFAULT, not nothing. */
    only({ [`${MODULES}/audio_fx/plain/module.json`]: JSON.stringify({ name: 'Plain' }) });
    findOverlay('plain');
    eq('a module naming no script gets canvas.js', asked[0], `${MODULES}/audio_fx/plain/canvas.js`);

    /* ANY file, not a literal one: movy hard-coded canvas.js, so a module that
     * shipped its art under a name of its own was never loaded. */
    only({ [`${MODULES}/audio_fx/named/module.json`]:
             JSON.stringify({ canvas_script: 'art/wave.js' }) });
    findOverlay('named');
    eq('a module that names another file gets that file', asked[0],
       `${MODULES}/audio_fx/named/art/wave.js`);

    /* The `#ref` names a GLOBAL, not a file: the script is still canvas.js and
     * the overlay is the one the module pointed at. pushnpull ships exactly
     * this spelling on the device. */
    only({ [`${MODULES}/audio_fx/ref/module.json`]:
             JSON.stringify({ capabilities: { canvas_script: 'canvas.js#myart' } }) },
         { [`${MODULES}/audio_fx/ref/canvas.js`]: {
             canvas_overlay: { widgetKind: 'custom:wrong', drawCell() { return 'conventional'; } },
             myart:          { widgetKind: 'custom:right', drawCell() { return 'named'; } },
         } });
    const refOv = findOverlay('ref');
    eq('the fragment is not part of the filename', asked[0],
       `${MODULES}/audio_fx/ref/canvas.js`);
    eq('...it names the global the module published',
       overlayWidgets(refOv)[0].kind, 'custom:right');
    eq('...and with no fragment the conventional global is the one read',
       overlayWidgets(loadOverlay(`${MODULES}/audio_fx/ref/canvas.js`))[0].kind, 'custom:wrong');

    /* THE SEARCH. A module's category is not in its id, so the name is resolved
     * per directory — and the whole contract of the loop is that a miss is not
     * an error, because the fall-through draws a built-in. */
    only({ [`${MODULES}/midi_fx/pixel-walkers/module.json`]: '{}' },
         { [`${MODULES}/midi_fx/pixel-walkers/canvas.js`]:
             { canvas_overlay: { widgetKind: 'custom:walk', drawCell() { /* walk */ } } } });
    eq('a module in a category directory is found in it',
       overlayWidgets(findOverlay('pixel-walkers')).length, 1);
    eq('...under its category, not the root', asked[0],
       `${MODULES}/midi_fx/pixel-walkers/canvas.js`);

    only({ [`${MODULES}/rootmod/module.json`]: '{}' });
    findOverlay('rootmod');
    eq('a module sitting at the modules root is found there',
       asked[0], `${MODULES}/rootmod/canvas.js`);

    /* First directory with a module.json wins: that is schwung's own rule, and
     * the only directory its host would call the module's. */
    only({ [`${MODULES}/other/dup/module.json`]: '{}',
           [`${MODULES}/sound_generators/dup/module.json`]: '{}' });
    findOverlay('dup');
    eq('...and a module in two categories is asked for once', asked.length, 1);

    /* A MODULE THAT IS NOWHERE IS A MISS, NOT AN ERROR — and a module that is
     * there but whose script does not load is the same answer, because that is
     * what a module still being installed looks like. */
    only({});
    eq('a module in no directory yields no overlay', findOverlay('ghost'), null);
    eq('...without the loader being asked at all', asked.length, 0);
    only({ [`${MODULES}/tools/broken/module.json`]: '{}' });
    eq('a script that does not load yields no overlay', findOverlay('broken'), null);

    /* A HOST READ THAT THROWS IS ALSO A MISS. The caller that matters has no try
     * of its own — the contract's divider asks for a module's overlay on a tick
     * — so an unguarded `host_read_file` that throws escapes into the host's tick
     * loop. schwung-canvas.ts says "NOTHING HERE THROWS" in its header; this line
     * is what holds it, and it fails the moment `readFile` stops catching. */
    const hostRead = globalThis.host_read_file;
    globalThis.host_read_file = () => { throw new Error('the host refused the read'); };
    let escaped = '';
    try { findOverlay('broken'); } catch (e) { escaped = String((e && e.message) || e); }
    globalThis.host_read_file = hostRead;
    eq('a host read that throws is a miss, not an exception', escaped, '');

    /* AN ABSOLUTE PATH is the module's own business; upstream honours one. */
    only({ [`${MODULES}/tools/abs/module.json`]:
             JSON.stringify({ canvas_script: '/tmp/elsewhere/art.js' }) });
    findOverlay('abs');
    eq('an absolute script path is not joined to the module directory',
       asked[0], '/tmp/elsewhere/art.js');
}

/* ── the entry point: what it reads, and what it refuses to decide ─────────── */
{
    const hank = () => only(
        { [`${MODULES}/sound_generators/hank/module.json`]:
            JSON.stringify({ capabilities: { canvas_script: 'canvas.js' } }) },
        { [`${MODULES}/sound_generators/hank/canvas.js`]:
            { canvas_overlay: { widgetKinds: ['custom:hank_wave'],
                                drawCell() { /* hank's own art */ } } } });
    const declares = [{ key: 'ratio', viz: { kind: 'custom:hank_wave' } }];
    const nothing = [{ key: 'cutoff', viz: { kind: 'filter' } }];

    /* THE MODULE ID IS A READ, SO THE SUITE COUNTS IT. It is a blocking host
     * round trip and this runs on the page's divider, so "was the id asked for"
     * is a cost assertion, not a detail: grid-cost measured the delegated
     * page's idle floor 75 trips over its ceiling when an eager id was read on
     * every divider. Two of the cases below turn on it. */
    let reads = 0;
    const idOf = (v) => () => { reads++; return v; };

    /* AN EMPTY CONTRACT IS NOT AN ANSWER. A chain component always declares
     * something, so an empty array is a read that has not arrived — and reading
     * "declares no custom kind" out of it, then latching that, is how the
     * widget never appeared on Schwung's own host, twice. Nothing is read. */
    hank(); reads = 0;
    eq('an empty contract is not a verdict', registerModuleWidgets(OWNER, idOf('hank'), []), false);
    eq('...nor is a null one', registerModuleWidgets(OWNER, idOf('hank'), null), false);
    eq('...nor an undefined one', registerModuleWidgets(OWNER, idOf('hank'), undefined), false);
    eq('...and the module was never identified for any of them', reads, 0);
    eq('...nor was a script read', asked.length, 0);

    /* A module that declares no custom kind is a FINISHED answer, and it is the
     * COMMON one — every module that ships no art. It settles by its own
     * contract, without a file read AND without a module id: that is what keeps
     * a page whose module has no widget as cheap as one with no page at all. */
    hank(); reads = 0;
    eq('a module declaring no custom kind is settled',
       registerModuleWidgets(OWNER, idOf('plain'), nothing), true);
    eq('...without the module being identified', reads, 0);
    eq('...and without a script being read', asked.length, 0);

    /* A MODULE THAT CANNOT BE NAMED IS NOT "NO MODULE". The id read is an IPC
     * round trip that fails by answering empty; taking that for "declares
     * nothing" would settle a module that has art on the strength of a timeout.
     * Not settled, so the caller asks again. */
    reads = 0;
    eq('a module with no id is not a verdict either', registerModuleWidgets(OWNER, idOf(''), declares), false);
    eq('...and it did ask, which is the difference', reads, 1);
    eq('...reading no script on the strength of a failed read', asked.length, 0);

    /* THE DEFECT, END TO END THROUGH THE ENTRY POINT: a module whose contract
     * declares a custom kind is registered, out of the script its module.json
     * names, and the answer is settled. */
    hank(); reads = 0;
    eq('a module whose contract declares a custom kind is registered',
       registerModuleWidgets(OWNER, idOf('hank'), declares), true);
    eq('...identified once, and only because a custom kind was declared', reads, 1);
    eq('...from the script its module.json names', asked[0],
       `${MODULES}/sound_generators/hank/canvas.js`);

    /* ...and a module whose art cannot be read is NOT settled, so the caller
     * keeps asking. A false must never latch: that is the whole retry story. */
    hank();
    delete layout[`${MODULES}/sound_generators/hank/module.json`];
    eq('a module that is not where we looked stays open',
       registerModuleWidgets(OWNER, idOf('hank'), declares), false);
}

/* ── the trigger: when the question is asked, and when it is parked ────────── */
{
    /* DEFECT 3, LOCALLY. Registration used to hang off reload() alone, so a
     * module SWAPPED into a slot — which reaches the contract through the
     * controller's cheap re-plan, not through a reload — was never asked about,
     * and the cell kept the departed module's art. `afterReplan(adopted)` is the
     * second trigger. Two observables, one per question: `asked` is the script
     * loads a registration costs, and the port's own read count is the blocking
     * host round trip the budget exists to bound. */
    const params = [{ key: 'ratio', viz: { kind: 'custom:hank_wave' } }];
    const ctl = { state: { chainParams: params } };
    only({ [`${MODULES}/sound_generators/hank/module.json`]: '{}' },
         { [`${MODULES}/sound_generators/hank/canvas.js`]:
             { canvas_overlay: { widgetKinds: ['custom:hank_wave'], drawCell() { /* art */ } } } });

    const w = createWidgetSync(ctl, { getParam: () => 'hank' }, 'ch0:synth');
    w.sync();
    eq('a reload registers the module in the slot', asked.length, 1);
    w.afterReplan(false);
    eq('...and a re-plan that changed nothing asks nothing again', asked.length, 1);
    w.afterReplan(true);
    eq('...while a re-plan that MOVED is the swap, and asks again', asked.length, 2);

    /* THE BUDGET IS A PARK, NOT AN ANSWER, and this is the assertion that says
     * so: a module that is NOWHERE is asked three times and then stops being
     * asked — with the question still open, because a false was never a verdict
     * — until a plan that moved re-opens it. Without the park, `sync` would read
     * the module key on every divider tick for as long as the tool is open. */
    let reads = 0;
    const missing = createWidgetSync(ctl, { getParam: () => { reads++; return 'ghost'; } }, 'ch0:synth');
    missing.sync();                 /* 1 */
    missing.afterReplan(false);     /* 2 */
    missing.afterReplan(false);     /* 3 — parked here */
    missing.afterReplan(false);     /* parked: no read */
    eq('a module that is nowhere is asked WIDGET_TRIES times and then parked', reads, 3);
    missing.afterReplan(true);
    eq('...and a plan that moved re-opens the parked question', reads, 4);

    /* ...and an empty contract is not an answer, so it is not even a read.
     *
     * IT HOLDS THE PAIR, NOT THE EARLY RETURN. Removing `sync`'s own empty-contract
     * guard does not redden this — measured — because the door takes the module id
     * as a READ and never fetches it for a contract with no custom kind. So what
     * fails here is a door that fetched the id eagerly, or `sync` that reached the
     * door at all with nothing to ask about; the two guards are one rule with two
     * halves, and this line is the joint. */

    let emptyReads = 0;
    const empty = createWidgetSync({ state: { chainParams: [] } },
                                   { getParam: () => { emptyReads++; return 'hank'; } }, 'ch0:synth');
    empty.sync();
    empty.afterReplan(true);
    eq('an empty contract asks nothing at all — not even which module this is — VACUOUS as the '
       + 'empty-contract guard\'s own coverage (removing that guard reddens nothing; the door never '
       + 'fetches the id for a contract with no custom kind); what it holds is the eager fetch and '
       + 'the reach, which is the joint of the pair',
       emptyReads, 0);
}

/* ── the door, with no registry behind it ──────────────────────────────────── */
{
    /* With no checkout the library never loads, and an absent library has to be
     * the SAME answer as an unregistered kind — nothing claims the cell and a
     * built-in draws. An exception here would turn the fall-through, which is
     * the safety story of this whole path, into a crash on the page. */
    let threw = '';
    try { registerWidget('custom:x', { draw: () => {} }); clearWidgets(); }
    catch (e) { threw = String(e); }
    eq('the door does not throw with no library behind it', threw, '');
    eq('...and answers "no such widget", which is the fall-through',
       isWidgetAvailable('custom:x'), false);

    /* THE ONE THING ABOUT THE CLEAR THAT CAN BE SAID WITHOUT A REGISTRY — AND IT
     * IS VACUOUS HERE, WHICH THE LABEL ITSELF SAYS, because a reader who takes
     * this line for the defect's coverage has been misled by a pass.
     *
     * Upstream clears per module because the registry is process-global and
     * shadow_ui is long-lived: a departed module's art would otherwise be
     * inherited by the next module declaring the same `custom:` name. With no
     * checkout the library never loads, so there is no map for a clear to empty
     * — the `registerWidget` above was already a caught throw — and this passes
     * whether or not `clearWidgets()` ran. The teeth for this defect are where a
     * registry exists: the device check `swap-away-leaves-nothing-behind`, and
     * `...and the departed module's kind is out of the registry` in
     * scripts/schwung-widgets-check.mjs — its CHECK, not the `fail()` message
     * that negates it, which a reader would only ever find in a red run. What
     * THIS line holds is only that the entry point keeps asking the door, which
     * is why it is kept. */
    registerWidget('custom:stale', { draw: () => {} });
    registerModuleWidgets(OWNER, () => 'plain', [{ key: 'cutoff', viz: { kind: 'filter' } }]);
    eq('a departed module\'s kind is not claimable — VACUOUS in this build (no registry to hold '
       + 'it); the teeth are the device check swap-away-leaves-nothing-behind',
       isWidgetAvailable('custom:stale'), false);
    _log(`    (registry behind the door in this build: ${schwungLibAvailable() ? 'yes' : 'no'})`);
}

/* ── one registry, several pages ───────────────────────────────────────────── */
{
    /* THE DEFECT: A PAGE THAT DECLARES NOTHING WIPED EVERY OTHER PAGE'S ART.
     *
     * The registry is process-global and its only removal is `clearWidgets()`,
     * which empties ALL of it — so the clear that keeps a DEPARTED module's kind
     * from being inherited also took the kind belonging to the component next
     * door. It never came back either: `sync` latches on a true, so the page
     * that registered it is never asked again until its own plan moves. Walking
     * one chain slot along and back was enough to lose hank's waveform for the
     * rest of the session.
     *
     * The owner is the page's identity — the same (track, component) the page
     * cache is keyed by — so a module swapped INTO a slot still replaces exactly
     * what the module before it left there. That is asserted below too, because
     * it is the property the clear existed for and the one a scoping fix is
     * most likely to drop.
     *
     * NEEDS THE REGISTRY, so it is asked only where there is one: with no
     * checkout `isWidgetAvailable` answers false for everything and every line
     * here would pass while testing nothing. It says which it did.
     */
    only({ [`${MODULES}/sound_generators/hank/module.json`]: '{}',
           [`${MODULES}/sound_generators/other/module.json`]: '{}' },
         { [`${MODULES}/sound_generators/hank/canvas.js`]:
             { canvas_overlay: { widgetKinds: ['custom:hank_wave'], drawCell() { /* art */ } } },
           [`${MODULES}/sound_generators/other/canvas.js`]:
             { canvas_overlay: { widgetKinds: ['custom:other_art'], drawCell() { /* art */ } } } });

    if (!schwungLibAvailable()) {
        _log('    (one registry, several pages: SKIPPED — no registry behind the door in this build)');
    } else {
        clearWidgets();
        const declares = (kind) => [{ key: 'k', viz: { kind } }];
        const page = (ck, id) => createWidgetSync(
            { state: { chainParams: declares(id === 'hank' ? 'custom:hank_wave' : 'custom:other_art') } },
            { getParam: () => id, track: { index: 0 } }, ck);

        const synth = page('synth', 'hank');
        synth.sync();
        eq('a page registers its own module\'s kind', isWidgetAvailable('custom:hank_wave'), true);

        /* The component next door, and it declares nothing at all — the case the
         * clear is unconditional for, and the one that took everything with it. */
        const plain = createWidgetSync({ state: { chainParams: [{ key: 'cutoff' }] } },
                                       { getParam: () => 'plain', track: { index: 0 } }, 'fx1');
        plain.sync();
        eq('...and a second page that declares nothing leaves it alone',
           isWidgetAvailable('custom:hank_wave'), true);

        /* ...as does a second page that declares art of its OWN: both cells draw
         * their own picture, which is the whole point of a registry keyed by
         * kind rather than a single current widget. */
        const fx = page('fx2', 'other');
        fx.sync();
        eq('...a second page with its own art keeps both',
           isWidgetAvailable('custom:hank_wave') && isWidgetAvailable('custom:other_art'), true);

        /* AND THE PROPERTY THE CLEAR EXISTED FOR IS STILL HELD: a module swapped
         * into a slot replaces what the module before it left THERE, and nothing
         * else. `afterReplan(true)` is the swap — the plan moved — and the slot's
         * new contract declares no custom kind at all. */
        const swapped = createWidgetSync({ state: { chainParams: [{ key: 'cutoff' }] } },
                                         { getParam: () => 'plain', track: { index: 0 } }, 'synth');
        swapped.sync();
        eq('a module swapped into a slot drops the departed module\'s kind',
           isWidgetAvailable('custom:hank_wave'), false);
        eq('...and takes nothing from the slot next door with it',
           isWidgetAvailable('custom:other_art'), true);
        clearWidgets();
    }
}

/* The block above is the last of the suite's body; this closes `suite()`. Its
 * teardown is `run()`'s `finally`, not a tail of statements — see restoreFakes. */
}
