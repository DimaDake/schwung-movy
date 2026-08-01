#!/usr/bin/env node
/* Device e2e: the bottom "CLICK JOG" hint is a hold gesture.
 *
 * Touching the jog must NOT flash the hint — it appears only after the finger
 * rests for HOLD_MS without turning, and a turn takes it away again. Asserted
 * on the real framebuffer, not the log: the hint is an inverted full-width bar
 * on rows 58-63, so the lit fraction of that band is the whole test.
 *
 * Usage: node scripts/test-jog-hint.mjs [host]
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HOST   = process.argv[2] || process.env.HOST || 'move.local';
const root   = join(dirname(fileURLToPath(import.meta.url)), '..');
const INJECT = join(root, '..', 'schwung-midi-inject-ui.py');
const REMOTE = '/data/UserData/schwung/modules/tools/movy';

/* Run against the fixture state, like the shell suites. This shells out to the
 * same lib/test-set.sh rather than reimplementing it, so the two paths cannot
 * drift apart. */
const testSet = (verb) => execFileSync('bash', ['-c',
    `set -u; HOST='${HOST}' MOVY_DIR='${root}'; ` +
    `source '${root}/scripts/lib/test-set.sh'; ${verb}`],
    { stdio: 'inherit' });

testSet('test_set_begin');
/* Hand the LEDs back however this run ends: it leaves movy open in overtake
 * owning the surface, so without a restart the hardware stays dark. */
process.on('exit', () => { try { testSet('test_set_end'); } catch { /* best effort */ } });

const W = 128, TOAST_Y = 58, TOAST_H = 6;   // renderer/layout.ts
const JOG_TOUCH = 9, JOG_TURN_CC = 14;      // midi/router.ts
const HOLD_MS = 1000;                       // model/constants.ts

const G = '\x1b[0;32m', R = '\x1b[0;31m', Y = '\x1b[1;33m', X = '\x1b[0m';
let failures = 0;
const pass = m => console.log(`${G}✓${X} ${m}`);
const fail = m => { console.log(`${R}✗${X} ${m}`); failures++; };
const info = m => console.log(`${Y}→${X} ${m}`);

const ssh = cmd => execFileSync('ssh', ['-o', 'ConnectTimeout=5', `ableton@${HOST}`, cmd],
    { encoding: 'utf8' });
const inject = (...args) => execFileSync('python3', [INJECT, HOST, ...args.map(String)],
    { encoding: 'utf8' });
const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const tmpDir = mkdtempSync(join(tmpdir(), 'movy-jog-'));

/* Fraction of the toast band that is lit. A drawn hint fills it solid (minus
 * the inverted glyph pixels); ordinary page content leaves it mostly dark. */
function toastFill() {
    const out = join(tmpDir, `fb-${Date.now()}.bin`);
    execFileSync('scp', ['-q', '-o', 'ConnectTimeout=5',
        `ableton@${HOST}:/dev/shm/schwung-display`, out]);
    const buf = readFileSync(out);
    let lit = 0;
    for (let y = TOAST_Y; y < TOAST_Y + TOAST_H; y++) {
        for (let x = 0; x < W; x++) if ((buf[(y >> 3) * W + x] >> (y & 7)) & 1) lit++;
    }
    return lit / (W * TOAST_H);
}

// ── 1. Deploy ────────────────────────────────────────────────────────────────
ssh('echo ok');
pass('SSH reachable');
info('Building and deploying ui.js...');
execFileSync('node', [join(root, 'build/device.mjs')], { cwd: root, stdio: 'ignore' });
ssh(`mkdir -p ${REMOTE}`);
execFileSync('scp', ['-q', join(root, 'ui.js'), `ableton@${HOST}:${REMOTE}/`]);
pass('Built + deployed');

// ── 2. Open movy (lands on the chain view, where the hint lives) ─────────────
info('Opening Movy...');
ssh(`python3 -c "
import mmap, json
with open('/data/UserData/schwung/open_tool_cmd.json', 'w') as f:
    f.write(json.dumps({'file_path': '/', 'tool_id': 'movy'}))
with open('/dev/shm/schwung-control', 'r+b') as f:
    mm = mmap.mmap(f.fileno(), 0); mm[56] = 1; mm.close()
"`);
sleep(2500);

const idle = toastFill();
if (idle < 0.5) pass(`no hint before the gesture (band ${(idle * 100).toFixed(0)}% lit)`);
else fail(`band already looks like a toast before touching the jog (${(idle * 100).toFixed(0)}%)`);

// ── 3. Touch and look immediately — nothing may appear ───────────────────────
inject('note_on', JOG_TOUCH, 127);
sleep(300);
const onTouch = toastFill();
if (onTouch < 0.5) pass(`touch alone draws no hint (band ${(onTouch * 100).toFixed(0)}% lit)`);
else fail(`hint flashed on touch (band ${(onTouch * 100).toFixed(0)}% lit) — the hold delay is not applied`);

// ── 4. Keep resting past the hold time — it must appear ──────────────────────
sleep(HOLD_MS + 500);
const held = toastFill();
if (held > 0.5) pass(`hint shown after the hold (band ${(held * 100).toFixed(0)}% lit)`);
else fail(`no hint after ${HOLD_MS}ms of hold (band ${(held * 100).toFixed(0)}% lit)`);

// ── 5. A turn takes it away ──────────────────────────────────────────────────
inject('cc', JOG_TURN_CC, 1);
sleep(600);
const turned = toastFill();
if (turned < 0.5) pass(`turn removes the hint (band ${(turned * 100).toFixed(0)}% lit)`);
else fail(`hint survived a jog turn (band ${(turned * 100).toFixed(0)}% lit)`);

// ── 6. Still resting after that turn — it must stay away ─────────────────────
sleep(HOLD_MS + 500);
const afterTurn = toastFill();
if (afterTurn < 0.5) pass('no hint after a turn, however long the finger stays');
else fail(`hint came back while the jog was still turned-and-held (${(afterTurn * 100).toFixed(0)}%)`);

inject('note_off', JOG_TOUCH);

console.log(failures === 0
    ? `\n${G}\x1b[1mJOG HINT DEVICE TEST PASSED${X}`
    : `\n${R}\x1b[1m${failures} CHECK(S) FAILED${X}`);
process.exit(failures === 0 ? 0 : 1);
