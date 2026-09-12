/* Migrated from scripts/test-migrate.sh — tracks 1-4 come out of schwung's
 * slots and into movy's chains, once per set.
 *
 * The local suite (browser-test/logic/track-migrate.mjs) proves the migration's
 * RULES against mock params. This proves the two things it cannot: that the
 * keys the migration reads are keys a REAL schwung still answers under those
 * exact spellings, and that a migrated track arrives with the PATCH the user
 * had rather than the module's factory defaults.
 *
 * WHAT CHANGED BEYOND THE MECHANICS:
 *   - the bash's four fixed sleeps (12 + 8 + 8 + 12 s, 40 s of its 110) are
 *     `until` waits on the file or the log line each one was standing in for.
 *   - C5 was DECORATIVE, in two separate ways, and both are fixed:
 *       (a) it grepped ui-state.json for the BARE string `VA VCF`. Its other arm
 *           — the keyed `"engine":"VA VCF"` — cannot match there: the preset blob
 *           is a JSON string INSIDE the JSON, so every quote in it is escaped
 *           (\\"engine\\":\\"VA VCF\\"). Only the bare arm could ever fire. On this
 *           device `engpersist` is 1, so `chains.json` is the AUTHORITY for
 *           movy's chains and it stores the blob as RAW BYTES (spec §6.1) — the
 *           keyed form matches there, unescaped. The check reads the authority.
 *       (b) the fixture's slot-0 patch IS the module's factory defaults (every
 *           entry 0.5 or 0), so no value in it can tell a CARRIED patch from a
 *           module that was merely loaded. Measured: with `readSlotChain`'s
 *           preset read deleted the check still passed. The arm now writes one
 *           param off its default and asserts on THAT value.
 *   - C7 grepped for the `chains` KEY, which `"chains":[]` satisfies. Measured:
 *     with the serialized array forced empty, bash's form passes and this one
 *     fails. An array that carries nothing is not a set that carries its chains.
 *   - the legacy seed also unlinks `chains.json`. The bash left the previous
 *     run's AUTHORITY in place and only blanked the mirror, so "the set carries
 *     the patch" could be satisfied by what an earlier run left behind. This is
 *     the same hazard `fixture.ts` fixed for the fixture itself (commit 800ceb6).
 *   - a `close()` guarded on overtake_mode. `fixture.ensure` hands movy back
 *     SHUT, and the leave modal is read through the probe — a param SET the host
 *     refuses when no instance is loaded.
 *
 * Covers:
 *   C1  the fixture's synth really is in slot 0 — the canary for every key below
 *   C2  schwung still answers `slot:volume`, another key the migration reads
 *   C3  a legacy set adopts the schwung rack
 *   C4  and the adopted track's chain holds the instrument
 *   C5  carrying the slot's own patch, not the module's factory defaults
 *   C6  and the set is marked migrated
 *   C7  and the saved set carries its chains
 *   C8  the schwung slot is never cleared — a migration is not data loss
 *   C9  a migrated set does not re-migrate
 *   C10 an empty rack reads as nothing to migrate, not as a failure
 *   C11 the manual Settings row re-runs it
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scenario } from '../runner.js';
import { Device } from '../device.js';
import { Probe } from '../probe.js';
import * as fixture from '../fixture.js';
import { until } from '../wait.js';

const run = promisify(execFile);
/* test-device/dist/scenarios/migrate.js at run time. */
const MOVY = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const SETS = '/data/UserData/schwung/modules/tools/movy/sets';
const SSH = ['-o', 'ConnectTimeout=8', '-o', 'BatchMode=yes'];

/* Shift is CC 49 (schwung: "49 (shift)"); Settings is Shift+Step 2, and step
 * buttons are notes 16..31 with STEP_FLAGS = 1. */
const CC_SHIFT = 49;
const STEP_FLAGS_NOTE = 17;

/* Frames of device work (~2.9 ms each), never a wall clock. */
const ACT = 90;    // after a gesture, for movy to have noticed it
/* Between the jog detents that clamp the Settings list at its last row. The
 * bash spaced them 0.02 s apart inside one batched send; 7 frames is that same
 * spacing stated as device work. */
const JOG = 7;

/* A set's own files are written by movy on its autosave (~8 s of device time on
 * this hardware). Reading once after a fixed sleep is the race the bash script
 * kept losing — every one of these is a wait on the value, not on the clock. */
