/* The audition page's logic without a DOM (plans/2026-11-07-gen-audition-plan.md,
 * Task 4), so node tests it and the page and report.mjs share one reading of
 * a rating. Notes are [start, dur, pitch, vel] in 96ths of a beat. */
import { writeMidi } from '../../quality/midi-write.mjs';

export const TRACKS = ['drums', 'bass', 'chords', 'lead'];
export const REASONS = ['clash', 'too busy', 'too sparse', 'off-groove', 'boring', 'wrong register', "doesn't fit scene", 'other'];

/** One rating's database document: one per case and option, so a second
 *  rating replaces the first. */
export function ratingDoc(c, option, rating, reasons, marks, text, at = Date.now()) {
    const o = option ?? null;
    return { id: `${c.id}~${o ?? 'p'}`, data: { caseId: c.id, recipeKey: c.recipeKey, build: c.build, kind: c.kind, generator: c.generator,
        option: o, preset: o === null ? c.generator : c.options[o].preset, rating, reasons, marks, text, at } };
}

/** The scene's tracks with option `o`'s notes in the part under test. */
export function tracksFor(c, o) {
    return o === null || o === undefined || !c.options ? c.scene.tracks : { ...c.scene.tracks, [c.target]: c.options[o].notes };
}

/** Notes sounding in [from, to) beats of a `len`-beat loop, seconds after `from`. */
export function schedule(tracks, len, from, to, bpm, muted, solo) {
    const spb = 60 / bpm, out = [];
    for (const track of TRACKS) {
        if (muted.has(track) || (solo && solo !== track)) continue;
        for (let k = Math.floor(from / len); k * len < to; k++) {
            for (const [s, d, pitch, vel] of tracks[track] ?? []) {
                const b = s / 96 + k * len;
                if (b >= from && b < to) out.push({ track, t: (b - from) * spb, dur: Math.max(0.02, (d / 96) * spb), pitch, vel });
            }
        }
    }
    return out.sort((a, b) => a.t - b.t || TRACKS.indexOf(a.track) - TRACKS.indexOf(b.track));
}

/** Where a tap at `x` (0-1 across the roll) lands, as bar and beat (1-based, 4/4). */
export function markAt(x, scene) {
    const b = Math.min(scene.len - 1, Math.max(0, Math.floor(x * scene.len)));
    return { bar: Math.floor(b / 4) + 1, beat: (b % 4) + 1 };
}

/* Ratings not yet in the database (no db, a refused write): kept and sent later. */
export const enqueue = (list, doc) => [...list.filter((d) => d.id !== doc.id), doc];
export const drop = (list, id) => list.filter((d) => d.id !== id);

/** The first case at or after `from` not rated yet (queue.length when none). */
export function nextIndex(queue, rated, from) {
    let i = Math.max(0, from);
    while (i < queue.length && rated.has(queue[i].id)) i++;
    return i;
}

/** Where the ear and the bench disagree. */
export function earVsBench(bench, rating) {
    if (bench.ok && rating === 'bad') return 'benchOkUserBad';
    if (!bench.ok && rating === 'keep') return 'benchBadUserKeep';
    return null;
}

/** The case as a MIDI file to play on the Move (drums on channel 10). */
export function caseMidi(c, o) {
    const ts = tracksFor(c, o);
    return writeMidi(TRACKS.map((t, i) => ({ name: t, channel: i ? i - 1 : 9,
        notes: (ts[t] ?? []).map(([tick, gate, pitch, vel]) => ({ tick, gate, pitch, vel })) })), c.scene.bpm);
}
