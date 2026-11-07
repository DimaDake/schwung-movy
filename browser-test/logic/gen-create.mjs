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
eq('new_clip_melodic_offers_every_part', ids(mel), 'n-chords n-pad n-stabs n-bass n-arp n-melody n-riff n-counter n-hold n-pulse n-walk n-looper');
const drm = G.generateAll(createInput(true, 'empty', 1));
eq('new_clip_drums_offers_four_kits_then_two_per_pad', ids(drm), 'n-drum-map n-euclid-kit n-broken n-perc n-pad-euclid n-pad-pattern');
ok('new_clip_whole_kit_options_come_first', drm.picks.slice(0, 4).every((p) => !p.preset.perPad) && drm.picks.slice(4).every((p) => p.preset.perPad));
eq('new_clip_a_silent_set_takes_the_key_setting', `${mel.ctx.key.tonic}${mel.ctx.key.minor ? 'm' : ''}`, '0');
eq('new_clip_per_pad_writes_only_its_pad', [...new Set(drm.picks.find((p) => p.preset.perPad).notes.map((n) => n.pitch))].join(), String(G.padOf(drm.ctx)));

/* A locked scene: the parts sit on the others' chords (Fmaj7 G7 Am7 E7). */
const lk = G.generateAll(createInput(false, 'locked', 2));
eq('new_clip_locked_scene_plays_the_scenes_chords', lk.ctx.plans[0].label, 'SCENE');
eq('new_clip_locked_scene_opens_on_them', G.runPlan(lk.ctx), 0);
/* HARMONY there only adds approach chords (user, 2026-11-06: no dead knob). */
ok('new_clip_locked_harmony_adds_approach_chords', lk.ctx.plans.length > 1 && lk.ctx.plans.slice(1).every((p) => ['APPROACH', 'APPROACH + BEAT', 'EVERY HALF BAR'].includes(p.label))
    && lk.ctx.plans.slice(1).every((p) => p.chords.length === 2 * lk.ctx.plans[0].chords.length));
const chords = lk.picks.find((p) => p.preset.id === 'n-chords').notes;
const PROG_B = [[5, 9, 0, 4], [7, 11, 2, 5], [9, 0, 4, 7], [4, 8, 11, 2]];
const inChord = chords.filter((n) => PROG_B[Math.floor(n.tick / (8 * G.TPS)) % 4].includes(pcOf(n.pitch)));
ok('new_clip_chords_are_the_scenes_chords', inChord.length >= chords.length * 0.9);

/* The band: the kick-locked bass lands where the scene's drums hit hard. */
ok('new_clip_reads_the_bands_hits', lk.ctx.band.length > 0);
const bass = by('n-bass');
const v = G.defaults(bass, lk.ctx);
v[0] = G.figurePosition(lk.ctx, G.BASS_MAP, G.lockFigure(lk.ctx));   // locked to the kick (WITH KICK)
const locked = G.generateOption(lk.ctx, bass, v).notes;
const lockSteps = new Set(G.lockFigure(lk.ctx));
/* ...but for the answering bar's pickups on its last eighth (create/riff.ts). */
const pickup = (n) => Math.round(n.tick / G.TPS) % 32 >= 30;
ok('new_clip_bass_with_kick_lands_on_its_lock', locked.length > 0 && locked.every((n) => pickup(n) || lockSteps.has(Math.round(n.tick / G.TPS) % 16)));
/* The lock is the kick itself, not every accent (a snare or a struck chord drew the bass off it). */
const kicks = G.kickSteps(lk.ctx);
/* The fixture's kick is four on the floor and its accents add the 14: a kick
 * of three hits or more is the lock alone. */
eq('new_clip_bass_lock_is_the_kick', [...lockSteps].sort((a, b) => a - b).join(), [...kicks].sort((a, b) => a - b).join());
ok('new_clip_bass_lock_is_not_every_accent', kicks.length >= 3 && G.bandSteps(lk.ctx).some((s) => !lockSteps.has(s)));