const SAVE_WAIT = { within: 6000, every: 300 };
const SLOT_WAIT = { within: 7000, every: 300 };

/* The lines `src/track/migrate.ts` emits. The count is read OUT of the line
 * rather than pinned, because how many tracks there are to adopt is the
 * fixture's answer, not this file's. */
const MIG = {
    migrated: /mig: migrated (\d+) track/,
    nothing:  /mig: nothing to migrate/,
    manual:   /mig: manual/,
};

/* The legacy layout the bash script seeded: a set schwung holds the patch for,
 * which movy has never claimed tracks 0/1 of. NO `chains` key and NO `migv` —
 * that is exactly what "never migrated" looks like on disk. `chtrackset: 0` is
 * the per-set half of the flag that says these tracks were schwung's. */
const LEGACY = '{"root":48,"rootPc":0,"scale":0,"mode":0,"layout":0,"oct":[4,4,4,4],'
    + '"mutes":{"solo":[0,0,0,0],"base":null},"flags":{"chtrackset":0}}';

/* The value the scenario moves slot 0's first numeric param to, so the carried
 * patch is distinguishable from a fresh module. 4 decimals exactly, because the
 * preset blob is re-serialized with 4 and a value that rounded on the way would
 * stop matching the literal for a reason that has nothing to do with the
 * migration. */
const PATCH_VALUE = 0.3125;

