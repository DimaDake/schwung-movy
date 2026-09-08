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

{
    _log('\nretention ladder:');
    const { versionToDrop, MAX_VERSIONS }
        = await import('../../dist/esm/seq/version-retain.js');

    const NOW = 1788892154000;
    const MIN = 60_000, HOUR = 3600_000, DAY = 24 * HOUR;

    /* Build a list with an exact per-bucket occupancy. Ages are spread evenly
     * inside each bucket, newest first, gen descending — the order the index
     * keeps. `mark` overrides one entry's `why` by position. */
    const build = (counts, mark = {}) => {
        const spans = [[0, HOUR], [HOUR, DAY], [DAY, 7 * DAY], [7 * DAY, 30 * DAY]];
        const ages = [];
        counts.forEach((c, b) => {
            const [lo, hi] = spans[b];
            for (let i = 0; i < c; i++) ages.push(lo + ((i + 1) * (hi - lo)) / (c + 1));
        });
        ages.sort((a, b) => a - b);
        return ages.map((a, i) => ({
            n: ages.length - i, gen: ages.length - i, ms: NOW - a,
            why: mark[i] || 'auto', clips: 4, ui: true,
        }));
    };
    const bucketOfAge = (age) =>
        age <= HOUR ? 0 : age <= DAY ? 1 : age <= 7 * DAY ? 2 : 3;
    const droppedBucket = (list, drop) => {
        const r = list.find((x) => x.n === drop);
        return r ? bucketOfAge(NOW - r.ms) : -1;
    };

    eq('a short list is never thinned', versionToDrop(build([3, 0, 0, 0]), NOW), null);
    /* Exactly MAX fits. Thinning below the total would throw away recent work
     * while free slots sat unused — the caps bound the SHAPE, the total bounds
     * the size. */
    eq('exactly MAX is not thinned', versionToDrop(build([8, 8, 8, 8]), NOW), null);
    eq('MAX is 32', MAX_VERSIONS, 32);

    /* One over, in the newest bucket: that is the bucket that gives one up. */
    {
        const list = build([9, 8, 8, 8]);
        eq('drops from the over-cap bucket', droppedBucket(list, versionToDrop(list, NOW)), 0);
    }

    /* No rollover, and this is the assertion that proves it: the newest bucket
     * is within its cap and an OLDER one is over, so the drop must come from
     * the older one. A ladder that simply always thinned the densest end would
     * fail here. */
    {
        const list = build([8, 9, 8, 8]);
        eq('drops from an older over-cap bucket', droppedBucket(list, versionToDrop(list, NOW)), 1);
    }
    {
        const list = build([8, 8, 8, 9]);
        eq('and from the oldest one', droppedBucket(list, versionToDrop(list, NOW)), 3);
    }

    /* The newest three are never dropped, however dense that end is. */
    {
        const list = build([12, 8, 8, 8]);
        const drop = versionToDrop(list, NOW);
        ok('never the newest three',
            drop !== list[0].n && drop !== list[1].n && drop !== list[2].n);
    }

    /* A pre-wipe inside 7 days survives even when it sits at the densest point.
     * Those versions exist BECAUSE something destructive happened. */
    {
        const list = build([9, 8, 8, 8], { 5: 'pre-wipe' });
        eq('a recent pre-wipe is not the drop', versionToDrop(list, NOW) === list[5].n, false);
    }

    /* A version with no usable clock cannot be aged, so it lands in the oldest
     * bucket and is ranked there by generation. Nothing is ordered by time. */
    {
        const list = [
            ...build([8, 8, 8, 0]),
            ...Array.from({ length: 9 }, (_, i) => ({
                n: 100 - i, gen: 100 - i, ms: 0, why: 'adopted', clips: 1, ui: false,
            })),
        ];
        const drop = versionToDrop(list, NOW);
        ok('a clockless version is thinned as oldest', drop >= 90);
    }

    /* A clock that jumped backwards must not make every version "in the future"
     * and therefore unthinnable. */
    {
        const list = Array.from({ length: 33 }, (_, i) => ({
            n: 33 - i, gen: 33 - i, ms: NOW + (i + 1) * HOUR,
            why: 'auto', clips: 2, ui: true,
        }));
        ok('future timestamps still thin', versionToDrop(list, NOW) !== null);
    }
}