/* BASS under another track's chords (plans/2026-11-06-bass-over-chords-evaluation.md):
 * a pad voiced in inversions (C/E F/A G/B Am/C, a half-bar each), struck
 * `push` steps early. The bass plays each chord's root, never the
 * keyboard's low voice, and changes when the chord sounds, not on the grid. */
{
    const VOICINGS = [[52, 55, 60], [57, 60, 65], [59, 62, 67], [60, 64, 69]];
    const ROOTS = [0, 5, 7, 9];
    const H = 8 * G.TPS;
    const overPad = (push) => {
        const input = createInput(false, 'empty', 5, { len: 32 });
        const notes = VOICINGS.flatMap((v, i) => v.map((pitch) => {
            const tick = Math.max(0, i * H - push * G.TPS);
            const next = i + 1 < VOICINGS.length ? (i + 1) * H - push * G.TPS : 4 * H;
            return { tick, pitch, gate: next - tick - 4, vel: 90 };
        }));
        input.tracks.push({ index: 1, name: 'Track 2', module: 'obxd', drum: false, padNames: null,
            clips: [{ track: 1, slot: 1, len: 32, loopStart: 0, scaleNum: 1, scaleDen: 1, transpose: 0, quant: 0, notes }] });
        const ctx = G.prepare(input);
        const bass = by('n-bass');
        const v = G.defaults(bass, ctx);
        v[0] = G.figurePosition(ctx, G.BASS_MAP, [0, 2, 4, 6, 8, 10, 12, 14]);
        v[1] = 1;                                           // ROOTS
        v[G.knobIndex(bass, 'SPACE')] = 0;
        return { ctx, notes: G.generateOption(ctx, bass, v).notes };
    };
    const sounding = (push, tick) => ROOTS[Math.min(3, Math.floor((tick + push * G.TPS) / H))];
    const flat = overPad(0);
    eq('new_clip_bass_under_a_pad_is_locked', flat.ctx.freedom, 'locked');
    ok('new_clip_bass_plays_roots_not_the_pads_inversions', flat.notes.length > 0 && flat.notes.every((n) => pcOf(n.pitch) === sounding(0, n.tick)));
    const pushed = overPad(2);
    ok('new_clip_bass_changes_where_pushed_chords_sound', pushed.notes.length > 0 && pushed.notes.every((n) => pcOf(n.pitch) === sounding(2, n.tick)));
}

