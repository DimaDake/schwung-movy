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
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { gunzipSync } from 'node:zlib';
import { parseMidi } from '../midi.mjs';

const DATA = new URL('../../../.gen-data/', import.meta.url).pathname;
const arg = process.argv.indexOf('--sets');
const SETS = (arg > 0 ? process.argv[arg + 1] : '~/Documents/Move,~/Documents/Ableton,~/Downloads').split(',').map((d) => d.replace(/^~/, homedir()));

const startsBy = (ns) => ns.reduce((m, n) => m.set(n[0].toFixed(3), (m.get(n[0].toFixed(3)) ?? 0) + 1), new Map());
const poly = (ns) => ns.length >= 3 && [...startsBy(ns).values()].filter((v) => v >= 3).length / Math.max(1, startsBy(ns).size) > 0.4;
const monoLow = (ns) => ns.length >= 3 && [...ns].sort((a, b) => a[2] - b[2])[ns.length >> 1][2] < 52
    && [...startsBy(ns).values()].filter((v) => v > 1).length / startsBy(ns).size < 0.2;

function walk(dir, ext, out = []) {
    let names = [];
    try { names = readdirSync(dir); } catch { return out; }
    for (const n of names) {
        const p = dir + '/' + n;
        if (n === 'Backup' || n.startsWith('.')) continue;
        if (n.endsWith(ext)) out.push(p);
        else { try { if (statSync(p).isDirectory()) walk(p, ext, out); } catch { /* unreadable */ } }
    }
    return out;
}

/* rows: Map row -> [{ name, len, notes, drum }] */
function emit(src, rows, out, seen) {
    for (const [row, clips] of rows) {
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

function moveBundle(p, out, seen) {
    let song;
    try { song = JSON.parse(execFileSync('unzip', ['-p', p, 'Song.abl'], { maxBuffer: 1 << 28 }).toString()); } catch { return; }
    const rows = new Map();
    for (const t of song.tracks ?? []) {
        if (t.kind !== 'midi') continue;
        const drum = JSON.stringify(t.devices ?? []).includes('drumRack');
        (t.clipSlots ?? []).forEach((s, i) => {
            const c = s.clip;
            if (!c) return;
            const { start, end } = c.region.loop;
            const notes = (c.notes ?? []).filter((n) => n.startTime >= start && n.startTime < end).map((n) => [n.startTime - start, n.duration, n.noteNumber, n.velocity]);
            rows.set(i, [...(rows.get(i) ?? []), { name: t.name ?? '', len: end - start, notes, drum }]);
        });
    }
    emit('move:' + p.split('/').pop(), rows, out, seen);
}

const val = (xml, tag) => Number((xml.match(new RegExp(`<${tag} Value="([^"]*)"`)) ?? [])[1]);
function liveSet(p, out, seen) {
    let xml;
    try { xml = gunzipSync(readFileSync(p)).toString(); } catch { return; }
    const rows = new Map();
    for (const tr of xml.split('<MidiTrack ').slice(1)) {
        const body = tr.slice(0, tr.indexOf('</MidiTrack>'));
        const name = (body.match(/<EffectiveName Value="([^"]*)"/) ?? [])[1] ?? '';
        const drum = body.includes('<DrumGroupDevice');
        body.split('<ClipSlot ').slice(1).forEach((slot, i) => {
            const clip = slot.slice(0, slot.indexOf('</ClipSlot>'));
            if (!clip.includes('<MidiClip')) return;
            const ls = val(clip, 'LoopStart'), le = val(clip, 'LoopEnd');
            const notes = [];
            for (const kt of clip.split('<KeyTrack ').slice(1)) {
                const key = val(kt, 'MidiKey');
                for (const ev of kt.matchAll(/<MidiNoteEvent Time="([^"]*)" Duration="([^"]*)" Velocity="([^"]*)"[^>]*?(IsEnabled="false")?[^>]*\/>/g)) {
                    const t = Number(ev[1]);
                    if (!ev[4] && t >= ls && t < le) notes.push([t - ls, Number(ev[2]), key, Number(ev[3])]);
                }
            }
            rows.set(i, [...(rows.get(i) ?? []), { name, len: le - ls, notes, drum }]);
        });
    }
    emit('live:' + p.split('/').slice(-2).join('/'), rows, out, seen);
}

const CHORDAL = (p) => p <= 7 || (p >= 16 && p <= 31) || (p >= 48 && p <= 55) || (p >= 88 && p <= 95);
function publicParts(out) {
    const listFile = DATA + 'src/midicaps-selected.json';
    if (!existsSync(listFile)) { console.error('no MidiCaps: run scripts/gen-bench/fetch.mjs'); return; }
    const BAR = 384;
    for (const s of JSON.parse(readFileSync(listFile, 'utf8'))) {
        let mid;
        try { mid = parseMidi(readFileSync(DATA + 'src/midicaps/' + s.location)); } catch { continue; }
        const parts = mid.tracks.filter((t) => t.channel !== 9);
        const bass = parts.filter((t) => (t.program >= 32 && t.program <= 39) || /bass/i.test(t.name ?? '')).sort((a, b) => b.notes.length - a.notes.length)[0];
        if (!bass) continue;
        let w = -1;
        for (let b0 = 8; b0 < 64 && w < 0; b0 += 4) {
            if ([...Array(8)].every((_, k) => bass.notes.some((n) => n.tick >= (b0 + k) * BAR && n.tick < (b0 + k + 1) * BAR))) w = b0;
        }
        if (w < 0) continue;
        const cut = (ns) => ns.filter((n) => n.tick >= w * BAR && n.tick < (w + 8) * BAR).map((n) => [(n.tick - w * BAR) / 96, n.gate / 96, n.pitch, n.vel]);
        out.push({ src: 'pub:' + s.genre + ':' + s.location.split('/').pop(), kind: 'public', len: 32, notes: cut(bass.notes),
            chords: parts.filter((t) => t !== bass && CHORDAL(t.program)).map((t) => cut(t.notes)).filter((c) => c.length >= 6),
            kick: mid.tracks.filter((t) => t.channel === 9).flatMap((t) => cut(t.notes.filter((n) => n.pitch === 35 || n.pitch === 36))) });
    }
}

const out = [], seen = new Set();
publicParts(out);
for (const d of SETS) {
    for (const p of walk(d, '.ablbundle')) moveBundle(p, out, seen);
    for (const p of walk(d, '.als')) liveSet(p, out, seen);
}
writeFileSync(DATA + 'bass-refs.json', JSON.stringify(out));
const n = (k) => out.filter((o) => o.kind === k).length;
console.log(`bass refs: ${n('public')} public, ${n('user')} user → .gen-data/bass-refs.json`);
