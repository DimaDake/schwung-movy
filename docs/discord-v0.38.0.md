## Movy v0.38.0: freeze tracks

**Freeze a track, get its CPU back.** Hold **Shift** and double tap a track button, then click the jog on **Freeze T3?**. Movy records the track's playing clip into a loop and unloads its synth and effects. It sounds the same, and its fader, pan, mute, solo and sends still work. On a Set that was running out of CPU this is the fix: 16 synth tracks that dropped out at 39 % CPU play at 0.2 % with all of them frozen.

The recording is two passes of the clip, in real time, so reverb and delay tails wrap into the loop. With the transport stopped it records silently and stops again. **Back** cancels it.

A frozen track shows the synth it came from, scrolls **FROZEN** on its pads and gets an **F** on the CPU page (Shift + Step 12). It refuses edits until you unfreeze it, and follows tempo changes like tape. Frozen tracks are saved with the Set and open without loading their synth.

**Unfreeze:** Shift + double tap again. The synth comes back with its preset and LFOs. **Unfreezing stops playback**, as in Live, because reloading a module takes a moment; while playing, Movy asks first.

**Fixed:** the web mirror (`/mirror`) no longer goes quiet when the master volume is low.

**Needs Schwung 1.6.0+.**
