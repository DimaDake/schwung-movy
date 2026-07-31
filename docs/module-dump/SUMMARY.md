# Module inventory summary

Generated 2026-07-15T20:56:07.920Z from 78 installed modules
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
| [branchage](modules/midi_fx--branchage.json) | 0.4.1 | ok | — | — | 4 | 27 | 27 | 0 | 0 |
| [chord](modules/midi_fx--chord.json) | 0.5.0 | ok | — | — | 1 | 5 | 5 | 0 | 0 |
| [eucalypso](modules/midi_fx--eucalypso.json) | 0.1.5 | ok | — | — | 13 | 91 | 82 | 0 | 0 |
| [euclidrum](modules/midi_fx--euclidrum.json) | 0.1.1 | ok | — | — | 19 | 143 | 135 | 0 | 0 |
| [genera](modules/midi_fx--genera.json) | 0.2.4 | ok | — | — | 3 | 18 | 17 | 0 | 0 |
| [impressive-chords](modules/midi_fx--impressive-chords.json) | 0.1.24 | ok | — | — | 3 | 15 | 0 | 0 | 52 |
| [superarp](modules/midi_fx--superarp.json) | 0.1.8 | ok | — | — | 7 | 41 | 33 | 0 | 0 |
| [velocity_scale](modules/midi_fx--velocity_scale.json) | 0.2.0 | ok | — | — | 1 | 4 | 4 | 0 | 0 |

## Sound generators (37)

