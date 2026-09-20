/* browser-test/logic/wav-fixture.mjs — a real 16-bit mono WAV byte-builder.
 *
 * Shared by wav-peaks.mjs (movy's own model/wav-peaks.ts) and
 * schwung-sample.mjs (Schwung's wav_peaks.mjs, through the delegated grid) so
 * neither suite hand-rolls WAV bytes twice. Building real bytes rather than
 * mocking the parser is the point — an off-by-one in a chunk header or a
 * stride would sail past a fake.
 */

export function makeWav(frames, amplitudeAt) {
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
}
