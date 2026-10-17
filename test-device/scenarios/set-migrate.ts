/* The migration from Move, on the device's real filesystem and chain host.
 *
 * The engine turns a Move Set's schwung files into a movy library Set
 * (set_migrate.rs); cargo covers every rule of the conversion against fixture
 * directories. What only the device can show: the migration reads schwung's
 * files where movy-host can reach them, writes a Set the engine then OPENS,
 * and the modules it names load into real chain host instances — the master
 * into movy's master stage, which then processes movy's audio, and a schwung
 * slot into movy track 1. Schwung's files stay byte-identical.
 *
 * A SANDBOX, not the device's own Move Sets: the run is the manual (forced)
 * one, which replaces every Set from Move it is pointed at, and pointed at a
 * test directory that is exactly one Set — the user's Sets are never in reach.
 *
 * Covers:
 *   M1 the migrated Set is listed under its Move name
 *   M2 opened, schwung's master FX 1 is loaded in movy's master, marked imported
 *   M3 and schwung's slot 1 synth is loaded on movy track 1
 *   M4 the master processes movy's audio, under the limiter's ceiling
 *   M5 schwung's files are byte-identical after the migration
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scenario } from '../runner.js';
import { Device } from '../device.js';
import { Probe } from '../probe.js';
import * as fixture from '../fixture.js';
import { until } from '../wait.js';
import { SSH_OPTS } from '../ssh.js';
import { setsNav } from '../sets-nav.js';

const run = promisify(execFile);

const FX = 'freeverb';
const TRACK = 0;
const MASTER = 'master: ';
/* −1 dBFS, the limiter's ceiling (master_chain.rs CEILING). */
const CEILING = Math.round(0.891 * 32767);
/* Beside the library's own folders: the harness's ssh user (ableton) can write
 * there and not at the top of /data/UserData or UserLibrary, and the library
 * reads only `Sets/` and `library.json`, so a dot-folder is never a Set. */
const SB = '/data/UserData/UserLibrary/Movy/.test-migrate';
const UUID = 'movytest-migrate';
const NAME = 'Mig Test';
const STATE = `${SB}/set_state/${UUID}`;

