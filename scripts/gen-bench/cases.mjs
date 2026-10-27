/* Cuts the bench's cases into .gen-data/cases/ (git-ignored) from our own
 * patterns (committed) and the downloaded datasets. Deterministic: a fixed
 * seed and sorted inputs, so two runs compare the same music.
 *
 *   node scripts/gen-bench/cases.mjs
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { parseMidi } from './midi.mjs';
import { messify, rng } from './messify.mjs';
import { difference, onGridShare, STEP, window } from './sim.mjs';

const ROOT = new URL('../../.gen-data/', import.meta.url).pathname;
const PATTERNS = new URL('./patterns/', import.meta.url).pathname;
const BAR = 16 * STEP;
const LEN = 32;                       // steps: every case clip is 2 bars
const r = rng(4242);

const clip = (track, slot, notes) => ({ track, slot, len: LEN, loopStart: 0, scaleNum: 1, scaleDen: 1,
    transpose: 0, quant: 0, notes: [...notes].sort((a, b) => a.tick - b.tick || a.pitch - b.pitch) });

function grooveRows() {
    const csv = ROOT + 'src/groove/info.csv';
    if (!existsSync(csv)) return [];
    const [head, ...lines] = readFileSync(csv, 'utf8').trim().split('\n').map((l) => l.split(','));
    return lines.map((l) => Object.fromEntries(head.map((h, i) => [h, l[i]])));
}

/* Real human timing: a Groove MIDI drummer's onsets against the 16th grid. */
function grooveDeviations() {
    const out = [];
    for (const row of grooveRows().filter((x) => x.beat_type === 'beat').slice(0, 40)) {
        const m = parseMidi(readFileSync(ROOT + 'src/groove/' + row.midi_filename));
        const dev = m.tracks.flatMap((t) => t.notes).slice(0, 64)
            .map((n) => n.tick - Math.round(n.tick / STEP) * STEP);
        if (dev.length >= 32) out.push(dev);
    }
    return out.length ? out : [[6, -4, 9, -7, 3, -10, 5, -2]];
}

function patternCases(devs) {
    const out = [];
    for (const [i, f] of readdirSync(PATTERNS).filter((x) => x.endsWith('.json')).sort().entries()) {
        const p = JSON.parse(readFileSync(PATTERNS + f, 'utf8'));
        const head = { bpm: p.bpm, swing: 0, root: p.root, mode: p.mode };
        const sceneA = (tracks) => tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => c.slot === 0) }));
        const qt = p.tracks[i % p.tracks.length];
        const clean = qt.clips[0].notes;
        const input = messify(clean, devs[i % devs.length], 100 + i, { drum: qt.drum });
        const tracks = sceneA(p.tracks).map((t) => (t.index === qt.index
            ? { ...t, clips: [{ ...t.clips[0], notes: input }] } : t));
        out.push({ id: `pat-${p.name}-q`, kind: 'quantize-messy', genre: p.genre, source: 'pattern', task: 'quantize',
            drum: qt.drum, set: { ...head, tracks, target: { track: qt.index, slot: 0 }, source: null },
            input, reference: clean, a: null });
        /* Variation: the target's B is the reference; the other tracks' B is
         * already in scene 2, the way a user builds a B section. */
        const vt = p.tracks[(i + 1) % p.tracks.length];
        const vtracks = p.tracks.map((t) => (t.index === vt.index ? { ...t, clips: t.clips.filter((c) => c.slot === 0) } : t));
        out.push({ id: `pat-${p.name}-v`, kind: 'variation', genre: p.genre, source: 'pattern', task: 'variation',
            drum: vt.drum, set: { ...head, tracks: vtracks, target: { track: vt.index, slot: 1 }, source: { track: vt.index, slot: 0 } },
            input: vt.clips[0].notes, reference: vt.clips[1].notes, a: vt.clips[0].notes });
    }
    return out;
}

const FAMILY = ['Piano', 'Keys', 'Organ', 'Guitar', 'Bass', 'Strings', 'Ensemble', 'Brass', 'Reed', 'Pipe',
    'Synth Lead', 'Synth Pad', 'Synth FX', 'Ethnic', 'Percussive', 'FX'];

/* A song as movy tracks: drums, then the busiest pitched parts (bass first). */
function songTracks(m) {
    const parts = m.tracks.filter((t) => t.notes.length >= 16);
    const drums = parts.filter((t) => t.channel === 9);
    const mel = parts.filter((t) => t.channel !== 9).sort((a, b) => b.notes.length - a.notes.length).slice(0, 3);
    const tracks = [];
    if (drums.length) tracks.push({ name: 'Drums', module: 'gm-drums', drum: true, padNames: null,
        notes: drums.flatMap((d) => d.notes) });
    for (const t of mel) tracks.push({ name: FAMILY[t.program >> 3], module: 'gm-' + t.program, drum: false, padNames: null, notes: t.notes });
    return tracks.map((t, index) => ({ ...t, index }));
}

