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
    buildFlagsPageVM, VISIBLE_ROWS, firstVisibleRow, readPrefFlags, writePrefFlag,
    visibleFlags, movyTracksOn, loadSetHostChoice, trackRef,
    serializeUiState, applyUiState, resetUiState,
    readPrefModuleBlacklist,
    DEBUG_BUILD, openParamPage, closeParamPage, paramPageActive,
    VIEW_FLAGS, VIEW_CHAIN, VIEW_MAIN_PARAMS,
    appState, ok, eq, _log,
} from './harness.mjs';

/* Ten detents of one click each — countDetents accumulates, so a single
 * delta of 1 is not guaranteed to be a full step on every knob curve. Turning
 * far enough to be sure, then clamping, is what the page itself does. */
function turn(k, clicks) {
    for (let i = 0; i < Math.abs(clicks); i++) flagsPageKnob(k, clicks > 0 ? 1 : -1);
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

    const lanes = flagDef('chlanes');
    eq('clamped low', clampFlag(lanes, -5), lanes.min);
    eq('clamped high', clampFlag(lanes, 99), lanes.max);
    eq('a non-number falls back to the default', clampFlag(lanes, NaN), lanes.def);
    eq('fractions land on a whole setting', clampFlag(lanes, 2.4), 2);

    /* The shipped render configuration, pinned because it is a product decision
     * that lives in a one-character field. `chparallel` off is a ~2x CPU
     * regression and `chidle` off is a ~14x one on an idle set, and neither
     * would fail any other test in this repo — every suite below sets the flags
     * it cares about explicitly, and the screenshot scenes do too. */
    eq('parallel render ships ON', flagDef('chparallel').def, 1);
    eq('tracks 1-4 follow the set they are in', flagDef('chtracks').def, 2);
    eq('CPU optimization ships on', flagDef('cpuopt').def, 1);
    eq('idle skip ships at full (synth + FX)', flagDef('chidle').def, 3);
    eq('three lanes, the measured design point', flagDef('chlanes').def, 3);
    eq('duplicates are not pinned', flagDef('chpin').def, 0);

    const par = flagDef('chparallel');
    eq('a bool flag reads as OFF', flagValueLabel(par, 0), 'OFF');
    eq('a bool flag reads as ON', flagValueLabel(par, 1), 'ON');
    eq('a numeric flag shows its number', flagValueLabel(lanes, 3), '3');

    eq('the LED is dark at the bottom of the range', flagNormalized(lanes, 1), 0);
    eq('and full at the top', flagNormalized(lanes, 4), 1);
    ok('and in between in between',
        flagNormalized(lanes, 2) > 0 && flagNormalized(lanes, 2) < 1);
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

    setFlag('chlanes', 2);
    eq('the value moved', flagValue('chlanes'), 2);
    eq('and reached prefs.json', readPrefFlags().chlanes, 2);

    /* The whole point: a flag was a measurement instrument that reset on every
     * engine load, and is a setting now. Dropping the cache models reopening
     * movy — if the value came back as the default, nothing was persisted. */
    resetFlags();
    eq('and survives a reopen', flagValue('chlanes'), 2);

    setFlag('chlanes', 99);
    eq('a write past the range is clamped, not refused', flagValue('chlanes'), 4);
    eq('and the clamped value is what is stored', readPrefFlags().chlanes, 4);

    eq('an unknown flag cannot be written', setFlag('nope', 1), 0);
    ok('and leaves no trace in prefs', !('nope' in readPrefFlags()));
    uninstallMockFs();

    /* prefs.json holds unrelated settings; a flag write must not eat them, and
     * a flag this build does not list must survive a build that does. */
    installMockFs({
        [PREFS_PATH]: JSON.stringify({ defaultQuant: 70, flags: { chfuture: 7 } }),
    });
    writePrefFlag('chlanes', 2);
    const after = JSON.parse(globalThis.host_read_file(PREFS_PATH));
    eq('an unrelated preference survives', after.defaultQuant, 70);
    eq('and so does a flag this build does not know', after.flags.chfuture, 7);
    eq('alongside the one just written', after.flags.chlanes, 2);
    uninstallMockFs();

    /* A device that formed an opinion under the OLD default. `chparallel` was
     * off by default and got written as 0 during measurement sessions; without
     * the rev check, "on by default" reaches only a device that never opened
     * the page — which is how it silently failed to ship. */
    installMockFs({   // no flagsRev key at all, which reads as rev 0
        [PREFS_PATH]: JSON.stringify({ flags: { chparallel: 0, chlanes: 3 } }),
    });
    resetFlags();
    eq('a superseded stored value is replaced by the new default',
       flagValue('chparallel'), flagDef('chparallel').def);
    eq('a flag with no revision keeps its stored value', flagValue('chlanes'), 3);

    /* Exactly once. Turning it off after the adoption is a real choice and must
     * survive the next boot — a re-adopting migration would fight the user. */
    setFlag('chparallel', 0);
    resetFlags();
    eq('and turning it off again sticks', flagValue('chparallel'), 0);
    uninstallMockFs();

    installMockFs({ [PREFS_PATH]: '{not json' });
    resetFlags();
    eq('corrupt prefs fall back to defaults', flagValue('chlanes'), flagDef('chlanes').def);
    uninstallMockFs();

    installMockFs({ [PREFS_PATH]: JSON.stringify({ flags: { chlanes: 'three' } }) });
    resetFlags();
    eq('and so does a value of the wrong type', flagValue('chlanes'), flagDef('chlanes').def);
    uninstallMockFs();
}

