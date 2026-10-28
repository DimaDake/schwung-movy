/* Method 4, the piece (plans/2026-10-29-generator-quality-metrics.md): a
 * scripted user builds a song with nothing but the generators. Scene A: New
 * Clip drums, bass, chords, lead in that order (or around a four-note motif
 * the user played). Scene B: Variation, track by track, taking whichever
 * option the seed points at — any option must be one a user could keep.
 * Scene A': each A clip copied and Smart Doubled, track by track. The piece
 * is then judged as a listener hears it: the tracks together, scene by scene. */

const KIT = [36, 37, 38, 39, 42, 44, 46, 49, 51, 41, 43, 45];
const KEYS = [['C', 'minor'], ['F', 'major'], ['A', 'minor'], ['D', 'minor'], ['G', 'major'], ['E', 'minor'], ['Bb', 'major'], ['F#', 'minor']];
const ROOT = { C: 0, 'C#': 1, D: 2, Eb: 3, E: 4, F: 5, 'F#': 6, G: 7, Ab: 8, A: 9, Bb: 10, B: 11 };
export const PARTS = [
    { index: 0, name: 'Drums', drum: true, want: ['n-groove', 'n-broken', 'n-euclid-kit'] },
    { index: 1, name: 'Bass', drum: false, want: ['n-bass'] },
    { index: 2, name: 'Chords', drum: false, want: ['n-chords', 'n-stabs', 'n-pad'] },
    { index: 3, name: 'Lead', drum: false, want: ['n-melody', 'n-riff', 'n-arp', 'n-counter'] },
];
const LEN = 64;

const clip = (track, slot, len, notes) => ({ track, slot, len, loopStart: 0, scaleNum: 1, scaleDen: 1, transpose: 0, quant: 0, notes });

function put(tracks, track, slot, c) {
    const t = tracks.find((x) => x.index === track);
    t.clips = [...t.clips.filter((x) => x.slot !== slot), c];
}

/* The user's minimal input: four notes in the first bar, on the key's scale. */
function motif(G, seed, root, minor) {
    const r = G.rng(seed);
    const sc = minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
    let deg = 0;
    return [0, 4, 8, 12].map((step, i) => {
        if (i) deg = Math.max(-2, Math.min(6, deg + [-2, -1, 1, 2, 3][Math.floor(r() * 5)]));
        const p = 60 + root + Math.floor(deg / 7) * 12 + sc[((deg % 7) + 7) % 7];
        return { tick: step * 24, gate: 48 + 24 * Math.floor(r() * 3), pitch: p, vel: 100 };
    });
}

const base = (set, drum) => ({ level: 'BALANCED', tracks: set.tracks, scale: [1, 1], drum, kit: drum ? KIT : [], root: set.root, mode: set.mode });

export function buildPiece(G, seed, withMotif) {
    const [root, mode] = KEYS[seed % KEYS.length];
    const set = { root, mode, bpm: 118 + (seed % 5) * 4,
        tracks: PARTS.map((p) => ({ index: p.index, name: p.name, module: p.drum ? 'drumrack' : 'obxd', drum: p.drum, padNames: null, clips: [] })) };
    const log = [];
    if (withMotif) put(set.tracks, 3, 0, clip(3, 0, 16, motif(G, seed, ROOT[root], mode === 'minor')));
    for (const p of PARTS) {
        if (withMotif && p.index === 3) continue;
        G.forgetOptions();
        const { picks } = G.generateAll({ ...base(set, p.drum), task: 'create', target: { track: p.index, slot: 0 }, source: null,
            len: LEN, nonce: seed * 7 + p.index });
        const want = [...p.want.slice(seed % p.want.length), ...p.want];
        const pick = want.map((id) => picks.find((x) => x.preset.id === id)).find(Boolean) ?? picks[0];
        log.push(`A ${p.name}: ${pick?.preset.id ?? 'NONE'}`);
        if (pick) put(set.tracks, p.index, 0, clip(p.index, 0, LEN, pick.notes));
    }
    for (const p of PARTS) {
        const src = set.tracks[p.index].clips.find((c) => c.slot === 0);
        if (!src) continue;
        const { picks } = G.generateAll({ ...base(set, p.drum), task: 'variation', target: { track: p.index, slot: 1 },
            source: { track: p.index, slot: 0 }, len: src.len }, 6);
        const pick = picks.length ? picks[(seed + p.index) % picks.length] : null;
        log.push(`B ${p.name}: ${pick?.preset.id ?? 'NONE'}`);
        if (pick) put(set.tracks, p.index, 1, clip(p.index, 1, src.len, pick.notes));
    }
    for (const p of PARTS) {
        const src = set.tracks[p.index].clips.find((c) => c.slot === 0);
        if (src) put(set.tracks, p.index, 2, clip(p.index, 2, src.len, src.notes.map((n) => ({ ...n }))));
    }
    for (const p of PARTS) {
        const src = set.tracks[p.index].clips.find((c) => c.slot === 2);
        if (!src || src.len * 2 > 256) continue;
        const { picks } = G.generateAll({ ...base(set, p.drum), task: 'double', target: { track: p.index, slot: 2 }, source: null,
            len: src.len * 2 });
        const pick = picks.length ? picks[(seed + p.index + 1) % picks.length] : null;
        log.push(`A' ${p.name}: ${pick?.preset.id ?? 'NONE'}`);
        if (pick) put(set.tracks, p.index, 2, clip(p.index, 2, src.len * 2, pick.notes));
    }
    return { seed, motif: withMotif, set, log };
}
