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
    flagsRowCount, backupsRowSelected,
    buildFlagsPageVM, VISIBLE_ROWS, firstVisibleRow, readPrefFlags, writePrefFlag,
    visibleFlags, movyTracksOn, loadSetHostChoice, trackRef, DETENT_DIV,
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

    const host = flagDef('chtracks');
    eq('clamped low', clampFlag(host, -5), host.min);
    eq('clamped high', clampFlag(host, 99), host.max);
    eq('a non-number falls back to the default', clampFlag(host, NaN), host.def);
    eq('fractions land on a whole setting', clampFlag(host, 1.4), 1);

    /* The shipped defaults, pinned because each is a product decision that
     * lives in a one-character field and would fail no other test in this repo
     * — every suite below sets the flags it cares about explicitly, and the
     * screenshot scenes do too. */
    eq('tracks 1-4 follow the set they are in', flagDef('chtracks').def, 2);
    eq('a set movy has never seen is new work', flagDef('chtrackset').def, 1);
    eq('a set predating the field keeps schwung', flagDef('chtrackset').legacy, 0);
    eq('new sets are committed to disk', flagDef('setcommit').def, 1);
    eq('movy draws its own param pages', flagDef('schwunggrid').def, 0);

    /* `bool` presentation has no user in the shipped table — every flag there
     * carries word labels or reads as a number — so it is exercised against a
     * literal def rather than left untested until the next one needs it. */
    const boolean = { key: 'x', name: 'X', hint: '', min: 0, max: 1, def: 0, bool: true };
    eq('a bool flag reads as OFF', flagValueLabel(boolean, 0), 'OFF');
    eq('a bool flag reads as ON', flagValueLabel(boolean, 1), 'ON');
    eq('a numeric flag shows its number', flagValueLabel(flagDef('setcommit'), 1), '1');

    eq('the LED is dark at the bottom of the range', flagNormalized(host, 0), 0);
    eq('and full at the top', flagNormalized(host, 2), 1);
    ok('and in between in between',
        flagNormalized(host, 1) > 0 && flagNormalized(host, 1) < 1);
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
    /* A per-set flag has no default to start at until a set has been loaded:
     * before that it reads as it would in a set that predates it, which is what
     * movy did before the flag existed. Reading `def` here would put tracks 1-4
     * on movy chains during boot, before the set that owns them has said so. */
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

    /* A device that formed an opinion under the OLD default. Without the rev
     * check, a changed default reaches only a device that never opened the page
     * — which is how one silently failed to ship once already. */
    installMockFs({   // no flagsRev key at all, which reads as rev 0
        [PREFS_PATH]: JSON.stringify({ flags: { chtracks: 0, schwunggrid: 1 } }),
    });
    resetFlags();
    eq('a superseded stored value is replaced by the new default',
       flagValue('chtracks'), flagDef('chtracks').def);
    eq('a flag with no revision keeps its stored value', flagValue('schwunggrid'), 1);

    /* Exactly once. Changing it back after the adoption is a real choice and
     * must survive the next boot — a re-adopting migration would fight the
     * user. */
    setFlag('chtracks', 0);
    resetFlags();
    eq('and changing it back again sticks', flagValue('chtracks'), 0);
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
    setFlag('chtracks', 1);          // MOVY, explicitly

    /* A re-dlopened engine is a brand new one with default flags. If the page
     * says tracks 1-4 are movy's over an engine still routing them to schwung,
     * the page is lying and every sequenced note goes to the wrong host. */
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
    /* The engine needs the RESOLVED host, not the three-value mode: `drain_out`
     * sends a sequenced note out as MIDI or into a chain, and a 2 would be
     * neither. */
    ok('and the host mode goes out resolved', sent.indexOf('chtracks=1') >= 0,
       sent.join(' '));

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
    /* The list ends one row PAST the last flag: BACKUPS is an action row, and
     * counting rows off `visibleFlags()` alone would put it out of the jog's
     * reach — which is how a row that draws but cannot be selected happens. */
    for (let i = 0; i < FLAGS.length + 5; i++) flagsPageJog(1);
    eq('and so is the bottom', flagsPageState.selected, flagsRowCount() - 1);
    ok('the last row is BACKUPS, not a flag', backupsRowSelected());

    /* Knob 1 edits whatever the jog selected — that is the whole interaction,
     * and it is what lets the list grow past eight entries. */
    flagsPageState.selected = visibleFlags().findIndex((f) => f.key === 'chtracks');
    setFlag('chtracks', 1);
    turn(FLAG_KNOB, 6);
    ok('knob 1 raises the selected flag', flagValue('chtracks') > 1);
    turn(FLAG_KNOB, -20);
    eq('and lowers it to its floor, never past', flagValue('chtracks'), flagDef('chtracks').min);

    const before = flagValue('chtracks');
    turn(3, 6);
    eq('another knob does nothing', flagValue('chtracks'), before);

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

    setFlag('chtracks', 2);
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
    eq('and the action row is last', vm.rows[vm.rows.length - 1].name, 'BACKUPS');
    eq('the name column is the readable name', vm.rows[0].name, visibleFlags()[0].name);
    eq('exactly one row is selected', vm.rows.filter((r) => r.selected).length, 1);
    ok('a labelled flag shows its word', vm.rows.some((r) => r.value === 'NEW SETS'));
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
        ok('the hint is the action row\'s own', av.hint.toLowerCase().includes('versions'));
        eq('the knob LED is dark on it', av.knobNormalized, 0);
        resetFlagsPage();
    }

    /* The LED carries the value AND says which knob is live — it is the only
     * lit one. A flat brightness would leave the page mute about both. */
    flagsPageState.selected = visibleFlags().findIndex((f) => f.key === 'chtracks');
    setFlag('chtracks', 0);
    eq('the knob LED is dim at the bottom of the range', buildFlagsPageVM().knobNormalized, 0);
    setFlag('chtracks', 2);
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

    ok('the track host is a release row', flagDef('chtracks').release === true);
    ok('and the per-set half with it', flagDef('chtrackset').release === true);
    ok('the debug surfaces are not',
       !flagDef('setcommit').release && !flagDef('schwunggrid').release);

    const relKeys = () => visibleFlags(false).map((f) => f.key).join(',');
    eq('a release build lists the setting and the per-set row',
       relKeys(), 'chtracks,chtrackset');
    const dbg = visibleFlags(true).map((f) => f.key);
    eq('a debug build lists every flag', dbg.length, FLAGS.length);
    ok('including the ones release hides', dbg.indexOf('schwunggrid') >= 0);

    /* `This Set` is only answerable while the mode defers to the set. Under an
     * explicit mode it would show a value the knob cannot change, which reads
     * as a broken row rather than an inactive one. */
    setFlag('chtracks', 1);
    ok('an explicit mode drops the per-set row', relKeys().indexOf('chtrackset') < 0);
    setFlag('chtracks', 0);
    ok('either explicit mode', relKeys().indexOf('chtrackset') < 0);
    setFlag('chtracks', 2);
    ok('and NEW SETS brings it back', relKeys().indexOf('chtrackset') >= 0);

    /* Word labels: OFF/ON cannot say which of two hosts a track is on. They
     * name the hosts — a SCHWUNG track behaves exactly as it does without movy,
     * which is the thing a user is choosing between. */
    const tr = flagDef('chtracks');
    eq('the row names what it decides', tr.name, 'Tracks 1-4 Host');
    eq('0 leaves them with schwung', flagValueLabel(tr, 0), 'SCHWUNG');
    eq('1 hands them to movy', flagValueLabel(tr, 1), 'MOVY');
    eq('2 defers to the set', flagValueLabel(tr, 2), 'NEW SETS');
    eq('and the per-set row answers the same question',
       flagValueLabel(flagDef('chtrackset'), 0), 'SCHWUNG');

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

    /* And the knob edits the row the page DREW. Hiding `This Set` shifts every
     * row below it up by one, so a page reading the raw table edits the flag
     * above the selection — invisibly, since both lists are the same length in
     * a debug build until a row is dropped. */
    setFlag('chtracks', 1);                       // drops the per-set row
    resetFlagsPage();
    flagsPageState.selected = 1;
    eq('the drawn row here is Commit New Sets', visibleFlags()[1].key, 'setcommit');
    eq('while the raw table has This Set there', FLAGS[1].key, 'chtrackset');
    setFlag('setcommit', 0);
    setFlag('chtrackset', 1);
    turn(FLAG_KNOB, 2);
    eq('the knob moved the row the page drew', flagValue('setcommit'), 1);
    eq('and left the one the raw table has there alone', flagValue('chtrackset'), 1);
    setFlag('chtracks', 2);

    uninstallMockFs();
}

