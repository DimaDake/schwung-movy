#!/usr/bin/env node
/* measure-link-latency.mjs — where movy's audio lands on a Link peer's grid.
 *
 * movy's metronome is in Movy Master. A probe on THIS Mac subscribes to that
 * channel and, for every click, takes the beat its buffer was stamped with
 * plus the click's offset in the buffer: exactly how Live places a recording.
 * Prints the clicks' offset from the beat (+ = late). The number to move
 * toward 0 is the median; the spread is movy's own click placement (the
 * metronome starts a click on a block boundary, so up to one block early).
 *
 * Needs dist/movy-link-probe-mac (scripts/build-link.sh --mac-probe) and the
 * device tier build. Uses the harness's fixture Set and puts Link back to
 * the user's stored Settings → LINK choice.
 *
 * Usage: node scripts/measure-link-latency.mjs [move.local] [--secs 12]
 */
import { StandaloneTransport } from '../test-device/dist/transport-standalone.js';
import { Device } from '../test-device/dist/device.js';
import { Probe } from '../test-device/dist/probe.js';
import { SSH_OPTS } from '../test-device/dist/ssh.js';
import * as fixture from '../test-device/dist/fixture.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const host = argv.find((a, i, xs) => !a.startsWith('--') && !(xs[i - 1] ?? '').startsWith('--')) ?? 'move.local';
const SECS = Number(argv.includes('--secs') ? argv[argv.indexOf('--secs') + 1] : 12);
const PREFS = '/data/UserData/schwung/modules/tools/movy/prefs.json';
const field = (s, k) => s.match(new RegExp(`(?:^| )${k}=(\\S+)`))?.[1] ?? '';
const ssh = async (cmd) => (await run('ssh', [...SSH_OPTS, `ableton@${host}`, cmd])).stdout;
const pct = (xs, p) => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))];

const tx = new StandaloneTransport(host);
const dev = new Device(tx), probe = new Probe(tx);
fixture.setHost(host);
const userOn = /"link"\s*:\s*true/.test(await ssh(`cat ${PREFS} 2>/dev/null || true`));
let clicks = [];
try {
    await tx.connect();
    await fixture.ensure(tx, () => dev.open(probe), () => dev.close(probe));
    await dev.open(probe);
    await tx.engineSet('link', '1');
    for (let i = 0; i < 40 && field(await tx.engineGet('status'), 'lk') !== '1'; i++) await tx.frames(100);
    // Only the click in Movy Master: the fixture's tracks would bury it.
    await tx.engineSetQueued('cmd', Array.from({ length: 16 }, (_, t) => `mute ${t} 1`).join(';'));
    await tx.engineSetQueued('cmd', 'metro 1');
    await tx.engineSetQueued('cmd', 'play');
    await tx.frames(700);
    const { stdout } = await run(join(ROOT, 'dist', 'movy-link-probe-mac'), ['--clicks', 'Movy Master', '--wait', String(SECS)],
                                 { maxBuffer: 1 << 20 });
    if (process.env.DBG) console.error(stdout.split("\n").filter((l) => !l.startsWith("click ")).join(" | "));
    clicks = [...stdout.matchAll(/^click (-?[\d.]+)$/gm)].map((m) => Number(m[1])).sort((a, b) => a - b);
} finally {
    await tx.engineSetQueued('cmd', 'metro 0').catch(() => {});
    await tx.engineSetQueued('cmd', Array.from({ length: 16 }, (_, t) => `mute ${t} 0`).join(';')).catch(() => {});
    await tx.engineSetQueued('cmd', 'stop').catch(() => {});
    await tx.engineSet('link', userOn ? '1' : '0').catch(() => {});
    await fixture.ensure(tx, () => dev.open(probe), () => dev.close(probe)).catch((e) => console.error(`fixture: ${e}`));
    await tx.close();
}
if (clicks.length < 5) {
    console.log(`RED: only ${clicks.length} clicks heard`);
    process.exit(1);
}
console.log(JSON.stringify({ clicks: clicks.length, medianMs: pct(clicks, 0.5), p10Ms: pct(clicks, 0.1), p90Ms: pct(clicks, 0.9) }));