{
    _log('\nversion store:');
    const { installMockFs, uninstallMockFs } = await import('./harness.mjs');
    const { readVersionIndex, writeVersion, readVersionState, readVersionUi }
        = await import('../../dist/esm/seq/version-store.js');
    const { versionStatePath } = await import('../../dist/esm/seq/set-context.js');

    const NOW = 1788892154000;
    const fs = installMockFs({});
    eq('a set with no history reads empty', readVersionIndex('S1').v.length, 0);

    ok('writes a version', writeVersion('S1', 'open', 'movy1\ncl 0 0 16 0 x\n', 5, '{"root":48}', NOW));
    const idx = readVersionIndex('S1');
    eq('one version', idx.v.length, 1);
    eq('numbered from 1', idx.v[0].n, 1);
    eq('carries the generation', idx.v[0].gen, 5);
    eq('counted its clips', idx.v[0].clips, 1);
    eq('recorded the ui blob', idx.v[0].ui, true);
    eq('next advanced', idx.next, 2);

    eq('the payload comes back', readVersionState('S1', 1).payload, 'movy1\ncl 0 0 16 0 x\n');
    eq('the ui blob comes back', readVersionUi('S1', 1), '{"root":48}');

    /* The version DIRECTORY is written before the index entry, so a crash
     * between them leaves an unreferenced directory — collectable — instead of
     * an index naming files that do not exist. */
    const order = fs.writes.filter((p) => p.includes('/v/1/') || p.endsWith('versions.json'));
    ok('directory written before the index', order[order.length - 1].endsWith('versions.json'));

    /* No ui blob is a legitimate version: an adopted OLDER sequence has no ui
     * state of its own age, and restoring it must leave the chains alone. */
    writeVersion('S1', 'adopted', 'movy1\n', 1, null, 0);
    eq('a version can have no ui half', readVersionIndex('S1').v.find((r) => r.n === 2).ui, false);
    eq('and reads back as null', readVersionUi('S1', 2), null);

    /* An index naming a version whose files are gone must not offer it. */
    delete fs.files[versionStatePath('S1', 2)];
    eq('a dangling entry is dropped on read',
        readVersionIndex('S1').v.some((r) => r.n === 2), false);

    /* A failed write must leave NO index entry: a version that half exists is
     * worse than one that does not, because the menu would offer it. */
    fs.failWrites = '/v/3/';
    eq('a failed capture is not recorded',
        writeVersion('S1', 'auto', 'movy1\ncl 0 0 16 0 z\n', 9, null, NOW), false);
    fs.failWrites = null;
    eq('and left the index alone', readVersionIndex('S1').v.some((r) => r.n === 3), false);

    /* Over the cap, the store prunes as it writes — the ladder decides which. */
    for (let i = 0; i < 40; i++)
        writeVersion('CAP', 'auto', 'movy1\ncl 0 0 16 0 ' + i + '\n', i + 1, null, NOW + i * 60_000);
    ok('the store keeps the set within its cap', readVersionIndex('CAP').v.length <= 32);

    uninstallMockFs();
}