/* ── The engine re-apply ──────────────────────────────────────────────────── */
{
    _log('\nFlags reach the engine');

    installMockFs();
    resetFlags();
    setFlag('chparallel', 1);
    setFlag('chlanes', 2);

    /* A re-dlopened engine is a brand new one with default flags. If the page
     * says "Parallel Render ON" over a serial engine, the page is lying and the
     * user's measurement is of the wrong thing. */
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
    ok('including the values that were set', sent.indexOf('chparallel=1') >= 0
        && sent.indexOf('chlanes=2') >= 0);
    /* Turning parallel on spawns the pool at the CURRENT lane count, so a lane
     * count that arrives afterwards rebuilds it — two blocking calls on the
     * audio thread where one would do. */
    ok('lanes are sent before parallel',
        sent.indexOf('chlanes=2') < sent.indexOf('chparallel=1'), sent.join(' '));

    /* And an edit after boot goes straight through, rather than waiting for the
     * next one. */
    sent = [];
    setFlag('chlanes', 3);
    eq('a later edit reaches the engine too', sent.join(''), 'chlanes=3');

    sent = [];
    setFlag('chlanes', 3);
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
    ok('before parallel render can act on it',
       sent.indexOf('chblock=helm,obxd') < sent.indexOf('chparallel=0'), sent.join(' '));
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
    for (let i = 0; i < FLAGS.length + 5; i++) flagsPageJog(1);
    eq('and so is the bottom', flagsPageState.selected, visibleFlags().length - 1);

    /* Knob 1 edits whatever the jog selected — that is the whole interaction,
     * and it is what lets the list grow past eight entries. */
    flagsPageState.selected = visibleFlags().findIndex((f) => f.key === 'chlanes');
    setFlag('chlanes', 2);
    turn(FLAG_KNOB, 6);
    ok('knob 1 raises the selected flag', flagValue('chlanes') > 2);
    turn(FLAG_KNOB, -20);
    eq('and lowers it to its floor, never past', flagValue('chlanes'), flagDef('chlanes').min);

    const before = flagValue('chlanes');
    turn(3, 6);
    eq('another knob does nothing', flagValue('chlanes'), before);

    /* A half-turn banked on one flag must not spend itself on the next: the
     * detent accumulator is shared, so jogging has to clear it. */
    flagsPageState.selected = visibleFlags().findIndex((f) => f.key === 'chparallel');
    setFlag('chparallel', 0);
    flagsPageKnob(FLAG_KNOB, 1);
    flagsPageJog(1);
    flagsPageJog(-1);
    eq('a detent banked before a jog does not leak past it', flagValue('chparallel'), 0);

    closeParamPage();
    uninstallMockFs();
}

