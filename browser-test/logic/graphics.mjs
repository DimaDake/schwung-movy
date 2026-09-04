/* browser-test/logic/graphics.mjs — on-screen graphics: visible_if, faders, switches, spray fences, spacing
 *
 * Run by browser-test/logic.mjs. The suite body is deliberately left at its
 * original indentation inside run() so blame survives the split.
 */

import {
    readFileSync, readdirSync, planPageLayout, MOCK_SYNTHS, detectWavViz, drawWavForm,
    drawFilterCurve, isFaderParam, isToggleParam, isActionParam, triggerIndices, renderKnobsView,
    renderChainView, eq, bootModel, P, _log,
} from './harness.mjs';

export async function run() {
_log('\nTest: visible_if hides params, and their LEDs go dark');
{
    const boot = (loopMode) => bootModel({ ...MOCK_SYNTHS.wav_loop, 'synth:loop_mode': loopMode }, 0, 'synth');

    const on = boot('on');
    const keysOn = on.dumpLayout().params.filter(Boolean).map(p => p.key);
    eq('loop bounds shown when loop is on', keysOn.includes('loop_start') && keysOn.includes('loop_end'), true);
    eq('loop xfade shown when loop is on', keysOn.includes('loop_xfade_ms'), true);

    const off = boot('off');
    const keysOff = off.dumpLayout().params.filter(Boolean).map(p => p.key);
    eq('loop start hidden when loop is off', keysOff.includes('loop_start'), false);
    eq('loop end hidden when loop is off', keysOff.includes('loop_end'), false);
    eq('loop xfade hidden when loop is off', keysOff.includes('loop_xfade_ms'), false);
    // The controlling param and the unconditional ones stay.
    eq('the loop switch itself stays', keysOff.includes('loop_mode'), true);
    eq('unconditional params stay', keysOff.includes('sample_start'), true);

    /* A hidden param leaves no cell, and knob-leds.ts darkens a null cell —
     * so the knob under a hidden param goes out instead of glowing for a
     * control that is not there. */
    const rows = off.getViewModel().rows;
    const filled = rows.flat().filter(Boolean).length;
    eq('hidden params take no cell', filled, keysOff.length);
    const anyNull = rows.flat().some(c => c === null);
    eq('the page has dark (null) cells to spare', anyNull, true);

    /* Visibility is re-evaluated from the CACHED value the round-robin refresh
     * already maintains, so watching a controller costs NO host call — movy's
     * tick period is its MIDI sampling interval, and a poll here was paid for
     * in input latency. A toggle must still take effect promptly. */
    {
        const m = bootModel({ ...MOCK_SYNTHS.wav_loop, 'synth:loop_mode': 'off' }, 0, 'synth');
        eq('starts hidden', m.dumpLayout().params.filter(Boolean).map(p => p.key).includes('loop_start'), false);
        let gets = 0;
        const orig = globalThis.shadow_get_param;
        globalThis.shadow_get_param = (slot, key) => {
            if (key === 'synth:loop_mode') gets++;
            return orig(slot, key);
        };
        for (let i = 0; i < 64; i++) m.tick();
        globalThis.shadow_get_param = orig;
        const perTick = gets / 64;
        /* Only the round-robin refresh should touch it — nothing polls it. */
        eq('controller is never polled for visibility (round-robin only)', perTick < 0.2, true);

        // A toggle still lands within the throttle window.
        globalThis.shadow_set_param(0, 'synth:loop_mode', 'on');
        for (let i = 0; i < 40; i++) m.tick();
        eq('toggling shows the hidden params', 
            m.dumpLayout().params.filter(Boolean).map(p => p.key).includes('loop_start'), true);
    }

    // Index-style enum values work too: a module may report "1" instead of "on".
    const idx = bootModel({ ...MOCK_SYNTHS.wav_loop, 'synth:loop_mode': '1' }, 0, 'synth');
    eq('numeric enum value satisfies equals:"on"',
        idx.dumpLayout().params.filter(Boolean).map(p => p.key).includes('loop_start'), true);
}

_log('\nTest: loop bounds join the waveform as brackets');
{
    const m = bootModel({ ...MOCK_SYNTHS.wav_loop, 'synth:loop_mode': 'on' }, 0, 'synth');
    // Values arrive on the round-robin refresh, not at boot.
    for (let i = 0; i < 60; i++) m.tick();
    const vm = m.getViewModel();
    const wv = vm.wavViz?.[0];
    eq('one waveform graphic', !!wv, true);
    eq('it spans the sample and all three markers', wv.cellCount, 4);
    eq('playback marker at Start', Math.abs(wv.position - 0.18) < 0.02, true);
    eq('loop start marker present', Math.abs(wv.loopStart - 0.40) < 0.02, true);
    eq('loop end marker present', Math.abs(wv.loopEnd - 0.80) < 0.02, true);

    /* Brackets face INWARD — that is what tells a start from an end without a
     * label, so it is worth pinning rather than trusting the constant. */
    const origFill = globalThis.fill_rect;
    const r = [];
    globalThis.fill_rect = (x, y, w, h, v) => r.push({ x, y, w, h, v });
    drawWavForm(11, { ...wv, points: new Array(4 * 32).fill(0), gain: 1 });
    globalThis.fill_rect = origFill;
    const W2 = 4 * 32;                           // full line: no edge inset
    const sCol = Math.floor(0.40 * W2), eCol = Math.floor(0.80 * W2);
    const tipsAt = (col, dx) => r.some(q => q.x === col + dx && q.h === 2 && q.v === 1);
    eq('loop-start tips point right', tipsAt(sCol, 1), true);
    eq('loop-end tips point left', tipsAt(eCol, -1), true);
}

_log('\nTest: the browse hint is drawn on every view that shows the overlay');
{
    /* The file-browse gesture is model-level, so it works on the chain page as
     * well as the knobs page, and BOTH draw the file overlay. Only the knobs
     * page drew the hint, so the same touch showed the list with no way to
     * discover the full browser — which reads as the toast appearing at random. */
    const origFill = globalThis.fill_rect;
    const bottomLit = (draw) => {
        let n = 0;
        globalThis.fill_rect = (x, y, w, h, v) => { if (v === 1 && y >= 58) n += w * h; };
        draw();
        globalThis.fill_rect = origFill;
        return n;
    };
    const vm = {
        moduleName: 'M', bankName: '', bankIndex: 0, bankCount: 1,
        rows: [[null, null, null, null], [null, null, null, null]],
        touchedSlot: 0, overlay: null, isEmpty: false,
        drumPadCount: 0, drumCurrentPad: 0, drumCurrentPhysPad: 0, isPadScoped: false,
        automationHeld: false, automationPoolFull: false,
        stepPagePresent: false, stepPageSelected: false,
        toast: { fullName: 'Sample', value: '—', browseHint: true },
    };
    eq('knobs view draws the browse hint', bottomLit(() => renderKnobsView(vm, false, 0)) > 0, true);
    eq('chain view draws it too', bottomLit(() => renderChainView(vm, 1, false, 'T1')) > 0, true);
}

_log('\nTest: loudness knobs become faders');
{
    const P = (key, label, min = 0, max = 1, type = 'float') => ({ key, label, type, min, max });
    const yes = (k, l, mn, mx) => eq(`${l} is a fader`, isFaderParam(P(k, l, mn, mx)), true);
    const no  = (k, l, mn, mx) => eq(`${l} is NOT a fader`, isFaderParam(P(k, l, mn, mx)), false);

    yes('volume', 'Volume'); yes('gain', 'Gain'); yes('lvl_snare', 'Snare');
    yes('op1_level', 'Op1 Lvl', 0, 99); yes('send_fx_1', 'Send FX 1 Level');
    yes('master_vol', 'Master Vol');

    /* The exclusions carry the rule. Each of these is a real fleet param that
     * says "level" while being an amount of something else. */
    no('random_vol', 'Rdm Vol');                       // granular: a randomiser
    no('level_var', 'Level Var', 0, 100);              // obxd: variance
    no('nvram_tone_0_levelkeyfollow', 'Level KF', 0, 15);  // minijv: glued role
    no('mat_2_7', 'S&H->Level', -1, 1);                // denis: a mod-matrix row
    no('amp_env_level', 'Env Level');                  // a modulation of a level
    no('vel_vol', 'Vel Vol');                          // velocity sensitivity
    no('pan', 'Pan', -1, 1);                           // placement
    no('gain_thres', 'Threshold', -60, 0);             // dynamics
    // Not continuous, so a fader would be the wrong shape entirely.
    eq('an enum called Volume stays an enum',
        isFaderParam({ key: 'volume', label: 'Volume', type: 'enum', min: 0, max: 1 }), false);

}

_log('\nTest: booleans become on/off switches');
{
    const I = (key, label = key) => ({ key, label, type: 'int', min: 0, max: 1 });
    const E = (key, options, label = key) =>
        ({ key, label, type: 'enum', options, min: 0, max: options.length - 1 });
    const sw  = (p) => isToggleParam(p);
    const act = (p) => isActionParam(p);

    // Both spellings of the same control.
    eq('int 0..1 is a switch',            sw(I('osc2_sync', 'Osc2 Sync')), true);
    eq('Off/On enum is a switch',         sw(E('legato', ['Off', 'On'])), true);
    eq('off/on lower case',               sw(E('sync', ['off', 'on'])), true);
    eq('0/1 with no names',               sw(E('all_mono', ['0', '1'])), true);
    eq('Disabled/Enabled',                sw(E('eco', ['Disabled', 'Enabled'])), true);

    /* Order matters: a reversed pair drawn as a switch would show the knob left
     * while the module reports "on". None exist in the fleet; the rule keeps it
     * that way rather than trusting that. */
    eq('reversed On/Off is NOT a switch', sw(E('byp', ['On', 'Off'])), false);

    // Two options, but neither of them is "absent".
    eq('Free/Sync stays an enum',         sw(E('mode', ['Free', 'Sync'])), false);
    eq('Poly/Mono stays an enum',         sw(E('voice', ['Poly', 'Mono'])), false);
    eq('Saw/Square stays an enum',        sw(E('shape', ['Saw', 'Square'])), false);
    eq('three options is not a switch',   sw(E('m', ['Off', 'On', 'Auto'])), false);
    eq('a wider int is not a switch',     sw({ ...I('oct'), max: 4 }), false);

    /* Actions go to the trigger badge: a switch would sit stuck on after one
     * use. The verb must lead the key — these four are the modes that a looser
     * rule turned into buttons. */
    eq('rnd_patch is an action',          act(I('rnd_patch', 'Rnd Patch')), true);
    eq('save_preset is an action',        act(I('save_preset', 'Save Preset')), true);
    eq('init_freq is an action',          act(E('init_freq', ['0', '1'])), true);
    eq('cv_init is an action',            act(E('cv_init', ['0', '1'])), true);
    eq('bare "trigger" is an action',     act(I('trigger', 'Trigger')), true);
    eq('lfo_trigger is a MODE',           act(I('lfo_trigger', 'LFO Trigger')), false);
    eq('trigger_mode is a MODE',          act(E('trigger_mode', ['Off', 'On'])), false);
    eq('vca_hard_reset is a MODE',        act(E('vca_hard_reset', ['Off', 'On'])), false);
    eq('random_retrig is a MODE',         act(E('random_retrig', ['off', 'on'])), false);
    eq('an action is not also a switch',  sw(I('rnd_patch', 'Rnd Patch')), false);
    eq('a mode still switches',           sw(I('lfo_trigger', 'LFO Trigger')), true);

    /* An int trigger has no options to name its states. triggerIndices used to
     * reject it, which drew the badge and then did nothing on every turn. */
    eq('int 0..1 trigger resolves indexes',
        JSON.stringify(triggerIndices({ ...I('trigger'), behavior: 'trigger' })),
        JSON.stringify({ idle: 0, trigger: 1 }));
    eq('a non-trigger resolves nothing',
        triggerIndices(I('trigger')), null);
}

_log('\nTest: granular spray fences');
{
    const P = (key, extra = {}) => ({
        key, label: key, type: 'float', min: 0, max: 1, step: 0.01,
        options: null, renderStyle: 'arc', automatable: true, ...extra,
    });
    const page = (over = {}) => [
        { ...P('sample_path'), type: 'file' },
        P('position', { uiType: 'wav_position', filepathParam: 'sample_path' }),
        P('size_ms', { min: 5, max: 500 }),
        P('density', { min: 1, max: 60 }),
        over.spray === null ? P('nothing') : P('spray'),
        P('jitter'), P('scan', { min: -10, max: 10 }), P('grain_gain'),
    ];

    /* Detection. The key must match EXACTLY: granny ships its own `spread`
     * (stereo width between voices) on another page, and the fleet has eight
     * more spread/scatter/diffuse params, not one of which is a read-position
     * spread. Matching them would draw a region the DSP never reads from. */
    const g = detectWavViz(page())[0];
    eq('spray joins the sample group', g.spray, 4);
    eq('no spray param → null', detectWavViz(page({ spray: null }))[0].spray, null);
    const withSpread = page();
    withSpread[4] = P('spread');
    eq('"spread" is NOT a read-position spray', detectWavViz(withSpread)[0].spray, null);
    const wrongRange = page();
    wrongRange[4] = P('spray', { min: 0, max: 100 });
    eq('spray must be the 0..1 the DSP scales by', detectWavViz(wrongRange)[0].spray, null);

    /* Absorbing it frees its knob cell, so the graphic pays for its own width:
     * 8 params, 3 absorbed → 3 cells instead of 2. */
    const lay = planPageLayout(page());
    eq('the graphic widens to 3 cells', lay.wavs[0].cellCount, 3);
    eq('and claims the spray cell', lay.wavs[0].idxs.includes(4), true);

    /* Fence geometry, against granny's engine rather than guesswork:
     *   max_offset = spray * (sample_len - 1)   -> the whole file
     *   start_idx  wraps into [0, len)          -> fences wrap
     *   symmetric  -> ±0.5 already reaches every frame, so it saturates */
    const { drawWavForm } = await import('../../dist/esm/renderer/wav-form.js');
    const fences = (position, spray) => {
        const cols = new Map();
        const orig = globalThis.fill_rect;
        globalThis.fill_rect = (x, y, w, h, v) => {
            if (w === 1 && h === 1) cols.set(x, (cols.get(x) ?? 0) + 1);
        };
        drawWavForm(0, {
            line: 0, startCol: 0, cellCount: 4,
            points: new Array(128).fill(0.5), gain: 1, position, spray,
        });
        globalThis.fill_rect = orig;
        /* A fence is drawn one pixel at a time down a whole column; the
         * waveform body is drawn as tall single fill_rects, so it never shows
         * up here. The marker is 1x1 only where the sample is silent. */
        return [...cols.entries()].filter(([, n]) => n > 3).map(([x]) => x).sort((a, b) => a - b);
    };

    const mid = fences(0.5, 0.2);
    eq('two fences, one either side', mid.length, 2);
    eq('left fence sits at position - spray', mid[0], 38);
    eq('right fence sits at position + spray', mid[1], 89);

    /* Past an edge the region continues from the OTHER end of the file, because
     * granny wraps start_idx rather than clamping it. Clamping would put the
     * fence at column 0 and claim grains come from the first frame — they come
     * from the last. Both directions, since the offset is symmetric. */
    eq('a fence past the start wraps to the end',
        JSON.stringify(fences(0.1, 0.2)), JSON.stringify([38, 115]));
    eq('a fence past the end wraps to the start',
        JSON.stringify(fences(0.9, 0.2)), JSON.stringify([12, 89]));

    /* ±0.5 already covers every frame, so the region cannot grow past it. */
    eq('spray saturates at 0.5', JSON.stringify(fences(0.5, 0.5)),
        JSON.stringify(fences(0.5, 0.9)));
    eq('and saturated means the file edges', JSON.stringify(fences(0.5, 0.9)),
        JSON.stringify([0, 127]));

    eq('spray 0 draws no fence', fences(0.5, 0).length, 0);
}

_log('\nTest: no page keeps the retired on/off bar');
{
    /* The module paths run every boolean through model/toggle.ts, but movy's OWN
     * pages — the track LFO, the sequencer's main page — build their ParamVMs by
     * hand and name renderStyle directly, skipping the rule entirely. That is how
     * the LFO page kept the old bar after all 209 of the fleet's booleans had been
     * converted: nothing in the module pipeline could see it. A source sweep is
     * the only check that covers hand-written cells. */
    const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = dir + '/' + e.name;
        return e.isDirectory() ? walk(full) : (full.endsWith('.ts') ? [full] : []);
    });
    const srcDir = new URL('../../src', import.meta.url).pathname;
    const offenders = walk(srcDir).filter((f) =>
        /renderStyle:\s*'hbar'/.test(readFileSync(f, 'utf8')));
    eq('no source file emits hbar (' + offenders.join(', ') + ')', offenders.length, 0);

    /* Aliased, not deleted: a third-party movy_config.json may still ask for
     * hbar by name, and what it always meant was "this param is a boolean". */
    const { drawKnobWidget } = await import('../../dist/esm/renderer/knob.js');
    const paint = (style, on) => {
        const lit = [];
        const orig = globalThis.fill_rect;
        globalThis.fill_rect = (x, y, w, h, v) => lit.push([x, y, w, h, v].join(','));
        drawKnobWidget(0, 0, {
            shortName: 'B', fullName: 'Bool', type: 'int', renderStyle: style,
            value: '', enumIndex: 0, normalizedValue: on ? 1 : 0,
        });
        globalThis.fill_rect = orig;
        return lit.join('|');
    };
    eq('legacy hbar draws the switch (off)', paint('hbar', false), paint('switch', false));
    eq('legacy hbar draws the switch (on)',  paint('hbar', true),  paint('switch', true));
    eq('and it is not a blank cell', paint('hbar', true).length > 0, true);
}

