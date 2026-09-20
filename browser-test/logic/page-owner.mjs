/* browser-test/logic/page-owner.mjs — WHO OWNS THE PAGE UNDER THE 8 KNOBS.
 *
 * SP-10 of the Schwung page migration (docs/schwung-page-migration.md). movy
 * had no concept of a delegated component: every seam point re-derived
 * ownership itself, with four different component-key fallbacks, and applying
 * a rule to some of the sites is how eight symptoms and one clip-deleting data
 * loss arrived. `src/app/page-owner.ts` is the one accessor now.
 *
 * The first block is the one with real teeth and it is a STRUCTURAL check, not
 * a behaviour one: it fails the moment a second site starts deriving ownership
 * for itself, which is the failure mode this item exists to make impossible.
 * The behaviour blocks below pin what each owner answers.
 *
 * Run by browser-test/logic.mjs.
 */

import {
    readFileSync, readdirSync,
    appState, portFor, env, createModel, bootModel, settleModel,
    setSchwungGridMode, schwungLibAvailable, schwungGridReload,
    MOCK_SYNTHS, ok, eq, _log,
} from './harness.mjs';

export async function run() {

const { pageRefOf, pageOwnerOf } = await import('../../dist/esm/app/page-owner.js');
const { isMovyOwnComponent } = await import('../../dist/esm/chain/config.js');
const { modulatedKeysOf } = await import('../../dist/esm/app/modulated-keys.js');

/* ── the structural rule: ownership is derived in ONE place ───────────────── */
{
    _log('\nlogic: page ownership — one accessor, no second opinion');

    /* The ledger's standing rule (movy/CLAUDE.md): "Never read getKnobPage() or
     * a knobPage index directly for a component that may be delegated — go
     * through the ownership accessor." A grep is the only check that can hold
     * it, because the defect is a site that was never written to ask. */
    const walkTs = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = dir + '/' + e.name;
        return e.isDirectory() ? walkTs(full) : (full.endsWith('.ts') ? [full] : []);
    });
    const OWNERSHIP = /schwungActiveFor\(|schwungChangePage\(|schwungPageFor\(/;
    const ALLOWED = {
        'src/renderer/schwung-grid.ts': 'the mode and the (track, component) page cache',
        'src/app/page-owner.ts':        'the accessor itself — the only caller',
    };
    const offenders = walkTs('src')
        .filter((f) => !(f in ALLOWED))
        .filter((f) => OWNERSHIP.test(readFileSync(f, 'utf8')));
    eq('no file decides delegation for itself: ' + offenders.join(','),
       offenders.length, 0);
    const stale = Object.keys(ALLOWED)
        .filter((f) => !OWNERSHIP.test(readFileSync(f, 'utf8')));
    eq('no stale ownership-allowlist entries: ' + stale.join(','), stale.length, 0);

    /* The two names whose bodies moved into the accessor must be GONE, not
     * merely unused — an export nobody imports is an invitation to import it. */
    const grid = readFileSync('src/renderer/schwung-grid.ts', 'utf8');
    ok('schwungActiveFor is gone from the grid', !grid.includes('function schwungActiveFor'));
    ok('schwungChangePage is gone from the grid', !grid.includes('function schwungChangePage'));

    /* SP-11. The same rule one level down: a site may not PAGE a component or
     * read its page index for itself either. `movy/CLAUDE.md` names this one —
     * "Never read getKnobPage() or a knobPage index directly for a component
     * that may be delegated" — and it is the half SP-10 left standing, because
     * the two planners count pages differently: moving movy's index while
     * Schwung draws moves an index nothing displays. */
    const PAGE_CALL = /\.(changePage|getKnobPage)\(/g;
    /* The receiver has to BE an owner: a `pageOwnerOf(...)` call (one level of
     * nesting, for `pageOwnerOf(masterModel())`) or a local holding one. */
    const RECEIVER  = /(pageOwnerOf\((?:[^()]|\([^()]*\))*\)|knobOwner\(\)|\b(?:owner|fileOwner|lo|o))$/;
    const IMPLEMENTS = {
        'src/app/page-owner.ts':          'the accessor — it is what calls the implementations',
        'src/model/index.ts':             'movy\'s model implements them',
        'src/lfo/model.ts':               'the LFO model implements them',
        'src/mixer/mix-model.ts':         'the mix model implements them',
        'src/renderer/schwung-page.ts':   'Schwung\'s page implements changePage',
    };
    const pageOffenders = [];
    for (const f of walkTs('src')) {
        if (f in IMPLEMENTS) continue;
        for (const line of readFileSync(f, 'utf8').split('\n')) {
            for (const m of line.matchAll(PAGE_CALL)) {
                if (!RECEIVER.test(line.slice(0, m.index))) {
                    pageOffenders.push(f + ': ' + line.trim());
                }
            }
        }
    }
    eq('no site pages a component itself: ' + pageOffenders.join(' | '),
       pageOffenders.length, 0);
    const staleImpl = Object.keys(IMPLEMENTS)
        .filter((f) => !/\.?(changePage|getKnobPage)\(/.test(readFileSync(f, 'utf8')));
    eq('no stale page-implementer entries: ' + staleImpl.join(','), staleImpl.length, 0);

    /* The two input sites that resolve a parameter for a gesture must say which
     * page they mean. `getFileBrowseTarget()` with no argument reads movy's
     * frozen bank (it opened the wrong parameter); `handleKnobTouch(k)` with no
     * dive flag opens movy's own list over the cell someone else drew. */
    const router = readFileSync('src/midi/router.ts', 'utf8');
    ok('the file-browse target names the drawn page',
       !/getFileBrowseTarget\(\s*\)/.test(router));
    ok('the knob touch says whose dive it is',
       !/handleKnobTouch\(\s*d1\s*\)/.test(router));

    /* KNOWN EXEMPTION, named so it is not mistaken for coverage: Shift+jog's
     * `changePageGroup` still goes straight to movy's model. Schwung's pages
     * have no group, so routing it through the owner would page a delegated
     * page by one and turn a passing app-loop check red — and the burn-down
     * must never grow. The section jump is Schwung's Shift+click picker: SP-17. */
    ok('the level-skip exemption is still the only one',
       (router.match(/changePageGroup\(/g) || []).length === 1);

    /* SP-12. The poll is a PER-TICK call now — it is the only thing that
     * advances a delegated page's contract and its read cursor, and movy's own
     * refresh no longer dirties the model into rendering a frame for it. A
     * second poller costs the read this item exists to remove, on a view the
     * page is not even on: a page polled from elsewhere settles and re-plans
     * while nobody is watching, and the eager window a slot that is about to be
     * filled depends on (schwung-page-contract.ts) is spent on the way to a view
     * that never opened. */
    const POLL_CALL = /\.poll\(\)/;
    const POLLERS = { 'src/app/page-poll.ts': 'the one caller — once per tick, from app/tick.ts' };
    const pollOffenders = walkTs('src')
        .filter((f) => !(f in POLLERS))
        .filter((f) => POLL_CALL.test(readFileSync(f, 'utf8')));
    eq('nothing polls a page but the tick: ' + pollOffenders.join(','),
       pollOffenders.length, 0);
    const stalePoll = Object.keys(POLLERS)
        .filter((f) => !POLL_CALL.test(readFileSync(f, 'utf8')));
    eq('no stale poller entries: ' + stalePoll.join(','), stalePoll.length, 0);

    /* ...and the model's value refresh is gated by the same answer, at the same
     * site. A model ticked without it re-reads a page nobody is drawing, and
     * there is no symptom: the values are simply right, twice over. */
    const appTick = readFileSync('src/app/tick.ts', 'utf8');
    ok('the model is ticked with the ownership answer',
       !/activeModel\?\.tick\(\s*\)/.test(appTick));

    /* ONE WRITER FOR THE EIGHT KNOB LEDS, whoever supplies the values. The
     * diff cache and the frame budget are movy's; a second writer on the same
     * eight LEDs is how a knob ends up claiming a colour it no longer shows
     * (the LED-ownership hazard this item was warned about). */
    /* Asked of the IMPORT, not of the call: an alias (`updateKnobLEDs as _u`)
     * walks straight past a name-shaped grep, and it was tried — the first
     * version of this rule stayed green on exactly that. Nothing can write the
     * row without importing the module. */
    const LED_IMPORT = /from ['"][^'"]*knob-leds\.js['"]/;
    const LED_SITES = {
        'src/app/tick.ts': 'the only importer — the source follows who drew the body',
    };
    const ledOffenders = walkTs('src')
        .filter((f) => !(f in LED_SITES) && f !== 'src/renderer/knob-leds.ts')
        .filter((f) => LED_IMPORT.test(readFileSync(f, 'utf8')));
    eq('only the tick lights the knob row: ' + ledOffenders.join(','),
       ledOffenders.length, 0);
    const staleLed = Object.keys(LED_SITES)
        .filter((f) => !LED_IMPORT.test(readFileSync(f, 'utf8')));
    eq('no stale knob-LED entries: ' + staleLed.join(','), staleLed.length, 0);

    /* SP-26. The delegated page's reads go through the cache and nowhere else.
     *
     * Schwung asks ONE key per tick (page_controller.mjs:526 has no bulk read
     * at all) and on a movy chain each of those is a blocking ~3.4 ms engine
     * GET — the +4.3 ms SP-13 measured on device. movy answers them from a
     * batch it refills on a divider, and a single `port.getParam` left in the
     * io is a key that pays the old price forever while every test stays green,
     * because the VALUE it returns is identical. Only the cost differs, so only
     * a structural check can hold it. The stale-write hazard rides on the same
     * rule: a read that skips the cache also skips the write log the cache
     * drains, which is a different bug wearing the same shape. */
    const io = readFileSync('src/renderer/schwung-page-io.ts', 'utf8');
    ok('the page io reads only through the cache', !/port\.getParam\(/.test(io));
    ok('...and the cache is what it was handed', /cache\.get\(/.test(io));

    /* The contract reads moved OUT of the io (SP-14), so the rule follows them.
     * `ui_hierarchy`, `ui_pages` and the module id are read on the reload
     * divider and on every pad press; left on the port they would pay the full
     * blocking price the line above exists to stop — the same check, one file
     * over, because the hazard went with the code. */
    const hier = readFileSync('src/renderer/schwung-page-hierarchy.ts', 'utf8');
    ok('the contract source reads only through the cache', !/port\.getParam\(/.test(hier));
    ok('...and it is the same cache the io was handed', /cache\.get\(/.test(hier));

    /* SP-20. ONE READER OF THE DECLARED CONTRACT.
     *
     * `ui_hierarchy`, `ui_pages` and `module.json`'s `capabilities.ui_hierarchy`
     * are three ways a module publishes ONE thing, and movy read them from three
     * places with three ladders: the delegated page, movy's own model, and the
     * undo dump's restore order. Two readers of one contract is how a pad press
     * ended up with no page to jump to (SP-14), and it had already cost two
     * more — the page could not see a manifest the model could, and `"{}"` was a
     * declaration to one and nothing to the other.
     *
     * Only a grep can hold this: a second reader is not a wrong answer, it is a
     * second answer, and every test of either one stays green while they drift.
     * Asked of quoted key literals and of `loadModuleJson(`, over CODE only —
     * the comments in this tree are where most of what movy knows about the
     * contract is written down, and a rule that forbade the words would push
     * that knowledge out of the code (source-rules.mjs follows the same rule). */
    const stripComments = (src) => src
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
    const CONTRACT_READ = /['"][^'"]*ui_(hierarchy|pages)['"]|\bloadModuleJson\s*\(/;
    const CONTRACT_ALLOWED = {
        'src/chain/hierarchy-source.ts': 'the one reader — the three rungs live here',
        'src/modules/loader.ts':         'DEFINES loadModuleJson; it reads no key itself',
    };
    const contractOffenders = walkTs('src')
        .filter((f) => !(f in CONTRACT_ALLOWED))
        .filter((f) => CONTRACT_READ.test(stripComments(readFileSync(f, 'utf8'))));
    eq('one reader of the declared contract: ' + contractOffenders.join(','),
       contractOffenders.length, 0);
    const staleContract = Object.keys(CONTRACT_ALLOWED)
        .filter((f) => !CONTRACT_READ.test(stripComments(readFileSync(f, 'utf8'))));
    eq('no stale contract-reader entries: ' + staleContract.join(','), staleContract.length, 0);
}

/* ── page identity ────────────────────────────────────────────────────────── */
{
    _log('\nlogic: page identity is (track, component), derived once');

    setSchwungGridMode('off');
    appState.activeTrack.index = 0;
    const m = bootModel(MOCK_SYNTHS.test16);

    eq('the ref names the active track', pageRefOf(m).track, 0);
    eq('the ref names the model\'s component', pageRefOf(m).componentKey, 'synth');

    appState.activeTrack.index = 3;
    eq('and it follows the active track', pageRefOf(m).track, 3);
    appState.activeTrack.index = 0;

    /* The call sites each guarded `getComponentKey` differently — 'synth',
     * '(none)', `?? 'synth'`, and one with no guard at all. A model that cannot
     * name its component has no page identity, and the answer is movy's. */
    eq('no model has no identity', pageRefOf(null), null);
    eq('a model that cannot name its component has none either',
       pageRefOf({ getKnobPage: () => 0 }), null);

    /* SP-52: a master or send component is NOT track-scoped, and the ref must
     * say so regardless of which track the user is looking at — the opposite
     * of the "follows the active track" rule just above. Before this fix the
     * ref stamped `appState.activeTrack.index` onto EVERY component, which
     * gave a master component sixteen distinct page identities (one per
     * track) and, downstream, sixteen cached SchwungPages for the one module
     * that is actually there — a track switch silently swapped in a
     * different cached page and read cache. */
    const master = { getComponentKey: () => 'master_fx:fx1' };
    const send = { getComponentKey: () => 'snd0' };
    appState.activeTrack.index = 0;
    eq('a master FX ref is not the active track', pageRefOf(master).track, 0);
    eq('a send ref is not the active track either', pageRefOf(send).track, 0);
    appState.activeTrack.index = 9;
    eq('...and a master FX ref does not move when the active track does',
       pageRefOf(master).track, 0);
    eq('...nor does a send ref', pageRefOf(send).track, 0);
    appState.activeTrack.index = 0;
}

/* ── a master component's modulation is not on any track's chain ─────────── */
{
    _log('\nlogic: modulatedKeysOf answers a master FX component from masterFxModels (SP-52)');

    /* `modulatedKeysOf(track, componentKey)` is asked with `track` = the fixed
     * carrier `componentPort` addresses a master component through (0), never
     * the active track — see the ref test above. Before this fix it walked
     * `appState.trackModels[0]` for a `master_fx:` key, which is track 0's OWN
     * chain and holds no such component: the answer was silently "unmodulated",
     * forever, which is the one failure mode indistinguishable from "correctly
     * not modulated" without a test that actually seeds a master model. */
    const origMaster = appState.masterFxModels;
    const origTrack0 = appState.trackModels[0];
    appState.masterFxModels = [
        { getComponentKey: () => 'master_fx:fx1', modulatedKeys: () => new Set(['cutoff']) },
    ];
    appState.trackModels[0] = [
        { getComponentKey: () => 'synth', modulatedKeys: () => new Set(['should-not-be-seen']) },
    ];

    ok('a master component\'s tilde reads off masterFxModels',
       modulatedKeysOf(0, 'master_fx:fx1')?.has('cutoff') === true);
    eq('and not off track 0\'s own chain',
       modulatedKeysOf(0, 'master_fx:fx1')?.has('should-not-be-seen'), false);
    eq('an ordinary component still reads its track\'s chain',
       modulatedKeysOf(0, 'synth')?.has('should-not-be-seen'), true);

    appState.masterFxModels = origMaster;
    appState.trackModels[0] = origTrack0;
}

/* ── movy owns it ─────────────────────────────────────────────────────────── */
{
    _log('\nlogic: movy owns the page with the grid off');

    setSchwungGridMode('off');
    const m = settleModel(bootModel(MOCK_SYNTHS.test16));
    const o = pageOwnerOf(m);

    eq('nothing is claimed', o.claimed, false);
    eq('nothing is delegated', o.delegated, false);
    eq('there is no Schwung page', o.page, null);
    eq('the reason names the mode', o.reason, 'mode=off');
    eq('the index is movy\'s bank', o.pageIndex, m.getKnobPage());
    eq('the count is movy\'s banks', o.pageCount, m.getBankCount());
    eq('the param under the knob is movy\'s', o.knobParamInfo(0)?.key,
       m.getKnobParamInfo(0)?.key);

    const before = m.getKnobPage();
    o.changePage(1);
    eq('changePage moves movy\'s own bank', m.getKnobPage(), before + 1);
    eq('and the owner reports the move', o.pageIndex, before + 1);
    o.changePage(-1);

    /* poll() must cost nothing when there is nothing to poll — SP-12 calls it
     * once per tick from the render path. */
    o.poll();
    eq('poll leaves a movy-owned page alone', o.pageIndex, before);
}

/* ── the gestures that resolve a parameter ────────────────────────────────── */
{
    _log('\nlogic: a gesture resolves its parameter through the drawn page');

    /* SP-11. Two input sites resolved a parameter from movy's own page index
     * and had no way to be told otherwise. Under a delegated page that index is
     * not what is on screen: the dive opened movy's list over Schwung's cell,
     * and the file browser opened a parameter the user was not holding. */
    setSchwungGridMode('off');
    const m = settleModel(bootModel(MOCK_SYNTHS.lfo_mod));

    m.handleKnobTouch(0);
    ok('a touch movy draws opens movy\'s dive', m.getViewModel().overlay !== null);
    m.handleKnobRelease(0);

    m.handleKnobTouch(0, false);
    eq('a touch someone else drew opens none', m.getViewModel().overlay, null);
    eq('but the touch is still recorded', m.getViewModel().touchedSlot, 0);
    m.handleKnobRelease(0);

    /* The file browser's target. `model/` cannot ask who owns the page (it may
     * not import `app/`), so the drawn key is passed in — and a drawn cell that
     * is NOT a file param must open nothing, which is the assertion that fails
     * when the resolver is ignored and movy's arithmetic answers anyway. */
    const f = settleModel(bootModel(MOCK_SYNTHS.file_param));
    f.handleKnobTouch(0, false);
    eq('movy\'s own arithmetic still answers when movy draws',
       f.getFileBrowseTarget()?.key, 'sample');
    eq('the drawn key answers when one is supplied',
       f.getFileBrowseTarget(() => 'sample')?.key, 'sample');
    eq('a drawn cell that is not a file opens nothing',
       f.getFileBrowseTarget(() => 'vol'), null);
    eq('an empty drawn cell opens nothing',
       f.getFileBrowseTarget(() => null), null);
    f.handleKnobRelease(0);
}

/* ── no model at all ──────────────────────────────────────────────────────── */
{
    _log('\nlogic: no model, no owner, no throw');

    setSchwungGridMode('page');
    const o = pageOwnerOf(null);
    eq('no model is never claimed', o.claimed, false);
    eq('no model is never delegated', o.delegated, false);
    eq('the reason says so', o.reason, 'no-model');
    eq('its index is bank 0', o.pageIndex, 0);
    o.changePage(1); o.poll();
    eq('and its gestures do nothing', o.page, null);
    setSchwungGridMode('off');
}

/* ── movy's own pages are never claimed ───────────────────────────────────── */
{
    _log('\nlogic: movy\'s own pages are never claimed, whatever the mode');

    /* The mix page and the two LFO pages are movy's, not a module's declared
     * contract — there is nothing for a planner to plan. They were claimed
     * before this item: a controller was built for each and its contract never
     * resolved, so the ANSWER was right by accident and the cost was real. */
    ok('mix is movy\'s own', isMovyOwnComponent('mix'));
    ok('the track LFO page is movy\'s own', isMovyOwnComponent('lfo'));
    ok('the master LFO page is movy\'s own', isMovyOwnComponent('master_lfo'));
    ok('a synth is not', !isMovyOwnComponent('synth'));
    ok('an FX slot is not', !isMovyOwnComponent('audio_fx1'));
    ok('a master FX slot is not', !isMovyOwnComponent('master_fx1'));

    /* PAGE is only reachable with the library: `schwungGridMode` pins itself to
     * 'off' when param_pages cannot load, so without a SCHWUNG checkout the
     * override below answers 'mode=off' and these two say nothing about the
     * rule. Skipped, not failed — the standing contract for every Schwung
     * assertion in the local suites (movy/CLAUDE.md). */
    if (!schwungLibAvailable()) {
        _log('  (the PAGE half SKIPPED — no param_pages; set SCHWUNG=)');
    } else {
        setSchwungGridMode('page');
        const o = pageOwnerOf({ getComponentKey: () => 'mix' });
        eq('a movy page is not claimed under PAGE', o.claimed, false);
        eq('and the log says which component it kept', o.reason, 'movy-page ck=mix');
        setSchwungGridMode('off');
    }
}

/* ── Schwung owns it ──────────────────────────────────────────────────────── */
if (!schwungLibAvailable()) {
    _log('\nlogic: page delegation — SKIPPED (no param_pages; set SCHWUNG=)');
} else {
    _log('\nlogic: Schwung owns the page under PAGE');

    /* CLAIMED IS NOT DELEGATED, and the window between them is load-bearing:
     * the page is built while the module is still loading, and every gesture
     * stays movy's until the contract resolves. That is what
     * `schwungActiveFor`'s `ready ? p : null` expressed at each site; losing it
     * would hand a gesture to a controller with no pages. An empty slot is the
     * deterministic form of it — the contract resolves to nothing, forever. */
    setSchwungGridMode('page');
    schwungGridReload();
    appState.activeTrack.index = 0;
    env.setParams({});
    const empty = createModel(portFor(0), 'synth');
    const eo = pageOwnerOf(empty);
    eq('an empty slot is still claimed', eo.claimed, true);
    eq('but it is not delegated', eo.delegated, false);
    eq('so movy still answers for it', eo.page, null);
    ok('and the reason says not-ready', eo.reason.startsWith('not-ready track=0 ck=synth'));
    eq('the index falls back to movy\'s bank', eo.pageIndex, empty.getKnobPage());

    /* Now a module that really is there. */
    schwungGridReload();
    const m = settleModel(bootModel(MOCK_SYNTHS.test16));
    const o = pageOwnerOf(m);
    eq('a real module is claimed', o.claimed, true);

    /* poll() is what resolves the contract — the same RETRY_TICKS × RETRY_LIMIT
     * budget screenshot.mjs's page_body scene waits on, and the call SP-12's
     * polling item takes over from movy's own refresh. */
    for (let i = 0; i < 12 * 60 && !o.delegated; i++) { o.poll(); m.tick(); }
    eq('poll resolves the contract', o.delegated, true);
    ok('now there is a Schwung page', o.page !== null);
    ok('and the reason says ok', o.reason.startsWith('ok track=0 ck=synth pages='));

    /* THE DIVERGENCE THIS ACCESSOR EXISTS FOR. The two planners page
     * differently — Schwung paginates overflow — so a site that moved movy's
     * bank while Schwung drew the body was moving an index nothing displayed,
     * and a site that READ movy's bank was reading a page that is not on
     * screen. One owner, one index. */
    const movyBefore = m.getKnobPage();
    const schwungBefore = o.pageIndex;
    o.changePage(1);
    eq('changePage moves Schwung\'s page', o.pageIndex, schwungBefore + 1);
    eq('and leaves movy\'s bank alone', m.getKnobPage(), movyBefore);
    eq('the count is Schwung\'s page count', o.pageCount, o.page.pageCount);
    eq('the param under the knob is Schwung\'s', o.knobParamInfo(0)?.key,
       o.page.knobParamInfo(0)?.key);
    o.changePage(-1);

    /* SP-12. The knob LEDs are lit from the DRAWN cells, and the normalisation
     * is Schwung's own `normalizedOf` rather than a second copy of the rule —
     * it is the function `page_controller.mjs` itself imports by name, so it
     * exists wherever the library loads at all. */
    const lv = o.page.knobLevels();
    eq('the drawn page reports a level per knob', lv.length, 8);
    const i3 = o.knobParamInfo(3);
    const round = (v) => Math.round(v * 1000) / 1000;
    eq('and a bound cell\'s level is its value on its range',
       round(lv[3]), round((i3.value - i3.min) / (i3.max - i3.min)));

    schwungGridReload();
}

/* ── one knob-LED writer, two sources ─────────────────────────────────────── */
{
    _log('\nlogic: the knob row has one writer and one ramp');

    const { updateKnobLEDs, updateKnobLEDsFrom, resetKnobLedCache } =
        await import('../../dist/esm/renderer/knob-leds.js');
    const { ledFrameReset } = await import('../../dist/esm/seq/led-cache.js');

    const seen = {};
    const realBtn = globalThis.setButtonLED;
    globalThis.setButtonLED = (cc, c) => { seen[cc] = c; };
    const row = () => Array.from({ length: 8 }, (_, k) => seen[71 + k]).join();
    const paint = (fn) => { ledFrameReset(); resetKnobLedCache(); fn(); return row(); };

    /* A delegated page hands over normalised values and nothing else; movy's
     * own page hands over a whole view model. They must reach the same colour,
     * or the row would change appearance when ownership changed and say
     * nothing about the sound. */
    const levels = [0, 0.2, 0.5, 0.9, 0, 0.3, 0.6, 0.99];
    const vm = { rows: [levels.slice(0, 4).map((v) => ({ normalizedValue: v })),
                        levels.slice(4).map((v) => ({ normalizedValue: v }))] };
    eq('the two sources light the same colours',
       paint(() => updateKnobLEDsFrom(levels)), paint(() => updateKnobLEDs(vm)));

    /* An unread or unbound cell goes DARK rather than sitting confidently at
     * the bottom of its range — colour 0 already means "nothing to turn here". */
    eq('an unbound cell is dark, not minimum',
       paint(() => updateKnobLEDsFrom(new Array(8).fill(null))), '0,0,0,0,0,0,0,0');

    globalThis.setButtonLED = realBtn;
    resetKnobLedCache();
}

setSchwungGridMode(null);
appState.activeTrack.index = 0;
env.setParams(MOCK_SYNTHS.test16);

}
