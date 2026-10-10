/* browser-test/logic/sets.mjs — movy's own Set library (WP4): the `lib` wire,
 * name policy, the set source, the SETS page's gestures, and the library half
 * of the session's identity.
 *
 * The engine side (index, order, import, file moves) is cargo's to test; here
 * a small fake answers `set lib …` the way set_lib_jobs.rs does, so what is
 * asserted is what the UI SENDS and what it does with the answer.
 *
 * Run by browser-test/logic.mjs.
 */

import { eq, ok, _log } from './harness.mjs';

/* A fake library engine: the `lib` answer and the commands that change it. */
function fakeLib() {
    const st = { rev: 0, cur: '', made: '', sets: [], sent: [], next: 1, setsdir: null };
    const publish = (err = '') => {
        st.rev++;
        st.wire = `rev=${st.rev} cur=${st.cur || '-'} made=${st.made || '-'} err=${err || '-'}\n`
            + st.sets.map((s) => `${s.id}\t${s.clips}\t0\t${s.name}\n`).join('');
    };
    const set = (key, val) => {
        if (key === 'setsdir') { st.setsdir = val; return true; }
        if (key !== 'set' || !String(val).startsWith('lib ')) return true;
        const cmd = String(val).slice(4);
        st.sent.push(cmd);
        const [verb, ...rest] = cmd.split(' ');
        if (verb === 'new') { st.made = 'm' + st.next++; st.sets.unshift({ id: st.made, name: rest.join(' '), clips: 0 }); }
        if (verb === 'dup') {
            const i = st.sets.findIndex((s) => s.id === rest[0]);
            st.made = 'm' + st.next++;
            st.sets.splice(i + 1, 0, { id: st.made, name: rest.slice(1).join(' '), clips: st.sets[i].clips });
        }
        if (verb === 'rename') st.sets.find((s) => s.id === rest[0]).name = rest.slice(1).join(' ');
        if (verb === 'del') st.sets = st.sets.filter((s) => s.id !== rest[0]);
        publish();
        return true;
    };
    return { st, publish, get: (key) => (key === 'lib' ? (st.wire ?? '') : null), set };
}

function install(f) {
    const saved = [globalThis.host_module_get_param, globalThis.host_module_set_param,
                   globalThis.host_module_set_param_blocking];
    globalThis.host_module_get_param = f.get;
    globalThis.host_module_set_param = f.set;
    globalThis.host_module_set_param_blocking = f.set;
    return () => {
        [globalThis.host_module_get_param, globalThis.host_module_set_param,
         globalThis.host_module_set_param_blocking] = saved;
    };
}