_log('\nTest: the switch graphic');
{
    const { drawKnobWidget } = await import('../../dist/esm/renderer/knob.js');
    /* One row of the switch as a bitmap string, across the 26px capsule (cell 0
     * spans x=3..28). Single pixels are useless here: when ON the knob is a HOLE
     * punched in a filled capsule, so a coordinate can be dark in both states
     * for opposite reasons. */
    const row = (vm, ry) => {
        const lit = new Set();
        const orig = globalThis.fill_rect;
        globalThis.fill_rect = (x, y, w, h, v) => {
            for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
                const k = (x + i) + ',' + (y + j);
                if (v === 1) lit.add(k); else lit.delete(k);
            }
        };
        drawKnobWidget(0, 0, {
            shortName: 'S', fullName: 'Sync', type: 'int', renderStyle: 'switch',
            value: '', enumIndex: 0, normalizedValue: 0, ...vm,
        });
        globalThis.fill_rect = orig;
        let out = '';
        for (let x = 3; x < 29; x++) out += lit.has(x + ',' + ry) ? '#' : '.';
        return out;
    };
    const OFF = { normalizedValue: 0 }, ON = { normalizedValue: 1 };

    /* Centre row. OFF is an outline with the knob parked left; ON fills the
     * capsule and knocks the knob out on the right. */
    eq('OFF: hollow capsule, knob left',
        row(OFF, 7), '##########...............#');
    eq('ON: filled capsule, knob right',
        row(ON, 7),  '################.........#');

    /* The states must differ on every INTERIOR row (3..11 — the outermost two
     * are pure cap arc and identical by design). At 20px wide the knob ate half
     * the fill and rows 6-8 came out pixel-identical in both states, silently
     * destroying the filled-vs-outline signal that the whole design rests on. */
    let same = 0;
    for (let ry = 3; ry <= 11; ry++) if (row(OFF, ry) === row(ON, ry)) same++;
    eq('every interior row differs between states', same, 0);

    /* Cap and knob come from one circle at two radii, so the knob nests with a
     * uniform 1px gap. Row 3 is where a stepped chamfer used to disagree with a
     * round knob: the cap is inset 2 and the knob 1 further, every row. */
    eq('OFF row 3 nests the knob in the cap',
        row(OFF, 3),  '..#####...............##..');
    eq('OFF top edge is the cap arc',
        row(OFF, 2),  '....##################....');
    eq('bottom edge mirrors the top',
        row(OFF, 12), row(OFF, 2));
    eq('ON keeps the same outer silhouette',
        row(ON, 2),   row(OFF, 2));

    /* An enum switch reads its state from the option INDEX, not the value: its
     * normalizedValue is whatever the range happens to make of index 1. */
    eq('enum index 1 draws ON',
        row({ type: 'enum', enumIndex: 1, normalizedValue: 0 }, 7), row(ON, 7));
    eq('enum index 0 draws OFF',
        row({ type: 'enum', enumIndex: 0, normalizedValue: 1 }, 7), row(OFF, 7));
}

