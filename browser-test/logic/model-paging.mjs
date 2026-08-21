/* browser-test/logic/model-paging.mjs — paging: the page bar, level jumps, batched read-back, inferred metadata
 *
 * Run by browser-test/logic.mjs. The suite body is deliberately left at its
 * original indentation inside run() so blame survives the split.
 */

import {
    createModel, portFor, MOCK_SYNTHS, eq, bootModel, _log,
} from './harness.mjs';

export async function run() {
/* ── page indicator bar geometry ─────────────────────────────────────────── */

_log('\nTest: the page bar stays a readable ruler at every page count');
{
    const { drawBankBar } = await import('../../dist/esm/renderer/header.js');
    const W = 128;

    /* Capture the bar's rects. Height 2 marks the current page. */
    function bar(index, count) {
        const rects = [];
        const real = globalThis.fill_rect;
        globalThis.fill_rect = (x, y, w, h) => { if (y === 8) rects.push({ x, w, h }); };
        drawBankBar(index, count);
        globalThis.fill_rect = real;
        return rects;
    }

    for (const n of [2, 5, 13, 25, 50, 70]) {
        const rects = bar(1, n);
        const widths = [...new Set(rects.map(r => r.w))];
        const right  = Math.max(...rects.map(r => r.x + r.w));
        const left   = Math.min(...rects.map(r => r.x));
        eq(`bar n=${n}: one segment per page`,        rects.length, n);
        eq(`bar n=${n}: every segment visible`,       rects.every(r => r.w >= 1), true);
        eq(`bar n=${n}: spans the full width`,        `${left}..${right}`, `0..${W}`);
        eq(`bar n=${n}: current page is the tall one`,
            rects.filter(r => r.h === 2).length, 1);
        /* Segments carry the leftover pixels, so they differ by at most 1 — the
         * bug was a final segment 2.5x the rest. */
        eq(`bar n=${n}: segment widths within 1px (${widths.sort((a, b) => a - b).join('/')})`,
            Math.max(...widths) - Math.min(...widths) <= 1, true);
        /* A gap is a separator, never a spacer: 1px, or 0 once the page count
         * leaves no room for one. A 2px gap reads as a broken ruler. */
        const sorted = [...rects].sort((a, b) => a.x - b.x);
        const gaps   = sorted.slice(1).map((r, i) => r.x - (sorted[i].x + sorted[i].w));
        eq(`bar n=${n}: no gap wider than 1px (max ${Math.max(...gaps)})`,
            Math.max(...gaps) <= 1, true);
        eq(`bar n=${n}: gaps never overlap`, gaps.every(g => g >= 0), true);
        /* Separators only collapse when one pixel per page plus one pixel per
         * gap no longer fits (n > 64 on a 128px bar). */
        eq(`bar n=${n}: gaps collapse only when forced`,
            gaps.some(g => g === 0), n * 2 - 1 > W);
    }

    /* Pages of one bank are flush; a gap marks where the next bank starts. */
    function barGrouped(index, groups) {
        const rects = [];
        const real = globalThis.fill_rect;
        globalThis.fill_rect = (x, y, w, h) => { if (y === 8) rects.push({ x, w, h }); };
        drawBankBar(index, groups.length, false, groups);
        globalThis.fill_rect = real;
        return rects.sort((a, b) => a.x - b.x);
    }
    {
        // Three banks: 3 pages, 1 page, 2 pages — osirus's shape in miniature.
        const groups = [0, 0, 0, 1, 2, 2];
        const r = barGrouped(0, groups);
        const gaps = r.slice(1).map((s, i) => s.x - (r[i].x + r[i].w));
        eq('bar groups: gap only where the bank changes',
            gaps.join(','), '0,0,1,1,0');
        eq('bar groups: still spans the full width',
            `${r[0].x}..${r[r.length - 1].x + r[r.length - 1].w}`, `0..${W}`);
        const widths = r.map(s => s.w);
        eq('bar groups: segment widths within 1px',
            Math.max(...widths) - Math.min(...widths) <= 1, true);
    }
    {
        // minijv on device: 70 pages across 51 banks. Every boundary keeps its
        // separator because pages inside a bank no longer each pay for one.
        const groups = [];
        for (let b = 0; b < 70; b++) groups.push(Math.min(50, Math.floor(b * 51 / 70)));
        const r = barGrouped(35, groups);
        const gaps = r.slice(1).map((s, i) => s.x - (r[i].x + r[i].w));
        const bounds = groups.slice(1).filter((g, i) => g !== groups[i]).length;
        eq('bar groups n=70: one gap per bank boundary',
            gaps.filter(g => g === 1).length, bounds);
        eq('bar groups n=70: no gap inside a bank',
            gaps.every((g, i) => g === (groups[i + 1] !== groups[i] ? 1 : 0)), true);
        eq('bar groups n=70: every page still visible', r.every(s => s.w >= 1), true);
        eq('bar groups n=70: spans the full width',
            `${r[0].x}..${r[r.length - 1].x + r[r.length - 1].w}`, `0..${W}`);
    }

    /* Beyond one pixel per page a ruler is impossible; the bar becomes a
     * position marker rather than drawing nothing. */
    const huge = bar(100, 300);
    eq('bar n=300: degrades to a marker on a full-width line', huge.length, 2);
    eq('bar n=300: marker is the tall one', huge.filter(r => r.h === 2).length, 1);
    eq('bar n=300: marker stays on screen',
        huge.every(r => r.x >= 0 && r.x + r.w <= W), true);
}

/* ── shift+jog jumps level to level, not page to page ────────────────────── */

_log('\nTest: changePageGroup skips a level\'s overflow pages');
{
    const m = bootModel(MOCK_SYNTHS.hier_params_overflow_two_levels);
    eq('group: 3 pages (Main, Main - 2, Effects)', m.getViewModel().bankCount, 3);
    eq('group: starts on page 0',             m.getKnobPage(), 0);
    m.changePageGroup(1);
    eq('group: +1 lands on the next level',   m.getKnobPage(), 2);   // skips "Main - 2"
    m.changePageGroup(1);
    eq('group: clamps at the last level',     m.getKnobPage(), 2);
    m.changePageGroup(-1);
    eq('group: -1 returns to the level head', m.getKnobPage(), 0);
    m.changePage(1);
    m.changePageGroup(-1);
    eq('group: -1 from mid-level goes to that level\'s head', m.getKnobPage(), 0);
}

/* ── read-back visits the current page fast regardless of module size ────── */

_log('\nTest: refresh cursor reaches the current page within 16 ticks');
{
    const m = bootModel(MOCK_SYNTHS.hier_many_pages);   // 25 pages
    const PAGE = 20;                                    // far from the cursor's start
    for (let i = 0; i < PAGE; i++) m.changePage(1);
    const reads = [];
    const realGet = globalThis.shadow_get_param;
    globalThis.shadow_get_param = (slot, key) => { reads.push(key); return realGet(slot, key); };
    for (let i = 0; i < 16; i++) m.tick();
    globalThis.shadow_get_param = realGet;

    const pageKeys = m.dumpLayout().params
        .slice(PAGE * 8, PAGE * 8 + 8).filter(Boolean).map(p => p.key);
    const missed = pageKeys.filter(k => !reads.includes('synth:' + k));
    eq('refresh: every current-page param read within 16 ticks', missed.join(','), '');
    eq('refresh: no more than 2 reads per tick', reads.length <= 32, true);
}

/* ── a movy chain refreshes in batches, because its reads are round trips ── */

_log('\nTest: movy-track value refresh is batched, not one read per tick');
{
    const { resetPorts } = await import('../../dist/esm/track/registry.js');
    const { REFRESH_BULK_TICKS } = await import('../../dist/esm/model/constants.js');
    const { encodeBulk, decodeBulk } = await import('../../dist/esm/track/bulk.js');

    /* The whole preset, namespaced to chain 0 — a movy track reads `ch0:` keys
     * through the engine, never shadow_get_param. */
    const vals = {};
    for (const [k, v] of Object.entries(MOCK_SYNTHS.plaits)) vals['ch0:' + k] = v;

    const oG  = globalThis.host_module_get_param;
    const oBG = globalThis.shadow_get_params;
    let gets = [], bulks = 0;
    globalThis.host_module_get_param = (k) => { gets.push(k); return vals[k] ?? null; };
    globalThis.shadow_get_params = (_slot, _marker, payload) => {
        bulks++;
        const keys = decodeBulk(payload);
        return encodeBulk(keys.map((k) => vals[k] ?? ''));
    };

    resetPorts();
    const m = createModel(portFor(4), 'synth');   // track 5 = movy chain 0
    m.reload(); m.tick(); m.tick();

    const TICKS = 4 * REFRESH_BULK_TICKS;
    gets = []; bulks = 0;
    for (let i = 0; i < TICKS; i++) m.tick();

    /* The point of the change: value reads are one round trip per window, not
     * one per tick. Without it this is ~32 blocking gets, ~2.3 ms each, on a
     * tick period that IS the pad sampling interval. */
    eq('movy refresh: at most one bulk read per window', bulks <= TICKS / REFRESH_BULK_TICKS, true);
    eq('movy refresh: made some bulk reads', bulks > 0, true);
    const valueGets = gets.filter((k) => k !== 'ch0:synth:name' && k !== 'ch0:synth_module');
    eq('movy refresh: no per-param reads outside the batch', valueGets.join(','), '');

    /* Batched must still mean CONVERGING: a value changed behind the model's
     * back has to reach the knob, or this traded latency for a stale screen. */
    const layout = m.dumpLayout().params;
    const pk = layout.find((p) => p && p.type !== 'enum' && p.type !== 'file').key;
    const before = m.getValueByKey(pk);
    vals['ch0:synth:' + pk] = String(Number(vals['ch0:synth:' + pk]) + 0.25);
    for (let i = 0; i < REFRESH_BULK_TICKS * 2; i++) m.tick();
    eq('movy refresh: a value changed behind the model reaches the knob',
       m.getValueByKey(pk), before + 0.25);

    /* Session view ticks the master FX model as well, so the shared tick counter
     * advances by two per app tick. A modulo schedule read off that counter can
     * sit on one residue forever and never refresh; the cadence is per model. */
    const other = createModel(portFor(0), 'synth');
    bulks = 0;
    for (let i = 0; i < 4 * REFRESH_BULK_TICKS; i++) { m.tick(); other.tick(); }
    eq('movy refresh: still refreshes when a second model ticks alongside', bulks > 0, true);

    globalThis.host_module_get_param = oG;
    globalThis.shadow_get_params = oBG;
    resetPorts();
}

/* ── the cheap port keeps reading every tick ──────────────────────────────── */

_log('\nTest: a host track is NOT batched (its reads are cheap and unbatchable)');
{
    const m = bootModel(MOCK_SYNTHS.plaits);
    const reads = [];
    const realGet = globalThis.shadow_get_param;
    globalThis.shadow_get_param = (slot, key) => { reads.push(key); return realGet(slot, key); };
    for (let i = 0; i < 16; i++) m.tick();
    globalThis.shadow_get_param = realGet;
    /* The shim's bulk channel routes only to the overtake DSP, so a host slot
     * cannot batch even if it wanted to — it must keep its per-tick read. */
    eq('host refresh: still reads per tick', reads.length >= 8, true);
}

/* ── C1: preset knob not duplicated across pages ─────────────────────────── */

_log('\nTest: preset knob renders exactly once (C1)');

{
    const m = bootModel(MOCK_SYNTHS.preset_dup);
    const params = m.dumpLayout().params.filter(Boolean);
    const presetCells = params.filter(p => p.renderStyle === 'preset');
    eq('preset_dup: exactly one preset knob across all pages', presetCells.length, 1);
    eq('preset_dup: preset key is "preset"', presetCells[0]?.key, 'preset');
    // Regular knobs survive the dedupe.
    eq('preset_dup: base_note still present', params.some(p => p.key === 'base_note'), true);
    // Dedicated Preset page exists (root has 8 knobs → presetSeparate).
    eq('preset_dup: first bank = Preset', m.getViewModel().bankName, 'Preset');
}

/* ── B1: chain_params with no ui_hierarchy still builds param pages ───────── */

_log('\nTest: chain_params-only module builds pages (B1)');

{
    const m = bootModel(MOCK_SYNTHS.chainparams_only);
    const dump = m.dumpLayout();
    const params = dump.params.filter(Boolean);
    // 9 user params (ui_page skipped) → 2 pages of 8.
    eq('chainparams_only: 9 params (ui_* skipped)', params.length, 9);
    eq('chainparams_only: no ui_page param', params.some(p => p.key === 'ui_page'), false);
    eq('chainparams_only: bankCount = 2', m.getBankCount(), 2);
    // chain_params order preserved.
    eq('chainparams_only: first param = map_x', params[0]?.key, 'map_x');
    // Metadata carried through: enum, filepath, ranges.
    const mode = params.find(p => p.key === 'mode');
    eq('chainparams_only: mode is enum', mode?.type, 'enum');
    eq('chainparams_only: mode options length 3', mode?.options?.length, 3);
    const sample = params.find(p => p.key === 'sample');
    eq('chainparams_only: sample is file', sample?.type, 'file');
    const gain = params.find(p => p.key === 'gain');
    eq('chainparams_only: gain max = 2', gain?.max, 2);
    const spread = params.find(p => p.key === 'spread');
    eq('chainparams_only: spread is int', spread?.type, 'int');
    eq('chainparams_only: spread min = -12', spread?.min, -12);
    // filepath must not be double-added by the orphan-filepath injection.
    eq('chainparams_only: sample appears once', params.filter(p => p.key === 'sample').length, 1);
}

/* Existing hierarchy-driven mocks are unaffected by the B1 fallback. */
{
    eq('test8 unaffected: bankCount = 1', bootModel(MOCK_SYNTHS.test8).getBankCount(), 1);
    eq('moog unaffected: bankCount = 12', bootModel(MOCK_SYNTHS.moog).getBankCount(), 12);
    eq('granny unaffected: sample is file',
        bootModel(MOCK_SYNTHS.granny_like).dumpLayout().params.find(p => p?.key === 'sample_path')?.type,
        'file');
}

/* ── C4: metadata-less params infer int type + range on first read ───────── */

_log('\nTest: guessed-meta params infer int/range on read (C4)');

{
    const m = bootModel(MOCK_SYNTHS.guessed_meta);
    // Right after load only knob 0 (base_note) has been refreshed; a later knob
    // is still the raw float guess, flagged for inference.
    const atLoad = m.dumpLayout().params.filter(Boolean);
    eq('guessed_meta: plugin_index guessed float at load', atLoad.find(p => p.key === 'plugin_index')?.type, 'float');
    eq('guessed_meta: plugin_index flagged metaGuessed',   atLoad.find(p => p.key === 'plugin_index')?.metaGuessed, true);

    // Ticks cycle refreshOneParam over every param → first read triggers inference.
    for (let i = 0; i < 60; i++) m.tick();

    // Positive int → 0 .. smallest power-of-two ≥ value.
    eq('guessed_meta: base_note inferred int',    m.paramRangeByKey('base_note')?.type, 'int');
    eq('guessed_meta: base_note widened max = 64', m.paramRangeByKey('base_note')?.max, 64);
    eq('guessed_meta: base_note value = 60',       m.getValueByKey('base_note'), 60);
    eq('guessed_meta: plugin_index max = 4 (pow2 ≥ 3)', m.paramRangeByKey('plugin_index')?.max, 4);

    // Negative → symmetric bounds.
    eq('guessed_meta: transpose inferred int', m.paramRangeByKey('transpose')?.type, 'int');
    eq('guessed_meta: transpose min = -24',    m.paramRangeByKey('transpose')?.min, -24);
    eq('guessed_meta: transpose max = 24',     m.paramRangeByKey('transpose')?.max, 24);

    // Float in [0,1] keeps the guess.
    eq('guessed_meta: depth stays float', m.paramRangeByKey('depth')?.type, 'float');
    eq('guessed_meta: depth max = 1',     m.paramRangeByKey('depth')?.max, 1);

    // metaGuessed cleared after inference (learned once, like enumFmt).
    eq('guessed_meta: base_note metaGuessed cleared',
        m.dumpLayout().params.find(p => p?.key === 'base_note')?.metaGuessed, undefined);
}

/* meta-infer pure helper — direct unit tests. */
_log('\nTest: inferGuessedMeta pure helper (C4)');
{
    const { inferGuessedMeta } = await import('../../dist/esm/model/meta-infer.js');
    const base = { type: 'float', min: 0, max: 1, step: 0.02 };
    eq('infer: int 60 → int',          inferGuessedMeta(base, '60')?.type, 'int');
    eq('infer: int 60 → max 64',       inferGuessedMeta(base, '60')?.max, 64);
    eq('infer: int 60 → min 0',        inferGuessedMeta(base, '60')?.min, 0);
    eq('infer: int 60 → step 1',       inferGuessedMeta(base, '60')?.step, 1);
    eq('infer: int -24 → min -24',     inferGuessedMeta(base, '-24')?.min, -24);
    eq('infer: int -24 → max 24',      inferGuessedMeta(base, '-24')?.max, 24);
    eq('infer: int 30 → pow2 max 32',  inferGuessedMeta(base, '30')?.max, 32);
    eq('infer: int 64 → max 64',       inferGuessedMeta(base, '64')?.max, 64);
    eq('infer: float 0.5 → no change', inferGuessedMeta(base, '0.5'), null);
    eq('infer: value 1 → no change',   inferGuessedMeta(base, '1'), null);
    eq('infer: value 0 → no change',   inferGuessedMeta(base, '0'), null);
    eq('infer: non-numeric → no change', inferGuessedMeta(base, 'abc'), null);
}

}
