/* browser-test/logic/items-select.mjs — generic item selectors.
 *
 * A hierarchy level carrying `items_param` + `select_param` (dexed's .syx
 * banks, obxd's .fxb banks, sf2's soundfonts, nam's models/cabs) becomes one
 * knob cell beside the preset cell. Run by browser-test/logic.mjs.
 *
 * Design: plans/2026-08-22-item-selector-design.md
 */

import { eq, bootModel, env, _log } from './harness.mjs';

const KNOBS = ['output_level', 'octave_transpose', 'feedback',
               'lfo_speed', 'lfo_pmd', 'lfo_amd'];

const BANKS = [
    { label: 'ROM1A.syx', index: 0 },
    { label: 'ROM2A.syx', index: 1 },
    { label: 'ROM3A.syx', index: 2 },
];

/* dexed's real shape: a preset triple on root, a nav entry to a knobless
 * `banks` level, and that level's items/select pair. */
function dexedish(over = {}) {
    const base = {
        'synth:name': 'Dexed',
        'synth:chain_params': JSON.stringify(
            KNOBS.map(k => ({ key: k, name: k, type: 'int', min: 0, max: 99 })),
        ),
        'synth:ui_hierarchy': JSON.stringify({
            levels: {
                root: {
                    list_param: 'preset', count_param: 'preset_count',
                    name_param: 'preset_name',
                    knobs: KNOBS,
                    params: [{ level: 'banks', label: 'Choose Bank' }],
                },
                banks: {
                    label: 'SYX Banks',
                    items_param: 'syx_bank_list',
                    select_param: 'syx_bank_index',
                    children: null, knobs: [], params: [],
                },
            },
        }),
        'synth:preset_count': '32',
        'synth:preset_name': 'E.PIANO 1',
        'synth:preset': '0',
        'synth:syx_bank_list': JSON.stringify(BANKS),
        'synth:syx_bank_index': '1',
    };
    for (const k of KNOBS) base['synth:' + k] = '0';
    const out = { ...base, ...over };
    for (const [k, v] of Object.entries(over)) if (v === undefined) delete out[k];
    return out;
}

const selectorOf = (m) => m.dumpLayout().params.find(p => p && p.renderStyle === 'items');

/* The on-screen cell for a param, by its full label. */
function cellOf(m, fullName) {
    for (const row of m.getViewModel().rows) {
        for (const c of row) if (c && c.fullName === fullName) return c;
    }
    return null;
}

/* Which physical knob slot shows a given label on the current page. The page
 * layout rearranges cells, so the slot is never simply the param index. */
function slotOfLabel(m, fullName) {
    const rows = m.getViewModel().rows;
    for (let line = 0; line < rows.length; line++) {
        for (let col = 0; col < rows[line].length; col++) {
            if (rows[line][col]?.fullName === fullName) return line * 4 + col;
        }
    }
    return -1;
}

