/* browser-test/logic/gen-quantize.mjs — Smart Quantize's mutations
 * (plans/2026-10-29-quantize-mutations.md): each one is the player's clip,
 * on the grid, with one thing changed; never a part from scratch.
 *
 * Run by browser-test/logic.mjs.
 */

import { _log, eq, ok } from './harness.mjs';
import * as G from '../../dist/esm/gen/index.js';
import { fixtureInput, messy } from '../gen-fixtures.mjs';

const by = (id) => G.PRESETS.find((p) => p.id === id);
const quant = (role, scene = 'locked') => { const i = fixtureInput(role, { task: 'quantize', scene }); i.tracks[0].clips[0].notes = messy(i.tracks[0].clips[0].notes); return G.prepare(i); };
const turn = (ctx, p, knobs) => { const v = G.defaults(p, ctx); for (const [k, x] of Object.entries(knobs)) v[G.knobIndex(p, k)] = x; return G.regenerate(ctx, p, v) ?? []; };
const sorted = (ns) => [...ns].sort((a, b) => a.tick - b.tick || a.pitch - b.pitch);
const ticks = (ns) => sorted(ns).map((n) => n.tick).join();
const pitches = (ns) => sorted(ns).map((n) => n.pitch).join();

export async function run() {
_log('\nTest: Smart Quantize mutations');

const lead = quant('lead');
/* The clip on the grid, through the guard (which merges notes that land on
 * one step): what every mutation starts from. */
const key = (ns) => [...new Set(ns.map((n) => `${n.tick}.${n.pitch}`))].sort().join();
const tight = turn(lead, by('q-mutate'), { AMOUNT: 0 });

{
    const m = by('q-mutate');
    eq('mutate_at_zero_is_the_clip_on_the_grid', key(tight), key(G.tightSrc(lead, 10)));
    const out = turn(lead, m, { AMOUNT: 6 });
    ok('mutate_keeps_the_rhythm_and_moves_pitches', ticks(out) === ticks(tight) && pitches(out) !== pitches(tight));
    ok('mutate_moves_by_scale_steps_in_the_key', sorted(out).every((n) => G.inKey(n.pitch, lead.key)
        || !G.inKey(sorted(tight).find((x) => x.tick === n.tick)?.pitch ?? 0, lead.key)));

    /* The modes are the clip alone (a free scene); against a band a line is
     * offered MIRROR only (INVERT's, merged into MODE). */
    const mode = by('q-mode');
    const free = quant('lead', 'free');
    const modeLabels = (c) => Array.from({ length: mode.knobs[1].steps(c) }, (_, i) => mode.knobs[1].label(i, c));
    eq('mode_in_a_band_is_mirror_only', modeLabels(lead).join(), 'MIRROR');
    ok('mode_alone_offers_every_mode', modeLabels(free).includes('DORIAN') && modeLabels(free).includes('MIRROR'));
    ok('mode_not_offered_to_a_pad_in_a_band', !G.serves(mode, quant('pad')));
    const tightFree = turn(free, by('q-mutate'), { AMOUNT: 0 });
    const dorian = turn(free, mode, { MODE: G.MODES.findIndex((x) => x[0] === 'DORIAN') });
    const scale = G.MODES.find((x) => x[0] === 'DORIAN')[1].map((s) => (s + lead.key.tonic) % 12);
    ok('mode_keeps_the_rhythm', ticks(dorian) === ticks(tightFree));
    ok('mode_puts_the_clip_in_the_mode', dorian.filter((n) => G.inKey(sorted(tightFree).find((x) => x.tick === n.tick && Math.abs(x.pitch - n.pitch) <= 1)?.pitch ?? -1, lead.key))
        .every((n) => scale.includes(n.pitch % 12)));

    /* Mirrored around the first note: each single in-key note as far below
     * it in scale steps as it was above (a few moved off a rub with the band). */
    const inv = turn(lead, mode, { MODE: 0, WHERE: 0, PIVOT: 0 });   // MODE 0 in a band is MIRROR
    const one = (ns) => { const m = new Map(); for (const n of ns) m.set(n.tick, m.has(n.tick) && m.get(n.tick) !== n.pitch ? null : n.pitch); return m; };
    const before = one(tight), after = one(inv), pivot = G.degreeIndex(sorted(tight)[0].pitch, lead.key);
    const pairs = [...before].filter(([t, p]) => p !== null && after.get(t) != null && G.inKey(p, lead.key));
    ok('invert_mirrors_the_contour_in_the_key', ticks(inv) === ticks(tight) && pairs.length >= 6
        && pairs.filter(([t, p]) => G.degreeIndex(after.get(t), lead.key) - pivot === pivot - G.degreeIndex(p, lead.key)).length >= 0.8 * pairs.length);

    /* SHAPED and SHIFT gain a centred DENSITY (§4.3): 5 is the default take. */
    for (const id of ['q-shaped', 'q-shift']) {
        const p = by(id);
        const d = G.knobIndex(p, 'DENSITY');
        ok(`${id}_density_centred`, d >= 0 && G.defaults(p, lead)[d] === 5 && turn(lead, p, { DENSITY: 9 }).length > turn(lead, p, { DENSITY: 5 }).length);
    }
    const oct = turn(lead, by('q-octaves'), { AMOUNT: 10 });
    ok('octaves_keep_pitch_classes', ticks(oct) === ticks(tight) && sorted(oct).every((n, i) => n.pitch % 12 === sorted(tight)[i].pitch % 12)
        && pitches(oct) !== pitches(tight));

    const rat = turn(lead, by('q-ratchet'), { AMOUNT: 10 });
    const at = new Set(rat.map((n) => n.tick));
    ok('ratchet_keeps_every_onset_and_adds_repeats', tight.every((n) => at.has(n.tick)) && rat.length > tight.length);

    const sh = turn(lead, by('q-shift'), { STEPS: 6, KEEP: 0, LENGTH: 5 });
    ok('shift_moves_the_whole_clip_by_two_sixteenths', sh.length === tight.length
        && sorted(tight).every((n) => sh.some((x) => x.pitch === n.pitch && x.tick === (n.tick + 2 * G.TPS) % lead.end)));

    const hu = turn(lead, by('q-humanize'), { LOOSE: 10, VELOCITY: 10 });
    ok('humanize_keeps_the_notes_and_loosens_them', pitches(hu) === pitches(tight) && ticks(hu) !== ticks(tight)
        && sorted(hu).every((n, i) => Math.abs(n.tick - sorted(tight)[i].tick) <= G.TPS * 0.3 + 1));
}

/* Drums: the posts stay, the hits are the kit's own. */
{
    const d = quant('drums');
    const t = turn(d, by('qd-mutate'), { AMOUNT: 0 });
    ok('drum_mutate_at_zero_is_the_clip_on_the_grid', key(t).split(',').every((k) => key(G.tightSrc(d, 10)).split(',').includes(k)));
    const pads = (ns) => [...new Set(ns.map((n) => n.pitch))].sort().join();
    const mu = turn(d, by('qd-mutate'), { AMOUNT: 10 });
    ok('drum_mutate_keeps_the_kits_pads', pads(mu) === pads(t) && ticks(mu) !== ticks(t));
    const kick = G.padFor(d.kit, 'kick', d.src);
    const ones = (ns) => ns.filter((n) => n.pitch === kick && n.tick % (16 * G.TPS) === 0).length;
    eq('drum_mutate_keeps_the_downbeat_kicks', ones(mu), ones(t));
    const ra = turn(d, by('qd-ratchet'), { AMOUNT: 10, PAD: 2 });
    ok('drum_ratchet_adds_rolls', ra.length > t.length && t.every((n) => ra.some((x) => x.tick === n.tick && x.pitch === n.pitch)));
}

/* Six options; the first is still the tightest. */
{
    for (const role of ['lead', 'pad', 'drums']) {
        const r = G.generateAll((() => { const i = fixtureInput(role, { task: 'quantize' }); i.tracks[0].clips[0].notes = messy(i.tracks[0].clips[0].notes); return i; })());
        ok(`quantize_${role}_offers_six`, r.picks.length === 6, r.picks.map((p) => p.preset.id).join(' '));
    }
}
}
