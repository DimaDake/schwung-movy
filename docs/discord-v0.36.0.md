## Movy v0.36.0: Movy runs on its own

**Movy is now a standalone app.** While it's open it owns the whole Move: pads, screen, audio, the volume knob (master volume) and the power button (**Power off?** saves first). Move's software steps aside and comes back when you leave with **Back → Close Movy**. More CPU is free for tracks: they now render across all four cores.

**Boot straight into Movy.** Press **Back** in the two-second window at power-on and pick **Movy** in Schwung's boot picker. Pick Schwung there to go back. Installing never changes the default.

**Movy keeps its own Sets.** **Shift + Step 1** lists them: new, open, rename, copy, delete. The first start brings every Set over from Move once, tracks 1–4 and the master chain included. Your old files are left untouched. **Settings → MIGRATE FROM MOVE** runs it again if you need to.

**Modules follow Movy's clock.** Play, Stop, MIDI clock and tempo now reach every chain, so Breakbeat and other clock-driven modules lock to the bar.

**Also new**
• **Settings → CLICK VOLUME**: the metronome goes up to +11 dB.
• **Shift + knob 1** on a preset page steps banks (OB-Xd, Dexed).
• Knobs that open a module's own screen show **CLK OPEN** when held. Live module screens update and canvas pages animate.
• Parameter pages are always Schwung's, and Movy's text now uses Schwung's font.

**Fixed:** Virus crackle; switching Sets dropped the last seconds of work; Strut showed 32 pads for 16.

**Needs Schwung 1.6.0+.** Move's speaker EQ isn't applied yet, so the built-in speaker sounds a little different. Headphones and line out are unaffected.
