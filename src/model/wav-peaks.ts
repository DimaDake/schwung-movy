/* Peak envelope for a WAV file, computed a little at a time and cached.
 *
 * Three constraints shape this, and they pull against each other:
 *
 *   ACCURACY — a peak envelope that samples a handful of frames per column
 *     misses transients, and a granular sample is mostly transients. So the
 *     data chunk is STREAMED and every frame in a block contributes its max.
 *
 *   MEMORY — the file is never held. Blocks are read into one reusable buffer
 *     and collapsed into the per-column running max immediately, so the cost is
 *     O(width) regardless of a sample being 2 seconds or 2 minutes.
 *
 *   TIME — movy's tick period IS its MIDI sampling interval, so a multi-
 *     megabyte read inside one tick would be felt as input lag. The job is
 *     resumable: each tick does BLOCKS_PER_TICK blocks and returns.
 *
 * Huge files are bounded rather than allowed to run for hundreds of ticks: past
 * MAX_BLOCKS the reader strides over the data, which trades exactness for a
 * fixed ceiling on total work. Normal samples fall well inside the budget and
 * are read in full. */

export interface WavPeaks {
    key:    string;      // path:size:mtime:width — changes ⇒ recompute
    width:  number;
    points: number[];    // 0..1 per column, filled as the job progresses
    peak:   number;      // loudest sample seen so far — the normalisation divisor
    done:   boolean;
    error:  string;
}

/* Peaks are always computed at the display's full width and RESAMPLED down to
 * whatever the graphic currently spans. Width used to be part of the cache key,
 * which meant anything that resized the graphic — toggling mrsample's Loop
 * switch grows it from two cells to four — threw the envelope away and re-read
 * the whole file, a visible stall on a knob turn. */
export const PEAK_WIDTH = 128;

const BLOCK_BYTES     = 32768;
const BLOCKS_PER_TICK = 2;
const MAX_BLOCKS      = 64;      // ≤ 2 MB read for any one file

interface Job {
    key: string; path: string; width: number;
    points: number[];
    dataOffset: number; dataSize: number;
    blockAlign: number; bits: number; fmt: number; channels: number;
    frameCount: number;
    block: number; totalBlocks: number; blockStride: number; blockBytes: number;
    buf: ArrayBuffer; view: Uint8Array;
    peak: number;
}

let cache: WavPeaks = { key: '', width: 0, points: [], peak: 0, done: false, error: '' };
let job: Job | null = null;

const u16 = (b: Uint8Array, i: number): number => b[i] | (b[i + 1] << 8);
const u32 = (b: Uint8Array, i: number): number =>
    (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16)) + b[i + 3] * 16777216;
const s16 = (b: Uint8Array, i: number): number => {
    const v = b[i] | (b[i + 1] << 8);
    return (v & 0x8000) ? v - 65536 : v;
};
/* 24-bit PCM. Worth its own branch rather than being rejected as an exotic
 * format: sample libraries ship it as a matter of course — the whole Neon Drive
 * set on this device is 24-bit — and a sampler that cannot draw its own library
 * is not much of a feature. */
const s24 = (b: Uint8Array, i: number): number => {
    const v = b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
    return (v & 0x800000) ? v - 0x1000000 : v;
};
/* float32 without a DataView: QuickJS has typed arrays, and one shared
 * scratch pair avoids allocating per sample. */
const f32buf = new ArrayBuffer(4);
const f32u8 = new Uint8Array(f32buf);
const f32f = new Float32Array(f32buf);
const f32 = (b: Uint8Array, i: number): number => {
    f32u8[0] = b[i]; f32u8[1] = b[i + 1]; f32u8[2] = b[i + 2]; f32u8[3] = b[i + 3];
    return f32f[0];
};

function fileSignature(path: string): string | null {
    try {
        const st = (os as { stat(p: string): [{ size?: number; mtime?: number }, number] }).stat(path);
        if (!st || st[1] !== 0 || !st[0]) return null;
        return `${path}:${st[0].size ?? 0}:${st[0].mtime ?? 0}`;
    } catch { return null; }
}

/* Read the header and locate the data chunk. Only the first 4 KB is touched —
 * enough for RIFF + fmt + any stray LIST/INFO chunk before the audio. */
function startJob(path: string, width: number, key: string): Job | null {
    let f: { read(b: ArrayBuffer, p: number, n: number): number; seek(o: number, w: number): number; close(): void } | null = null;
    try {
        f = std.open(path, 'rb');
        if (!f) return null;
        const head = new ArrayBuffer(4096);
        const n = f.read(head, 0, 4096);
        const b = new Uint8Array(head, 0, Math.max(0, n));
        if (b.length < 44) { f.close(); return null; }
        // "RIFF"…"WAVE"
        if (!(b[0] === 82 && b[1] === 73 && b[2] === 70 && b[3] === 70)) { f.close(); return null; }

        let cur = 12, fmtAt = -1, dataAt = -1, dataSize = 0;
        while (cur + 8 <= b.length) {
            const id = String.fromCharCode(b[cur], b[cur + 1], b[cur + 2], b[cur + 3]);
            const sz = u32(b, cur + 4);
            if (id === 'fmt ') fmtAt = cur + 8;
            else if (id === 'data') { dataAt = cur + 8; dataSize = sz; break; }
            cur = cur + 8 + sz + (sz % 2);
        }
        if (fmtAt < 0 || dataAt < 0 || dataSize <= 0) { f.close(); return null; }

        const fmt = u16(b, fmtAt);
        const channels = Math.max(1, u16(b, fmtAt + 2));
        const bits = u16(b, fmtAt + 14);
        const blockAlign = Math.max(1, u16(b, fmtAt + 12));
        const ok = (fmt === 1 && (bits === 8 || bits === 16 || bits === 24)) || (fmt === 3 && bits === 32);
        if (!ok) { f.close(); return null; }
        f.close();

        const frameCount = Math.max(1, Math.floor(dataSize / blockAlign));
        /* Block size must be a whole number of FRAMES. 32768 is not a multiple
         * of a 3-byte 24-bit frame, so an unaligned block started mid-sample
         * and every value after the first block decoded as noise. */
        const blockBytes = Math.max(blockAlign, Math.floor(BLOCK_BYTES / blockAlign) * blockAlign);
        const totalBlocks = Math.max(1, Math.ceil(dataSize / blockBytes));
        const buf = new ArrayBuffer(BLOCK_BYTES);
        return {
            key, path, width, points: new Array(width).fill(0),
            dataOffset: dataAt, dataSize, blockAlign, bits, fmt, channels, frameCount,
            block: 0, totalBlocks, blockBytes,
            blockStride: Math.max(1, Math.ceil(totalBlocks / MAX_BLOCKS)),
            buf, view: new Uint8Array(buf), peak: 0,
        };
    } catch {
        if (f) { try { f.close(); } catch { /* already gone */ } }
        return null;
    }
}

