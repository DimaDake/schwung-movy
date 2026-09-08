/* browser-test/logic/versions.mjs — set version history: the index, the
 * retention ladder, the store, capture, adoption and restore.
 *
 * Run by browser-test/logic.mjs.
 */

import { eq, ok, _log } from './harness.mjs';

export async function run() {
{
    _log('\nversion index:');
    const { parseVersionIndex, serializeVersionIndex, countClips }
        = await import('../../dist/esm/seq/version-index.js');
    const { versionsIndexPath, versionDir, versionStatePath, versionUiPath }
        = await import('../../dist/esm/seq/set-context.js');

    const SETS = '/data/UserData/schwung/modules/tools/movy/sets';
    eq('index path', versionsIndexPath('S1'), `${SETS}/S1/versions.json`);
    eq('version dir', versionDir('S1', 7), `${SETS}/S1/v/7`);
    eq('version state path', versionStatePath('S1', 7), `${SETS}/S1/v/7/seq-state.json`);
    eq('version ui path', versionUiPath('S1', 7), `${SETS}/S1/v/7/ui-state.json`);
    /* An empty uuid resolves to _default, exactly as uuidToStatePath does —
     * movy runs under that id until Move materialises the Set. */
    eq('empty uuid → _default', versionDir('', 1), `${SETS}/_default/v/1`);

    /* An unreadable index is NO VERSIONS, never an instruction to delete: the
     * same rule collectDeadSets applies to an unreadable Sets directory. */
    eq('null index is empty', parseVersionIndex(null).v.length, 0);
    eq('garbage index is empty', parseVersionIndex('{{{').v.length, 0);
    eq('empty index still counts from 1', parseVersionIndex(null).next, 1);

    const raw = JSON.stringify({ next: 4, v: [
        { n: 3, gen: 9, ms: 1788892154000, why: 'open', clips: 6, ui: true },
        { n: 1, gen: 4, ms: 0, why: 'adopted', clips: 2, ui: false },
    ] });
    const idx = parseVersionIndex(raw);
    eq('round-trips the count', idx.v.length, 2);
    eq('newest first', idx.v[0].n, 3);
    eq('carries why', idx.v[1].why, 'adopted');
    eq('carries the ui flag', idx.v[1].ui, false);
    eq('serialize round-trips', parseVersionIndex(serializeVersionIndex(idx)).v.length, 2);

    /* A record missing fields is dropped rather than defaulted: a version whose
     * generation we cannot read cannot be ordered, and an unordered entry in a
     * restore menu is worse than an absent one. */
    eq('a record with no n is dropped',
        parseVersionIndex(JSON.stringify({ next: 2, v: [{ gen: 1, ms: 0, why: 'open' }] })).v.length, 0);
    eq('a record with a bad why is dropped',
        parseVersionIndex(JSON.stringify({ next: 2, v: [{ n: 1, gen: 1, ms: 0, why: 'nope' }] })).v.length, 0);
    /* next must outrank every n on disk or a new version overwrites an old
     * directory — the one corruption this index cannot self-heal from. */
    eq('next is repaired past the highest n',
        parseVersionIndex(JSON.stringify({ next: 1, v: [{ n: 9, gen: 1, ms: 0, why: 'open', clips: 0, ui: false }] })).next, 10);

    eq('counts clips', countClips('movy1\ncl 0 0 16 0 x\ncp 0\ncl 1 0 16 0 y\n'), 2);
    eq('a blank has none', countClips('movy1\n'), 0);
}
}
