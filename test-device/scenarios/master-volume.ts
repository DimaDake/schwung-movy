/* New with WP7 — the volume knob as movy's own master volume, on a host with
 * no Move beside it (caps.ownsMasterVolume). Standalone only.
 *
 * What only the device can show: the knob's raw CC 79 reaches the router,
 * the engine's master stage takes it (`mfx:vol`), prefs.json keeps it, and a
 * fresh engine is given it back. The ladder, the cap at unity and the
 * held-track priority are pinned in browser-test/logic/master-volume.mjs.
 *
 * Covers:
 *   V1 the knob alone moves the master stage, one dB a detent
 *   V2 releasing the knob saves the level to prefs.json, once
 *   V3 a held track takes the knob: its mix moves, the master does not
 *   V4 a reopen (a fresh engine) comes back at the saved level
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
import { cc, noteOn, CC_TRACK_BASE } from '../midi.js';
import { SSH_OPTS } from '../ssh.js';

const run = promisify(execFile);
const PREFS = '/data/UserData/schwung/modules/tools/movy/prefs.json';
const MASTER_CC = 79, MASTER_TOUCH = 8;
const db = (a: number) => 20 * Math.log10(a);

scenario('master-volume', async (t) => {
    fixture.setHost(t.host);
    const dev = new Device(t.tx);
    const probe = new Probe(t.tx);
    const ssh = async (cmd: string) =>
        (await run('ssh', [...SSH_OPTS, `ableton@${t.host}`, cmd])).stdout;
    const vol = async () => Number((await dev.param.get('mfx:vol').catch(() => '')).trim());
    const savedVol = async () => {
        try { return Number(JSON.parse(await ssh(`cat ${PREFS}`)).masterVolume); } catch { return NaN; }
    };
    const turn = async (detents: number) => {
        await t.tx.uiMidi(cc(MASTER_CC, detents > 0 ? detents : 128 + detents));
        await t.tx.frames(10);
    };

    await fixture.ensure(t.tx, () => dev.open(probe), () => dev.close(probe));
    await dev.deployUi();
    await dev.open(probe);

    /* prefs.json goes back byte for byte (other prefs share it). */
    const original = await ssh(`cat ${PREFS} 2>/dev/null || true`);
    t.need.register(async () => {
        const local = join(tmpdir(), `movy-mvol-${process.pid}.json`);
        writeFileSync(local, original);
        await run('scp', ['-q', ...SSH_OPTS, local, `ableton@${t.host}:${PREFS}.mvtest`]);
        await ssh(`mv ${PREFS}.mvtest ${PREFS}`);
        rmSync(local, { force: true });
    });

    // ── V1: the knob alone ──────────────────────────────────────────────────
    await t.tx.uiMidi(noteOn(MASTER_TOUCH, 127));
    await turn(-6);                 // off the unity cap, so the step up is measurable
    const v0 = await vol();
    await turn(3);
    let v1 = v0;
    try { v1 = await until(t.tx, 'the master stage to move', vol, (v) => v > v0, { within: 1500, every: 100 }); }
    catch { v1 = await vol(); }
    const step = db(v1) - db(v0);
    t.check('knob-moves-master', 'the volume knob alone moves the master stage, 1 dB a detent',
        Number.isFinite(step) && Math.abs(step - 3) < 0.05,
        { expected: '+3.0 dB on mfx:vol', actual: `${v0} → ${v1} (${step.toFixed(2)} dB)` });

    // ── V2: release saves ───────────────────────────────────────────────────
    await t.tx.uiMidi(noteOn(MASTER_TOUCH, 0));
    let saved = NaN;
    try { saved = await until(t.tx, 'prefs.json to hold the level', savedVol, (v) => Math.abs(v - v1) < 1e-3, { within: 2000, every: 200 }); }
    catch { saved = await savedVol(); }
    t.check('release-saves', 'releasing the knob saved the level to prefs.json',
        Math.abs(saved - v1) < 1e-3, { expected: `masterVolume=${v1}`, actual: `${saved}` });

    // ── V3: a held track takes the knob ─────────────────────────────────────
    await dev.selectTrack(0);
    const mix0 = (await dev.param.get('ch0:mix').catch(() => '')).split(',')[0];
    await dev.holdCc(CC_TRACK_BASE + 3, async () => {
        await t.tx.uiMidi(noteOn(MASTER_TOUCH, 127));
        await turn(-2);
        await t.tx.uiMidi(noteOn(MASTER_TOUCH, 0));
    });
    await t.tx.frames(20);
    const mix1 = (await dev.param.get('ch0:mix').catch(() => '')).split(',')[0];
    const v3 = await vol();
    t.check('track-wins', 'with a track held the knob moves that track, not the master',
        mix1 !== mix0 && Number(mix1) < Number(mix0) && Math.abs(v3 - v1) < 1e-4,
        { expected: `ch0 gain down from ${mix0}, mfx:vol still ${v1}`, actual: `ch0 ${mix0} → ${mix1}, mfx:vol ${v3}` });
    /* Undo the track edit so the fixture's level is what the next run sees. */
    await dev.holdCc(CC_TRACK_BASE + 3, async () => { await turn(2); });

    // ── V4: a fresh engine gets it back ─────────────────────────────────────
    await dev.close(probe);
    await dev.open(probe);
    const v4 = await vol();
    t.check('reopen-restores', 'a reopen comes back at the saved master level',
        Math.abs(v4 - v1) < 1e-3, { expected: `mfx:vol=${v1.toFixed(4)}`, actual: `${v4}` });
}, { needs: 'master-volume' });
