/* Migrated from scripts/test-versions.sh — a set written by an EARLIER movy
 * keeps its work when this build opens it, and a version can be restored from
 * the device.
 *
 * The local suites prove the logic against captured files. This proves the two
 * things they cannot: that a real device opening a real pre-feature set adopts
 * it WITHOUT touching the state, and that a restore driven by the actual
 * gestures puts the clips back.
 *
 * WHAT CHANGED BEYOND THE MECHANICS:
 *   - `versions: restored` was a LOG grep (rule 5). It is now a STATE read: the
 *     restore is itself undoable, so restoreVersion captures the pre-restore
 *     state with why='pre-restore' BEFORE it writes the restored bytes, and that
 *     index entry is the direct trace that the gesture reached the page and ran.
 *     A grep for a line the source emits is replaced by a read of the file the
 *     source writes.
 *   - the "clips came out of the engine" check (bash 8) read the canonical file
 *     after the autosave, on the theory that the autosave rewrites what
 *     `host_module_get_param('state')` returns. That autosave only fires when the
 *     engine is dirty, and a clean reload leaves it clean — so the bash check was
 *     weaker than its comment claims. This reads the SAME file (the canonical
 *     state is the one thing that must hold the clips), and its teeth are proved
 *     by mutation: a restore that writes a blank fails it while every other
 *     check stays green.
 *   - the clip deletion is a blocking PRECONDITION, not merely a scored check:
 *     the bash's own comment says the rest of the suite proves nothing if it did
 *     not land, so a failure here aborts rather than letting the restore checks
 *     run on a set that was never modified.
 *
 * Covers:
 *   C1 opening an old-format set writes the versions index
 *   C2 …and adopts the set's own files into it
 *   C3 …and copies them out of the rotation into v/
 *   C4 …without modifying the state it adopted
 *   C5 …and the clips survived the open
 *   C6 a clip deletion through the engine reached disk (blocking)
 *   C7 a restore through the real gestures ran
 *   C8 …and the restored clips came back
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scenario } from '../runner.js';
import { Device } from '../device.js';
import { Probe } from '../probe.js';
import * as fixture from '../fixture.js';
import { until } from '../wait.js';

const run = promisify(execFile);
/* test-device/dist/scenarios/versions.js at run time. */
const MOVY = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const SETS = '/data/UserData/schwung/modules/tools/movy/sets';
const OLD = join(MOVY, 'browser-test', 'fixtures', 'old-sets', 'movy-chains');

/* Shift is CC 49 (schwung: "49 (shift)"). movy has no constant for it in
 * test-device/midi.ts because nothing else here drives it. */
const CC_SHIFT = 49;
/* Settings is Shift+Step 2; step buttons are notes 16..31, STEP_FLAGS = 1. */
const STEP_FLAGS_NOTE = 17;

/* Frames of device work, never a wall clock (~2.9 ms/frame). */
const ACT = 90;    // after a gesture, for movy to have noticed it
/* Between the jog detents that scroll to the bottom of the Settings list. The
 * bash spaced them 0.02 s apart inside one batched send; 7 frames is the same
 * spacing stated as device work. Wider is pointless — flagsPageJog is a counter
 * increment — and tighter risks overrunning the ui-MIDI ring. */
const JOG = 7;

/* An ssh read costs ~350 ms of real time and is out of band, so these waits are
 * a handful of polls rather than the bash's flat 2 s sleeps. */
const SAVE_WAIT = { within: 15000, every: 600 };   // autosave is tick-based, ~8 s of device time
const RESTORE_WAIT = { within: 8000, every: 400 };

