#!/usr/bin/env node
/* measure-link-cost.mjs — what Link Audio out costs on the device, against the
 * REAL movy-link, with a subscriber on THIS Mac (so the audio crosses WiFi or
 * USB the way it would to Live): 0, 2, 8 and 20 subscribed channels, the set
 * playing, each window sampled on the box by scripts/lib/link-cost-sample.py.
 *
 * Gate (plans/2026-11-15-ableton-link-plan.md Task 8): no new glitch-log line
 * at 20 channels. The 2026-11-15 proxy sweep measured ~12 % (USB) / ~25 %
 * (WiFi) of one core kernel-side at 17 channels; the real helper should land
 * within ~1.3x of that.
 *
 * Needs: scripts/build-link.sh && scripts/build-link.sh --mac-probe, the
 * device tier built (test-device/dist). Puts Link back to the user's stored
 * Settings → LINK choice.
 *
 * Usage: node scripts/measure-link-cost.mjs [move.local] [--secs 30] [--counts 0,2,8,20]
 */
import { StandaloneTransport } from '../test-device/dist/transport-standalone.js';
import { Device } from '../test-device/dist/device.js';
import { Probe } from '../test-device/dist/probe.js';
import { SSH_OPTS } from '../test-device/dist/ssh.js';
import * as fixture from '../test-device/dist/fixture.js';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const host = argv.find((a, i, xs) => !a.startsWith('--') && !(xs[i - 1] ?? '').startsWith('--')) ?? 'move.local';
const SECS = Number(argv[argv.indexOf('--secs') + 1]) || 30;
const COUNTS = argv.includes('--counts') ? argv[argv.indexOf('--counts') + 1].split(',').map(Number) : [0, 2, 8, 20];
const PREFS = '/data/UserData/schwung/modules/tools/movy/prefs.json';
const field = (s, k) => s.match(new RegExp(`(?:^| )${k}=(\\S+)`))?.[1] ?? '';

const ssh = async (cmd) => (await run('ssh', [...SSH_OPTS, `ableton@${host}`, cmd], { maxBuffer: 1 << 20 })).stdout.trim();
const setLink = (on) => tx.engineSet('link', on ? '1' : '0');
const macProbe = (n, secs) => new Promise((resolve) => {
    const p = spawn(join(ROOT, 'dist', 'movy-link-probe-mac'), ['--subscribe-n', String(n), '--wait', String(secs)]);
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('close', () => resolve(out));
});

const tx = new StandaloneTransport(host);
const dev = new Device(tx), probe = new Probe(tx);
fixture.setHost(host);
const userOn = /"link"\s*:\s*true/.test(await ssh(`cat ${PREFS} 2>/dev/null || true`));
const rows = [];
try {
    await tx.connect();
    await fixture.ensure(tx, () => dev.open(probe), () => dev.close(probe));
    await dev.open(probe);
    await run('scp', ['-q', ...SSH_OPTS, join(ROOT, 'scripts', 'lib', 'link-cost-sample.py'), `ableton@${host}:/tmp/link-cost-sample.py`]);
    await setLink(true);
    for (let i = 0; i < 40 && field(await tx.engineGet('status'), 'lk') !== '1'; i++) await tx.frames(100);
    await tx.engineSetQueued('cmd', 'play');
    await tx.frames(1500);
    for (const n of COUNTS) {
        const p = macProbe(n, SECS + 6);
        await tx.frames(1400);                       // ~4 s: joined and subscribed
        const sample = JSON.parse(await ssh(`python3 /tmp/link-cost-sample.py ${SECS}`));
        const out = await p;
        const frames = Number(out.match(/^frames (\d+)/m)?.[1] ?? 0);
        const st = await tx.engineGet('status');
        const row = { channels: n, sources: Number(out.match(/sources (\d+)/)?.[1] ?? 0),
                      per_channel_hz: n ? Math.round(frames / n / (SECS + 6)) : 0,
                      play: field(st, 'play'), peers: field(st, 'lkp'), ...sample };
        rows.push(row);
        console.log(JSON.stringify(row));
    }
} finally {
    await tx.engineSetQueued('cmd', 'stop').catch(() => {});
    await setLink(userOn).catch(() => {});
    await fixture.ensure(tx, () => dev.open(probe), () => dev.close(probe)).catch((e) => console.error(`fixture: ${e}`));
    await tx.close();
}
const worst = rows.at(-1);
console.log(worst && worst.glitch_frames === 0 && worst.late_transfers === 0
    ? `GREEN: 20 channels, no glitch (link ${worst.link}% + net ${worst.net_kthreads}% of one core)`
    : `RED: glitches at 20 channels: ${JSON.stringify(worst)}`);