export async function run() {

_log('\nTest: item selectors (items_param/select_param levels)');
{
    /* ── The cell exists, and describes itself from the level ─────────────── */
    const m = bootModel(dexedish());
    const sel = selectorOf(m);
    eq('items: selector cell built',        !!sel,           true);
    eq('items: keyed by select_param',      sel?.key,        'syx_bank_index');
    // The level says "SYX Banks"; the nav entry says "Choose Bank". A cell
    // wants the noun, so the level's own label wins.
    eq('items: labelled from the level',    sel?.label,      'SYX Banks');
    eq('items: is an enum, not a file',     sel?.type,       'enum');
    eq('items: options are the labels',     sel?.options?.join(','),
       'ROM1A.syx,ROM2A.syx,ROM3A.syx');
    eq('items: max is last position',       sel?.max,        2);
    // A selection rewrites every other param, so undo needs the module back.
    eq('items: captures module state',      sel?.capturesModuleState, true);
    eq('items: never automatable',          sel?.automatable, false);

    /* ── It sits immediately left of the preset cell ──────────────────────── */
    const params = m.dumpLayout().params;
    const iSel = params.findIndex(p => p && p.renderStyle === 'items');
    const iPre = params.findIndex(p => p && p.renderStyle === 'preset');
    eq('items: preset still rendered',      iPre >= 0,       true);
    eq('items: sits just before preset',    iSel + 1,        iPre);
    // dexed: selector + preset + 6 knobs is exactly one page.
    eq('items: one page for dexed',         m.getViewModel().bankCount, 1);

    /* ── The resting cell shows the current selection ─────────────────────── */
    for (let i = 0; i < 20; i++) m.tick();
    eq('items: shows the live selection',   cellOf(m, 'SYX Banks')?.enumIndex, 1);
}

/* ── Rejection: a level movy cannot read back is not a selector ──────────── */
{
    // surge/clap `jump_to_category` and minijv `do_save_to_slot` are write-only
    // commands; a cell that cannot read its own state would misreport it, and
    // the refresh cursor re-asserting one would fire it repeatedly.
    const m = bootModel(dexedish({ 'synth:syx_bank_index': undefined }));
    eq('items: unreadable select → no cell', !!selectorOf(m), false);

    const empty = bootModel(dexedish({ 'synth:syx_bank_list': '[]' }));
    eq('items: empty list → no cell',        !!selectorOf(empty), false);

    const bad = bootModel(dexedish({ 'synth:syx_bank_list': 'not json' }));
    eq('items: malformed list → no cell',    !!selectorOf(bad), false);

    const noSel = bootModel(dexedish({
        'synth:ui_hierarchy': dexedish()['synth:ui_hierarchy']
            .replace('"select_param":"syx_bank_index",', ''),
    }));
    eq('items: no select_param → no cell',   !!selectorOf(noSel), false);

    // A selection outside the list is not a selection.
    const off = bootModel(dexedish({ 'synth:syx_bank_index': '9' }));
    eq('items: out-of-range select → no cell', !!selectorOf(off), false);
}

/* ── Sparse indices: position on screen, module index on the wire ────────── */
{
    // Three entries, and a selection whose index (5) is neither its position
    // (1) nor the last position (2) — with two entries a plain clamp to
    // options.length-1 gives the right answer by accident.
    const sparse = [{ label: 'Factory', index: 0 },
                    { label: 'User', index: 5 },
                    { label: 'Extra', index: 9 }];
    const m = bootModel(dexedish({
        'synth:syx_bank_list': JSON.stringify(sparse),
        'synth:syx_bank_index': '5',
    }));
    const sel = selectorOf(m);
    eq('items: sparse list accepted',       !!sel,           true);
    eq('items: max is position, not index', sel?.max,        2);
    for (let i = 0; i < 20; i++) m.tick();
    eq('items: sparse shows position 1',    cellOf(m, 'SYX Banks')?.enumIndex, 1);
}

/* ── Gesture: touch opens the overlay even for a short list ──────────────── */
{
    const m = bootModel(dexedish());
    const k = slotOfLabel(m, 'SYX Banks');
    eq('items: selector has a slot',        k >= 0,          true);

    // The plain-enum rule only opens an overlay past 6 options. Three banks
    // would otherwise turn in place — one .syx load per detent.
    m.handleKnobTouch(k);
    const vm = m.getViewModel();
    eq('items: 3 options still open overlay', !!vm.overlay,  true);
    eq('items: overlay lists the banks',    vm.overlay?.options?.length, 3);
    m.handleKnobRelease(k);
}

/* ── The list is re-read on touch, and a shrunk list cannot commit garbage ── */
{
    const m = bootModel(dexedish({ 'synth:syx_bank_index': '2' }));   // last of 3
    const k = slotOfLabel(m, 'SYX Banks');
    for (let i = 0; i < 20; i++) m.tick();

    // A bank deleted from the schwung web UI while movy is open. The cached
    // position (2) is now past the end of the list.
    env.params['synth:syx_bank_list'] = JSON.stringify([{ label: 'ROM1A.syx', index: 0 }]);
    m.handleKnobTouch(k);
    const vm = m.getViewModel();
    eq('items: re-read on touch picks up the change', vm.overlay?.options?.length, 1);
    eq('items: stale position is clamped',  vm.overlay?.selected, 0);
    m.handleKnobRelease(k);
    eq('items: commits an index the module offered',
       env.params['synth:syx_bank_index'], '0');

    // And a bank added while open shows up without reopening movy.
    env.params['synth:syx_bank_list'] = JSON.stringify([
        { label: 'ROM1A.syx', index: 0 }, { label: 'NEW.syx', index: 1 },
    ]);
    m.handleKnobTouch(k);
    eq('items: an added bank appears on the next touch',
       m.getViewModel().overlay?.options?.join(','), 'ROM1A.syx,NEW.syx');
    m.handleKnobRelease(k);
}

/* ── Gesture: an untouched turn writes nothing ───────────────────────────── */
{
    const m = bootModel(dexedish());
    const k = slotOfLabel(m, 'SYX Banks');
    env.params['synth:syx_bank_index'] = '1';
    // Enough detents to cross several steps — a narrow range needs more than
    // one per step, so a single delta would return early whatever the guard.
    for (let i = 0; i < 24; i++) { m.handleKnobDelta(k, 1); m.tick(); }
    eq('items: delta without touch writes nothing',
       env.params['synth:syx_bank_index'], '1');
}

/* ── Gesture: commit writes once, on release ─────────────────────────────── */
{
    const m = bootModel(dexedish());
    const k = slotOfLabel(m, 'SYX Banks');
    m.handleKnobTouch(k);
    for (let i = 0; i < 12; i++) m.handleKnobDelta(k, 1);   // scroll to the end
    eq('items: scrolling writes nothing',
       env.params['synth:syx_bank_index'], '1');
    m.handleKnobRelease(k);
    eq('items: release commits the index',
       env.params['synth:syx_bank_index'], '2');
}

/* ── Commit sends the module's index, not the screen position ────────────── */
{
    const sparse = [{ label: 'Factory', index: 0 },
                    { label: 'User', index: 5 },
                    { label: 'Extra', index: 9 }];
    const m = bootModel(dexedish({
        'synth:syx_bank_list': JSON.stringify(sparse),
        'synth:syx_bank_index': '0',
    }));
    const k = slotOfLabel(m, 'SYX Banks');
    m.handleKnobTouch(k);
    for (let i = 0; i < 6; i++) m.handleKnobDelta(k, 1);
    m.handleKnobRelease(k);
    // Position 1 on screen, index 5 on the wire.
    eq('items: sparse commit sends index 5',
       env.params['synth:syx_bank_index'], '5');
}

/* ── After a commit the module is re-read ────────────────────────────────── */
{
    // Choosing a bank loads the .syx and resets preset to 0, so the cached
    // preset count/names are stale. sfz and minijv change their whole
    // hierarchy. The rebuild must keep the user on the page they were reading.
    const m = bootModel(dexedish());
    const k = slotOfLabel(m, 'SYX Banks');
    m.handleKnobTouch(k);
    m.handleKnobDelta(k, 1);
    m.handleKnobRelease(k);

    env.params['synth:preset_count'] = '64';
    let saw64 = false;
    for (let i = 0; i < 80 && !saw64; i++) {
        m.tick();
        const pre = m.dumpLayout().params.find(p => p && p.renderStyle === 'preset');
        if (pre && pre.max === 63) saw64 = true;
    }
    eq('items: commit re-reads the module', saw64, true);
    eq('items: page preserved across reload', m.getKnobPage(), 0);
}

/* ── The list is never read by the refresh cursor ────────────────────────── */
{
    // syx_bank_list rescans the filesystem on every read (dx7_plugin.cpp:1642),
    // so it is read at load and on touch only. movy's tick period IS its MIDI
    // sampling interval — a directory scan on the cursor is pad latency.
    const m = bootModel(dexedish());
    const reads = [];
    const real = globalThis.shadow_get_param;
    globalThis.shadow_get_param = (s, key) => { reads.push(key); return real(s, key); };
    for (let i = 0; i < 40; i++) m.tick();
    globalThis.shadow_get_param = real;
    eq('items: list never read on tick',
       reads.some(k => k === 'synth:syx_bank_list'), false);
    eq('items: selection is refreshed',
       reads.some(k => k === 'synth:syx_bank_index'), true);
}

/* ── Two selectors on one module (nam: models + cabs) ────────────────────── */
{
    const m = bootModel({
        'synth:name': 'NAM',
        'synth:chain_params': JSON.stringify([{ key: 'gain', name: 'Gain', type: 'int', min: 0, max: 99 }]),
        'synth:ui_hierarchy': JSON.stringify({
            levels: {
                root: {
                    knobs: ['gain'],
                    params: [{ level: 'models', label: 'Choose Model' },
                             { level: 'cabs', label: 'Choose Cabinet' }],
                },
                models: { label: 'Model', items_param: 'model_list', select_param: 'model_index', knobs: [], params: [] },
                cabs: { label: 'Cabinet', items_param: 'cab_list', select_param: 'cab_index', knobs: [], params: [] },
            },
        }),
        'synth:gain': '0',
        'synth:model_list': JSON.stringify([{ label: 'Tweed', index: 0 }, { label: 'Plexi', index: 1 }]),
        'synth:model_index': '0',
        'synth:cab_list': JSON.stringify([{ label: '4x12', index: 0 }]),
        'synth:cab_index': '0',
    });
    const sels = m.dumpLayout().params.filter(p => p && p.renderStyle === 'items');
    eq('items: both nam selectors built',   sels.length,     2);
    eq('items: declaration order kept',     sels.map(p => p.key).join(','),
       'model_index,cab_index');
    eq('items: labelled from their levels', sels.map(p => p.label).join(','),
       'Model,Cabinet');
}

}