| module | version | status | cfg | drum | pages | shown | native | hidden | presets |
|---|---|---|---|---|---|---|---|---|---|
| [303](modules/sound_generator--303.json) | 0.3.0 | ok | bundled | — | 3 | 18 | 18 | 0 | 0 |
| [aphex](modules/sound_generator--aphex.json) | 0.1.0 | ok | — | — | 16 | 91 | 83 | 0 | 0 |
| [belt-in](modules/sound_generator--belt-in.json) | 0.2.0 | ok | — | — | 3 | 16 | 16 | 0 | 0 |
| [braids](modules/sound_generator--braids.json) | 0.2.5 | ok | — | — | 6 | 26 | 17 | 0 | 10 |
| [breakbeat](modules/sound_generator--breakbeat.json) | 0.4.0 | ok | — | — | 3 | 17 | 17 | 0 | 3 |
| [chiptune](modules/sound_generator--chiptune.json) | 0.1.2 | ok | bundled | — | 3 | 19 | 18 | 0 | 32 |
| [chordism](modules/sound_generator--chordism.json) | 0.3.11 | ok | bundled | — | 17 | 123 | 135 | 16 | 57 |
| [denis](modules/sound_generator--denis.json) | 0.1.1 | ok | — | — | 9 | 62 | 61 | 0 | 0 |
| [dexed](modules/sound_generator--dexed.json) | 0.5.11 | ok | — | — | 29 | 172 | 148 | 0 | 32 |
| [essaim](modules/sound_generator--essaim.json) | 0.2.9 | ok | bundled | 32 pads | 3 | 24 | 34 | 10 | 0 |
| [fizzik](modules/sound_generator--fizzik.json) | 0.1.0 | ok | — | — | 10 | 73 | 73 | 0 | 0 |
| [forge](modules/sound_generator--forge.json) | 0.2.0 | ok | bundled | 16 pads | 12 | 90 | 193 | 103 | 0 |
| [freak](modules/sound_generator--freak.json) | 0.0.4 | ok | — | — | 17 | 89 | 81 | 0 | 0 |
| [granny](modules/sound_generator--granny.json) | 0.1.9 | ok | — | — | 7 | 35 | 29 | 4 | 0 |
| [hera](modules/sound_generator--hera.json) | 0.1.5 | ok | — | — | 8 | 35 | 29 | 0 | 56 |
| [hush1](modules/sound_generator--hush1.json) | 0.2.6 | ok | bundled | — | 7 | 53 | 53 | 0 | 11 |
| [krautdrums](modules/sound_generator--krautdrums.json) | 0.1.1 | ok | bundled | 16 pads | 6 | 41 | 41 | 0 | 0 |
| [linein](modules/sound_generator--linein.json) | 0.2.0 | ok | — | — | 6 | 20 | 20 | 0 | 0 |
| [minijv](modules/sound_generator--minijv.json) | 0.4.13 | ok | — | — | 70 | 440 | 418 | 10 | 2427 |
| [moog](modules/sound_generator--moog.json) | 0.2.3 | ok | — | — | 12 | 51 | 39 | 0 | 14 |
| [mrdrums](modules/sound_generator--mrdrums.json) | 0.0.4 | ok | bundled | 16 pads | 4 | 18 | 231 | 5 | 0 |
| [mrsample](modules/sound_generator--mrsample.json) | 0.2.0 | ok | — | — | 8 | 30 | 21 | 0 | 0 |
| [nusaw](modules/sound_generator--nusaw.json) | 0.2.1 | ok | — | — | 9 | 36 | 27 | 0 | 27 |
| [obxd](modules/sound_generator--obxd.json) | 0.4.7 | ok | — | — | 16 | 85 | 77 | 0 | 128 |
| [osirus](modules/sound_generator--osirus.json) | 0.6.0 | ok | — | — | 23 | 159 | 156 | 3 | 0 |
| [plaits](modules/sound_generator--plaits.json) | 0.5.1 | ok | bundled | — | 2 | 14 | 14 | 0 | 0 |
| [po32-drum](modules/sound_generator--po32-drum.json) | 1.0.6 | ok | bundled | 8 pads | 1 | 3 | 3 | 0 | 0 |
| [rex](modules/sound_generator--rex.json) | 0.4.2 | ok | — | — | 2 | 9 | 10 | 1 | 0 |
| [sf2](modules/sound_generator--sf2.json) | 0.3.15 | ok | — | — | 1 | 6 | 3 | 1 | 0 |
| [sfz](modules/sound_generator--sfz.json) | 0.6.0 | ok | bundled | — | 3 | 19 | 12 | 1 | 0 |
| [signal](modules/sound_generator--signal.json) | 0.2.1 | ok | bundled | 4 pads | 9 | 71 | 146 | 6 | 0 |
| [smack-in](modules/sound_generator--smack-in.json) | 0.15.1 | ok | — | — | 6 | 30 | 20 | 0 | 0 |
| [surge](modules/sound_generator--surge.json) | 0.2.0 | ok | — | — | 50 | 304 | 303 | 7 | 675 |
| [weird-dreams](modules/sound_generator--weird-dreams.json) | 0.2.6 | ok | bundled | 8 pads | 5 | 33 | 219 | 122 | 0 |
| [wurl](modules/sound_generator--wurl.json) | 0.1.1 | ok | bundled | — | 2 | 10 | 11 | 1 | 0 |
| [helm](modules/sound_generator--helm.json) | — | ok | — | — | 34 | 180 | 161 | 13 | 275 |
| [mono-voice](modules/sound_generator--mono-voice.json) | 0.4.1 | ok | — | — | 15 | 113 | 113 | 0 | 0 |

## Audio FX (32)

