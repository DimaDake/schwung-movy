/* drum-automation.mjs — the drum automation diagnosis matrix (plan
 * 2026-09-30-drum-modules-schwung-pages.md, Phase 1).
 *
 * One row per (priority drum module, pad), answering for a held-step lock on
 * pad N's first per-pad knob, under the SCHWUNG grid mode:
 *
 *   (a) laneKey   which key the lane binds to — `knobParamInfo(slot).ioKey`,
 *                 the very value `handleAutomationKnob` hands `assignLane`;
 *   (c) padExact  whether that key IS pad N's own key. The engine writes a
 *                 lane's key straight to the module (plan D1), so this alone
 *                 decides whether playback reaches pad N and only pad N. (b),
 *                 the chain's CC param table, went with the CC path in Phase 2;
 *   (d) arc/mark  whether the held step's decoration and the lane mark draw on
 *                 pad N's cell, whether they leak onto another pad's page, and
 *                 whether the lane survives the next label sync.
 *
 * NOTHING HERE RE-STATES A RULE. Every column is the real code path's answer:
 * the real controller planning the dumped contract through movy's io, movy's
 * own lane registry, `buildAutomationView` (app/tick.ts), the page's render,
 * the controller's own `marks()` after its read rotation, and `validateTrackLane` — the label sync's own judge.
 *
 * THE SNAPSHOT IS THE REGRESSION TEST for the later phases: the verdicts,
 * failures included, are frozen in drum-automation-expect.json, so a fix and a
 * regression both show up as a named cell change. After an intentional change:
 *   UPDATE_DRUM_MATRIX=1 npm test   (or just the logic suite)
 *
 * Run by browser-test/logic.mjs. SKIPPED without a SCHWUNG checkout.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { schwungLibAvailable, bootModel, settleModel, ok, fail, _log, env, MOCK_SYNTHS, appState,
         setSchwungGridMode, schwungGridReload, schwungPageFor, resetSeqEngine } from './harness.mjs';
import { dumpEntry, dumpFixture } from '../dump-fixture.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXPECT = join(HERE, '..', 'drum-automation-expect.json');
const UPDATE = process.env.UPDATE_DRUM_MATRIX === '1';

/* The plan's priority list, then its best-effort pair. `po32-drum` is libpo32's
 * module id. */
export const DRUM_MODULES = ['6w6', '8w8', '9w9', 'cw78', 'mrdrums', 'weird-dreams', 'forge',
                             'sophie', 'simian', 'dr32', 'po32-drum', 'krautdrums'];

const ROOT = '/data/UserData/schwung/modules/sound_generators/';

/* Serve the module's own files from the capture — the movy_config.json it
 * ships and its module.json — over whatever the env already serves (movy's
 * override configs). Returns the restore. */
function serveModuleFiles(e) {
    const prev = globalThis.host_read_file;
    const files = { [ROOT + e.id + '/module.json']: JSON.stringify(e.module_json ?? {}) };
    if (e.movy_config) files[ROOT + e.id + '/movy_config.json'] = JSON.stringify(e.movy_config);
    globalThis.host_read_file = (p) => (p in files ? files[p] : (prev ? prev(p) : null));
    return () => { globalThis.host_read_file = prev; };
}

/** The headline verdicts a row adds up to — pure, so it can be proven. */
export function verdicts(r) {
    return {
        sounds: r.padExact,
        draws: r.arc && r.mark && !r.arcOther && !r.markOther && r.survivesSync,
    };
}