_log('\nTest: the fader graphic');
{
    const { drawKnobWidget } = await import('../../dist/esm/renderer/knob.js');
    /* Column of lit pixels at the fader's centre line, top row first. The rails
     * sit 4px to either side, so sampling the centre sees only fill and head. */
    const CX = 16;                                       // cell 0: kx=8, centre kx+8
    const column = (normalizedValue) => {
        const lit = [];
        const orig = globalThis.fill_rect;
        globalThis.fill_rect = (x, y, w, h, v) => {
            if (v !== 1 || x > CX || x + w <= CX) return;
            for (let i = 0; i < h; i++) lit.push(y + i);
        };
        drawKnobWidget(0, 0, {
            shortName: 'VOL', fullName: 'Volume', type: 'float',
            renderStyle: 'vbar', normalizedValue, value: '', enumIndex: 0,
        });
        globalThis.fill_rect = orig;
        return lit.sort((a, b) => a - b);
    };
    /* The fill runs from the head down to the bottom of the travel — never from
     * a mid-point. Bipolar gains fill from the bottom too (no faderZero). */
    const c25 = column(0.25);
    eq('fader fills to the bottom of the travel', c25[c25.length - 1], 14);
    eq('at 25% the head sits a quarter up', c25[0], 11);
    eq('at 100% the head is at the top', column(1)[0], 1);
    /* At 0 there is no fill at all, only the 1px head on the bottom row. */
    eq('at 0 only the head is drawn', column(0).join(','), '14');
}

