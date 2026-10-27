/* Standard MIDI File reader for the generator bench: notes in movy's own time
 * base (24 ticks per 16th = 96 per quarter), one entry per (track, channel),
 * so a format-0 file with drums on channel 10 still comes apart by part. */

const MOVY_TPQ = 96;

function readVar(b, i) {
    let v = 0;
    for (;;) {
        const c = b[i++];
        v = (v << 7) | (c & 0x7F);
        if (!(c & 0x80)) return [v, i];
    }
}

function readTrack(b, start, end, scale) {
    const parts = new Map();          // channel -> { notes, open: Map(pitch -> [note]) }
    let name = '';
    let tick = 0, status = 0, i = start;
    const tempos = [];
    const part = (ch) => {
        if (!parts.has(ch)) parts.set(ch, { notes: [], open: new Map(), program: 0 });
        return parts.get(ch);
    };
    while (i < end) {
        let d;
        [d, i] = readVar(b, i);
        tick += d;
        let s = b[i];
        if (s & 0x80) i++; else s = status;          // running status
        if (s === 0xFF) {
            const type = b[i++];
            let len;
            [len, i] = readVar(b, i);
            if (type === 0x03 && !name) name = new TextDecoder().decode(b.subarray(i, i + len));
            if (type === 0x51) tempos.push(60e6 / ((b[i] << 16) | (b[i + 1] << 8) | b[i + 2]));
            i += len;
            if (type === 0x2F) break;
            continue;
        }
        if (s === 0xF0 || s === 0xF7) {
            let len;
            [len, i] = readVar(b, i);
            i += len;
            continue;
        }
        status = s;
        const kind = s & 0xF0, ch = s & 0x0F;
        const a = b[i++];
        const v = kind === 0xC0 || kind === 0xD0 ? 0 : b[i++];
        if (kind === 0xC0) part(ch).program = a;
        if (kind !== 0x90 && kind !== 0x80) continue;
        const p = part(ch);
        const t = Math.round(tick * scale);
        if (kind === 0x90 && v > 0) {
            const n = { tick: t, gate: 1, pitch: a, vel: v };
            p.notes.push(n);
            if (!p.open.has(a)) p.open.set(a, []);
            p.open.get(a).push(n);
        } else {
            const n = p.open.get(a)?.shift();
            if (n) n.gate = Math.max(1, t - n.tick);
        }
    }
    const out = [...parts].map(([channel, p]) => ({ name, channel, program: p.program, notes: p.notes }));
    return { parts: out, tempos };
}

/** { tpq, bpm, tracks: [{ name, channel, program, notes: AiNote[] }] } in movy ticks. */
export function parseMidi(buf) {
    const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    const u32 = (i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
    if (String.fromCharCode(...b.subarray(0, 4)) !== 'MThd') throw new Error('not a MIDI file');
    const div = (b[12] << 8) | b[13];
    if (div & 0x8000) throw new Error('SMPTE time base not supported');
    const scale = MOVY_TPQ / div;
    let i = 8 + u32(4);
    const tracks = [];
    let bpm = 120, gotTempo = false;
    while (i + 8 <= b.length) {
        const len = u32(i + 4);
        if (String.fromCharCode(...b.subarray(i, i + 4)) === 'MTrk') {
            const r = readTrack(b, i + 8, i + 8 + len, scale);
            tracks.push(...r.parts.filter((p) => p.notes.length));
            if (!gotTempo && r.tempos.length) { bpm = r.tempos[0]; gotTempo = true; }
        }
        i += 8 + len;
    }
    return { tpq: div, bpm, tracks };
}
