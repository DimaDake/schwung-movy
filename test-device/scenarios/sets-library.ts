/* New with WP4 — movy's own Set library, on a real Move.
 *
 * The local suites cover the page's gestures against a fake engine and cargo
 * covers the index, the order and the import against a tmpdir. What only the
 * device can show: the import reads the REAL legacy tree and Move's REAL Set
 * folders and leaves both byte-identical; the engine writes the library from
 * Move's audio process; the session opens, switches and reopens library Sets
 * through the real lifecycle; and the hardware buttons reach the page.
 *
 * The library is seeded DIRECTLY (plan goal 8): no `set_state/<uuid>`, no Move
 * Set materialisation, no stack restart. `setsrc` is pinned in prefs.json with
 * movy closed, and everything — prefs, the library, the seeded legacy Set — is
 * put back afterwards. A library already on the box is moved aside, not lost.
 *
 * Covers:
 *   S1 the import copied the fixture's Set and the seeded one into the library
 *   S2 …named the fixture's Set from Move's own folder
 *   S3 …and left the legacy files byte-identical
 *   S4 the session opened a library Set
 *   S5 Shift+Step 1 + [NEW] made a Set (on disk in the index)
 *   S6 Copy duplicated it, recorded as its child
 *   S7 Delete + confirm moved the copy to Trash
 *   S8 a rename through the engine reached the index
 *   S9 jog-click opened the new Set
 *   S10 reopening movy reopens the last-open Set
 */
import { scenario } from '../runner.js';
import { Device } from '../device.js';
import { Probe } from '../probe.js';
import * as fixture from '../fixture.js';
import { until } from '../wait.js';
import { guardPrefs, writePrefs } from '../prefs-guard.js';
import { STEP_NOTE_BASE, CC_DELETE } from '../midi.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SSH_OPTS } from '../ssh.js';

const run = promisify(execFile);
const ROOT = '/data/UserData/UserLibrary/Movy';
const LEGACY = '/data/UserData/schwung/modules/tools/movy/sets';
const MOVE_SETS = '/data/UserData/UserLibrary/Sets';
const SEEDED = 'wp4-device-legacy';
const CC_SHIFT = 49;
const CC_COPY = 60;
const ACT = 90;   // frames for movy to notice a gesture (~2.9 ms each)
const LIB_WAIT = { within: 8000, every: 300 };

/* The library as the engine wrote it. Read from DISK, not from the `lib` param:
 * that answer is multi-line and testd's GET_PARAM is a line protocol, so the
 * harness would see its header alone. The file is the durable truth anyway. */
interface Entry { id: string; name: string; parent?: string; clips: number; }
interface Index { current: string; imported: string[]; sets: Entry[]; }