/* Variation's BASSLINE over the same pushed pad, with a kick: the shared
 * 16th reading (analysis/heard.ts via Prog.fine) reaches Variation too, its
 * first moved take locks to the kick, and its default is a RIFF that moves. */
{
    const VOICINGS = [[52, 55, 60], [57, 60, 65], [59, 62, 67], [60, 64, 69]];
    const ROOTS = [0, 5, 7, 9];
    const H = 8 * G.TPS, push = 2;
    const pad = VOICINGS.flatMap((v, i) => v.map((pitch) => {
        const tick = Math.max(0, i * H - push * G.TPS);
        const next = i + 1 < VOICINGS.length ? (i + 1) * H - push * G.TPS : 4 * H;
        return { tick, pitch, gate: next - tick - 4, vel: 90 };
    }));
    const kick = [0, 4, 8, 12, 16, 20, 24, 28].map((s) => ({ tick: s * G.TPS, pitch: 36, gate: 12, vel: 110 }));
    const src = Array.from({ length: 16 }, (_, i) => ({ tick: i * 2 * G.TPS, pitch: 36 + ROOTS[Math.floor(i / 4)], gate: 40, vel: 100 }));
    const at = (track, slot, notes) => ({ track, slot, len: 32, loopStart: 0, scaleNum: 1, scaleDen: 1, transpose: 0, quant: 0, notes });
    const input = { task: 'variation', level: 'BALANCED', len: 32, scale: [1, 1], drum: false, kit: [], root: 'C', mode: 'major',
        target: { track: 0, slot: 2 }, source: { track: 0, slot: 1 },
        tracks: [{ index: 0, name: 'Bass', module: 'obxd', drum: false, padNames: null, clips: [at(0, 1, src)] },
            { index: 1, name: 'Pad', module: 'obxd', drum: false, padNames: null, clips: [at(1, 1, pad), at(1, 2, pad)] },
            { index: 2, name: 'Drums', module: 'drumrack', drum: true, padNames: null, clips: [at(2, 1, kick), at(2, 2, kick)] }] };
    const ctx = G.prepare(input);
    const bl = G.presetById('v-bassline');
    const v = G.defaults(bl, ctx);
    const sounding = (tick) => ROOTS[Math.min(3, Math.floor((tick + push * G.TPS) / H))];
    const roots = G.regenerate(ctx, bl, v.map((x, i) => (bl.knobs[i].name === 'NOTES' ? 1 : x)));
    ok('variation_bassline_changes_where_pushed_chords_sound', roots?.length > 0 && roots.every((n) => pcOf(n.pitch) === sounding(n.tick)));
    const pk = G.knobIndex(bl, 'PATTERN');
    const alt = G.variantKnobs(bl, ctx, v, ctx.seed, 0);
    eq('variation_bassline_first_take_locks_to_the_kick', alt && bl.knobs[pk].label(alt[pk], ctx), 'KICK');
    const riff = G.regenerate(ctx, bl, v);
    eq('variation_bassline_defaults_to_riff', bl.knobs[G.knobIndex(bl, 'NOTES')].label(v[G.knobIndex(bl, 'NOTES')], ctx), 'RIFF');
    const inChord = (a, b) => sounding(a.tick) === sounding(b.tick);
    /* In the first bar: the answering bar's run would step anyway. */
    const bar1 = (riff ?? []).filter((n) => n.tick < 16 * G.TPS);
    const steps = bar1.filter((n, i, ns) => i > 0 && inChord(ns[i - 1], n) && [1, 2].includes(Math.abs(n.pitch - ns[i - 1].pitch)));
    ok('variation_bassline_riff_steps_inside_a_chord', steps.length > 0);
}

/* A two-bar phrase: the answering bar's last eighth steps into the next
 * bar's root (a pickup on a figure that leaves it empty); the first bar
 * does not. */
{
    const ctx = G.prepare(createInput(false, 'empty', 9, { len: 64 }));
    const bass = by('n-bass');
    const v = G.defaults(bass, ctx);
    v[0] = G.figurePosition(ctx, G.BASS_MAP, [0, 8]);       // HALF NOTES
    v[1] = 0;                                               // AS WRITTEN
    v[G.knobIndex(bass, 'SPACE')] = 0;
    const ns = G.generateOption(ctx, bass, v).notes;
    const at = (bar) => ns.find((n) => n.tick === (bar * 16 + 14) * G.TPS);
    const root = (bar) => G.chordUnder(ctx, v[3], ((bar * 16) * G.TPS) % ctx.end).root;
    const steps = [1, 3].map((b) => at(b) && Math.abs(G.nearestPitch(at(b).pitch, [root(b + 1)]) - at(b).pitch));
    ok('new_clip_bass_answers_its_phrase_into_the_next_root', !at(0) && !at(2) && steps.every((d) => d !== undefined && d >= 1 && d <= 2));
}

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
            if (r.picks.length !== (drum ? 6 : 12)) bad.push(`${scene}/${n}: ${r.picks.length} options (${r.dropped.join(' ')})`);
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
const pe = drm.picks.find((p) => p.preset.perPad);
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
const still = G.regenerate(fr, cp, at('DRIFT', 0, at('GATE', 5)));
const moved = G.regenerate(fr, cp, at('DRIFT', 9, at('GATE', 5)));
/* Same onsets and lengths in both bars (the clip's last chord is cut at its end). */
const last = onsets(still).pop();
const inBar = (b) => still.filter((n) => n.tick >= b * G.BAR && n.tick < (b + 1) * G.BAR && n.tick !== last - (1 - b) * G.BAR && n.tick !== last)
    .map((n) => `${n.tick % G.BAR}.${n.gate}`).sort().join();
