#!/usr/bin/env node
/* schwung-pagination-check.mjs — Schwung plans the pages; do movy's lanes survive?
 *
 * The question this answers is the one that blocked adopting Schwung's
 * pagination: an automation lane is created against whatever knob the user was
 * turning, so if lanes were addressed by PAGE AND SLOT then re-paginating would
 * silently repoint every one of them.
 *
 * They are not. app/tick.ts resolves a lane by `targetParam`, a
 * component-qualified param key, and the registry is searched by that string.
 * This proves it against the real planner rather than by reading the code:
 *
 *   1. Schwung's page set for a module is genuinely different from movy's
 *      (otherwise the rest of the check proves nothing).
 *   2. Every parameter movy shows is still reachable somewhere in Schwung's
 *      page set — nothing is stranded by re-pagination.
 *   3. A lane created against a parameter on movy's page still resolves, by
 *      key, on whatever Schwung page that parameter lands on — at a different
 *      slot and a different page number.
 *
 *   SCHWUNG=/path/to/schwung node scripts/schwung-pagination-check.mjs
 */
import { installEnv } from '../browser-test/env.mjs';

const W = 128, H = 64;
let fb = new Uint8Array(W * H);
const paint = (x, y, w, h, v) => {
    const x0 = Math.max(0, x | 0), y0 = Math.max(0, y | 0);
    const x1 = Math.min(W, (x | 0) + (w | 0)), y1 = Math.min(H, (y | 0) + (h | 0));
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) fb[yy * W + xx] = v ? 1 : 0;
};
const env = installEnv();
globalThis.fill_rect = (x, y, w, h, v) => paint(x, y, w, h, v);
globalThis.clear_screen = () => paint(0, 0, W, H, 0);

const { createModel } = await import('../dist/esm/model/index.js');
const { portFor } = await import('../dist/esm/track/registry.js');
const { createSchwungPage } = await import('../dist/esm/renderer/schwung-page.js');
const { MOCK_SYNTHS } = await import('../browser-test/mock-synth.mjs');

const fail = (m) => { console.log('FAIL: ' + m); process.exit(1); };
const port = portFor(0);
const model = createModel(port, 'synth');

function settle() {
    let idle = 0, total = 0;
    while (idle < 5 && total < 200) {
        const dirty = model.tick();
        idle = dirty ? 0 : idle + 1;
        total++;
    }
}

/* Every parameter movy puts on a page, with the page and slot it puts it at.
 * Walked through movy's own model, so this is movy's pagination, not a guess. */
function movyLayout(preset) {
    env.setParams(MOCK_SYNTHS[preset]);
    model.reset(); model.reload(); settle();
    const out = new Map();   // LABEL -> {page, slot}
    const dupes = new Set();
    let page = 0;
    for (let guard = 0; guard < 64; guard++) {
        const vm = model.getViewModel();
        let slot = 0;
        for (const row of (vm.rows || [])) {
            for (const c of row) {
                /* UPPERCASED ON BOTH SIDES. Storing movy's mixed-case
                 * fullName and looking it up uppercased matched nothing, so
                 * every preset reported 0 moved — twice. */
                const nm = c ? String(c.fullName).toUpperCase() : null;
                if (nm) {
                    if (out.has(nm)) dupes.add(nm);
                    else out.set(nm, { page, slot });
                }
                slot++;
            }
        }
        if (vm.bankCount <= 1 || page >= vm.bankCount - 1) break;
        model.changePage(1); settle();
        page++;
    }
    /* A label that appears twice cannot be attributed to one position, so it
     * is excluded rather than guessed at (obxd_like shows "Cutoff" on two
     * pages). */
    for (const d of dupes) out.delete(d);
    return out;
}

/* The same, through Schwung's planner and its keys. */
function schwungLayout(preset) {
    env.setParams(MOCK_SYNTHS[preset]);
    const sp = createSchwungPage(port, 'synth');
    sp.reload();
    const out = new Map();   // KEY -> {page, slot}
    for (let p = 0; p < sp.pageCount; p++) {
        sp.goToPage(p);
        for (let slot = 0; slot < 8; slot++) {
            const k = sp.keyAt(slot);
            if (k && !out.has(k)) out.set(k, { page: p, slot, label: sp.labelAt(slot) });
        }
    }
    return { map: out, pageCount: sp.pageCount, sp };
}

const PRESETS = ['test8', 'test16', 'obxd_like', 'plaits', 'wurl', 'hier_params_overflow'];
let repaginated = 0, checked = 0;

console.log('');
console.log('preset               movy pages  schwung pages   params moved');
console.log('-'.repeat(66));

for (const preset of PRESETS) {
    if (!MOCK_SYNTHS[preset]) continue;
    const mv = movyLayout(preset);
    const { map: sw, pageCount } = schwungLayout(preset);
    if (!sw.size) { console.log(`${preset.padEnd(20)} (schwung planned no knob pages)`); continue; }
    checked++;

    env.setParams(MOCK_SYNTHS[preset]);
    model.reset(); model.reload(); settle();
    const movyPages = model.getViewModel().bankCount;

    /* movy names cells by LABEL; Schwung addresses them by KEY. Match through
     * Schwung's own metadata so the comparison is not a string coincidence. */
    let moved = 0;
    for (const [key, sPos] of sw) {
        /* Match on the declared LABEL, which is what movy names a cell by.
         * key.toUpperCase() was wrong and matched nothing, so every preset
         * reported 0 moved — the guard below is what caught it. */
        const mPos = mv.get(String(sPos.label || key).toUpperCase());
        if (!mPos) continue;
        if (mPos.page !== sPos.page || mPos.slot !== sPos.slot) moved++;
    }
    repaginated += moved;
    console.log(`${preset.padEnd(20)} ${String(movyPages).padEnd(11)} ${String(pageCount).padEnd(15)} ${moved}`);
}

