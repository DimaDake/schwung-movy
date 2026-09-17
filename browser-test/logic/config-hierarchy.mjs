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
    eq('the kick level lists the kick bank\'s keys', kick.params.join(','), declared.join(','));
    eq('and puts them under the same eight knobs', kick.knobs.join(','), declared.join(','));

    /* A config row pads with nulls to fill a page; a null is not a param and a
     * level that claimed one would plan an empty cell. */
    ok('no empty slot survives the translation', kick.params.every((k) => !!k));
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
    /* `reloadIfChanged` fingerprints the contract every 8 ticks. A translation
     * that differed run to run — a Set's iteration order, a Date, an object
     * identity — would re-plan the page forever, which is the shape of the bug
     * SP-27 measured the cost of. */
    const a = JSON.stringify(hierarchyFromConfig(cfg('cw78')));
    const b = JSON.stringify(hierarchyFromConfig(cfg('cw78')));
    eq('byte-identical', a, b);
}

}
