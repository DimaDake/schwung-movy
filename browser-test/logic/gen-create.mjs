/* browser-test/logic/gen-create.mjs — New Clip
 * (plans/2026-10-28-new-clip-design.md): a part from nothing, eight melodic
 * and seven drum options, each one of its own kind, fitting the scene when
 * there is one, and never the same defaults twice.
 *
 * Run by browser-test/logic.mjs.
 */

import { _log, eq, ok } from './harness.mjs';
import * as G from '../../dist/esm/gen/index.js';
import { createInput } from '../gen-fixtures.mjs';

const sig = (ns) => [...ns].sort((a, b) => a.tick - b.tick || a.pitch - b.pitch).map((n) => `${n.tick}.${n.pitch}`).join(',');
const ids = (r) => r.picks.map((p) => p.preset.id).join(' ');
const by = (id) => G.PRESETS.find((p) => p.id === id);
const pcOf = (p) => ((p % 12) + 12) % 12;

export async function run() {
_log('\nTest: generator new clip');
G.forgetOptions();

/* Nothing in the Set at all: still a full set of options, in order. */
const mel = G.generateAll(createInput(false, 'empty', 1));
eq('new_clip_melodic_offers_its_eight_parts', ids(mel), 'n-chords n-pad n-stabs n-bass n-arp n-melody n-riff n-counter');
const drm = G.generateAll(createInput(true, 'empty', 1));
eq('new_clip_drums_offers_two_per_pad_then_five_kits', ids(drm), 'n-pad-euclid n-pad-pattern n-groove n-drum-map n-euclid-kit n-broken n-perc');
ok('new_clip_per_pad_options_come_first', drm.picks.slice(0, 2).every((p) => p.preset.perPad) && drm.picks.slice(2).every((p) => !p.preset.perPad));
eq('new_clip_a_silent_set_takes_the_key_setting', `${mel.ctx.key.tonic}${mel.ctx.key.minor ? 'm' : ''}`, '0');
eq('new_clip_per_pad_writes_only_its_pad', [...new Set(drm.picks[0].notes.map((n) => n.pitch))].join(), String(G.padOf(drm.ctx)));

/* A locked scene: the parts sit on the others' chords (Fmaj7 G7 Am7 E7). */
const lk = G.generateAll(createInput(false, 'locked', 2));
eq('new_clip_locked_scene_plays_the_scenes_chords', lk.ctx.plans.map((p) => p.label).join(), 'SCENE');
const chords = lk.picks.find((p) => p.preset.id === 'n-chords').notes;
const PROG_B = [[5, 9, 0, 4], [7, 11, 2, 5], [9, 0, 4, 7], [4, 8, 11, 2]];
const inChord = chords.filter((n) => PROG_B[Math.floor(n.tick / (8 * G.TPS)) % 4].includes(pcOf(n.pitch)));
ok('new_clip_chords_are_the_scenes_chords', inChord.length >= chords.length * 0.9);

/* The band: the kick-locked bass lands where the scene's drums hit hard. */
ok('new_clip_reads_the_bands_hits', lk.ctx.band.length > 0);
const bass = by('n-bass');
const v = G.defaults(bass, lk.ctx);
v[0] = G.figurePosition(lk.ctx, G.BASS_MAP, G.bandSteps(lk.ctx).slice(0, 6));   // the band's accents (WITH KICK)
const locked = G.generateOption(lk.ctx, bass, v).notes;
const accents = new Set(G.bandSteps(lk.ctx));
ok('new_clip_bass_with_kick_lands_on_the_bands_accents', locked.length > 0 && locked.every((n) => accents.has(Math.round(n.tick / G.TPS) % 16)));

/* Unique: another run differs everywhere; the same run again still does,
 * because what was offered lately is passed over. */
G.forgetOptions();
const a = G.generateAll(createInput(false, 'free', 11));
const b = G.generateAll(createInput(false, 'free', 12));
eq('new_clip_two_runs_never_offer_the_same_option', a.picks.filter((p, i) => sig(p.notes) === sig(b.picks[i].notes)).map((p) => p.preset.id).join(' '), '');
G.forgetOptions();
const c1 = G.generateAll(createInput(true, 'locked', 21));
const c2 = G.generateAll(createInput(true, 'locked', 21));
const same = c2.picks.filter((p) => c1.picks.some((q) => G.difference(p.notes, q.notes) < G.MIN_PAIR));
ok('new_clip_the_same_run_again_still_differs', same.length <= 1);
const pairs = [];
for (const r of [a, b, c1]) r.picks.forEach((p, i) => r.picks.slice(i + 1).forEach((q) => { if (G.difference(p.notes, q.notes) < G.MIN_PAIR) pairs.push(p.preset.id + '~' + q.preset.id); }));
eq('new_clip_no_two_options_alike', pairs.join(' '), '');

/* Meaningful: every default of every run is one, on every kind of scene. */
const bad = [];
let runs = 0;
for (const drum of [false, true]) {
    for (const scene of ['empty', 'locked', 'partial', 'free']) {
        for (let n = 0; n < 25; n++) {
            const r = G.generateAll(createInput(drum, scene, 1000 + n, { len: [16, 32, 64][n % 3] }));
            runs++;
            if (r.picks.length !== (drum ? 7 : 8)) bad.push(`${scene}/${n}: ${r.picks.length} options (${r.dropped.join(' ')})`);
            for (const p of r.picks) { const why = G.unmeaning(r.ctx, p.preset, p.notes); if (why) bad.push(`${p.preset.id}@${scene}/${n}: ${why}`); }
        }
    }
}
eq('new_clip_every_default_is_meaningful', bad.slice(0, 6).join(' | '), '');
eq('new_clip_meaningful_ran_200_runs', runs, 200);
G.forgetOptions();

/* A default is its knobs: made again from them, it is the same part. */
const again = mel.picks.filter((p) => sig(G.regenerate(mel.ctx, p.preset, p.knobs)) !== sig(p.notes)).map((p) => p.preset.id);
eq('new_clip_a_default_is_remade_by_its_knobs', again.join(' '), '');

/* DENSITY 0 empties a per-pad option; the guard lets it through. */
const pe = drm.picks[0];
eq('new_clip_density_zero_is_silence', G.regenerate(drm.ctx, pe.preset, [0, ...pe.knobs.slice(1)]).length, 0);

/* The feel row (user, 2026-10-28: chords need not be full length, a gate
 * knob, more variety in rhythm and length). */
const fr = G.prepare(createInput(false, 'free', 31));
const cp = by('n-chords');
const at = (name, x, base = G.defaults(cp, fr)) => { const w = [...base]; w[G.knobIndex(cp, name)] = x; return w; };
const onsets = (ns) => [...new Set(ns.map((n) => n.tick))].sort((a, b) => a - b);
const roomOf = (ns) => { const o = onsets(ns); return (n) => { const i = o.indexOf(n.tick); return (o[i + 1] ?? o[0] + fr.end) - n.tick; }; };
const short = G.regenerate(fr, cp, at('GATE', 1));
const held = G.regenerate(fr, cp, at('GATE', 10));
ok('gate_low_plays_chords_short', short.every((n) => n.gate <= roomOf(short)(n) * 0.25));
ok('gate_full_holds_chords_to_the_next', held.every((n) => n.gate >= Math.min(roomOf(held)(n) - 2, fr.end - n.tick)));
const bar = (ns, b) => ns.filter((n) => n.tick >= b * G.BAR && n.tick < (b + 1) * G.BAR).map((n) => `${n.tick % G.BAR}.${n.pitch % 12}.${n.gate}`).sort().join();
const still = G.regenerate(fr, cp, at('VARY', 0, at('GATE', 5)));
const moved = G.regenerate(fr, cp, at('VARY', 9, at('GATE', 5)));
/* Same onsets and lengths in both bars (the clip's last chord is cut at its end). */
const last = onsets(still).pop();
const inBar = (b) => still.filter((n) => n.tick >= b * G.BAR && n.tick < (b + 1) * G.BAR && n.tick !== last - (1 - b) * G.BAR && n.tick !== last)
    .map((n) => `${n.tick % G.BAR}.${n.gate}`).sort().join();
ok('vary_zero_keeps_the_rhythm_bar_to_bar', inBar(0) === inBar(1) && inBar(0).length > 0);
ok('vary_moves_rhythm_and_lengths', new Set(moved.map((n) => n.gate)).size > new Set(still.map((n) => n.gate)).size
    || onsets(moved).join() !== onsets(still).join());
const pad = by('n-pad');
const strum = G.regenerate(fr, pad, (() => { const w = G.defaults(pad, fr); w[G.knobIndex(pad, 'STRUM')] = 4; return w; })());
ok('strum_spreads_a_chords_voices', G.toEvents(strum).every((e) => e.voices.length < 2 || e.voices[e.voices.length - 1].dt >= 8));
const offbeats = G.patternMap(fr, G.COMP_MAP).steps.findIndex((s) => s.join() === '2,6,10,14');
const sw = (() => { const w = at('PATTERN', offbeats); w[G.knobIndex(cp, 'SWING')] = 6; return G.regenerate(fr, cp, w); })();
ok('swing_moves_off_8ths_on_an_8ths_part', sw.some((n) => n.tick % (4 * G.TPS) === 2 * G.TPS + 14));

/* Defaults differ in length and rhythm, between parts and between runs. */
G.forgetOptions();
const shares = [], padGates = new Set();
for (let n = 0; n < 12; n++) {
    const r = G.generateAll(createInput(false, 'free', 500 + n));
    for (const p of r.picks) {
        const g = p.knobs[G.knobIndex(p.preset, 'GATE')];
        shares.push(`${p.preset.id}:${g}`);
        if (p.preset.id === 'n-pad') padGates.add(g);
    }
}
ok('pad_defaults_are_not_always_held', padGates.size >= 3);
ok('gate_defaults_vary_across_runs', new Set(shares).size >= 30);
G.forgetOptions();

/* A long clip may move through more than four chords: each progression
 * also DEVELOPED, eight-chord ones added, and the run opens on one. */
const chordsIn = (ctx, notes) => new Set(Array.from({ length: ctx.len / 16 }, (_, b) =>
    [...new Set(notes.filter((n) => n.tick >= b * G.BAR && n.tick < (b + 1) * G.BAR).map((n) => n.pitch % 12))].sort().join())).size;
eq('short_clips_keep_the_four_chord_loops', G.prepare(createInput(false, 'free', 1)).plans.filter((p) => !p.label.includes('+DEV') && !['CIRCLE', 'CANON', 'ROAD', 'LAMENT', 'SAGA'].includes(p.label)).length, G.prepare(createInput(false, 'free', 1)).plans.length);
const longPlans = G.prepare(createInput(false, 'free', 1, { len: 128 })).plans.map((p) => p.label);
ok('long_clips_add_developed_and_eight_chord_progressions', longPlans.some((l) => l.endsWith('+DEV')) && longPlans.includes('CIRCLE'));
const rich = [0, 1, 2, 3, 4, 5].map((n) => G.generateAll(createInput(false, 'free', 900 + n, { len: 256 })));
ok('a_long_clip_opens_on_more_than_four_chords', rich.every((r) => G.uniqueChords(r.ctx.plans[G.runPlan(r.ctx)]) > 4));
ok('its_chords_part_plays_more_than_four', rich.every((r) => chordsIn(r.ctx, r.picks.find((p) => p.preset.id === 'n-pad').notes) > 4));
G.forgetOptions();

/* Length: the options follow it, every bar. */
const long = G.generateAll(createInput(false, 'free', 5, { len: 64 }));
ok('new_clip_fills_a_four_bar_clip', long.picks.every((p) => p.notes.some((n) => n.tick >= 48 * G.TPS)));

/* SPARSE (plans/2026-10-29-phrase-space-design.md): a ladder of phrase
 * templates (chord parts also keep beat windows); each phrase lands, held,
 * before its rest; the bass holds its roots between phrases. */
const SPARSE_IDS = ['n-chords', 'n-pad', 'n-stabs', 'n-bass', 'n-arp', 'n-melody', 'n-riff', 'n-counter'];
const sk = (p) => G.knobIndex(p, 'SPARSE');
ok('sparse_on_every_melodic_new_clip', SPARSE_IDS.every((id) => sk(by(id)) === 7 && G.knobIndex(by(id), 'DYNAMICS') < 0));
const BEAT = 4 * G.TPS;
const sounding = (ns, len) => { const on = new Set(); for (const n of ns) for (let t = n.tick; t < n.tick + n.gate; t += G.TPS) on.add(Math.floor(t / G.TPS) % len); return on.size / len; };
const four = G.prepare(createInput(false, 'free', 7, { len: 64 }));
const labels = (id) => { const p = by(id); return Array.from({ length: p.knobs[sk(p)].steps(four) }, (_, i) => p.knobs[sk(p)].label(i, four)); };
eq('sparse_pad_ladder', labels('n-pad').join(), 'ALL,BREATH,LAY OUT,ON/OFF,SECTION END,CHANGES');
ok('sparse_bass_ladder_ends_on_roots_and_dub', labels('n-bass').slice(-2).join() === 'ROOTS,DUB' && labels('n-bass').includes('CALL+ANSWER'));
ok('sparse_chords_keep_beat_windows_and_lay_out', labels('n-chords').includes('BEAT 3') && labels('n-chords').includes('LAY OUT'));
ok('sparse_melody_ends_on_long_tones', labels('n-melody').pop() === 'LONG TONES');
for (const seed of [7, 8, 9]) {
    const sc = G.prepare(createInput(false, 'free', seed, { len: 64 }));
    for (const id of SPARSE_IDS) {
        const p = by(id), k = sk(p), base = G.defaults(p, sc);
        const hk = G.knobIndex(p, 'HARMONY'), h = hk >= 0 ? base[hk] : G.runPlan(sc);
        const sweep = Array.from({ length: p.knobs[k].steps(sc) }, (_, i) => {
            const w = [...base]; w[k] = i;
            return { label: p.knobs[k].label(i, sc), notes: G.regenerate(sc, p, w) ?? [] };
        });
        const sig = (ns) => ns.map((n) => `${n.tick}.${n.pitch}.${n.gate}`).sort().join();
        ok(`sparse_${id}_${seed}_every_position_plays_and_differs`, sweep.every((s, i) => s.notes.length > 0 && (i === 0 || sig(s.notes) !== sig(sweep[0].notes))));
        /* Room: how much of the clip sounds; a bass's rests hold roots, so its room is its onsets. */
        const occ = Object.fromEntries(sweep.map((s) => [s.label, id === 'n-bass' ? s.notes.length : sounding(s.notes, sc.len)]));
        ok(`sparse_${id}_${seed}_hook_and_lead_in_leave_more_room_than_breath`, !('HOOK' in occ) || (occ.HOOK < occ.BREATH && occ['LEAD-IN'] < occ.BREATH));
        if (['n-melody', 'n-bass', 'n-arp', 'n-riff', 'n-counter'].includes(id)) {
            /* Every rest the plan made (a beat or more where the full part played) follows a landed
             * note: on a beat, a tone of the chord there. The part's own gaps are its idiom. */
            const all = sweep[0].notes;
            const ch = (t) => G.chordAt(G.planAt(sc, h).chords, t, sc.k);
            const cuts = [];
            for (const s of sweep.filter((x) => !['ALL', 'DUB'].includes(x.label))) {
                const on = [...s.notes].sort((a, b) => a.tick - b.tick);
                on.forEach((n, i) => {
                    const next = on.find((m) => m.tick > n.tick)?.tick ?? on[0].tick + sc.end;
                    if (next - (n.tick + n.gate) < BEAT || on.some((m) => m.tick <= n.tick && m.tick + m.gate > n.tick + n.gate)) return;
                    if (!all.some((m) => m.tick > n.tick && m.tick < next && !on.some((x) => x.tick === m.tick))) return;
                    if (n.tick % (2 * G.TPS) !== 0 || !ch(n.tick).pcs.includes(G.pc(n.pitch))) cuts.push(`${s.label}@${n.tick}`);
                });
            }
            eq(`sparse_${id}_${seed}_every_rest_follows_a_landing`, cuts.join(' '), '');
        }
        if (id === 'n-bass') {
            /* Between its phrases the bass holds the root of each chord that starts there. */
            const call = sweep.find((s) => s.label === 'CALL').notes;
            const changes = G.planAt(sc, h).chords.map((_, i) => i * G.HALF).filter((t) => t < sc.end && (t === 0 || !G.sameChord(G.chordAt(G.planAt(sc, h).chords, t, sc.k), G.chordAt(G.planAt(sc, h).chords, t - G.HALF, sc.k))));
            ok(`sparse_bass_${seed}_rests_keep_the_roots`, changes.every((t) => call.some((n) => n.tick <= t + 2 * G.TPS && n.tick + n.gate > t)));
        }
        if (id === 'n-melody') {
            const ca = sweep.find((s) => s.label === 'CALL+ANSWER').notes;
            const rel = (lo) => ca.filter((n) => n.tick >= lo && n.tick < lo + 2 * BEAT).map((n) => n.tick - lo).join();
            ok(`sparse_melody_${seed}_answer_echoes_the_call`, rel(0).length > 0 && rel(0) === rel(G.BAR));
        }
        if (id === 'n-chords') {
            const b3 = sweep.find((s) => s.label === 'BEAT 3').notes;
            ok(`sparse_chords_${seed}_beat_3_plays_around_beat_3`, b3.every((n) => { const s = Math.round(n.tick / G.TPS) % 16; return s >= 6 && s <= 10; }));
        }
    }
}
G.forgetOptions();
const phrasedTakes = Array.from({ length: 10 }, (_, n) => G.generateAll(createInput(false, 'free', 700 + n, { len: 64 })))
    .flatMap((r) => r.picks.filter((p) => p.preset.id === 'n-melody').map((p) => p.knobs[7]));
ok('sparse_melody_defaults_are_sometimes_phrased', phrasedTakes.length >= 8 && phrasedTakes.some((v) => v > 0) && phrasedTakes.some((v) => v === 0));
G.forgetOptions();
}
