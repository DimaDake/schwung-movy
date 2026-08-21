/* browser-test/logic/wav-peaks.mjs — WAV peak extraction + caching, the sample marker, and dumpLayout
 *
 * Run by browser-test/logic.mjs. The suite body is deliberately left at its
 * original indentation inside run() so blame survives the split.
 */

import {
    MOCK_SYNTHS, wavPeaksTick, wavPeaks, resetWavPeaks, resamplePeaks, PEAK_WIDTH,
    drawWavForm, fail, eq, bootModel, _log, env,
} from './harness.mjs';

export async function run() {
_log('\nTest: WAV peaks — accuracy, chunking and caching');
{
    /* A real 16-bit mono WAV: silent, then a loud burst in the middle third.
     * Building the bytes rather than mocking the parser is the point — an
     * off-by-one in a chunk header or a stride would sail past a fake. */
    const makeWav = (frames, amplitudeAt) => {
        const dataBytes = frames * 2;
        const b = new Uint8Array(44 + dataBytes);
        const ws = (o, str) => { for (let i = 0; i < str.length; i++) b[o + i] = str.charCodeAt(i); };
        const w32 = (o, v) => { b[o] = v & 255; b[o+1] = (v>>8)&255; b[o+2] = (v>>16)&255; b[o+3] = (v>>>24)&255; };
        const w16 = (o, v) => { b[o] = v & 255; b[o+1] = (v>>8)&255; };
        ws(0, 'RIFF'); w32(4, 36 + dataBytes); ws(8, 'WAVE');
        ws(12, 'fmt '); w32(16, 16); w16(20, 1); w16(22, 1);      // PCM, mono
        w32(24, 44100); w32(28, 88200); w16(32, 2); w16(34, 16);  // blockAlign 2, 16-bit
        ws(36, 'data'); w32(40, dataBytes);
        for (let i = 0; i < frames; i++) {
            const v = Math.round(amplitudeAt(i / frames) * 32767);
            w16(44 + i * 2, v < 0 ? v + 65536 : v);
        }
        return b;
    };

    /* Big enough to need several ticks: 300k frames = 600 KB = 19 blocks at
     * 32 KB, and the reader does 2 blocks per tick. */
    const FRAMES = 300000;
    const wav = makeWav(FRAMES, (t) => (t > 0.33 && t < 0.66) ? 1 : 0);
    env.setFiles({ '/s/burst.wav': wav });
    resetWavPeaks();

    const WIDTH = PEAK_WIDTH;
    // The job must NOT finish in one tick — that is the whole point of chunking.
    const first = wavPeaksTick('/s/burst.wav');
    eq('first tick does work', first, true);
    eq('first tick does not finish', wavPeaks('/s/burst.wav').done, false);

    let ticks = 1;
    while (!wavPeaks('/s/burst.wav').done && ticks < 500) {
        wavPeaksTick('/s/burst.wav'); ticks++;
    }
    eq('job completes across several ticks', ticks > 1 && ticks < 500, true);

    const pk = wavPeaks('/s/burst.wav');
    eq('one point per column', pk.points.length, WIDTH);
    eq('no error', pk.error, '');
    // The burst sits in the middle third and nowhere else.
    eq('silence at the start', pk.points[2], 0);
    eq('silence at the end', pk.points[WIDTH - 3], 0);
    eq('full scale in the middle', pk.points[Math.floor(WIDTH / 2)] > 0.99, true);
    const loud = pk.points.filter((v) => v > 0.5).length;
    eq('roughly a third of columns are loud', loud > WIDTH * 0.28 && loud < WIDTH * 0.38, true);
    eq('read is chunked, not one big gulp', ticks >= 8, true);

    // Cached: a further tick neither works nor changes the answer.
    eq('completed job does no more work', wavPeaksTick('/s/burst.wav'), false);

    /* Width is NOT part of the cache: peaks are stored at full display
     * resolution and resampled down. Resizing the graphic — mrsample's Loop
     * switch grows it from two cells to four — used to re-read the whole file,
     * a visible stall on a knob turn. */
    const half = resamplePeaks(pk.points, 64);
    eq('resampled to the requested width', half.length, 64);
    eq('resampling keeps the burst', half[32] > 0.99, true);
    eq('resampling keeps the silence', half[2], 0);
    const wide = resamplePeaks(pk.points, 128);
    eq('same width is passed through', wide === pk.points, true);

    /* A sample mixed well below 0 dB must still use the full height: the peak
     * is tracked as blocks fold in and the renderer divides by it. Without it a
     * quiet one-shot draws as a thin line and shows none of its shape. */
    {
        env.setFiles({ '/s/quiet.wav': makeWav(120000, (t) => ((t > 0.4 && t < 0.6) ? 0.08 : 0)) });
        resetWavPeaks();
        let n = 0;
        while (!wavPeaks('/s/quiet.wav')?.done && n < 500) { wavPeaksTick('/s/quiet.wav'); n++; }
        const q = wavPeaks('/s/quiet.wav');
        eq('quiet sample keeps its real peak', Math.abs(q.peak - 0.08) < 0.01, true);
        const gain = 1 / q.peak;
        eq('normalised loudest column reaches full height', q.points[Math.floor(WIDTH / 2)] * gain > 0.99, true);
        eq('normalised silence stays silent', q.points[2] * gain, 0);
    }

    /* 24-bit PCM. Sample libraries ship it constantly — every Neon Drive file
     * on the device is 24-bit — and rejecting it as exotic meant a sampler
     * could not draw its own library. Device verification is what caught it. */
    {
        const make24 = (frames, ampAt) => {
            const dataBytes = frames * 3;
            const b = new Uint8Array(44 + dataBytes);
            const ws2 = (o, t) => { for (let i = 0; i < t.length; i++) b[o + i] = t.charCodeAt(i); };
            const w32 = (o, v) => { b[o] = v & 255; b[o+1] = (v>>8)&255; b[o+2] = (v>>16)&255; b[o+3] = (v>>>24)&255; };
            const w16 = (o, v) => { b[o] = v & 255; b[o+1] = (v>>8)&255; };
            ws2(0, 'RIFF'); w32(4, 36 + dataBytes); ws2(8, 'WAVE');
            ws2(12, 'fmt '); w32(16, 16); w16(20, 1); w16(22, 1);
            w32(24, 44100); w32(28, 132300); w16(32, 3); w16(34, 24);   // blockAlign 3, 24-bit
            ws2(36, 'data'); w32(40, dataBytes);
            for (let i = 0; i < frames; i++) {
                let v = Math.round(ampAt(i / frames) * 8388607);
                if (v < 0) v += 0x1000000;
                const o = 44 + i * 3;
                b[o] = v & 255; b[o+1] = (v>>8)&255; b[o+2] = (v>>16)&255;
            }
            return b;
        };
        env.setFiles({ '/s/24bit.wav': make24(120000, (t) => (t > 0.4 && t < 0.6) ? 1 : 0) });
        resetWavPeaks();
        let n = 0;
        while (!wavPeaks('/s/24bit.wav')?.done && n < 500) { wavPeaksTick('/s/24bit.wav'); n++; }
        const p24 = wavPeaks('/s/24bit.wav');
        eq('24-bit PCM is read', p24.error, '');
        eq('24-bit silence at the start', p24.points[2], 0);
        eq('24-bit full scale in the middle', p24.points[Math.floor(WIDTH / 2)] > 0.99, true);
    }

    /* AIFF — mrsample AND mrdrums both accept .aif/.aiff, and it is the format
     * Move's own recordings use. Big-endian samples in a FORM container, with
     * an 8-byte offset/blockSize preamble inside SSND that is NOT audio; get
     * that wrong and every frame decodes shifted. */
    {
        const makeAiff = (frames, ampAt, { sowt = false, bits = 16 } = {}) => {
            const sb = bits / 8;
            const dataBytes = frames * sb;
            const commSize = sowt ? 22 + 4 + 2 : 18;
            const total = 4 + (8 + commSize) + (8 + 8 + dataBytes);
            const b = new Uint8Array(8 + total);
            const ws2 = (o, t) => { for (let i = 0; i < t.length; i++) b[o + i] = t.charCodeAt(i); };
            const w32be = (o, v) => { b[o] = (v>>>24)&255; b[o+1] = (v>>16)&255; b[o+2] = (v>>8)&255; b[o+3] = v&255; };
            const w16be = (o, v) => { b[o] = (v>>8)&255; b[o+1] = v&255; };
            ws2(0, 'FORM'); w32be(4, total); ws2(8, sowt ? 'AIFC' : 'AIFF');
            let o = 12;
            ws2(o, 'COMM'); w32be(o+4, commSize);
            w16be(o+8, 1);            // 1 channel
            w32be(o+10, frames);
            w16be(o+14, bits);
            // 10-byte extended sample rate left zeroed; unread by movy.
            if (sowt) { ws2(o+8+18, 'sowt'); w16be(o+8+22, 0); }
            o += 8 + commSize;
            ws2(o, 'SSND'); w32be(o+4, 8 + dataBytes);
            /* offset stays 0, but blockSize is deliberately a LOUD bit pattern:
             * if the 8-byte preamble is not skipped it decodes as two
             * full-scale samples at the very start, so the silence assertion
             * below actually catches the classic AIFF mistake. */
            w32be(o+8, 0); w32be(o+12, 0x7FFF7FFF);
            const d = o + 16;
            for (let i = 0; i < frames; i++) {
                let v = Math.round(ampAt(i / frames) * 32767);
                if (v < 0) v += 65536;
                if (sowt) { b[d+i*2] = v & 255; b[d+i*2+1] = (v>>8)&255; }   // little-endian
                else      { b[d+i*2] = (v>>8)&255; b[d+i*2+1] = v & 255; }   // big-endian
            }
            return b;
        };
        const burst = (t) => (t > 0.4 && t < 0.6) ? 1 : 0;

        for (const [name, bytes] of [
            ['big-endian AIFF', makeAiff(120000, burst)],
            ['AIFF-C sowt (little-endian)', makeAiff(120000, burst, { sowt: true })],
        ]) {
            env.setFiles({ '/s/a.aiff': bytes });
            resetWavPeaks();
            let n = 0;
            while (!wavPeaks('/s/a.aiff')?.done && n < 500) { wavPeaksTick('/s/a.aiff'); n++; }
            const pa = wavPeaks('/s/a.aiff');
            eq(name + ': read without error', pa.error, '');
            /* Column 0 specifically: a missed SSND preamble lands its bytes
             * exactly there and nowhere else. */
            eq(name + ': silence in the very first column', pa.points[0], 0);
            eq(name + ': silence at the start', pa.points[2], 0);
            eq(name + ': full scale in the middle', pa.points[Math.floor(WIDTH / 2)] > 0.99, true);
        }

        /* A compressed AIFF-C cannot be decoded here — it must FAIL rather than
         * draw noise from bytes it does not understand. */
        const comp = makeAiff(1000, burst, { sowt: true });
        comp[12 + 8 + 18] = 0x75; comp[12 + 8 + 19] = 0x6c;   // 'ul' → 'ulaw'-ish
        env.setFiles({ '/s/c.aifc': comp });
        resetWavPeaks();
        wavPeaksTick('/s/c.aifc');
        eq('compressed AIFF-C is refused, not guessed at',
            wavPeaks('/s/c.aifc').error !== '', true);
    }

    // Unreadable paths fail once and stay failed rather than retrying forever.
    resetWavPeaks();
    wavPeaksTick('/s/missing.wav');
    eq('missing file reports an error', wavPeaks('/s/missing.wav').error !== '', true);
    eq('missing file does not retry', wavPeaksTick('/s/missing.wav'), false);
}

_log('\nTest: waveform marker inverts over the sample');
{
    const origFill = globalThis.fill_rect;
    const shot = (points, position) => {
        const r = [];
        globalThis.fill_rect = (x, y, w, h, v) => r.push({ x, y, w, h, v });
        drawWavForm(11, { line: 0, startCol: 0, cellCount: 2, points, position, gain: 1 });
        globalThis.fill_rect = origFill;
        return r;
    };
    /* startCol 0, 2 cells: flush at the SCREEN edge on the left (x0 = 0), inset
     * one pixel at the internal boundary on the right. See spanX. */
    const W = 2 * 32 - 1;
    // Quiet everywhere: the marker is a tall LIT line.
    {
        const r = shot(new Array(W).fill(0), 0.5);
        const mx = Math.floor(0.5 * W);
        const lit = r.filter((q) => q.x === mx && q.v === 1);
        const tall = lit.reduce((n, q) => Math.max(n, q.h), 0);
        eq('marker is a tall lit line through silence', tall >= 6, true);
    }
    // Full scale everywhere: the marker becomes a CLEARED notch instead.
    {
        const r = shot(new Array(W).fill(1), 0.5);
        const mx = Math.floor(0.5 * W);
        const cleared = r.filter((q) => q.x === mx && q.v === 0);
        eq('marker is a cleared notch through a loud passage', cleared.length > 0, true);
        eq('the notch spans the sample', cleared[0].h >= 6, true);
    }
    /* The marker must sit in the SAME column the envelope built for that
     * position — column i covers frames [i/w,(i+1)/w). round(p*(w-1)) disagrees
     * for a quarter of all positions and points a pixel off what will play. */
    {
        const markerCol = (p) => {
            const pts = new Array(W).fill(0);
            const r = shot(pts, p);
            const lit = r.filter((q) => q.v === 1 && q.h > 2).map((q) => q.x);
            return Math.min(...lit);
        };
        let off = 0;
        for (let k = 0; k <= 200; k++) {
            const p = k / 200;
            const want = Math.min(W - 1, Math.floor(p * W));
            if (markerCol(p) !== want) off++;
        }
        eq('marker sits in the column that will play, at every position', off, 0);
    }

    // The marker tracks position.
    {
        const at = (p) => {
            const r = shot(new Array(W).fill(0), p);
            return Math.min(...r.filter((q) => q.v === 1 && q.h > 2).map((q) => q.x));
        };
        eq('marker moves left to right', at(0.1) < at(0.9), true);
    }
}

/* ── dumpLayout: external layout snapshot (scripts/dump-movy-layout.mjs) ── */

_log('\nTest: dumpLayout exposes banks + raw params');

{
    const m = bootModel(MOCK_SYNTHS.mrdrums);
    const d = m.dumpLayout();
    eq('dumpLayout: moduleId',        d.moduleId, 'mrdrums');
    eq('dumpLayout: hasConfig',       d.hasConfig, true);
    eq('dumpLayout: drum config exposed', d.drum !== null, true);
    eq('dumpLayout: config bank names present', d.banks.length > 0 && typeof d.banks[0].name, 'string');
    const first = d.params.find(p => p !== null);
    eq('dumpLayout: param has step',  typeof first?.step, 'number');
    eq('dumpLayout: param has renderStyle', typeof first?.renderStyle, 'string');
    // snapshot is a copy — mutating it must not touch the live model
    first.min = -999;
    const range = m.paramRangeByKey(first.key);
    eq('dumpLayout: copies, not references', range?.min === -999, false);
}

{
    const m = bootModel(MOCK_SYNTHS.test8);
    const d = m.dumpLayout();
    eq('dumpLayout: generic path hasConfig=false', d.hasConfig, false);
    eq('dumpLayout: generic path 8 params', d.params.filter(Boolean).length, 8);
    eq('dumpLayout: generic bank count matches model', d.banks.length, m.getBankCount());
    eq('dumpLayout: generic params = banks × 8', d.params.length, d.banks.length * 8);
}

}
