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

/* ── SP-57 H4: the readings these cells lost in the migration ─────────────── */
_log('\nTest: swing and tempo say what their numbers ARE');
{
    reset();
    const source = setParamsSource();
    const f = (k, raw, surface) => source.formatValue(SET_PARAMS_COMPONENT + ':' + k, raw, surface);

    /* The percent sign is the READING, not decoration — swing is the one value
     * on this page whose bare number could be read as a count. Short enough for
     * the 30px cell, so both surfaces get it. */
    eq('swing reads as a percentage in the cell', f('swing', '54', 'cell'), '54%');
    eq('swing reads as a percentage in the header', f('swing', '54', 'header'), '54%');

    /* "120 bpm" does NOT fit the cell, so the unit rides the header alone —
     * which is also what the screen reader speaks. */
    seqState.extSync = false;
    eq('tempo carries its unit in the header', f('tempo', '120', 'header'), '120 bpm');
    eq('tempo stays bare in the cell', f('tempo', '120', 'cell'), null);

    /* EXT WINS OVER THE UNIT. When the clock is external, WHERE the tempo comes
     * from is the more useful of the two readings and they do not both fit. */
    seqState.extSync = true;
    eq('EXT beats the unit in the header', f('tempo', '120', 'header'), '120 EXT');
    eq('and still reaches the cell', f('tempo', '120', 'cell'), '120 EXT');
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

    /* SP-57 H3. A 2-option enum that is not Off/On falls through isSwitchMeta
     * into isTwoWayMeta, which TOGGLES on every detent behind a 270 ms latch —
     * so a continued turn walks the value back and forth instead of setting it.
     * Reported from the device as the Pad Layout knob cycling through values.
     *
     * Direction-absolute is what the delta path always did (`applyLink(n > 0)`),
     * and it is what a knob with a direction should do. Each turn is a whole
     * gesture: the write is throttled and the RELEASE is what flushes it. */
    keyboardState.mode = 0;        // Chromatic: layouts are ['4th', 'Piano']
    keyboardState.layout = 0;
    const turnLayout = (raw) => { p.knobTouch(7, true); p.knobTurn(7, raw); p.knobTouch(7, false); };
    eq('knob 7 is LAYOUT', p.keyAt(7), 'layout');

    for (let i = 0; i < 6; i++) turnLayout(8);
    eq('six clockwise turns land on the second option and STAY there',
       keyboardState.layout, 1);
    for (let i = 0; i < 6; i++) turnLayout(-8);
    eq('six counter-clockwise turns land on the first', keyboardState.layout, 0);

    /* THE NO-OP GUARD IS WHAT REPLACES THE 270 ms LATCH — without it a held
     * turn re-emits the same write on every detent, which is why the latch
     * existed. So this says dropping it was safe rather than convenient.
     *
     * COUNTED AT THE PORT, not at the engine queue. `applyLayoutIdx` only
     * marks UI state dirty (no command at all), and `applyLink` has its OWN
     * early return — so an engine-op count would sit at zero either way and
     * pass with this guard deleted. The write this guard actually suppresses
     * is the controller's, so the controller's write is what gets counted. */
    const src = setParamsSource();
    const realSet = src.setParam.bind(src);
    let writes = 0;
    src.setParam = (k, v) => { if (k.endsWith(':layout')) writes++; return realSet(k, v); };
    turnLayout(8);                                  // 0 -> 1: a real change
    eq('the counter is live — a real change does write', writes, 1);
    for (let i = 0; i < 5; i++) turnLayout(8);
    eq('a turn that changes nothing writes nothing', writes, 1);
    src.setParam = realSet;

    setSchwungGridMode(savedMode);
    schwungGridReload();
}

closeParamPage();
resetPorts();
}
