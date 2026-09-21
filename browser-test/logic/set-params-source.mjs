/* browser-test/logic/set-params-source.mjs — SP-53's virtual-component seam,
 * pinned at Set Params: the eight-cell contract, the one-writer invariant
 * with the delta path (`mainPageKnob`/`mainPageRelease`'s overlay commit),
 * TEMPO's `format()` EXT suffix, and LAYOUT's mode-dependent option list.
 *
 * The FIRST block needs no schwung checkout — pure functions over
 * `seqState`/`keyboardState`. The second is guarded (`schwungLibAvailable()`)
 * and proves the contract actually PLANS a page through the real planner.
 *
 * Run by browser-test/logic.mjs.
 */

import { appState, resetPorts, ok, eq, _log,
         schwungLibAvailable, schwungGridMode, setSchwungGridMode, schwungGridReload,
         schwungPageFor } from './harness.mjs';

export async function run() {

_log('\nlogic: Set Params virtual source (SP-53)');

const { setParamsSource } = await import('../../dist/esm/seq/set-params-contract.js');
const { SET_PARAMS_COMPONENT, isVirtualPageComponent } = await import('../../dist/esm/chain/config.js');
const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');
const { keyboardState } = await import('../../dist/esm/keyboard/state.js');
const { mainPageKnob, mainPageTouch, mainPageRelease, resetMainPage }
    = await import('../../dist/esm/seq/main-page.js');
const { K_TEMPO, K_SWING, K_LINK, K_QUANT, K_ROOT, K_KEY, K_MODE, K_LAYOUT }
    = await import('../../dist/esm/seq/main-page-constants.js');
const { layoutNames } = await import('../../dist/esm/keyboard/layouts.js');
const { openParamPage, closeParamPage } = await import('../../dist/esm/seq/param-page.js');
const { VIEW_MAIN_PARAMS } = await import('../../dist/esm/app/state.js');

function reset() {
    resetSeqState(); resetMainPage();
    openParamPage(VIEW_MAIN_PARAMS);
}

/* ── the contract is config-first, and its SHAPE is the library's ────────── */
_log('\nTest: the synthesised contract');
{
    reset();
    ok('is a registered virtual component', isVirtualPageComponent(SET_PARAMS_COMPONENT));

    const source = setParamsSource();
    const hier = JSON.parse(source.getParam(SET_PARAMS_COMPONENT + ':ui_hierarchy'));
    eq('the root level lists all eight keys', hier.levels.root.knobs.join(','),
       'tempo,swing,link,quant,root,key,mode,layout');

    const params = JSON.parse(source.getParam(SET_PARAMS_COMPONENT + ':chain_params'));
    ok('chain_params is an ARRAY, not a keyed object (the same bug class Clip Params found)',
       Array.isArray(params));
    eq('one entry per cell', params.length, 8);

    const link = params.find((p) => p.key === 'link');
    eq('LINK is a toggle (param_meta.mjs normalises it to a 2-option enum, no widget needed)',
       link.type, 'toggle');
    const root = params.find((p) => p.key === 'root');
    eq('ROOT is an enum with all 12 pitch classes', root.type + ':' + root.options.length, 'enum:12');
    /* short_name — Schwung's own auto-abbreviator mangled "Pad Layout" into
     * "PLAYOU" and "Note Mode" into "NMODE" before this was declared
     * (measured on the first baseline, reviewed by eye before accepting it). */
    eq('every cell declares its own short_name', params.map((p) => p.short_name).join(','),
       'TEMPO,SWING,LINK,QUANT,ROOT,KEY,MODE,LAYOUT');
}

/* ── LAYOUT's option list is a FUNCTION, resolved against the CURRENT mode ── */
_log('\nTest: LAYOUT tracks MODE live');
{
    reset();
    const source = setParamsSource();
    keyboardState.mode = 0;
    const namesAt0 = JSON.parse(source.getParam(SET_PARAMS_COMPONENT + ':chain_params'))
        .find((p) => p.key === 'layout').options;
    eq('layout options at mode 0 match layoutNames(0)', namesAt0.join(','), layoutNames(0).join(','));

    keyboardState.mode = 1;
    const namesAt1 = JSON.parse(source.getParam(SET_PARAMS_COMPONENT + ':chain_params'))
        .find((p) => p.key === 'layout').options;
    ok('a mode change reaches the NEXT contract read without rebuilding the source',
       namesAt1.join(',') === layoutNames(1).join(','));
}

/* ── one writer: the virtual source and the delta/overlay path agree ─────── */
_log('\nTest: the virtual source and mainPageKnob/mainPageRelease write the SAME field');
{
    reset();
    const source = setParamsSource();

    source.setParam(SET_PARAMS_COMPONENT + ':swing', '65');
    eq('the source writes seqState.swingPct directly', seqState.swingPct, 65);

    resetSeqState();
    mainPageKnob(K_SWING, 8);   // +1 detent
    eq('the delta path writes the same field', seqState.swingPct, 51);

    /* KEY commits through the overlay's RELEASE, not the turn — the virtual
     * source's set() must reach the exact field that release does. */
    resetSeqState();
    source.setParam(SET_PARAMS_COMPONENT + ':key', '3');
    eq('the source writes keyboardState.scale directly', keyboardState.scale, 3);

    resetSeqState(); resetMainPage();
    keyboardState.scale = 0;    // known starting point for the overlay scroll
    mainPageTouch(K_KEY, true);
    mainPageKnob(K_KEY, 8);      // scroll the overlay by one entry
    mainPageRelease(K_KEY);      // commits on release
    eq('the overlay-commit path writes the same field', keyboardState.scale, 1);
}

/* ── format() overrides the PRINTED text only, never the arc ──────────────── */
_log('\nTest: TEMPO reads "<bpm> EXT" while following Move');
{
    reset();
    const source = setParamsSource();
    const key = SET_PARAMS_COMPONENT + ':tempo';
    seqState.bpmX100 = 12000; seqState.extSync = false;
    eq('the raw value is a plain bpm number', source.getParam(key), '120');
    eq('format() falls through (null) off Link', source.formatValue(key, source.getParam(key), 'cell'), null);

    seqState.extSync = true;
    eq('the raw value is UNCHANGED (arc math stays sane)', source.getParam(key), '120');
    eq('format() appends EXT to the text only', source.formatValue(key, source.getParam(key), 'cell'), '120 EXT');
}

/* ── the page actually plans (guarded: needs a real schwung checkout) ────── */
if (!schwungLibAvailable()) {
    _log('\nlogic: Set Params page plan — SKIPPED (no param_pages; set SCHWUNG=)');
} else {
    _log('\nTest: Set Params plans and settles under `page`');
    reset();
    const savedMode = schwungGridMode();
    setSchwungGridMode('page');
    schwungGridReload();
    const p = schwungPageFor(0, SET_PARAMS_COMPONENT, null, null);
    for (let i = 0; i < 60 && !p.ready; i++) p.tick();
    ok('the page resolved (>=1 page planned)', p.ready && p.pageCount >= 1);
    eq('knob 2 is LINK', p.keyAt(2), 'link');

    setSchwungGridMode(savedMode);
    schwungGridReload();
}

closeParamPage();
resetPorts();
}
