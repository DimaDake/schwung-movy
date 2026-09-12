/* browser-test/logic/flags.mjs — the Global Params flags page: registry,
 * persistence, the engine re-apply, and the jog/knob split.
 *
 * Run by browser-test/logic.mjs.
 */

import {
    installMockFs, uninstallMockFs, PREFS_PATH,
    FLAGS, flagDef, clampFlag, flagValueLabel, flagNormalized,
    flagValue, setFlag, applyFlagsToEngine, resetFlags,
    flagsPageState, flagsPageActive, flagsPageJog, flagsPageKnob, resetFlagsPage, FLAG_KNOB,
    flagsRowCount, backupsRowSelected, actionRowSelected,
    migrateRowArmed, armMigrateRow, disarmMigrateRow, runMigrateRow, slotsHaveContent,
    buildFlagsPageVM, VISIBLE_ROWS, firstVisibleRow, readPrefFlags, writePrefFlag,
    visibleFlags, trackRef, DETENT_DIV,
    wrapWords, HINT_W, HINT_LINES, fontWidth, W,
    serializeUiState, applyUiState, resetUiState,
    readPrefModuleBlacklist,
    DEBUG_BUILD, openParamPage, closeParamPage, paramPageActive,
    VIEW_FLAGS, VIEW_CHAIN, VIEW_MAIN_PARAMS,
    appState, ok, eq, _log,
} from './harness.mjs';

/* One physical click is DETENT_DIV raw units — a delta of 1 is an EIGHTH of a
 * click and moves nothing. This helper sent 1 per click and the assertions that
 * depended on it were passing vacuously (see `ok` in harness.mjs). */
function turn(k, clicks) {
    for (let i = 0; i < Math.abs(clicks); i++)
        flagsPageKnob(k, clicks > 0 ? DETENT_DIV : -DETENT_DIV);
}

/** Where a key landed in the engine push, whatever value it went out with. */
function sentIndex(sent, key) {
    for (let i = 0; i < sent.length; i++) if (sent[i].indexOf(key + '=') === 0) return i;
    return -1;
}

