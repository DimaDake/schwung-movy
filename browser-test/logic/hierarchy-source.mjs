/* browser-test/logic/hierarchy-source.mjs — THE ONE READER OF A MODULE'S
 * DECLARED PAGE CONTRACT.
 *
 * SP-20 of the Schwung page migration (docs/schwung-page-migration.md).
 * `ui_hierarchy`, `ui_pages` and `module.json`'s `capabilities.ui_hierarchy` are
 * three ways a module publishes ONE thing, and movy read them from three places
 * with three ladders — the delegated page (which also answers `focusVoice`),
 * movy's own model, and the undo dump's restore order. `src/chain/hierarchy-
 * source.ts` is the one reader now; the grep that keeps it the only one lives
 * with the other structural rules in page-owner.mjs.
 *
 * What is here is what the ladder ANSWERS, and the two divergences that were
 * live before it: the page could not see a manifest the model could, and `"{}"`
 * was a declaration to one reader and nothing to the other.
 *
 * Run by browser-test/logic.mjs.
 */

import {
    appState, env, bootModel, settleModel,
    setSchwungGridMode, schwungLibAvailable, schwungGridReload,
    MOCK_SYNTHS, ok, eq, _log, installMockFs, uninstallMockFs,
} from './harness.mjs';

export async function run() {

const { pageOwnerOf } = await import('../../dist/esm/app/page-owner.js');

/* ── the declared contract: one ladder, three rungs ───────────────────────── */
{
    _log('\nlogic: the declared contract — one ladder for page, model and dump');

    const { declaredContract, createContractSource, levelsOf, isContractKey } =
        await import('../../dist/esm/chain/hierarchy-source.js');

    const LEVELS   = JSON.stringify({ levels: { root: { knobs: ['a'] } } });
    const PAGES    = JSON.stringify({ levels: { pads: { knobs: ['b'] } } });
    const MANIFEST = JSON.stringify({ capabilities: { ui_hierarchy:
        { levels: { root: { knobs: ['c'] } } } } });
    const MANIFEST_PATH =
        '/data/UserData/schwung/modules/sound_generators/ladder-test/module.json';

    const io = (served, opts = {}) => ({
        read: (k) => (k === 'ui_hierarchy' ? served
                    : k === 'ui_pages'     ? (opts.pages ?? null) : null),
        moduleId: () => opts.id ?? 'ladder-test',
        componentKey: 'synth',
    });

    /* Rung 1 wins, always: a module that describes itself is never spoken for. */
    installMockFs({ [MANIFEST_PATH]: MANIFEST });
    {
        const d = declaredContract(io(LEVELS, { pages: PAGES }));
        eq('the module\'s own contract wins', d.text, LEVELS);
        eq('and the source says which rung answered', d.source, 'ui_hierarchy');
        eq('nothing is pending once it has answered', d.pending, false);
        /* The ladder had to parse it to know the module had said anything, and
         * minijv's contract is 39 KB — so the parse comes back with the text and
         * the model does not pay for a second one. */
        eq('and the parsed levels come back with it', JSON.stringify(d.levels), d.text);
    }

    /* Rung 2 — 9W9 and anything else that ships its own chain editor: the first
     * key is served EMPTY on purpose and the contract lives under the second. */
    {
        const d = declaredContract(io('', { pages: PAGES }));
        eq('a module that publishes under ui_pages is heard', d.text, PAGES);
        eq('...from the second rung', d.source, 'ui_pages');
        eq('and rung 1\'s own answer is kept as the give-up token', d.served, '');
    }

    /* THE LEVELS TEST, and the reason this ladder is one ladder. `"{}"` is a
     * module saying nothing in JSON. It used to stop the PAGE at rung 1 — no
     * ui_pages, no manifest, no translation — while the model read it as
     * nothing and climbed on, so the two readers planned different pages from
     * the same module. */
    {
        const d = declaredContract(io('{}', { pages: PAGES }));
        eq('an empty object is not a declaration', d.text, PAGES);
        eq('and it is still handed on as the token', d.served, '{}');
        eq('a text with no levels declares nothing', levelsOf('{"levels":{}}'), null);
        eq('and neither does one movy cannot parse', levelsOf('not json'), null);
    }

    /* Rung 3. Schwung serves a SYNTH slot's ui_hierarchy from the plugin alone,
     * so a module that describes its UI in its manifest arrives with none —
     * this rung is the only way the delegated page can hear it. */
    {
        const d = declaredContract(io('', { pages: '' }));
        eq('the manifest is the third rung', d.source, 'module.json');
        eq('and it is the contract the manifest declares',
           JSON.stringify(JSON.parse(d.text)),
           JSON.stringify(JSON.parse(MANIFEST).capabilities.ui_hierarchy));
    }

    /* A manifest that declares nothing is not a rung either — the same test,
     * applied where the answer is an object rather than a text. */
    {
        installMockFs({ [MANIFEST_PATH]: JSON.stringify({ capabilities: { ui_hierarchy: {} } }) });
        const d = declaredContract(io('', { pages: '' }));
        eq('an empty manifest hierarchy declares nothing', d.text, null);
        eq('and no rung is named', d.source, null);
        installMockFs({ [MANIFEST_PATH]: MANIFEST });
    }

    /* PENDING IS REPORTED, NOT ACTED ON. The page reads through SP-26's cache
     * where null means the read has not landed; the model and the dump read
     * through a blocking port where null means the param does not exist. The
     * ladder says which it saw and the caller applies its own meaning. */
    {
        const d = declaredContract({ read: () => null, moduleId: () => '', componentKey: 'synth' });
        eq('an unanswered read is pending', d.pending, true);
        eq('and speaks for nobody', d.text, null);
        eq('a served-and-empty read is NOT pending', declaredContract(io('')).pending, false);
    }

    /* The manifest rung is a blocking host_read_file and `raw()` is on the
     * pad-press path (SP-27), so it is read once per module id. */
    {
        let reads = 0;
        const realRead = globalThis.host_read_file;
        globalThis.host_read_file = (p) => { reads++; return realRead(p); };
        const src = createContractSource(io('', { pages: '' }));
        src.get(); src.get(); src.get();
        eq('the manifest is read once for the module', reads, 1);
        src.invalidate();
        src.get();
        eq('and again once the source is invalidated', reads, 2);
        globalThis.host_read_file = realRead;
    }

    /* No module id is a read that has not landed, not "no rack" — the manifest
     * of the module that has just left must not answer for the empty slot. */
    {
        const d = declaredContract(io('', { pages: '', id: '' }));
        eq('no module id, no manifest', d.text, null);
    }

    uninstallMockFs();

    /* The controller asks with the component already on the key, so the test
     * that routes its ask is a SUFFIX match — kept here, with the ladder, so
     * the io that routes it holds no key literal of its own. */
    ok('the controller\'s qualified ask is recognised', isContractKey('synth:ui_hierarchy'));
    ok('...and the bare one', isContractKey('ui_hierarchy'));
    ok('but nothing else is', !isContractKey('synth:cutoff'));
}

/* ── the manifest reaches the delegated page ──────────────────────────────── */
if (!schwungLibAvailable()) {
    _log('\nlogic: the manifest under PAGE — SKIPPED (no param_pages; set SCHWUNG=)');
} else {
    _log('\nlogic: a module.json contract plans the DELEGATED page too (SP-20)');

    /* Schwung serves a SYNTH slot's `ui_hierarchy` from the plugin alone, so a
     * module that describes its UI in its manifest (Slicer was the case) serves
     * `"{}"` and declares everything in module.json. movy's model has read that
     * manifest since the beginning; the page planner had its own ladder and did
     * not, so under `page` the module's declared sample browser was on no page
     * at all and the knobs held whatever `chain_params` paginated to. */
    const MANIFEST = JSON.stringify({ capabilities: { ui_hierarchy: { levels: { root: {
        label: 'Slicer',
        knobs: ['sample_path', 'threshold'],
        params: [{ key: 'sample_path', label: 'Sample', type: 'filepath' }],
    } } } } });

    installMockFs({ '/data/UserData/schwung/modules/sound_generators/manifest-only/module.json':
                    MANIFEST });
    setSchwungGridMode('page');
    schwungGridReload();
    appState.activeTrack.index = 0;
    const m = settleModel(bootModel(MOCK_SYNTHS.module_json_hier));
    const o = pageOwnerOf(m);
    for (let i = 0; i < 12 * 60 && !o.delegated; i++) { o.poll(); m.tick(); }
    eq('the manifest module delegates', o.delegated, true);
    eq('and the page is planned from what it declares', o.knobParamInfo(0)?.key, 'sample_path');

    setSchwungGridMode('off');
    schwungGridReload();
    uninstallMockFs();
}

/* Back to the world the next suite boots in — the same tail page-owner.mjs
 * keeps, for the same reason: this one boots a module of its own. */
setSchwungGridMode(null);
appState.activeTrack.index = 0;
env.setParams(MOCK_SYNTHS.test16);

}
