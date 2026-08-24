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
        eq(`${f.key} starts at its default`, flagValue(f.key), f.def);
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
    for (const f of FLAGS) {
        ok(`${f.key} is pushed on an engine boot`,
           sent.some((s) => s.indexOf(f.key + '=') === 0), sent.join(' '));
    }
    eq('every flag exactly once, plus the blacklist', sent.length, FLAGS.length + 1);
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
    eq('and so is the bottom', flagsPageState.selected, FLAGS.length - 1);

    /* Knob 1 edits whatever the jog selected — that is the whole interaction,
     * and it is what lets the list grow past eight entries. */
    flagsPageState.selected = FLAGS.findIndex((f) => f.key === 'chlanes');
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
    flagsPageState.selected = FLAGS.findIndex((f) => f.key === 'chparallel');
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
    eq('one row per flag', vm.rows.length, FLAGS.length);
    eq('the name column is the readable name', vm.rows[0].name, FLAGS[0].name);
    eq('exactly one row is selected', vm.rows.filter((r) => r.selected).length, 1);
    ok('a bool flag shows ON/OFF',
        vm.rows.some((r) => r.value === 'ON' || r.value === 'OFF'));
    ok('a numeric flag shows its number', vm.rows.some((r) => r.value === '4'));

    /* The LED carries the value AND says which knob is live — it is the only
     * lit one. A flat brightness would leave the page mute about both. */
    flagsPageState.selected = FLAGS.findIndex((f) => f.key === 'chlanes');
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
     * the constant exists and is the one the tests are running under. The
     * release side is guarded where it matters — scripts/build-module.sh greps
     * the built ui.js for a flag name and fails the release if it is there,
     * which is the only check that can catch a `define` that stopped applying. */
    eq('the browser tests run with the debug surfaces compiled in', DEBUG_BUILD, true);
}

}
