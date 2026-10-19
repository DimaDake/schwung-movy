## Movy v0.37.0: mixer, note views, MIDI keyboards

**Session mixer.** Latch Session view and hold **Note/Session**: all 16 tracks on one screen, each with a fader and a stereo meter. Knobs set tracks 1–8, the jog flips to 9–16, and letting go returns to Session.

**See your notes.** With Loop mode on, the screen shows the clip as a folded piano roll: only pitches you used get a row, lined up with the bar strip, and it updates live while you record. Hold a step on a melodic track and the strip turns into a small keyboard with that step's notes lit.

**Play from a MIDI keyboard.** Plug a keyboard into the USB-A port. Notes on any channel play the selected track as fast as the pads and record like pad notes. On drum tracks, note 36 up plays one pad per key. Mod wheel and pitch bend play live but aren't recorded. CC mapping isn't there yet.

**Web mirror shows the whole Move.** Schwung's `/mirror` page now shows every LED and the buttons you press, not just the screen. With **Mirror Display** on it also plays and records Movy's audio.

**Fixed:** on an idle Move the **Power off?** dialog could open by itself whenever the battery dropped a percent.

**Needs Schwung 1.6.0+.**
