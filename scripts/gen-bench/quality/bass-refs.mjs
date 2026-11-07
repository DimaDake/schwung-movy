/* The bass bench's reference parts (plans/2026-11-06-bass-over-chords-evaluation.md),
 * written to .gen-data/bass-refs.json (git-ignored: the user's sets and a
 * dataset never enter the repo):
 *   public: MidiCaps / Lakh bass parts (GM 32-39), an 8-bar window from bar 9
 *           with the chordal parts and the kick beside them (fetch.mjs first);
 *   user:   bass clips from Move set bundles (Song.abl) and Live sets (.als)
 *           under the given folders, with the chordal clips of their scene row.
 *
 *   node scripts/gen-bench/quality/bass-refs.mjs [--sets ~/Documents/Move,~/Documents/Ableton]
 */
import { writeFileSync } from 'node:fs';
import { BAR, CHORDAL, cut, DATA, monoLow, poly, publicSongs, setDirs, userSets } from './ref-sources.mjs';

function emit(src, rows, out, seen) {
    for (const [, clips] of rows) {
        const chords = clips.filter((c) => !c.drum && poly(c.notes)).map((c) => c.notes);
        for (const c of clips) {
            if (c.drum || c.len <= 0 || poly(c.notes) || !(/bass/i.test(c.name) || monoLow(c.notes))) continue;
            const id = JSON.stringify([...c.notes].sort());
            if (seen.has(id)) continue;
            seen.add(id);
            out.push({ src, kind: 'user', len: c.len, notes: c.notes, chords, kick: [] });
        }
    }
}

function publicParts(out) {
    for (const { src, mid } of publicSongs()) {
        const parts = mid.tracks.filter((t) => t.channel !== 9);
        const bass = parts.filter((t) => (t.program >= 32 && t.program <= 39) || /bass/i.test(t.name ?? '')).sort((a, b) => b.notes.length - a.notes.length)[0];
        if (!bass) continue;
        let w = -1;
        for (let b0 = 8; b0 < 64 && w < 0; b0 += 4) {
            if ([...Array(8)].every((_, k) => bass.notes.some((n) => n.tick >= (b0 + k) * BAR && n.tick < (b0 + k + 1) * BAR))) w = b0;
        }
        if (w < 0) continue;
        out.push({ src, kind: 'public', len: 32, notes: cut(bass.notes, w),
            chords: parts.filter((t) => t !== bass && CHORDAL(t.program)).map((t) => cut(t.notes, w)).filter((c) => c.length >= 6),
            kick: mid.tracks.filter((t) => t.channel === 9).flatMap((t) => cut(t.notes.filter((n) => n.pitch === 35 || n.pitch === 36), w)) });
    }
}

const out = [], seen = new Set();
publicParts(out);
for (const { src, rows } of userSets(setDirs(process.argv))) emit(src, rows, out, seen);
writeFileSync(DATA + 'bass-refs.json', JSON.stringify(out));
const n = (k) => out.filter((o) => o.kind === k).length;
console.log(`bass refs: ${n('public')} public, ${n('user')} user → .gen-data/bass-refs.json`);
