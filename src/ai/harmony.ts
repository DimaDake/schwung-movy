/* The Set's harmonic map, as the generator bench scores against it. Per scene, per master bar: the sounding pitch classes of every melodic
 * clip (transpose and playback speed applied, short clips looped) and the
 * chord they spell best. */

import { type AiClip, TICKS_PER_STEP, STEPS_PER_BAR } from './clip-dump.js';

const PC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const BAR = TICKS_PER_STEP * STEPS_PER_BAR;

/* Four-note chords first: one that is fully present beats the triad inside
 * it. Within a size, list order breaks ties. */
const CHORDS: [string, number[]][] = [
    ['maj7', [0, 4, 7, 11]], ['7', [0, 4, 7, 10]], ['m7', [0, 3, 7, 10]], ['m7b5', [0, 3, 6, 10]],
    ['', [0, 4, 7]], ['m', [0, 3, 7]], ['dim', [0, 3, 6]], ['aug', [0, 4, 8]],
    ['sus4', [0, 5, 7]], ['sus2', [0, 2, 7]],
];

export function pcName(pc: number): string { return PC[((pc % 12) + 12) % 12]; }

function chordName(pcs: Set<number>, bass: number): string {
    let best = '';
    let bestSize = 0;
    let bestBass = false;
    for (const root of pcs) {
        for (const [suffix, iv] of CHORDS) {
            if (iv.length < bestSize || !iv.every((i) => pcs.has((root + i) % 12))) continue;
            const isBass = root === bass;
            if (iv.length > bestSize || (isBass && !bestBass)) {
                best = pcName(root) + suffix;
                bestSize = iv.length;
                bestBass = isBass;
            }
        }
    }
    return best || '?';
}

function clipMasterTicks(c: AiClip): number {
    return Math.round(c.len * TICKS_PER_STEP * c.scaleDen / c.scaleNum);
}

export interface BarChord { pcs: number[]; bass: number; name: string; root: number }

/** Per master bar of the scene: the sounding pitch classes (root first), the
 *  lowest pitch class, and the chord they spell; empty bars have pcs []. */
export function sceneChords(clips: AiClip[], drum: (track: number) => boolean): BarChord[] {
    const melodic = clips.filter((c) => !drum(c.track) && c.len > 0);
    const sceneTicks = Math.max(BAR, ...clips.map(clipMasterTicks));
    const bars = Math.ceil(sceneTicks / BAR);
    const pcs: Set<number>[] = Array.from({ length: bars }, () => new Set());
    const bass: number[] = Array(bars).fill(999);
    for (const c of melodic) {
        const span = clipMasterTicks(c);
        const k = c.scaleDen / c.scaleNum;
        /* Only the loop window plays; notes outside it are parked, not heard. */
        const w0 = c.loopStart * TICKS_PER_STEP;
        const heard = c.notes.filter((n) => n.tick >= w0 && n.tick < w0 + c.len * TICKS_PER_STEP);
        for (let off = 0; off < sceneTicks; off += span) {
            for (const n of heard) {
                const s = off + (n.tick - w0) * k;
                const e = s + Math.max(1, n.gate * k);
                const p = n.pitch + c.transpose;
                for (let b = Math.floor(s / BAR); b < bars && b * BAR < e; b++) {
                    pcs[b].add(((p % 12) + 12) % 12);
                    bass[b] = Math.min(bass[b], p);
                }
            }
        }
    }
    return pcs.map((set, i) => {
        if (set.size === 0) return { pcs: [], bass: -1, name: '', root: -1 };
        const name = chordName(set, bass[i] % 12);
        const root = name === '?' ? bass[i] % 12 : PC.indexOf(name.match(/^[A-G]#?/)![0]);
        const order = [...set].sort((a, b) => ((a - root + 12) % 12) - ((b - root + 12) % 12));
        return { pcs: order, bass: bass[i] % 12, name, root };
    });
}
