/* New with WP7 (T4) — the debugging surface, on whichever flavour runs.
 *
 * Every dev tool a session reaches for, run for real against the device:
 * the same scripts, unmodified flags, so a tool that silently stopped working
 * on movy-host (or never did) turns this red instead of costing a debugging
 * session its first hour. Runs on BOTH flavours: the tools must not care.
 * JS stack traces and native crash backtraces are proven by `testbus` (B5,
 * B6), which can make them happen on purpose.
 *
 * Covers:
 *   D1 dev-probe.sh status names the running host and its ui.js is the build
 *   D2 dev-probe.sh log -i: an injected press reaches movy (UI ring)
 *   D3 inject-any.py (UI ring) reaches movy
 *   D4 inject-to-move.py (the midi-inject ring) reaches movy-host; beside Move
 *      it is Move's MIDI_IN and only the tool running is asserted
 *   D5 grab-screen.mjs reads the frame on the glass
 *   D6 capture-screen.mjs streams frames
 *   D7 the CPU meter page opens (Shift + Step 12)
 *   D8 perf-probe's perf_ipc report is being logged
 *   D9 the engine's diag answers and its block counter runs
 */
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { existsSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scenario } from '../runner.js';
import { Device } from '../device.js';
import { Probe } from '../probe.js';
import * as fixture from '../fixture.js';
import { until } from '../wait.js';
import { repoRoot } from '../engine.js';
import { cc, noteOn, CC_BACK } from '../midi.js';
import { SSH_OPTS } from '../ssh.js';

const run = promisify(execFile);
const ARM = 'trackvol arm t=0';          // track 1's button down (mixer/track-volume.ts)
const STEP_12 = 16 + 11, SHIFT = 49;
const VIEW_CPU = 'cpu';                   // app/state.ts viewName(VIEW_CPU), as the probe reports it

