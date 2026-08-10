#!/usr/bin/env node
/* Record the Move's live screen to a video file — for screen-capture footage to
 * composite next to a camera shot (see docs/video/SCENARIO.md).
 *
 * Why not loop grab-screen.mjs: that pays a full SSH handshake and an sshd fork
 * per frame, which on the Move's CPU is tens of ms of real work each time. The
 * tick rate already swings 63-205 Hz with load, and the tick period IS the MIDI
 * input sampling interval — so a per-frame scp would visibly worsen pad latency
 * while recording. Here one persistent SSH connection carries every frame and
 * the device only reads 1 KB and writes it to a pipe per frame.
 *
 * Reading the framebuffer costs the renderer nothing: /dev/shm/schwung-display
 * is tmpfs the display server writes regardless, and readers take no lock. The
 * only artifact is an occasional torn frame from reading mid-write.
 *
 * Frame format (display_server.c): 128×64 1-bit, 8 pages of 128 bytes; byte at
 * (page*128 + col) holds 8 vertical pixels, bit 0 = topmost.
 *
 * Usage: node scripts/capture-screen.mjs <out.mp4> [--fps 30] [--scale 6]
 *                                        [--host move.local] [--stats]
 *   --stats   measure only — no file written. Run this first to confirm the
 *             capture isn't costing you frames before committing to a take.
 */
import { spawn } from 'node:child_process';

const opts = { host: process.env.HOST || 'move.local', fps: '30', scale: '6' };
let statsOnly = false, out = null;
for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === '--stats') statsOnly = true;
    else if (a.startsWith('--')) {
        const k = a.slice(2);
        if (!(k in opts)) { console.error(`unknown option ${a}`); process.exit(2); }
        opts[k] = process.argv[++i];
    } else if (out === null) out = a;
    else { console.error(`unexpected argument ${a}`); process.exit(2); }
}
const { host } = opts;
const fps = parseInt(opts.fps, 10);
const scale = parseInt(opts.scale, 10);

if (!statsOnly && !out) {
    console.error('usage: capture-screen.mjs <out.mp4> [--fps 30] [--scale 6] [--host move.local] [--stats]');
    process.exit(2);
}
if (!(fps > 0 && fps <= 60)) { console.error(`--fps must be 1..60 (got ${fps})`); process.exit(2); }

const W = 128, H = 64, FRAME = (W * H) / 8;   // 1024 bytes on the wire

/* Paced on the device against a monotonic deadline rather than cumulative
 * sleeps, so a slow read doesn't make every later frame progressively late.
 * Python (not a shell loop) because BusyBox sleep may not take fractional
 * seconds — a shell loop without one would spin the CPU at 100%, which is the
 * one outcome that would genuinely hurt the instrument. */
const REMOTE = `
import sys, time
PATH, N, IV = '/dev/shm/schwung-display', ${FRAME}, ${1 / fps}
w, t = sys.stdout.buffer, time.monotonic()
while True:
    try:
        with open(PATH, 'rb') as f: b = f.read(N)
    except OSError:
        b = b''
    w.write(b.ljust(N, b'\\x00')[:N]); w.flush()
    t += IV
    d = t - time.monotonic()
    if d > 0: time.sleep(d)
    else: t = time.monotonic()   # fell behind; resync instead of spiralling
`;

const ssh = spawn('ssh', ['-o', 'ConnectTimeout=5', '-o', 'BatchMode=yes',
    `ableton@${host}`, 'python3', '-'], { stdio: ['pipe', 'pipe', 'inherit'] });
ssh.stdin.end(REMOTE);   // python3 - runs the program only once stdin closes

let ff = null;
if (!statsOnly) {
    ff = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error',
        '-f', 'rawvideo', '-pixel_format', 'gray',
        '-video_size', `${W}x${H}`, '-framerate', String(fps), '-i', '-',
        // Nearest-neighbour: the source is 1-bit, and interpolation turns crisp
        // pixels into grey mush.
        '-vf', `scale=iw*${scale}:ih*${scale}:flags=neighbor`,
        // qp 0 is lossless for luma; chroma is a constant 128 across a
        // greyscale source, so 4:2:0 subsampling discards nothing either —
        // pixel-exact output that still opens in any editor.
        '-c:v', 'libx264', '-qp', '0', '-preset', 'medium', '-pix_fmt', 'yuv420p',
        out], { stdio: ['pipe', 'inherit', 'inherit'] });
    ff.on('error', (e) => {
        console.error(e.code === 'ENOENT' ? 'ffmpeg not found — brew install ffmpeg' : String(e));
        process.exit(1);
    });
}

/* Latest-frame-wins, with a local clock driving the writer: the output stays
 * constant-rate and aligned to wall clock, so it will not drift against camera
 * audio over a ten-minute take even if the link stutters. */
const gray = Buffer.alloc(W * H);
let pending = null, received = 0, written = 0, repeats = 0, superseded = 0;
let acc = Buffer.alloc(0);

ssh.stdout.on('data', (chunk) => {
    acc = acc.length ? Buffer.concat([acc, chunk]) : chunk;
    while (acc.length >= FRAME) {
        if (pending) superseded++;
        pending = acc.subarray(0, FRAME);
        acc = acc.subarray(FRAME);
        received++;
    }
});

const unpack = (fb) => {
    for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++)
            gray[y * W + x] = ((fb[(y >> 3) * W + x] >> (y & 7)) & 1) ? 255 : 0;
    return gray;
};

let last = null, ticks = 0, finished = false;
const start = Date.now();
const tick = () => {
    if (finished) return;
    if (pending) { last = pending; pending = null; }
    else if (last) repeats++;
    if (last) {
        if (ff) ff.stdin.write(unpack(last));
        written++;
    }
    // Deadline is counted off the start on its own tick counter — not off the
    // frames written, which stalls at 0 until the first frame lands and would
    // otherwise busy-loop on an already-passed deadline.
    ticks++;
    setTimeout(tick, Math.max(0, start + (ticks + 1) * (1000 / fps) - Date.now()));
};
setTimeout(tick, 1000 / fps);
const finish = (code = 0) => {
    if (finished) return;
    finished = true;
    const secs = (Date.now() - start) / 1000;
    try { ssh.kill(); } catch {}
    const summary = () => {
        console.error(`\n  ${secs.toFixed(1)}s · ${received} frames from device ` +
            `(${(received / secs).toFixed(1)} fps, target ${fps})`);
        console.error(`  ${written} frames written · ${repeats} repeated (link fell behind)` +
            `${superseded ? ` · ${superseded} superseded (writer fell behind)` : ''}`);
        if (received < secs * fps * 0.9)
            console.error('  NOTE: device delivered <90% of target — lower --fps.');
        if (!statsOnly) console.error(`  wrote ${out} (${W * scale}×${H * scale})`);
        process.exit(code);
    };
    if (ff) { ff.on('close', summary); ff.stdin.end(); } else summary();
};

process.on('SIGINT', () => finish(0));
ssh.on('close', (c) => { if (c) console.error(`ssh exited ${c}`); finish(c ? 1 : 0); });
console.error(`capturing from ${host} at ${fps} fps — Ctrl-C to stop` +
    (statsOnly ? ' (stats only, no file)' : ` → ${out}`));
