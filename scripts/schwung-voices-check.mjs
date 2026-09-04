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

if (failed) { _log(`\n\x1b[31m\x1b[1mFAIL: ${failed} check(s)\x1b[0m`); process.exit(1); }
_log('\n\x1b[32m\x1b[1mPASS: movy reads a drum rack, its pads and its notes from the module itself.\x1b[0m');
