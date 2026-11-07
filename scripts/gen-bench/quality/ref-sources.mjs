/* Where the bench's reference parts come from: the user's Move set bundles
 * (Song.abl) and Live sets (.als), read as scene rows of clips, and the
 * MidiCaps / Lakh files fetch.mjs selected. Nothing here leaves .gen-data:
 * the user's sets and a dataset never enter the repo. */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { gunzipSync } from 'node:zlib';
import { parseMidi } from '../midi.mjs';

export const DATA = new URL('../../../.gen-data/', import.meta.url).pathname;
export const BAR = 384;

/** The --sets folders, or the default ones. */
export function setDirs(argv) {
    const arg = argv.indexOf('--sets');
    return (arg > 0 ? argv[arg + 1] : '~/Documents/Move,~/Documents/Ableton,~/Downloads').split(',').map((d) => d.replace(/^~/, homedir()));
}

const startsBy = (ns) => ns.reduce((m, n) => m.set(n[0].toFixed(3), (m.get(n[0].toFixed(3)) ?? 0) + 1), new Map());
export const poly = (ns) => ns.length >= 3 && [...startsBy(ns).values()].filter((v) => v >= 3).length / Math.max(1, startsBy(ns).size) > 0.4;
export const monoLow = (ns) => ns.length >= 3 && [...ns].sort((a, b) => a[2] - b[2])[ns.length >> 1][2] < 52
    && [...startsBy(ns).values()].filter((v) => v > 1).length / startsBy(ns).size < 0.2;
export const CHORDAL = (p) => p <= 7 || (p >= 16 && p <= 31) || (p >= 48 && p <= 55) || (p >= 88 && p <= 95);

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

/* rows: Map row -> [{ name, len, notes, drum }], notes as [start, dur, pitch, vel] in beats. */
function moveRows(p) {
    let song;
    try { song = JSON.parse(execFileSync('unzip', ['-p', p, 'Song.abl'], { maxBuffer: 1 << 28 }).toString()); } catch { return null; }
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
    return rows;
}

const val = (xml, tag) => Number((xml.match(new RegExp(`<${tag} Value="([^"]*)"`)) ?? [])[1]);
function liveRows(p) {
    let xml;
    try { xml = gunzipSync(readFileSync(p)).toString(); } catch { return null; }
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
    return rows;
}

/** Every set under the folders: [{ src, rows }], Move bundles before Live sets per folder. */
export function userSets(dirs) {
    const out = [];
    for (const d of dirs) {
        for (const p of walk(d, '.ablbundle')) { const rows = moveRows(p); if (rows) out.push({ src: 'move:' + p.split('/').pop(), rows }); }
        for (const p of walk(d, '.als')) { const rows = liveRows(p); if (rows) out.push({ src: 'live:' + p.split('/').slice(-2).join('/'), rows }); }
    }
    return out;
}

/** The selected MidiCaps files, parsed: [{ src, genre, mid }]. */
export function publicSongs() {
    const listFile = DATA + 'src/midicaps-selected.json';
    if (!existsSync(listFile)) { console.error('no MidiCaps: run scripts/gen-bench/fetch.mjs'); return []; }
    const out = [];
    for (const s of JSON.parse(readFileSync(listFile, 'utf8'))) {
        try { out.push({ src: 'pub:' + s.genre + ':' + s.location.split('/').pop(), genre: s.genre, mid: parseMidi(readFileSync(DATA + 'src/midicaps/' + s.location)) }); } catch { /* unreadable */ }
    }
    return out;
}

/** An 8-bar window of ticks as beats. */
export const cut = (ns, w) => ns.filter((n) => n.tick >= w * BAR && n.tick < (w + 8) * BAR).map((n) => [(n.tick - w * BAR) / 96, n.gate / 96, n.pitch, n.vel]);
