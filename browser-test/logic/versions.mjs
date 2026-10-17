/* browser-test/logic/versions.mjs — set version history as the UI sees it:
 * the BACKUPS page, the menu off the wire, and restore. The ladder itself is
 * the engine's (version_store.rs, cargo test).
 *
 * Run by browser-test/logic.mjs.
 */

import { eq, ok, _log } from './harness.mjs';

export async function run() {
{
    _log('\nversions page:');
    const { installMockFs, uninstallMockFs, installMockEngine, uninstallMockEngine }
        = await import('./harness.mjs');
    const { refreshVersionRows, resetVersionWire } = await import('../../dist/esm/seq/version-wire.js');
    const { agoLabel, buildVersionsPageVM }
        = await import('../../dist/esm/seq/versions-page-vm.js');
    const { versionsPageState, versionsPageJog, versionsPageBack, resetVersionsPage }
        = await import('../../dist/esm/seq/versions-page.js');

    const NOW = 1788892154000;
    const MIN = 60_000, HOUR = 3600_000, DAY = 24 * HOUR;

    eq('just now', agoLabel(NOW - 5000, NOW), 'JUST NOW');
    eq('minutes', agoLabel(NOW - 18 * MIN, NOW), '18M AGO');
    eq('hours', agoLabel(NOW - 3 * HOUR, NOW), '3H AGO');
    eq('yesterday', agoLabel(NOW - 30 * HOUR, NOW), 'YESTERDAY');
    eq('days', agoLabel(NOW - 4 * DAY, NOW), '4D AGO');
    /* No usable clock: say so rather than invent a date. Nothing in the list is
     * ORDERED by time, so an unknown one costs only its label. */
    eq('no timestamp', agoLabel(0, NOW), 'OLDEST');
    eq('a future timestamp is not a negative age', agoLabel(NOW + HOUR, NOW), 'OLDEST');

    installMockFs({});
    const engine = installMockEngine();
    resetVersionWire();
    eq('an empty set says so', buildVersionsPageVM(NOW).empty, true);

    engine.versions = '2 3 ' + (NOW - 2 * MIN) + ' pre-wipe 2 1 0\n1 1 0 adopted 1 0 0';
    refreshVersionRows();
    const vm = buildVersionsPageVM(NOW);
    eq('two rows', vm.rows.length, 2);
    eq('newest first', vm.rows[0].why, 'PRE-WIPE');
    eq('shows the clip count', vm.rows[0].clips, '2 CLIPS');
    eq('one clip is singular', vm.rows[1].clips, '1 CLIP');
    /* A version with no ui half restores the sequence alone, and the row has to
     * say so — a user restoring one expects their instruments back too. */
    eq('a version with no ui half is marked', vm.rows[1].seqOnly, true);
    eq('and one with a ui half is not', vm.rows[0].seqOnly, false);

    resetVersionsPage();
    versionsPageJog(1, false);
    eq('jog moves one row', versionsPageState.selected, 1);
    versionsPageJog(1, false);
    eq('and clamps at the end', versionsPageState.selected, 1);
    versionsPageJog(-1, false);
    eq('and back up', versionsPageState.selected, 0);

    /* The confirm owns the jog: a list that scrolled under an armed confirm
     * would restore whatever the jog happened to land on. */
    versionsPageState.confirming = true;
    versionsPageJog(1, false);
    eq('an armed confirm freezes the selection', versionsPageState.selected, 0);
    ok('and Back cancels it', versionsPageBack());
    eq('the confirm is gone', versionsPageState.confirming, false);
    ok('a second Back is not consumed', !versionsPageBack());

    resetVersionWire();
    uninstallMockEngine();
    uninstallMockFs();
}

{
    _log('\nthe menu off the wire:');
    const { installMockFs, uninstallMockFs, installMockEngine, uninstallMockEngine }
        = await import('./harness.mjs');
    const { parseVersionRows, refreshVersionRows, versionRows, resetVersionWire }
        = await import('../../dist/esm/seq/version-wire.js');
    const { buildVersionsPageVM } = await import('../../dist/esm/seq/versions-page-vm.js');

    const rows = parseVersionRows('3 9 1788892154000 open 6 1 1\n1 4 0 adopted 2 0 0');
    eq('parses both rows', rows.length, 2);
    eq('newest first as the engine sends it', rows[0].n, 3);
    eq('carries why', rows[1].why, 'adopted');
    eq('carries the chains flag', rows[0].ch, true);
    eq('a version with neither half', rows[1].ui || rows[1].ch, false);
    /* An engine that has not answered is NO VERSIONS, never a crash — the same
     * rule the file reader applies to an unreadable index. */
    eq('no answer is empty', parseVersionRows(null).length, 0);
    eq('an empty answer is empty', parseVersionRows('').length, 0);
    eq('a malformed row is dropped', parseVersionRows('x y z\n1 4 0 open 2 0 0').length, 1);

    installMockFs({});
    const engine = installMockEngine();
    engine.versions = '2 7 0 exit 3 1 1';
    refreshVersionRows();
    eq('the rows came from the engine', versionRows()[0].n, 2);

    /* The page repaints every frame. A menu that asked the engine per frame
     * would cost 3-5 ms of the tick that samples MIDI. */
    const before = engine.getParamCalls;
    for (let i = 0; i < 10; i++) buildVersionsPageVM(Date.now());
    eq('ten frames cost no engine reads', engine.getParamCalls, before);

    /* SEQ ONLY means neither half came with it. A version that carries chains
     * alone still restores instruments, so it is not seq-only. */
    engine.versions = '5 9 0 adopted 1 0 0';
    refreshVersionRows();
    eq('neither half reads as SEQ ONLY', buildVersionsPageVM(Date.now()).rows[0].seqOnly, true);
    engine.versions = '5 9 0 adopted 1 0 1';
    refreshVersionRows();
    eq('chains alone is not SEQ ONLY', buildVersionsPageVM(Date.now()).rows[0].seqOnly, false);

    resetVersionWire();
    uninstallMockEngine();
    uninstallMockFs();
}

{
    _log('\nrestoring a version:');
    const { installMockFs, uninstallMockFs, installMockEngine, uninstallMockEngine }
        = await import('./harness.mjs');
    const { restoreVersion, restoreTick, resetVersionRestore }
        = await import('../../dist/esm/seq/version-restore.js');
    const { readUiBlob } = await import('../../dist/esm/seq/persist-store.js');
    const fs = installMockFs();
    const engine = installMockEngine();
    resetVersionRestore();

    /* Two ladders writing the same directory would interleave version numbers
     * and prune each other's entries, so the UI keeps none: it asks. */
    engine.vui = 'pending';
    restoreVersion('S1', 3);
    ok('the command went out', engine.setCmds.indexOf('restore 3') >= 0);
    eq('and no file was written', fs.writes.length, 0);

    eq('a pending restore is not done', restoreTick(), false);
    engine.vui = '{"root":48}';
    eq('the answer completes it', restoreTick(), true);
    eq('and the ui half landed in the UI\'s own file', readUiBlob('S1'), '{"root":48}');

    /* An adopted older sequence has no ui half; overwriting the chains with
     * nothing would be worse than the wipe the feature exists to undo. */
    const beforeUi = readUiBlob('S1');
    restoreVersion('S1', 4);
    engine.vui = 'none';
    eq('a version with no ui half still completes', restoreTick(), true);
    eq('and left the ui blob alone', readUiBlob('S1'), beforeUi);

    /* A restore that never lands must not leave the page waiting forever: past
     * the bound, a late answer is no longer collected. */
    restoreVersion('S1', 5);
    engine.vui = 'pending';
    for (let i = 0; i < 200; i++) restoreTick();
    engine.vui = '{"root":50}';
    eq('a restore that never answers gives up', restoreTick(), false);

    resetVersionRestore();
    uninstallMockEngine();
    uninstallMockFs();
}
}