export async function run() {
    const lib = await import('../../dist/esm/seq/sets-lib.js');
    const src = await import('../../dist/esm/seq/set-source.js');
    const vmm = await import('../../dist/esm/seq/sets-page-vm.js');
    const page = await import('../../dist/esm/seq/sets-page.js');
    const ls = await import('../../dist/esm/seq/set-lib-session.js');
    const { setFlag } = await import('../../dist/esm/seq/flags.js');
    const { appState, VIEW_SETS, VIEW_CHAIN } = await import('../../dist/esm/app/state.js');

{
    _log('\nset library wire:');
    const p = lib.parseLib('rev=4 cur=m1 made=m2 err=-\nm2\t3\t1\tMy  Set\tTabbed\nm1\t0\t0\tA\n');
    eq('rev', p.rev, 4);
    eq('cur', p.cur, 'm1');
    eq('made', p.made, 'm2');
    eq('dash err is empty', p.err, '');
    eq('rows in order', p.rows.map((r) => r.id).join(','), 'm2,m1');
    eq('a name keeps its spaces', p.rows[0].name, 'My  Set\tTabbed');
    eq('clips', p.rows[0].clips, 3);
    eq('no rev is no answer', lib.parseLib('cur=x'), null);
    eq('empty is no answer', lib.parseLib(''), null);
    eq('a library with no Sets', lib.parseLib('rev=1 cur=- made=- err=-\n').rows.length, 0);
}

{
    _log('\nset names:');
    const d = new Date(2027, 5, 1, 12);
    eq('first of the day', lib.defaultSetName(d, []), '2027-06-01_01');
    eq('one past the HIGHEST suffix, not the count',
       lib.defaultSetName(d, [{ name: '2027-06-01_03' }, { name: '2027-06-01_01' }]), '2027-06-01_04');
    eq('another day does not count', lib.defaultSetName(d, [{ name: '2027-05-31_07' }]), '2027-06-01_01');
    eq('a copy', lib.dupName('Song'), 'Song Copy');
    const long = 'x'.repeat(60);
    eq('a long copy keeps its suffix', lib.dupName(long).endsWith(' Copy'), true);
    eq('and fits the engine limit', lib.dupName(long).length <= lib.NAME_MAX, true);
}

{
    _log('\nset source:');
    setFlag('setsrc', 0);
    src.latchSetSource();
    eq('Move mode: the legacy tree', src.setsDir(), src.LEGACY_SETS_DIR);
    setFlag('setsrc', 1);
    eq('a flip mid-session waits for the next open', src.setsDir(), src.LEGACY_SETS_DIR);
    src.latchSetSource();
    eq('library mode', src.setsDir(), '/data/UserData/UserLibrary/Movy/Sets');
    ok('library mode reported', src.setSourceMovy());
}

{
    _log('\nsets page view model:');
    const rows = [{ id: 'a', clips: 2, depth: 0, name: 'Alpha' }, { id: 'b', clips: 0, depth: 0, name: 'Beta' }];
    const vm = vmm.buildSetsPageVM(true, rows, 'b', 9, false);
    eq('[NEW] first', vm.rows[0].name, vmm.NEW_ROW);
    eq('selection clamps to the list', vm.selected, 2);
    eq('the open Set is marked', vm.rows.map((r) => r.current).join(','), 'false,false,true');
    eq('clip counts', vm.rows[1].clips, '2');
    eq('confirm names the Set', vmm.buildSetsPageVM(true, rows, 'b', 1, true).confirm, 'DELETE ALPHA?');
    eq('no confirm on [NEW]', vmm.buildSetsPageVM(true, rows, 'b', 0, true).confirm, null);
    eq('Move mode', vmm.buildSetsPageVM(false, rows, 'b', 0, false).mode, 'move');
    eq('before the first answer', vmm.buildSetsPageVM(true, null, '', 0, false).mode, 'loading');
}

{
    _log('\nsets page gestures:');
    const f = fakeLib();
    const restore = install(f);
    setFlag('setsrc', 1);
    src.latchSetSource();
    lib.resetLib();
    ls.resetLibSession();
    f.st.sets = [{ id: 'b', name: 'Beta', clips: 1 }, { id: 'a', name: 'Alpha', clips: 0 }];
    f.st.cur = 'a';
    f.publish();
    const tick = (n = 20) => { for (let i = 0; i < n; i++) page.setsPageTick(); };

    appState.currentView = VIEW_CHAIN;
    page.openSetsPage('a');
    eq('opens on the open Set', page.setsPageState.selected, 2);
    eq('is a screen', appState.currentView, VIEW_SETS);

    page.setsPageJog(-1, false);
    page.setsPageJog(-1, false);
    page.setsPageJog(-1, false);
    eq('jog stops at [NEW]', page.setsPageState.selected, 0);
    page.setsPageClick('a');
    ok('[NEW] sends a dated name', /^new \d{4}-\d\d-\d\d_01$/.test(f.st.sent.at(-1)), f.st.sent.at(-1));
    tick();
    eq('focus follows the Set just made', lib.libState().rows[page.setsPageState.selected - 1].id, f.st.made);

    page.setsPageButton('copy');
    eq('copy names a Copy', f.st.sent.at(-1), `dup ${f.st.sets[0].id} ${f.st.sets[0].name} Copy`);
    tick();
    eq('focus follows the copy', lib.libState().rows[page.setsPageState.selected - 1].id, f.st.made);

    page.setsPageButton('capture');
    ok('capture opens the keyboard with the name', globalThis.__textEntryLast?.initialText?.endsWith(' Copy'));
    globalThis.__textEntryConfirm('Renamed');
    ok('confirm renames', f.st.sent.at(-1).startsWith('rename ') && f.st.sent.at(-1).endsWith(' Renamed'));
    const before = f.st.sent.length;
    page.setsPageButton('capture');
    globalThis.__textEntryConfirm('  ');
    eq('an empty name renames nothing', f.st.sent.length, before);

    /* Delete a Set that is not open: arm, the jog is the confirm's, click. */
    tick();
    const victim = lib.libState().rows[page.setsPageState.selected - 1].id;
    page.setsPageButton('delete');
    ok('delete arms', page.setsPageState.confirming);
    const sel = page.setsPageState.selected;
    page.setsPageJog(1, false);
    eq('the confirm owns the jog', page.setsPageState.selected, sel);
    page.setsPageClick('a');
    eq('the click deletes', f.st.sent.at(-1), 'del ' + victim);

    /* Buttons on [NEW] do nothing. */
    page.setsPageState.selected = 0;
    const n0 = f.st.sent.length;
    page.setsPageButton('copy'); page.setsPageButton('delete');
    eq('nothing on [NEW]', [f.st.sent.length, page.setsPageState.confirming].join(), `${n0},false`);

    /* Open another Set: wanted, and the page closes. */
    tick();
    const bRow = lib.libState().rows.findIndex((r) => r.id === 'b');
    page.setsPageState.selected = bRow + 1;
    ok('a click on a Set closes', page.setsPageClick('a'));
    eq('and wants it', src.wantedSet(), 'b');
    eq('back where we came from', appState.currentView, VIEW_CHAIN);

    /* Delete the OPEN Set: switch first, delete once the session has left. */
    page.openSetsPage('b');
    page.setsPageButton('delete');
    page.setsPageClick('b');
    ok('the open Set is not deleted yet', !f.st.sent.at(-1).startsWith('del b'));
    ok('a neighbour is wanted', src.wantedSet() !== 'b');
    ls.libraryTick('b', true);
    ok('still open: still not deleted', !f.st.sent.includes('del b'));
    ls.libraryTick(src.wantedSet(), true);
    eq('deleted once left', f.st.sent.at(-1), 'del b');

    /* The ONLY Set: a replacement is made first. */
    f.st.sets = [{ id: 'z', name: 'Only', clips: 0 }];
    f.publish();
    page.openSetsPage('z');
    tick();
    page.setsPageButton('delete');
    page.setsPageClick('z');
    ok('a new Set is made first', f.st.sent.at(-1).startsWith('new '));
    tick();
    eq('which becomes the wanted Set', src.wantedSet(), f.st.made);
    ls.libraryTick(f.st.made, true);
    eq('and then the old one goes', f.st.sent.at(-1), 'del z');
    restore();
}

{
    _log('\nno schwung track migration in library mode:');
    const mig = await import('../../dist/esm/track/migrate.js');
    setFlag('setsrc', 1);
    src.latchSetSource();
    /* A blank Set (no ui blob) is what arms the probe in Move mode. */
    mig.beginMigration(null, undefined, []);
    ok('a new library Set never probes schwung\'s slots', !mig.migrationPending());
    setFlag('setsrc', 0);
    src.latchSetSource();
    mig.beginMigration(null, undefined, []);
    ok('Move mode still does', mig.migrationPending());
    mig.abandonMigration();
}

{
    _log('\nlibrary session identity:');
    const f = fakeLib();
    const restore = install(f);
    setFlag('setsrc', 1);
    src.latchSetSource();
    lib.resetLib();
    ls.resetLibSession();
    eq('nothing until the library answers', ls.libraryIdentity(), null);
    eq('the import goes out first', f.st.sent[0].split(' ')[0], 'import');
    eq('pointed at the library', f.st.setsdir, '/data/UserData/UserLibrary/Movy/Sets');
    f.publish();   // the import's answer: an empty library
    /* The fake answers synchronously; the engine a few ticks later — either
     * way the Set opened is the one the `new` made. */
    const first = ls.libraryIdentity();
    ok('an empty library makes its first Set, named for today',
       /^new \d{4}-\d\d-\d\d_01$/.test(f.st.sent.at(-1)), f.st.sent.at(-1));
    const id = first ?? ls.libraryIdentity();
    eq('and opens it', id && id.uuid, f.st.made);
    eq('one import per engine generation', f.st.sent.filter((c) => c.startsWith('import')).length, 1);

    /* A library with a last-open Set reopens it. */
    src.latchSetSource();
    lib.resetLib();
    ls.resetLibSession();
    f.st.sets = [{ id: 'n', name: 'N', clips: 0 }, { id: 'o', name: 'O', clips: 0 }];
    f.st.cur = 'o';
    f.publish();
    eq('last-open reopens', ls.libraryIdentity()?.uuid, 'o');
    setFlag('setsrc', 0);
    src.latchSetSource();
    restore();
}
}
