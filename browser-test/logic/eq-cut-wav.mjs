/* browser-test/logic/eq-cut-wav.mjs — EQ gain groups, low/high cut corners, and wav_position pairing
 *
 * Run by browser-test/logic.mjs. The suite body is deliberately left at its
 * original indentation inside run() so blame survives the split.
 */

import {
    MOCK_SYNTHS, detectEqViz, cutKindOf, detectCutPair, drawCutCurve, detectWavViz,
    eq, bootModel, P, _log,
} from './harness.mjs';

export async function run() {
_log('\nTest: detectEqViz — low/mid/high gain groups');
{
    const G = (key, label, min = -12, max = 12) =>
        ({ key, label, type: 'float', min, max, renderStyle: 'arc' });
    const pad = (a) => { const r = a.slice(); while (r.length < 8) r.push(null); return r; };
    const one = (a) => detectEqViz(pad(a));

    // Three bands under one qualifier.
    {
        const g = one([G('eq_lo', 'Low'), G('eq_mid', 'Mid'), G('eq_hi', 'High')]);
        eq('3-band group found', g.length, 1);
        eq('3-band bands', g[0].bands.join('/'), 'low/mid/high');
        eq('3-band indices', [g[0].low, g[0].mid, g[0].high].join(','), '0,1,2');
    }
    // Two bands is enough; krautdrums names them Body and Air.
    {
        const g = one([G('eq_body', 'Body', -6, 6), G('eq_air', 'Air', -6, 6)]);
        eq('2-band group found', g.length, 1);
        eq('2-band bands', g[0].bands.join('/'), 'mid/high');
    }
    /* OTT-X keys its bands lgain/mgain/hgain, so each key token would become a
     * different qualifier and the group would never form. */
    {
        const g = one([G('lgain', 'Low Gain', -30, 30), G('mgain', 'Mid Gain', -30, 30),
                       G('hgain', 'Hi Gain', -30, 30)]);
        eq('glued band+gain keys group', g.length, 1);
        eq('glued bands', g[0].bands.join('/'), 'low/mid/high');
    }
    // A single band is a knob, not a curve.
    eq('one band is not a group', one([G('eq_lo', 'Low')]).length, 0);

    /* The bipolar-dB test is what rejects everything the words let through.
     * Each of these is a real fleet param that matched on words alone. */
    eq('crossover frequencies rejected',
        one([G('low_xo', 'Low/Mid Hz', 200, 1200), G('high_xo', 'Mid/Hi Hz', 1000, 16000)]).length, 0);
    eq('per-band Q rejected',
        one([G('q_lo', 'Q Low', 0.3, 8), G('q_mid', 'Q Mid', 0.3, 8), G('q_hi', 'Q Hi', 0.3, 8)]).length, 0);
    eq('random low/high bounds rejected',
        one([G('kick_rand_low', 'Low', 0, 127), G('kick_rand_high', 'High', 0, 127)]).length, 0);
    eq('unipolar tone controls rejected',
        one([G('delay_tone_lo', 'Lo', 0, 1), G('delay_tone_hi', 'Hi', 0, 1)]).length, 0);
    // A cut/shelf FREQUENCY is a filter control, not a band gain.
    eq('low cut rejected',
        one([G('low_cut', 'Low Cut'), G('high_cut', 'High Cut')]).length, 0);

    // Different qualifiers stay apart.
    eq('separate qualifiers do not merge',
        one([G('eq_lo', 'Low'), G('drive_hi', 'Drive High')]).length, 0);
}

_log('\nTest: cutKindOf — low/high cut corner frequencies');
{
    const F = (key, label, min = 0, max = 1) => ({ key, label, type: 'float', min, max });

    // "Low cut" removes lows → a high-pass corner.
    eq('low_cut → lowcut',   cutKindOf(F('low_cut', 'Low Cut')), 'lowcut');
    eq('hpf → lowcut',       cutKindOf(F('hpf', 'HPF')), 'lowcut');
    eq('highpass → lowcut',  cutKindOf(F('highpass', 'High Pass')), 'lowcut');
    eq('esp_lo_cut → lowcut', cutKindOf(F('esp_lo_cut', 'Lo Cut')), 'lowcut');
    // "High cut" removes highs → a low-pass corner.
    eq('high_cut → highcut', cutKindOf(F('high_cut', 'High Cut')), 'highcut');
    eq('lpf → highcut',      cutKindOf(F('lpf', 'LPF')), 'highcut');
    eq('hiCut → highcut',    cutKindOf(F('hiCut', 'HiCut')), 'highcut');

    /* A SLOPE is dB per octave, not a corner — mono-voice's "HP Slope". */
    eq('HP Slope rejected',  cutKindOf(F('flt13', 'HP Slope', 0, 127)), null);
    /* A modulation AMOUNT aimed at the filter is not the filter's corner:
     * aphex keys them hpf_mg/lpf_mg (mg = modulation generator). */
    eq('hpf_mg rejected',    cutKindOf(F('hpf_mg', 'HPF MG', -1, 1)), null);
    eq('lpf_mg rejected',    cutKindOf(F('lpf_mg', 'LPF MG', -1, 1)), null);
    // Damping and band gains merely mention a band.
    eq('reverb damp rejected', cutKindOf(F('reverb_hi_damp', 'Hi Damp')), null);
    eq('high gain rejected',   cutKindOf(F('high_gain', 'High Gain', -12, 12)), null);
    // A crossover names BOTH ends, so it is not one corner.
    eq('Low/Mid Hz rejected',  cutKindOf(F('low_xo', 'Low/Mid Hz', 200, 1200)), null);

    // A pair on one page becomes a single band-pass; a lone cut does not pair.
    const pad = (a) => { const r = a.slice(); while (r.length < 8) r.push(null); return r; };
    {
        const g = detectCutPair(pad([F('low_cut', 'Low Cut'), F('high_cut', 'High Cut')]));
        eq('pair found', g.length, 1);
        eq('pair indices', `${g[0].lowcut},${g[0].highcut}`, '0,1');
    }
    eq('lone lowcut is not a pair', detectCutPair(pad([F('hpf', 'HPF')])).length, 0);

    /* The pair's corners share the span, overlapping past the middle. They must
     * still MEET and shut the band at the extreme of both knobs — that state is
     * real — but the raw values leave it dead across 6 of 25 sampled positions,
     * every one drawing the same floor. */
    {
        const origFill = globalThis.fill_rect;
        const bandHeight = (lo, hi) => {
            const rects = [];
            globalThis.fill_rect = (x, y, w, h, v) => rects.push({ x, y, w, h, v });
            drawCutCurve(11, 0, 2, lo, hi);
            globalThis.fill_rect = origFill;
            const baseY = 11 + 14;
            // Ignore the dotted axis: anything drawn ABOVE the floor is band.
            const above = rects.filter(r => r.y < baseY);
            return above.length === 0 ? 0 : baseY - Math.min(...above.map(r => r.y));
        };
        let worst = 99;
        for (const lo of [0, 0.25, 0.5, 0.75, 1]) {
            for (const hi of [0, 0.25, 0.5, 0.75, 1]) worst = Math.min(worst, bandHeight(lo, hi));
        }
        let dead = 0;
        for (const lo of [0, 0.25, 0.5, 0.75, 1]) {
            for (const hi of [0, 0.25, 0.5, 0.75, 1]) if (bandHeight(lo, hi) === 0) dead++;
        }
        // Both knobs at their extremes: the band genuinely shuts.
        eq('lowcut max + highcut min closes to a flat line', bandHeight(1, 0), 0);
        // And it closes GRADUALLY rather than snapping from full to nothing.
        eq('one step back from the extreme still shows a band',
            bandHeight(1, 0.25) > 0 && bandHeight(1, 0.25) < 8, true);
        // Everything away from the extreme keeps a full passband.
        eq('mid settings keep the full passband', bandHeight(0.5, 0.5), 8);
        eq('only the extreme is dead (raw mapping leaves 6 of 25)', dead, 1);
    }
    eq('lone highcut is not a pair', detectCutPair(pad([F('lpf', 'LPF')])).length, 0);
}

_log('\nTest: wav_position pairs with the file the MODULE names');
{
    const P = (key, type, extra = {}) => ({ key, label: key, type, min: 0, max: 1, ...extra });
    const pad = (a) => { const r = a.slice(); while (r.length < 8) r.push(null); return r; };

    /* A page with a preset path AND a sample path: guessing "first file param"
     * would index the preset. The module declares the link, so use it. */
    {
        const g = detectWavViz(pad([
            P('ui_preset_path', 'file'),
            P('sample_path', 'file'),
            P('start', 'float', { uiType: 'wav_position', filepathParam: 'sample_path' }),
        ]));
        eq('marker pairs with the declared file', g[0].file, 1);
    }
    // No declaration → fall back to the first file param on the page.
    {
        const g = detectWavViz(pad([P('sample_path', 'file'), P('start', 'float', { uiType: 'wav_position' })]));
        eq('undeclared marker falls back to the page file', g[0].file, 0);
    }
    // A named file that is not on this page leaves the marker unpaired.
    {
        const g = detectWavViz(pad([P('start', 'float', { uiType: 'wav_position', filepathParam: 'elsewhere' })]));
        eq('marker alone when its file is off-page', g[0].file, null);
    }
}

_log('\nTest: a wav_position knob keeps its fractional value');
{
    /* Reported from the device: editing mrdrums' Start snapped back to 0% on
     * every release. wav_position was carried as its own TYPE, so the encode
     * in applyKnobDelta fell through to String(Math.round(v)) — every value
     * below 0.5 was written as "0". The knob looked right until the value was
     * read back. Assert the string that actually reaches the DSP. */
    const writes = [];
    const origSet = globalThis.shadow_set_param;
    globalThis.shadow_set_param = (slot, key, val) => {
        if (key.indexOf('start') >= 0) writes.push(val);
        return origSet(slot, key, val);
    };
    const md = bootModel(MOCK_SYNTHS.mrdrums, 0, 'synth');
    const startKnob = [0, 1, 2, 3, 4, 5, 6, 7]
        .find((k) => md.getKnobParamInfo(k)?.key === 'pad_start');
    eq('mrdrums Start is on page 0', startKnob !== undefined, true);
    eq('Start is a float, not its own type', md.getKnobParamInfo(startKnob).type, 'float');

    // Let the round-robin read the current value first; a delta applied before
    // the param has been read has no base to move from.
    for (let i = 0; i < 40; i++) md.tick();
    md.handleKnobDelta(startKnob, 6);
    md.tick();
    globalThis.shadow_set_param = origSet;

    eq('the edit was written', writes.length > 0, true);
    const last = writes.length ? writes[writes.length - 1] : '';
    eq('a fractional start is not rounded to zero', Number(last) > 0, true);
    eq('it is written with real precision', String(last).indexOf('.') > 0, true);
}

}
