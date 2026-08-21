/* browser-test/logic/model-hierarchy.mjs — module hierarchy: banks, nav-only levels, level-graph traversal, async metadata
 *
 * Run by browser-test/logic.mjs. The suite body is deliberately left at its
 * original indentation inside run() so blame survives the split.
 */

import {
    MOCK_SYNTHS, NAME_POLL_TICKS, META_RETRY_LIMIT, fail, eq, notMatch,
    bootModel, bankNames, _log, env,
} from './harness.mjs';

export async function run() {
/* ── vm.moduleName is raw name — no track prefix ─────────────────────────── */

_log('\nTest: vm.moduleName is raw module name (no track prefix)');

for (const [name, preset] of [
    ['Test 8',  MOCK_SYNTHS.test8    ],
    ['Plaits',  MOCK_SYNTHS.plaits   ],
    ['OB-Xd',  MOCK_SYNTHS.obxd_like],
    ['Wurl',   MOCK_SYNTHS.wurl     ],
]) {
    const vm = bootModel(preset).getViewModel();
    eq(`${name}: vm.moduleName`, vm.moduleName, name);
    notMatch(`${name}: no T> prefix`, vm.moduleName, /^T\d+ > /);
}

/* ── moduleName is slot-independent ─────────────────────────────────────── */

_log('\nTest: vm.moduleName does not vary by activeSlot');

for (const slot of [0, 1, 2, 3]) {
    const vm = bootModel(MOCK_SYNTHS.test8, slot).getViewModel();
    eq(`slot ${slot}: moduleName = 'Test 8'`, vm.moduleName, 'Test 8');
}

/* ── bank structure ───────────────────────────────────────────────────────── */

_log('\nTest: bankCount and bankName');

{
    const vm = bootModel(MOCK_SYNTHS.test8).getViewModel();
    eq('test8: bankCount = 1', vm.bankCount, 1);
    eq('test8: bankName empty (single bank)', vm.bankName, '');
}

{
    const vm = bootModel(MOCK_SYNTHS.obxd_like).getViewModel();
    eq('obxd: bankCount = 4 (preset + main + global + filter)', vm.bankCount, 4);
    eq('obxd: first bankName = Preset', vm.bankName, 'Preset');
}

/* ── nav-only level expansion ─────────────────────────────────────────────── */

_log('\nTest: navigation-only levels expand recursively');

{
    const m = bootModel(MOCK_SYNTHS.nav_levels);
    eq('nav_levels: bankCount = 4', m.getViewModel().bankCount, 4);

    const names = [];
    for (let i = 0; i < 4; i++) {
        if (i > 0) m.changePage(1);
        names.push(m.getViewModel().bankName);
    }
    eq('nav_levels: bank 0 = Main',       names[0], 'Main');
    eq('nav_levels: bank 1 = Main',       names[1], 'Main');
    eq('nav_levels: bank 2 = Mod/Pitch',  names[2], 'Mod/Pitch');
    eq('nav_levels: bank 3 = Mod/Filter', names[3], 'Mod/Filter');
    eq('nav_levels: no bare Mod bank',    names.includes('Mod'), false);

    // page 2 (Mod/Pitch) should expose 3 params
    m.changePage(-1);
    eq('nav_levels: Mod/Pitch has 3 params',
        m.getViewModel().rows.flat().filter(Boolean).length, 3);
}

/* ── moog: generic children-delegation hierarchy → 12 banks ─────────────── */

_log('\nTest: moog hierarchy via children delegation (generic path)');

{
    const m = bootModel(MOCK_SYNTHS.moog);
    const bankNames = [];
    for (let i = 0; i < 12; i++) {
        if (i > 0) m.changePage(1);
        bankNames.push(m.getViewModel().bankName);
    }
    eq('moog: bankCount = 12', m.getViewModel().bankCount, 12);
    eq('moog: bank 0  = Preset',       bankNames[0],  'Preset');
    eq('moog: bank 1  = Main',         bankNames[1],  'Main');
    eq('moog: bank 2  = Oscillator 1', bankNames[2],  'Oscillator 1');
    eq('moog: bank 6  = Mixer',        bankNames[6],  'Mixer');
    eq('moog: bank 11 = Performance',  bankNames[11], 'Performance');

    // Osc banks (2-5): row[0] = [wave, volume, range, detune/noise]; wave+range are int
    m.changePage(-11); // back to bank 0
    for (let bank = 0; bank < 12; bank++) {
        if (bank > 0) m.changePage(1);
        if (bank < 2 || bank > 5) continue;
        const oscNum = bank - 1;
        const vm2  = m.getViewModel();
        const wave  = vm2.rows[0][0];
        const range = vm2.rows[0][2];
        if (!wave)  { fail(`moog: Osc ${oscNum} wave slot non-null`,  'null'); continue; }
        if (!range) { fail(`moog: Osc ${oscNum} range slot non-null`, 'null'); continue; }
        eq(`moog: Osc ${oscNum} wave type = int`,  wave.type,  'int');
        eq(`moog: Osc ${oscNum} range type = int`, range.type, 'int');
    }

    // Main bank (bank 1): 8 non-null params
    m.changePage(-11);
    m.changePage(1);
    eq('moog: Main bank has 8 params',
        m.getViewModel().rows.flat().filter(Boolean).length, 8);

    // osc1_range min=-2 max=2 via chain_params
    const moogRange = bootModel({ ...MOCK_SYNTHS.moog, 'synth:osc1_range': '-2' });
    for (let i = 0; i < 60; i++) moogRange.tick();
    moogRange.changePage(2); // bank 0 → bank 2 = Oscillator 1
    {
        const rangeSlot = moogRange.getViewModel().rows[0][2];
        if (!rangeSlot) { fail('moog: osc1_range slot exists', 'null'); }
        else {
            eq('moog: osc1_range displayValue for -2', rangeSlot.displayValue, '-2');
            const expectedNv = ((-2) - (-2)) / (2 - (-2)); // 0
            eq('moog: osc1_range normalizedValue reflects min=-2',
                Math.round(rangeSlot.normalizedValue * 100), Math.round(expectedNv * 100));
        }
    }
}

/* ── full level-graph traversal (generic path) ───────────────────────────── */


_log('\nTest: root.children nav list is traversed (helm shape)');
{
    const names = bankNames(bootModel(MOCK_SYNTHS.hier_children_nav));
    eq('children_nav: bankCount = 3',       names.length, 3);
    eq('children_nav: bank 0 = Main',       names[0], 'Main');
    eq('children_nav: bank 1 = Oscillator', names[1], 'Oscillator');
    eq('children_nav: bank 2 = Filter',     names[2], 'Filter');
}

_log('\nTest: a level with knobs AND sub-levels renders both (dexed shape)');
{
    const names = bankNames(bootModel(MOCK_SYNTHS.hier_knobs_and_children));
    eq('knobs_and_children: bankCount = 4',      names.length, 4);
    eq('knobs_and_children: bank 0 = Main',      names[0], 'Main');
    eq('knobs_and_children: bank 1 = Operators', names[1], 'Operators');
    eq('knobs_and_children: bank 2 (depth 2)',   names[2], 'Operat/Operator 1');
    eq('knobs_and_children: bank 3 (depth 3)',   names[3], 'Oper1/Envelope');
}

_log('\nTest: a level duplicating root renders once, its children still render');
{
    const names = bankNames(bootModel(MOCK_SYNTHS.hier_alias_level));
    eq('alias_level: bankCount = 2',           names.length, 2);
    eq('alias_level: bank 0 = Main',           names[0], 'Main');
    eq('alias_level: no duplicate Patch page', names.includes('Patch'), false);
    eq('alias_level: bank 1 = Deep',           names[1], 'Deep');
}

_log('\nTest: orphan levels with knobs are swept in');
{
    const names = bankNames(bootModel(MOCK_SYNTHS.hier_orphan_level));
    eq('orphan_level: bankCount = 2', names.length, 2);
    eq('orphan_level: bank 1 = Perf', names[1], 'Perf');
}

/* ── params[] extras: the osirus Preset/Bank/ROM gap ─────────────────────── */

_log('\nTest: level params[] entries render after that level\'s knobs');
{
    const m = bootModel(MOCK_SYNTHS.hier_params_extras);
    const keysOf = (pg) =>
        m.dumpLayout().params.slice(pg * 8, pg * 8 + 8).filter(Boolean).map(p => p.key);
    const names = bankNames(m);
    eq('extras: page 0 = Main',        names[0], 'Main');
    eq('extras: page 1 = Oscillators', names[1], 'Oscillators');
    eq('extras: page 2 = Settings',    names[2], 'Settings');
    eq('extras: root keeps its knobs',
        JSON.stringify(keysOf(0)), JSON.stringify(['cutoff', 'dupe']));
    eq('extras: osc knobs then params, deduped',
        JSON.stringify(keysOf(1)), JSON.stringify(['pw', 'wave', 'semi']));
    eq('extras: settings renders its params-only key',
        JSON.stringify(keysOf(2)), JSON.stringify(['rom']));
    const all = m.dumpLayout().params.filter(Boolean).map(p => p.key);
    eq('extras: ui_* key never rendered',     all.includes('ui_scroll'), false);
    eq('extras: degenerate min==max skipped', all.includes('bank_index'), false);
    // pushnpull publishes a `canvas` param (a drawing surface for its web UI);
    // there is no knob that can edit one.
    eq('extras: non-knob type skipped',       all.includes('view'), false);
    eq('extras: no key rendered twice',       all.length, new Set(all).size);
}

_log('\nTest: a level overflowing 8 slots numbers from " - 2"');
{
    const names = bankNames(bootModel(MOCK_SYNTHS.hier_params_overflow));
    eq('overflow: page 0 keeps the bare name', names[0], 'Main');
    eq('overflow: page 1 is " - 2"',           names[1], 'Main - 2');
}

/* ── async metadata: preset list + enum options that arrive after load ───── */

_log('\nTest: preset count and enum options are re-resolved when they land');
{
    const m = bootModel(MOCK_SYNTHS.hier_async_meta);
    const romOf = () => m.dumpLayout().params.filter(Boolean).find(p => p.key === 'rom');
    eq('async: no Preset knob while the count is 0',
        m.dumpLayout().params.filter(Boolean).some(p => p.renderStyle === 'preset'), false);
    eq('async: ROM shows the placeholder at first',
        JSON.stringify(romOf().options), JSON.stringify(['(loading)']));

    // The ROM lands: preset list and real options appear.
    env.setParams({
        ...MOCK_SYNTHS.hier_async_meta,
        "synth:preset_count": "3",
        "synth:preset_names": JSON.stringify(['Init', 'Bass', 'Lead']),
        "synth:chain_params": JSON.stringify([
            { key: "cutoff", name: "Cutoff", type: "int", min: 0, max: 127 },
            { key: "rom",    name: "ROM",    type: "enum", options: ["Virus A", "Virus B", "Virus C"] },
        ]),
    });
    for (let i = 0; i < 4 * NAME_POLL_TICKS; i++) m.tick();

    const preset = m.dumpLayout().params.filter(Boolean).find(p => p.renderStyle === 'preset');
    eq('async: Preset knob appears once the count is non-zero', !!preset, true);
    eq('async: Preset knob carries the real names',
        JSON.stringify(preset?.options), JSON.stringify(['Init', 'Bass', 'Lead']));
    eq('async: ROM options are re-read',
        JSON.stringify(romOf().options), JSON.stringify(['Virus A', 'Virus B', 'Virus C']));
}

_log('\nTest: a param that widens its range after load becomes reachable');
{
    /* osirus's Bank: device-measured 0..0 immediately after load, 0..1 once the
     * ROM lists the banks (scripts/probe-async-meta.mjs). */
    const withBank = (max) => ({
        "synth:name": "Banker",
        "synth:chain_params": JSON.stringify([
            { key: "cutoff",     name: "Cutoff", type: "int", min: 0, max: 127 },
            { key: "bank_index", name: "Bank",   type: "int", min: 0, max },
        ]),
        "synth:ui_hierarchy": JSON.stringify({
            levels: { root: { knobs: ["cutoff"], params: [{ key: "bank_index", label: "Bank" }] } },
        }),
        "synth:cutoff": "64", "synth:bank_index": "0",
    });
    const keys = (m) => m.dumpLayout().params.filter(Boolean).map(p => p.key);

    const m = bootModel(withBank(0));
    eq('widen: unturnable Bank is not rendered at load', keys(m).includes('bank_index'), false);

    env.setParams(withBank(1));
    for (let i = 0; i < 4 * NAME_POLL_TICKS; i++) m.tick();
    eq('widen: Bank appears once the module reports a real range',
        keys(m).includes('bank_index'), true);
}

_log('\nTest: a same-module rebuild keeps the current page');
{
    const m = bootModel(MOCK_SYNTHS.hier_params_overflow_two_levels);
    m.changePage(2);
    m.reload();
    m.tick(); m.tick();
    eq('rebuild: page survives a same-module reload', m.getKnobPage(), 2);
}

_log('\nTest: the async retry latches off and does not poll forever');
{
    const m = bootModel(MOCK_SYNTHS.hier_async_meta);   // never settles
    let reads = 0;
    const realGet = globalThis.shadow_get_param;
    globalThis.shadow_get_param = (slot, key) => {
        if (key === 'synth:preset_count' || key === 'synth:chain_params') reads++;
        return realGet(slot, key);
    };
    for (let i = 0; i < 40 * NAME_POLL_TICKS; i++) m.tick();
    globalThis.shadow_get_param = realGet;
    /* Absolute bound, not META_RETRY_LIMIT + n: comparing against the constant
     * under test would pass however large it grew. 40 polls of a module that
     * never settles must still cost only the handful of probes the latch allows. */
    eq(`async: probes stop after the retry budget (${reads} reads in 40 polls)`,
        reads <= 10, true);
    eq('async: META_RETRY_LIMIT is a small budget', META_RETRY_LIMIT <= 16, true);
}

}
