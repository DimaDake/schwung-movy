#!/usr/bin/env node
/* measure-autosave.mjs — does the autosave cost the audio thread a frame?
 *
 * The 2026-11-15 Link session logged a glitch every ~2 s with the Set stage at
 * 2.4-3.3 ms: the autosave read every module's preset blob in one block.
 * This loads a heavy module (crest, default) on 8 fixture tracks, keeps the Set
 * dirty (one swing edit a second) for --secs with the transport playing, and counts the glitch-log frames
 * in that window whose Set stage cost 1 ms or more, plus the engine's own
 * "save:" log lines (it logs a save step of 1 ms or more). GREEN = neither.
 *
 * Runs on the harness's fixture Set (never the user's) and restores it.
 * Usage: node scripts/measure-autosave.mjs [move.local] [--secs 30] [--module crest]
 */
import { StandaloneTransport } from '../test-device/dist/transport-standalone.js';
import { Device } from '../test-device/dist/device.js';
import { Probe } from '../test-device/dist/probe.js';
import { SSH_OPTS } from '../test-device/dist/ssh.js';
import * as fixture from '../test-device/dist/fixture.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const argv = process.argv.slice(2);
const host = argv.find((a, i, xs) => !a.startsWith('--') && !(xs[i - 1] ?? '').startsWith('--')) ?? 'move.local';
const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const SECS = Number(opt('--secs', 30));
const MODULE = opt('--module', 'crest');
const GLITCH = '/data/UserData/schwung/movy-glitch.log';
const HOSTLOG = '/data/UserData/schwung/movy-host.log';
const ssh = async (cmd) => (await run('ssh', [...SSH_OPTS, `ableton@${host}`, cmd], { maxBuffer: 8 << 20 })).stdout;
const lines = async (f) => Number((await ssh(`wc -l < ${f}`)).trim()) || 0;

const tx = new StandaloneTransport(host);
const dev = new Device(tx), probe = new Probe(tx);
fixture.setHost(host);
let result = null;
try {
    await tx.connect();
    await fixture.ensure(tx, () => dev.open(probe), () => dev.close(probe));
    await dev.open(probe);
    for (let c = 0; c < 8; c++) {
        const line = `chain ${c}: synth = ${MODULE}`;
        const before = (await dev.logLines(line)).length;
        await tx.engineSetQueued(`ch${c}:synth:module`, MODULE);
        for (let i = 0; i < 60 && (await dev.logLines(line)).length <= before; i++) await tx.frames(60);
    }
    /* Playing, as in the session: the render takes most of the frame and the
     * save's share is what pushes it over. */
    await tx.engineSetQueued('cmd', 'play');
    await tx.frames(1000);
    const gen = async () => Number((await tx.engineGet('set')).match(/gen=(\d+)/)?.[1] ?? NaN);
    const gen0 = await gen();
    const g0 = await lines(GLITCH), h0 = await lines(HOSTLOG);
    for (let s = 0; s < SECS; s++) {
        /* A new value every time: a save identical to the last is skipped, so
         * alternating two values would line up with the 2 s cadence as no-ops. */
        await tx.engineSetQueued('cmd', `swing ${51 + (s % 29)}`);
        await tx.frames(344);
    }
    await tx.frames(1400);   // the last save's read finishes
    const glitches = (await ssh(`tail -n +${g0 + 1} ${GLITCH}`)).split('\n').filter((l) => l.includes('glitch frame'));
    const setUs = glitches.map((l) => Number(l.match(/ set=(\d+)/)?.[1] ?? 0));
    const saveLines = (await ssh(`tail -n +${h0 + 1} ${HOSTLOG}`)).split('\n').filter((l) => l.includes('save:'));
    result = {
        module: MODULE, secs: SECS, saves: (await gen()) - gen0, glitchFrames: glitches.length,
        setStageOver1ms: setUs.filter((u) => u >= 1000).length, worstSetUs: Math.max(0, ...setUs),
        saveLog: saveLines.slice(0, 4).map((l) => l.replace(/^.*save:/, 'save:')),
        worstSaveUs: Math.max(0, ...saveLines.map((l) => Number(l.match(/took (\d+) us/)?.[1] ?? 0))),
    };
    console.log(JSON.stringify(result));
} finally {
    await tx.engineSetQueued('cmd', 'stop').catch(() => {});
    await tx.engineSetQueued('cmd', 'swing 50').catch(() => {});
    await fixture.ensure(tx, () => dev.open(probe), () => dev.close(probe)).catch((e) => console.error(`fixture: ${e}`));
    await tx.close();
}
/* The engine logs a save step only when it costs 1 ms or more, so no line is
 * the pass: the read is spread under SAVE_BUDGET. */
console.log(result && result.saves > 0 && result.setStageOver1ms === 0 && result.worstSaveUs < 1000
    ? `GREEN: ${result.saves} saves, none with a step of 1 ms (${result.glitchFrames} glitch frames, worst Set stage ${result.worstSetUs} us)`
    : `RED: ${result?.saves} saves, save step ${result?.worstSaveUs} us, ${result?.setStageOver1ms} frames with the Set stage over 1 ms`);
