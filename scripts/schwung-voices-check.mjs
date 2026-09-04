#!/usr/bin/env node
/*
 * schwung-voices-check.mjs — movy learns a drum rack from the MODULE.
 *
 * movy has always answered "is this drums, and what does each pad address?"
 * from a private table: movy_config.json, fourteen bundled configs and a
 * four-module override list. Schwung #411 lets a module declare it, so a rack
 * movy has never heard of can seat itself.
 *
 * DRIVEN FROM THE REAL MODULE, not a fixture written to agree with the code.
 * `src/modules/sound_generators/voice-poc/module.json` in the schwung checkout
 * is the reference rack, and upstream's own notes record what happens when
 * fixtures agree with the code instead of the fleet: `voicesOf` returned ZERO
 * voices for the flagship drum module while every unit test passed.
 *
 * THE CASE THAT MATTERS IS THE NON-CONTIGUOUS ONE. voice-poc declares notes
 * 36, 38, 42, 60, 61, 62, 63 — three named drums plus a four-child level.
 * movy's own config shape cannot express that: it says `padNoteStart` plus
 * `padCount` and derives the rest by addition, which for this module yields
 * 36..42 — five pads addressing the wrong voice and two addressing nothing.
 * So the check asserts the notes came from the DECLARATION, by requiring the
 * exact set and by requiring that start+count would have been wrong.
 *
 *   SCHWUNG=/path/to/schwung node scripts/schwung-voices-check.mjs
 */
import { readFileSync, existsSync } from 'fs';
import { installEnv } from '../browser-test/env.mjs';

globalThis.fill_rect = () => {};
globalThis.clear_screen = () => {};
installEnv();

const SCHWUNG = process.env.SCHWUNG;
if (!SCHWUNG) { console.log('SKIP: SCHWUNG is not set'); process.exit(0); }

const POC = `${SCHWUNG}/src/modules/sound_generators/voice-poc/module.json`;
if (!existsSync(POC)) {
    console.log(`SKIP: no voice-poc in this schwung checkout (${POC})`);
    process.exit(0);
}

const V = await import('../dist/esm/renderer/schwung-voices.js');

const _log = console.log.bind(console);
let failed = 0;
const ok   = (m) => _log(`  \x1b[32m✓\x1b[0m ${m}`);
const fail = (m) => { _log(`  \x1b[31m✗\x1b[0m ${m}`); failed++; };

_log('schwung-voices-check: a module declares its own drum rack\n');

const mod = JSON.parse(readFileSync(POC, 'utf8'));
const hierarchy = mod.ui_hierarchy || (mod.capabilities || {}).ui_hierarchy;
const s = V.surfaceOf(hierarchy);

/* ---- the declaration is read ------------------------------------------- */
if (s.layout === 'drums') ok('voice-poc is read as a drum rack from its own contract');
else fail(`layout came back ${JSON.stringify(s.layout)}, wanted "drums"`);

if (V.isDrumRack(s)) ok(`isDrumRack agrees, with ${V.padCount(s)} pads`);
else fail('isDrumRack said no for a module that declares pad_layout "drums"');

if (s.focusParam) ok(`the focused-voice param is declared: ${s.focusParam}`);
else fail('no focus_param — movy cannot jump to a pad without one');

/* ---- the pads carry the module's OWN notes ------------------------------ */
const notes = s.voices.map((v) => v.note);
const WANT = [36, 38, 42, 60, 61, 62, 63];
if (JSON.stringify(notes) === JSON.stringify(WANT)) {
    ok(`the pad notes are the declared ones: ${notes.join(', ')}`);
} else {
    fail(`pad notes are ${notes.join(', ')}, wanted ${WANT.join(', ')}`);
}

/* The point of the previous assertion, made explicit: movy's own shape would
 * have got this wrong, so reading the declaration is load-bearing rather than
 * tidier. If a future voice-poc becomes contiguous this fails LOUDLY, because
 * the check would then be proving nothing. */
const start = notes[0];
const contiguous = notes.every((n, i) => n === start + i);
if (!contiguous) {
    ok('...and they are NOT contiguous, so padNoteStart+padCount could not describe them');
} else {
    fail('voice-poc now declares contiguous notes, so this check no longer proves the pad '
       + 'notes came from the declaration rather than from arithmetic. Point it at a rack '
       + 'with gaps.');
}

