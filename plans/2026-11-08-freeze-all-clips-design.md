# Freeze v2: every clip, a track menu, a waveform — design

Status: design, APPROVED by the user 2026-11-08. Builds on PR #30 (merged as
`286b4337`, ENGINE 0.118.0). Plan to follow in this folder.

## Why

**Freeze exists to save CPU.** A full Set runs out of CPU long before 16
tracks; a frozen track costs ~0. Everything below serves that: a frozen track
must stay frozen through scenes, song mode, Loop-mode edits and Set opens,
because each time it falls back to a live chain the Set may stop fitting.

v1 freezes ONE clip slot; scenes and song mode then give silence on that
track. v2 freezes every clip of the track.

## Goals

1. **Every non-empty clip of the track is recorded** to its own loop. Whichever
   of them plays, its loop plays. An empty slot plays silence.
2. **A track menu on Shift + track button**, in the look of Settings
   (`flags-view.ts`: jog moves, jog click opens a row, Back closes, the bottom
   line explains the row). One row: `FREEZE T3`, or `UNFREEZE T3` on a frozen
   track. The Shift + double-tap gesture is removed. The menu opens for the
   pressed track WITHOUT switching to it (user): freeze T5 while on T2.
3. **Pads animate only while a freeze records.** A frozen track's pads are
   black.
4. **A waveform on a frozen track's screen:** the playing clip's loop, ONLY its
   playable part (the current loop window), with a moving playhead.
5. **A big centred toast to unfreeze**, shown only when a knob is touched or
   the jog is pressed on a frozen track (not on the MIX slot).
6. **Loop mode works on a frozen clip** for cuts: moving the start later or the
   end earlier, inside what was recorded, plays that stretch of the recording.
7. **Never restore a wrong loop.** A frozen track opens frozen only if each
   clip AND the chain's settings match what was recorded; otherwise it opens
   live (freeze it again).

## Non-goals

- **Per-version WAV copies.** Backups / Set versions keep no loops of their
  own; a restored version whose clips or chain differ opens live. (User:
  "I am okay to lose freeze on backups — just don't restore a wrong WAV".)
- **Recording more than the loop window**, or re-recording after a window
  change. A window grown past the recording is refused, not re-recorded.
- **Seamless unfreeze.** Unfreeze still stops the transport (a module load
  blocks audio 290–470 ms). Loading off the audio thread is its own project.
- Tempo re-render (the tape-style follow stays), partial freeze (FX kept
  live), stems export.

## Anti-goals (would be a failure even if it "works")

- A loop playing under a clip it was not recorded from — any door: scene,
  song, launch, undo, Set open, version restore, Loop-mode edit.