scenario('migrate', async (t) => {
    fixture.setHost(t.host);
    const dev = new Device(t.bus, t.agent, t.host);
    const probe = new Probe(t.bus);
    const open = () => dev.open(probe);
    /* Idempotent, because this scenario seeds the set between every arm and the
     * first seed happens while movy is ALREADY shut — `fixture.ensure` hands it
     * back that way. The leave modal is read through the probe, and a probe read
     * is a param SET into the overtake DSP, which the host refuses outright when
     * there is no instance: a close on a closed movy is "param SET error from
     * peer", a harness error dressed as a finding. overtake_mode 2 is exactly
     * "movy owns the screen" — the state leaveVia exists to leave. */
    const close = async (): Promise<void> => {
        if ((await t.bus.state()).overtake_mode === 2) await dev.close(probe);
    };

    const ssh = async (cmd: string): Promise<string> =>
        (await run('ssh', [...SSH, `ableton@${t.host}`, cmd], { maxBuffer: 16 * 1024 * 1024 })).stdout;
    /* Movy's saves go through the host, which runs as ROOT, so a set movy has
     * saved holds root-owned files the ableton user cannot open for writing. */
    const sshRoot = async (cmd: string): Promise<string> =>
        (await run('ssh', [...SSH, `root@${t.host}`, cmd], { maxBuffer: 16 * 1024 * 1024 })).stdout;
    /* The node helpers read the address from the ENVIRONMENT while the suites
     * pass it as an argument — without this a run against another box would ssh
     * to the right device and WebSocket to move.local. */
    const node = async (script: string, args: string[]): Promise<{ out: string; code: number }> => {
        try {
            const { stdout } = await run('node', [join(MOVY, 'scripts', script), ...args],
                { env: { ...process.env, HOST: t.host }, maxBuffer: 8 * 1024 * 1024 });
            return { out: stdout.trim(), code: 0 };
        } catch (e: any) {
            return { out: String(e?.stdout ?? '').trim(), code: e?.code ?? 1 };
        }
    };

    /* Exit 3 is "the device never answered", which must never be read as
     * "empty" — that is how a verify accepts a slot that never loaded. Retried
     * the three times the bash's ts_read_slot did. */
    const slotMod = async (slot: string): Promise<string> => {
        for (let i = 0; i < 3; i++) {
            const { out, code } = await node('module-slot.mjs', ['get', slot, 'synth']);
            if (code === 0) return out;
            await t.bus.frames(ACT);
        }
        return '';
    };
    const slotParam = async (slot: string, key: string): Promise<string> => {
        for (let i = 0; i < 3; i++) {
            const { out, code } = await node('slot-param.mjs', ['get', slot, key]);
            if (code === 0) return out;
            await t.bus.frames(ACT);
        }
        return '';
    };
    const rack = async (): Promise<string[]> => {
        const { out, code } = await node('slots-read.mjs', []);
        return code === 0 && out ? out.split('\n').map((l) => l.trim()).filter(Boolean).sort() : [];
    };

    await fixture.ensure(t.bus, open, close);
    t.note('blob_afterEnsure', await fixture.blobInfo());
    await dev.deployUi();

    const uuid = (await fixture.activeUuid()).trim();
    if (!uuid) throw new Error('scenario: no active set uuid');
    const D = `${SETS}/${uuid}`;
    t.note('setDir', D);

    /* The unified log must be on for `open()` to wait on movy's own "set ready"
     * line rather than its quiet-window fallback — and every `mig:` assertion
     * below reads it. Idempotent. */
    await ssh('touch /data/UserData/schwung/debug_log_on');

    const clearLog = () => ssh('> /data/UserData/schwung/debug.log').then(() => undefined);
    const migLines = () => dev.logLines('mig: ');
    const readSet = (name: string) => ssh(`cat '${D}/${name}' 2>/dev/null || true`);

    /* Seed the LEGACY layout, in the one order that works.
     *
     * A root SSH REDIRECT, not scp: scp opens the destination for writing and is
     * refused on a root-owned file however writable the directory is. Unlinking
     * first is allowed (the directory is ableton's) and is what makes it work at
     * all.
     *
     * `chains.json` goes too. With `engpersist` on it is the AUTHORITY for movy's
     * chains and `ui-state.json` is only a mirror (spec §6.1), so seeding the
     * mirror while a previous run's authority survived means the set being
     * "seeded" is not the set this scenario thinks it is. Removing it puts the
     * set in the shape a pre-feature set has — no chains anywhere — which is
     * also the only shape where anything found afterwards came from this run. */
    const seedLegacy = async (): Promise<void> => {
        const cmd = `rm -f '${D}/ui-state.json' '${D}/chains.json' && ` +
                    `printf '%s' '${LEGACY}' > '${D}/ui-state.json'`;
        try { await ssh(cmd); }
        catch { await sshRoot(cmd); }
    };

    const parseJson = (s: string): any => { try { return JSON.parse(s); } catch { return null; } };

    // ── C1 / C2: the contract canary ────────────────────────────────────────
    /* Every key the migration reads, off a slot the fixture really seeded. When
     * schwung renames or drops one, this says WHICH — without it the migration
     * quietly finds nothing and the arms below still pass on an empty set. */
    const want0 = fixture.fixtureEntries().find((e) => e.slot === '0')?.mod ?? '';
    const synth0 = await slotMod('0');
    t.note('slot0', synth0);
    t.note('fixtureSlot0', want0);
    t.check('slot0-synth-reads-back', `slot 0 holds the fixture's synth (${synth0 || 'nothing'})`,
        synth0 !== '' && synth0 === want0,
        { expected: want0 || 'a module id', actual: synth0 || '<no answer>' });
    /* Nothing below is valid on an empty slot, and the bash exited here rather
     * than scoring ten failures against a fixture that never landed. */
    if (synth0 !== want0) {
        throw new Error('scenario: slot 0 holds no synth — the fixture did not seed, nothing below is valid');
    }

    /* Checked directly: `slot:volume` round-trips over the remote-UI subscribe
     * channel (see scripts/slot-param.mjs). `synth:state` does NOT broadcast
     * there — schwung assembles it only for the shim's own internal callers — so
     * C5 is its canary instead, one arm later: a renamed `synth:state` fails
     * there distinctly, as a migrated chain carrying no preset blob. */
    const volume = await slotParam('0', 'slot:volume');
    t.note('slotVolume', volume);
    t.check('slot-volume-answers', "'slot:volume' still answers", volume !== '',
        { expected: 'a value', actual: volume || '<no answer>' });

    /* Move ONE param of slot 0 off its default before the migration runs, and
     * return the literal the carried patch must then contain.
     *
     * The fixture's slot-0 patch is the module's FACTORY DEFAULTS — every entry
     * is 0.5 or 0 — so nothing in it can tell a carried patch from a module that
     * was merely loaded, and an assertion on any of those values passes just as
     * happily when the whole preset is dropped on the floor. (Measured: with
     * `readSlotChain`'s preset read deleted, a check keyed on the fixture's own
     * values still passed.) So the scenario gives the slot a value that is
     * provably not a default, exactly the way a real user's Set has one: load a
     * copy of the fixture's own slot file with that one entry moved.
     *
     * A number rather than a string because it has to survive re-serialization —
     * this value is chosen to be exact at 4 decimals, which is the width the
     * preset blob is written with. */
    const patchSlot0 = async (): Promise<string> => {
        const src = join(MOVY, 'scripts', 'fixtures', 'device-set', 'slot_0.json');
        const doc = JSON.parse(readFileSync(src, 'utf8'));
        const st = doc?.chain?.synth?.config?.state ?? {};
        const key = Object.keys(st).find((k) => typeof st[k] === 'number');
        if (!key) throw new Error('scenario: the fixture slot has no numeric param to key on');
        st[key] = PATCH_VALUE;
        const tmp = mkdtempSync(join(tmpdir(), 'movy-mig-'));
        const f = join(tmp, 'slot_0.json');
        writeFileSync(f, JSON.stringify(doc));
        try { await run('scp', ['-q', ...SSH, f, `ableton@${t.host}:${fixture.DEVICE_DIR}/migrate-slot_0.json`]); }
        finally { rmSync(tmp, { recursive: true, force: true }); }
        await node('slot-state.mjs', ['load', '0', `${fixture.DEVICE_DIR}/migrate-slot_0.json`]);

        /* `load_file` has no acknowledgement, so read the value back: a marker
         * that never landed would fail C5 for a reason that has nothing to do
         * with the migration. Loose comparison — the subscribe channel rounds to
         * 2 decimals, which is plenty to tell 0.3125 from the 0.50 default. */
        let live = '';
        try {
            live = await until(t.bus, `${key} == ~${PATCH_VALUE}`,
                () => slotParam('0', `synth:${key}`),
                (v) => v !== '' && Math.abs(Number(v) - PATCH_VALUE) < 0.01, SLOT_WAIT);
        } catch { live = await slotParam('0', `synth:${key}`); }
        t.note('slot0PatchLive', `${key}=${live || '<no answer>'}`);
        return `"${key}":${PATCH_VALUE.toFixed(4)}`;
    };

    // ── C3: the positive arm — a legacy set adopts the schwung rack ─────────
    await close();
    const marker = await patchSlot0();
    t.note('patchMarker', marker);
    await seedLegacy();
    await clearLog();
    await open();

    /* `open()` waited on movy's own "set ready", and the migration resolves
     * BEFORE that line is written: `migrationTick()` runs from the same settle
     * loop, and the log line for the ready state comes after it. So the `mig:`
     * line is already out by the time this runs — the wait is for the case where
     * the settle loop took a different path, not a hope that it arrives. */
    let migLine = '';
    try {
        migLine = await until(t.bus, 'the migration to report what it adopted',
            async () => (await migLines()).find((l) => MIG.migrated.test(l)) ?? '',
            (l) => l !== '', { within: 1500, every: 300 });
    } catch { migLine = (await migLines()).find((l) => MIG.migrated.test(l)) ?? ''; }
    t.note('migLog', await migLines());

    const adopted = Number(MIG.migrated.exec(migLine)?.[1] ?? -1);
    const wantTracks = fixture.fixtureEntries().filter((e) => e.mod !== 'none').length;
    t.note('migratedTracks', adopted);
    t.note('fixtureSlotsWithModules', wantTracks);
    /* Every slot the fixture filled, not the bash's `[12]`. A partial migration
     * is the failure this arm exists to name — the slot that did not come across
     * is the user's instrument — and `fixture.ensure` has already confirmed on
     * the engine that both slots hold their module before this runs. */
    t.check('migration-ran', 'the migration ran and adopted every slot the fixture filled',
        wantTracks > 0 && adopted === wantTracks,
        { expected: `migrated ${wantTracks} track(s)`,
          actual: migLine || '<no "mig: migrated" line>' });

    // ── C4: the adopted chain really holds the instrument ──────────────────
    /* `chloadedlog` is the ONLY movy-chain read-back there is (the remote-UI
     * socket can write an engine param but has no get verb). It is write-to-read
     * — `chLoaded` waits for the poke's OWN line, so this describes the chain
     * now and not one from before the migration. */
    const chLine = await fixture.chloaded(t.bus);
    const chainSynth = fixture.fixtureSynth(0);
    t.note('chloaded', chLine);
    t.check('chain0-adopted-synth', `chain 0 holds the fixture's synth (${chainSynth})`,
        !!chLine && new RegExp(`(^| )0:synth=${chainSynth}( |$)`).test(chLine),
        { expected: `0:synth=${chainSynth}`, actual: chLine ?? '<no chloadedlog answer>' });

    // ── C5: …with the PATCH, not the module's factory defaults ──────────────
    /* Audibility, not a module id: the migration carries the whole preset blob,
     * so the chain should carry the fixture's DISTINCTIVE value, not the module
     * shipped defaults it would have if only the id had crossed. A module id
     * alone proves a load, not a patch.
     *
     * Read from chains.json — the authority while `engpersist` is on, and the
     * file the engine stores the blob's RAW BYTES in, so the keyed form matches
     * unescaped. It cannot have been left behind by an earlier run: seedLegacy
     * unlinked it.
     *
     * `marker` is the value `patchSlot0` moved off its default and read back. If
     * that write never landed this fails, and the `slot0PatchLive` note says so. */
    let chains = '';
    try {
        chains = await until(t.bus, "the set's chains to carry the slot's patch",
            () => readSet('chains.json'), (s) => s.includes(marker), SAVE_WAIT);
    } catch { chains = await readSet('chains.json'); }
    t.note('chainsBytes', chains.length);
    t.check('migrated-patch-carried',
        "the migrated chain carries the slot's patch, not factory defaults",
        chains.includes(marker),
        { expected: `chains.json containing ${marker}`,
          actual: !chains ? 'no chains.json on disk'
                : chains.includes(marker) ? `chains.json (${chains.length} bytes) carries it`
                : `${chains.length} bytes without it` });

    // ── C6 / C7: the set records what it did ───────────────────────────────
    /* `migv` is the UI's own field — `chains.json` does not carry it — so this
     * one is read from ui-state.json whatever the persistence flag says. */
    let uiBlob = '';
    try {
        uiBlob = await until(t.bus, 'the set to be marked migrated',
            () => readSet('ui-state.json'),
            (s) => { const o = parseJson(s); return !!o && typeof o.migv === 'number' && o.migv >= 1; },
            SAVE_WAIT);
    } catch { uiBlob = await readSet('ui-state.json'); }
    let ui = parseJson(uiBlob);
    t.note('uiStateBytes', uiBlob.length);
    t.check('marked-migrated', 'the set is marked migrated (migv)',
        !!ui && typeof ui.migv === 'number' && ui.migv >= 1,
        { expected: 'migv >= 1 in ui-state.json',
          actual: ui ? `migv=${JSON.stringify(ui.migv)}` : 'no parseable ui-state.json' });

    /* The mirror is written by the UI from `chains.json`, and it is re-dirtied
     * when the ENGINE's chain generation changes (engine.ts) — so it converges
     * one save AFTER the engine has the chains, which is why this waits on the
     * value rather than reading it beside `migv`.
     *
     * The bash grepped for the key alone, which `"chains":[]` satisfies. An
     * array that carries nothing is not a set that carries its chains. */
    const mirror = Array.isArray(ui?.chains) ? ui.chains : [];
    let mirrorOk = mirror.length > 0;
    if (!mirrorOk) {
        try {
            uiBlob = await until(t.bus, 'the saved set to carry its chains',
                () => readSet('ui-state.json'),
                (s) => { const o = parseJson(s); return Array.isArray(o?.chains) && o.chains.length > 0; },
                SAVE_WAIT);
        } catch { uiBlob = await readSet('ui-state.json'); }
        ui = parseJson(uiBlob);
        mirrorOk = Array.isArray(ui?.chains) && ui.chains.length > 0;
    }
    const mirrorNow = Array.isArray(ui?.chains) ? ui.chains : null;
    t.note('mirrorChains', mirrorNow);
    t.check('chains-array-saved', 'the saved set carries a chains array', mirrorOk,
        { expected: 'a non-empty chains array in ui-state.json',
          actual: mirrorNow ? JSON.stringify(mirrorNow).slice(0, 120) : 'no chains field' });

    // ── C8: the schwung slot is never cleared ──────────────────────────────
    /* A migration that emptied the slot would be data loss, not a restore. */
    const still0 = await slotMod('0');
    t.note('slot0AfterMigration', still0);
    t.check('schwung-slot-untouched', `the schwung slot is untouched (${still0 || 'nothing'})`,
        still0 === synth0, { expected: synth0, actual: still0 || '<empty>' });

    // ── C9: a migrated set does not re-migrate ─────────────────────────────
    /* `beginMigration` returns as soon as the blob's marker is current, so a
     * re-open must log nothing at all. The absence is bounded, not assumed:
     * `open()` saw the new "set ready", which the settle loop writes AFTER the
     * migration resolves — so any `mig:` line this open was going to write is
     * already in the log by the time this reads it. */
    await close();
    await clearLog();
    await open();
    const log2 = await migLines();
    t.note('migLogOnReopen', log2);
    t.check('reopen-logs-nothing', 'a re-open of a migrated set logs nothing',
        log2.length === 0, { expected: 'no "mig:" line', actual: log2.join(' | ') || '(none)' });

    // ── C10: nothing to migrate reads as nothing, not as a failure ─────────
    await close();
    for (const slot of ['0', '1', '2', '3']) await node('slot-state.mjs', ['clear', slot]);
    let emptied = false;
    try {
        const rackNow = await until(t.bus, 'the rack to read empty',
            () => rack(), (r) => r.length > 0 && r.every((l) => l.endsWith(' -')),
            SLOT_WAIT);
        emptied = rackNow.length > 0;
    } catch { emptied = false; }
    t.note('rackEmptied', emptied);
    await seedLegacy();
    await clearLog();
    await open();
    const log3 = await migLines();
    t.note('migLogOnEmptyRack', log3);
    t.check('empty-rack-nothing-to-migrate', 'an empty rack reads as nothing to migrate',
        log3.some((l) => MIG.nothing.test(l)),
        { expected: 'a "mig: nothing to migrate" line', actual: log3.join(' | ') || '(none)' });

    // ── C11: the manual Settings row ───────────────────────────────────────
    /* The rack has to have something in it again for the row to do anything at
     * all: `slotsHaveContent()` decides whether the press is a no-op. Only the
     * module is restored — the throwaway params it comes up with are not
     * asserted on here, and C5 already proves the patch path. */
    await close();
    const back0 = fixture.fixtureEntries().find((e) => e.slot === '0')?.mod ?? '';
    await node('slot-state.mjs', ['module', '0', back0]);
    try {
        await until(t.bus, `slot 0 == ${back0}`, () => slotMod('0'), (v) => v === back0, SLOT_WAIT);
    } catch { /* C11 names what it saw; a slot that would not come back fails there */ }
    await seedLegacy();
    await clearLog();
    await open();

    /* Shift+Step 2 opens Settings. Then jog far enough to CLAMP on the last
     * action row — MIGRATE TRACKS, which sits after the flags so it never moves
     * when the flag list changes between debug and release builds. Clamping is
     * what makes this independent of how many flags the build ships. Then two
     * clicks: the first arms (the row reads CONFIRM?), the second runs it. */
    await dev.holdCc(CC_SHIFT, async () => { await dev.tap.note(STEP_FLAGS_NOTE, 127); });
    await t.bus.frames(ACT);
    for (let i = 0; i < 40; i++) { await dev.tap.jogTurn(1); await t.bus.frames(JOG); }
    await clearLog();                        // the row's own migration is the only thing left
    await dev.tap.jog(); await t.bus.frames(ACT);   // arm
    await dev.tap.jog(); await t.bus.frames(ACT);   // run: forced save + reload

    let manualLine = '';
    try {
        manualLine = await until(t.bus, 'the manual row to re-run the migration',
            async () => (await migLines()).find((l) => MIG.manual.test(l)) ?? '',
            (l) => l !== '', { within: 6000, every: 400 });
    } catch { manualLine = ''; }
    /* The row forces a full reload, and the migration it arms belongs to that
     * reload's splash. Wait for the Set to be playable before touching the UI —
     * a probe read during the restore STARVES it rather than merely slowing it
     * (rule 2), so closing on top of one would be the harness breaking the thing
     * it is about to assert. */
    try {
        await until(t.bus, 'the reloaded set to be playable',
            () => dev.logLines('seq: set ready'), (l) => l.length > 0,
            { within: 6000, every: 400 });
    } catch { /* it is about to be closed either way */ }
    t.note('migLogAfterManual', await migLines());
    t.check('manual-row-ran', 'the manual row ran the migration', MIG.manual.test(manualLine),
        { expected: 'a "mig: manual" line',
          actual: manualLine || ((await migLines()).join(' | ') || '<no "mig:" line at all>') });

    await close();
});