function songCases(sel, nQuant, nVar, devs) {
    const out = [];
    for (const s of sel) {
        if (out.filter((c) => c.kind === 'quantize-messy').length >= nQuant
            && out.filter((c) => c.kind === 'variation').length >= nVar) break;
        const path = ROOT + 'src/midicaps/' + s.location;
        if (!existsSync(path)) continue;
        let m;
        try { m = parseMidi(readFileSync(path)); } catch { continue; }
        const tracks = songTracks(m);
        if (tracks.length < 3) continue;
        const bars = Math.floor(Math.max(...tracks.flatMap((t) => t.notes.map((n) => n.tick))) / BAR);
        const [mode, root] = [s.key.includes('minor') ? 'minor' : 'major', s.key.split(' ')[0]];
        const head = { bpm: Math.round(s.tempo), swing: 0, root, mode };
        const tgt = tracks[1 + Math.floor(r() * (tracks.length - 1))];
        const at = (t, bar) => window(t.notes, bar * BAR, LEN * STEP);
        const wantQ = out.filter((c) => c.kind === 'quantize-messy').length < nQuant;
        const wantV = out.filter((c) => c.kind === 'variation').length < nVar;
        for (let bar = 8; bar + 2 <= bars; bar += 2) {
            const A = at(tgt, bar);
            if (A.length < 6 || onGridShare(A) < 0.9) continue;
            const scene = (b, slot, skip) => tracks.filter((t) => t !== skip).map((t) => ({ index: t.index, name: t.name,
                module: t.module, drum: t.drum, padNames: null, clips: at(t, b).length ? [clip(t.index, slot, at(t, b))] : [] }));
            if (wantV) {
                let bBar = -1;
                for (let b = bar + 2; b + 2 <= Math.min(bars, bar + 18); b += 2) {
                    if (at(tgt, b).length >= 6 && difference(A, at(tgt, b)) > 0.5) { bBar = b; break; }
                }
                if (bBar < 0) continue;
                const t1 = scene(bar, 0, null), t2 = scene(bBar, 1, tgt);
                const merged = t1.map((t) => ({ ...t, clips: [...t.clips, ...(t2.find((x) => x.index === t.index)?.clips ?? [])] }));
                out.push({ id: `caps-${s.genre}-${out.length}-v`, kind: 'variation', genre: s.genre, source: 'midicaps', task: 'variation',
                    drum: false, set: { ...head, tracks: merged, target: { track: tgt.index, slot: 1 }, source: { track: tgt.index, slot: 0 } },
                    input: A, reference: at(tgt, bBar), a: A });
            } else if (wantQ) {
                const input = messify(A, devs[out.length % devs.length], 7 + out.length);
                const tracks1 = scene(bar, 0, null).map((t) => (t.index === tgt.index ? { ...t, clips: [clip(t.index, 0, input)] } : t));
                out.push({ id: `caps-${s.genre}-${out.length}-q`, kind: 'quantize-messy', genre: s.genre, source: 'midicaps', task: 'quantize',
                    drum: false, set: { ...head, tracks: tracks1, target: { track: tgt.index, slot: 0 }, source: null },
                    input, reference: A, a: null });
            }
            break;
        }
    }
    return out;
}

/* Played drums with no clean version: scored on groove and idea, not recovery. */
function grooveCases(n) {
    const seen = new Set(), out = [];
    for (const row of grooveRows()) {
        const style = row.style.split('/')[0];
        if (row.beat_type !== 'beat' || row.time_signature !== '4-4' || seen.has(style) || out.length >= n) continue;
        seen.add(style);
        const m = parseMidi(readFileSync(ROOT + 'src/groove/' + row.midi_filename));
        const notes = window(m.tracks.flatMap((t) => t.notes), 2 * BAR, LEN * STEP);
        if (notes.length < 12) continue;
        const tracks = [{ index: 0, name: 'Drums', module: 'gm-drums', drum: true, padNames: null, clips: [clip(0, 0, notes)] }];
        out.push({ id: `gmd-${style}`, kind: 'quantize-played', genre: style, source: 'groove', task: 'quantize', drum: true,
            set: { bpm: Number(row.bpm), swing: 0, root: 'C', mode: 'minor', tracks, target: { track: 0, slot: 0 }, source: null },
            input: notes, reference: null, a: null });
    }
    return out;
}

const devs = grooveDeviations();
const sel = existsSync(ROOT + 'src/midicaps-selected.json') ? JSON.parse(readFileSync(ROOT + 'src/midicaps-selected.json', 'utf8')) : [];
const elec = sel.filter((s) => s.genre === 'electronic'), pop = sel.filter((s) => s.genre === 'pop');
const cases = [...patternCases(devs), ...songCases(elec, 7, 7, devs), ...songCases(pop, 3, 3, devs), ...grooveCases(6)];
rmSync(ROOT + 'cases', { recursive: true, force: true });
mkdirSync(ROOT + 'cases', { recursive: true });
for (const c of cases) writeFileSync(ROOT + 'cases/' + c.id + '.json', JSON.stringify(c));
const count = (k) => cases.filter((c) => c.kind === k).length;
const electronic = cases.filter((c) => c.source === 'pattern' || c.genre === 'electronic').length;
console.log(`cases ${cases.length}: quantize-messy ${count('quantize-messy')}, quantize-played ${count('quantize-played')}, `
    + `variation ${count('variation')}; electronic ${Math.round(100 * electronic / cases.length)}%; drums ${cases.filter((c) => c.drum).length}`);
