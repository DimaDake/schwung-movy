/* How a bench piece sounds (piece.mjs), judged with the bench's own scorer
 * rather than the generators' internal plans, so a generator cannot grade its
 * own homework: the scene's chords are what its tracks sound (sceneChords),
 * a clash is a semitone against a note another track holds at that moment. */
import { fit } from '../score.mjs';
import { writeMidi } from './midi-write.mjs';
import { clashShare } from './musical.mjs';

const TPS = 24, BAR = 384;
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
export const SCENES = [[0, 'A'], [1, 'B'], [2, "A'"]];

/** A scene's clips, each looped to the scene's length. */
function scene(set, slot) {
    const clips = set.tracks.flatMap((t) => t.clips.filter((c) => c.slot === slot && c.notes.length).map((c) => ({ t, c })));
    const span = Math.max(BAR, ...clips.map(({ c }) => c.len * TPS));
    return { span, parts: clips.map(({ t, c }) => {
        const out = [];
        for (let off = 0; off < span; off += c.len * TPS) for (const n of c.notes) if (n.tick < c.len * TPS && n.tick + off < span) out.push({ ...n, tick: n.tick + off });
        return { track: t.index, name: t.name, drum: t.drum, clip: c, notes: out };
    }) };
}

export function judgeScene(G, set, slot) {
    const { parts } = scene(set, slot);
    const mel = parts.filter((p) => !p.drum);
    const clashes = mel.map((p) => clashShare(G, p.notes, mel.filter((q) => q !== p).flatMap((q) => q.notes)));
    const fits = mel.map((p) => fit(p.clip.notes, { drum: false, set: { tracks: set.tracks, target: { track: p.track, slot }, source: null } }) ?? 1);
    const low = mel.filter((p) => median(p.notes.map((n) => n.pitch)) < 52);
    const drums = parts.find((p) => p.drum);
    const kickSteps = new Set((drums?.notes ?? []).filter((n) => n.pitch === 36).map((n) => Math.round(n.tick / TPS)));
    const bass = mel.find((p) => p.name === 'Bass');
    const lock = bass && kickSteps.size ? bass.notes.filter((n) => kickSteps.has(Math.round(n.tick / TPS))).length / bass.notes.length : null;
    const clash = Math.max(0, ...clashes), worst = fits.length ? Math.min(...fits) : 1;
    const v = clash <= 0.08 && worst >= 0.72 && low.length <= 1 ? 'musical' : clash <= 0.2 && worst >= 0.55 ? 'experimental' : 'broken';
    return { slot, clash, fit: mean(fits), worst, mud: low.length > 1, lock, verdict: v, parts: parts.length };
}

/** How the piece holds together across scenes: roles kept, B related to A
 *  but not a copy, A' progressing past A. */
export function judgePiece(G, ai, piece) {
    const { set } = piece;
    const scenes = SCENES.map(([slot]) => judgeScene(G, set, slot));
    let roleBreaks = 0, copies = 0;
    const ab = [];
    for (const t of set.tracks) {
        const a = t.clips.find((c) => c.slot === 0);
        if (!a) continue;
        /* The product's own rules, not the role classifier's labels: a pad
         * whose notes got a step shorter is not a broken role (ai/role.ts). */
        const ra = ai.roleOf(a.notes, a.len, t.drum);
        for (const slot of [1, 2]) {
            const c = t.clips.find((x) => x.slot === slot);
            if (!c || !ra) continue;
            const src = slot === 2 ? [...a.notes, ...a.notes.map((n) => ({ ...n, tick: n.tick + a.len * TPS }))] : a.notes;
            if (ai.roleBreak(c.notes, ai.roleOf(src, c.len, t.drum), c.len, G.ONSET_SLACK)) roleBreaks++;
        }
        const b = t.clips.find((c) => c.slot === 1);
        if (b) {
            ab.push(G.difference(a.notes, b.notes));
            if (ai.isSameLoop(b.notes, [a.notes], b.len, t.drum)) copies++;
        }
    }
    const names = (slot) => {
        const clips = set.tracks.flatMap((t) => t.clips.filter((c) => c.slot === slot));
        return new Set(ai.sceneChords(clips, (i) => set.tracks[i]?.drum).filter((c) => c.pcs.length).map((c) => c.name)).size;
    };
    const ok = scenes.every((s) => s.verdict !== 'broken') && !roleBreaks && !copies;
    return { seed: piece.seed, motif: piece.motif, scenes, roleBreaks, copies, ab: mean(ab), chordsA: names(0), chordsA2: names(2),
        verdict: !ok ? 'broken' : scenes.every((s) => s.verdict === 'musical') ? 'musical' : 'experimental', log: piece.log };
}

/** The piece as a song: A A B B A' (A' is twice as long). */
export function pieceMidi(piece) {
    const order = [0, 0, 1, 1, 2];
    const tracks = piece.set.tracks.map((t) => {
        const notes = [];
        let at = 0;
        for (const slot of order) {
            const s = scene(piece.set, slot);
            const mine = s.parts.find((p) => p.track === t.index);
            if (mine) for (const n of mine.notes) notes.push({ ...n, tick: n.tick + at });
            at += s.span;
        }
        return { name: t.name, channel: t.drum ? 9 : t.index, notes };
    });
    return writeMidi(tracks, piece.set.bpm);
}
