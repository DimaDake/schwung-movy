#!/usr/bin/env node
/* fleet-pages.mjs — every fleet module, planned through SCHWUNG's planner.
 *
 * dump-replay.mjs replays movy's model, which is the layer `page` mode
 * bypasses, so it cannot see a re-pagination at all. This plans the same
 * modules the way the device will under `page`, against the real captured
 * metadata in docs/module-dump/ — no device.
 *
 * THE INVARIANTS PASS TODAY (94 plannable of 95, 2026-09-13 capture). That is
 * the point: the 9W9 class — 13 pages all named "Params - 2", no level on any of
 * them — is fixed upstream, and this is what stops it coming back.
 *
 * THEY CANNOT BE FALSIFIED FROM THE DUMP, which is why checkPages() below is a
 * pure function and why the teeth are proven in a scratch harness rather than by
 * corrupting device-dump.json. The planner disambiguates duplicate page names
 * itself ("Sync" becomes "Sync - 2"), drops a page whose knobs are all empty
 * instead of emitting it empty, and names a level from its key when the level
 * has none — so a mutated dump produces a different VALID plan, never a broken
 * one. Measured against genera, not assumed.
 *
 * The census is the part that does not pass, and it is deliberately a REPORT
 * rather than an assertion: one module declaring voices is Cause E, it is a
 * fleet/module fact rather than a movy regression, and failing the build for it
 * would make every session red for something no session can fix. It is
 * baselined so a CHANGE in it is loud.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/* Written as a code point rather than an escape so the source carries no control
 * byte for a formatter, a diff, or an editor round-trip to mangle. */
const ESC = String.fromCharCode(27);
const __dir = dirname(fileURLToPath(import.meta.url));
const EXPECT = join(__dir, 'fleet-expect.json');
const UPDATE = process.argv.includes('--update');

/* The static invariants, as a pure function of a page list.
 *
 * Pure so they can be PROVEN. planPages repairs every corruption this suite
 * could inject into the dump (see the header), so a teeth-proof that goes
 * through the dump proves nothing — it stays green and looks like a pass.
 * Handed a page list directly, each invariant goes red on input that is
 * genuinely bad. Step 3 is that harness; the loop in main() is the real
 * subject, and this is the check that runs against it.
 *
 * slotKeys is pageSlotKeys, passed in rather than imported: this file must be
 * importable for its checks WITHOUT a schwung checkout at SCHWUNG. */
export function checkPages(pages, slotKeys) {
    const out = [];
    /* THE 9W9 CLASS. Two pages with the same kind and name are two jog steps a
     * user cannot tell apart — 9W9 shipped 13 of them, all "Params - 2", and no
     * amount of reading one page told you which. Kind is part of the key: a
     * knobs page and an items page may share a label and still be distinct
     * steps, so collapsing them would fail a healthy plan. JSON-encoded rather
     * than joined with a separator, so no separator can occur in a name. */
    const seen = new Set();
    for (const p of pages) {
        const k = JSON.stringify([p.kind, p.name]);
        if (seen.has(k)) out.push(`two ${p.kind} pages both named "${p.name}"`);
        seen.add(k);
    }
    /* A knobs page whose every slot is empty is a page that draws nothing and
     * still costs a jog step. */
    for (const p of pages) {
        if (p.kind !== 'knobs') continue;
        if (slotKeys(p).every((x) => !x)) out.push(`knobs page "${p.name}" has no keys`);
    }
    /* Every page must be nameable. An unnamed page has nothing to put in movy's
     * header or its bank bar. */
    for (const p of pages) {
        if (!p.name) out.push(`a ${p.kind} page has no name`);
    }
    return out;
}

