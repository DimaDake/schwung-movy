#!/usr/bin/env node
/* Capture the Move's live screen as a PNG — device verification you can LOOK at
 * instead of inferring from log lines.
 *
 * Reads the display shared memory the device renders from. Note it is
 * /dev/shm/schwung-display: the similarly named schwung-display-live is the
 * manager's own overlay buffer and stays blank while a tool has overtaken the
 * screen, which is exactly when we want a shot. `base64` is absent from the
 * device's BusyBox, so the frame comes back over scp rather than a pipe.
 *
 * Frame format (display_server.c, schwung display_overlay.go): 128×64 1-bit,
 * 8 pages of 128 bytes; byte at (page*128 + col) holds 8 vertical pixels with
 * bit 0 = topmost.
 *
 * Usage: node scripts/grab-screen.mjs <out.png> [host] [scale]
 *   e.g. node scripts/grab-screen.mjs /tmp/helm-lfo.png
 *
 * Pair it with scripts/../../schwung-midi-inject-ui.py to drive the UI:
 *   cc 40..43  track buttons (43 = track 1)   cc 14 <1|127>  jog turn ±
 *   cc 3       jog click (drill into a slot)  cc 71..78      knobs 1..8
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// pngjs is a dev dep of the screenshot harness (browser-test/node_modules).
const { PNG } = createRequire(join(root, 'browser-test/screenshot.mjs'))('pngjs');

const out   = process.argv[2];
const host  = process.argv[3] || process.env.HOST || 'move.local';
const scale = parseInt(process.argv[4] ?? '4', 10);
if (!out) { console.error('usage: grab-screen.mjs <out.png> [host] [scale]'); process.exit(2); }

const W = 128, H = 64;
const tmp = join(mkdtempSync(join(tmpdir(), 'movy-fb-')), 'fb.bin');
execFileSync('scp', ['-q', '-o', 'ConnectTimeout=5',
    `ableton@${host}:/dev/shm/schwung-display`, tmp]);
const buf = readFileSync(tmp);
if (buf.length < (W * H) / 8) {
    console.error(`short frame: ${buf.length} bytes (expected ${(W * H) / 8})`);
    process.exit(1);
}

const png = new PNG({ width: W * scale, height: H * scale });
for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
        const v = ((buf[(y >> 3) * W + x] >> (y & 7)) & 1) ? 255 : 0;
        for (let dy = 0; dy < scale; dy++) {
            for (let dx = 0; dx < scale; dx++) {
                const i = (((y * scale + dy) * W * scale) + (x * scale + dx)) << 2;
                png.data[i] = png.data[i + 1] = png.data[i + 2] = v;
                png.data[i + 3] = 255;
            }
        }
    }
}
writeFileSync(out, PNG.sync.write(png));
console.log(`wrote ${out}  (${W}×${H} → ${W * scale}×${H * scale})`);