scenario('debug-tools', async (t) => {
    fixture.setHost(t.host);
    const dev = new Device(t.tx);
    const probe = new Probe(t.tx);
    const root = repoRoot();
    const sa = t.tx.flavour === 'standalone';
    const sh = async (cmd: string, args: string[], opts: object = {}) => {
        try { const r = await run(cmd, args, { cwd: root, maxBuffer: 8 << 20, ...opts }); return { ok: true, out: r.stdout + r.stderr }; }
        catch (e: any) { return { ok: false, out: String(e?.stdout ?? '') + String(e?.stderr ?? e) }; }
    };
    const onDevice = (script: string, args: string) =>
        sh('bash', ['-c', `ssh ${SSH_OPTS.join(' ')} ableton@${t.host} python3 - ${args} < ${join(root, 'scripts', script)}`]);
    /* Did an injected track-1 press reach movy: one more arm line. */
    const reached = async (before: number) => {
        try { await until(t.tx, 'the press to reach movy', async () => (await dev.logLines(ARM)).length, (n) => n > before, { within: 3000, every: 150 }); return true; }
        catch { return false; }
    };

    await fixture.ensure(t.tx, () => dev.open(probe), () => dev.close(probe));
    await dev.deployUi();
    await dev.open(probe);
    await dev.selectTrack(0);
    await t.tx.frames(30);

    // ── D1 ──────────────────────────────────────────────────────────────────
    const st = await sh('bash', ['scripts/dev-probe.sh', 'status', t.host]);
    const wantHost = sa ? 'host: movy-host' : 'host: shadow_ui';
    t.check('dev-probe-status', 'dev-probe.sh status names the running host and its ui.js is this build',
        st.ok && st.out.includes(wantHost) && st.out.includes('ui.js matches local build'),
        { expected: `${wantHost}, ui.js matches`, actual: st.out.replace(/\x1b\[[0-9;]*m/g, '').trim() });

    // ── D2 ──────────────────────────────────────────────────────────────────
    let before = (await dev.logLines(ARM)).length;
    const lg = await sh('bash', ['scripts/dev-probe.sh', 'log', t.host, '-n', '-t', '3', '-p', ARM,
                                 '-i', '0x0B:0xB0:43:127', '-i', '0x0B:0xB0:43:0']);
    const d2 = await reached(before);
    t.check('dev-probe-inject', 'dev-probe.sh log -i reaches movy (UI ring) and greps the result',
        lg.ok && d2 && lg.out.includes(ARM), { expected: `a new "${ARM}" line`, actual: `reached=${d2} ok=${lg.ok}` });

    // ── D3 ──────────────────────────────────────────────────────────────────
    before = (await dev.logLines(ARM)).length;
    const ia = await onDevice('inject-any.py', 'b0:2b:7f sleep:40 b0:2b:00');
    const d3 = await reached(before);
    t.check('inject-any', 'inject-any.py (UI ring) reaches movy', ia.ok && d3,
        { expected: `a new "${ARM}" line`, actual: `reached=${d3} ${ia.out.trim()}` });

    // ── D4 ──────────────────────────────────────────────────────────────────
    /* movy-host's own input standalone. Beside Move it is Move's MIDI_IN,
     * and what the shim then forwards to the tool is the shim's business, so
     * only the tool running is claimed there. */
    before = (await dev.logLines(ARM)).length;
    const im = await onDevice('inject-to-move.py', '11 176 43 127 11 176 43 0');
    const d4 = await reached(before);
    t.note('injectToMoveReachedMovy', d4);
    t.check('inject-to-move', sa ? 'inject-to-move.py (the inject ring) reaches movy-host'
                                 : 'inject-to-move.py runs (the ring is Move\'s here)',
        im.ok && (d4 || !sa), { expected: sa ? 'an arm line' : 'the tool ran', actual: `reached=${d4} ${im.out.trim()}` });

    // ── D5 ──────────────────────────────────────────────────────────────────
    const png = join(tmpdir(), `movy-grab-${process.pid}.png`);
    const md5 = (b: Buffer) => createHash('md5').update(b).digest('hex');
    const fbA = md5(await t.tx.framebuffer());
    const gr = await sh('node', ['scripts/grab-screen.mjs', png, t.host, '1']);
    const shm = (await sh('ssh', [...SSH_OPTS, `ableton@${t.host}`, 'md5sum /dev/shm/schwung-display'])).out.split(' ')[0];
    const fbB = md5(await t.tx.framebuffer());
    const pngOk = existsSync(png) && statSync(png).size > 100;
    rmSync(png, { force: true });
    t.check('grab-screen', 'grab-screen.mjs reads the frame on the glass',
        gr.ok && pngOk && (shm === fbA || shm === fbB),
        { expected: 'a PNG, from the same bytes as the bus frame', actual: `png=${pngOk} shm=${shm} fb=${fbA}/${fbB} ${gr.ok ? '' : gr.out.slice(0, 200)}` });

    // ── D6 ──────────────────────────────────────────────────────────────────
    const cap = spawn('node', ['scripts/capture-screen.mjs', '--stats', '--fps', '10', '--host', t.host], { cwd: root });
    let capErr = '';
    cap.stderr.on('data', (d) => { capErr += d; });
    const capDone = new Promise<void>((resolve) => cap.on('close', () => resolve()));
    await t.tx.frames(1200);              // ~3.5 s of capture, on the device's clock
    cap.kill('SIGINT');
    await capDone;
    const frames = Number(/(\d+) frames from device/.exec(capErr)?.[1] ?? 0);
    t.check('capture-screen', 'capture-screen.mjs streams frames', frames > 5,
        { expected: '> 5 frames in ~3 s', actual: `${frames}` });

    // ── D7 ──────────────────────────────────────────────────────────────────
    await t.tx.uiMidi(cc(SHIFT, 127));
    await t.tx.uiMidi(noteOn(STEP_12, 100));
    await t.tx.uiMidi(noteOn(STEP_12, 0));
    await t.tx.uiMidi(cc(SHIFT, 0));
    let view: unknown = null;
    try { view = (await until(t.tx, 'the CPU page', async () => (await probe.ask({ key: 'page' }) as any)?.view, (v) => v === VIEW_CPU, { within: 2000, every: 150 })); }
    catch (e: any) { view = e?.last ?? null; }
    t.check('cpu-page', 'Shift + Step 12 opens the CPU meter page', view === VIEW_CPU,
        { expected: `view ${VIEW_CPU}`, actual: String(view) });
    await dev.tap.cc(CC_BACK);
    await t.tx.frames(20);

    // ── D8 ──────────────────────────────────────────────────────────────────
    const ipc0 = (await dev.logLines('perf_ipc calls/tick=')).length;
    let ipc = ipc0;
    try { ipc = (await until(t.tx, 'a perf_ipc report', async () => (await dev.logLines('perf_ipc calls/tick=')).length, (n) => n > ipc0, { within: 4000, every: 300 })); }
    catch { /* checked below */ }
    t.check('perf-ipc', 'perf-probe reports perf_ipc', ipc > ipc0, { expected: 'a new perf_ipc line', actual: `${ipc0} → ${ipc}` });

    // ── D9 ──────────────────────────────────────────────────────────────────
    const blocks = async () => Number(/blocks=(\d+)/.exec(await dev.param.get('diag').catch(() => ''))?.[1] ?? NaN);
    const b0 = await blocks();
    await t.tx.frames(50);
    const b1 = await blocks();
    t.check('engine-diag', 'the engine answers diag and renders', b1 > b0,
        { expected: 'blocks= grows over 50 frames', actual: `${b0} → ${b1}` });
});