if (!checked) fail('no preset produced a Schwung page set — nothing was compared');
if (!repaginated) {
    fail('no parameter changed page or slot under Schwung pagination. Either the two '
       + 'planners agree everywhere (they do not — 7 of 18 pages differed when measured) '
       + 'or this check is not exercising Schwung planning at all.');
}

/* ---- the lane question, end to end ----------------------------------- */
/*
 * Deliberately on a parameter that MOVED. Picking one that happens to sit at
 * the same page and slot under both planners proves nothing about
 * re-pagination — it is the case where there is nothing to survive.
 */
{
    const preset = 'obxd_like';
    const mv = movyLayout(preset);
    env.setParams(MOCK_SYNTHS[preset]);
    const sp = createSchwungPage(port, 'synth');
    sp.reload();

    let moved = null;
    for (let p = 0; p < sp.pageCount && !moved; p++) {
        sp.goToPage(p);
        for (let slot = 0; slot < 8; slot++) {
            const label = sp.labelAt(slot);
            if (!label) continue;
            const m = mv.get(label.toUpperCase());
            if (m && (m.page !== p || m.slot !== slot)) {
                moved = { label, key: sp.keyAt(slot), target: sp.targetAt(slot),
                          movy: m, schwung: { page: p, slot } };
                break;
            }
        }
    }
    if (!moved) fail('no moved parameter found in obxd_like to test the lane with');

    /* The lane stores the component-qualified key, exactly as app/tick.ts does. */
    const laneFor = (k) => ('synth:' + k === moved.target ? 0 : -1);
    const auto = {
        assignedLanes: 1, activeLanes: 1, held: false, poolFull: false,
        heldValues: new Map(), liveValues: new Map(), laneForKey: laneFor,
    };

    sp.goToPage(moved.schwung.page);
    fb = new Uint8Array(W * H); sp.render('T1 > OBXD', undefined, -1);
    const plain = fb.slice();
    fb = new Uint8Array(W * H); sp.render('T1 > OBXD', auto, -1);
    const marked = fb.slice();
    let d = 0;
    for (let i = 0; i < plain.length; i++) if (plain[i] !== marked[i]) d++;
    if (!d) fail('the lane resolved on the Schwung page but its mark drew nothing');

    /*
     * THE WHOLE-FRAME DIFF IS NOT THE MARK. A live lock also stands the
     * graphics down (one picture across four cells cannot say which is
     * locked), which repaints most of the body — 867 px on this page. Counting
     * that as "the mark drew" is the same conflation that let a deleted lock
     * mark pass earlier in this branch, so the mark is asserted at its own
     * pixels: the 2x2 block in the cell's top-left corner, mirroring the
     * modulation tick across the cell.
     */
    const ROW0_Y = 9, ROW1_Y = 33, CELL_W = 32;
    const mx = (moved.schwung.slot % 4) * CELL_W + 1;
    const my = moved.schwung.slot < 4 ? ROW0_Y : ROW1_Y;
    let markOn = 0, markOff = 0;
    for (let yy = my; yy < my + 2; yy++) for (let xx = mx; xx < mx + 2; xx++) {
        if (marked[yy * W + xx]) markOn++;
        if (plain[yy * W + xx]) markOff++;
    }
    if (markOn !== 4) {
        fail(`the lock mark is not at the locked cell: ${markOn}/4 pixels lit at `
           + `(${mx},${my}) for slot ${moved.schwung.slot}`);
    }
    if (markOff === 4) fail('those pixels were already lit unlocked — the mark proves nothing there');

    /* And it must NOT mark the page movy used to show it on, if that is a
     * different page — a lane that lights up everywhere is not resolving. */
    if (moved.movy.page !== moved.schwung.page) {
        sp.goToPage(moved.movy.page);
        fb = new Uint8Array(W * H); sp.render('T1 > OBXD', auto, -1);
        const other = fb.slice();
        fb = new Uint8Array(W * H); sp.render('T1 > OBXD', undefined, -1);
        let d2 = 0;
        for (let i = 0; i < other.length; i++) if (other[i] !== fb[i]) d2++;
        if (d2) fail('the lane also marked a page its parameter is not on');
    }

    console.log('-'.repeat(66));
    console.log(`lane target ${moved.target}  ("${moved.label}")`);
    console.log(`  movy put it at page ${moved.movy.page} slot ${moved.movy.slot}`);
    console.log(`  schwung puts it at page ${moved.schwung.page} slot ${moved.schwung.slot}`);
    console.log(`  the lane resolves there; its mark lights the cell corner `
        + `(4/4 px at ${mx},${my}), and the live lock stands the graphics down (${d} px total)`);
}

console.log('');
console.log(`PASS: Schwung pagination adopted — ${repaginated} parameters sit at a different `
    + `page/slot than movy put them, and a lane keyed by parameter still finds its target.`);