- Anything on the audio thread that allocates, frees, locks or does I/O
  (v1's discipline: `freeze_mem.rs`, `chain_reaper.rs`).
- A frozen track silently going live (CPU spike) where it could have stayed
  frozen.

## Decided behaviour

### Recording (user: device locked, option C)

- From the menu click until the last clip is recorded, **the device is
  locked**, as v1: every press but Back is swallowed, releases pass, LEDs dark
  except Back and the pads' animation, and the toast
  `FREEZING T3  CLIP 2/5  40%` stays up.
- **Order:** the clip playing now first — heard live through the synth, as v1.
  When its two passes end, the track switches to its loop (heard), and the
  synth then records the remaining clips **unheard**, one by one, in slot
  order, two passes each.
- **Stopped:** every clip is recorded with the track's output silent; the
  transport stops again at the end (v1's `play_alone`, per clip).
- **Back cancels the whole freeze**: loops recorded so far are discarded
  (freed off the audio thread), the chain stays live. *(My call: a
  half-frozen track has no consistent meaning.)*
- **Refused before starting**, with a message, nothing recorded: a muted
  track, a recording/armed track, a track with no clips, any clip over 60 s,
  or the whole track's loops taking all loops past **200 MB** (user: raised
  from v1's 128 MB — 16 tracks x 8 four-bar clips is ~180 MB). *(Checked for
  the sum of the track's clips up front.)*
- Each loop covers the clip's **loop window** at freeze time, in clock ticks
  (v1's maths, `freeze_len_ticks`).

### A frozen track

- **Lock:** the engine refuses every clip edit on every slot of the track (v1's
  `freeze_lock.rs`, widened from one slot to the track), and undo leaves its
  clips alone. Launches, scenes, song mode, mute/solo (fade), MIX page stay.
- **Loop window, the one allowed edit:** a Loop-mode change of start or end is
  accepted if the new window lies inside the recorded one, and the loop then
  plays from (new start − recorded start) with the new length. A window that
  leaves the recorded one is refused (`frzr=`, "UNFREEZE FIRST"). The tail at
  a new edge is whatever the recording has there — accepted. *(My call: the
  same rule for every verb that moves the window — Loop mode's `loop`, and
  `clen` when it only shortens.)*
- **Screen:** header `T3 FROZEN`, the chain slot bar (jog still reaches MIX),
  the waveform of the playing clip's playable part with a playhead. Stopped or
  playing another track: the selected clip's waveform, no playhead. Empty
  slot: `EMPTY CLIP`. No instruction text — the toast carries that.
- **Pads black.** Step LEDs as today.
- **Big toast:** knob touch, or jog press, on a frozen track off the MIX slot →
  a big centred toast `T3 IS FROZEN` / `SHIFT + TRACK TO UNFREEZE`, ~1.5 s.
  Every other refused press on it (step, pad note, Clip page knob, Loop-mode
  grow, `frzr=` from the engine) shows the SAME big toast (user), replacing
  v1's small "UNFREEZE T3 FIRST".
- **CPU page:** the F mark stays.

### Unfreeze

From the menu. Stopped: immediate. Playing: the row arms first
(`CONFIRM? STOPS PLAY`, Settings' click-twice pattern), the second click
stops the transport and reloads the chain with its preset and LFOs (v1).

### Saved with the Set

- `freeze/` holds one WAV per frozen clip (`t<T>-s<S>.wav`) and `freeze.txt`
  listing, per track: modules, a **chain fingerprint** (hash of the chain's
  saved parameter snapshot — the thing v1 does not check), and per slot the
  clip fingerprint, the recorded window and the WAV.
- **Open:** a track opens frozen only if the chain fingerprint matches and
  every non-empty clip has an entry whose fingerprint matches its content and
  whose recorded window contains its current window. Anything else → that
  track opens live and its freeze files are dropped from the manifest.
  The clip fingerprint therefore leaves out the loop window (it may shrink
  legitimately) and the window is checked separately.
- Version restore needs nothing more: it is an open.

## Brought back from the round-1 review branch (`pr-30`, user agreed)

1. **A frozen track is kept on the chain level** (`6a172a61`): a module page
   open when the track freezes, or when a frozen track is focused, is left
   (except MIX). Check what main does today while inside a synth page.
2. **LED handover after a capture** (`8cdd945d`): record the dark colours in
   each LED cache as sent, so every painter puts its own colour back on the
   next tick — instead of main's full LED re-init (`initLedsDone = false`).
3. **The browser guard asks the slot the browser was opened on**
   (`20ae77ad`, `browsedTrack()`), not "is Session mode on".

## Prior art in the code

- Waveform: schwung's `getWavPositionWaveformPreview` (`shadow_ui.js`) turns a
  WAV into peak points; movy's own pages never drew audio. Here the engine
  already holds the samples, so it should compute the peaks itself (once per
  loop, at record end / file load, off the audio thread) and the UI should
  fetch them with a get, on change only — never through the per-block status.
- Settings list: `src/renderer/flags-view.ts` and its router.
- v1 freeze: `movy-dsp/src/freeze*.rs`, `chain_reaper.rs`,
  `seq-core/src/engine/freeze_lock.rs`, `src/seq/freeze*.ts`.

## Left to the builder

- **The unheard recording** is the main engine piece: while the track's real
  playhead drives the first clip's loop, a capture-only player must feed the
  track's chain another clip from its loop start, two passes, independent of
  the track's playing slot. Where it lives (seq-core scheduler vs movy-dsp) is
  the builder's.
- Peak resolution, the get's name and format, the toast's exact layout.
- Status-line fields for progress (`clip i/n`).
- Tests: cargo first (multi-slot lock, sub-window playback, window-grow
  refusal, chain fingerprint on open, up-front memory check, capture order,
  Back mid-way frees everything); logic tests for the menu, the toast
  triggers, black pads; screenshot baselines for the menu, waveform and toast;
  a perf test for the waveform frame; the `freeze` device scenario widened to
  a multi-clip track with a scene switch. Device tier (audio thread) before
  merge.
- Docs: manual *Freezing a track*, controls, CHANGELOG [Unreleased],
  ENGINE_VERSION bump.
