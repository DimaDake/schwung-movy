/* browser-test/logic/config-hierarchy.mjs — movy's config, read as a Schwung
 * contract (SP-14, Cause E).
 *
 * The four racks movy ships configs for (6w6, 8w8, 9w9, cw78) declare their
 * voices with `bank.pad`, which Schwung's planner has never heard of: under
 * `page` they plan as ten pages named "Params - N" with no level on any of
 * them, and a pad press has nowhere to jump. `hierarchyFromConfig` is the
 * translation, and these run it against the REAL shipped configs rather than a
 * fixture — a synthetic bank list would agree with the code instead of with
 * what movy deploys.
 *
 * NO SCHWUNG CHECKOUT NEEDED. The translator is pure `model/` code, so every
 * assertion here runs on a default build; whether the PLANNER then likes what
 * it produced is fleet-pages.mjs's question, against the captured fleet.
 *
 * Run by browser-test/logic.mjs.
 */

import { readFileSync, eq, ok, _log, OVERRIDES_MODULE_FILE } from './harness.mjs';

const cfg = (id) => JSON.parse(readFileSync(
    new URL(`../../src/module-configs/${id}.json`, import.meta.url), 'utf8'));

export async function run() {

const { hierarchyFromConfig } = await import('../../dist/esm/model/config-hierarchy.js');

_log('\nlogic: movy config -> Schwung hierarchy (SP-14)');

/* THE SHIPPED CONFIGS ARE THE SUBJECT. `OVERRIDES_MODULE_FILE` is the list of
 * modules whose own movy_config.json movy replaces, and it is exactly the set
 * with a voice run and no ui_hierarchy — so it is read from the loader rather
 * than restated, and a fifth entry arriving is covered the day it lands. */
const RACKS = [...OVERRIDES_MODULE_FILE];

_log('\nTest: every rack movy ships a config for translates');
{
    eq('the four racks are the subject', RACKS.length, 4);
    for (const id of RACKS) {
        const c = cfg(id);
        const h = hierarchyFromConfig(c);
        ok(`${id}: translates`, !!h);
        eq(`${id}: declares a drum layout`, h.pad_layout, 'drums');

        const voiceBanks = c.banks.filter((b) => b.pad !== undefined);
        const voices = Object.keys(h.levels).filter((k) => h.levels[k].note !== undefined);
        eq(`${id}: a level per voice bank`, voices.length, voiceBanks.length);
        eq(`${id}: and the rack's own pad count`, voices.length, c.drum.padCount);

        /* Every bank gets a page, voice or not — the kit and the Reverb/Delay/
         * Master pages behind it. */
        eq(`${id}: a level per bank, plus root`,
           Object.keys(h.levels).length, c.banks.length + 1);
    }
}

_log('\nTest: a voice carries the note its pad plays, and a page carries none');
{
    const h = hierarchyFromConfig(cfg('6w6'));
    const lv = (name) => h.levels[Object.keys(h.levels)
        .find((k) => h.levels[k].name === name)];

    /* 6W6: pads 1..8 from padNoteStart 36. The note is what `voicesOf` reads to
     * decide a level is a VOICE at all, and what movy's pad press resolves
     * against, so it is asserted per pad rather than as a count. */
    eq('pad 1 is the kick at 36', lv('Kick').note, 36);
    eq('pad 2 is the snare at 37', lv('Snare').note, 37);
    eq('pad 8 is the clap at 43', lv('Clap').note, 43);

    /* THE DISTINCTION THE WHOLE TRANSLATION TURNS ON. A page-only bank with a
     * note would be seated as a ninth voice, and every pad after it would
     * address the wrong level. 9W9's Reverb/Delay are the upstream case. */
    eq('Reverb is a page, not a voice', lv('Reverb').note, undefined);
    eq('Delay is a page, not a voice',  lv('Delay').note, undefined);
    eq('Master is a page, not a voice', lv('Master').note, undefined);
}

_log('\nTest: the page order movy already draws is the page order Schwung gets');
{
    const c = cfg('9w9');
    const h = hierarchyFromConfig(c);
    /* root's nav links are what page_plan walks, in array order, so this IS the
     * jog order. It must be the config's bank order: movy's bank bar, its
     * header and the sequencer's idea of "the Delay page" all come from that
     * list, and a translation that reordered it would move pages under a user
     * who never asked. */
    eq('root links every bank in order',
       h.levels.root.params.map((p) => p.label).join(','),
       c.banks.map((b) => b.name).join(','));
    eq('and root itself carries no knobs', (h.levels.root.knobs || []).length, 0);
}

_log('\nTest: a level key is an identity, so same-named banks stay distinct');
{
    /* `focusVoice` matches a voice to a page BY LEVEL. Two banks named the same
     * collapsing into one level would make the second bank's pad open the
     * first's page — silently, and only on the module that happened to name two
     * banks alike. */
    const h = hierarchyFromConfig({
        id: 'twins', name: 'Twins',
        drum: { padCount: 2, padNoteStart: 36 },
        banks: [
            { name: 'Tom', pad: 1, rows: [[{ key: 'a' }]] },
            { name: 'Tom', pad: 2, rows: [[{ key: 'b' }]] },
        ],
    });
    const keys = Object.keys(h.levels).filter((k) => k !== 'root');
    eq('two banks, two levels', keys.length, 2);
    eq('and they carry different notes',
       keys.map((k) => h.levels[k].note).join(','), '36,37');
}

_log('\nTest: the params a bank draws are the params its level declares');
{
    const c = cfg('6w6');
    const h = hierarchyFromConfig(c);
    const kick = h.levels[Object.keys(h.levels).find((k) => h.levels[k].name === 'Kick')];
    const declared = c.banks[0].rows.flat().filter(Boolean).map((p) => p.key);
    eq('the kick level lists the kick bank\'s keys', kick.params.map((x) => x.key).join(','), declared.join(','));
    eq('and puts them under the same eight knobs', kick.knobs.join(','), declared.join(','));

    /* A config row pads with nulls to fill a page; a null is not a param and a
     * level that claimed one would plan an empty cell. */
    ok('no empty slot survives the translation', kick.params.every((x) => !!(x && x.key)));
}

_log('\nTest: nothing is translated for a config that declares no voice run');
{
    /* THE LEADING-RUN RULE, and it is load-bearing rather than pedantic: the
     * SHIPPED 8w8/cw78 configs declare `pad` on page-only banks too (a spare
     * grid seat that opens Master), which read as "every bank is a voice". movy
     * has one implementation of that rule — page-rotation's buildRotation — and
     * this is the translator asking it rather than a second copy. */
    eq('a config with no pads at all', hierarchyFromConfig({
        id: 'plain', name: 'Plain',
        banks: [{ name: 'Main', rows: [[{ key: 'a' }]] }],
    }), null);

    eq('a pad that arrives only AFTER an ordinary bank is not a voice run',
       hierarchyFromConfig({
           id: 'late', name: 'Late', drum: { padCount: 1, padNoteStart: 36 },
           banks: [
               { name: 'Master', rows: [[{ key: 'a' }]] },
               { name: 'Kick', pad: 1, rows: [[{ key: 'b' }]] },
           ],
       }), null);

    eq('a rack with no note to start from', hierarchyFromConfig({
        id: 'noteless', name: 'Noteless',
        drum: { padCount: 1 },
        banks: [{ name: 'Kick', pad: 1, rows: [[{ key: 'a' }]] }],
    }), null);

    eq('and nothing at all', hierarchyFromConfig(null), null);
}

_log('\nTest: the same config translates to the same thing every time');
{
    /* `reloadIfChanged` fingerprints the contract every RELOAD_POLL_TICKS
     * ticks (SP-49 widened this from 8 to 16). A translation
     * that differed run to run — a Set's iteration order, a Date, an object
     * identity — would re-plan the page forever, which is the shape of the bug
     * SP-27 measured the cost of. */
    const a = JSON.stringify(hierarchyFromConfig(cfg('cw78')));
    const b = JSON.stringify(hierarchyFromConfig(cfg('cw78')));
    eq('byte-identical', a, b);
}


const bundled = (id) => JSON.parse(readFileSync(
    new URL(`../../src/modules/${id}.json`, import.meta.url), 'utf8'));
const { declaresModernRack } = await import('../../dist/esm/model/modern-rack.js');

_log('\nTest: a pad-scoped rack translates to its banks as plain pages (2026-10-05)');
{
    /* The older drum racks edit the focused pad through alias keys; under
     * Schwung pages they play from movy's banks, in movy's order. */
    for (const id of ['mrdrums', 'weird-dreams', 'signal']) {
        const c = bundled(id);
        const h = hierarchyFromConfig(c);
        ok(`${id}: translates`, !!h);
        if (!h) continue;
        eq(`${id}: root links every bank in order`,
           h.levels.root.params.map((x) => x.label).join(','),
           c.banks.map((b) => b.name).join(','));
        /* No voices and no layout: the config decides the pads (D4), and a
         * voice here would seat a rack the config does not describe. */
        eq(`${id}: no pad_layout`, h.pad_layout, undefined);
        ok(`${id}: no level carries a note`,
           Object.values(h.levels).every((l) => l.note === undefined));
    }
}

_log('\nTest: an alias carries the config\'s metadata inline');
{
    /* `cv_*` keys have no chain_params entry, so without the inline entry the
     * planner guesses a 0..1 float and an enum becomes a bare knob. */
    const c = bundled('weird-dreams');
    const slot = c.banks.flatMap((b) => b.rows.flat()).find((x) => x && x.options);
    ok('the fixture has an enum slot', !!slot);
    const h = hierarchyFromConfig(c);
    const p = Object.values(h.levels).flatMap((l) => l.params)
        .find((x) => x && x.key === slot.key);
    eq('its options survive', JSON.stringify(p.options), JSON.stringify(slot.options));
    eq('and its type', p.type, slot.type);
}

_log('\nTest: a config that is not a pad-scoped rack still translates to nothing');
{
    /* A raw-MIDI note map has no per-pad pages, and a synth's config must
     * never outvote its own declaration. */
    eq('krautdrums (raw-MIDI note map)', hierarchyFromConfig(bundled('krautdrums')), null);
    eq('slicer (raw-MIDI note map)', hierarchyFromConfig(bundled('slicer')), null);
    eq('303 (a synth)', hierarchyFromConfig(bundled('303')), null);
}

_log('\nTest: which declarations count as a modern drum rack');
{
    eq('pad_layout drums', declaresModernRack({ pad_layout: 'drums', levels: {} }), true);
    eq('a child_prefix level (simian, dr32)', declaresModernRack({ levels: {
        pads: { child_prefix: 'pad', child_count: 16 } } }), true);
    eq('an {index} template (sophie)', declaresModernRack({ levels: {
        root: { child_key_template: 'p{index}_{key}', child_index_param: 'focused_pad' } } }), true);
    /* forge: a voice level that passes `{key}` straight through to the
     * module's own focused voice declares nothing per pad. */
    eq('a {key} passthrough (forge)', declaresModernRack({ levels: {
        Voice: { child_key_template: '{key}', child_index_param: 'focused_voice' } } }), false);
    eq('plain levels (mrdrums, weird-dreams)', declaresModernRack({ levels: {
        root: { knobs: ['a'] }, global: { knobs: ['b'] } } }), false);
    eq('nothing', declaresModernRack(null), false);
}


_log('\nTest: a slot\'s graphic tag becomes Schwung\'s viz, row by row');
{
    const h = hierarchyFromConfig({
        id: 'tags', name: 'Tags', drum: { padCount: 2, padNoteStart: 36, padScoping: { aliasPrefix: 'cv_' } },
        banks: [{ name: 'All', rows: [
            [{ key: 'a', env: 'a' }, { key: 'd', env: 'd' }, { key: 's', env: 's' }, { key: 'r', env: 'r' }],
            [{ key: 'cut', filter: 'cutoff' }, { key: 'res', filter: 'resonance' },
             { key: 'w', lfo: 'shape' }, { key: 'm', lfo: 'mode' }],
            [{ key: 'bar', render: 'vbar' }, { key: 'clk', env: false }, { key: 'plain' }],
        ] }],
    });
    const v = (k) => Object.values(h.levels).flatMap((l) => l.params).find((x) => x && x.key === k).viz;
    eq('attack is an envelope attack', JSON.stringify(v('a')), JSON.stringify({ group: 'All:0:env', role: 'attack', kind: 'envelope' }));
    eq('release too, in the same group', v('r').group, v('a').group);
    eq('cutoff is a filter role', v('cut').role, 'cutoff');
    /* One graphic per config row, like movy's own: row 1's filter is not row
     * 0's envelope's group, and could not be drawn across the row gap anyway. */
    ok('a different row is a different group', v('cut').group !== v('a').group);
    eq('an LFO shape is an LFO role', v('w').kind, 'lfo');
    eq('a role Schwung lacks stays undeclared', v('m'), undefined);
    eq('a bar is a fader', v('bar').kind, 'fader');
    eq('env:false vetoes the detector', v('clk'), false);
    eq('an untagged slot is left to the detector', v('plain'), undefined);
}


_log('\nTest: a group split by an untagged knob keeps its first run and lends the rest');
{
    /* forge's Mod row: Sync sits between Rate and Depth. */
    const h = hierarchyFromConfig({
        id: 'split', name: 'Split', drum: { padCount: 2, padNoteStart: 36, padScoping: { aliasPrefix: 'cv_' } },
        banks: [{ name: 'Mod', rows: [[{ key: 'w', lfo: 'shape' }, { key: 'r', lfo: 'rate' },
                                       { key: 's' }, { key: 'd', lfo: 'depth' }]] }],
    });
    const v = (k) => h.levels.mod.params.find((x) => x.key === k).viz;
    eq('shape spans', v('w').span, undefined);
    eq('rate spans', v('r').span, undefined);
    eq('depth is lent, not spanned', v('d').span, false);
    eq('and stays in the group', v('d').group, v('w').group);
}

}