ok('drift_zero_keeps_the_rhythm_bar_to_bar', inBar(0) === inBar(1) && inBar(0).length > 0);
ok('drift_moves_the_part', sig(moved) !== sig(still));
const pad = by('n-pad');
const strum = G.regenerate(fr, pad, (() => { const w = G.defaults(pad, fr); w[G.knobIndex(pad, 'STRUM')] = 4; return w; })());
ok('strum_spreads_a_chords_voices', G.toEvents(strum).every((e) => e.voices.length < 2 || e.voices[e.voices.length - 1].dt >= 8));
const offbeats = G.patternMap(fr, G.COMP_MAP).steps.findIndex((s) => s.join() === '2,6,10,14');
const stp = by('n-stabs');
const sw = (() => { const w = G.defaults(stp, fr); w[G.knobIndex(stp, 'PATTERN')] = G.patternMap(fr, G.STAB_MAP).steps.findIndex((s) => s.join() === '2,6,10,14');
    return G.regenerate(fr, stp, w); })();
/* No SWING knob: an off-beat part is written on the grid, the set's swing applies at playback. */
ok('offbeats_written_on_the_grid', sw.every((n) => n.tick % (2 * G.TPS) === 0));

/* CHORDS: DENSITY in SWING's place, over the PATTERN's own figure (user,
 * 2026-11-01: "there is no density for new clip for chords"). */
ok('chords_density_is_its_own_knob', G.knobIndex(cp, 'SWING') < 0 && G.knobIndex(cp, 'DENSITY') === 4);
const inBar0 = (ns) => onsets(ns).filter((t) => t < G.BAR);
const dens = Array.from({ length: 11 }, (_, d) => inBar0(G.regenerate(fr, cp, at('DENSITY', d, at('PATTERN', offbeats + 1)))));
eq('chords_density_5_is_the_pattern', dens[5].map((t) => t / G.TPS).join(), '2,6,10,14');
ok('chords_density_turns_one_way', dens.every((o, d) => d === 0 || o.length > dens[d - 1].length || (o.length === 1 && d <= 5)));
ok('chords_density_nests', dens[3].every((t) => dens[5].includes(t)) && dens[5].every((t) => dens[8].includes(t)));
ok('chords_density_never_moves_off_the_map_at_5', G.patternMap(fr, G.COMP_MAP).steps.every((s, v) => G.patternDense(fr, G.COMP_MAP, v, 5) === s));

/* PAD: a rhythm PATTERN in VARY's place (user, 2026-11-01: "there is no
 * rythm patter for pads"), every change of the harmony still struck. */
const pk = G.knobIndex(pad, 'PATTERN');
ok('pad_pattern_is_its_own_knob', G.knobIndex(pad, 'VARY') < 0 && pk === 3 && G.knobIndex(pad, 'MOTION') < 0);
const padLabels = Array.from({ length: pad.knobs[pk].steps(fr) }, (_, i) => pad.knobs[pk].label(i, fr));
const padAt = (name) => { const w = G.defaults(pad, fr); w[pk] = padLabels.indexOf(name); return G.regenerate(fr, pad, w); };
eq('pad_pattern_opens_held', padLabels[pad.knobs[pk].def(fr)], 'HELD');
/* Over half-bar chords BAR and HALVES strike where HELD does (every change is
 * struck); the off-beat figures never do. */
const padSigs = padLabels.map((l) => sig(padAt(l)));
ok('pad_pattern_off_beat_figures_are_new_takes', new Set(padSigs).size >= padLabels.length - 2
    && ['3-3-2', 'CHARLESTON', 'PUSH', '2+4'].every((l) => sig(padAt(l)) !== sig(padAt('HELD'))));
ok('pad_pattern_halves_strike_each_half_bar', onsets(padAt('HALVES')).every((t) => t % (8 * G.TPS) === 0) && onsets(padAt('HALVES')).length === 4);
ok('pad_pattern_3_3_2_strikes_the_dotted_quarters', [0, 6, 12].every((s) => onsets(padAt('3-3-2')).includes(s * G.TPS)));
const chordsOf = (ns) => new Set(G.toEvents(ns).map((e) => e.voices.map((v) => v.pitch % 12).sort().join())).size;
ok('pad_pattern_hears_every_change', ['BAR', '2+4', 'PUSH'].every((l) => chordsOf(padAt(l)) >= chordsOf(padAt('HELD'))));