/* ── The page: what it draws ──────────────────────────────────────────────── */
{
    _log('\nFlags page view');

    installMockFs();
    resetFlags();
    resetFlagsPage();

    setFlag('chparallel', 1);
    setFlag('chlanes', 4);
    const vm = buildFlagsPageVM();
    eq('one row per listed flag', vm.rows.length, visibleFlags().length);
    eq('the name column is the readable name', vm.rows[0].name, visibleFlags()[0].name);
    eq('exactly one row is selected', vm.rows.filter((r) => r.selected).length, 1);
    ok('a bool flag shows ON/OFF',
        vm.rows.some((r) => r.value === 'ON' || r.value === 'OFF'));
    ok('a numeric flag shows its number', vm.rows.some((r) => r.value === '4'));

    /* The LED carries the value AND says which knob is live — it is the only
     * lit one. A flat brightness would leave the page mute about both. */
    flagsPageState.selected = visibleFlags().findIndex((f) => f.key === 'chlanes');
    setFlag('chlanes', 1);
    eq('the knob LED is dim at the bottom of the range', buildFlagsPageVM().knobNormalized, 0);
    setFlag('chlanes', 4);
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

    ok('CPU optimization is a release row', flagDef('cpuopt').release === true);
    ok('so is the track host', flagDef('chtracks').release === true);
    ok('the measurement knobs are not', !flagDef('chlanes').release && !flagDef('chpin').release);

    const relKeys = () => visibleFlags(false).map((f) => f.key).join(',');
    eq('a release build lists the two settings and the per-set row',
       relKeys(), 'cpuopt,chtracks,chtrackset');
    const dbg = visibleFlags(true).map((f) => f.key);
    eq('a debug build lists every flag', dbg.length, FLAGS.length);
    ok('including the ones release hides', dbg.indexOf('chlanes') >= 0);

    /* `This Set` is only answerable while the mode defers to the set. Under an
     * explicit mode it would show a value the knob cannot change, which reads
     * as a broken row rather than an inactive one. */
    setFlag('chtracks', 1);
    ok('an explicit mode drops the per-set row', relKeys().indexOf('chtrackset') < 0);
    setFlag('chtracks', 0);
    ok('either explicit mode', relKeys().indexOf('chtrackset') < 0);
    setFlag('chtracks', 2);
    ok('and NEW SETS brings it back', relKeys().indexOf('chtrackset') >= 0);

    /* Word labels: OFF/ON cannot say which of two hosts a track is on. */
    const tr = flagDef('chtracks');
    eq('0 is schwung', flagValueLabel(tr, 0), 'SCHWUNG');
    eq('1 is movy', flagValueLabel(tr, 1), 'MOVY');
    eq('2 defers to the set', flagValueLabel(tr, 2), 'NEW SETS');

    /* The page walks the visible list, so a hidden flag can never be selected
     * — a knob turn on a row a release build does not draw would change a
     * setting nobody can see. */
    resetFlagsPage();
    for (let i = 0; i < FLAGS.length + 5; i++) flagsPageJog(1);
    ok('the selection cannot leave the listed rows',
       flagsPageState.selected < visibleFlags().length);

    uninstallMockFs();
}

/* ── CPU Optimization is the master over the render flags ───────── */
{
    _log('\nCPU optimization gates the render flags');

    installMockFs();
    resetFlags();
    setFlag('chparallel', 1);
    setFlag('chidle', 3);
    setFlag('chlanes', 3);

    let sent = [];
    const sink = (k, v) => sent.push(k + '=' + v);
    const pushed = (k) => {
        for (const s of sent) if (s.indexOf(k + '=') === 0) return s;
        return '';
    };

    applyFlagsToEngine(sink);
    eq('with it on, parallel render goes out as set', pushed('chparallel'), 'chparallel=1');
    eq('and idle skip too', pushed('chidle'), 'chidle=3');
    ok('the master itself is never pushed — the engine has no such param',
       pushed('cpuopt') === '', sent.join(' '));

    /* Off is a full serial fallback, which is what makes it an escape hatch
     * worth shipping: a module that misbehaves under threading is not helped by
     * turning off half of it. */
    sent = [];
    setFlag('cpuopt', 0);
    eq('turning it off stops parallel render at the engine', pushed('chparallel'), 'chparallel=0');
    eq('and idle skip with it', pushed('chidle'), 'chidle=0');
    eq('while the hidden setting keeps its own value', flagValue('chparallel'), 1);
    eq('and so does idle skip', flagValue('chidle'), 3);

    sent = [];
    applyFlagsToEngine(sink);
    eq('a re-dlopened engine comes up serial too', pushed('chparallel'), 'chparallel=0');
    eq('with idle skip off', pushed('chidle'), 'chidle=0');
    eq('and lanes still sent — they are what the pool rebuilds at', pushed('chlanes'), 'chlanes=3');

    sent = [];
    setFlag('cpuopt', 1);
    eq('turning it back on restores parallel render', pushed('chparallel'), 'chparallel=1');
    eq('and idle skip', pushed('chidle'), 'chidle=3');

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

}
