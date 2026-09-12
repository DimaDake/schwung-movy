import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const run = promisify(execFile);

/* The Move's screen is 128x64, 1bpp, stored as 8 pages of 128 bytes with bit 0
 * topmost — the same layout renderer/layout.ts draws into. */
export const W = 128;
export const H = 64;

/* `/dev/shm/schwung-display`, NOT `schwung-display-live`: the latter is the
 * manager's overlay buffer and stays blank exactly while a tool owns the
 * screen, which is when a test wants a shot. */
const FB = '/dev/shm/schwung-display';

/* One multiplexed connection, reused. Not a speed indulgence — the jog-hint
 * touch check has a 1 s deadline and a fresh ssh handshake costs ~1.1 s on this
 * link, so every unmultiplexed sample lands after the hold and the check can
 * never observe the thing it asserts. Multiplexed, a grab is well under 100 ms.
 *
 * A socket path under the OS temp dir overruns macOS's 104-char sun_path limit,
 * so this one is short and %C-hashed. */
const MUX = ['-o', 'ControlMaster=auto', '-o', 'ControlPath=/tmp/movy-disp-%C',
             '-o', 'ControlPersist=60', '-o', 'ConnectTimeout=5'];

/* The device's framebuffer, as bytes.
 *
 * This is the capability the migration recorded as blocked on a schwung change
 * (`SNAPSHOT_DISPLAY`, MIGRATION.md). It never needed one: the buffer is a file
 * in /dev/shm and scp reads it, which is what scripts/test-jog-hint.mjs did all
 * along. */
export class Display {
    private dir = mkdtempSync(join(tmpdir(), 'movy-fb-'));
    private n = 0;

    constructor(private host: string) {}

    async grab(): Promise<Buffer> {
        const out = join(this.dir, `fb-${this.n++}.bin`);
        await run('scp', ['-q', ...MUX, `ableton@${this.host}:${FB}`, out]);
        return readFileSync(out);
    }

    /* Fraction of a horizontal band that is lit, 0..1. The toast hint is an
     * INVERTED full-width bar, so a drawn one fills its band almost solid
     * (minus the glyph pixels) while ordinary page content leaves it mostly
     * dark — which is why a fraction, not a pixel match, is the right assertion:
     * it does not re-encode the font. */
    static bandFill(buf: Buffer, y0: number, h: number): number {
        let lit = 0;
        for (let y = y0; y < y0 + h; y++) {
            for (let x = 0; x < W; x++) if ((buf[(y >> 3) * W + x] >> (y & 7)) & 1) lit++;
        }
        return lit / (W * h);
    }

    async bandFill(y0: number, h: number): Promise<number> {
        return Display.bandFill(await this.grab(), y0, h);
    }
}