/* New Clip adopts five Variation generators (plans/2026-11-01-generator-ux-design.md §2.9):
 * a drone, a pulse, a walking bass and a looped line from the scene alone; a
 * second line only where another track plays a melody. */
{
    const withMelody = createInput(false, 'locked', 6, { melody: true });
    const plain = G.generateAll(createInput(false, 'locked', 6));
    ok('harmonize_follow_not_offered_without_a_melody', !plain.picks.some((p) => ['n-harmonize', 'n-follow'].includes(p.preset.id)));
    const sung = G.generateAll(withMelody);
    ok('harmonize_follow_offered_with_a_melody', ['n-harmonize', 'n-follow'].every((id) => sung.picks.some((p) => p.preset.id === id)));
    const mel = new Set(withMelody.tracks[withMelody.tracks.length - 1].clips[0].notes.map((n) => `${n.tick}.${n.pitch}`));
    ok('second_line_never_doubles_the_melody', ['n-harmonize', 'n-follow'].every((id) => {
        const p = sung.picks.find((x) => x.preset.id === id);
        return p && p.notes.length > 0 && p.notes.filter((n) => mel.has(`${n.tick}.${n.pitch}`)).length <= p.notes.length * 0.2;
    }));
    for (const id of ['n-hold', 'n-pulse', 'n-walk', 'n-looper']) {
        const p = plain.picks.find((x) => x.preset.id === id);
        ok(`${id}_writes_a_part`, !!p && p.notes.length > 0 && !G.unmeaning(plain.ctx, p.preset, p.notes));
    }
    const todo = G.startRequest(createInput(false, 'locked', 6, { melody: true })).todo.map((t) => t.preset.id);
    const firstAdopted = todo.findIndex((id) => ['n-hold', 'n-pulse', 'n-walk', 'n-looper', 'n-harmonize', 'n-follow'].includes(id));
    ok('todays_eight_are_made_first', firstAdopted >= 8 * G.TAKES && todo.slice(0, firstAdopted).every((id) => !id.startsWith('n-pad-')));
    const hold = plain.picks.find((x) => x.preset.id === 'n-hold');
    ok('hold_note_is_held', !!hold && hold.notes.every((n) => n.gate >= 4 * G.TPS));
}

/* Knob sets (plans/2026-11-01-generator-ux-design.md §4.1). */
{
    const lk2 = G.prepare(createInput(false, 'locked', 4));
    const fr2 = G.prepare(createInput(false, 'free', 4));
    const st = by('n-stabs');
    const n = (c, p, name, x) => { const w = G.defaults(p, c); w[G.knobIndex(p, name)] = x; return (G.regenerate(c, p, w) ?? []).length; };
    ok('stabs_density_thins_and_fills', G.knobIndex(st, 'DENSITY') >= 0 && n(lk2, st, 'DENSITY', 0) < n(lk2, st, 'DENSITY', 5) && n(lk2, st, 'DENSITY', 5) < n(lk2, st, 'DENSITY', 10));
    const pcs = (p, h) => { const w = G.defaults(p, fr2); w[G.knobIndex(p, 'HARMONY')] = h; return [...new Set((G.regenerate(fr2, p, w) ?? []).map((x) => x.pitch % 12))].sort().join(); };
    for (const id of ['n-melody', 'n-riff', 'n-counter']) {
        const p = by(id);
        ok(`${id}_follows_harmony`, G.knobIndex(p, 'HARMONY') >= 0 && [1, 2, 3, 4].some((h) => pcs(p, h) !== pcs(p, 0)));
    }
    const ct = by('n-counter');
    const leap = (d) => { const w = G.defaults(ct, fr2); w[G.knobIndex(ct, 'DENSITY')] = d; const ns = [...(G.regenerate(fr2, ct, w) ?? [])].sort((a, b) => a.tick - b.tick);
        return Math.max(0, ...ns.slice(1).map((x, i) => Math.abs(x.pitch - ns[i].pitch))); };
    ok('counter_density_reaches_leaps', G.knobIndex(ct, 'MOTION') < 0 && leap(10) > leap(0));
}

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
/* Each development also BOLD (a turn to MEDIANT or a move that connects
 * badly): at HARMONY's far end, never a default nor a take. */
