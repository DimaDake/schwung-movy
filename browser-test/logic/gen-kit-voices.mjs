/* browser-test/logic/gen-kit-voices.mjs — which pad of a drum rack is the
 * kick, the snare, the hats (gen/analysis/kit.ts, drum-lexicon.ts,
 * ai/pad-labels.ts).
 *
 * The FLEET table is every drum module on the device as of 2026-11-07, each
 * with exactly what movy can read from it at request time — its declared
 * names and roles, what its pads hold, or (for the three that say nothing)
 * drum-layouts.json — sourced from the module's own code. A rack added to the
 * device belongs in this table.
 *
 * The module half boots the real model on the dumped contracts and proves
 * `padHints` finds the per-pad keys that name a drum (a sample path, Forge's
 * algorithm, Signal's wave, Weird Dreams' preset index).
 *
 * Run by browser-test/logic.mjs.
 */

import { _log, eq, ok, bootModel, settleModel, appState, env, MOCK_SYNTHS } from './harness.mjs';
import { dumpEntry, dumpFixture } from '../dump-fixture.mjs';
import { serveModuleFiles } from './drum-automation.mjs';
import * as G from '../../dist/esm/gen/index.js';

const range = (from, n) => Array.from({ length: n }, (_, i) => from + i);
const byPad = (from, list) => Object.fromEntries(list.map((x, i) => [from + i, x]).filter(([, x]) => x));
const up = (o) => o && Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.toUpperCase()]));

