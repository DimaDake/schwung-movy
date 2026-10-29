/* browser-test/logic/flags.mjs — the Settings page (its rows, its jog, what it
 * draws) and the module blacklist the engine gets on every boot.
 *
 * Run by browser-test/logic.mjs.
 */

import {
    installMockFs, uninstallMockFs, PREFS_PATH,
    flagsPageState, flagsPageActive, flagsPageJog, resetFlagsPage,
    flagsRowCount, backupsRowSelected, clickRowSelected, migrateRowSelected, actionRowSelected,
    readPrefClickDb, clickVolumeTurn, clickVolumeLabel, resetClickVolume,
    buildFlagsPageVM, VISIBLE_ROWS, firstVisibleRow,
    wrapWords, HINT_W, HINT_LINES, fontWidth, W,
    readPrefModuleBlacklist, installMockEngine, uninstallMockEngine,
    seqEngineTick, resetSeqEngine,
    openParamPage, closeParamPage, paramPageActive,
    VIEW_FLAGS, VIEW_CHAIN, VIEW_MAIN_PARAMS,
    appState, ok, eq, _log,
} from './harness.mjs';
import { genLevel, genLevelTurn, genLevelLabel, resetGenLevel } from '../../dist/esm/seq/gen-level.js';
import { genRowSelected } from '../../dist/esm/seq/flags-page.js';

