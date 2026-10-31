# Movy

**A 16-track sequencer and Elektron-style knob interface for [Ableton Move](https://www.ableton.com/move/), built on [Schwung](https://github.com/charlesvestal/schwung).**

📖 **[Website & manual](https://dimadake.github.io/schwung-movy/)** ·
⬇️ **[Install](https://dimadake.github.io/schwung-movy/install/)** ·
📜 **[Changelog](CHANGELOG.md)**

![Movy on the Move](site/assets/diagrams/panel-hero.svg)

Movy turns Move into a groovebox for Schwung modules. Every module's parameters
land on the eight knobs as clear, readable pages, and a 16-track sequencer that
plays like Move's own runs underneath. While it is open, Movy runs in place of
Move's software and owns the whole device. The Move can also boot straight into it.

## Features

- **16 tracks in four groups**, each with its own chain: MIDI FX → synth → FX 1 → FX 2 → mixer strip, plus two LFOs.
- **Parameter pages for any module**: arcs, switches, envelopes, filter curves,
  sample waveforms, presets, a sample browser and drum racks.
- **A sequencer aligned with Move**: clips, Session view, live recording with
  count-in, step recording, Capture, non-destructive quantize, copy and delete, undo and redo.
- **Beyond Move**: parameter locks on any step, probability and trig conditions,
  automation, LFOs, and Clip and Set pages.
- **Loop view**: the clip's notes as a piano roll over its bars.
- **Scenes and song mode**: launch whole clip columns and chain them into a looping song.
- **Mixing**: per-track level, pan and sends, three shared send effects, four
  master effects, and a 16-track mixer on one screen.
- **Generators**: Smart Quantize, Variation, Smart Double and New Clip offer new
  takes on a clip that fit the scene's chords and groove, on the device and offline.
- **Sets and backups**: Movy's own Sets list, automatic saving, and 32 restorable versions per Set.
- **Pad layouts** (chromatic or in key, 4ths, piano, inline) and **USB MIDI keyboards**.

<p>
<img src="site/assets/screens/page_config_pad.png" width="256" alt="Parameter page">
<img src="site/assets/screens/note_view_chords.png" width="256" alt="Loop view">
<img src="site/assets/screens/mixer_p1.png" width="256" alt="Session mixer">
<img src="site/assets/screens/ai_preview_var8.png" width="256" alt="Generator preview">
</p>

## Install

On a Move connected to your Wi-Fi, one command installs Schwung (the version
Movy is tested with), Movy and a few sounds, and makes the Move start in Movy:

```bash
curl -fsSL https://raw.githubusercontent.com/DimaDake/schwung-movy/main/scripts/install-movy.sh | sh -s -- --modules dexed,obxd,hera,hush1,8w8,9w9,dr32,dragonfly-hall,tapedelay
```

Pick your options with the **[command builder](https://dimadake.github.io/schwung-movy/install/)**,
or install from Schwung Manager or the Schwung desktop installer instead.

> **Early software.** Movy works on real hardware and is tested end to end, but
> expect rough edges. Reproducible bug reports (numbered steps, what you expected,
> what happened, which modules) are very welcome.

## Contributing

Building from source, the test tiers and adding a module layout:
[CONTRIBUTING.md](CONTRIBUTING.md).

Movy's screen UI is inspired by [Elektron](https://www.elektron.se/) instruments,
its sequencer by Move's own, and its engine approach by
[Davebox](https://github.com/legsmechanical/schwung-davebox).

## License

[MIT](LICENSE) © megadake