{
    _log('\nadopting what earlier builds wrote:');
    const { readFileSync } = await import('node:fs');
    const { installMockFs, uninstallMockFs } = await import('./harness.mjs');
    const { adoptExistingVersions, captureVersion, captureAutoIfDue, resetVersionCapture }
        = await import('../../dist/esm/seq/version-capture.js');
    const { readVersionIndex, readVersionUi } = await import('../../dist/esm/seq/version-store.js');
    const { uuidToStatePath, uuidToUiStatePath, shadowPath }
        = await import('../../dist/esm/seq/set-context.js');
    const { wrapState } = await import('../../dist/esm/seq/persist-blob.js');

    const NOW = 1788892154000;
    const FIX = 'browser-test/fixtures/old-sets/movy-chains';
    const oldSeq = readFileSync(`${FIX}/seq-state.json`, 'utf8');
    const oldUi = readFileSync(`${FIX}/ui-state.json`, 'utf8');

    /* A real set from an earlier build: canonical plus two shadows, one of them
     * an older generation. All three predate this feature. */
    {
        resetVersionCapture();
        const fs = installMockFs({
            [uuidToStatePath('OLD')]: oldSeq,
            [shadowPath('OLD', 1)]: oldSeq,
            [shadowPath('OLD', 2)]: wrapState('movy1\ncl 0 0 16 0 9:24:60:100:0\n', 3),
            [uuidToUiStatePath('OLD')]: oldUi,
        });
        eq('adopts the distinct copies', adoptExistingVersions('OLD', NOW), 2);
        const idx = readVersionIndex('OLD');
        eq('duplicates collapsed', idx.v.length, 2);
        ok('ordered newest first', idx.v[0].gen > idx.v[1].gen);
        eq('the newest adopted carries the ui blob', idx.v[0].ui, true);
        eq('and it is the current one', readVersionUi('OLD', idx.v[0].n), oldUi);
        /* Older adopted versions get NO ui blob: ui-state.json was never
         * rotated, so pairing an older sequence with today's chains would be a
         * quiet lie. */
        eq('the older adopted has none', idx.v[1].ui, false);

        /* Adoption COPIES. Adopting the shadows by reference would mean the
         * history evaporates on the next autosave, which rewrites them. */
        ok('the shadow was copied, not referenced',
            Object.keys(fs.files).some((p) => p.includes('/v/') && p.endsWith('seq-state.json')));

        eq('adoption is once per set', adoptExistingVersions('OLD', NOW), 0);
        eq('and did not touch the current state', fs.files[uuidToStatePath('OLD')], oldSeq);
        uninstallMockFs();
    }

    /* A legacy envelope — written before gen/end existed — adopts at 0. */
    {
        resetVersionCapture();
        installMockFs({ [uuidToStatePath('LEG')]: 'movy1\ncl 0 0 16 0 0:24:60:100:0\n' });
        eq('a legacy file adopts', adoptExistingVersions('LEG', NOW), 1);
        eq('at generation 0', readVersionIndex('LEG').v[0].gen, 0);
        uninstallMockFs();
    }

    /* A set with nothing on disk has nothing to adopt — and must not record an
     * empty version, which would sit in the menu pretending to be work. */
    {
        resetVersionCapture();
        installMockFs({});
        eq('nothing to adopt', adoptExistingVersions('NEW', NOW), 0);
        uninstallMockFs();
    }

    _log('\ncapture conditions:');
    {
        resetVersionCapture();
        installMockFs({});
        captureVersion('S2', 'open', 'movy1\ncl 0 0 16 0 x\n', 4, NOW);
        eq('open captured', readVersionIndex('S2').v.length, 1);
        /* An identical payload is not a new version — the autosave rewrites the
         * same bytes whenever anything else in the set changed. */
        captureVersion('S2', 'exit', 'movy1\ncl 0 0 16 0 x\n', 5, NOW + 1000);
        eq('an unchanged payload is not captured again', readVersionIndex('S2').v.length, 1);
        captureVersion('S2', 'exit', 'movy1\ncl 0 0 16 0 y\n', 6, NOW + 2000);
        eq('a changed payload is', readVersionIndex('S2').v.length, 2);

        /* auto is rate-limited: the autosave fires every few seconds forever. */
        captureAutoIfDue('S2', 'movy1\ncl 0 0 16 0 z\n', 7, NOW + 3000);
        eq('auto is refused inside the interval', readVersionIndex('S2').v.length, 2);
        captureAutoIfDue('S2', 'movy1\ncl 0 0 16 0 z\n', 7, NOW + 11 * 60_000);
        eq('and allowed after it', readVersionIndex('S2').v.length, 3);

        /* A pre-wipe is unconditional — it is the capture the feature exists
         * for, and the thing being wiped may well be the only copy. */
        captureVersion('S2', 'pre-wipe', 'movy1\ncl 0 0 16 0 z\n', 8, NOW + 12 * 60_000);
        eq('a pre-wipe is recorded even when unchanged', readVersionIndex('S2').v.length, 4);
        uninstallMockFs();
    }
}
}