export async function run() {

/* ── The module blacklist reaches the engine ─────────────────────────────── */
{
    _log('\nModule blacklist');

    /* It is the containment mechanism, so it has to reach the engine on every
     * boot — a module that races while its pin sits unsent in prefs.json is
     * exactly the failure it exists to prevent. */
    const boot = () => {
        const eng = installMockEngine();
        resetSeqEngine();
        seqEngineTick();
        return eng;
    };
    installMockFs({ [PREFS_PATH]: JSON.stringify({ moduleBlacklist: ['helm', 'obxd'] }) });
    eq('the blacklist is read from prefs', readPrefModuleBlacklist().join(','), 'helm,obxd');
    let eng = boot();
    eq('and is sent as one csv on boot', eng.params.chblock, 'helm,obxd');
    uninstallMockEngine(); uninstallMockFs();

    /* Empty is a real value: the engine replaces the list wholesale, so this is
     * how a module removed from prefs.json stops being pinned. A skipped write
     * would leave the last boot's list in force. */
    installMockFs();
    eng = boot();
    eq('an empty blacklist is still sent', eng.params.chblock, '');
    uninstallMockEngine(); uninstallMockFs();
    resetSeqEngine();

    /* A name with a comma would arrive as two names — one of them invented. */
    installMockFs({ [PREFS_PATH]: JSON.stringify({ moduleBlacklist: ['a,b', 'helm', 7, ''] }) });
    eq('a name that would split on the wire is refused',
       readPrefModuleBlacklist().join('|'), 'helm');
    uninstallMockFs();
}

/* ── The page: jog scrolls ───────────────────────────────────────────────── */
{
    _log('\nSettings page input');

    resetFlagsPage();
    appState.currentView = VIEW_CHAIN;

    ok('the page is not up', !flagsPageActive());
    openParamPage(VIEW_FLAGS);
    ok('opening puts it on screen', flagsPageActive());
    ok('and it is a param page, so one Back leaves it', paramPageActive());

    /* Siblings, not a stack: opening Set Params from here must replace this
     * page and still return to where the LAYER was entered from. */
    openParamPage(VIEW_MAIN_PARAMS);
    ok('a sibling replaces it', !flagsPageActive());
    eq('and Back leaves the layer entirely', closeParamPage(), VIEW_CHAIN);

    openParamPage(VIEW_FLAGS);
    eq('the selection starts at the top', flagsPageState.selected, 0);
    ok('which is CLICK VOLUME', clickRowSelected());
    flagsPageJog(1);
    eq('jog moves down', flagsPageState.selected, 1);
    ok('onto GENERATORS', genRowSelected());
    flagsPageJog(1);
    ok('then BACKUPS', backupsRowSelected());
    flagsPageJog(1);
    ok('migrate_row_stays_last', migrateRowSelected() && flagsPageState.selected === flagsRowCount() - 1);
    flagsPageJog(-1);
    ok('and BACKUPS is last-1, where the device scenarios step to', backupsRowSelected());
    for (let i = 0; i < 6; i++) flagsPageJog(-1);
    eq('the top is clamped, not wrapped', flagsPageState.selected, 0);
    for (let i = 0; i < 10; i++) flagsPageJog(1);
    eq('and so is the bottom', flagsPageState.selected, flagsRowCount() - 1);

    closeParamPage();
}

/* ── The page: what it draws ─────────────────────────────────────────────── */
{
    _log('\nSettings page view');

    installMockFs();
    resetFlagsPage();
    const vm = buildFlagsPageVM();
    /* ONE DRAWN ROW PER SELECTABLE ROW, and this is the assertion that was
     * missing when BACKUPS shipped invisible: it was added to the jog's clamp
     * and to the router but not to this list, so it was selectable, clickable
     * and undrawn — and every screenshot stayed byte-identical, because the
     * viewmodel never changed. */
    eq('one drawn row per selectable row', vm.rows.length, flagsRowCount());
    eq('the rows', vm.rows.map((r) => r.name).join(','), 'CLICK VOLUME,GENERATORS,BACKUPS,MIGRATE FROM MOVE');
    eq('generators_row_drawn: shows the level', vm.rows[1].value, 'BALANCED');
    eq('exactly one row is selected', vm.rows.filter((r) => r.selected).length, 1);
    ok('CLICK VOLUME explains itself', vm.hint.length > 0);
    eq('and shows the default level', vm.rows[0].value, '0 dB');

    /* The band follows the selection, or it is describing a different row than
     * the one under the inverted band. */
    flagsPageJog(1);
    ok('the generators row explains itself', /bold/i.test(buildFlagsPageVM().hint));
    flagsPageJog(2);
    const mv = buildFlagsPageVM();
    ok('the migrate row can be selected', mv.rows[3].selected);
    ok('and the hint is its own', mv.hint.toLowerCase().includes('from move'), mv.hint);

    /* Scrolling: the list is short, and the window is asserted at a length it
     * does not have. */
    ok('the screen fits several rows', VISIBLE_ROWS >= 4);
    eq('a short list never scrolls', firstVisibleRow(0, 3), 0);
    eq('a selection near the top does not scroll either', firstVisibleRow(1, 20), 0);
    const mid = firstVisibleRow(10, 20);
    ok('a selection in the middle is centred', mid > 0 && mid <= 10);
    eq('and the last row does not scroll past the end',
        firstVisibleRow(19, 20), 20 - VISIBLE_ROWS);
    /* The list has to give the band its two lines back. */
    ok('the list leaves room for the band', VISIBLE_ROWS >= 4 && VISIBLE_ROWS <= 5);

    resetFlagsPage();
    uninstallMockFs();
}

/* ── Generators level: a device property, clamped, durable ─────────────── */
{
    _log('\nGenerators level');
    installMockFs();
    resetGenLevel();
    eq('a fresh install is BALANCED', genLevel(), 'BALANCED');
    ok('gen_level_turn_clamps: up moves', genLevelTurn(1) && genLevel() === 'WILD');
    ok('gen_level_turn_clamps: the top holds', !genLevelTurn(1) && genLevel() === 'WILD');
    ok('gen_level_turn_clamps: a fast turn moves one level', genLevelTurn(-5) && genLevel() === 'BALANCED');
    genLevelTurn(-1);
    eq('gen_level_turn_clamps: down to SAFE', genLevelLabel(), 'SAFE');
    resetGenLevel();
    eq('gen_level_persists', genLevel(), 'SAFE');
    uninstallMockFs();
    resetGenLevel();
}

/* ── Click volume: default unchanged, clamped, durable, reaches the engine ── */
{
    _log('\nClick volume');

    installMockFs();
    resetClickVolume();
    eq('a fresh install is at the default', readPrefClickDb(), 0);
    eq('and reads 0 dB', clickVolumeLabel(), '0 dB');

    let eng = installMockEngine();
    resetSeqEngine();
    seqEngineTick();
    eq('the default is pushed on boot too (a new engine starts at it)', eng.params.clickdb, '0');
    ok('and the boot push is silent', eng.params.clickaud === undefined);

    ok('turning down at the floor does nothing', !clickVolumeTurn(-1));
    ok('turning up moves it', clickVolumeTurn(3));
    eq('the engine is told', eng.params.clickdb, '3');
    eq('and plays a click so the change is heard', eng.params.clickaud, '1');
    eq('it is stored', readPrefClickDb(), 3);
    eq('the row says so', clickVolumeLabel(), '+3 dB');
    for (let i = 0; i < 40; i++) clickVolumeTurn(1);
    eq('the top is clamped at 11 dB (the engine\'s no-clip ceiling)', readPrefClickDb(), 11);
    ok('and a turn past it reports no change', !clickVolumeTurn(1));

    /* A restart re-reads the file; a re-dlopened engine is told again. */
    resetClickVolume();
    resetSeqEngine();
    uninstallMockEngine();
    eng = installMockEngine();
    seqEngineTick();
    eq('a restart restores the level into the engine', eng.params.clickdb, '11');
    uninstallMockEngine(); uninstallMockFs();
    resetClickVolume(); resetSeqEngine();
}

/* ── The hint band: every row says what it does, in two lines ────────────── */
{
    _log('\nSettings hints');

    installMockFs();
    resetFlagsPage();
    for (let i = 0; i < flagsRowCount(); i++) {
        flagsPageState.selected = i;
        const vm = buildFlagsPageVM();
        const row = vm.rows[i];
        /* The band is a fixed two lines at the bottom of a 128px screen. A hint
         * that needs a third is not shortened at render time — it is silently
         * cut, and the row ends mid-sentence on the device. */
        const lines = wrapWords(vm.hint, HINT_W);
        ok(`${row.name}'s hint fits the band`, lines.length > 0 && lines.length <= HINT_LINES,
           `${lines.length} lines: ${vm.hint}`);
        /* A row draws its name from the left and its value from the right edge,
         * and neither is measured against the other — a name one word too long
         * collides rather than wraps. */
        const used = fontWidth(row.name) + fontWidth(row.value) + 4;
        ok(`"${row.name}" and "${row.value}" fit one row`, used <= W, `${used}px of ${W}`);
    }
    resetFlagsPage();
    uninstallMockFs();
}

/* ── Word wrapping ───────────────────────────────────────────────────────── */
{
    _log('\nHint wrapping');

    eq('a short line is one line', wrapWords('abc', HINT_W).length, 1);
    eq('nothing to say is nothing to draw', wrapWords('', HINT_W).length, 0);
    /* Greedy, at spaces: breaking mid-word would read as a typo at this size. */
    const two = wrapWords('one two three four five six seven eight nine ten', 40);
    ok('a long line breaks into several', two.length > 1);
    ok('and never mid-word', two.every((l) => l.indexOf(' ') !== 0 && l.trim() === l), two.join('|'));
    eq('every word survives the break', two.join(' '),
       'one two three four five six seven eight nine ten');
    /* A word too long for the line still gets drawn rather than dropped. */
    eq('an unbreakable word gets its own line',
       wrapWords('supercalifragilistic', 10).join('|'), 'supercalifragilistic');
}

}
