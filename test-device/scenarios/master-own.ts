/* New with WP3 — movy's OWN master chain, and the import into it.
 *
 * The MASTER page drives an engine-hosted chain (`mfx:`), and the first time a
 * Set is applied with its import mark clear, movy copies that Set's schwung
 * master into it.
 *
 * What only the device can show: the import reads schwung's REAL per-Set file
 * and loads a REAL module into a real chain host instance; the stage runs over
 * movy's real output; and schwung's files are left byte-identical (copy forward,
 * never clean up). Local suites cover the planning and routing
 * (browser-test/logic/master-chain.mjs) and cargo covers the stage.
 *
 * The seed is written straight into schwung's per-Set `master_fx_0.json`,
 * shipped over scp + mv like page-dive's prefs restore (the box has no base64).
 * The import runs on a Set being applied, so the scenario clears the mark,
 * closes movy (which saves it), seeds the file and opens movy again.
 *
 * Covers:
 *   O3 the import loaded the seeded module into movy's master FX 1
 *   O4 and marked the Set imported
 *   O5 the master processes movy's audio, under the limiter's ceiling
 *   O6 schwung's master files are byte-identical after the import
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

const run = promisify(execFile);
/* test-device/dist/scenarios/master-own.js at run time. */

const FX = 'freeverb';
const TRACK = 0;
const MASTER = 'master: ';
/* −1 dBFS, the limiter's ceiling (master_chain.rs CEILING). */
const CEILING = Math.round(0.891 * 32767);
const SEED = JSON.stringify({ module_path: `/data/UserData/schwung/modules/audio_fx/${FX}/dsp.so`,
                              module_id: FX, params: { mix: '0.3' } });

scenario('master-own', async (t) => {
    fixture.setHost(t.host);
    const dev   = new Device(t.tx);
    const probe = new Probe(t.tx);
    const open  = () => dev.open(probe);
    const close = () => dev.close(probe);

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
                              within = 2000): Promise<string> => {
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
        const local = join(tmpdir(), `movy-mown-${process.pid}.json`);
        writeFileSync(local, body);
        await run('scp', ['-q', ...SSH_OPTS, local, `ableton@${t.host}:${remote}.new`]);
        await ssh(`mv '${remote}.new' '${remote}'`);
        rmSync(local, { force: true });
    };

    await fixture.ensure(t.tx, open, close);
    await dev.deployUi();
    await dev.open(probe);

    const uuid = (await fixture.activeUuid()).trim();
    if (!uuid) throw new Error('master-own: no active set uuid');
    const dir = `/data/UserData/schwung/set_state/${uuid}`;
    const f0 = `${dir}/master_fx_0.json`;
    const files = [0, 1, 2, 3].map((i) => `${dir}/master_fx_${i}.json`).join(' ');

    /* Schwung's file goes back exactly as it was, and movy's master is
     * emptied, whatever happens below. */
    await ssh(`mkdir -p '${dir}' && chmod 777 '${dir}'`);   // a library Set has no schwung set_state dir
    const present = (await ssh(`if [ -f '${f0}' ]; then echo yes; else echo no; fi`)).trim();
    if (present !== 'yes' && present !== 'no') throw new Error(`master-own: cannot stat ${f0}: ${present}`);
    const original = present === 'yes' ? await ssh(`cat '${f0}'`) : '';
    t.need.register(async () => {
        try {
            for (let n = 1; n <= 4; n++) await ep(`mfx:fx${n}:module`, '');
            await ep('mfx:imported', '0');
        } catch { /* movy may be closed */ }
        if (present === 'no') await ssh(`rm -f '${f0}'`);
        else await put(f0, original);
    });

    /* A clean slate on movy's side, saved by the close, so the import has
     * something to do when the Set is applied again. */
    for (let n = 1; n <= 4; n++) await ep(`mfx:fx${n}:module`, '');
    await ep('mfx:imported', '0');
    await close();
    await put(f0, SEED + '\n');
    const before = await ssh(`md5sum ${files} 2>/dev/null || true`);
    await open();

    // ── O3 / O4: the import ─────────────────────────────────────────────────
    const mod = await paramUntil('mfx:fx1:module', (v) => v === FX, 'the import to load FX 1', 6000);
    t.check('import-loaded', 'the import loaded schwung\'s master FX 1 into movy\'s',
        mod === FX, { expected: `mfx:fx1:module=${FX}`, actual: mod || '(empty)' });
    const imp = await paramUntil('mfx:imported', (v) => v === '1', 'the import mark', 4000);
    t.check('import-marked', 'and marked the Set imported', imp === '1',
        { expected: 'mfx:imported=1', actual: imp || '(no answer)' });
    const mix = await param('mfx:fx1:mix');
    t.note('imported-param', `mix=${mix}`);

    // ── O5: the stage runs over movy's audio ────────────────────────────────
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
    const out = Number(field(r1, 'out'));
    t.check('stage-runs', 'the master FX processed movy\'s output, under the ceiling',
        Number(field(r1, 'proc')) > Number(field(r0, 'proc')) && out <= CEILING
            && field(r1, 'mod').startsWith(FX),
        { expected: `proc grows, mod=${FX},…, out<=${CEILING}`, actual: r1 || '(no mfxlog line)' });

    // ── O6: schwung's files untouched ───────────────────────────────────────
    const after = await ssh(`md5sum ${files} 2>/dev/null || true`);
    t.check('schwung-untouched', 'schwung\'s master files are byte-identical after the import',
        after === before && before.trim() !== '',
        { expected: before.trim(), actual: after.trim() });
});
