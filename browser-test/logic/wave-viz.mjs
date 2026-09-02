/* browser-test/logic/wave-viz.mjs — waveform glyphs for single-knob enums, wave cells, toggles, envelope stages
 *
 * Run by browser-test/logic.mjs. The suite body is deliberately left at its
 * original indentation inside run() so blame survives the split.
 */

import {
    planPageLayout, lfoShapeId, enumClassOf, waveCellIndices, waveToggleOf, envStageOf,
    shapeSample, drawWave, eq, _log,
} from './harness.mjs';

export async function run() {
/* ── waveform glyphs for single-knob enums ───────────────────────────────── */

_log('\nTest: new waveform glyph ids and name mappings');
{
    // Names that had no glyph before.
    eq('map: Pulse → 13',      lfoShapeId('Pulse'), 13);
    eq('map: Pulse Tr → 13',   lfoShapeId('Pulse Tr'), 13);
    eq('map: PW-Square → 14',  lfoShapeId('PW-Square'), 14);
    eq('map: Ring → 15',       lfoShapeId('Ring'), 15);
    eq('map: Wavetable → 16',  lfoShapeId('Wavetable'), 16);
    eq('map: Warp → 17',       lfoShapeId('Warp'), 17);
    eq('map: Sink → 18',       lfoShapeId('Sink'), 18);
    eq('map: Off → 19',        lfoShapeId('Off'), 19);

    // Pure aliases — no new glyph, they reuse an existing silhouette.
    eq('map: Ramp → saw-up 2', lfoShapeId('Ramp'), 2);
    eq('map: Rand → s&h 4',    lfoShapeId('Rand'), 4);

    /* The three splits. Each exists because some module lists BOTH members of
     * the pair, and a silhouette that draws them identically is worse than the
     * abbreviation it replaces. */
    eq('Pulse and Square differ (aphex v2_wave)',
        lfoShapeId('Pulse') !== lfoShapeId('Square'), true);
    eq('map: Random → smooth-random 5', lfoShapeId('Random'), 5);
    eq('S&H and Random differ (signal mod_shape)',
        lfoShapeId('S&H') !== lfoShapeId('Random'), true);
    eq('Warp and Sink differ from Sine (ambiotica mod_shape)',
        new Set([lfoShapeId('Sine'), lfoShapeId('Warp'), lfoShapeId('Sink')]).size, 3);

    // Off is a flat line at zero for the whole cycle.
    eq('shape 19 flat at 0.0',  shapeSample(19, 0.0), 0);
    eq('shape 19 flat at 0.5',  shapeSample(19, 0.5), 0);

    // Every new id must sample finite and inside [-1, 1].
    let bad = 0;
    for (let id = 13; id <= 19; id++) {
        for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.99]) {
            const v = shapeSample(id, t);
            if (!Number.isFinite(v) || v < -1 || v > 1) bad++;
        }
    }
    eq('shapes 13-19 all sample within [-1,1]', bad, 0);
}