export async function run() {

if (!schwungLibAvailable()) {
    _log('\nlogic: drum automation matrix — SKIPPED (no param_pages; set SCHWUNG=)');
    return;
}

const { resetAutomation, assignLane } = await import('../../dist/esm/seq/automation.js');
const { seqState } = await import('../../dist/esm/seq/state.js');
const { buildAutomationView } = await import('../../dist/esm/app/tick.js');
const { automationFor, validateTrackLane } = await import('../../dist/esm/app/automated-keys.js');
const { concreteKey, aliasFromConcrete } = await import('../../dist/esm/model/pad-scope.js');
const { resolveChildKey, childCount } = await import(
    join(resolve(process.env.SCHWUNG), 'src', 'shared', 'param_pages', 'child_key.mjs'));
/* What app/globals.ts registers at start-up — the label sync's child-level
 * reader (model/child-keys.ts). */
const { setChildKeyResolver } = await import('../../dist/esm/model/child-keys.js');
setChildKeyResolver(resolveChildKey, childCount);

/* ── the teeth of the pure verdicts ──────────────────────────────────────── */
_log('\nlogic: drum automation matrix — verdict teeth');
{
    const good = { padExact: true, arc: true, mark: true,
                   arcOther: false, markOther: false, survivesSync: true };
    ok('a row bound to pad N’s own key sounds', verdicts(good).sounds);
    ok('...and one marked on its own pad only, that survives a sync, draws', verdicts(good).draws);
    ok('a key that is not pad N’s own does not sound right', !verdicts({ ...good, padExact: false }).sounds);
    ok('an arc that leaks onto another pad is not drawing right', !verdicts({ ...good, arcOther: true }).draws);
    ok('a lane the next sync purges is not drawing right', !verdicts({ ...good, survivesSync: false }).draws);
}

const dump = JSON.parse(readFileSync(join(HERE, '..', '..', 'docs', 'module-dump', 'device-dump.json'), 'utf8'));
const have = new Set(dump.modules.map((m) => m.id));

/* Arm the page and the lane exactly as the app does for one pad: focus it on
 * both halves (Schwung's page, movy's model), take the lock, let the
 * controller's read rotation learn the mark. Returns what the pad's page shows. */
function lockOnPad(p, model, pad, cell) {
    const jumped = p.focusVoice(pad);
    model.updateDrumPad(pad, pad);
    for (let i = 0; i < 4; i++) p.tick();
    const pageIdx = jumped ? p.pageIndex : cell.pageIdx;
    if (!jumped) { p.goToPage(pageIdx); for (let i = 0; i < 4; i++) p.tick(); }
    return { jumped, page: p.ctl.pages[pageIdx] };
}

/* The arc is what the page's own render hands the controller — the cells as
 * it resolves them, not the planned keys — read back off `ctl.decorations`. */
function looksAt(p, model, slot) {
    const view = buildAutomationView(0, model);
    p.render('T', view);
    const decs = p.ctl.decorations;
    for (let i = 0; i < 80; i++) p.tick();
    return { arc: !!(decs && decs[slot]), mark: ((p.marks() >> (8 + slot)) & 1) === 1 };
}

const rows = [];
const prevModels = appState.trackModels[0];
for (const id of DRUM_MODULES) {
    if (!have.has(id)) { fail(`drum matrix: ${id} is not in the capture — refresh docs/module-dump`); continue; }
    const e = dumpEntry(id);
    const restoreFs = serveModuleFiles(e);
    resetAutomation(); resetSeqEngine();
    setSchwungGridMode('page');
    schwungGridReload();
    const fixture = dumpFixture(id);
    const model = settleModel(bootModel(fixture));
    /* Where the app keeps it: the page resolves an alias to pad N through the
     * track's model (`automationFor` → `componentModelOf`). */
    appState.trackModels[0] = [model];
    env.setParams(fixture);
    const p = schwungPageFor(0, 'synth', null, automationFor);
    for (let i = 0; i < 12 * 60 && !p.ready; i++) p.tick();
    if (!p.ready) { fail(`drum matrix: ${id} page never resolved`); restoreFs(); continue; }

    const ps = model.getDrumConfig()?.padScoping ?? null;
    const padCount = model.getDrumConfig()?.padCount ?? 16;
    /* THE PER-PAD CELL: the first automatable knob that addresses one pad, on
     * the page pad 3 lands on — or, where a press lands nowhere (no voices
     * declared), on the first page carrying one. A key is per-pad when it is a
     * child-level template (not the level's own index knob), a movy alias, a
     * concrete key movy's scoping maps back to an alias, or any key of a page a
     * pad press jumped to (a sibling voice). */
    const probe = p.focusVoice(3);
    for (let i = 0; i < 4; i++) p.tick();
    const perPad = (pg, k) => !!k && (pg.childLevel ? k !== pg.childLevel.child_index_param
        : ps ? (k.startsWith(ps.aliasPrefix) || aliasFromConcrete(ps, k) !== null) : probe);
    const slotOn = (pg) => (Array.isArray(pg.keys) ? pg.keys : []).findIndex((k, s) => perPad(pg, k)
        && p.ctl.pages[p.pageIndex] === pg && p.knobParamInfo(s)?.automatable);
    const pageIdx = probe ? p.pageIndex
        : p.ctl.pages.findIndex((pg) => Array.isArray(pg.keys) && pg.keys.some((k) => perPad(pg, k)));
    if (pageIdx < 0) {
        /* A rack with no per-pad key anywhere (krautdrums: one level per
         * voice, no pad addressing) is a FINDING, recorded as such. */
        rows.push({ module: id, pad: 0, page: null, noPerPadPage: true,
                    pages: p.ctl.pages.map((pg) => pg.name) });
        restoreFs(); continue;
    }
    if (!probe) { p.goToPage(pageIdx); for (let i = 0; i < 4; i++) p.tick(); }
    const slot = slotOn(p.ctl.pages[pageIdx]);
    if (slot < 0) { fail(`drum matrix: ${id} has no automatable per-pad cell`); restoreFs(); continue; }
    const cell = { pageIdx, slot };

    for (const pad of [3, padCount]) {
        resetAutomation();
        seqState.heldLocks = new Map(); seqState.stepAutoMode = false;
        seqState.autoActive = 0; seqState.autoAssigned = 0;
        const { jumped, page } = lockOnPad(p, model, pad, cell);
        const key = page.keys[slot];
        const info = p.knobParamInfo(slot);
        const laneKey = info.ioKey;
        /* PAD N'S OWN KEY: the child level resolved at pad N, then movy's
         * alias scoping on top (forge's `{key}` template resolves to its own
         * `cv_*` alias, which the config then concretises). */
        const lvl = page.childLevel;
        const resolved = (lvl && resolveChildKey(lvl, pad - 1, key)) || key;
        /* A concrete key on a page that does not follow the pad (libpo32's
         * chain_params pages) is pad 3's; pad N's is its alias re-concretised. */
        const alias = ps ? aliasFromConcrete(ps, resolved) : null;
        const want = concreteKey(ps ?? undefined, pad, alias ?? resolved);
        const lane = assignLane(0, 0, info, () => true);
        seqState.stepAutoMode = true;
        seqState.heldLocks = new Map([[lane, 64]]);
        seqState.autoActive = 1 << lane; seqState.autoAssigned = 1 << lane;
        const here = looksAt(p, model, slot);
        /* Another pad's page, same lock: a pad-scoped lane must not show. */
        const other = pad === 3 ? 4 : 3;
        const o = lockOnPad(p, model, other, cell);
        const there = looksAt(p, model, slot);
        const tp = info.target + ':' + laneKey;
        const row = {
            module: id, pad, page: page.name, jumped, cell: key, laneKey, want,
            padExact: laneKey === want,
            arc: here.arc, mark: here.mark, arcOther: there.arc, markOther: there.mark,
            survivesSync: validateTrackLane(0, tp) !== 'drop',
        };
        rows.push({ ...row, ...verdicts(row) });
    }
    restoreFs();
}

appState.trackModels[0] = prevModels;
resetAutomation(); resetSeqEngine();
seqState.heldLocks = new Map(); seqState.stepAutoMode = false;
seqState.autoActive = 0; seqState.autoAssigned = 0;
schwungGridReload();
setSchwungGridMode(null);
env.setParams(MOCK_SYNTHS.test16);

_log('\nlogic: drum automation matrix (SCHWUNG grid mode)');
const yn = (b) => (b ? 'y' : '-');
_log('    module        pad page         jump laneKey            want               exact arc mark leakA leakM sync | SOUNDS DRAWS');
for (const r of rows) {
    if (r.noPerPadPage) { _log('    ' + r.module.padEnd(13) + '   — no per-pad page; planned: ' + r.pages.join(' | ')); continue; }
    _log('    ' + [r.module.padEnd(13), String(r.pad).padStart(3), String(r.page).slice(0, 12).padEnd(12),
        yn(r.jumped).padEnd(4), r.laneKey.padEnd(18), r.want.padEnd(18),
        yn(r.padExact).padEnd(5), yn(r.arc).padEnd(3), yn(r.mark).padEnd(4), yn(r.arcOther).padEnd(5),
        yn(r.markOther).padEnd(5), yn(r.survivesSync).padEnd(4)].join(' ')
        + ' | ' + (r.sounds ? 'yes' : 'NO ').padEnd(6) + ' ' + (r.draws ? 'yes' : 'NO'));
}

/* PHASE 3'S ACCEPTANCE, asserted outright rather than only through the
 * snapshot: a lock on pad N's per-pad knob sounds on pad N alone, and the held
 * arc and the lane mark draw on pad N's page alone and survive a sync. sophie
 * declares no voices, so a pad press cannot move its page yet — plan Phase 6
 * (D9) — and its lane binds whichever pad the page shows. */
const NOT_YET = new Set(['sophie']);
for (const r of rows) {
    if (r.noPerPadPage || NOT_YET.has(r.module)) continue;
    ok(`${r.module} pad ${r.pad}: the lock sounds on pad ${r.pad} only and draws there`, r.sounds && r.draws);
}

if (UPDATE || !existsSync(EXPECT)) {
    writeFileSync(EXPECT, JSON.stringify({ capture: dump.generated_at, rows }, null, 1) + '\n');
    _log('    baseline written to browser-test/drum-automation-expect.json');
    return;
}
const expect = JSON.parse(readFileSync(EXPECT, 'utf8'));
const keyOf = (r) => r.module + '#' + r.pad;
const was = new Map(expect.rows.map((r) => [keyOf(r), r]));
for (const r of rows) {
    const w = was.get(keyOf(r));
    if (!w) { fail(`drum matrix: new row ${keyOf(r)} — re-baseline with UPDATE_DRUM_MATRIX=1`); continue; }
    const diff = Object.keys(r).filter((k) => JSON.stringify(r[k]) !== JSON.stringify(w[k]));
    if (diff.length) {
        fail(`drum matrix: ${keyOf(r)} changed: ` + diff.map((k) => `${k} ${JSON.stringify(w[k])}→${JSON.stringify(r[k])}`).join(', ')
            + ' — if intended, re-baseline with UPDATE_DRUM_MATRIX=1');
    }
    was.delete(keyOf(r));
}
for (const k of was.keys()) fail(`drum matrix: row ${k} disappeared — re-baseline with UPDATE_DRUM_MATRIX=1`);
ok(`drum automation matrix matches its baseline (${rows.length} rows)`, true);
}