/* [module, pads, hints, { role: expected pad, null = the kit has none }] */
const FLEET = [
    ['6w6 (native map)', range(36, 8), {
        names: byPad(36, ['Bass Drum', 'Snare', 'Low Tom', 'Hi Tom', 'Closed Hat', 'Open Hat', 'Cymbal', 'Clap']),
        roles: byPad(36, ['kick', 'snare', 'tom', 'tom', 'hat', 'hat', 'cymbal', 'clap']) },
        { kick: 36, snare: 37, hat: 40, open: 41, cym: 42 }],
    ['6w6 (GM map, movy pads 36-43)', range(36, 8), {
        names: { 36: 'Bass Drum', 38: 'Snare', 39: 'Clap', 41: 'Low Tom', 42: 'Closed Hat' },
        roles: { 36: 'kick', 38: 'snare', 39: 'clap', 41: 'tom', 42: 'hat' } },
        { kick: 36, snare: 38, hat: 42, open: null }],
    ['8w8', range(36, 16), {
        names: byPad(36, ['Bass Drum', 'Snare', 'Low Tom', 'Mid Tom', 'Hi Tom', 'Low Conga', 'Mid Conga', 'Hi Conga',
            'Rim Shot', 'Claves', 'Maracas', 'Hand Clap', 'Cowbell', 'Closed Hat', 'Open Hat', 'Cymbal']),
        roles: byPad(36, ['kick', 'snare', 'tom', 'tom', 'tom', 'conga', 'conga', 'conga',
            'rim', 'clave', 'shaker', 'clap', 'cowbell', 'hat', 'hat', 'cymbal']) },
        { kick: 36, snare: 37, hat: 49, open: 50, cym: 51 }],
    ['9w9', range(36, 11), {
        names: byPad(36, ['Bass Drum', 'Snare', 'Low Tom', 'Med Tom', 'Hi Tom', 'Rim Shot', 'Hand Clap', 'Closed Hat',
            'Open Hat', 'Crash', 'Ride']),
        roles: byPad(36, ['kick', 'snare', 'tom', 'tom', 'tom', 'rim', 'clap', 'hat', 'hat', 'cymbal', 'cymbal']) },
        { kick: 36, snare: 37, hat: 43, open: 44, cym: 45 }],
    ['cw78 (every role "drum")', range(36, 14), {
        names: byPad(36, ['Bass Drum', 'Snare', 'Rim Shot', 'Hi-Hat', 'Cymbal', 'Maracas', 'Claves', 'Hi Bongo',
            'Low Bongo', 'Low Conga', 'Cowbell', 'Tambourine', 'Guiro', 'Metal Beat']),
        roles: byPad(36, Array(14).fill('drum')) },
        { kick: 36, snare: 37, hat: 39, open: null, cym: 40 }],
    ['simian', range(36, 16), {
        names: byPad(36, ['Kick', 'Rim', 'Snare', 'Snare 2', 'Clap', 'Lo Tom', 'HH Cl', 'HH Cl 2', 'Hi Tom', 'Lo Tom 2',
            'HH Open', 'Mid Tom', 'Hi Tom 2', 'Cymbal', 'Cymbal 2', 'Mid Tom2']),
        roles: byPad(36, ['kick', 'rim', 'snare', 'snare', 'clap', 'tom', 'hihat_closed', 'hihat_closed', 'tom', 'tom',
            'hihat_open', 'tom', 'tom', 'cymbal', 'cymbal', 'tom']) },
        { kick: 36, snare: 38, hat: 42, open: 46, cym: 49 }],
    ['voice-poc', [36, 38, 42, 48, 49, 50, 51], {
        names: { 36: 'kick', 38: 'snare', 42: 'hat', 48: 'Tom Lo', 49: 'Tom Hi', 50: 'Rim', 51: 'Clap' },
        roles: { 36: 'kick', 38: 'snare', 42: 'hat' } },
        { kick: 36, snare: 38, hat: 42 }],
    ['dr32 (a sample kit: names are file basenames)', range(36, 32), {
        names: byPad(36, ['909 BD', 'SD_909', 'ch_909', 'OH909', 'Clap', 'crash', 'ride', 'Low Tom']) },
        { kick: 36, snare: 37, hat: 38, open: 39, cym: 41 }],
    ['dr32 (synth models)', range(36, 32), {
        names: byPad(36, ['Kick', 'Closed Hat', 'Snare', 'Open Hat']) },
        { kick: 36, snare: 38, hat: 37, open: 39 }],
    ['mrdrums (sample paths)', range(36, 16), {
        labels: byPad(36, ['/data/UserData/UserLibrary/Samples/Kits/808/KCK_808_01.wav', '/x/SNR-808.wav',
            '/x/HHClosed_808.wav', '/x/HHOpen_808.wav', '/x/Clap808.aif']) },
        { kick: 36, snare: 37, hat: 38, open: 39 }],
    ['forge (each voice\'s algorithm, default kit)', range(36, 16), {
        labels: byPad(36, ['Drum', 'Drum', 'Drum', 'Drum', 'Snare', 'Cymbal', 'Hat', 'Hat',
            'Drum', 'Drum', 'Drum', 'Drum', 'Snare', 'Cymbal', 'Hat', 'Hat']) },
        { kick: 36, snare: 40, hat: 42, cym: 41, tom: 37 }],
    ['strut (a kit: SOUND reads "Own", drum-layouts.json)', range(36, 16), {
        roles: byPad(36, ['kick', 'snare', 'hat', 'open', 'kick', 'clap', 'rim', 'cymbal',
            'tom', 'tom', 'tom', 'perc', 'perc', 'bell', 'bass', 'fx']) },
        { kick: 36, snare: 37, hat: 38, open: 39, cym: 43 }],
    ['strut (a SOUND per pad)', range(36, 16), {
        labels: byPad(36, ['Kick 3', 'Hat 2', 'Snare 1', 'Open 1']) },
        { kick: 36, snare: 38, hat: 37, open: 39 }],
    ['krautdrums (drum-layouts.json, raw pads 68+)', range(68, 16), {
        names: byPad(68, ['Bass-drum', 'Conga', 'Tom 1', 'Tom 2', 'Claves', 'Snare', 'Short cym', 'Long cym',
            'Cow Bell', 'Bass-drum 2', 'Tom 3', 'Conga 2', 'Claves 2', 'Snare 2', 'Mid cym', 'Cow Bell 2']) },
        { kick: 68, snare: 73, hat: null, cym: 74 }],
    ['weird-dreams (each voice\'s preset, default kit)', range(36, 8), {
        labels: byPad(36, ['Sub Kick', 'Snare', 'Low Tom', 'Clap 808', 'Rimshot', 'Closed HH', 'Open HH', 'Crash']) },
        { kick: 36, snare: 37, hat: 41, open: 42, cym: 43 }],
    ['signal (kit waves)', range(36, 4), { labels: byPad(36, ['Kick', 'Snare', 'Hat', 'Sine']) },
        { kick: 36, snare: 37, hat: 38 }],
    ['signal (a patch of plain waves: says nothing, GM)', range(36, 4), { labels: null },
        { kick: 36, snare: 38 }],
    ['sophie (declares nothing; its pads follow GM)', range(36, 16), {}, { kick: 36, snare: 38, hat: 42, open: 46 }],
    ['po32-drum (declares nothing; GM layout)', range(36, 16), {}, { kick: 36, snare: 38, hat: 42, open: 46 }],
    ['essaim (raw pads 68+, says nothing, empty clip)', range(68, 32), {}, { kick: 68, snare: 69, hat: 70 }],
    ['slicer (raw pads 68+, says nothing, empty clip)', range(68, 32), {}, { kick: 68, snare: 69, hat: 70 }],
];

