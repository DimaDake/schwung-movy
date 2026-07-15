# Module inventory summary

Generated 2026-07-15T20:56:07.920Z from 76 installed modules
(schwung ?). Raw capture:
[device-dump.json](device-dump.json); per-module detail in [modules/](modules/).

Columns — **cfg**: movy custom layout (bundled = src/modules/*.json, file =
on-device movy_config.json); **shown**: knob slots movy exposes; **native**:
chain_params entries; **hidden**: native params not reachable from movy
(pad-alias-expanded); **pages**: movy knob pages.

## MIDI FX (9)

| module | version | status | cfg | drum | pages | shown | native | hidden | presets |
|---|---|---|---|---|---|---|---|---|---|
| [arp](modules/midi_fx--arp.json) | 0.3.0 | ok | — | — | 1 | 4 | 4 | 0 | 0 |
| [branchage](modules/midi_fx--branchage.json) | 0.4.1 | ok | — | — | 1 | 0 | 27 | 27 | 0 |
| [chord](modules/midi_fx--chord.json) | 0.5.0 | ok | — | — | 1 | 4 | 5 | 1 | 0 |
| [eucalypso](modules/midi_fx--eucalypso.json) | 0.1.5 | ok | — | — | 11 | 59 | 82 | 32 | 0 |
| [euclidrum](modules/midi_fx--euclidrum.json) | 0.1.1 | ok | — | — | 10 | 80 | 135 | 63 | 0 |
| [genera](modules/midi_fx--genera.json) | 0.2.4 | ok | — | — | 3 | 24 | 17 | 2 | 0 |
| [impressive-chords](modules/midi_fx--impressive-chords.json) | 0.1.24 | ok | — | — | 3 | 16 | 0 | 0 | 52 |
| [superarp](modules/midi_fx--superarp.json) | 0.1.8 | ok | — | — | 5 | 34 | 33 | 7 | 0 |
| [velocity_scale](modules/midi_fx--velocity_scale.json) | 0.2.0 | ok | — | — | 1 | 3 | 4 | 1 | 0 |

## Sound generators (35)

| module | version | status | cfg | drum | pages | shown | native | hidden | presets |
|---|---|---|---|---|---|---|---|---|---|
| [303](modules/sound_generator--303.json) | 0.3.0 | ok | — | — | 3 | 16 | 18 | 4 | 0 |
| [aphex](modules/sound_generator--aphex.json) | 0.1.0 | ok | — | — | 9 | 72 | 83 | 19 | 0 |
| [belt-in](modules/sound_generator--belt-in.json) | 0.1.2 | ok | — | — | 1 | 0 | 16 | 16 | 0 |
| [braids](modules/sound_generator--braids.json) | 0.2.5 | ok | — | — | 6 | 26 | 17 | 0 | 10 |
| [breakbeat](modules/sound_generator--breakbeat.json) | 0.4.0 | ok | — | — | 4 | 18 | 17 | 0 | 3 |
| [chiptune](modules/sound_generator--chiptune.json) | 0.1.2 | ok | — | — | 2 | 9 | 18 | 10 | 32 |
| [chordism](modules/sound_generator--chordism.json) | 0.3.11 | ok | — | — | 14 | 102 | 135 | 38 | 57 |
| [denis](modules/sound_generator--denis.json) | 0.1.1 | ok | — | — | 8 | 64 | 61 | 6 | 0 |
| [dexed](modules/sound_generator--dexed.json) | 0.5.11 | ok | — | — | 5 | 29 | 148 | 125 | 32 |
| [essaim](modules/sound_generator--essaim.json) | 0.2.9 | ok | bundled | 32 pads | 3 | 24 | 34 | 10 | 0 |
| [fizzik](modules/sound_generator--fizzik.json) | 0.1.0 | ok | — | — | 10 | 80 | 73 | 1 | 0 |
| [forge](modules/sound_generator--forge.json) | 0.2.0 | ok | — | — | 7 | 56 | 193 | 146 | 0 |
| [freak](modules/sound_generator--freak.json) | 0.0.4 | ok | — | — | 17 | 89 | 81 | 0 | 0 |
| [granny](modules/sound_generator--granny.json) | 0.1.9 | ok | — | — | 7 | 34 | 29 | 4 | 0 |
| [hera](modules/sound_generator--hera.json) | 0.1.5 | ok | — | — | 8 | 35 | 29 | 0 | 56 |
| [hush1](modules/sound_generator--hush1.json) | 0.2.6 | ok | — | — | 9 | 37 | 53 | 23 | 11 |
| [krautdrums](modules/sound_generator--krautdrums.json) | 0.1.1 | ok | bundled | 16 pads | 4 | 28 | 41 | 13 | 0 |
| [linein](modules/sound_generator--linein.json) | 0.2.0 | ok | — | — | 6 | 17 | 20 | 3 | 0 |
| [minijv](modules/sound_generator--minijv.json) | 0.4.13 | ok | — | — | 8 | 57 | 418 | 361 | 2427 |
| [moog](modules/sound_generator--moog.json) | 0.2.3 | ok | — | — | 12 | 51 | 39 | 0 | 14 |
| [mrdrums](modules/sound_generator--mrdrums.json) | 0.0.4 | ok | bundled | 16 pads | 3 | 17 | 231 | 22 | 0 |
| [mrsample](modules/sound_generator--mrsample.json) | 0.2.0 | ok | — | — | 8 | 29 | 21 | 0 | 0 |
| [nusaw](modules/sound_generator--nusaw.json) | 0.2.1 | ok | — | — | 9 | 36 | 27 | 0 | 27 |
| [obxd](modules/sound_generator--obxd.json) | 0.4.7 | ok | — | — | 13 | 72 | 77 | 13 | 128 |
| [osirus](modules/sound_generator--osirus.json) | 0.6.0 | ok | — | — | 13 | 54 | 156 | 108 | 0 |
| [plaits](modules/sound_generator--plaits.json) | 0.5.1 | ok | bundled | — | 2 | 14 | 14 | 0 | 0 |
| [po32-drum](modules/sound_generator--po32-drum.json) | 1.0.6 | ok | bundled | 8 pads | 1 | 3 | 3 | 0 | 0 |
| [rex](modules/sound_generator--rex.json) | 0.4.2 | ok | — | — | 2 | 9 | 10 | 1 | 0 |
| [sf2](modules/sound_generator--sf2.json) | 0.3.15 | ok | — | — | 1 | 2 | 3 | 1 | 0 |
| [sfz](modules/sound_generator--sfz.json) | 0.6.0 | ok | — | — | 1 | 8 | 12 | 12 | 0 |
| [signal](modules/sound_generator--signal.json) | 0.2.1 | ok | — | — | 11 | 88 | 146 | 66 | 0 |
| [smack-in](modules/sound_generator--smack-in.json) | 0.13.1 | ok | — | — | 1 | 0 | 20 | 20 | 0 |
| [surge](modules/sound_generator--surge.json) | 0.2.0 | ok | — | — | 31 | 201 | 303 | 110 | 675 |
| [weird-dreams](modules/sound_generator--weird-dreams.json) | 0.2.6 | ok | bundled | 8 pads | 3 | 20 | 219 | 135 | 0 |
| [wurl](modules/sound_generator--wurl.json) | 0.1.1 | ok | bundled | — | 2 | 10 | 11 | 1 | 0 |

## Audio FX (32)

| module | version | status | cfg | drum | pages | shown | native | hidden | presets |
|---|---|---|---|---|---|---|---|---|---|
| [ambiotica](modules/audio_fx--ambiotica.json) | 0.2.3 | ok | — | — | 2 | 9 | 13 | 4 | 4 |
| [belt](modules/audio_fx--belt.json) | 0.1.2 | ok | — | — | 3 | 13 | 16 | 3 | 0 |
| [chowtape](modules/audio_fx--chowtape.json) | 0.1.0 | ok | — | — | 1 | 8 | 10 | 2 | 0 |
| [clap](modules/audio_fx--clap.json) | 0.4.1 | ok | — | — | 2 | 9 | 6 | 0 | 509 |
| [cloudseed](modules/audio_fx--cloudseed.json) | 0.3.7 | ok | — | — | 1 | 8 | 10 | 2 | 0 |
| [dissolver](modules/audio_fx--dissolver.json) | 0.2.3 | ok | — | — | 3 | 24 | 18 | 2 | 0 |
| [dragonfly-hall](modules/audio_fx--dragonfly-hall.json) | 1.0.4 | ok | — | — | 2 | 9 | 16 | 8 | 25 |
| [ducker](modules/audio_fx--ducker.json) | 0.1.2 | ok | — | — | 1 | 8 | 8 | 0 | 0 |
| [filter](modules/audio_fx--filter.json) | 0.2.0 | ok | — | — | 4 | 18 | 15 | 1 | 0 |
| [freeverb](modules/audio_fx--freeverb.json) | 0.1.1 | ok | — | — | 1 | 4 | 5 | 1 | 0 |
| [gate](modules/audio_fx--gate.json) | 0.1.1 | ok | — | — | 1 | 8 | 8 | 0 | 0 |
| [granular](modules/audio_fx--granular.json) | 0.3.1 | ok | — | — | 5 | 28 | 22 | 2 | 0 |
| [junologue-chorus](modules/audio_fx--junologue-chorus.json) | 0.1.2 | ok | — | — | 1 | 3 | 3 | 0 | 0 |
| [magneto](modules/audio_fx--magneto.json) | 0.1.2 | ok | — | — | 6 | 48 | 49 | 13 | 0 |
| [midiverb](modules/audio_fx--midiverb.json) | 0.2.0 | ok | — | — | 3 | 13 | 14 | 1 | 64 |
| [mverb](modules/audio_fx--mverb.json) | 0.1.1 | ok | — | — | 1 | 8 | 9 | 1 | 0 |
| [nam](modules/audio_fx--nam.json) | 0.1.5 | ok | — | — | 1 | 2 | 3 | 1 | 0 |
| [ottx](modules/audio_fx--ottx.json) | 0.1.0 | ok | — | — | 2 | 12 | 26 | 14 | 0 |
| [palette](modules/audio_fx--palette.json) | 0.1.0 | ok | — | — | 6 | 44 | 29 | 1 | 0 |
| [psxverb](modules/audio_fx--psxverb.json) | 0.5.3 | ok | — | — | 1 | 4 | 5 | 1 | 0 |
| [punchfx](modules/audio_fx--punchfx.json) | 0.2.0 | ok | — | — | 1 | 3 | 3 | 0 | 0 |
| [pushnpull](modules/audio_fx--pushnpull.json) | 0.2.0 | ok | — | — | 2 | 13 | 16 | 3 | 0 |
| [smack](modules/audio_fx--smack.json) | 0.13.1 | ok | — | — | 3 | 12 | 20 | 8 | 0 |
| [spectra](modules/audio_fx--spectra.json) | 0.2.1 | ok | — | — | 5 | 38 | 32 | 2 | 0 |
| [structor](modules/audio_fx--structor.json) | 0.3.1 | ok | — | — | 4 | 32 | 26 | 2 | 0 |
| [superboom](modules/audio_fx--superboom.json) | 1.4.0 | ok | — | — | 5 | 40 | 36 | 4 | 0 |
| [tapedelay](modules/audio_fx--tapedelay.json) | 0.4.3 | ok | — | — | 1 | 6 | 6 | 0 | 0 |
| [tapescam](modules/audio_fx--tapescam.json) | 0.5.3 | ok | — | — | 1 | 8 | 11 | 3 | 0 |
| [usefulity](modules/audio_fx--usefulity.json) | 0.1.2 | ok | — | — | 1 | 8 | 12 | 4 | 0 |
| [verglas](modules/audio_fx--verglas.json) | 1.2.2 | ok | — | — | 3 | 24 | 20 | 4 | 0 |
| [vocoder](modules/audio_fx--vocoder.json) | 0.1.3 | ok | — | — | 1 | 8 | 9 | 1 | 0 |
| [war_bells](modules/audio_fx--war_bells.json) | 0.20.1 | ok | — | — | 10 | 50 | 51 | 1 | 0 |

## Anomalies

- **branchage** (midi_fx)
  - has chain_params but no ui_hierarchy and no movy config
  - movy shows NO params although the module exposes some
  - 27 chain_params not reachable in movy: map_x, map_y, density_kick, density_snare, density_hat, randomness, kick_note, snare_note, hat_note, steps, bpm, sync, …
- **chord** (midi_fx)
  - 1 chain_params not reachable in movy: strum_dir
- **eucalypso** (midi_fx)
  - 32 chain_params not reachable in movy: retrigger_mode, bpm, global_v_rnd, global_g_rnd, global_rnd_seed, rand_cycle, held_order_seed, missing_note_seed, lane1_drop_seed, lane1_n_rnd, lane1_n_seed, lane1_oct_rnd, …
  - page "Main": duplicate on-screen names ON
- **euclidrum** (midi_fx)
  - 63 chain_params not reachable in movy: sync, bpm, max_voices, global_velocity, global_rnd_seed, mutation_seed, passthrough, lane1_drop, lane1_velocity, lane1_accent_amt, lane1_fill, lane1_gate, …
  - page "Global": duplicate on-screen names PRESE
- **genera** (midi_fx)
  - 2 chain_params not reachable in movy: scale, gen_mode
- **impressive-chords** (midi_fx)
  - 16 shown params lack chain_params metadata (movy guesses type/range): preset_index, preset_index, base_note, transpose, invert, strum, tilt, articulate, length, retrig, timing, choke, …
- **superarp** (midi_fx)
  - 7 chain_params not reachable in movy: bpm, sync, velocity_seed, gate_seed, modifier_trigger, random_octave_seed, random_note_seed
- **velocity_scale** (midi_fx)
  - 1 chain_params not reachable in movy: curve_preset
- **303** (sound_generator)
  - 4 chain_params not reachable in movy: waveform, tuning, devil_mod_switch, drive_model
- **aphex** (sound_generator)
  - 19 chain_params not reachable in movy: trigger, v2_pw, v2_sync, v2_xmod, v2_detune, noise_color, filter_mode, esp_pitch_slew, esp_env_atk, esp_env_rel, esp_aud_mix, esp_pitch_mode, …
  - page "Main": duplicate on-screen names CUT, PEAK
  - page "VCO 1+2": duplicate on-screen names WAVE
  - page "Filter": duplicate on-screen names CUT, PEAK, MG, EG
  - page "Envelopes": duplicate on-screen names ATK, REL
- **belt-in** (sound_generator)
  - has chain_params but no ui_hierarchy and no movy config
  - movy shows NO params although the module exposes some
  - 16 chain_params not reachable in movy: key, scale, retune, amount, harm1, harm2, harm3, harm4, harm_level, spread, double_amt, hard, …
- **braids** (sound_generator)
  - 1 shown params lack chain_params metadata (movy guesses type/range): preset
- **breakbeat** (sound_generator)
  - page "Main - 1": duplicate on-screen names SAMPL, LENGT
- **chiptune** (sound_generator)
  - 10 chain_params not reachable in movy: chip, alloc_mode, noise_mode, sweep, wavetable, channel_mask, detune, octave_transpose, pitch_env_depth, pitch_env_speed
  - 1 shown params lack chain_params metadata (movy guesses type/range): preset
- **chordism** (sound_generator)
  - 38 chain_params not reachable in movy: detune, filter_lfo_rate, filter_lfo_depth, filter_lfo_spread, filter_lfo_shape, chord_spread, chord_rotation, fm_modulator, fm_amount, vib_delay, sweep_rate, bit_shift, …
  - 1 shown params lack chain_params metadata (movy guesses type/range): preset
  - page "Oscillators": duplicate on-screen names 1, 2, 3, 4
  - page "Delay": duplicate on-screen names TONE, MOD
  - page "Morph": duplicate on-screen names MORPH, INT
  - page "Ctrl Src": duplicate on-screen names TO
- **denis** (sound_generator)
  - 6 chain_params not reachable in movy: filter_type, vel_to_filter, preset, portamento, legato, patch_mode
  - page "Mat: Env": duplicate on-screen names ENV->
  - page "Mat: LFO": duplicate on-screen names LFO->
  - page "Mat: S&H": duplicate on-screen names S&H->
  - page "Mat: Nz": duplicate on-screen names NZ->P, NZ->F
- **dexed** (sound_generator)
  - 125 chain_params not reachable in movy: osc_sync, transpose, lfo_sync, pitch_eg_l3, pitch_eg_l4, op1_coarse, op1_fine, op1_detune, op1_osc_mode, op1_vel_sens, op1_amp_mod, op1_rate_scale, …
- **essaim** (sound_generator)
  - 10 chain_params not reachable in movy: all_mono, rnd_voice, preset, mode, dly_mode, v_attack, v_pan, v_octave, v_lfo_shape, v_mod_dest
- **fizzik** (sound_generator)
  - 1 chain_params not reachable in movy: voicing
  - page "Main": duplicate on-screen names RESON
  - page "Patch": duplicate on-screen names RESON
  - page "Exciter": duplicate on-screen names COLOR
  - page "Mod": duplicate on-screen names RATE, DEPTH, SHAPE, TARGE
  - page "Aftertouch": duplicate on-screen names VIB
- **forge** (sound_generator)
  - 146 chain_params not reachable in movy: rnd_pitch, all_mono, init_decay, init_freq, same_freq, copy_a_b, copy_b_a, swap_ab, rnd_b_from_a, morph_src, morph_curve, cv_vpreset, …
  - page "Main": duplicate on-screen names KIT
  - page "Patch": duplicate on-screen names KIT
  - page "FX": duplicate on-screen names MIX
- **granny** (sound_generator)
  - 4 chain_params not reachable in movy: sample_count, sample_name, active_grains, active_voices
- **hush1** (sound_generator)
  - 23 chain_params not reachable in movy: bend_range, sub_mode, white_noise, pulse_width, pwm_mode, pwm_depth, pwm_env_depth, filter_velocity_sens, velocity_sens, lfo_waveform, lfo_trigger, lfo_sync, …
- **krautdrums** (sound_generator)
  - 13 chain_params not reachable in movy: tempo_mode, limiter, delay_type, reverb_type, delay_sync, rhythm_1, rhythm_2, rhythm_3, rhythm_4, rhythm_5, rhythm_6, rhythm_7, …
- **linein** (sound_generator)
  - 3 chain_params not reachable in movy: gate_mode, gate_amount, gate_hold
- **minijv** (sound_generator)
  - 361 chain_params not reachable in movy: performance, part, octave_transpose, link_tones, nvram_patchCommon_chorusfeedback, nvram_patchCommon_chorusoutput, nvram_patchCommon_portamentomode, nvram_patchCommon_portamentotype, nvram_patchCommon_sololegato, nvram_patchCommon_velocityswitch, nvram_tone_0_toneswitch, nvram_tone_0_wavegroup, …
  - page "Common / Control": duplicate on-screen names PORTA
- **mrdrums** (sound_generator)
  - 22 chain_params not reachable in movy: g_rand_seed, g_rand_loop_steps, ui_auto_select_pad, ui_current_pad, ui_pad_page, pad_choke_group, p01_choke_group, p02_choke_group, p03_choke_group, p04_choke_group, p05_choke_group, p06_choke_group, …
- **mrsample** (sound_generator)
  - page "Sample": duplicate on-screen names START
- **obxd** (sound_generator)
  - 13 chain_params not reachable in movy: voice_count, pw_ofs, pw_env_both, bandpass, self_osc, fenv_inv, lfo_sync, env_pitch_both, as_played, pan_5, pan_6, pan_7, …
  - page "Global": duplicate on-screen names OCTAV
  - page "LFO Dest": duplicate on-screen names LFO>O, LFO>P
- **osirus** (sound_generator)
  - 108 chain_params not reachable in movy: preset, bank_index, rom_index, osc1_pulsewidth, osc1_wave_select, osc1_semitone, osc1_keyfollow, osc2_pulsewidth, osc2_wave_select, osc2_semitone, osc2_detune, osc2_fm_amount, …
  - page "LFO 2": duplicate on-screen names SHAPE
- **rex** (sound_generator)
  - 1 chain_params not reachable in movy: preset
- **sf2** (sound_generator)
  - 1 chain_params not reachable in movy: preset
- **sfz** (sound_generator)
  - 12 chain_params not reachable in movy: preset, octave_transpose, gain, voices, attack, decay, sustain, release, tune, cutoff, reso, knob_preset
  - 8 shown params lack chain_params metadata (movy guesses type/range): knob_0, knob_1, knob_2, knob_3, knob_4, knob_5, knob_6, knob_7
- **signal** (sound_generator)
  - 66 chain_params not reachable in movy: v1_attack, v1_sub_div, v1_sweep, v1_tone_rnd, v2_attack, v2_sub_div, v2_sweep, v2_tone_rnd, v3_attack, v3_sub_div, v3_sweep, v3_tone_rnd, …
  - page "Patch": duplicate on-screen names PATCH
  - page "Mix": duplicate on-screen names LEVEL, FREQ
- **smack-in** (sound_generator)
  - has chain_params but no ui_hierarchy and no movy config
  - movy shows NO params although the module exposes some
  - 20 chain_params not reachable in movy: loop_len, slice_res, fx_density, order_density, capture, arm, ab, reroll, clear, detect_bpm, wet, pitch_range, …
- **surge** (sound_generator)
  - 110 chain_params not reachable in movy: octave, pitch, osc1_octave, osc1_param6, osc1_keytrack, osc1_retrigger, osc2_octave, osc2_param6, osc2_keytrack, osc2_retrigger, osc3_octave, osc3_param6, …
  - page "Oscillator 1": duplicate on-screen names WIDTH
  - page "Oscillator 2": duplicate on-screen names WIDTH
  - page "Oscillator 3": duplicate on-screen names WIDTH
  - page "Amp Envelope": duplicate on-screen names DECAY
- **weird-dreams** (sound_generator)
  - 135 chain_params not reachable in movy: comp, dj_filter, eq_lo, eq_mid, eq_hi, lo_freq, mid_freq, hi_freq, q_lo, q_mid, q_hi, reset_eq, …
- **wurl** (sound_generator)
  - 1 chain_params not reachable in movy: preset
- **ambiotica** (audio_fx)
  - 4 chain_params not reachable in movy: mod_sync, mod_shape, lofi_tails, loop_length
- **belt** (audio_fx)
  - 3 chain_params not reachable in movy: harm3, harm4, spread
- **chowtape** (audio_fx)
  - 2 chain_params not reachable in movy: degrade, output
- **clap** (audio_fx)
  - 3 shown params lack chain_params metadata (movy guesses type/range): plugin_index, param_6, param_7
  - page "Main": duplicate on-screen names DELAY, LEVEL
- **cloudseed** (audio_fx)
  - 2 chain_params not reachable in movy: mod_rate, cross_seed
- **dissolver** (audio_fx)
  - 2 chain_params not reachable in movy: attack_time, release_time
- **dragonfly-hall** (audio_fx)
  - 8 chain_params not reachable in movy: modulation, wander, high_cut, high_xo, high_mult, low_cut, low_xo, low_mult
  - 1 shown params lack chain_params metadata (movy guesses type/range): preset
- **filter** (audio_fx)
  - 1 chain_params not reachable in movy: model
- **freeverb** (audio_fx)
  - 1 chain_params not reachable in movy: width
- **granular** (audio_fx)
  - 2 chain_params not reachable in movy: envelope, drift
- **magneto** (audio_fx)
  - 13 chain_params not reachable in movy: feedback, eq_in, rec_mode, rec_length, sync_mode, sync_div, tempo, load_a, load_b, blank_a, blank_b, save_recs, …
  - page "Channel": duplicate on-screen names FREQ
- **midiverb** (audio_fx)
  - 1 chain_params not reachable in movy: unit
- **mverb** (audio_fx)
  - 1 chain_params not reachable in movy: early_mix
- **nam** (audio_fx)
  - 1 chain_params not reachable in movy: cab_bypass
- **ottx** (audio_fx)
  - 14 chain_params not reachable in movy: low_cross, high_cross, ll_thres, ll_ratio, lu_thres, lu_ratio, bl_thres, bl_ratio, bu_thres, bu_ratio, hl_thres, hl_ratio, …
- **palette** (audio_fx)
  - 1 chain_params not reachable in movy: fx_reorder
  - page "Main": duplicate on-screen names AMOUN, MACRO
  - page "PALETTE": duplicate on-screen names AMOUN, MACRO
  - page "FX 1&2": duplicate on-screen names AMOUN, MACRO, DRIFT
  - page "FX 3&4": duplicate on-screen names AMOUN, MACRO, DRIFT
- **psxverb** (audio_fx)
  - 1 chain_params not reachable in movy: input_gain
- **pushnpull** (audio_fx)
  - 3 chain_params not reachable in movy: attack, band_on, view
- **smack** (audio_fx)
  - 8 chain_params not reachable in movy: arm, detect_bpm, pad_play, pad_rate, transport, channel_mode, pan_l, pan_r
- **spectra** (audio_fx)
  - 2 chain_params not reachable in movy: polyphony, limiter
  - page "Motion": duplicate on-screen names RATE
  - page "Patch": duplicate on-screen names PRESE
- **structor** (audio_fx)
  - 2 chain_params not reachable in movy: detection, rnd_filter
  - page "Randomize": duplicate on-screen names TIME
  - page "Presets": duplicate on-screen names PRESE
- **superboom** (audio_fx)
  - 4 chain_params not reachable in movy: flavor, micControl, vocGain, modShift
- **tapescam** (audio_fx)
  - 3 chain_params not reachable in movy: input, speed, widen
- **usefulity** (audio_fx)
  - 4 chain_params not reachable in movy: phase_l, phase_r, dc_filter, bass_audition
  - page "": duplicate on-screen names MONO
- **verglas** (audio_fx)
  - 4 chain_params not reachable in movy: mode, freeze, quality, stereo_spread
- **vocoder** (audio_fx)
  - 1 chain_params not reachable in movy: carrier_mix
- **war_bells** (audio_fx)
  - 1 chain_params not reachable in movy: preset
