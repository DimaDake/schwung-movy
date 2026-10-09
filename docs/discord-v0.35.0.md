## Movy v0.35.0: Schwung pages, real drum racks, safer Sets

**Modules now look the way their authors drew them.** Under Settings → PARAM PAGES you choose who draws a module's parameter pages:
• **SCHWUNG** (new default) uses Schwung's own pages, the same ones you see in Schwung's slot settings. That covers module-drawn pages, canvas screens (DR32's ENGN), hidden pages that stay hidden, file browsers that preview as you scroll, and Schwung's LFO pages. It needs Schwung 1.5.0+.
• **MOVY** keeps Movy's own knob grid for now. It will be removed soon, so please report anything that only works there.

**Drum racks**
• **Mute + pad** mutes a voice, **Shift + Mute + pad** solos it. Silenced voices show grey.
• Drum modules' per-pad sends (Simian, DR32) now feed Movy's SEND 1 / SEND 2.

**Automation:** choices and switches (filter type, waveform) can be locked and recorded, and you get 32 lanes per track (up from 8).

**Fixed, the ones that lost work**
• Clear + knob could delete the whole clip.
• Reopening a Set could show no automation.
• A copied Set lost its instruments.
• Send FX are now saved with the Set.
• Play presses and step toggles were silently dropped under load.
• A chain synth (e.g. breakbeat) could crash the device at load.

**Heads up: Schwung tracks are no longer supported.** All 16 tracks are Movy chains, and the TRACKS 1-4 HOST setting is gone. The first time you open a Set that still uses Schwung's slots for tracks 1-4, Movy migrates it behind a MIGRATING TRACKS screen. The module, preset, volume and LFO assignments come across. Anything Movy can't show is left behind and reported. The Schwung slot itself is untouched, it just stops playing. **Settings → MIGRATE TRACKS** reruns the migration by hand, and overwrites whatever those chains hold.

**Use Schwung 1.6.0+** for all of this. Older hosts fall back to Movy's own pages.
