/* Reference scenes for the paths bench (plans/2026-11-07-generation-paths-bench.md):
 * every role of a real scene side by side, so relations between parts
 * (bass and kick, chords and bass, lead and chords) have real-music bands.
 * Written to .gen-data/refs.json (git-ignored).
 *   public: MidiCaps / Lakh, an 8-bar window from bar 9 where the drums and
 *           the bass play every bar (the electronic core of a track);
 *   user:   each scene row of the user's Move and Live sets, shorter clips
 *           looped to the longest, as the row sounds.
 *
 *   node scripts/gen-bench/quality/refs.mjs [--sets ~/Documents/Move,~/Documents/Ableton]
 */
import { writeFileSync } from 'node:fs';
import { BAR, CHORDAL, cut, DATA, monoLow, poly, publicSongs, setDirs, userSets } from './ref-sources.mjs';
import { drumRoles } from './relations.mjs';

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const busiest = (parts) => [...parts].sort((a, b) => b.notes.length - a.notes.length)[0];
const LEAD_MIN = 60;

function publicScene({ src, genre, mid }) {
    const drums = mid.tracks.filter((t) => t.channel === 9);
    const parts = mid.tracks.filter((t) => t.channel !== 9 && t.notes.length);
    const bass = busiest(parts.filter((t) => (t.program >= 32 && t.program <= 39) || /bass/i.test(t.name ?? '')));
    if (!bass || !drums.length) return null;
    const every = (ns, b0) => [...Array(8)].every((_, k) => ns.some((n) => n.tick >= (b0 + k) * BAR && n.tick < (b0 + k + 1) * BAR));
    const dn = drums.flatMap((t) => t.notes);
    let w = -1;
    for (let b0 = 8; b0 < 64 && w < 0; b0 += 4) if (every(bass.notes, b0) && every(dn, b0)) w = b0;
    if (w < 0) return null;
    const rest = parts.filter((t) => t !== bass).map((t) => ({ program: t.program, notes: cut(t.notes, w) })).filter((t) => t.notes.length >= 6);
    const chords = rest.filter((t) => CHORDAL(t.program) || poly(t.notes)).map((t) => t.notes);
    const lead = busiest(rest.filter((t) => !CHORDAL(t.program) && !poly(t.notes) && median(t.notes.map((n) => n[2])) >= LEAD_MIN));
    return { src, kind: 'public', genre, len: 32, bass: cut(bass.notes, w), chords, lead: lead?.notes ?? [], ...drumRoles(cut(dn, w)) };
}

/** A clip looped to fill len beats. */
const tile = (c, len) => (c.len >= len ? c.notes : [...Array(Math.ceil(len / c.len))].flatMap((_, k) => c.notes.map((n) => [n[0] + k * c.len, ...n.slice(1)])).filter((n) => n[0] < len));

function userScenes(src, rows, out, seen) {
    for (const [, clips] of rows) {
        const cs = clips.filter((c) => c.len > 0 && c.notes.length);
        const drum = busiest(cs.filter((c) => c.drum));
        const mel = cs.filter((c) => !c.drum);
        const bass = busiest(mel.filter((c) => !poly(c.notes) && (/bass/i.test(c.name) || monoLow(c.notes))));
        const chords = mel.filter((c) => poly(c.notes));
        const lead = busiest(mel.filter((c) => c !== bass && !poly(c.notes) && median(c.notes.map((n) => n[2])) >= LEAD_MIN));
        if ([drum, bass, chords[0], lead].filter(Boolean).length < 2) continue;
        const len = Math.min(64, Math.max(...[drum, bass, lead, ...chords].filter(Boolean).map((c) => c.len)));
        const id = JSON.stringify([drum, bass, lead, ...chords].map((c) => c?.notes));
        if (seen.has(id)) continue;
        seen.add(id);
        out.push({ src, kind: 'user', len, bass: bass ? tile(bass, len) : [], chords: chords.map((c) => tile(c, len)),
            lead: lead ? tile(lead, len) : [], ...drumRoles(drum ? tile(drum, len) : []) });
    }
}

const out = [], seen = new Set();
for (const s of publicSongs()) { const sc = publicScene(s); if (sc) out.push(sc); }
for (const { src, rows } of userSets(setDirs(process.argv))) userScenes(src, rows, out, seen);
writeFileSync(DATA + 'refs.json', JSON.stringify(out));
const n = (k, f = () => true) => out.filter((o) => o.kind === k && f(o)).length;
console.log(`refs: ${n('public')} public (${n('public', (o) => o.lead.length)} with lead, ${n('public', (o) => o.chords.length)} with chords), `
    + `${n('user')} user scenes (${n('user', (o) => o.kick.length)} with kick, ${n('user', (o) => o.bass.length)} with bass) → .gen-data/refs.json`);
