# MANUAL draft — movy on its own (standalone)

Draft for `MANUAL.md`, written in WP7 against the dev flavour **movy-sa**.
It moves into the MANUAL when WP8 ships standalone as the `movy` module; until
then no released movy behaves like this, so it is kept out of the user manual.
Screenshots: `browser-test/screenshots/baseline/master_volume.png`,
`power_modal.png`, `leave_modal.png` (via `make-doc-assets.mjs` at merge time).

---

## Movy without Move

Standalone movy runs in place of Move's own software: Move's UI is not running
underneath, so there is nothing to switch back to while movy is open. A few
things that Move used to handle are movy's now.

### Leaving movy

**Back** at the top level opens **Leave Movy?** with one choice, **Close Movy**:
turn the jog wheel to it and click. Movy saves the Set and Move starts again.
(Beside Move there is also **Background**; standalone has no Move to go back
to while movy keeps playing, so it is not offered.)

**If movy ever stops responding:** hold **Shift**, touch the **volume knob**,
and click the **jog wheel**. Movy closes and saves as usual; if it cannot
(for example a stuck script), it closes anyway after two seconds, without
saving, so the device always comes back.

### Master volume

The **volume knob** on its own is the master volume. Touch it to see the
**MASTER VOLUME** slider; each detent is 1 dB, from silence up to 0 dB
(full scale). Movy remembers the level across Sets and restarts. The first
time you open standalone movy it starts at −12 dB.

Holding a **track button** and turning the knob still sets that track's
volume, on any of the 16 tracks, exactly as before.

### Powering off

Hold the **power button** as you would on Move. Movy asks **Power off?**:
click the jog wheel to confirm, or turn to **Cancel** (or press **Back**) to
carry on. On confirm movy saves the Set first, then the device shuts down.
Nothing powers off from the button alone.

### Known limitations

- **Built-in speaker EQ.** Move shapes the sound of its built-in speaker with
  its own EQ. Standalone movy does not yet, so the speaker sounds different
  from the same Set under Move. Headphones and line out are unaffected.
- Opening movy from the Tools menu restarts Move's software around it, so
  opening and closing take a few seconds each way.