scenario('sets-library', async (t) => {
    fixture.setHost(t.host);
    const dev = new Device(t.bus, t.agent, t.host);
    const probe = new Probe(t.bus);
    const open = () => dev.open(probe);
    const close = () => dev.close(probe);
    /* The engine writes the library as root from Move's audio process, so
     * clearing it can need root; reads and seeds are ableton's. */
    const root = async (cmd: string): Promise<string> =>
        (await run('ssh', [...SSH_OPTS, `root@${t.host}`, cmd], { maxBuffer: 8 << 20 })).stdout;

    await fixture.ensure(t.bus, open, close);
    await dev.deployUi();
    const uuid = (await fixture.activeUuid()).trim();
    if (!uuid) throw new Error('sets-library: no active set uuid');
    const moveName = (await root(`ls '${MOVE_SETS}/${uuid}'`)).trim().split('\n')[0];

    /* Teardown first, so a failure anywhere below still puts the box back. */
    const prefs = await guardPrefs(t, 'sets-library');
    const aside = `${ROOT}.pre-wp4-test`;
    await root(`rm -rf '${aside}'; if [ -d '${ROOT}' ]; then mv '${ROOT}' '${aside}'; fi`);
    t.need.register(async () => {
        await root(`rm -rf '${ROOT}' '${LEGACY}/${SEEDED}'; if [ -d '${aside}' ]; then mv '${aside}' '${ROOT}'; fi`);
    });
    /* Registered LAST so it runs FIRST: a movy still open in library mode
     * autosaves the open Set straight back into the library the line above
     * just removed (seen on device, after a run that threw mid-way). */
    t.need.register(async () => { try { await close(); } catch { /* already closed */ } });

    /* A second legacy Set with no Move folder: named by the date fallback. */
    await root(`mkdir -p '${LEGACY}/${SEEDED}' && cp '${LEGACY}/${uuid}/seq-state.json' '${LEGACY}/${SEEDED}/' `
             + `&& chown -R ableton:users '${LEGACY}/${SEEDED}'`);
    const md5 = () => root(`cd '${LEGACY}' && md5sum ${uuid}/* ${SEEDED}/* 2>/dev/null | sort`);
    const legacyBefore = await md5();

    const p = prefs.trim() ? JSON.parse(prefs) : {};
    p.flags = { ...(p.flags ?? {}), setsrc: 1 };
    await writePrefs(t.host, JSON.stringify(p));

    const index = async (): Promise<Index | null> => {
        try { return JSON.parse(await root(`cat '${ROOT}/library.json'`)); } catch { return null; }
    };
    const libUntil = async (ok: (l: Index) => boolean, what: string): Promise<Index | null> => {
        try { return await until(t.bus, what, index, (l) => !!l && ok(l), LIB_WAIT); }
        catch { return await index(); }
    };
    /* The Set a command made: the one id that was not there before. */
    const madeSince = (before: Index | null, after: Index | null): string =>
        after?.sets.find((e) => !before?.sets.some((b) => b.id === e.id))?.id ?? '';
    const openUuid = async () => {
        try { return (/(?:^| )uuid=(\S*)/.exec(await dev.param.get('overtake_dsp:set')) ?? [])[1] ?? ''; }
        catch { return ''; }
    };

    await open();

    // ── Import ────────────────────────────────────────────────────────────
    const idx = await libUntil((l) => [uuid, SEEDED].every((u) => l.imported.includes(u)), 'the import');
    t.note('libraryAfterImport', idx);
    t.check('imported-both', 'the import copied both legacy Sets',
        !!idx && [uuid, SEEDED].every((u) => idx.imported?.includes(u)),
        { expected: `${uuid}, ${SEEDED} imported`, actual: JSON.stringify(idx?.imported) });
    const fixRow = idx?.sets.find((r) => r.id === uuid);
    t.check('named-from-move', "the fixture's Set kept Move's name", fixRow?.name === moveName,
        { expected: moveName, actual: fixRow?.name ?? '(missing)' });
    t.check('legacy-untouched', 'the legacy files are byte-identical', (await md5()) === legacyBefore,
        { expected: 'same md5s', actual: 'changed' });
    const opened = await openUuid();
    t.check('opened-library-set', 'the session opened a library Set',
        !!idx && idx.sets.some((r) => r.id === opened),
        { expected: 'an id from the library', actual: opened });

    // ── The page: [NEW], Copy, Delete ─────────────────────────────────────
    await dev.holdCc(CC_SHIFT, async () => { await dev.tap.note(STEP_NOTE_BASE, 127); });
    await t.bus.frames(ACT);
    for (let i = 0; i < 12; i++) { await dev.tap.jogTurn(-1); await t.bus.frames(7); }
    await dev.tap.jog();   // [NEW]
    const made = await libUntil((l) => l.sets.length > (idx?.sets.length ?? 0), 'a new Set');
    const newId = madeSince(idx, made);
    t.check('new-made', '[NEW] made a Set', !!newId,
        { expected: 'a new id in library.json', actual: JSON.stringify(made?.sets.map((e) => e.name)) });

    await t.bus.frames(ACT);
    await dev.tap.cc(CC_COPY);
    const dup = await libUntil((l) => l.sets.length > (made?.sets.length ?? 0), 'a copy');
    const copyId = madeSince(made, dup);
    const copyEntry = dup?.sets.find((s) => s.id === copyId);
    t.check('copy-made', 'Copy duplicated the Set under the cursor', copyEntry?.parent === newId,
        { expected: `parent ${newId}`, actual: JSON.stringify(copyEntry ?? null) });

    await t.bus.frames(ACT);           // the cursor follows the copy
    await dev.tap.cc(CC_DELETE);
    await t.bus.frames(ACT);
    await dev.tap.jog();               // confirm
    const gone = await libUntil((l) => !l.sets.some((r) => r.id === copyId), 'the copy to go');
    const trashed = (await root(`ls '${ROOT}/Trash' 2>/dev/null || true`)).includes(copyId);
    t.check('copy-deleted', 'Delete + confirm removed the copy',
        !!copyId && !!gone && !gone.sets.some((r) => r.id === copyId),
        { expected: `${copyId} gone`, actual: gone ? gone.sets.map((r) => r.id).join(',') : 'no index' });
    t.note('copyInTrash', trashed);   // a blank copy has no folder to move

    // ── Rename (engine path; typing is the keyboard's and logic-tested) ───
    await dev.param.set('overtake_dsp:set', `lib rename ${newId} WP4 Device`);
    const renamed = await libUntil((l) => l.sets.some((r) => r.id === newId && r.name === 'WP4 Device'), 'rename');
    t.check('renamed', 'a rename reached the library',
        !!renamed?.sets.some((r) => r.id === newId && r.name === 'WP4 Device'),
        { expected: 'WP4 Device', actual: renamed?.sets.find((r) => r.id === newId)?.name ?? '(missing)' });

    // ── Open the new Set, then reopen movy ────────────────────────────────
    await dev.holdCc(CC_SHIFT, async () => { await dev.tap.note(STEP_NOTE_BASE, 127); });
    await t.bus.frames(ACT);
    /* Display order is the engine's (newest first, copies after their source);
     * the new Set is the newest root, so it is the first Set row. */
    const at = 1;   // row 0 is [NEW]
    for (let i = 0; i < 12; i++) { await dev.tap.jogTurn(-1); await t.bus.frames(7); }
    for (let i = 0; i < at; i++) { await dev.tap.jogTurn(1); await t.bus.frames(7); }
    await dev.tap.jog();
    let nowOpen = '';
    try { nowOpen = await until(t.bus, 'the switch', openUuid, (u) => u === newId, LIB_WAIT); }
    catch { nowOpen = await openUuid(); }
    t.check('opened-new', 'jog-click opened the Set', nowOpen === newId, { expected: newId, actual: nowOpen });

    await close();
    await open();
    let reopened = '';
    try { reopened = await until(t.bus, 'the reopen', openUuid, (u) => u === newId, LIB_WAIT); }
    catch { reopened = await openUuid(); }
    t.check('reopens-last', 'reopening movy reopens the last-open Set', reopened === newId,
        { expected: newId, actual: reopened });
    await close();
});
