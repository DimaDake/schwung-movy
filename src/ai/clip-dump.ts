/* The engine's `ait:<t>` answer (engine/ai_clip.rs) as data. One line per
 * existing clip: `slot len loopStart num/den transpose quant|t.g.p.v,...`.
 * Pitches are STORED (untransposed); `transpose` travels beside them. */

export interface AiNote { tick: number; gate: number; pitch: number; vel: number }

export interface AiClip {
    track: number;
    slot: number;
    len: number;          // steps
    loopStart: number;    // steps
    scaleNum: number;
    scaleDen: number;
    transpose: number;
    quant: number;
    notes: AiNote[];
}

export const TICKS_PER_STEP = 24;
export const STEPS_PER_BAR = 16;

export function parseNotes(s: string): AiNote[] {
    if (!s || s === '-') return [];
    const out: AiNote[] = [];
    for (const item of s.split(',')) {
        const [tick, gate, pitch, vel] = item.split('.').map(Number);
        if ([tick, gate, pitch, vel].every(Number.isFinite)) out.push({ tick, gate, pitch, vel });
    }
    return out;
}

export function formatNotes(notes: AiNote[]): string {
    return notes.length ? notes.map((n) => `${n.tick}.${n.gate}.${n.pitch}.${n.vel}`).join(',') : '-';
}

export function parseTrackDump(track: number, s: string): AiClip[] {
    const out: AiClip[] = [];
    if (!s) return out;
    for (const line of s.split('\n')) {
        const bar = line.indexOf('|');
        if (bar < 0) continue;
        const f = line.slice(0, bar).split(' ');
        const [num, den] = (f[3] || '1/1').split('/').map(Number);
        out.push({
            track, slot: Number(f[0]), len: Number(f[1]), loopStart: Number(f[2]),
            scaleNum: num || 1, scaleDen: den || 1, transpose: Number(f[4]) || 0, quant: Number(f[5]) || 0,
            notes: parseNotes(line.slice(bar + 1)),
        });
    }
    return out;
}