/* ---- note <-> pad round-trips through the declaration ------------------- */
let roundTripped = 0;
for (let i = 0; i < s.voices.length; i++) {
    const n = V.noteForPad(s, i);
    if (n === null) { fail(`pad ${i} has no note`); break; }
    if (V.padForNote(s, n) !== i) { fail(`note ${n} maps back to pad ${V.padForNote(s, n)}, not ${i}`); break; }
    roundTripped++;
}
if (roundTripped === s.voices.length) ok(`every pad round-trips note->pad->note (${roundTripped})`);

/* A note the rack does not declare belongs to no pad — it must not clamp to
 * the nearest one, which is what an arithmetic mapping would do. */
if (V.padForNote(s, 37) === null) ok('an undeclared note (37) addresses no pad');
else fail(`note 37 was mapped to pad ${V.padForNote(s, 37)}; a gap is not a pad`);

if (V.labelForPad(s, 0)) ok(`pads carry the module's own names (pad 0 = "${V.labelForPad(s, 0)}")`);
else fail('pad 0 has no name');

/* ---- silence is not a "no" --------------------------------------------- */
const quiet = V.surfaceOf({ levels: { root: { params: [] } } });
if (quiet.layout === null) ok('a module that declares nothing reports null, not "chromatic"');
else fail(`an undeclared module reported ${JSON.stringify(quiet.layout)} — that is putting `
        + `words in its mouth, and makes "declared melodic" indistinguishable from silence`);
if (!V.isDrumRack(quiet)) ok('...and is not treated as a rack');
else fail('...but was treated as a rack');

const broken = V.surfaceOf({ levels: null, pad_layout: 42 });
if (broken.layout === null && broken.voices.length === 0) ok('a malformed contract is "has not said", not a throw');
else fail('a malformed contract did not degrade to silence');

/* ---- and movy USES it: declaration wins, the table is the fallback ------ */
const { effectiveDrumConfig } = await import('../dist/esm/model/drum-declared.js');
const { drumNoteOfPad } = await import('../dist/esm/keyboard/drum-grid.js');

/* movy's own shape for a rack it already knew: contiguous from 36. */
const OVERRIDE = { padCount: 11, padNoteStart: 36, rawMidi: false,
                   padScoping: { aliasPrefix: 'pad_' } };

_log('');
{
    /* Declared only — a module movy has no entry for. */
    const cfg = effectiveDrumConfig(s, null);
    if (cfg && cfg.padCount === 7) ok(`a module movy has never heard of seats itself (${cfg.padCount} pads)`);
    else fail(`no config from the declaration alone: ${JSON.stringify(cfg)}`);

    const played = [];
    for (let p = 1; p <= cfg.padCount; p++) played.push(drumNoteOfPad(p, cfg));
    if (JSON.stringify(played) === JSON.stringify(WANT)) {
        ok(`...and its pads play the declared notes: ${played.join(', ')}`);
    } else {
        fail(`pads play ${played.join(', ')}, wanted ${WANT.join(', ')} — drumNoteOfPad is `
           + `still deriving them with padNoteStart + pad - 1`);
    }
}
{
    /* Both — the module is believed. This is the policy, so it is asserted. */
    const cfg = effectiveDrumConfig(s, OVERRIDE);
    if (cfg.padCount === 7) ok('with BOTH an override and a declaration, the module wins');
    else fail(`override won: padCount ${cfg.padCount}, wanted the declared 7`);
    if (drumNoteOfPad(2, cfg) === 38) ok('...including its notes (pad 2 plays 38, not 37)');
    else fail(`pad 2 plays ${drumNoteOfPad(2, cfg)}; the override's arithmetic is still winning`);
    if (cfg.padScoping && cfg.padScoping.aliasPrefix === 'pad_') {
        ok('...while keeping what only movy\'s table knows (padScoping)');
    } else {
        fail('padScoping was dropped — a declaring module lost facts the contract has no word for');
    }
}
{
    /* Silence — nothing may change for the 100 modules that declare nothing. */
    const cfg = effectiveDrumConfig(quiet, OVERRIDE);
    if (cfg === OVERRIDE) ok('a module that declares nothing keeps movy\'s override, untouched');
    else fail('an undeclared module did not get its override back unchanged');
    if (drumNoteOfPad(3, OVERRIDE) === 38) ok('...and its pads still use the old arithmetic');
    else fail(`the fallback path changed: pad 3 plays ${drumNoteOfPad(3, OVERRIDE)}, wanted 38`);
    if (effectiveDrumConfig(quiet, null) === null) ok('...and a plain synth is still not a rack');
    else fail('a synth with no rack anywhere came back with a drum config');
}

