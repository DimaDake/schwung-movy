/* browser-test/logic/module-configs.mjs — per-module configs: chunk-6 (chordism/sfz/303/chiptune/hush1) and chunk-7
 *
 * Run by browser-test/logic.mjs. The suite body is deliberately left at its
 * original indentation inside run() so blame survives the split.
 */

import {
    readFileSync, readdirSync, detectEnvelopes, MOCK_SYNTHS, init, eq, bootModel,
    _log, env, fail, KNOBS_PER_PAGE,
} from './harness.mjs';

export async function run() {
/* ── Sample Slicer: movy-side config for a module that publishes neither a
 *    ui_hierarchy nor its sample param ────────────────────────────────────
 * The metadata below is the device capture the dump replay uses, so these
 * assertions run against what the module really publishes. */

_log('\nTest: slicer config — sample browser, one-shot actions, slice pads');

{
    const cap = JSON.parse(readFileSync(
        new URL('../fixtures/dump-extra/sound_generator--slicer.json', import.meta.url), 'utf8'));
    const preset = { 'synth:name': 'Slicer', 'synth_module': 'slicer' };
    for (const [k, v] of Object.entries(cap.params)) preset['synth:' + k] = v;
    /* get_param('slices') answers on the device; the capture only carries the
     * values the host pushed, so state it here. */
    preset['synth:slices'] = '16';

    const m = bootModel(preset);
    const d = m.dumpLayout();
    const byKey = (k) => d.params.find(p => p && p.key === k);

    // The module maps Move pads 68-99 to slices 0-31 (note_to_slice), so the
    // grid is the full 32 pads and the pad note IS the slice.
    eq('slicer: 32 pads',            d.drum?.padCount, 32);
    eq('slicer: pads start at 68',   d.drum?.padNoteStart, 68);
    eq('slicer: pad note is raw',    d.drum?.rawMidi, true);
    // Selecting a slice is note-driven in the DSP (voice_start sets
    // selected_slice), so a silent shift-select would edit the wrong slice.
    eq('slicer: shift-select still sounds', d.drum?.shiftSelectMidi, true);

    // The sample param exists in no metadata the module publishes.
    eq('slicer: sample_path is absent from chain_params',
       cap.chain_params.some(p => p.key === 'sample_path'), false);
    eq('slicer: and movy still offers it as a file param', byKey('sample_path')?.type, 'file');
    m.handleKnobTouch(0);
    const t = m.getFileBrowseTarget();
    eq('slicer: browse root',   t?.root, '/data/UserData/UserLibrary');
    eq('slicer: browse start',  t?.startPath, '/data/UserData/UserLibrary/Samples');
    eq('slicer: browse filter', JSON.stringify(t?.filter),
       JSON.stringify(['.wav', '.aif', '.aiff', '.mp3', '.flac']));
    m.handleKnobRelease(0);

    // Actions the module implements but never declares.
    for (const k of ['scan', 'reroll', 'detect_bpm']) {
        eq(`slicer: ${k} is a one-shot`, byKey(k)?.behavior, 'trigger');
        eq(`slicer: ${k} is not automatable`, byKey(k)?.automatable, false);
    }

    // Per-slice params address whichever slice is selected, so an automation
    // lane on one would land on whatever the sequencer last triggered.
    eq('slicer: slice params are not automatable', byKey('slice_attack')?.automatable, false);

    // `slices` accepts 8/16/32/64 by VALUE (atoi), and it is the one enum the
    // module publishes no metadata for — writing the option INDEX would set a
    // slice count the DSP ignores, and the knob would snap back.
    m.handleKnobTouch(3);      // SLICE is knob 4 on the Main page
    m.handleKnobDelta(3, 4);
    m.tick();                  // deltas are buffered and applied on the tick
    m.handleKnobRelease(3);
    const written = env.params['synth:slices'];
    if (written === '32') _log('  \x1b[32m✓\x1b[0m slicer: slices writes the count, not the index');
    else fail('slicer: slices writes the count, not the index', `got ${JSON.stringify(written)}`);
}

/* ── Chunk-6 custom configs: chordism, sfz, 303, chiptune, hush1 ──────────── */

_log('\nTest: chunk-6 module configs (chordism/sfz/303/chiptune/hush1)');
{
    const { detectEnvelopes } = await import('../../dist/esm/model/envelope.js');

    const layout = (id) => bootModel(MOCK_SYNTHS[id]).dumpLayout();
    const byKey  = (d, k) => d.params.find(p => p && p.key === k);
    const idxOf  = (d, k) => d.params.findIndex(p => p && p.key === k);

    // Every page's on-screen short names must be unique (the dump flagged
    // duplicate "1/2/3/4" and "TO" collisions on the auto layout).
    const noDupShorts = (id) => {
        const m = bootModel(MOCK_SYNTHS[id]);
        const n = m.getBankCount();
        for (let b = 0; b < n; b++) {
            m.changePage(b - m.getKnobPage());
            const names = m.getViewModel().rows.flat().filter(Boolean).map(c => c.shortName);
            if (new Set(names).size !== names.length) return `bank ${b}: ${names.join(',')}`;
        }
        return null;
    };

    // Bank counts
    eq('chordism: 17 banks', layout('chordism').banks.length, 17);
    eq('sfz: 3 banks',       layout('sfz').banks.length,      3);
    eq('303: 3 banks',       layout('303').banks.length,      3);
    eq('chiptune: 3 banks',  layout('chiptune').banks.length, 3);
    eq('hush1: 7 banks',     layout('hush1').banks.length,    7);

    // chordism B3 fix: all four top pitch classes reachable, as 16-way enums.
    {
        const d = layout('chordism');
        for (const k of ['chord_pc_8', 'chord_pc_9', 'chord_pc_10', 'chord_pc_11']) {
            const p = byKey(d, k);
            eq(`chordism: ${k} reachable`, !!p, true);
            eq(`chordism: ${k} is enum`, p?.type, 'enum');
            eq(`chordism: ${k} has 16 options`, p?.options?.length, 16);
        }
        // Restored hidden params (a representative sample of the plan's list).
        for (const k of ['detune', 'chord_spread', 'chord_rotation', 'fm_modulator',
                         'fm_amount', 'filter_lfo_rate', 'vib_delay', 'delay_tone',
                         'glide_legato', 'lfo_phase_1', 'sweep_rate']) {
            eq(`chordism: restored ${k}`, !!byKey(d, k), true);
        }
        // Named preset knob (option-a shared path), not a bare index.
        const pre = d.params.find(p => p && p.renderStyle === 'preset');
        eq('chordism: preset renders as preset', !!pre, true);
        eq('chordism: preset has names', Array.isArray(pre?.options), true);
        eq('chordism: preset spans 57 entries (max 56)', pre?.max, 56);
    }

    // sfz B4: named params + ADSR envelope + adjacent cutoff/reso.
    {
        const d = layout('sfz');
        const envs = detectEnvelopes(d.params.slice(0, 8));
        eq('sfz: amp envelope detected', envs.length >= 1, true);
        eq('sfz: envelope named Amp', envs[0]?.name, 'Amp');
        eq('sfz: cutoff+reso adjacent', idxOf(d, 'reso') - idxOf(d, 'cutoff'), 1);
        eq('sfz: voices is int', byKey(d, 'voices')?.type, 'int');
        eq('sfz: gain max=2', byKey(d, 'gain')?.max, 2);
        // count=0 in the dump → preset degrades to an indexed knob (no names).
        const pre = d.params.find(p => p && p.renderStyle === 'preset');
        eq('sfz: preset present', !!pre, true);
        eq('sfz: preset has no names (indexed)', pre?.options, null);
        eq('sfz: knob_preset (degenerate 0..0) omitted', !!byKey(d, 'knob_preset'), false);
    }

    // 303 B5: waveform enum surfaced; no forced ADSR (303 has no A/D/S/R quartet).
    {
        const d = layout('303');
        eq('303: waveform is enum', byKey(d, 'waveform')?.type, 'enum');
        eq('303: waveform options Saw/Square',
            JSON.stringify(byKey(d, 'waveform')?.options), JSON.stringify(['Saw', 'Square']));
        eq('303: drive_model reachable', !!byKey(d, 'drive_model'), true);
        eq('303: devil_mod_switch reachable', !!byKey(d, 'devil_mod_switch'), true);
        eq('303: cutoff+reso adjacent', idxOf(d, 'resonance') - idxOf(d, 'cutoff'), 1);
        let envCount = 0;
        for (let b = 0; b < d.banks.length; b++) envCount += detectEnvelopes(d.params.slice(b * 8, b * 8 + 8)).length;
        eq('303: no envelope graphic forced', envCount, 0);
    }

    // chiptune B5: all hidden surfaced, int ADSR detected, named preset.
    {
        const d = layout('chiptune');
        for (const k of ['chip', 'alloc_mode', 'noise_mode', 'sweep', 'wavetable',
                         'channel_mask', 'detune', 'octave_transpose',
                         'pitch_env_depth', 'pitch_env_speed']) {
            eq(`chiptune: ${k} reachable`, !!byKey(d, k), true);
        }
        eq('chiptune: env detected', detectEnvelopes(d.params.slice(0, 8)).length, 1);
        const pre = d.params.find(p => p && p.renderStyle === 'preset');
        eq('chiptune: named preset (32)', pre?.max, 31);
        eq('chiptune: preset has names', Array.isArray(pre?.options), true);
    }

    // hush1 B5: dual Amp+Filter envelopes, lfo_waveform adjacent to lfo_rate.
    {
        const d = layout('hush1');
        const filtEnv = detectEnvelopes(d.params.slice(16, 24));  // bank 2 = Filter
        const ampEnv  = detectEnvelopes(d.params.slice(24, 32));  // bank 3 = Amp Env
        eq('hush1: filter envelope named Filter', filtEnv[0]?.name, 'Filter');
        eq('hush1: amp envelope named Amp', ampEnv[0]?.name, 'Amp');
        eq('hush1: lfo_waveform adjacent to lfo_rate', idxOf(d, 'lfo_waveform') - idxOf(d, 'lfo_rate'), 1);
        eq('hush1: lfo_waveform is enum', byKey(d, 'lfo_waveform')?.type, 'enum');
        for (const k of ['pulse_width', 'pwm_mode', 'sub_mode', 'white_noise',
                         'bend_range', 'lfo_sync', 'retrigger', 'hold']) {
            eq(`hush1: ${k} reachable`, !!byKey(d, k), true);
        }
        const pre = d.params.find(p => p && p.renderStyle === 'preset');
        eq('hush1: named preset (11)', pre?.max, 10);
    }

    // mrdrums B5: pad-scoped choke group added.
    {
        const d = bootModel({ 'synth:name': 'MrDrums', 'synth_module': 'mrdrums' }).dumpLayout();
        eq('mrdrums: pad_choke_group added', !!byKey(d, 'pad_choke_group'), true);
        eq('mrdrums: choke group is int 0..16', byKey(d, 'pad_choke_group')?.max, 16);
    }

    // No duplicate on-screen short names on any page of any chunk-6 module.
    for (const id of ['chordism', 'sfz', '303', 'chiptune', 'hush1']) {
        eq(`${id}: no duplicate shortNames per page`, noDupShorts(id), null);
    }
}

_log('\nTest: chunk-7 module configs (krautdrums/weird-dreams banks)');
{
    const boot = (id, extra = {}) => bootModel({ 'synth:name': id, 'synth_module': id, ...extra });
    const layout = (id, extra = {}) => boot(id, extra).dumpLayout();
    const byKey  = (d, k) => d.params.find(p => p && p.key === k);
    const noDupShorts = (m) => {
        const n = m.getBankCount();
        for (let b = 0; b < n; b++) {
            m.changePage(b - m.getKnobPage());
            const names = m.getViewModel().rows.flat().filter(Boolean).map(c => c.shortName);
            if (new Set(names).size !== names.length) return `bank ${b}: ${names.join(',')}`;
        }
        return null;
    };

    // krautdrums: new Rhythm bank (rhythm_1..8 + 5 restored globals), others intact.
    {
        const d = layout('krautdrums');
        eq('krautdrums: 6 banks (Levels/FX/Attitude/General/Rhythm/Global)', d.banks.length, 6);
        eq('krautdrums: Rhythm bank present', d.banks.some(b => b.name === 'Rhythm'), true);
        eq('krautdrums: Global bank present', d.banks.some(b => b.name === 'Global'), true);
        for (let n = 1; n <= 8; n++) {
            const p = byKey(d, `rhythm_${n}`);
            eq(`krautdrums: rhythm_${n} is 17-way enum`, p?.type === 'enum' && p?.options?.length === 17, true);
        }
        for (const k of ['tempo_mode', 'limiter', 'delay_type', 'reverb_type', 'delay_sync']) {
            eq(`krautdrums: restored ${k}`, !!byKey(d, k), true);
        }
        // Existing banks untouched.
        for (const k of ['lvl_bass', 'filter_cutoff', 'tempo', 'master_vol']) {
            eq(`krautdrums: kept ${k}`, !!byKey(d, k), true);
        }
        eq('krautdrums: no duplicate shortNames per page', noDupShorts(boot('krautdrums')), null);
    }

    // weird-dreams: new EQ + Master banks; padScoping Voice bank still resolves.
    {
        const d = layout('weird-dreams');
        eq('weird-dreams: 5 banks (Voice/Patch/FX/EQ/Master)', d.banks.length, 5);
        eq('weird-dreams: EQ bank present', d.banks.some(b => b.name === 'EQ'), true);
        eq('weird-dreams: Master bank present', d.banks.some(b => b.name === 'Master'), true);
        for (const k of ['eq_lo', 'eq_mid', 'eq_hi', 'dj_filter', 'lo_freq', 'mid_freq',
                         'hi_freq', 'comp', 'q_lo', 'q_mid', 'q_hi', 'master', 'all_mono']) {
            eq(`weird-dreams: restored ${k}`, !!byKey(d, k), true);
        }
        eq('weird-dreams: all_mono is enum', byKey(d, 'all_mono')?.type, 'enum');
        // Action/init params deliberately skipped.
        for (const k of ['reset_eq', 'init_freq', 'save_kit', 'same_freq', 'rnd_pan']) {
            eq(`weird-dreams: skipped action ${k}`, !!byKey(d, k), false);
        }
        // Pad-scoped voice editing intact (Voice bank unchanged).
        const wd = bootModel(MOCK_SYNTHS.weird_dreams);
        eq('weird-dreams: VOL still reads v1_vol', wd.getKnobParamInfo(0).ioKey, 'v1_vol');
        wd.updateDrumPad(3, 70);
        eq('weird-dreams: VOL follows focus to v3_vol', wd.getKnobParamInfo(0).ioKey, 'v3_vol');
        eq('weird-dreams: no duplicate shortNames per page', noDupShorts(bootModel(MOCK_SYNTHS.weird_dreams)), null);
    }

    // signal: new 4-voice pad-scoped config; cv_ alias → v{pad}_ concrete.
    {
        const d = layout('signal', MOCK_SYNTHS.signal);
        eq('signal: 9 banks', d.banks.length, 9);
        eq('signal: 4 drum pads', d.drum?.padCount, 4);
        // Restored hidden per-voice + global params reachable (as cv_ aliases / keys).
        for (const k of ['cv_attack', 'cv_sub_div', 'cv_sweep', 'cv_tone_rnd', 'cv_bank_pitch_0',
                         'drummer_brain', 'fill_shape', 'step_grid', 'out_mode']) {
            eq(`signal: reachable ${k}`, !!byKey(d, k), true);
        }
        const sg = bootModel(MOCK_SYNTHS.signal);
        eq('signal: focus defaults to voice 1', sg.getViewModel().drumCurrentPad, 1);
        for (let t = 0; t < 4; t++) sg.tick();   // round-robin refresh reaches row-0 knobs
        eq('signal: VOL reads v1_vol (0.11)', sg.getKnobParamInfo(1).value, 0.11);
        eq('signal: ioKey is v1_vol', sg.getKnobParamInfo(1).ioKey, 'v1_vol');
        sg.updateDrumPad(3, 38);
        eq('signal: VOL re-read for v3 (0.33)', sg.getKnobParamInfo(1).value, 0.33);
        eq('signal: ioKey follows to v3_vol', sg.getKnobParamInfo(1).ioKey, 'v3_vol');
        eq('signal: no duplicate shortNames per page', noDupShorts(bootModel(MOCK_SYNTHS.signal)), null);
    }

    // forge: 16-pad Kit A/B, per-voice editing is PLAYBACK-SAFE — padScoping
    // remaps cv_* → pv{pad}_ concrete keys (patched DSP addresses a fixed
    // voice/kit, independent of the playing note). Full detail across 5 banks.
    // Forge is unbundled — serve its movy_config.json (earlier tests reset the stub).
    {
        const savedHRF = globalThis.host_read_file;
        const forgeLayout = readFileSync(new URL('../fixtures/forge-movy-config.json', import.meta.url), 'utf8');
        globalThis.host_read_file = (p) => p.endsWith('/forge/movy_config.json') ? forgeLayout : null;
        const d = layout('forge', MOCK_SYNTHS.forge);
        eq('forge: 12 banks', d.banks.length, 12);
        // Send bank: per-voice FX sends + pan, scoped v{pad}_ (host-automatable
        // concrete keys) for Kit A via suffixOverrides.
        eq('forge: send bank fx1', !!byKey(d, 'cv_fx1'), true);
        eq('forge: send bank pan', !!byKey(d, 'cv_pan'), true);
        eq('forge: fx1 override', d.drum?.padScoping?.suffixOverrides?.fx1?.template, 'v{pad}_{suffix}');
        eq('forge: 16 drum pads', d.drum?.padCount, 16);
        eq('forge: padScoping cv_ → pv{pad}_', d.drum?.padScoping?.concreteKeyTemplate, 'pv{pad}_{suffix}');
        // Rich per-voice params exposed as cv_* aliases (Osc/Filter/Env/Mod/Setup).
        for (const k of ['cv_wave', 'cv_ratio_c', 'cv_f1_cut', 'cv_f1_type', 'cv_e1_atk',
                         'cv_e1_crv', 'cv_lfo_w', 'cv_mod_dest', 'cv_algo', 'cv_poly']) {
            eq(`forge: per-voice ${k}`, !!byKey(d, k), true);
        }
        for (const k of ['morph_src', 'morph_curve', 'all_mono']) eq(`forge: restored ${k}`, !!byKey(d, k), true);
        for (const k of ['copy_a_b', 'swap_ab', 'rnd_b_from_a']) eq(`forge: skipped ${k}`, !!byKey(d, k), false);

        const fg = bootModel(MOCK_SYNTHS.forge);
        // Pad 1 (Kit A voice 1): WAVE alias cv_wave resolves to pv1_wave = 1 (Tri).
        eq('forge: WAVE ioKey is pv1_wave', fg.getKnobParamInfo(0).ioKey, 'pv1_wave');
        eq('forge: pv1_wave value (Tri=1)', fg.getKnobParamInfo(0).value, 1);
        // Switch to pad 11 (Kit B voice 3): same knob now addresses pv11_wave = 3.
        fg.updateDrumPad(11, 46);
        eq('forge: focus moved to pad 11', fg.getViewModel().drumCurrentPad, 11);
        eq('forge: WAVE ioKey follows to pv11_wave', fg.getKnobParamInfo(0).ioKey, 'pv11_wave');
        eq('forge: pv11_wave re-read (Square=3)', fg.getKnobParamInfo(0).value, 3);
        // Playback-safe: the key is a fixed pv-index, not note-driven.
        fg.updateDrumPad(3, 38);
        eq('forge: pad 3 → pv3_wave (Saw=2)', `${fg.getKnobParamInfo(0).ioKey}=${fg.getKnobParamInfo(0).value}`, 'pv3_wave=2');
        eq('forge: no duplicate shortNames per page', noDupShorts(bootModel(MOCK_SYNTHS.forge)), null);

        // Explicit filter:/lfo: tags in the layout drive the graphics — no
        // name-inference. Filter bank (idx 1) → curve; Mod bank (idx 3) → wave.
        const fv = bootModel(MOCK_SYNTHS.forge);
        fv.changePage(1 - fv.getKnobPage());
        eq('forge: Filter page draws a filter curve', (fv.getViewModel().filterViz ?? []).length, 1);
        fv.changePage(3 - fv.getKnobPage());
        eq('forge: Mod page draws an LFO wave', (fv.getViewModel().lfoViz ?? []).length, 1);

        // Mix bank renders level faders as vertical bars.
        eq('forge: Mix v1_lvl is vbar', byKey(d, 'v1_lvl')?.renderStyle, 'vbar');

        // Automatable set: continuous Kit-A params yes; set-and-forget/enum no;
        // Kit B (pad > automatablePads=8) never automatable — no dead dot.
        const infoByKey = (m, key) => {
            for (let k = 0; k < 8; k++) { const i = m.getKnobParamInfo(k); if (i?.key === key) return i; }
            return null;
        };
        const fa = bootModel(MOCK_SYNTHS.forge);
        fa.changePage(1 - fa.getKnobPage());   // Filter page
        fa.updateDrumPad(1, 36);               // Kit A voice 1
        eq('forge: pad1 f1_cut automatable', infoByKey(fa, 'cv_f1_cut').automatable, true);
        eq('forge: pad1 f1_drv automatable', infoByKey(fa, 'cv_f1_drv').automatable, true);
        eq('forge: f1_type (enum) not automatable', infoByKey(fa, 'cv_f1_type').automatable, false);
        eq('forge: bw_cut (set-and-forget) not automatable', infoByKey(fa, 'cv_bw_cut').automatable, false);
        fa.updateDrumPad(9, 44);               // Kit B voice 1 → past automatablePads
        eq('forge: pad9 (Kit B) f1_cut NOT automatable', infoByKey(fa, 'cv_f1_cut').automatable, false);
        fa.updateDrumPad(1, 36);
        fa.changePage(0 - fa.getKnobPage());   // Osc page (no reflow)
        eq('forge: Osc level automatable', infoByKey(fa, 'cv_level').automatable, true);
        eq('forge: Osc detune not automatable', infoByKey(fa, 'cv_detune').automatable, false);
        fa.changePage(2 - fa.getKnobPage());   // Env page — all automatable
        eq('forge: Env e1_atk automatable', infoByKey(fa, 'cv_e1_atk').automatable, true);
        eq('forge: Env pe_dec automatable', infoByKey(fa, 'cv_pe_dec').automatable, true);

        // enumSetIndex: Forge's DSP writes enums by index but reports names, so
        // movy must commit an index — otherwise atoi(name)=0 collapses to LP/Sine.
        const fe = bootModel(MOCK_SYNTHS.forge);
        fe.updateDrumPad(1, 36);
        fe.handleKnobDelta(0, 8);        // Osc knob 0 = WAVE (cv_wave → pv1_wave), +2 steps
        fe.handleKnobRelease(0);
        eq('forge: enum committed as INDEX', /^\d+$/.test(env.params['synth:pv1_wave'] ?? ''), true);

        // A filter type the curve can't draw (Comb) → fall back to plain knobs;
        // a supported type still draws.
        const fc = bootModel({ ...MOCK_SYNTHS.forge, 'synth:pv1_f1_type': 'Comb+' });
        fc.changePage(1 - fc.getKnobPage());
        fc.updateDrumPad(1, 36);         // reseed pad-1 values incl pv1_f1_type
        eq('forge: unsupported filter type → no curve', (fc.getViewModel().filterViz ?? []).length, 0);
        const fh = bootModel({ ...MOCK_SYNTHS.forge, 'synth:pv1_f1_type': 'HP' });
        fh.changePage(1 - fh.getKnobPage());
        fh.updateDrumPad(1, 36);
        eq('forge: HP filter type draws an HP curve', fh.getViewModel().filterViz?.[0]?.mode, 'hp');
        globalThis.host_read_file = savedHRF;
    }

    // libpo32: 16-voice PO-32/Microtonic drum synth. Per-voice editing is
    // PLAYBACK-SAFE via padScoping v_ → v{pad}_ (padDigits 2, voices 1-16),
    // addressing the DSP's direct per-index keys. Self-describing: layout loads
    // from the module's movy_config.json (served from the fixture snapshot).
    {
        const savedHRF = globalThis.host_read_file;
        const po32Layout = readFileSync(new URL('../fixtures/libpo32-movy-config.json', import.meta.url), 'utf8');
        globalThis.host_read_file = (p) => p.endsWith('/po32-drum/movy_config.json') ? po32Layout : null;
        const byKey = (dd, k) => dd.params.find(p => p && p.key === k);

        const d = bootModel(MOCK_SYNTHS.libpo32).dumpLayout();
        eq('libpo32: 5 banks', d.banks.length, 5);
        eq('libpo32: 16 drum pads', d.drum?.padCount, 16);
        eq('libpo32: padScoping v_ → v{pad}_', d.drum?.padScoping?.concreteKeyTemplate, 'v{pad}_{suffix}');
        eq('libpo32: padDigits 2 (voices 1-16)', d.drum?.padScoping?.padDigits, 2);
        for (const k of ['v_wave', 'v_freq', 'v_dcy', 'v_mmode', 'v_nfmode', 'v_nffrq', 'v_nfq', 'v_mix', 'v_lvl'])
            eq(`libpo32: per-voice ${k}`, !!byKey(d, k), true);
        for (const k of ['kit', 'level', 'decay']) eq(`libpo32: global ${k}`, !!byKey(d, k), true);

        // padScoping: the focused pad drives the concrete key. Pad 1 → v01_freq,
        // pad 16 → v16_freq — a fixed index, so per-voice edits are playback-safe.
        const infoByKey = (mm, alias) => {
            for (let k = 0; k < 8; k++) { const i = mm.getKnobParamInfo(k); if (i?.key === alias) return i; }
            return null;
        };
        const pg = bootModel(MOCK_SYNTHS.libpo32);
        for (let t = 0; t < 4; t++) pg.tick();   // round-robin refresh reaches row-0 knobs
        eq('libpo32: pad 1 PITCH ioKey v01_freq', infoByKey(pg, 'v_freq').ioKey, 'v01_freq');
        eq('libpo32: v01_freq value (0.25)', infoByKey(pg, 'v_freq').value, 0.25);
        pg.updateDrumPad(16, 51);
        eq('libpo32: focus moved to pad 16', pg.getViewModel().drumCurrentPad, 16);
        eq('libpo32: PITCH follows to v16_freq', infoByKey(pg, 'v_freq').ioKey, 'v16_freq');
        eq('libpo32: v16_freq re-read (0.50)', infoByKey(pg, 'v_freq').value, 0.5);
        eq('libpo32: no duplicate shortNames per page', noDupShorts(bootModel(MOCK_SYNTHS.libpo32)), null);

        // The Noise bank (index 2) carries the filter graphic via explicit
        // filter: tags (cutoff=v_nffrq, resonance=v_nfq, mode=v_nfmode).
        const fv = bootModel(MOCK_SYNTHS.libpo32);
        fv.changePage(2 - fv.getKnobPage());
        for (let t = 0; t < 4; t++) fv.tick();
        eq('libpo32: Noise page draws a filter curve', (fv.getViewModel().filterViz ?? []).length, 1);

        globalThis.host_read_file = savedHRF;
    }

    // Self-describing module: forge is NOT bundled in movy; its layout loads from
    // the module's movy_config.json (served here from the authoring copy).
    {
        const { loadModuleConfig } = await import('../../dist/esm/modules/loader.js');
        const saved = globalThis.host_read_file;
        globalThis.host_read_file = () => null;   // no external file → not bundled
        eq('forge unbundled: null without layout file', loadModuleConfig('forge'), null);
        globalThis.host_read_file = (p) => p.endsWith('/forge/movy_config.json')
            ? JSON.stringify({ id: 'forge', name: 'Forge', banks: [{ name: 'X', rows: [[]] }] }) : null;
        const cfg = loadModuleConfig('forge');
        eq('forge: loaded from movy_config.json', cfg?.name, 'Forge');
        globalThis.host_read_file = saved;
    }
}


/* ── the layout invariants every config is silently assumed to hold ────────── */

_log('\nTest: every bundled config and fixture is one page per bank');

{
    /* buildConfigPages slices knobParams into fixed KNOBS_PER_PAGE pages and
     * looks the bank name up BY PAGE INDEX, so a bank that overflows a page
     * silently steals the next bank's name — and `bank.pad`'s findIndex, which
     * returns a BANK index used as a PAGE index, then targets the wrong page
     * too. Nobody gets an error for it: the fixture that violated this booted
     * fine and just showed page 2 labelled "Snare" over Kick's overflow.
     *
     * Read the configs as data rather than booting each one: the failure is a
     * property of the file, and a boot would need a matching mock per module. */
    const roots = [
        ['bundled', new URL('../../src/modules/', import.meta.url), (f) => f.endsWith('.json')],
        ['fixture', new URL('../fixtures/',      import.meta.url),
            (f) => f.endsWith('movy-config.json')],
    ];
    let checked = 0, bad = 0;
    const pads = [];
    for (const [kind, dir, keep] of roots) {
        for (const f of readdirSync(dir).filter(keep).sort()) {
            let cfg;
            try { cfg = JSON.parse(readFileSync(new URL(f, dir), 'utf8')); }
            catch (e) { fail(`${kind} ${f}`, `not valid JSON (${e.message})`); bad++; continue; }
            if (!Array.isArray(cfg.banks)) continue;
            const seen = new Map();
            cfg.banks.forEach((b, i) => {
                checked++;
                const cells = b.rows.reduce((n, r) => n + r.length, 0);
                if (cells > KNOBS_PER_PAGE) {
                    fail(`${kind} ${f}: bank ${i} "${b.name}"`,
                         `${cells} cells > ${KNOBS_PER_PAGE}, so it spans pages `
                       + `and desyncs every later bank's name`);
                    bad++;
                }
                if (b.pad === undefined) return;
                /* 1-based, matching drumPadOn's return. A 0-based config selects
                 * the wrong voice's page on every pad, which is how this shipped
                 * wrong the first time. */
                if (!Number.isInteger(b.pad) || b.pad < 1) {
                    fail(`${kind} ${f}: bank ${i} "${b.name}"`,
                         `pad ${b.pad} — pads are 1-based integers`);
                    bad++;
                }
                /* selectBankForPad takes the FIRST bank claiming the pad, so a
                 * duplicate is a page that can never be reached by its pad. */
                if (seen.has(b.pad)) {
                    fail(`${kind} ${f}: bank ${i} "${b.name}"`,
                         `pad ${b.pad} is already claimed by "${seen.get(b.pad)}", `
                       + `so this page is unreachable by pad`);
                    bad++;
                }
                seen.set(b.pad, b.name);
                const cap = cfg.drum?.padCount;
                /* A pad past padCount resolves to nothing (drumPadOfPhys returns
                 * -1), so the page is jog-only — the CW-78 bug. */
                if (cap !== undefined && b.pad > cap) {
                    fail(`${kind} ${f}: bank ${i} "${b.name}"`,
                         `claims pad ${b.pad} but padCount is ${cap}, `
                       + `so that pad does not exist and the page is jog-only`);
                    bad++;
                }
            });
            pads.push(`${f}:${seen.size}`);
        }
    }
    eq('at least the bundled configs were read', checked > 50, true);
    eq('no config breaks a layout invariant', bad, 0);
}

}