async function main() {
    if (!process.env.SCHWUNG) {
        console.log('fleet-pages: SKIPPED (no param_pages; set SCHWUNG=/path/to/schwung)');
        process.exit(0);
    }

    /* Resolved straight from SCHWUNG, NOT through dist/esm and the esbuild alias:
     * this suite reads the library as data — it plans pages without a model, a
     * port or a controller — so going through movy's bundle would drag the whole
     * renderer in for nothing. Imported inside main() for the reason checkPages
     * documents above.
     *
     * resolve() FIRST, because SCHWUNG is documented as a relative path
     * (`SCHWUNG=../schwung`) and dynamic import() resolves a relative specifier
     * against THIS FILE, not the cwd — `../schwung` would become
     * browser-test/../schwung and never be found. build/browser.mjs resolves it
     * the same way. */
    const PP = resolve(process.env.SCHWUNG, 'src', 'shared', 'param_pages');
    const { planPages, pageSlotKeys } = await import(join(PP, 'page_plan.mjs'));
    const { voicesOf } = await import(join(PP, 'voices.mjs'));

    const dump = JSON.parse(readFileSync(join(__dir, '..', 'docs', 'module-dump', 'device-dump.json'), 'utf8'));
    const P = (v) => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; } };

    let failures = 0;
    const ok   = (l) => console.log(`  ${ESC}[32m✓${ESC}[0m ${l}`);
    const fail = (l, why) => { console.log(`  ${ESC}[31m✗${ESC}[0m ${l}: ${why}`); failures++; };

    const warned = {};       // id → warnings[]
    const census = [];       // ids declaring voices
    const unplannable = [];  // ids with no chain_params — baselined, not failed

    /* A WEDGE-TRUNCATED DUMP MUST NOT READ AS GREEN, and until this assertion
     * existed it did. The invariants below only ever see the modules that are
     * PRESENT, so a capture that silently lost some passes every one of them —
     * the suite prints a smaller number and calls it a pass. This repo has
     * captured exactly that before (the MIDI-inject wedge), so it is a live
     * failure mode rather than a hypothetical. Both fields are the dump's own
     * claim about itself, which is the point: `complete: false` or a count that
     * disagrees with the list is the capture saying so.
     *
     * `generated_at` rides the same line so staleness sits next to
     * completeness — a complete capture of a two-month-old fleet is the other
     * way this suite could be quietly meaningless. */
    console.log(`\nfleet-pages: ${dump.modules.length} modules, dump ${dump.generated_at}`);
    if (!dump.complete) fail('dump', `complete is ${JSON.stringify(dump.complete)} — not a whole capture`);
    if (dump.modules.length !== dump.module_count) {
        fail('dump', `modules.length ${dump.modules.length} !== module_count ${dump.module_count} — the capture lost modules`);
    }

    /* THE TEETH, PINNED. These are the only cases in this suite that hand the
     * checks input which is genuinely BAD, and they must run on every `npm test`.
     * Behind a `--selftest` flag they would fire only when someone remembered to
     * ask, which leaves the same hole one level up: without them a `checkPages`
     * hollowed out to `return []` leaves every suite green, because the real
     * fleet is well-formed and only ever exercises the passing path.
     *
     * They stay in the suite rather than in the ledger because prose cannot
     * fail. Every synthetic page carries `keys`: pageSlotKeys reads
     * page.keys.length, so a page without it THROWS here rather than reporting
     * a failure. */
    const teeth = (label, pages, want) => {
        const bad = checkPages(pages, pageSlotKeys);
        if (bad.length === want) ok(`teeth: ${label}`);
        else fail(`teeth: ${label}`, `${bad.length} failure(s), want ${want} — ${bad.join('; ') || 'nothing reported'}`);
    };
    teeth('two knobs pages sharing a name are two jog steps a user cannot tell apart',
        [{ kind: 'knobs', name: 'Params - 2', keys: ['a'] },
         { kind: 'knobs', name: 'Params - 2', keys: ['b'] }], 1);
    teeth('the same name on different KINDS is two distinct steps and must stay clean',
        [{ kind: 'knobs', name: 'X', keys: ['a'] },
         { kind: 'items', name: 'X' }], 0);
    teeth('a knobs page whose every slot is empty draws nothing and still costs a jog step',
        [{ kind: 'knobs', name: 'Empty', keys: [] }], 1);
    teeth('an unnamed page has nothing to put in the header or the bank bar',
        [{ kind: 'knobs', name: '', keys: ['a'] }], 1);
    teeth('a healthy plan is clean, so the checks are not merely always red',
        [{ kind: 'knobs', name: 'Main', keys: ['osc1'] },
         { kind: 'preset', name: 'Presets' }], 0);

    /* Deliberately NOT pinning each module's plan shape (page count, order,
     * names). A legitimate upstream planner change would then redden this suite
     * for a whole session, and the stated job here is to hold the invariants a
     * USER can navigate, not to freeze the planner's output. */
    for (const m of dump.modules) {
        const cp = P(m.chain_params);
        /* A module with no chain_params has no parameters to paginate at all —
         * `gesture-test` is the one such module. That is a module-side shape,
         * not a planner defect, so it is baselined like a warning rather than
         * failing: otherwise the suite is red on arrival for something no
         * session can fix, which is how a gate stops being read. */
        if (!cp) { unplannable.push(m.id); continue; }
        const h = P(m.ui_hierarchy);

        let r;
        try { r = planPages({ hierarchy: h, chainParams: cp, unresolved: false }); }
        catch (e) { fail(m.id, 'planPages threw: ' + e.message); continue; }

        for (const why of checkPages(r.pages, pageSlotKeys)) fail(m.id, why);

        if (r.warnings.length) warned[m.id] = r.warnings;
        if (h && (voicesOf(h) || []).length) census.push(m.id);
    }

    /* Warnings are baselined, not banned: `no ui_hierarchy — paginated from
     * chain_params` is a legitimate module shape. A NEW warning is what matters. */
    const expect = UPDATE ? null : JSON.parse(readFileSync(EXPECT, 'utf8'));
    if (UPDATE) {
        writeFileSync(EXPECT, JSON.stringify({
            warned,
            voiceDeclaring: census.sort(),
            unplannable: unplannable.sort(),
        }, null, 2) + '\n');
        console.log('  baseline written to browser-test/fleet-expect.json');
    } else {
        /* The warning TEXT is compared, not just the module's presence. A
         * presence-only check let an upstream rewording, an extra warning on a
         * module, and a dropped one all read as green — the baseline stored
         * text nothing ever read back, which is a baseline in name only. */
        for (const id of Object.keys(warned)) {
            const was = expect.warned[id];
            if (!was) { fail(id, 'new planner warning: ' + warned[id].join(' | ')); continue; }
            if (JSON.stringify(was) === JSON.stringify(warned[id])) continue;
            /* Named from the PLAN's side: a baseline carrying a phantom line
             * reads as "the plan lost a warning", which is what changed, and
             * both sides are printed so the direction cannot be misread. */
            const shape = was.length === warned[id].length ? 'reworded'
                        : (warned[id].length > was.length ? 'the plan gained a warning' : 'the plan lost a warning');
            fail(id, `warning ${shape} — was [${was.join(' | ')}], now [${warned[id].join(' | ')}] — re-baseline with --update`);
        }
        for (const id of Object.keys(expect.warned)) {
            if (!warned[id]) fail(id, 'warning gone — re-baseline with --update');
        }
        const before = (expect.voiceDeclaring || []).join(',');
        const now    = census.sort().join(',');
        if (before !== now) fail('voice census', `was [${before}], now [${now}] — re-baseline with --update and tell SP-14`);
        else ok(`voice census unchanged (${census.length} module(s) declare voices to Schwung)`);

        const ub = (expect.unplannable || []).join(',');
        const un = unplannable.sort().join(',');
        if (ub !== un) fail('unplannable', `was [${ub}], now [${un}] — re-baseline with --update`);
    }

    if (failures === 0) console.log(`\n${ESC}[32m${ESC}[1mALL FLEET-PAGE CHECKS PASSED${ESC}[0m`);
    else { console.log(`\n${ESC}[31m${ESC}[1m${failures} FLEET-PAGE CHECK(S) FAILED${ESC}[0m`); process.exit(1); }
}

/* Importing this file for checkPages() must not run the sweep. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