| module | version | status | cfg | drum | pages | shown | native | hidden | presets |
|---|---|---|---|---|---|---|---|---|---|
| [ambiotica](modules/audio_fx--ambiotica.json) | 0.2.3 | ok | — | — | 3 | 13 | 13 | 0 | 4 |
| [belt](modules/audio_fx--belt.json) | 0.2.0 | ok | — | — | 3 | 16 | 16 | 0 | 0 |
| [chowtape](modules/audio_fx--chowtape.json) | 0.1.0 | ok | — | — | 2 | 10 | 10 | 0 | 0 |
| [clap](modules/audio_fx--clap.json) | 0.4.1 | ok | — | — | 2 | 9 | 6 | 0 | 509 |
| [cloudseed](modules/audio_fx--cloudseed.json) | 0.3.7 | ok | — | — | 2 | 10 | 10 | 0 | 0 |
| [dissolver](modules/audio_fx--dissolver.json) | 0.2.3 | ok | — | — | 3 | 18 | 18 | 0 | 0 |
| [dragonfly-hall](modules/audio_fx--dragonfly-hall.json) | 1.0.4 | ok | — | — | 3 | 17 | 16 | 0 | 25 |
| [ducker](modules/audio_fx--ducker.json) | 0.1.2 | ok | — | — | 2 | 9 | 8 | 0 | 0 |
| [filter](modules/audio_fx--filter.json) | 0.2.0 | ok | — | — | 5 | 19 | 15 | 0 | 0 |
| [freeverb](modules/audio_fx--freeverb.json) | 0.1.1 | ok | — | — | 1 | 5 | 5 | 0 | 0 |
| [gate](modules/audio_fx--gate.json) | 0.1.1 | ok | — | — | 1 | 8 | 8 | 0 | 0 |
| [granular](modules/audio_fx--granular.json) | 0.3.1 | ok | — | — | 5 | 22 | 22 | 0 | 0 |
| [junologue-chorus](modules/audio_fx--junologue-chorus.json) | 0.1.2 | ok | — | — | 1 | 3 | 3 | 0 | 0 |
| [magneto](modules/audio_fx--magneto.json) | 0.1.2 | ok | — | — | 8 | 53 | 49 | 0 | 0 |
| [midiverb](modules/audio_fx--midiverb.json) | 0.2.0 | ok | — | — | 3 | 13 | 14 | 1 | 64 |
| [mverb](modules/audio_fx--mverb.json) | 0.1.1 | ok | — | — | 2 | 9 | 9 | 0 | 0 |
| [nam](modules/audio_fx--nam.json) | 0.1.5 | ok | — | — | 1 | 3 | 3 | 0 | 0 |
| [ottx](modules/audio_fx--ottx.json) | 0.1.0 | ok | — | — | 5 | 26 | 26 | 0 | 0 |
| [palette](modules/audio_fx--palette.json) | 0.1.0 | ok | — | — | 6 | 37 | 29 | 0 | 0 |
| [psxverb](modules/audio_fx--psxverb.json) | 0.5.3 | ok | — | — | 1 | 5 | 5 | 0 | 0 |
| [punchfx](modules/audio_fx--punchfx.json) | 0.2.0 | ok | — | — | 1 | 3 | 3 | 0 | 0 |
| [pushnpull](modules/audio_fx--pushnpull.json) | 0.2.0 | ok | — | — | 3 | 16 | 16 | 0 | 0 |
| [smack](modules/audio_fx--smack.json) | 0.15.1 | ok | — | — | 6 | 30 | 20 | 0 | 0 |
| [spectra](modules/audio_fx--spectra.json) | 0.2.1 | ok | — | — | 5 | 32 | 32 | 0 | 0 |
| [structor](modules/audio_fx--structor.json) | 0.3.1 | ok | — | — | 4 | 26 | 26 | 0 | 0 |
| [superboom](modules/audio_fx--superboom.json) | 1.4.0 | ok | — | — | 5 | 36 | 36 | 0 | 0 |
| [tapedelay](modules/audio_fx--tapedelay.json) | 0.4.3 | ok | — | — | 1 | 6 | 6 | 0 | 0 |
| [tapescam](modules/audio_fx--tapescam.json) | 0.5.3 | ok | — | — | 2 | 11 | 11 | 0 | 0 |
| [usefulity](modules/audio_fx--usefulity.json) | 0.1.2 | ok | — | — | 2 | 12 | 12 | 0 | 0 |
| [verglas](modules/audio_fx--verglas.json) | 1.2.2 | ok | — | — | 3 | 20 | 20 | 0 | 0 |
| [vocoder](modules/audio_fx--vocoder.json) | 0.1.3 | ok | — | — | 2 | 9 | 9 | 0 | 0 |
| [war_bells](modules/audio_fx--war_bells.json) | 0.20.1 | ok | — | — | 11 | 51 | 51 | 0 | 0 |

## Anomalies

- **branchage** (midi_fx)
  - has chain_params but no ui_hierarchy and no movy config
- **eucalypso** (midi_fx)
  - page "Main": duplicate on-screen names ON
- **impressive-chords** (midi_fx)
  - 15 shown params lack chain_params metadata (movy guesses type/range): preset_index, base_note, transpose, invert, strum, tilt, articulate, length, retrig, timing, choke, notes, …
- **aphex** (sound_generator)
  - page "VCO 1+2": duplicate on-screen names WAVE