export async function run() {

/* ── The registry ─────────────────────────────────────────────────────────── */
{
    _log('\nFlags registry');

    ok('the page has flags to list', FLAGS.length > 0);

    for (const f of FLAGS) {
        ok(`${f.key} has a readable name`, typeof f.name === 'string' && f.name.length > 0);
        ok(`${f.key}'s default is inside its own range`, f.def >= f.min && f.def <= f.max);
        eq(`${f.key} is findable by key`, flagDef(f.key), f);
    }
    eq('an unknown key resolves to nothing', flagDef('nope'), null);

    /* A literal def rather than a shipped flag: the clamp is a property of the
     * table, and pinning it to whichever flag happens to have a range today
     * makes it break every time the table changes. */
    const ranged = { key: 'r', name: 'R', hint: '', min: 0, max: 2, def: 2 };
    eq('clamped low', clampFlag(ranged, -5), ranged.min);
    eq('clamped high', clampFlag(ranged, 99), ranged.max);
    eq('a non-number falls back to the default', clampFlag(ranged, NaN), ranged.def);
    eq('fractions land on a whole setting', clampFlag(ranged, 1.4), 1);

    /* The shipped defaults, pinned because each is a product decision that
     * lives in a one-character field and would fail no other test in this repo
     * — every suite below sets the flags it cares about explicitly, and the
     * screenshot scenes do too. */
    eq('new sets are committed to disk', flagDef('setcommit').def, 1);
    eq('movy draws its own param pages', flagDef('schwunggrid').def, 0);

    /* `bool` presentation has no user in the shipped table — every flag there
     * carries word labels or reads as a number — so it is exercised against a
     * literal def rather than left untested until the next one needs it. */
    const boolean = { key: 'x', name: 'X', hint: '', min: 0, max: 1, def: 0, bool: true };
    eq('a bool flag reads as OFF', flagValueLabel(boolean, 0), 'OFF');
    eq('a bool flag reads as ON', flagValueLabel(boolean, 1), 'ON');
    eq('a numeric flag shows its number', flagValueLabel(flagDef('setcommit'), 1), '1');

    eq('the LED is dark at the bottom of the range', flagNormalized(ranged, 0), 0);
    eq('and full at the top', flagNormalized(ranged, 2), 1);
    ok('and in between in between',
        flagNormalized(ranged, 1) > 0 && flagNormalized(ranged, 1) < 1);
}

/* ── Persistence ──────────────────────────────────────────────────────────── */
{
    _log('\nFlags persistence');

    installMockFs();
    resetFlags();
    for (const f of FLAGS) {
        if (f.perSet) continue;
        eq(`${f.key} starts at its default`, flagValue(f.key), f.def);
    }
    /* A per-set flag has no default to start at until a set has been loaded —
     * it reads as it would in a set that predates it. No shipped flag is
     * `perSet` today (the mechanism's one user, `chtrackset`, is gone with the
     * schwung host); this loop is 0 iterations and documents that rather than
     * testing dead weight. */
    for (const f of FLAGS.filter((f) => f.perSet)) {
        eq(`${f.key} starts conservative, not at its default`,
           flagValue(f.key), f.legacy);
    }

    setFlag('schwunggrid', 1);
    eq('the value moved', flagValue('schwunggrid'), 1);
    eq('and reached prefs.json', readPrefFlags().schwunggrid, 1);

    /* The whole point: a flag was a measurement instrument that reset on every
     * engine load, and is a setting now. Dropping the cache models reopening
     * movy — if the value came back as the default, nothing was persisted. */
    resetFlags();
    eq('and survives a reopen', flagValue('schwunggrid'), 1);

    setFlag('schwunggrid', 99);
    eq('a write past the range is clamped, not refused', flagValue('schwunggrid'), 2);
    eq('and the clamped value is what is stored', readPrefFlags().schwunggrid, 2);

    eq('an unknown flag cannot be written', setFlag('nope', 1), 0);
    ok('and leaves no trace in prefs', !('nope' in readPrefFlags()));
    uninstallMockFs();

    /* prefs.json holds unrelated settings; a flag write must not eat them, and
     * a flag this build does not list must survive a build that does. */
    installMockFs({
        [PREFS_PATH]: JSON.stringify({ defaultQuant: 70, flags: { chfuture: 7 } }),
    });
    writePrefFlag('schwunggrid', 1);
    const after = JSON.parse(globalThis.host_read_file(PREFS_PATH));
    eq('an unrelated preference survives', after.defaultQuant, 70);
    eq('and so does a flag this build does not know', after.flags.chfuture, 7);
    eq('alongside the one just written', after.flags.schwunggrid, 1);
    uninstallMockFs();

    /* The `revisedAt` adoption mechanism, now with a live user: `engpersist`
     * shipped off, everyone who tested it has a stored 0, and a stored value
     * beats a changed default forever. Without this the release that turns
     * engine-owned saves on turns them on for nobody who was involved. */
    installMockFs({
        [PREFS_PATH]: JSON.stringify({ flagsRev: 3, flags: { engpersist: 0, schwunggrid: 1 } }),
    });
    resetFlags();
    eq('a stored value from before the revision is superseded', flagValue('engpersist'), 1);
    eq('a flag with no revision keeps its stored value', flagValue('schwunggrid'), 1);
    /* Written back, so the adoption happens exactly once — a user who then
     * turns it off again must keep it off. */
    const adopted = JSON.parse(globalThis.host_read_file(PREFS_PATH));
    eq('the adoption is recorded', adopted.flags.engpersist, 1);
    eq('at the new revision', adopted.flagsRev, 4);
    setFlag('engpersist', 0);
    resetFlags();
    eq('and a later opinion at the current revision stands', flagValue('engpersist'), 0);
    uninstallMockFs();

    installMockFs({   // no flagsRev key at all, which reads as rev 0
        [PREFS_PATH]: JSON.stringify({ flags: { schwunggrid: 1 } }),
    });
    resetFlags();
    eq('a rev-less prefs file still reads its unrevised flags', flagValue('schwunggrid'), 1);
    uninstallMockFs();

    installMockFs({ [PREFS_PATH]: '{not json' });
    resetFlags();
    eq('corrupt prefs fall back to defaults',
       flagValue('schwunggrid'), flagDef('schwunggrid').def);
    uninstallMockFs();

    installMockFs({ [PREFS_PATH]: JSON.stringify({ flags: { schwunggrid: 'one' } }) });
    resetFlags();
    eq('and so does a value of the wrong type',
       flagValue('schwunggrid'), flagDef('schwunggrid').def);
    uninstallMockFs();
}

/* ── The engine re-apply ──────────────────────────────────────────────────── */
{
    _log('\nFlags reach the engine');

    installMockFs();
    resetFlags();
    setFlag('setcommit', 0);

    /* A re-dlopened engine is a brand new one with default flags — nothing the
     * page says about a UI-only setting reaches it until this runs. */
    let sent = [];
    applyFlagsToEngine((k, v) => sent.push(k + '=' + v));
    const engineFlags = FLAGS.filter((f) => !f.uiOnly);
    for (const f of engineFlags) {
        ok(`${f.key} is pushed on an engine boot`,
           sent.some((s) => s.indexOf(f.key + '=') === 0), sent.join(' '));
    }
    /* A uiOnly flag is one the UI acts on by itself. The engine has no handler
     * for it, so writing it costs a blocking round trip on the audio thread to
     * be told nothing — and it would read, in the log, exactly like a flag the
     * engine understands. */
    for (const f of FLAGS.filter((f) => f.uiOnly)) {
        ok(`${f.key} is NOT pushed — the engine has no such param`,
           !sent.some((s) => s.indexOf(f.key + '=') === 0), sent.join(' '));
    }
    eq('every engine flag exactly once, plus the blacklist', sent.length, engineFlags.length + 1);
    ok('including the values that were set', sent.indexOf('setcommit=0') >= 0);

    /* And an edit after boot goes straight through, rather than waiting for the
     * next one. */
    sent = [];
    setFlag('setcommit', 1);
    eq('a later edit reaches the engine too', sent.join(''), 'setcommit=1');

    sent = [];
    setFlag('setcommit', 1);
    eq('an edit that changes nothing writes nothing', sent.length, 0);
    uninstallMockFs();

    /* The blacklist is the containment mechanism, so it has to reach the engine
     * on the same boot the flags do — a module that races while its pin sits
     * unsent in prefs.json is exactly the failure it exists to prevent. */
    installMockFs({ [PREFS_PATH]: JSON.stringify({ moduleBlacklist: ['helm', 'obxd'] }) });
    resetFlags();
    eq('the blacklist is read from prefs', readPrefModuleBlacklist().join(','), 'helm,obxd');
    sent = [];
    applyFlagsToEngine((k, v) => sent.push(k + '=' + v));
    ok('and is sent as one csv', sent.indexOf('chblock=helm,obxd') >= 0, sent.join(' '));
    uninstallMockFs();

    /* Empty is a real value: the engine replaces the list wholesale, so this is
     * how a module removed from prefs.json stops being pinned. A skipped write
     * would leave the last boot's list in force. */
    installMockFs();
    resetFlags();
    sent = [];
    applyFlagsToEngine((k, v) => sent.push(k + '=' + v));
    ok('an empty blacklist is still sent', sent.indexOf('chblock=') >= 0, sent.join(' '));

    /* A name with a comma would arrive as two names — one of them invented. */
    uninstallMockFs();
    installMockFs({ [PREFS_PATH]: JSON.stringify({ moduleBlacklist: ['a,b', 'helm', 7, ''] }) });
    eq('a name that would split on the wire is refused',
       readPrefModuleBlacklist().join('|'), 'helm');
    uninstallMockFs();
}

/* ── The page: jog scrolls, knob 1 edits ──────────────────────────────────── */
{
    _log('\nFlags page input');

    installMockFs();
    resetFlags();
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
    flagsPageJog(1);
    eq('jog moves down', flagsPageState.selected, 1);
    flagsPageJog(-1);
    eq('and back up', flagsPageState.selected, 0);
    flagsPageJog(-1);
    eq('the top is clamped, not wrapped', flagsPageState.selected, 0);
    /* The list ends past the last flag with two action rows, and counting rows
     * off `visibleFlags()` alone would put the second one out of the jog's
     * reach — which is how a row that draws but cannot be selected happens. */
    for (let i = 0; i < FLAGS.length + 5; i++) flagsPageJog(1);
    eq('and so is the bottom', flagsPageState.selected, flagsRowCount() - 1);
    eq('the last row is the last action row, not a flag', actionRowSelected(), 1);

    /* Knob 1 edits whatever the jog selected — that is the whole interaction,
     * and it is what lets the list grow past eight entries. */
    flagsPageState.selected = visibleFlags().findIndex((f) => f.key === 'schwunggrid');
    setFlag('schwunggrid', 1);
    turn(FLAG_KNOB, 6);
    ok('knob 1 raises the selected flag', flagValue('schwunggrid') > 1);
    turn(FLAG_KNOB, -20);
    eq('and lowers it to its floor, never past', flagValue('schwunggrid'), flagDef('schwunggrid').min);

    const before = flagValue('schwunggrid');
    turn(3, 6);
    eq('another knob does nothing', flagValue('schwunggrid'), before);

    /* A half-turn banked on one flag must not spend itself on the next: the
     * detent accumulator is shared, so jogging has to clear it. */
    flagsPageState.selected = visibleFlags().findIndex((f) => f.key === 'setcommit');
    setFlag('setcommit', 0);
    flagsPageKnob(FLAG_KNOB, 1);
    flagsPageJog(1);
    flagsPageJog(-1);
    eq('a detent banked before a jog does not leak past it', flagValue('setcommit'), 0);

    closeParamPage();
    uninstallMockFs();
}

/* ── The page: what it draws ──────────────────────────────────────────────── */
{
    _log('\nFlags page view');

    installMockFs();
    resetFlags();
    resetFlagsPage();

    setFlag('schwunggrid', 2);
    setFlag('setcommit', 1);
    const vm = buildFlagsPageVM();
    /* ONE DRAWN ROW PER SELECTABLE ROW, and this is the assertion that was
     * missing when BACKUPS shipped invisible: it was added to the jog's clamp
     * and to the router but not to this list, so it was selectable, clickable
     * and undrawn — and every screenshot stayed byte-identical, because the
     * viewmodel never changed. Comparing against `visibleFlags().length` could
     * not have caught it; comparing against what the gestures walk can. */
    eq('one drawn row per selectable row', vm.rows.length, flagsRowCount());
    eq('the flags come first', vm.rows[0].name, visibleFlags()[0].name);
    eq('and the action rows come last', vm.rows.slice(-2).map((r) => r.name).join(','),
       'BACKUPS,MIGRATE TRACKS');
    eq('the name column is the readable name', vm.rows[0].name, visibleFlags()[0].name);
    eq('exactly one row is selected', vm.rows.filter((r) => r.selected).length, 1);
    ok('a labelled flag shows its word', vm.rows.some((r) => r.value === 'PAGE'));
    ok('a numeric flag shows its number', vm.rows.some((r) => r.value === '1'));

    /* Selecting the action row: it draws as selected, the hint explains it
     * rather than the flag above, and knob 1 goes dark because it does nothing
     * there. */
    {
        resetFlagsPage();
        for (let i = 0; i < FLAGS.length + 5; i++) flagsPageJog(1);
        const av = buildFlagsPageVM();
        ok('the action row can be selected', av.rows[av.rows.length - 1].selected);
        eq('exactly one row is still selected', av.rows.filter((r) => r.selected).length, 1);
        ok('the hint is the action row\'s own', av.hint.toLowerCase().includes('schwung'));
        eq('the knob LED is dark on it', av.knobNormalized, 0);
        resetFlagsPage();
    }

    /* The LED carries the value AND says which knob is live — it is the only
     * lit one. A flat brightness would leave the page mute about both. */
    flagsPageState.selected = visibleFlags().findIndex((f) => f.key === 'schwunggrid');
    setFlag('schwunggrid', 0);
    eq('the knob LED is dim at the bottom of the range', buildFlagsPageVM().knobNormalized, 0);
    setFlag('schwunggrid', 2);
    eq('and full at the top', buildFlagsPageVM().knobNormalized, 1);

    /* Scrolling. The list is short today and will not be, so the window is
     * asserted at a length it does not yet have. */
    ok('the screen fits several rows', VISIBLE_ROWS >= 4);
    eq('a short list never scrolls', firstVisibleRow(0, 3), 0);
    eq('a selection near the top does not scroll either', firstVisibleRow(1, 20), 0);
    const mid = firstVisibleRow(10, 20);
    ok('a selection in the middle is centred', mid > 0 && mid <= 10);
    eq('and the last row does not scroll past the end',
        firstVisibleRow(19, 20), 20 - VISIBLE_ROWS);

    uninstallMockFs();
}

/* ── The debug gate ───────────────────────────────────────────────────────── */
{
    _log('\nFlags debug gate');

    /* The suites build with the gate ON (build/browser.mjs), so this asserts
     * the constant exists and is the one the tests are running under — every
     * `visibleFlags()` assertion above passes the arrangement it wants
     * explicitly, for exactly that reason. The release side is guarded where it
     * matters: scripts/build-module.sh greps the built ui.js for the substituted
     * constant, which is the only check that can catch a `define` that stopped
     * applying. */
    eq('the browser tests run with the debug surfaces compiled in', DEBUG_BUILD, true);
}

/* ── What a release build lists ────────────────────────── */
{
    _log('\nFlags page release list');

    installMockFs();
    resetFlags();

    /* No shipped flag is `release` today — the mechanism's one user, `chtracks`,
     * is gone with the schwung host, and the Settings page's flag section is
     * empty in a release build (MIGRATE TRACKS and BACKUPS still draw: they are
     * action rows, not flags, and are not filtered by this list at all). */
    ok('neither debug flag is a release row',
       !flagDef('setcommit').release && !flagDef('schwunggrid').release);
    eq('a release build lists no flags', visibleFlags(false).length, 0);
    const dbg = visibleFlags(true).map((f) => f.key);
    eq('a debug build lists every flag', dbg.length, FLAGS.length);
    ok('including the ones release hides', dbg.indexOf('schwunggrid') >= 0);

    /* The page walks the visible list, so a hidden flag can never be selected
     * — a knob turn on a row a release build does not draw would change a
     * setting nobody can see. */
    resetFlagsPage();
    for (let i = 0; i < FLAGS.length + 5; i++) flagsPageJog(1);
    ok('the selection cannot leave the listed rows',
       flagsPageState.selected < flagsRowCount());
    /* A knob turn on the action row must change nothing: it has no value, and
     * the row above it does. */
    const beforeAction = flagValue(visibleFlags()[visibleFlags().length - 1].key);
    flagsPageKnob(0, 40);
    eq('the knob is inert on the action row',
       flagValue(visibleFlags()[visibleFlags().length - 1].key), beforeAction);

    uninstallMockFs();
}

/* ── The hint band: every row says what it does ───────────── */
{
    _log('\nSettings hints');

    installMockFs();
    resetFlags();
    resetFlagsPage();

    for (const f of FLAGS) {
        ok(`${f.key} explains itself`, typeof f.hint === 'string' && f.hint.length > 0);
        /* The band is a fixed two lines at the bottom of a 128px screen. A hint
         * that needs a third is not shortened at render time — it is silently
         * cut, and the row ends mid-sentence on the device where nothing here
         * would notice. */
        const lines = wrapWords(f.hint, HINT_W);
        ok(`${f.key}'s hint fits the band`, lines.length <= HINT_LINES,
           `${lines.length} lines: ${f.hint}`);
    }

    /* A row draws its name from the left and its value from the right edge, and
     * neither is measured against the other — so a name one word too long does
     * not wrap or ellipsize, it collides, and the row becomes unreadable at
     * exactly the value the user most needs to read. */
    for (const f of FLAGS) {
        const widest = (f.labels || ['OFF', 'ON', String(f.max)])
            .reduce((a, b) => (fontWidth(a) > fontWidth(b) ? a : b));
        const used = fontWidth(f.name) + fontWidth(widest) + 4;
        ok(`"${f.name}" and "${widest}" fit one row`, used <= W, `${used}px of ${W}`);
    }

    /* The band follows the selection, or it is describing a different row than
     * the one under the inverted band. */
    flagsPageState.selected = visibleFlags().findIndex((f) => f.key === 'setcommit');
    eq('the hint is the selected row\'s', buildFlagsPageVM().hint, flagDef('setcommit').hint);
    flagsPageJog(-1);
    const above = visibleFlags()[flagsPageState.selected];
    eq('and it follows the jog', buildFlagsPageVM().hint, above.hint);

    /* The list has to give the band its two lines back. */
    ok('the list leaves room for the band', VISIBLE_ROWS >= 4 && VISIBLE_ROWS <= 5);

    uninstallMockFs();
}

/* ── Settings — the second action row (MIGRATE TRACKS) ────── */
{
    _log('\nSettings action rows');

    installMockFs();
    resetFlags();
    resetFlagsPage();
    disarmMigrateRow();

    const flags = visibleFlags(true);
    /* The count is what the jog clamps to AND what the viewmodel draws. A row
     * added to one but not the other is selectable, clickable and undrawn —
     * exactly how BACKUPS shipped the first time. */
    eq('two action rows past the flags', flagsRowCount(), flags.length + 2);

    flagsPageState.selected = flags.length;
    eq('vm draws every row', buildFlagsPageVM(flags).rows.length, flags.length + 2);
    eq('first action row is BACKUPS', buildFlagsPageVM(flags).rows[flags.length].name, 'BACKUPS');
    eq('backups is action 0', actionRowSelected(), 0);
    ok('a flag row is action -1', (flagsPageState.selected = 0, actionRowSelected() === -1));

    flagsPageState.selected = flags.length + 1;
    const vm = buildFlagsPageVM(flags);
    eq('second action row is MIGRATE TRACKS', vm.rows[flags.length + 1].name, 'MIGRATE TRACKS');
    eq('migrate is action 1', actionRowSelected(), 1);
    eq('it is selected', vm.rows[flags.length + 1].selected, true);
    ok('its hint is shown', vm.hint.length > 0);
    eq('the knob LED is dark on an action row', vm.knobNormalized, 0);

    /* Arming: a stray jog-click stops playback and reloads every module in the
     * Set, so the row says what the NEXT click will do before it does it. */
    disarmMigrateRow();
    eq('unarmed value', buildFlagsPageVM(flags).rows[flags.length + 1].value, '>');
    armMigrateRow();
    eq('armed', migrateRowArmed(), true);
    eq('armed value', buildFlagsPageVM(flags).rows[flags.length + 1].value, 'CONFIRM?');
    /* Moving away disarms: an arm left standing on a row the user has scrolled
     * off is a confirmation they did not give. Building the viewmodel is what
     * notices the move, so the read itself is what expires it. */
    flagsPageState.selected = 0;
    buildFlagsPageVM(flags);
    eq('moving off disarms', migrateRowArmed(), false);
    flagsPageState.selected = flags.length + 1;

    uninstallMockFs();
}

/* ── The migrate action itself ─────────────────────────────── */
{
    _log('\nMIGRATE TRACKS: what the confirmed press does');

    installMockFs();
    const origGet = globalThis.shadow_get_param;
    const origSet = globalThis.shadow_set_param;
    const store = {};
    globalThis.shadow_get_param = (s, k) => store[s + '|' + k] ?? null;
    globalThis.shadow_set_param = (s, k, v) => { store[s + '|' + k] = v; return true; };
    const clearSlots = () => {
        for (let s = 0; s < 4; s++) {
            for (const c of ['midi_fx1', 'synth', 'fx1', 'fx2']) {
                globalThis.shadow_set_param(s, c + '_module', '');
            }
        }
    };

    clearSlots();
    eq('nothing in the slots reads as nothing', slotsHaveContent(), false);
    armMigrateRow();
    eq('a press with nothing to find does not arm the reload', runMigrateRow(), false);
    eq('and disarms the row either way', migrateRowArmed(), false);

    globalThis.shadow_set_param(2, 'synth_module', 'plaits');
    eq('a loaded slot reads as content', slotsHaveContent(), true);
    armMigrateRow();
    eq('a press with something to find arms the reload', runMigrateRow(), true);
    eq('and disarms the row', migrateRowArmed(), false);

    globalThis.shadow_get_param = origGet;
    globalThis.shadow_set_param = origSet;
    uninstallMockFs();
}

/* ── Word wrapping ───────────────────────────────────────── */
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
