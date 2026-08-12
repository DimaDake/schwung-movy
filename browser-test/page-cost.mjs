#!/usr/bin/env node
/* browser-test/page-cost.mjs — per-page render cost for one module.
 *
 * The tick period is the knob's MIDI sampling interval, and a knob turn dirties
 * the frame every tick, so a page whose render is much dearer than its
 * neighbours feels slower to turn *on that page only*. This ranks every page of
 * a module by fill_rect count and render time, against the real captured
 * metadata in docs/module-dump/ — no device needed.
 *
 * Usage:
 *   node browser-test/page-cost.mjs [module-id] [top-n]
 *   node browser-test/page-cost.mjs helm 8
 */

import { loadDump, createDumpBoot } from './dump-boot.mjs';

const MODULE = process.argv[2] || 'helm';
const TOP    = Number(process.argv[3] || 8);
const ITERS  = 60;

let fillRects = 0;
let textCalls = 0;

const dump = loadDump();
const { bootFromDumpEntry } = await createDumpBoot(dump);

/* After createDumpBoot: installEnv() assigns its own no-op draw globals, so
 * counting hooks installed earlier would be silently replaced. */
const _origText = globalThis.draw_text;
globalThis.fill_rect    = () => { fillRects++; };
globalThis.clear_screen = () => {};
globalThis.draw_text    = typeof _origText === 'function'
    ? (...a) => { textCalls++; return _origText(...a); }
    : () => { textCalls++; };
const entry = dump.modules.find((m) => m.id === MODULE);
if (!entry) {
    console.error(`module '${MODULE}' not in the dump`);
    process.exit(2);
}

const { renderKnobsView } = await import('../dist/esm/renderer/knob-view.js');

const model = bootFromDumpEntry(entry);
const pageCount = model.getBankCount();

const rows = [];
for (let pg = 0; pg < pageCount; pg++) {
    model.changePage(pg - model.getKnobPage());
    const vm = model.getViewModel();

    // warm V8 so the first page isn't penalised for being first
    for (let i = 0; i < 10; i++) renderKnobsView(vm);

    for (let i = 0; i < 10; i++) model.getViewModel();

    fillRects = 0; textCalls = 0;
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < ITERS; i++) renderKnobsView(vm);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6 / ITERS;

    /* A dirty frame rebuilds the ViewModel as well as drawing it, so a turn
     * pays both every tick. */
    const t1 = process.hrtime.bigint();
    for (let i = 0; i < ITERS; i++) model.getViewModel();
    const vmMs = Number(process.hrtime.bigint() - t1) / 1e6 / ITERS;

    rows.push({
        pg,
        name: vm.bankName,
        rects: fillRects / ITERS,
        texts: textCalls / ITERS,
        vmMs,
        ms,
        env: (vm.envelopeLines ?? []).filter((e) => e).length,
        lfo: (vm.lfoViz ?? []).length,
        flt: (vm.filterViz ?? []).length,
    });
}

rows.sort((a, b) => (b.ms + b.vmMs) - (a.ms + a.vmMs));
console.log(`${MODULE}: ${pageCount} pages, ${ITERS} renders each\n`);
console.log('  page  name        fill_rect  render_ms    vm_ms  total_ms  env lfo flt');
for (const r of rows.slice(0, TOP)) {
    console.log(
        '  ' + String(r.pg + 1).padStart(4) +
        '  ' + String(r.name).padEnd(11).slice(0, 11) +
        String(Math.round(r.rects)).padStart(10) +
        r.ms.toFixed(3).padStart(11) +
        r.vmMs.toFixed(3).padStart(9) +
        (r.ms + r.vmMs).toFixed(3).padStart(10) +
        String(r.env).padStart(5) + String(r.lfo).padStart(4) + String(r.flt).padStart(4),
    );
}
const median = rows.map((r) => r.ms + r.vmMs).sort((a, b) => a - b)[Math.floor(rows.length / 2)];
const worst  = rows[0];
console.log(`\n  median page ${median.toFixed(3)} ms | worst page ${(worst.ms + worst.vmMs).toFixed(3)} ms `
    + `(page ${worst.pg + 1} "${worst.name}") = ${((worst.ms + worst.vmMs) / median).toFixed(1)}x median`);