_log('\nTest: uniqueShape — every option maps to its OWN glyph');
{
    const E = (options) => ({ key: 'k', label: 'L', type: 'enum', options });

    // Qualifies: every option maps, all distinct.
    eq('303 waveform qualifies',    enumClassOf(E(['Saw', 'Square'])).uniqueShape, true);
    eq('forge cv_wave qualifies',
        enumClassOf(E(['Sine', 'Tri', 'Saw', 'Square', 'Noise'])).uniqueShape, true);
    eq('chordism wave_N qualifies',
        enumClassOf(E(['Off', 'Sine', 'Triangle', 'Saw', 'Square', 'Pulse Tr', 'Wavetable'])).uniqueShape, true);
    eq('signal mod_shape qualifies',
        enumClassOf(E(['Sine', 'Tri', 'Saw', 'Square', 'S&H', 'Random'])).uniqueShape, true);
    eq('aphex v2_wave qualifies',
        enumClassOf(E(['Saw', 'Square', 'Pulse', 'Ring'])).uniqueShape, true);
    eq('ambiotica mod_shape qualifies',
        enumClassOf(E(['Sine', 'Warp', 'Sink'])).uniqueShape, true);
    eq('war_bells mot_shape qualifies',
        enumClassOf(E(['Sine', 'Tri', 'Ramp', 'Rand'])).uniqueShape, true);

    // Rejected — a name has no glyph at all.
    eq('hush1 vca_mode rejected',    enumClassOf(E(['Gate', 'Envelope'])).uniqueShape, false);
    eq('chordism vib_stray rejected', enumClassOf(E(['LFO', 'Random'])).uniqueShape, false);
    eq('freak random_mode rejected',
        enumClassOf(E(['sample_hold', 'smooth', 'drift'])).uniqueShape, false);

    /* Rejected — two options would draw the SAME glyph. This half of the rule is
     * what keeps helm and osirus out; without it they would render several
     * different waveforms as one silhouette. */
    /* Helm qualifies now that the level count is part of the id: all eleven
     * options resolve to eleven different silhouettes. */
    eq('helm osc waveform qualifies (counts encoded)',
        enumClassOf(E(['Sine', 'Triangle', 'Square', 'Saw Down', 'Saw Up',
                       '3 Step', '4 Step', '8 Step',
                       '3 Pyramid', '5 Pyramid', '9 Pyramid'])).uniqueShape, true);
    /* But a list that repeats a count still fails — the rule itself is intact. */
    eq('a repeated step count is still rejected',
        enumClassOf(E(['3 Step', '3 Step', 'Sine'])).uniqueShape, false);
    eq('osirus wavetables rejected',
        enumClassOf(E(['Sine', 'Triangle', 'Wave 3', 'Wave 4'])).uniqueShape, false);

    // Non-enums and empty lists are inert.
    eq('float param inert',
        enumClassOf({ key: 'k', label: 'L', type: 'float', options: null }).uniqueShape, false);
    eq('empty option list inert', enumClassOf(E([])).uniqueShape, false);

    // shapeIds is populated exactly when uniqueShape holds.
    eq('shapeIds resolved',  JSON.stringify(enumClassOf(E(['Saw', 'Square'])).shapeIds), '[2,3]');
    eq('shapeIds null when not qualifying',
        enumClassOf(E(['Gate', 'Envelope'])).shapeIds, null);
}

_log('\nTest: drawWave draws straight vertical risers');
{
    const origFill = globalThis.fill_rect;
    const shot = (shape, w = 13, h = 5, cycles = 1, colour = 1) => {
        const rects = [];
        globalThis.fill_rect = (x, y, ww, hh, v) => rects.push({ x, y, w: ww, h: hh, v });
        drawWave(0, 0, w, h, shape, cycles, colour);
        globalThis.fill_rect = origFill;
        return rects;
    };

    const sq = shot(3);                       // square
    eq('drawWave drew something', sq.length > 0, true);
    eq('every column is 1px wide', sq.every(c => c.w === 1), true);
    eq('colour honoured', sq.every(c => c.v === 1), true);
    eq('stays inside the box vertically', sq.every(c => c.y >= 0 && c.y + c.h <= 5), true);
    eq('stays inside the box horizontally', sq.every(c => c.x >= 0 && c.x < 13), true);
    /* The whole point: a square's edge is ONE full-height rect, not a stack of
     * diagonal pixels. Bresenham risers read as slanted steps at this size. */
    eq('square riser is a single full-height vertical rect',
        sq.some(c => c.h === 5), true);
    /* One rect per column, plus the closing edge: a periodic wave jumps from
     * its last sample back to its first, and that jump is a real edge — without
     * it a saw is a bare ramp that just stops. */
    eq('one rect per column plus a closing edge at each end', sq.length, 15);
    eq('closing edge on the last column',  sq.filter(c => c.x === 12).length, 2);
    eq('closing edge on the first column', sq.filter(c => c.x === 0).length, 2);

    // A saw closes too: the ramp's drop back to the start, at both ends.
    const saw = shot(2);
    eq('saw has a closing edge at each end', saw.length, 15);
    eq('saw right edge is full height',
        saw.filter(c => c.x === 12).some(c => c.h === 5), true);
    eq('saw left edge is full height',
        saw.filter(c => c.x === 0).some(c => c.h === 5), true);

    // Off never rises — every column is a single pixel on the centre line, and
    // a continuous shape must NOT get a spurious edge.
    const off = shot(19);
    eq('off is flat: no risers', off.every(c => c.h === 1), true);
    eq('off sits on one row', new Set(off.map(c => c.y)).size, 1);
    eq('off gets no closing edge', off.length, 13);

    // Colour 0 is honoured, for the inverted (selected) overlay row.
    eq('colour 0 honoured', shot(3, 13, 5, 1, 0).every(c => c.v === 0), true);

    // The 16px cell geometry also stays in bounds.
    const cell = shot(0, 12, 8);
    eq('cell-size wave stays in bounds',
        cell.every(c => c.y >= 0 && c.y + c.h <= 8 && c.x >= 0 && c.x < 12), true);
}