_log('\nTest: adjacent graphics keep a gap on both sides');
{
    /* Every span graphic insets ONE pixel per side, so two sitting side by side
     * on a line are separated by two. They used to be flush right — inset on
     * the left only — which left a single pixel between a filter curve and the
     * sample waveform beside it, and the two drawings read as one shape. */
    const origFill = globalThis.fill_rect;
    const span = (draw) => {
        const r = [];
        globalThis.fill_rect = (x, y, w, h, v) => { if (v === 1) r.push(x); };
        draw();
        globalThis.fill_rect = origFill;
        return { min: Math.min(...r), max: Math.max(...r) };
    };

    // A 2-cell filter in cells 0-1, then a 2-cell waveform in cells 2-3.
    /* High-pass with a low corner: its passband runs to the right edge, so the
     * measured extent is the graphic's SPAN. A low-pass would sit on the floor
     * there and be skipped, measuring the curve instead. */
    const f = span(() => drawFilterCurve(35, {
        line: 1, startCol: 0, cutoff: 0.1, resonance: 0.2, mode: 'hp',
    }));
    const w = span(() => drawWavForm(35, {
        line: 1, startCol: 2, cellCount: 2, points: new Array(62).fill(0.8),
        gain: 1, position: 0.5,
    }));
    /* The SCREEN edges get no inset — there is nothing there to separate from,
     * and the pixels are better spent on the drawing. */
    eq('filter reaches the left screen edge', f.min, 0);
    eq('waveform reaches the right screen edge', w.max, 127);
    // The internal boundary does: one pixel from each side.
    eq('filter stops short of the shared boundary', f.max, 62);
    eq('waveform starts past the shared boundary', w.min, 65);
    eq('two clear pixels between them', w.min - f.max - 1, 2);
}