export async function run() {
_log('\nTest: drum voices — the vocabulary');
{
    const cases = {
        kick: ['Kick', 'BD', 'Bass Drum', 'Bass-drum', 'KCK_808_01.wav', 'BD707', 'kik', '909 BD', 'Sub Kick', 'bassdrum'],
        snare: ['Snare', 'SD', 'SNR-808', 'Snare 2', 'Clap', 'Hand Clap', 'CP', 'clap808', 'Ghost Snare'],
        hat: ['Closed Hat', 'HH Cl', 'CHH', 'hihat_closed', 'Hi-Hat', 'hh', 'Pedal HH', 'Maracas', 'HHClosed_808', 'Closed HH'],
        open: ['Open Hat', 'OH', 'HH Open', 'hihat_open', 'HHOpen_808', 'OpenHat', 'Open 1', 'OHH'],
        tom: ['Low Tom', 'Tom Lo', 'LT', 'Hi Bongo', 'Low Conga', 'Mid Tom2', 'Acid Tom', 'Floor Tom'],
        cym: ['Crash', 'Ride', 'Cymbal 2', 'Short cym', 'CY', 'Ride Bell', 'Splash'],
        perc: ['Rim Shot', 'Rimshot', 'Cowbell', 'Cow Bell', 'Claves', 'CL', 'Bell 1', 'Guiro', 'Perc 2', 'FX 1'],
    };
    const wrong = [];
    for (const [role, texts] of Object.entries(cases)) {
        for (const t of texts) if (G.roleOfText(t)?.role !== role) wrong.push(`${t}→${G.roleOfText(t)?.role ?? 'none'}`);
    }
    eq('every spelling the fleet uses reads as its part', wrong.join(', '), '');
    const none = ['Pad 1', 'Own', 'Sine', 'Wild', 'Custom', 'Fuse', 'LPF', 'oneshot', 'Bass 1', 'Glitch', 'Shaker Pad']
        .filter((t) => G.roleOfText(t) && t !== 'Shaker Pad');
    eq('a name that is no drum reads as none', none.join(', '), '');
    eq('a snare outranks a clap', G.roleOfText('Snare').rank < G.roleOfText('Clap').rank, true);
    eq('a lone "Drum" is a membrane until the kit decides', G.roleOfText('Drum').rank, G.MEMBRANE);
}

_log('\nTest: drum voices — every drum module on the device');
for (const [name, pads, hints, want] of FLEET) {
    const kit = G.kitOf(pads, { names: up(hints.names), roles: hints.roles, labels: up(hints.labels) }, []);
    const got = Object.fromEntries(Object.keys(want).map((r) => [r, G.padFor(kit, r, [])]));
    eq(`${name}: ${Object.keys(want).join('/')}`, JSON.stringify(got), JSON.stringify(want));
}

_log('\nTest: drum voices — what the rack says beats where the pattern plays');
{
    /* 9W9's native map against a pattern that hammers 38 (its LOW TOM) on
     * the beats: the name holds, the pattern does not relabel it. */
    const notes = [0, 4, 8, 12].map((s) => ({ pitch: 38, tick: s * G.TPS, dur: 10, vel: 100 }));
    const kit = G.kitOf(range(36, 11), { names: up(byPad(36, ['Bass Drum', 'Snare', 'Low Tom'])) }, notes);
    eq('a named tom stays a tom', kit.role[38], 'tom');
    /* An anonymous rack off the GM map: the pattern still names its kick. */
    const off = G.kitOf(range(68, 16), {}, [0, 4, 8, 12].map((s) => ({ pitch: 71, tick: s * G.TPS, dur: 10, vel: 100 })));
    eq('an anonymous rack: the four-on-the-floor pad is the kick', G.padFor(off, 'kick', []), 71);
}

_log('\nTest: drum voices — padHints reads each pad\'s own keys from the real contracts');
{
    const prev = appState.trackModels[0];
    const cases = [
        /* [module, extra params, pitch, expected label] */
        ['mrdrums', { 'synth:p02_sample_path': '/data/UserData/UserLibrary/Samples/909/SD_909.wav' }, 37,
            '/DATA/USERDATA/USERLIBRARY/SAMPLES/909/SD_909.WAV'],
        ['mrdrums', { 'synth:p03_sample_path': '/data/UserData/UserLibrary/Samples/Kicks/03.wav' }, 38,
            '/DATA/USERDATA/USERLIBRARY/SAMPLES/KICKS/03.WAV'],
        ['forge', { 'synth:pv7_algo': 'Hat' }, 42, 'HAT'],
        ['signal', { 'synth:v1_wave': 'Kick' }, 36, 'KICK'],
        ['weird-dreams', { 'synth:v6_preset': '15' }, 41, 'CLOSED HH'],
    ];
    for (const [id, extra, pitch, label] of cases) {
        const entry = dumpEntry(id);
        if (!entry) { ok(`${id}: in the module dump`, false); continue; }
        const restoreFs = serveModuleFiles(entry);
        try {
            const fixture = { ...dumpFixture(id), ...extra };
            const model = settleModel(bootModel(fixture));
            appState.trackModels[0] = [null, model];
            env.setParams(fixture);
            const h = (await import('../../dist/esm/ai/index.js')).padHints(0);
            eq(`${id}: pad ${pitch} reads as what it holds`, h.padLabels?.[pitch], label);
            eq(`${id}: ...which the kit hears as its part`,
               G.kitOf(Object.keys(h.padLabels ?? {}).map(Number), G.kitHints(h), []).role[pitch],
               G.roleOfText(label).role);
        } finally { restoreFs(); }
    }
    appState.trackModels[0] = prev;
    env.setParams(MOCK_SYNTHS.test16);
}
}