_log('\nTest: waveCellIndices — which cells get a silhouette');
{
    const E = (key, options, extra = {}) =>
        ({ key, label: key, type: 'enum', options, renderStyle: 'arc', ...extra });
    const F = (key) => ({ key, label: key, type: 'float', min: 0, max: 1, renderStyle: 'arc' });
    const pad = (arr) => { const a = arr.slice(); while (a.length < 8) a.push(null); return a; };
    const sel = (params) => waveCellIndices(params, planPageLayout(params));

    // A lone waveform enum gets the style.
    eq('lone waveform enum selected', sel(pad([E('waveform', ['Saw', 'Square'])])).has(0), true);

    /* A Shape inside a detected LFO group belongs to the two-cell LFO graphic;
     * re-styling its cell would draw the same param twice. */
    {
        const params = pad([E('lfo_shape', ['Sine', 'Tri', 'Saw', 'Square', 'Noise']), F('lfo_rate')]);
        const L = planPageLayout(params);
        eq('LFO group detected (guard)', L.lfos.length, 1);
        eq('LFO-owned shape is not re-styled', waveCellIndices(params, L).has(0), false);
    }

    // Not a waveform picker at all.
    eq('non-waveform enum untouched', sel(pad([E('vca_mode', ['Gate', 'Envelope'])])).has(0), false);

    // A module config's explicit render style stays authoritative.
    eq('config render override wins',
        sel(pad([E('waveform', ['Saw', 'Square'], { renderStyle: 'preset' })])).has(0), false);

    // Several on one page all qualify (chordism's four osc waves).
    {
        const W = ['Off', 'Sine', 'Triangle', 'Saw', 'Square', 'Pulse Tr', 'Wavetable'];
        const got = sel(pad([E('wave_1', W), E('wave_2', W), E('wave_3', W), E('wave_4', W)]));
        eq('four waveform enums on one page', got.size, 4);
    }
}

_log('\nTest: waveToggleOf — binary "is this waveform sounding?" switches');
{
    const B = (key, label) => ({ key, label, type: 'int', min: 0, max: 1, renderStyle: 'hbar' });
    const E = (key, label, options) => ({ key, label, type: 'enum', options, renderStyle: 'arc' });
    const sh = (p) => waveToggleOf(p)?.shape ?? null;

    // OB-Xd's per-oscillator switches — the case this exists for.
    eq('osc1_saw → saw',      sh(B('osc1_saw', 'Osc1 Saw')), 2);
    eq('osc1_pulse → pulse',  sh(B('osc1_pulse', 'Osc1 Pulse')), 13);
    eq('lfo_sin → sine',      sh(B('lfo_sin', 'LFO Sine')), 0);
    eq('lfo_square → square', sh(B('lfo_square', 'LFO Square')), 3);
    eq('lfo_sh → s&h',        sh(B('lfo_sh', 'LFO S&H')), 4);
    // Two-option Off/On enums count as binary too.
    eq('white_noise enum → noise', sh(E('white_noise', 'White Noise', ['Off', 'On'])), 7);

    // A Mute is the same switch read the other way round.
    eq('mute_noise → noise', sh(E('mute_noise', 'Noise Mute', ['Off', 'On'])), 7);
    eq('mute_noise inverts', waveToggleOf(E('mute_noise', 'Noise Mute', ['Off', 'On'])).invert, true);
    eq('plain toggle does not invert', waveToggleOf(B('osc1_saw', 'Osc1 Saw')).invert, false);

    /* Rejected: names a shape but the switch is about something else.
     * "Sub Octave Down" is an octave switch that happens to say Sub. */
    eq('sub_octave rejected',   waveToggleOf(B('sub_octave', 'Sub Octave Down')), null);
    eq('osc2_sync rejected',    waveToggleOf(B('osc2_sync', 'Osc2 Sync')), null);
    eq('saw pitch rejected',    waveToggleOf(B('saw_pitch', 'Saw Pitch')), null);

    // Rejected: not binary, or names no shape at all.
    eq('non-binary rejected',
        waveToggleOf({ key: 'saw_level', label: 'Saw Level', type: 'float', min: 0, max: 1 }), null);
    eq('shapeless toggle rejected', waveToggleOf(B('osc1_on', 'Osc1 On')), null);
    /* 'off' is itself a glyph name (the flat line). Stripping role words is what
     * stops "saw_off" resolving to flat instead of saw. */
    eq('saw_off still reads as saw', sh(B('saw_off', 'Saw Off')), 2);
    // Two shapes named → which one does the switch control? Refuse to guess.
    eq('two shapes rejected', waveToggleOf(B('saw_square', 'Saw Square')), null);

    /* A randomiser is an action, not the thing it names (same rule as
     * step-labels.ts) — and 'rnd' resolves to the smooth-random glyph, so
     * without this every Randomise button became a waveform switch. */
    eq('rnd_preset rejected',  waveToggleOf(B('rnd_preset', 'Randomise Preset')), null);
    eq('rnd_motion rejected',  waveToggleOf(B('rnd_motion', 'Rnd Motion')), null);
    /* Ring names a modulator PAIR, not a shape: Surge mutes Ring 1x2 and
     * Ring 2x3 separately and both would draw the identical glyph. */
    eq('mute_ring12 rejected', waveToggleOf(B('mute_ring12', 'Ring 1x2 Mute')), null);
}