/* One block: fold every frame in it into the column it belongs to. Channel 0
 * only — blockAlign steps over the interleaved channels. */
function runBlock(j: Job): boolean {
    let f: { read(b: ArrayBuffer, p: number, n: number): number; seek(o: number, w: number): number; close(): void } | null = null;
    try {
        f = std.open(j.path, 'rb');
        if (!f) return false;
        const byteStart = j.block * j.blockBytes;
        const want = Math.min(j.blockBytes, j.dataSize - byteStart);
        if (want <= 0) { f.close(); return false; }
        f.seek(j.dataOffset + byteStart, 0);          // 0 = SEEK_SET
        const got = f.read(j.buf, 0, want);
        f.close();
        f = null;
        if (got <= 0) return false;

        const b = j.view;
        const step = j.blockAlign;
        const sampleBytes = j.bits / 8;
        const firstFrame = Math.floor(byteStart / step);
        for (let off = 0; off + sampleBytes <= got; off += step) {
            let v = 0;
            if (j.fmt === 1 && j.bits === 16) v = s16(b, off) / 32768;
            else if (j.fmt === 1 && j.bits === 24) v = s24(b, off) / 8388608;
            else if (j.fmt === 1 && j.bits === 8) v = (b[off] - 128) / 128;
            else v = f32(b, off);
            if (v < 0) v = -v;
            if (v > 1) v = 1;
            const frame = firstFrame + off / step;
            let col = Math.floor((frame * j.width) / j.frameCount);
            if (col < 0) col = 0; else if (col >= j.width) col = j.width - 1;
            if (v > j.points[col]) j.points[col] = v;
            /* Running peak, folded in here rather than rescanned per frame:
             * the renderer normalises against it so a quiet sample still uses
             * the full height. */
            if (v > j.peak) j.peak = v;
        }
        return true;
    } catch {
        if (f) { try { f.close(); } catch { /* already gone */ } }
        return false;
    }
}

/* Advance the job for `path` at `width`. Call once per tick from processTick —
 * never from a render path. Returns true when the picture changed, so the
 * caller can mark the frame dirty without repainting on idle ticks. */
export function wavPeaksTick(path: string | null): boolean {
    if (!path) return false;
    const width = PEAK_WIDTH;
    const key = fileSignature(path);
    if (!key) {
        if (cache.key !== `missing:${path}`) {
            cache = { key: `missing:${path}`, width, points: [], peak: 0, done: true, error: 'file not found' };
            return true;
        }
        return false;
    }
    if (cache.key === key && cache.done) return false;

    if (!job || job.key !== key) {
        job = startJob(path, width, key);
        if (!job) {
            cache = { key, width, points: [], peak: 0, done: true, error: 'unreadable wav' };
            return true;
        }
        cache = { key, width, points: job.points, peak: 0, done: false, error: '' };
    }

    let worked = false;
    for (let i = 0; i < BLOCKS_PER_TICK && job.block < job.totalBlocks; i++) {
        runBlock(job);
        job.block += job.blockStride;
        worked = true;
    }
    if (worked) cache.peak = job.peak;   // scale tracks the data as it fills in
    if (job.block >= job.totalBlocks) {
        cache = { key, width, points: job.points, peak: job.peak, done: true, error: '' };
        job = null;
    }
    return worked;
}

/* The current envelope — possibly partial while a job is running. Never does
 * I/O, so it is safe to call from buildViewModel on every frame. */
export function wavPeaks(path: string | null): WavPeaks | null {
    if (!path) return null;
    if (!cache.key.startsWith(`${path}:`) && cache.key !== `missing:${path}`) return null;
    return cache;
}

/* Collapse the full-width envelope onto `width` columns, keeping the PEAK of
 * each source range — averaging would flatten exactly the transients the
 * picture exists to show. */
export function resamplePeaks(points: number[], width: number): number[] {
    if (width <= 0 || points.length === 0) return [];
    if (points.length === width) return points;
    const out = new Array<number>(width).fill(0);
    for (let i = 0; i < width; i++) {
        const a = Math.floor((i * points.length) / width);
        const b = Math.max(a + 1, Math.floor(((i + 1) * points.length) / width));
        let mx = 0;
        for (let j = a; j < b && j < points.length; j++) if (points[j] > mx) mx = points[j];
        out[i] = mx;
    }
    return out;
}

/* Test seam: the cache is module-level so a job survives across ticks. */
export function resetWavPeaks(): void {
    cache = { key: '', width: 0, points: [], peak: 0, done: false, error: '' };
    job = null;
}