/* ---- END TO END: a real model, no override, learns the rack -------------
 *
 * The assertions above prove the pieces. This proves the WIRING — that a model
 * built the way movy builds one, for a module movy has no config entry for,
 * comes out of loadHierarchy believing it is a rack. Proving the pieces while
 * the app never consults them is the trap this project has been caught by
 * twice, so the last word goes to the model itself.
 */
_log('');
{
    const { portFor } = await import('../dist/esm/track/registry.js');
    const { createModel } = await import('../dist/esm/model/index.js');
    /* globals.ts is what registers the reader; importing it is part of what is
     * under test, because a model with no reader must fall back. */
    await import('../dist/esm/app/globals.js');

    /* The module's own contract, served the way a DSP serves it, and NOTHING
     * else — no entry in movy's table for "voice-poc". */
    const envMod = await import('../browser-test/env.mjs');
    const e2 = envMod.installEnv();
    e2.setParams({ 'synth:ui_hierarchy': JSON.stringify(hierarchy) });

    const port = portFor(0);
    const m = createModel(port, 'synth');
    m.reset(); m.reload();
    for (let i = 0; i < 60; i++) m.tick();

    const cfg = m.getDrumConfig();
    if (cfg && cfg.padCount === 7) ok(`a real model learns the rack from the contract (${cfg.padCount} pads)`);
    else fail(`the model reports ${JSON.stringify(cfg && cfg.padCount)} pads; movy has no config `
            + `entry for this module, so the declaration is not reaching loadHierarchy`);

    if (m.getDrumPadCount() === 7) ok(`...and the pad count the header icon draws follows (${m.getDrumPadCount()})`);
    else fail(`getDrumPadCount is ${m.getDrumPadCount()}, wanted 7 — the minimap would show the wrong rack`);

    if (cfg && drumNoteOfPad(2, cfg) === 38) ok('...and pad 2 plays the declared 38');
    else fail(`pad 2 plays ${cfg && drumNoteOfPad(2, cfg)}, wanted the declared 38`);
}

/* ---- the pads carry their NAMES into the header -------------------------
 *
 * A declared rack names its voices — Kick, Snare, Hat — and movy's header had
 * nowhere to say so: the right-hand slot fell back to "Main" / "Page 1", which
 * is the least informative thing it could hold on a page whose knobs all
 * belong to one drum. The name goes there, and ONLY there: a module that
 * supplies real bank names keeps them, because those describe the PAGE and the
 * voice name would be replacing information rather than filling a gap.
 */
