/* A format-1 Standard MIDI File from movy notes (96 ticks per quarter, as
 * midi.mjs reads them), so a bench piece can be listened to in any DAW. */

const TPQ = 96;

function vlq(n) {
    const out = [n & 0x7F];
    while ((n >>= 7)) out.unshift((n & 0x7F) | 0x80);
    return out;
}

function chunk(type, bytes) {
    const n = bytes.length;
    return [...type].map((c) => c.charCodeAt(0)).concat([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255], bytes);
}

function trackBytes({ name, channel, notes }, tempo) {
    const ev = [];
    for (const n of notes) {
        ev.push([n.tick, 1, [0x90 | channel, n.pitch, Math.max(1, Math.min(127, n.vel))]]);
        ev.push([n.tick + Math.max(1, n.gate), 0, [0x80 | channel, n.pitch, 0]]);
    }
    ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);          // offs before ons at one tick
    const head = [0, 0xFF, 0x03, ...vlq(name.length), ...[...name].map((c) => c.charCodeAt(0) & 0x7F)];
    if (tempo) head.push(0, 0xFF, 0x51, 3, (tempo >>> 16) & 255, (tempo >>> 8) & 255, tempo & 255);
    const body = [];
    let at = 0;
    for (const [t, , bytes] of ev) { body.push(...vlq(t - at), ...bytes); at = t; }
    return chunk('MTrk', [...head, ...body, 0, 0xFF, 0x2F, 0]);
}

/** tracks: [{ name, channel (0-15), notes }] */
export function writeMidi(tracks, bpm = 120) {
    const header = chunk('MThd', [0, 1, 0, tracks.length, (TPQ >> 8) & 255, TPQ & 255]);
    const tempo = Math.round(60_000_000 / bpm);
    return Uint8Array.from([...header, ...tracks.flatMap((t, i) => trackBytes(t, i === 0 ? tempo : 0))]);
}