- **braids** (sound_generator)
  - 1 shown params lack chain_params metadata (movy guesses type/range): preset
- **chordism** (sound_generator)
  - 16 chain_params not reachable in movy: grind, bit_shift, decimator, delay_mod_depth, lm_lfo_shape, pm_lfo_shape, fenv_hard_reset, quality_position, vib_osc_enable, sweep_osc_enable, shape_lfo_mode, lm_lfo_mode, …
- **essaim** (sound_generator)
  - 10 chain_params not reachable in movy: all_mono, rnd_voice, preset, mode, dly_mode, v_attack, v_pan, v_octave, v_lfo_shape, v_mod_dest
- **forge** (sound_generator)
  - 103 chain_params not reachable in movy: same_freq, copy_a_b, copy_b_a, swap_ab, rnd_b_from_a, cv_vpreset, cv_m1, cv_m2, cv_m3, cv_m4, cv_m5, cv_m6, …
- **granny** (sound_generator)
  - 4 chain_params not reachable in movy: sample_count, sample_name, active_grains, active_voices
- **minijv** (sound_generator)
  - 10 chain_params not reachable in movy: performance, part, nvram_tone_0_velocityrangelower, nvram_tone_0_velocityrangeupper, nvram_tone_1_velocityrangelower, nvram_tone_1_velocityrangeupper, nvram_tone_2_velocityrangelower, nvram_tone_2_velocityrangeupper, nvram_tone_3_velocityrangelower, nvram_tone_3_velocityrangeupper
- **mrdrums** (sound_generator)
  - 5 chain_params not reachable in movy: g_rand_seed, g_rand_loop_steps, ui_auto_select_pad, ui_current_pad, ui_pad_page
- **obxd** (sound_generator)
  - page "Global": duplicate on-screen names OCTAV
- **osirus** (sound_generator)
  - 3 chain_params not reachable in movy: preset, bank_index, panorama_velocity
- **rex** (sound_generator)
  - 1 chain_params not reachable in movy: preset
- **sf2** (sound_generator)
  - 1 chain_params not reachable in movy: preset
  - 4 shown params lack chain_params metadata (movy guesses type/range): reverb_on, reverb_level, chorus_on, chorus_level
- **sfz** (sound_generator)
  - 1 chain_params not reachable in movy: knob_preset
- **signal** (sound_generator)
  - 6 chain_params not reachable in movy: same_voice, mod_offset, dc_filter, save_scene_a, save_scene_b, morph_smooth
- **surge** (sound_generator)
  - 7 chain_params not reachable in movy: ktrkroot, solo_o1, solo_o2, solo_o3, solo_ring12, solo_ring23, solo_noise
- **weird-dreams** (sound_generator)
  - 122 chain_params not reachable in movy: reset_eq, init_freq, rnd_pan, save_kit, same_freq, v1_penv, v1_dist, v2_penv, v2_dist, v3_penv, v3_dist, v4_penv, …
- **wurl** (sound_generator)
  - 1 chain_params not reachable in movy: preset
- **clap** (audio_fx)
  - 3 shown params lack chain_params metadata (movy guesses type/range): plugin_index, param_6, param_7
- **dragonfly-hall** (audio_fx)
  - 1 shown params lack chain_params metadata (movy guesses type/range): preset
- **ducker** (audio_fx)
  - 1 shown params lack chain_params metadata (movy guesses type/range): vel_sens
- **midiverb** (audio_fx)
  - 1 chain_params not reachable in movy: unit
- **helm** (sound_generator)
  - 13 chain_params not reachable in movy: octave_transpose, cross_modulation, filter_saturation, filter_type, osc_mix, mod_8_amount, mod_9_amount, mod_10_amount, mod_11_amount, mod_12_amount, mod_13_amount, mod_14_amount, …
  - 24 shown params lack chain_params metadata (movy guesses type/range): mod_0_enable, mod_0_source, mod_0_dest, mod_1_enable, mod_1_source, mod_1_dest, mod_2_enable, mod_2_source, mod_2_dest, mod_3_enable, mod_3_source, mod_3_dest, …
  - page "Stutter": duplicate on-screen names STTTR, ST
