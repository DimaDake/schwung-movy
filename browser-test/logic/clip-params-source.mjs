/* browser-test/logic/clip-params-source.mjs — SP-53's virtual-component seam,
 * pinned at Clip Params: the contract `createVirtualSource` synthesises, the
 * one-writer invariant with the delta path (`clipPageKnob`), and the
 * drum-track `format()` override.
 *
 * The FIRST block needs no schwung checkout — it is pure functions over
 * `seqState`/`appState`. The second is guarded (`schwungLibAvailable()`) and
 * proves the contract actually PLANS a page through the real planner — no run
 * of this file without SCHWUNG= has ever checked that a `chain_params` object
 * (rather than the array the library requires) throws inside `planPages`
 * before a single cell draws; this is the teeth for that exact defect.
 *
 * Run by browser-test/logic.mjs.
 */

import { appState, trackRef, resetPorts, ok, eq, _log,
         schwungLibAvailable, schwungGridMode, setSchwungGridMode, schwungGridReload,
         schwungPageFor } from './harness.mjs';

export async function run() {

_log('\nlogic: Clip Params virtual source (SP-53)');

const { createVirtualSource } = await import('../../dist/esm/renderer/schwung-virtual-source.js');
const { clipParamsSource } = await import('../../dist/esm/seq/clip-params-contract.js');
const { CLIP_PARAMS_COMPONENT, isVirtualPageComponent } = await import('../../dist/esm/chain/config.js');
const { seqState, resetSeqState } = await import('../../dist/esm/seq/state.js');
const { clipPageKnob, resetClipPage } = await import('../../dist/esm/seq/clip-page.js');
const { openParamPage, closeParamPage } = await import('../../dist/esm/seq/param-page.js');
const { VIEW_CLIP_PARAMS } = await import('../../dist/esm/app/state.js');

const savedModels = appState.trackModels;
const fakeModel = (drum) => ({ getDrumConfig: () => (drum ? { padCount: 16 } : null) });

function reset(drumTrack0 = false) {
    resetSeqState(); resetClipPage();
    appState.activeTrack = trackRef(0);
    appState.trackModels = [[null, fakeModel(drumTrack0)]];
    openParamPage(VIEW_CLIP_PARAMS);
}

/* ── the contract is config-first, and its SHAPE is the library's ────────── */
_log('\nTest: the synthesised contract');
{
    reset();
    ok('is a registered virtual component', isVirtualPageComponent(CLIP_PARAMS_COMPONENT));

    const source = clipParamsSource();
    const hier = JSON.parse(source.getParam(CLIP_PARAMS_COMPONENT + ':ui_hierarchy'));
    eq('the root level lists all four keys', hier.levels.root.knobs.join(','),
       'scale,length,transpose,quant');

    /* THE TEETH. `buildMetaIndex` (schwung's param_meta.mjs) does
     * `for (const p of (chainParams || []))` — an OBJECT keyed by param name
     * is not iterable and throws before a single cell plans. This is the
     * bug the array form below fixes; reverting `chainParamsJson()` to emit
     * `{[key]: entry}` instead of `[entry, ...]` reddens exactly this. */
    const params = JSON.parse(source.getParam(CLIP_PARAMS_COMPONENT + ':chain_params'));
    ok('chain_params is an ARRAY, not a keyed object', Array.isArray(params));
    eq('one entry per cell', params.length, 4);
    eq('every entry carries its own key', params.map((p) => p.key).join(','),
       'scale,length,transpose,quant');

    const scale = params.find((p) => p.key === 'scale');
    eq('SCALE is an enum with 8 options (config-first: no DSP to check against)',
       scale.type + ':' + scale.options.length, 'enum:8');
    const length = params.find((p) => p.key === 'length');
    eq('LENGTH is an int ranged 1..MAX_STEPS', length.type + ':' + length.min + ':' + length.max,
       'int:1:256');
    /* short_name — without it Schwung's own auto-abbreviator mangles a
     * multi-word name into running letters (measured: "Play Link" ->
     * "PLLINK" on the Set Params baseline before this was added). */
    eq('every cell declares its own short_name', params.map((p) => p.short_name).join(','),
       'SCALE,LEN,TRANS,QUANT');
}

/* ── one writer: the virtual source's set() and the delta path agree ─────── */
_log('\nTest: the virtual source and clipPageKnob write the SAME field');
{
    reset();
    const source = clipParamsSource();

    source.setParam(CLIP_PARAMS_COMPONENT + ':length', '40');
    eq('the source writes seqState.lenSteps directly', seqState.lenSteps, 40);

    resetSeqState(); resetClipPage();
    seqState.lenSteps = 10;
    clipPageKnob(1, 8, 0);   // knob 1 (LENGTH), +1 detent (DETENT_DIV), track 0
    eq('the delta path writes the same field', seqState.lenSteps, 11);

    /* Same clamp, same field, from either caller — proves `applyClipLength` is
     * the one writer, not two independent implementations that happen to
     * agree today. */
    resetSeqState();
    source.setParam(CLIP_PARAMS_COMPONENT + ':length', '99999');
    eq('the source clamps to MAX_STEPS exactly like the delta path would', seqState.lenSteps, 256);
}

/* ── format() overrides the PRINTED text only, never the arc ─────────────── */
_log('\nTest: TRANSPOSE reads n/a on a drum track');
{
    reset(true);
    const source = clipParamsSource();
    const key = CLIP_PARAMS_COMPONENT + ':transpose';
    eq('the raw value rests at 0 (matches the off arm\'s normalizedValue: 0)',
       source.getParam(key), '0');
    eq('format() overrides the text to n/a', source.formatValue(key, source.getParam(key), 'cell'), 'n/a');

    source.setParam(key, '10');
    eq('a write to a drum track is refused, silently, like the delta path',
       seqState.clipTranspose, 0);

    reset(false);
    const source2 = clipParamsSource();
    eq('format() falls through (null) on a melodic track',
       source2.formatValue(key, source2.getParam(key), 'cell'), null);
}

/* ── the page actually plans (guarded: needs a real schwung checkout) ────── */
if (!schwungLibAvailable()) {
    _log('\nlogic: Clip Params page plan — SKIPPED (no param_pages; set SCHWUNG=)');
} else {
    _log('\nTest: Clip Params plans and settles under `page`');
    reset();
    const savedMode = schwungGridMode();
    setSchwungGridMode('page');
    schwungGridReload();
    const p = schwungPageFor(0, CLIP_PARAMS_COMPONENT, null, null);
    for (let i = 0; i < 60 && !p.ready; i++) p.tick();
    ok('the page resolved (>=1 page planned)', p.ready && p.pageCount >= 1);
    eq('knob 1 is LENGTH', p.keyAt(1), 'length');

    setSchwungGridMode(savedMode);
    schwungGridReload();
}

closeParamPage();
appState.trackModels = savedModels;
resetPorts();

/* ── SP-57 H4: the clip length's unit ─────────────────────────────────────── */
_log('\nTest: the clip length names its unit');
{
    const source = clipParamsSource();
    const f = (k, raw, surface) => source.formatValue(CLIP_PARAMS_COMPONENT + ':' + k, raw, surface);
    /* The word is what tells 16 STEPS from 16 bars, and the 30px cell has no
     * room for it — so it rides the header, like tempo's bpm. */
    eq('clip length names its unit in the header', f('length', '16', 'header'), '16 steps');
    eq('clip length stays bare in the cell', f('length', '16', 'cell'), null);
}
}