_log('\nTest: a stretched waveform reserves the columns it covers');
{
    const P = (key, type, extra = {}) => ({ key, label: key, type, min: 0, max: 1, renderStyle: 'arc', ...extra });
    const pad = (a) => { const r = a.slice(); while (r.length < 8) r.push(null); return r; };

    /* mrsample page 2: six params, so the graphic stretches to four cells. It
     * must RESERVE those columns — filling them with leftover knobs puts live
     * controls under the picture, editable and invisible. */
    const params = pad([
        P('sample_start', 'float', { filepathParam: 'sample_path' }),
        P('loop_mode', 'enum', { options: ['Off', 'On'] }),
        P('loop_start', 'float'), P('loop_end', 'float'),
        P('loop_xfade_ms', 'float'), P('sample_path', 'file'),
    ]);
    const L = planPageLayout(params);
    eq('graphic stretched into the free space', L.wavs[0].cellCount, 4);

    // Nothing is drawn under the graphic's columns.
    const covered = L.cells.filter((c) => c.line === L.wavs[0].line
        && c.col >= L.wavs[0].startCol && c.col < L.wavs[0].startCol + L.wavs[0].cellCount);
    eq('only the graphic\'s own params sit under it',
        covered.every((c) => L.wavs[0].idxs.includes(c.idx)), true);

    // And nothing is lost: every param still has a cell.
    eq('no param is dropped off the page', L.cells.length, params.filter(Boolean).length);
}

}
