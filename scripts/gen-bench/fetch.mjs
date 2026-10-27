/* Downloads the bench's source MIDI into .gen-data/src/ (git-ignored; nothing
 * from a dataset is ever committed). Re-runnable: what is already there is
 * kept. Prints which sources are missing so the report can say so.
 *
 *   node scripts/gen-bench/fetch.mjs
 */
import { execSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { rng } from './messify.mjs';

const ROOT = new URL('../../.gen-data/src/', import.meta.url).pathname;
const GROOVE = 'https://storage.googleapis.com/magentadata/datasets/groove/groove-v1.0.0-midionly.zip';
const CAPS = 'https://huggingface.co/datasets/amaai-lab/MidiCaps/resolve/main';
const sh = (c) => execSync(c, { stdio: 'inherit', shell: '/bin/bash' });
mkdirSync(ROOT, { recursive: true });
const missing = [];

if (!existsSync(ROOT + 'groove/info.csv')) {
    try { sh(`curl -sfL ${GROOVE} -o ${ROOT}groove.zip && unzip -qo ${ROOT}groove.zip -d ${ROOT} && rm ${ROOT}groove.zip`); }
    catch { missing.push('groove'); }
}

/* MidiCaps: captions first (JSON lines), then only the chosen files out of the
 * 1.6 GB archive, streamed. Electronic songs with drums and a synth, 4/4,
 * groovebox tempo; some pop for contrast. */
const SYNTH = (p) => (p >= 80 && p <= 103) || p === 38 || p === 39;
async function pickCaptions() {
    const r = rng(20261027);
    const elec = [], pop = [];
    const rl = createInterface({ input: createReadStream(ROOT + 'midicaps.json') });
    for await (const line of rl) {
        let d;
        try { d = JSON.parse(line); } catch { continue; }
        const inst = d.instrument_numbers_sorted ?? [];
        if (d.time_signature !== '4/4' || !inst.includes(128) || d.duration < 60) continue;
        if (d.genre[0] === 'electronic' && d.tempo >= 100 && d.tempo <= 160 && inst.some(SYNTH)) elec.push(d);
        else if (d.genre[0] === 'pop' && d.tempo >= 85 && d.tempo <= 135) pop.push(d);
    }
    const take = (a, n) => a.map((d) => [r(), d]).sort((x, y) => x[0] - y[0]).slice(0, n).map((x) => x[1]);
    return [...take(elec, 120), ...take(pop, 40)].map((d) => ({
        location: d.location, genre: d.genre[0] === 'electronic' ? 'electronic' : 'pop',
        key: d.key, tempo: d.tempo, chords: d.chord_summary }));
}
try {
    if (!existsSync(ROOT + 'midicaps.json')) sh(`curl -sfL ${CAPS}/train.json -o ${ROOT}midicaps.json`);
    if (!existsSync(ROOT + 'midicaps-selected.json')) {
        const sel = await pickCaptions();
        writeFileSync(ROOT + 'midicaps-list.txt', sel.map((s) => s.location).join('\n') + '\n');
        mkdirSync(ROOT + 'midicaps', { recursive: true });
        sh(`curl -sfL ${CAPS}/midicaps.tar.gz | tar -xzf - -C ${ROOT}midicaps -T ${ROOT}midicaps-list.txt`);
        writeFileSync(ROOT + 'midicaps-selected.json', JSON.stringify(sel));
    }
} catch (e) { missing.push('midicaps'); console.error(String(e).slice(0, 200)); }

/* GigaMIDI is gated behind a Hugging Face login (terms acceptance). */
missing.push('gigamidi (gated)');
writeFileSync(ROOT + 'missing.json', JSON.stringify(missing));
console.log('missing sources:', missing.join(', ') || 'none');
