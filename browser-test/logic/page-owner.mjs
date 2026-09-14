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

    setSchwungGridMode('page');
    const o = pageOwnerOf({ getComponentKey: () => 'mix' });
    eq('a movy page is not claimed under PAGE', o.claimed, false);
    eq('and the log says which component it kept', o.reason, 'movy-page ck=mix');
    setSchwungGridMode('off');
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

    schwungGridReload();
}

setSchwungGridMode(null);
appState.activeTrack.index = 0;
env.setParams(MOCK_SYNTHS.test16);

}
