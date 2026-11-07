/* browser-test/logic/gen-band.mjs — a New Clip part alone and in a band
 * (plans/2026-11-07-generation-paths-bench.md, round 2): alone it states the
 * pulse; made into a band it leans on the band's accents and sits over its
 * chords, the way real scenes do and the takes made first did not.
 *
 * Run by browser-test/logic.mjs.
 */

import { _log, eq, ok } from './harness.mjs';
import * as G from '../../dist/esm/gen/index.js';
import { createInput } from '../gen-fixtures.mjs';

const by = (id) => G.PRESETS.find((p) => p.id === id);
const median = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
const takes = (ctx, p, n = 24) => Array.from({ length: n }, (_, i) => G.rolled(p, ctx, i % 4, i));

/** An empty Set but for one other track playing `notes` (two bars) in the target's scene. */
function withBand(notes) {
    const input = createInput(false, 'empty', 1);
    input.tracks.push({ index: 1, name: 'Track 2', module: 'obxd', drum: false, padNames: null,
        clips: [{ track: 1, slot: 1, len: 32, loopStart: 0, scaleNum: 1, scaleDen: 1, transpose: 0, quant: 0, notes }] });
    return G.prepare(input);
}
const chord = (step, pitches, len) => pitches.map((pitch) => ({ tick: step * G.TPS, gate: len * G.TPS, pitch, vel: 100 }));

export async function run() {
_log('\nTest: generator parts alone and in a band');

const alone = G.prepare(createInput(false, 'empty', 1));
const band = G.prepare(createInput(false, 'locked', 1));
ok('alone_is_an_empty_new_clip_scene', G.unpulsed(alone) && !G.unpulsed(band));

/* Alone, a bass take states beat 1 and beat 3: an offbeat figure has no beat to be off. */
{
    const p = by('n-bass'), k = G.knobIndex(p, 'PATTERN');
    const m = G.patternMap(alone, G.BASS_MAP);
    ok('bass_takes_alone_strike_beats_1_and_3', takes(alone, p).every((v) => [0, 8].every((s) => m.steps[v[k]].includes(s))));
}

/* Alone, a pad holds (the user's pads strike under once a bar); in a band its figures come back. */
{
    const p = by('n-pad'), k = G.knobIndex(p, 'PATTERN');
    const label = (ctx) => (v) => p.knobs[k].label(v[k], ctx);
    ok('pad_takes_alone_hold', takes(alone, p).map(label(alone)).every((l) => ['HELD', 'BAR', 'HALVES'].includes(l)));
    ok('pad_takes_in_a_band_reach_its_figures', takes(band, p, 40).map(label(band)).some((l) => !['HELD', 'BAR', 'HALVES'].includes(l)));
}

/* Made into a band, a lead's onsets lean on its accents: the same takes
 * with the band's hits taken away land on them less. The band stabs off the
 * beat (HOUSE, 3-6-11-14), where a line would not go on its own. */
{
    const stabs = withBand([0, 16].flatMap((b) => [3, 6, 11, 14].flatMap((s) => chord(b + s, [57, 60, 64], 1))));
    const accents = new Set(G.bandSteps(stabs).slice(0, 4));
    eq('the_stab_band_accents_off_the_beat', [...accents].sort((a, b) => a - b).join(), '3,6,11,14');
    const deaf = { ...stabs, band: [] };
    for (const id of ['n-melody', 'n-riff']) {
        const p = by(id);
        const share = (ctx) => {
            const on = takes(stabs, p).flatMap((v) => G.regenerate(ctx, p, v) ?? []).map((n) => Math.round(n.tick / G.TPS) % 16);
            return on.filter((s) => accents.has(s)).length / Math.max(1, on.length);
        };
        const heard = share(stabs), not = share(deaf);
        ok(`${id}_leans_on_the_bands_accents`, heard > not + 0.08, `${heard.toFixed(2)} vs ${not.toFixed(2)} without the band`);
    }
}

/* Over chords, a lead is heard over them: ARP's and RIFF's takes sit their
 * middle over the chords' (a pad on C4-C5, where both sat inside it). */
{
    const voicing = [60, 64, 67, 72];
    const pad = withBand([0, 8, 16, 24].flatMap((s) => chord(s, voicing, 8)));
    ok('line_floor_reads_the_chords', G.lineFloor(pad) === median(voicing) + 7 && G.lineFloor(alone) === 0);
    /* A track that already plays in another scene keeps its own register (a Variation's New Clip options). */
    {
        const input = createInput(false, 'empty', 1);
        input.tracks.push({ index: 1, name: 'Track 2', module: 'obxd', drum: false, padNames: null,
            clips: [{ track: 1, slot: 1, len: 32, loopStart: 0, scaleNum: 1, scaleDen: 1, transpose: 0, quant: 0, notes: [0, 8, 16, 24].flatMap((s) => chord(s, voicing, 8)) }] });
        input.tracks[0].clips = [{ track: 0, slot: 0, len: 32, loopStart: 0, scaleNum: 1, scaleDen: 1, transpose: 0, quant: 0, notes: chord(0, [72], 4) }];
        const own = G.prepare(input);
        eq('line_floor_leaves_a_tracks_own_register', G.lineFloor(own), 0);
        const riff = by('n-riff');
        const far = takes(own, riff).map((v) => median((G.regenerate(own, riff, v) ?? []).map((n) => n.pitch))).filter((m) => Math.abs(m - 72) > 7);
        eq('riff_takes_the_tracks_own_register', far.join(' '), '');
    }
    /* Judged on the pad itself, not on lineFloor, so a floor that reads nothing fails here too. */
    const floor = median(voicing) + 3;
    for (const id of ['n-arp', 'n-riff']) {
        const p = by(id);
        const mids = takes(pad, p).map((v) => median((G.regenerate(pad, p, v) ?? []).map((n) => n.pitch)));
        const low = mids.filter((x) => x < floor);
        eq(`${id}_takes_sit_over_the_chords`, low.join(' '), '');
    }
}
}
