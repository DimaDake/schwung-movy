# External MIDI keyboard (USB-A) → active track

**Goal:** a class-compliant controller on Move's USB-A port (first user: an
OP-XY) plays the active track and records into it like the pads. No CC mapping
yet; mod wheel (CC 1) and pitch bend are played live but not recorded. A
custom mapping (schwung's CC map style) may come later.

## Decisions (user)

- Every note on every channel goes to the ACTIVE track.
- Notes record exactly like pad notes (Rec armed, step record, held-step edit).
- Mod wheel + pitch bend: live only, never recorded.
- Drum track: one key per drum pad. Note `36 + i` plays drum pad `i + 1`
  (my call on the base: 36 is the GM/Move kick, and a declared rack whose notes
  are not contiguous still gets one key per pad). Keys with no pad are ignored.

## Shape

USB-A MIDI reaches the SPI RX mailbox as cable 2 (XMOS forwards it; the Pi has
no USB host on that port), so movy-host already sees it.

1. **Host** (`host/midi_in.c`, `audio.c`, `vtable.c`): `midi_in_feed` also
   hands cable-2 note/CC/pitch-bend to the engine, and `engine_on_midi` carries
   the source (`MOVE_MIDI_SOURCE_EXTERNAL` for cable 2) so the engine can tell a
   USB note 70 from pad 70.
2. **Engine** (`movy-dsp/src/ext_route.rs`): sounds the note on the audio
   thread — the same latency as a pad, no UI tick in the path. The UI pushes
   `extmap` (`<chain>` melodic, `<chain>,<p0>,…` drum lanes from note 36),
   by comparison every tick like `padmap`. Note-offs answer from a 128-entry
   ledger (the ledger rule, `pad_route.rs`). A chain change recentres pitch
   bend and zeroes the mod wheel on the chain being left, so a wheel held
   through a track switch cannot leave the old track bent.
3. **UI** (`src/midi/external.ts`): `onMidiMessageExternal` records the note
   through `seqNotePadPlayed/Released` (the pad recording path) under a key
   outside the pad range, with its own track/pitch ledger. It sends no sound.

## Out of scope

CC mapping, aftertouch, external clock, MIDI out, recording wheels, LED
feedback for external notes.
