# Troubleshooting

## Common problems

**Movy is frozen or the screen is stale.**
Hold **Shift**, touch the **volume knob** and click the **jog**. Movy closes,
saving if it can. Open it again from the Tools menu.

**The Move starts in Movy and I want Schwung or Move.**
At power-on, press **Back** during the two-second `Loading Movy` message and pick
**Schwung**.

**No sound when I play the pads.**
Check that the track has a module in its **SYNTH** slot, that the track isn't
muted (**Mute** lights bright when anything is muted), and that the master and
track volumes are up.

**The metronome is too quiet.**
Raise **CLICK VOLUME** in **Settings** (**Shift** + **Step 2**).

**Crackles or dropouts.**
Open the **CPU meter** (**Shift** + **Step 12**). Near or over 100 %, use lighter
modules, share one reverb through a send instead of one per track, or mute
tracks you don't need.

**A Set is empty, or I want an earlier version.**
Open **Settings → BACKUPS** and restore a version (see
[Backups](../manual/sets.md#backups)). Restoring is undoable.

**`CANNOT LOAD THIS SET`.**
The Set's saved file can't be read. **Jog click** starts the Set empty; the
damaged file is kept on the Move, so try **Settings → BACKUPS** first and
include the Set in a bug report.

![Cannot load this Set](../assets/screens/session_failed.png){ .small }

**`ENGINE MISMATCH` or `ENGINE DID NOT START`.**
The install is incomplete. Reinstall Movy from Schwung Manager. Your Sets are not affected.

**A knob jumps backwards while turning.**
A worn encoder can report some clicks the wrong way. Create the file
`/data/UserData/schwung/knob_direction_filter` on the Move (empty for all knobs,
or knob numbers such as `1,4`), then reopen Movy.

**`32 AUTOMATION LANES — FULL`.**
Each track can lock or automate up to 32 different parameters. Clear a lane you
no longer need: hold **Delete** and touch its knob.

**A module's page looks wrong or empty.**
Note the module's name and version and report it (below).

## Limitations

- **Schwung modules only.** Movy does not play Move's own instruments, drum racks or sampler.
- **Processing runs out before 16 tracks do.** Six or seven tracks of ordinary
  synths is typical. Light modules go much further.
- **Tracks only sound while Movy is open.**
- **Capture keeps notes only**, not knob moves. Record automation live instead.
- **External MIDI**: notes, mod wheel and pitch bend only. No other CCs, aftertouch or clock.
- **Move features not in Movy:** note repeat, 16 Pitches, sampling and resampling,
  count-in options (the count-in is always one bar), and turning automation on or
  off with Mute + knob.

## Reporting a bug

Good reports help the most. Open an issue on
[GitHub](https://github.com/DimaDake/schwung-movy/issues) with:

1. **What you did**, as numbered steps.
2. **What you expected.**
3. **What happened.**
4. **Which modules** were loaded, on which tracks.
5. Your **Movy** and **Schwung** versions.

A screen recording from the web mirror (<http://move.local:7700/mirror>, see
[Recording a video](../manual/system.md#recording-a-video-of-your-screen)) is often the best report of all.