scenario('set-migrate', async (t) => {
    fixture.setHost(t.host);
    const dev   = new Device(t.tx);
    const probe = new Probe(t.tx);
    const nav   = setsNav(t.tx, dev, probe);
    const hb    = t.tx.hostBus!;

    const ssh = async (cmd: string): Promise<string> => {
        const { stdout } = await run('ssh', [...SSH_OPTS, `ableton@${t.host}`, cmd],
                                     { maxBuffer: 8 * 1024 * 1024 });
        return stdout;
    };
    const ep = (key: string, value: string): Promise<void> => t.tx.engineSetQueued(key, value);
    const param = async (key: string): Promise<string> => {
        try { return (await dev.param.get('' + key)).trim(); } catch { return ''; }
    };
    const paramUntil = async (key: string, ok: (v: string) => boolean, what: string,
                              within = 4000): Promise<string> => {
        try { return await until(t.tx, what, () => param(key), ok, { within, every: 150 }); }
        catch (e: any) { return typeof e?.last === 'string' ? e.last : ''; }
    };
    /* `mfxlog` is write-to-read: wait for the line COUNT to grow. */
    const report = async (): Promise<string> => {
        const before = (await dev.logLines(MASTER)).length;
        await ep('mfxlog', '1');
        try {
            const ls = await until(t.tx, 'an mfxlog line', () => dev.logLines(MASTER),
                                   (v) => v.length > before, { within: 1500, every: 100 });
            return ls[ls.length - 1];
        } catch { return ''; }
    };
    const field = (line: string, k: string): string =>
        (line.match(new RegExp(`\\b${k}=(\\S+)`)) ?? [])[1] ?? '';
    /* Copy a local string over a device file: scp to a temp name, then mv. */
    const put = async (remote: string, body: string): Promise<void> => {
        const local = join(tmpdir(), `movy-mig-${process.pid}.json`);
        writeFileSync(local, body);
        await run('scp', ['-q', ...SSH_OPTS, local, `ableton@${t.host}:${remote}.new`]);
        await ssh(`mv '${remote}.new' '${remote}'`);
        rmSync(local, { force: true });
    };

    await fixture.ensure(t.tx, () => dev.open(probe), () => dev.close(probe));
    await dev.deployUi();
    await dev.open(probe);
    const home = (await nav.libUntil('the library answer', (l) => l.rows.length > 0)).cur;
    const synth = fixture.fixtureSynth(TRACK);
    if (!synth) throw new Error('set-migrate: the fixture has no synth on track 1');

    t.need.register(async () => {
        try {
            if ((await nav.lib()).cur === UUID) await nav.openSet(home);
            await hb.uiEval(`host_module_set_param('set', 'lib del ${UUID}')`);
        } catch { /* movy may be closed */ }
        await ssh(`rm -rf '${SB}'`);
    });

    // A Move Set on page 3 of the sandbox, with schwung's master and slot 1.
    await ssh(`rm -rf '${SB}' && mkdir -p '${SB}/set_pages/page_2/${UUID}/${NAME}' '${STATE}' && chmod -R 777 '${SB}'`);
    await put(`${STATE}/master_fx_0.json`, JSON.stringify({ module_id: FX, params: { mix: '0.3' } }) + '\n');
    await put(`${STATE}/slot_0.json`, JSON.stringify({ name: 'mig', version: 1, chain: {
        synth: { module: synth, config: {}, bypassed: 0 }, audio_fx: [] } }) + '\n');
    const files = `${STATE}/master_fx_0.json ${STATE}/slot_0.json`;
    const before = await ssh(`md5sum ${files}`);

    // ── M1: the manual run, pointed at the sandbox ──────────────────────────
    await hb.uiEval(`host_module_set_param('set', 'lib migrate legacy=${SB}/none move=${SB}/Sets `
        + `pages=${SB}/set_pages state=${SB}/set_state force')`);
    const l1 = await nav.libUntil('the migrated Set listed', (l) => l.rows.some((r) => r.id === UUID));
    const row = l1.rows.find((r) => r.id === UUID);
    t.check('listed', 'the migrated Set is in the library under its Move name', row?.name === NAME,
        { expected: NAME, actual: String(row?.name) });

    // ── M2 / M3: open it; the master and the track are movy's ──────────────
    await nav.openSet(UUID);
    const mod = await paramUntil('mfx:fx1:module', (v) => v === FX, 'master FX 1 to load', 6000);
    t.check('master-loaded', 'schwung\'s master FX 1 is loaded in movy\'s master', mod === FX,
        { expected: `mfx:fx1:module=${FX}`, actual: mod || '(empty)' });
    const imp = await param('mfx:imported');
    t.check('master-marked', 'and the Set is marked imported', imp === '1',
        { expected: 'mfx:imported=1', actual: imp || '(no answer)' });
    const tsyn = await paramUntil(`ch${TRACK}:synth_module`, (v) => v === synth, 'track 1 synth to load', 6000);
    t.check('track-loaded', 'schwung\'s slot 1 synth is on movy track 1', tsyn === synth,
        { expected: synth, actual: tsyn || '(empty)' });

    // ── M4: the master stage runs over movy's audio ────────────────────────
    const r0 = await report();
    await ep(`ch${TRACK}:midi`, '144.60.110');
    let r1 = '';
    try {
        r1 = await until(t.tx, 'the master to process audio', report,
            (l) => Number(field(l, 'proc')) > Number(field(r0, 'proc')) && Number(field(l, 'in')) > 0,
            { within: 2500, every: 200 });
    } catch (e: any) { r1 = typeof e?.last === 'string' ? e.last : await report(); }
    await ep(`ch${TRACK}:midi`, '128.60.0');
    t.note('mfxlog', { before: r0, during: r1 });
    t.check('stage-runs', 'the master FX processed movy\'s output, under the ceiling',
        Number(field(r1, 'proc')) > Number(field(r0, 'proc')) && Number(field(r1, 'out')) <= CEILING
            && field(r1, 'mod').startsWith(FX),
        { expected: `proc grows, mod=${FX},…, out<=${CEILING}`, actual: r1 || '(no mfxlog line)' });

    // ── M5: schwung's files untouched ───────────────────────────────────────
    const after = await ssh(`md5sum ${files}`);
    t.check('schwung-untouched', 'schwung\'s files are byte-identical after the migration',
        after === before && before.trim() !== '', { expected: before.trim(), actual: after.trim() });
}, { needs: 'testbus' });