const chordsKey = (p) => p.chords.map((c) => (c ? c.root + c.quality : '-')).join(' ');
const boldOf = (r) => r.ctx.plans.map((p, i) => [p, i]).filter(([p]) => p.label.endsWith('+BOLD'));
ok('long_clips_add_bold_developments', rich.every((r) => boldOf(r).length > 0 && boldOf(r).every(([p]) => p.ext)));
const fourOf = (r) => r.ctx.plans.filter((p) => p.count === 4);
ok('bold_developments_sit_at_the_far_end', rich.every((r) => { const f = fourOf(r), e = f.findIndex((p) => p.ext); return e > 0 && f.slice(e).every((p) => p.ext); }));
ok('a_bold_development_turns_where_a_plain_one_does_not', rich.every((r) => boldOf(r).every(([b]) => !r.ctx.plans.some((p) => !p.ext && chordsKey(p) === chordsKey(b)))));
ok('a_take_never_opens_on_a_bold_development', rich.every((r) => !r.ctx.plans[G.runPlan(r.ctx)].ext && !r.ctx.plans[G.defaultHarmony(r.ctx)].ext));
eq('short_clips_have_no_bold_developments', G.prepare(createInput(false, 'free', 1)).plans.filter((p) => p.label.endsWith('+BOLD')).length, 0);
G.forgetOptions();

/* Length: the options follow it, every bar. */
const long = G.generateAll(createInput(false, 'free', 5, { len: 64 }));
ok('new_clip_fills_a_four_bar_clip', long.picks.every((p) => p.notes.some((n) => n.tick >= 48 * G.TPS)));

/* SPARSE (plans/2026-10-29-phrase-space-design.md): a ladder of phrase
 * templates (chord parts also keep beat windows); each phrase lands, held,
 * before its rest; the bass holds its roots between phrases. */
const SPARSE_IDS = ['n-chords', 'n-pad', 'n-stabs', 'n-bass', 'n-arp', 'n-melody', 'n-riff', 'n-counter'];
const sk = (p) => G.knobIndex(p, 'SPACE');
ok('space_on_every_melodic_new_clip', SPARSE_IDS.every((id) => sk(by(id)) >= 0));
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
    .flatMap((r) => r.picks.filter((p) => p.preset.id === 'n-melody').map((p) => p.knobs[G.knobIndex(p.preset, 'SPACE')]));
ok('sparse_melody_defaults_are_sometimes_phrased', phrasedTakes.length >= 8 && phrasedTakes.some((v) => v > 0) && phrasedTakes.some((v) => v === 0));
G.forgetOptions();

/* The Set's mode on a silent scene: chords and lines in it (the stand-in
 * chords keep the odd note in, so almost nothing leaves the mode), and its
 * odd note heard. */
for (const [mode, steps, odd] of [['dorian', G.DORIAN, 9], ['phrygian', G.PHRYGIAN, 1], ['lydian', G.LYDIAN, 6], ['mixolydian', G.MIXOLYDIAN, 10]]) {
    G.forgetOptions();
    const r = G.generateAll({ ...createInput(false, 'empty', 1), root: 'D', mode });
    const ns = r.picks.flatMap((p) => p.notes);
    const out = ns.filter((n) => !steps.includes(pcOf(n.pitch - 2))).length;
    eq(`new_clip_${mode}_key_carries_the_mode`, r.ctx.key.mode?.join(), steps.join());
    ok(`new_clip_${mode}_stays_in_the_mode`, out <= ns.length * 0.01, `${out}/${ns.length} out`);
    ok(`new_clip_${mode}_sounds_its_odd_note`, ns.some((n) => pcOf(n.pitch - 2) === odd));
    ok(`new_clip_${mode}_no_broken_chords`, r.ctx.plans.every((p) => p.chords.every((c) => !c || !['dim', 'aug', 'm7b5'].includes(c.quality))));
}
}