/* ── Movy tracks 1-4: a mode, and a value the set carries ──────── */
{
    _log('\nMovy tracks 1-4 per set');

    installMockFs();
    resetFlags();
    setFlag('chtracks', 2);          // NEW SETS

    loadSetHostChoice(null);         // a Set movy has never seen
    ok('a new set gets movy tracks', movyTracksOn());
    eq('so track 1 is a movy chain', trackRef(0).kind, 'movy');

    loadSetHostChoice({});           // a blob written before the field existed
    ok('a set built before this keeps schwung slots', !movyTracksOn());
    eq('so track 1 is a host slot', trackRef(0).kind, 'host');

    loadSetHostChoice({ chtrackset: 1 });
    ok('a set that recorded its choice keeps it', movyTracksOn());

    /* The two explicit modes are global overrides — that is the whole reason
     * they exist next to the per-set default. */
    setFlag('chtracks', 0);
    ok('SCHWUNG overrides a set that chose movy', !movyTracksOn());
    setFlag('chtracks', 1);
    loadSetHostChoice({});
    ok('MOVY overrides a set that predates the field', movyTracksOn());

    /* And the set's own value survives being overridden, so coming back to
     * NEW SETS restores each set's choice rather than the last global one. */
    setFlag('chtracks', 2);
    ok('the set is back on schwung when the mode defers again', !movyTracksOn());

    /* The engine is told the RESOLVED host, never the mode: `drain_out` decides
     * whether a sequenced note leaves as MIDI or enters a chain, and a 2 there
     * routes every note into a chain that does not exist. */
    let sent = [];
    applyFlagsToEngine((k, v) => sent.push(k + '=' + v));
    ok('the engine is told schwung, not the mode', sent.indexOf('chtracks=0') >= 0, sent.join(' '));
    ok('and never sees the per-set row as a param of its own',
       !sent.some((s) => s.indexOf('chtrackset=') === 0), sent.join(' '));
    loadSetHostChoice({ chtrackset: 1 });
    sent = [];
    applyFlagsToEngine((k, v) => sent.push(k + '=' + v));
    ok('a movy set tells the engine so', sent.indexOf('chtracks=1') >= 0, sent.join(' '));

    uninstallMockFs();
}

/* ── … and the set carries it across a save ───────────────── */
{
    _log('\nMovy tracks 1-4 round trip through the set blob');

    installMockFs();
    resetFlags();
    setFlag('chtracks', 2);

    resetUiState();                              // a Set with no blob at all
    ok('a brand new set starts on movy tracks', movyTracksOn());
    const blob = serializeUiState();
    ok('and the choice is written down', JSON.parse(blob).flags.chtrackset === 1);

    applyUiState(JSON.stringify({ scale: 1 }));  // an older set's blob
    ok('loading a set that predates the field moves back to schwung', !movyTracksOn());

    applyUiState(blob);
    ok('and loading the new set moves back to movy', movyTracksOn());

    setFlag('chtracks', 0);
    resetFlags();
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

    /* The CPU boost is not something a track gets for being a track: it is what
     * movy's own chains join. Say so where the user is choosing between them. */
    ok('the host row explains what changes',
       /movy/i.test(flagDef('chtracks').hint) && /schwung/i.test(flagDef('chtracks').hint),
       flagDef('chtracks').hint);

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