_log('\nTest: envStageOf — lone attack/decay knobs');
{
    const N = (key, label) => ({ key, label, type: 'float', min: 0, max: 1 });

    eq('decay → d',        envStageOf(N('decay', 'Decay')), 'd');
    eq('cv_decay → d',     envStageOf(N('cv_decay', 'Decay')), 'd');
    eq('cv_e2_dec → d',    envStageOf(N('cv_e2_dec', 'E2 Decay')), 'd');
    eq('attack → a',       envStageOf(N('attack', 'Attack')), 'a');
    eq('soft_attack → a',  envStageOf(N('soft_attack', 'Soft Attack')), 'a');

    /* A randomiser is an amount, not the thing it names — euclidrum has eight
     * "Decay Rnd" knobs that randomise decay rather than set it. */
    eq('decay_rnd rejected',  envStageOf(N('lane1_decay_rnd', 'Decay Rnd')), null);
    /* A reverb tail is a room size, not an amplitude stage. */
    eq('rev_decay rejected',  envStageOf(N('rev_decay', 'Reverb Dcy')), null);
    eq('delay decay rejected', envStageOf(N('delay_decay', 'Delay Decay')), null);
    // envelope.ts's own vetoes: a curve/mode control is not a time.
    eq('decay_shape rejected', envStageOf(N('decay_shape', 'Decay Shape')), null);
    eq('lfo decay rejected',   envStageOf(N('lfo1_decay', 'LFO1 Decay')), null);

    /* No bare-letter fallback. minijv labels a multi-segment Roland TVA
     * envelope "A.Env L1" (Amp Envelope); reading that 'a' as the attack STAGE
     * turned 32 level/time params into attacks. */
    eq('A.Env L1 is not an attack', envStageOf(N('nvram_tone_0_tvaenvlevel1', 'A.Env L1')), null);
    eq('A.Env T3 is not an attack', envStageOf(N('nvram_tone_0_tvaenvtime3', 'A.Env T3')), null);

    /* The veto spans key AND label. Chordism keys its reverb tail
     * `reverb_decay` but labels it plain "Decay"; vetoing only the text that
     * carried the word let the label through and drew an amplitude envelope
     * for a room size. */
    eq('reverb key + plain Decay label rejected',
        envStageOf(N('reverb_decay', 'Decay')), null);
    eq('rnd key + plain Decay label rejected',
        envStageOf(N('lane1_decay_rnd', 'Decay')), null);

    // An enum named Decay is a mode list, not a time.
    eq('enum decay rejected',
        envStageOf({ key: 'decay', label: 'Decay', type: 'enum', options: ['Short', 'Long'] }), null);

    /* `env: false` is the config's veto — the escape hatch for a key stem that
     * matches while the param is something else. 9W9's `bd_c_attack` is a click
     * LEVEL; without this it draws a ramp over a level. */
    eq('env:false vetoes a lone stage',
        envStageOf({ ...N('bd_c_attack', 'Attack'), env: false }), null);
    eq('and the same key without it is still a stage',
        envStageOf(N('bd_c_attack', 'Attack')), 'a');
}

}
