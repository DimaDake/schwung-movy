import { WAVEFORM_POINTS } from './constants.js';

/* Read WAVEFORM_POINTS evenly-spaced amplitude values from a PCM WAV file.
 * Returns null if the file cannot be read or is not a valid PCM WAV. */
export function loadWaveformPreview(path: string): number[] | null {
    const fd = os.open(path, os.O_RDONLY);
    if (fd < 0) return null;
    try {
        // Scan up to 1 KB of header — handles LIST/JUNK chunks before "data"
        const hdr = new ArrayBuffer(1024);
        const n   = os.read(fd, hdr, 0, 1024);
        if (n < 44) return null;

        const v = new DataView(hdr);
        if (v.getUint32(0, false)  !== 0x52494646) return null; // "RIFF"
        if (v.getUint32(8, false)  !== 0x57415645) return null; // "WAVE"
        if (v.getUint32(12, false) !== 0x666d7420) return null; // "fmt "

        const fmtSize    = v.getUint32(16, true);
        const channels   = v.getUint16(22, true);
        const bps        = v.getUint16(34, true);
        const blockAlign = v.getUint16(32, true);
        if (!channels || !bps || !blockAlign) return null;

        // Walk chunks after fmt to find "data"
        let pos = 20 + fmtSize + (fmtSize & 1);  // first byte after fmt chunk
        let dataOff = -1, dataSize = 0;
        while (pos + 8 <= n) {
            const id  = v.getUint32(pos, false);
            const sz  = v.getUint32(pos + 4, true);
            if (id === 0x64617461) { dataOff = pos + 8; dataSize = sz; break; }
            pos += 8 + sz + (sz & 1);
        }
        if (dataOff < 0 || !dataSize) return null;

        const totalFrames = Math.floor(dataSize / blockAlign);
        const result      = new Array<number>(WAVEFORM_POINTS);
        const frameBuf    = new ArrayBuffer(blockAlign);

        for (let i = 0; i < WAVEFORM_POINTS; i++) {
            const fi = Math.floor(i * totalFrames / WAVEFORM_POINTS);
            os.seek(fd, dataOff + fi * blockAlign, 0);
            if (os.read(fd, frameBuf, 0, blockAlign) < 2) { result[i] = 0; continue; }
            const fv = new DataView(frameBuf);
            let amp = 0;
            if      (bps ===  8) amp = Math.abs(fv.getUint8(0) - 128) / 128;
            else if (bps === 16) amp = Math.abs(fv.getInt16(0, true)) / 32768;
            else if (bps === 24) amp = Math.abs((fv.getInt8(2) << 16) | fv.getUint16(0, true)) / 8388608;
            else if (bps === 32) amp = Math.abs(fv.getInt32(0, true)) / 2147483648;
            result[i] = amp;
        }
        return result;
    } catch { return null; }
    finally   { os.close(fd); }
}