_log('');
{
    const { portFor } = await import('../dist/esm/track/registry.js');
    const { createModel } = await import('../dist/esm/model/index.js');
    await import('../dist/esm/app/globals.js');
    const envMod = await import('../browser-test/env.mjs');

    const e3 = envMod.installEnv();
    e3.setParams({ 'synth:ui_hierarchy': JSON.stringify(hierarchy) });
    const m2 = createModel(portFor(0), 'synth');
    m2.reset(); m2.reload();
    for (let i = 0; i < 60; i++) m2.tick();

    /* The header's own field, not bankName: bankName is the PAGE label and only
 * the module page draws it, so a pad name routed through it left the chain
 * view — the one movy opens on — still reading the module name. */
const nameAt = (pad) => { m2.updateDrumPad(pad, 0); return m2.getViewModel().drumPadName; };

    if (nameAt(1) === 'Kick') ok('the header names the focused pad: pad 1 = "Kick"');
    else fail(`pad 1 shows ${JSON.stringify(nameAt(1))}, wanted the declared "Kick"`);
    if (nameAt(2) === 'Snare') ok('...and follows the pad: pad 2 = "Snare"');
    else fail(`pad 2 shows ${JSON.stringify(nameAt(2))}, wanted "Snare"`);
    if (nameAt(4) === 'Tom Lo') ok('...including a child-level voice: pad 4 = "Tom Lo"');
    else fail(`pad 4 shows ${JSON.stringify(nameAt(4))}, wanted "Tom Lo"`);

    /* THE MINIMAP. Both header renderers gate the pad-grid icon on
     * `isPadScoped`, which read only movy's own table — so a declared rack drew
     * NO icon at all, which is what "no minimap" was on the device. Reported
     * against voice-poc, which has no table entry by design. */
    const vmp = m2.getViewModel();
    if (vmp.isPadScoped) ok('a declared rack is pad-scoped, so the header draws its minimap');
    else fail('isPadScoped is false for a declared rack — the pad-grid icon is gated on it, '
            + 'so the header shows no minimap. It read only s.moduleConfig, and a module that '
            + 'declares its own voices has no config entry.');
    if (vmp.drumPadCount === 7) ok(`...with the declared pad count (${vmp.drumPadCount})`);
    else fail(`the icon would draw ${vmp.drumPadCount} pads`);
}
{
    const { portFor } = await import('../dist/esm/track/registry.js');
    const { createModel } = await import('../dist/esm/model/index.js');
    const envMod = await import('../browser-test/env.mjs');
    /* A module that declares NO rack must keep whatever movy showed before —
     * the name fills a gap, it never takes a slot that had something in it. */
    const e4 = envMod.installEnv();
    e4.setParams({ 'synth:ui_hierarchy': JSON.stringify({ levels: { root: { params: [] } } }) });
    const m3 = createModel(portFor(0), 'synth');
    m3.reset(); m3.reload();
    for (let i = 0; i < 60; i++) m3.tick();
    const vm = m3.getViewModel();
    if (!vm.drumPadCount) ok('a module declaring no rack is still not a rack');
    else fail(`an undeclared module reports ${vm.drumPadCount} pads`);
}

/* ---- a module that ships its own editor publishes under `ui_pages` -------
 *
 * A module offering its own chain editor serves `ui_hierarchy` EMPTY on
 * purpose — the shadow UI reaches for the hierarchy editor whenever one is
 * offered — and publishes the same contract under `ui_pages` instead. 9W9 is
 * that case, and movy asked only the first key, so for exactly the modules that
 * ship their own editor it saw no contract at all. On device that looked like
 * the declaration being ignored; it was never being read.
 */
_log('');
{
    const { portFor } = await import('../dist/esm/track/registry.js');
    const { createModel } = await import('../dist/esm/model/index.js');
    const envMod = await import('../browser-test/env.mjs');
    const e5 = envMod.installEnv();
    /* Served exactly as 9W9 serves it: empty on the probed key, real on the
     * other one. An empty string, not a missing key — that distinction is the
     * module's own ("absent has a spelling"). */
    e5.setParams({ 'synth:ui_hierarchy': '', 'synth:ui_pages': JSON.stringify(hierarchy) });
    const m4 = createModel(portFor(0), 'synth');
    m4.reset(); m4.reload();
    for (let i = 0; i < 60; i++) m4.tick();
    const cfg = m4.getDrumConfig();
    if (cfg && cfg.padCount === 7) ok('a module publishing under ui_pages still seats its rack');
    else fail('ui_hierarchy came back empty and ui_pages was not tried, so a module that ships '
            + 'its own chain editor declares into the void');
    if (m4.getViewModel().drumPadName === 'Kick') ok('...and names its pads');
    else fail(`...but the pad name is ${JSON.stringify(m4.getViewModel().drumPadName)}`);
}

if (failed) { _log(`\n\x1b[31m\x1b[1mFAIL: ${failed} check(s)\x1b[0m`); process.exit(1); }
_log('\n\x1b[32m\x1b[1mPASS: movy learns a drum rack from the module alone, names its pads, and prefers it over its own table.\x1b[0m');