scenario('versions', async (t) => {
    fixture.setHost(t.host);
    const dev = new Device(t.bus, t.agent, t.host);
    const probe = new Probe(t.bus);
    const open = () => dev.open(probe);
    const close = () => dev.close(probe);

    const ssh = async (cmd: string): Promise<string> => {
        const { stdout } = await run('ssh', ['-o', 'ConnectTimeout=8', '-o', 'BatchMode=yes',
            `ableton@${t.host}`, cmd], { maxBuffer: 16 * 1024 * 1024 });
        return stdout;
    };
    /* Movy's saves go through the host, which runs as ROOT, so the version store
     * it leaves behind is root-owned DIRECTORY trees the ableton user cannot
     * unlink inside. Clearing it is the one fixture step that can need root. */
    const sshRoot = async (cmd: string): Promise<string> => {
        const { stdout } = await run('ssh', ['-o', 'ConnectTimeout=8', '-o', 'BatchMode=yes',
            `root@${t.host}`, cmd], { maxBuffer: 16 * 1024 * 1024 });
        return stdout;
    };
    const scpTo = async (local: string, remote: string): Promise<void> => {
        await run('scp', ['-q', '-o', 'ConnectTimeout=8', '-o', 'BatchMode=yes',
            local, `ableton@${t.host}:${remote}`]);
    };

    /* Movy is closed when ensure() returns (verifyChains opens and closes it),
     * which is exactly when the pre-feature files may be seeded: a running tool
     * autosaves over them within seconds. ensure() has also run movy once, so a
     * root-owned versions.json + v/ from its own open/close are in the way. */
    await fixture.ensure(t.bus, open, close);
    await dev.deployUi();

    const uuid = (await fixture.activeUuid()).trim();
    if (!uuid) throw new Error('scenario: no active set uuid');
    const D = `${SETS}/${uuid}`;
    t.note('uuid', uuid);
    t.note('setDir', D);

    /* A previous run's version store must go or adoption cannot be observed: the
     * set would already have a history and the "adopted" entry would never
     * appear. Try as ableton first — on a set movy has not versioned, v/ does
     * not exist and no root is needed — and fall back to root. The state files
     * are cleared too, because scp OPENS THE DESTINATION FOR WRITING and is
     * refused on a root-owned file however writable the directory is. */
    const clear = `rm -rf '${D}/v' '${D}/versions.json' '${D}/seq-state.json' ` +
        `'${D}/seq-state.1.json' '${D}/seq-state.2.json' '${D}/ui-state.json'`;
    try {
        await ssh(clear);
    } catch {
        try { await sshRoot(clear); }
        catch (e) { throw new Error('scenario: cannot clear ' + D + ' — movy writes it as root and root ssh is unavailable'); }
    }
    /* The old set goes to the canonical file AND its first shadow, so a stale
     * higher-generation copy can never outrank the seed (readBestState picks the
     * highest gen). The second shadow is left absent, not seeded. */
    await scpTo(join(OLD, 'seq-state.json'), `${D}/seq-state.json`);
    await scpTo(join(OLD, 'seq-state.json'), `${D}/seq-state.1.json`);
    await scpTo(join(OLD, 'ui-state.json'), `${D}/ui-state.json`);

    const md5 = async () => (await ssh(`md5sum '${D}/seq-state.json' | cut -d' ' -f1`)).trim();
    /* The canonical state file's clip count. This is the one thing the bash's
     * `clips_now` read, and the one thing that must hold the clips after both an
     * open and a restore. */
    const clipsNow = async (): Promise<number> => {
        const out = await ssh(`grep -c '^cl ' '${D}/seq-state.json' 2>/dev/null || echo 0`);
        return parseInt(out.trim(), 10) || 0;
    };
    /* The versions index, parsed. Null while it is absent or torn mid-write —
     * both ordinary on the way to a capture, and neither is a failure of the
     * write (safeWrite verifies its own bytes, so a torn read is only ever a
     * reader racing a writer, which a retry clears). */
    const versionsJson = async (): Promise<any> => {
        try { return JSON.parse(await ssh(`cat '${D}/versions.json' 2>/dev/null || true`)); }
        catch { return null; }
    };

    const before = await md5();
    t.note('md5Before', before);

    /* The unified log must be on for dev.open() to wait on movy's own "set
     * ready" line rather than its quiet-window fallback. Idempotent. */
    await ssh('touch /data/UserData/schwung/debug_log_on');
    await dev.open(probe);

    // ── 1. Opening adopts, and does not disturb what it adopted ──────────────
    const idx = await versionsJson();
    t.note('indexAfterOpen', idx);
    t.check('versions-index-created', 'versions.json created',
        !!idx && typeof idx === 'object' && Array.isArray(idx.v),
        { expected: 'versions.json present and parseable',
          actual: idx ? JSON.stringify(idx) : 'no versions.json — nothing was captured' });
    t.check('old-files-adopted', "the old set's own files were adopted",
        !!idx && Array.isArray(idx.v) && idx.v.some((r: any) => r && r.why === 'adopted'),
        { expected: 'an index entry with why=adopted',
          actual: idx ? JSON.stringify(idx.v) : 'no index' });

    const vDir = (await ssh(`test -d '${D}/v' && echo yes || echo no`).then((s) => s.trim() === 'yes')
        .catch(() => false));
    t.check('copied-into-v', 'and copied out of the rotation into v/', vDir,
        { expected: 'v/ directory exists', actual: vDir ? 'v/ present' : 'no v/ directory' });

    const after = await md5();
    t.check('adoption-did-not-modify', 'adoption did not modify the state it adopted',
        before === after, { expected: before, actual: after });

    const have = await clipsNow();
    t.check('old-set-has-clips', `the old set opened with ${have} clip(s)`, have >= 1,
        { expected: '>=1 clip', actual: `${have} clip(s)` });

    // ── 2. Wipe a clip through the engine, and let the autosave carry it ─────
    await dev.param.set('overtake_dsp:cmd', 'clipdel 0');
    let landed = false;
    try {
        await until(t.bus, 'the deletion to reach disk', clipsNow,
            (n) => n < have, SAVE_WAIT);
        landed = true;
    } catch { landed = false; }
    t.check('deletion-landed', 'the deletion reached disk (fewer clips than before)', landed,
        { expected: `< ${have} clips`, actual: `${await clipsNow()} clip(s)` });
    /* The rest of the suite proves nothing on a set that was never modified, so
     * this is a gate, not merely a score — the same shape the bash's own comment
     * demands. */
    if (!landed) throw new Error('scenario: the clip deletion never landed — the rest of this suite proves nothing');

    // ── 3. Restore it back, through the real gestures ────────────────────────
    /* Shift+Step 2 opens Settings. Then jog down far enough to CLAMP on the last
     * row — MIGRATE TRACKS, the last action row — and back up one to BACKUPS.
     * Clamping first is what makes this independent of how many flags the build
     * shows. Then three clicks: open the page, arm the confirm on the newest
     * version, perform the restore. */
    await dev.holdCc(CC_SHIFT, async () => { await dev.tap.note(STEP_FLAGS_NOTE, 127); });
    await t.bus.frames(ACT);
    for (let i = 0; i < 40; i++) { await dev.tap.jogTurn(1); await t.bus.frames(JOG); }
    await dev.tap.jogTurn(-1); await t.bus.frames(ACT);   // back up onto BACKUPS
    await dev.tap.jog(); await t.bus.frames(ACT);          // open BACKUPS
    await dev.tap.jog(); await t.bus.frames(ACT);          // arm the confirm
    await dev.tap.jog(); await t.bus.frames(ACT);          // restore

    /* A restore is itself undoable, so it captures the pre-restore state first —
     * unconditionally (the `always` set in version-capture). That entry is the
     * trace that the gesture reached the page and ran, read as state rather than
     * grepped out of the log. */
    let restoreRecorded = false;
    try {
        await until(t.bus, 'the restore to be recorded', async () => {
            const v = await versionsJson();
            return !!(v && Array.isArray(v.v) && v.v.some((r: any) => r && r.why === 'pre-restore'));
        }, (b) => b === true, RESTORE_WAIT);
        restoreRecorded = true;
    } catch { restoreRecorded = false; }
    const idxAfterRestore = await versionsJson();
    t.note('indexAfterRestore', idxAfterRestore);
    t.check('restore-ran', 'the restore ran', restoreRecorded,
        { expected: 'an index entry with why=pre-restore',
          actual: idxAfterRestore ? JSON.stringify(idxAfterRestore.v) : 'no index' });

    /* The canonical file must hold the clips again. If the restore wrote only the
     * disk and never reached the engine, the next autosave would write the
     * engine's still-deleted state back over it — so waiting across the save
     * cadence, rather than reading once, is what tells the two apart. */
    let clipsBack = 0;
    try {
        clipsBack = await until(t.bus, 'the restored clips to come back', clipsNow,
            (n) => n >= have, SAVE_WAIT);
    } catch { clipsBack = await clipsNow(); }
    t.check('restored-clips-reach-engine', 'the restored clips are what the engine holds',
        clipsBack >= have,
        { expected: `>= ${have} clip(s)`, actual: `${clipsBack} clip(s)` });
});
