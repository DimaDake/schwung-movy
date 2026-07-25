# Note-Off Sanity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every MIDI note movy sounds gets a matching note-off on the channel that started it, across track switches, view changes, module swaps, mute, and teardown.

**Architecture:** A track-owning ledger (`padNote → {track, pitch}`) becomes the single source of truth for live pad notes; releases read the ledger instead of recomputing the channel and pitch from current UI state. A new `onUnload` host hook releases both live notes and the sequencer's open gates (read from the UI's `activeNotes` mirror) before the DSP is torn down. The Rust engine gains an immediate gate flush on mute.

**Tech Stack:** TypeScript (esbuild → `dist/esm`), QuickJS on-device runtime, Rust (`seq-core`), Node `.mjs` test harnesses.

**Design doc:** `movy/plans/2026-07-26-note-off-sanity-design.md`

## Global Constraints

- Movy's own code never depends on CC 123 / All-Notes-Off. Every release is an explicit `0x8n` per note. (The host's own CC 123 sweep stays as-is; we neither add to nor rely on it.)
- The ledger — not `appState.activeSlot`, not `seqState.watchTrack`, not the current `drumConfig` — determines a note-off's channel and pitch.
- No startup sweep. Movy only releases notes it has a record of.
- Comments explain WHY (constraints, invariants, workarounds), never WHAT the code literally does. (`movy/CLAUDE.md`)
- No code duplication — one `emitNoteOff`, one drain helper per scope.
- Run `npm run build:browser` before any `.mjs` test; `dist/esm` is what the tests import.

---

### Task 1: The note ledger

Pure data structure, no MIDI globals, so it is testable in isolation.

**Files:**
- Create: `src/keyboard/held-notes.ts`
- Test: `browser-test/logic.mjs` (append a new block)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface LiveNote { padNote: number; track: number; pitch: number; }`
  - `noteSounded(padNote: number, track: number, pitch: number): void`
  - `noteReleased(padNote: number): LiveNote | undefined`
  - `soundingTrack(padNote: number): number | undefined`
  - `isSounding(padNote: number): boolean`
  - `drainAll(): LiveNote[]`
  - `drainTrack(track: number): LiveNote[]`
  - `soundingCount(): number`

- [ ] **Step 1: Write the failing test**

Append to `browser-test/logic.mjs`, before the final summary block:

```js
/* ── live-note ledger ────────────────────────────────────────────────────── */

_log('\nTest: held-notes ledger');

{
  const L = await import('../dist/esm/keyboard/held-notes.js');

  L.drainAll();
  eq('ledger starts empty', L.soundingCount(), 0);

  L.noteSounded(68, 1, 60);
  eq('records pitch', L.noteReleased(68)?.pitch, 60);
  eq('release removes it', L.soundingCount(), 0);
  eq('second release is undefined', L.noteReleased(68), undefined);

  // The owner track is what a later release must use, even if the UI has since
  // moved to another track.
  L.noteSounded(68, 1, 60);
  eq('records owner track', L.soundingTrack(68), 1);
  eq('isSounding true', L.isSounding(68), true);
  eq('isSounding false for other pad', L.isSounding(69), false);
  eq('released note carries owner track', L.noteReleased(68)?.track, 1);

  // drainAll empties everything and hands back the owners.
  L.noteSounded(68, 0, 60);
  L.noteSounded(69, 2, 64);
  const all = L.drainAll();
  eq('drainAll returns both', all.length, 2);
  eq('drainAll empties', L.soundingCount(), 0);
  eq('drainAll entry has padNote', all.find(n => n.pitch === 64)?.padNote, 69);

  // drainTrack takes only that track, leaving the rest sounding.
  L.noteSounded(68, 0, 60);
  L.noteSounded(69, 1, 64);
  L.noteSounded(70, 0, 67);
  const t0 = L.drainTrack(0);
  eq('drainTrack returns that track only', t0.length, 2);
  eq('drainTrack leaves others', L.soundingCount(), 1);
  eq('survivor is track 1', L.soundingTrack(69), 1);
  L.drainAll();
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/dake/git/cld/movy && npm run build:browser && node browser-test/logic.mjs
```

Expected: FAIL — the build errors, or the import throws `Cannot find module '../dist/esm/keyboard/held-notes.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/keyboard/held-notes.ts`:

```ts
/* Ownership ledger for live pad notes — the notes movy sounds directly from the
 * UI, as opposed to the sequencer's gates, which the engine owns and closes
 * itself. Each entry records the track the note was sounded on so a release
 * always reaches the channel that started it, even after the active track, the
 * loaded module, or the current view has changed underneath it. Recomputing
 * either the channel or the pitch at release time is what stranded notes
 * before, so nothing outside this module may do so. */

export interface LiveNote {
    padNote: number;
    track:   number;
    pitch:   number;
}

const live = new Map<number, LiveNote>();   /* padNote → owner */

export function noteSounded(padNote: number, track: number, pitch: number): void {
    live.set(padNote, { padNote, track, pitch });
}

/* Remove and return the pad's note, or undefined if it was never sounding
 * (a shift-select drum pad, or an already-drained release). */
export function noteReleased(padNote: number): LiveNote | undefined {
    const n = live.get(padNote);
    if (n !== undefined) live.delete(padNote);
    return n;
}

export function soundingTrack(padNote: number): number | undefined {
    return live.get(padNote)?.track;
}

export function isSounding(padNote: number): boolean { return live.has(padNote); }

/* Remove and return every entry. Callers emit the note-offs; keeping this
 * module free of MIDI globals is what lets it be tested on its own. */
export function drainAll(): LiveNote[] {
    const out = [...live.values()];
    live.clear();
    return out;
}

/* Remove and return one track's entries, leaving other tracks sounding. */
export function drainTrack(track: number): LiveNote[] {
    const out: LiveNote[] = [];
    for (const [padNote, n] of live) {
        if (n.track === track) {
            out.push(n);
            live.delete(padNote);
        }
    }
    return out;
}

export function soundingCount(): number { return live.size; }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/dake/git/cld/movy && npm run build:browser && node browser-test/logic.mjs
```

Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add src/keyboard/held-notes.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
Add track-owning ledger for live pad notes

Records the track each pad note was sounded on so a release can reach the
channel that started it rather than whatever is active at release time.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Rewire live note on/off to the ledger

Replaces `keyboardState.held` everywhere and removes the recompute hazards.

**Files:**
- Create: `src/keyboard/release.ts`
- Modify: `src/keyboard/handler.ts` (whole file), `src/keyboard/drum-handler.ts:40-66`, `src/keyboard/state.ts`, `src/midi/router.ts:7,166-190,332,526`, `src/seq/router.ts:389-395`, `src/seq/main-page.ts:88`, `src/app/tick.ts:499,533`, `src/app/init.ts:4,41`
- Test: `browser-test/logic.mjs`

**Interfaces:**
- Consumes: everything Task 1 produces.
- Produces:
  - `emitNoteOff(track: number, pitch: number): void` (from `release.ts`)
  - `releaseAllLive(): void`
  - `releaseLiveOnTrack(track: number): void`
  - Changed signatures: `noteOff(padNote: number, padMin: number): void`, `drumPadOff(physPad: number): void`, `setRoot(absNote: number): void`, `changeRoot(semitones: number): void`, `seqNotePadReleased(padNote: number, track: number): void`
  - Removed: `keyboardState.held`, `releaseAllNotes(track)`

- [ ] **Step 1: Write the failing test**

Append to `browser-test/logic.mjs` after the Task 1 block:

```js
/* ── release routing: the ledger owns the channel ────────────────────────── */

_log('\nTest: note-off channel follows the ledger, not the active track');

{
  const L        = await import('../dist/esm/keyboard/held-notes.js');
  const { noteOn, noteOff }        = await import('../dist/esm/keyboard/handler.js');
  const { drumPadOn, drumPadOff }  = await import('../dist/esm/keyboard/drum-handler.js');
  const { releaseAllLive, releaseLiveOnTrack } = await import('../dist/esm/keyboard/release.js');

  let sentMidi = [];
  const origSendMidi = globalThis.shadow_send_midi_to_dsp;
  const origSetParam = globalThis.shadow_set_param;
  globalThis.shadow_send_midi_to_dsp = (msg) => { sentMidi.push([...msg]); };
  globalThis.shadow_set_param = () => true;

  const offs = () => sentMidi.filter(m => (m[0] & 0xF0) === 0x80);

  // Sound on track 1, release after the UI has moved on. The off must still go
  // to channel 1 — this is the stuck-note bug.
  L.drainAll(); sentMidi = [];
  noteOn(68, 68, 1, 100);
  eq('note-on goes to track 1', sentMidi[0][0] & 0x0F, 1);
  sentMidi = [];
  noteOff(68, 68);
  eq('one note-off', offs().length, 1);
  eq('note-off channel is the owner track', offs()[0][0] & 0x0F, 1);
  eq('ledger emptied by release', L.soundingCount(), 0);

  // releaseAllLive fans out per-note, each on its own recorded track.
  L.drainAll(); sentMidi = [];
  noteOn(68, 68, 0, 100);
  noteOn(69, 68, 2, 100);
  sentMidi = [];
  releaseAllLive();
  eq('releaseAllLive emits both offs', offs().length, 2);
  eq('offs cover both tracks', offs().map(m => m[0] & 0x0F).sort().join(','), '0,2');
  eq('releaseAllLive empties ledger', L.soundingCount(), 0);

  // releaseLiveOnTrack touches only that track.
  L.drainAll(); sentMidi = [];
  noteOn(68, 68, 0, 100);
  noteOn(69, 68, 1, 100);
  sentMidi = [];
  releaseLiveOnTrack(0);
  eq('releaseLiveOnTrack emits one off', offs().length, 1);
  eq('on the muted track', offs()[0][0] & 0x0F, 0);
  eq('other track still sounding', L.soundingCount(), 1);
  L.drainAll();

  // Drum release uses the RECORDED pitch. Swapping the module between press and
  // release used to recompute a different note (or bail) and strand it.
  const mrdCfg = { padCount: 16, padNoteStart: 36, rawMidi: false, currentPadParam: 'ui_current_pad' };
  L.drainAll(); sentMidi = [];
  drumPadOn(76, 68, false, mrdCfg, 36, 'synth', 3, 100);   // → midiNote 40, track 3
  sentMidi = [];
  drumPadOff(76);                                          // no config passed at all
  eq('drum off uses recorded pitch', offs()[0][1], 40);
  eq('drum off uses recorded track', offs()[0][0] & 0x0F, 3);
  eq('drum release empties ledger', L.soundingCount(), 0);

  // A shift-select drum pad never sounded, so its release emits nothing.
  L.drainAll(); sentMidi = [];
  drumPadOn(68, 68, true, mrdCfg, 36, 'synth', 0, 100);
  sentMidi = [];
  drumPadOff(68);
  eq('silent shift-select emits no off', offs().length, 0);

  L.drainAll();
  globalThis.shadow_send_midi_to_dsp = origSendMidi;
  globalThis.shadow_set_param = origSetParam;
}
```

Also update the pre-existing held-tracking assertions in the `drumPadOn` block (`browser-test/logic.mjs`, the section that ends with `eq('shift-select not held', ...)`). Replace that whole held-tracking passage:

```js
  // Held tracking: a sounding pad registers in keyboardState.held so the drum
  // grid can light it green; release clears it. A shift-select makes no sound,
  // so it must not register as held.
  const { keyboardState } = await import('../dist/esm/keyboard/state.js');
  for (const k of Object.keys(keyboardState.held)) delete keyboardState.held[+k];
  drumPadOn(76, 68, false, mrdCfg, 36, 'synth', 0, 100);   // sounds midiNote 40
  eq('held pad tracked (phys→midi)', keyboardState.held[76], 40);
  drumPadOff(76, 68, mrdCfg, 36, 0);
  eq('held pad cleared on release', keyboardState.held[76], undefined);
  drumPadOn(68, 68, true, mrdCfg, 36, 'synth', 0, 100);     // shift-select, silent
  eq('shift-select not held', keyboardState.held[68], undefined);
  for (const k of Object.keys(keyboardState.held)) delete keyboardState.held[+k];
```

with:

```js
  // Held tracking: a sounding pad registers in the ledger so the drum grid can
  // light it green; release clears it. A shift-select makes no sound, so it
  // must not register as sounding.
  const ledger = await import('../dist/esm/keyboard/held-notes.js');
  ledger.drainAll();
  drumPadOn(76, 68, false, mrdCfg, 36, 'synth', 0, 100);   // sounds midiNote 40
  eq('held pad tracked (phys→midi)', ledger.noteReleased(76)?.pitch, 40);
  drumPadOn(76, 68, false, mrdCfg, 36, 'synth', 0, 100);   // sound it again
  drumPadOff(76);
  eq('held pad cleared on release', ledger.isSounding(76), false);
  drumPadOn(68, 68, true, mrdCfg, 36, 'synth', 0, 100);     // shift-select, silent
  eq('shift-select not held', ledger.isSounding(68), false);
  ledger.drainAll();
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/dake/git/cld/movy && npm run build:browser && node browser-test/logic.mjs
```

Expected: FAIL — `release.js` does not exist; `noteOff` still takes three arguments.

- [ ] **Step 3: Write the implementation**

Create `src/keyboard/release.ts`:

```ts
import { drainAll, drainTrack } from './held-notes.js';

/* The single exit point for live-note note-offs. Every 0x8n movy sends for a
 * pad note goes through here, on the track recorded at note-on — keeping it in
 * one place is what makes "no note-off can pick the wrong channel" checkable
 * rather than a convention. */
export function emitNoteOff(track: number, pitch: number): void {
    shadow_send_midi_to_dsp([MidiNoteOff | track, pitch, 0]);
}

/* Release every sounding live note. Pad LEDs need no explicit repaint: the tick
 * loop paints them from isSounding() on the next pass. */
export function releaseAllLive(): void {
    for (const n of drainAll()) emitNoteOff(n.track, n.pitch);
}

/* Release one track's live notes, leaving other tracks sounding. Used by mute,
 * which is per-track. */
export function releaseLiveOnTrack(track: number): void {
    for (const n of drainTrack(track)) emitNoteOff(n.track, n.pitch);
}
```

Replace `src/keyboard/handler.ts` in full:

```ts
import { keyboardState } from './state.js';
import { noteSounded, noteReleased } from './held-notes.js';
import { emitNoteOff, releaseAllLive } from './release.js';
import { chromaticPadColor, chromaticPitch } from '../seq/pads.js';
import { C_GREEN } from '../seq/colors.js';
import { markUiStateDirty } from '../seq/ui-dirty.js';

/* Live pad note on the chromatic layout. Emits on the track's MIDI channel
 * (0x9n) so it reaches that track's chain slot, carrying real velocity. The
 * caller supplies the final velocity (Full Velocity is applied there). */
export function noteOn(padNote: number, padMin: number, track: number, vel: number): void {
    const midiNote = chromaticPitch(padNote, padMin, keyboardState.rootNote);
    if (midiNote < 0 || midiNote > 127) return;
    noteSounded(padNote, track, midiNote);
    keyboardState.lastPlayedNote = midiNote;
    shadow_send_midi_to_dsp([MidiNoteOn | track, midiNote, vel]);
    setLED(padNote, C_GREEN, true); // immediate green feedback before the next poll
}

/* The ledger — not the caller and not the currently active track — decides
 * which channel this off goes to. A track switch, module change, or view change
 * between press and release must not be able to redirect it. */
export function noteOff(padNote: number, padMin: number): void {
    const n = noteReleased(padNote);
    if (n === undefined) return;
    emitNoteOff(n.track, n.pitch);
    setLED(padNote, chromaticPadColor(padNote, padMin, keyboardState.rootNote, n.track, false, null, keyboardState.scale), true);
}

/* Set the chromatic layout's base note to an absolute MIDI note (clamped),
 * releasing held notes. Pads are deliberately NOT painted here: app/tick.ts owns
 * pad LEDs and is track-aware (chromatic vs drum vs Session clip grid), so a root
 * change repaints chromatic pads on the next tick without ever overwriting a drum
 * rack or clip grid. */
export function setRoot(absNote: number): void {
    releaseAllLive();
    keyboardState.rootNote = Math.max(0, Math.min(103, absNote));
    markUiStateDirty();
}

/* Shift the chromatic layout's base note. +/- move by an octave. */
export function changeRoot(semitones: number): void {
    setRoot(keyboardState.rootNote + semitones);
}
```

In `src/keyboard/drum-handler.ts`, change the import block and the two `keyboardState.held` sites, and replace `drumPadOff` entirely:

Change the imports at the top from:

```ts
import type { DrumConfig } from '../types/param.js';
import { keyboardState } from './state.js';
```

to:

```ts
import type { DrumConfig } from '../types/param.js';
import { keyboardState } from './state.js';
import { noteSounded, noteReleased } from './held-notes.js';
import { emitNoteOff } from './release.js';
```

In `drumPadOn`, replace:

```ts
        keyboardState.held[physPad] = midiNote;
```

with:

```ts
        noteSounded(physPad, slot, midiNote);
```

Replace the whole `drumPadOff` function with:

```ts
/* Release takes no config: the pitch and channel come from the ledger. Deriving
 * them from the live DrumConfig stranded the note whenever the module changed
 * between press and release (the melodic/drum branches compute different
 * notes). Pads that never sounded — a shift-select, an out-of-grid press — are
 * simply absent from the ledger. */
export function drumPadOff(physPad: number): void {
    const n = noteReleased(physPad);
    if (n === undefined) return;
    emitNoteOff(n.track, n.pitch);
}
```

In `src/keyboard/state.ts`, drop the `held` field:

```ts
export const keyboardState = {
    rootNote: 48,
    scale:    0,                              /* index into SCALES (0 = Major) */
    /* most recent pad-played MIDI note — the sequencer's step-entry value */
    lastPlayedNote: 60,
};
```

In `src/midi/router.ts`:

- Line 7, change the import to drop `releaseAllNotes`:
  ```ts
  import { noteOn, noteOff, changeRoot } from '../keyboard/handler.js';
  ```
- Add next to it:
  ```ts
  import { soundingTrack } from '../keyboard/held-notes.js';
  import { releaseAllLive } from '../keyboard/release.js';
  ```
- In the pad note-off branch (currently lines 181-189), replace:
  ```ts
        if ((status & 0xF0) === 0x80 || ((status & 0xF0) === 0x90 && d2 === 0)) {
            if (drumCfg) {
                drumPadOff(d1, PAD_MIN, drumCfg, keyboardState.rootNote, track);
            } else {
                noteOff(d1, PAD_MIN, track);
            }
            seqNotePadReleased(d1);
            return;
        }
  ```
  with:
  ```ts
        if ((status & 0xF0) === 0x80 || ((status & 0xF0) === 0x90 && d2 === 0)) {
            // Read the owner before the release drains it — the record-capture
            // note-off has to reach the same track the note was played on.
            const owner = soundingTrack(d1) ?? track;
            if (drumCfg) {
                drumPadOff(d1);
            } else {
                noteOff(d1, PAD_MIN);
            }
            seqNotePadReleased(d1, owner);
            return;
        }
  ```
- Line 332, replace `releaseAllNotes(appState.activeSlot);` with `releaseAllLive();`
- Line 526, replace `changeRoot(d1 === MoveUp ? 12 : -12, appState.activeSlot);` with `changeRoot(d1 === MoveUp ? 12 : -12);`

In `src/seq/main-page.ts:88`, replace `setRoot(oct + pc, track);` with `setRoot(oct + pc);`. If `track` becomes unused in that function, remove the now-dead local; if it is still used elsewhere in the function, leave it.

In `src/seq/router.ts`, replace `seqNotePadReleased` (lines 388-395) with:

```ts
/* Pad note-off: drop it from the held chord and end any recording capture. The
 * track comes from the caller's ledger lookup, not seqState.watchTrack — a
 * track switch mid-hold used to send the capture-off to the wrong track and
 * leave a dangling rec_pending in the engine. */
export function seqNotePadReleased(padNote: number, track: number): void {
    const midiNote = heldChord.get(padNote);
    heldChord.delete(padNote);
    if (midiNote !== undefined && engineReady()) {
        seqCmd(`nof ${track} ${midiNote}`);
    }
}
```

In `src/app/tick.ts`:

- Add to the imports: `import { isSounding } from '../keyboard/held-notes.js';`
- Line 499, replace `const playing = activeHasNote(track, note) || keyboardState.held[p] !== undefined;` with:
  ```ts
                const playing = activeHasNote(track, note) || isSounding(p);
  ```
- Line 533, replace `const isPlaying = keyboardState.held[p] !== undefined` with:
  ```ts
            const isPlaying = isSounding(p)
  ```
- Update the comment at line 460 that names `keyboardState.held` to name the ledger instead: change `the user physically holding it (keyboardState.held)` to `the user physically holding it (the live-note ledger)`.

In `src/app/init.ts`:

- Line 4, add `import { drainAll } from '../keyboard/held-notes.js';`
- Line 41, replace `for (const k of Object.keys(keyboardState.held)) delete keyboardState.held[+k];` with:
  ```ts
    drainAll();   // fresh process: discard, do not emit — nothing sounding is ours yet
  ```
- If `keyboardState` is now unused in `init.ts`, drop its import; if `keyboardState.rootNote = 48;` still stands (it does), keep it.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/dake/git/cld/movy && npm run build:browser && node browser-test/logic.mjs && node browser-test/app-loop.mjs && node browser-test/screenshot.mjs
```

Expected: PASS, 0 failures in each. TypeScript must compile with no errors — any remaining `keyboardState.held` reference is a compile error, which is the point.

- [ ] **Step 5: Commit**

```bash
git add src/keyboard/ src/midi/router.ts src/seq/router.ts src/seq/main-page.ts src/app/tick.ts src/app/init.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
Route live note-offs through the ledger

noteOff/drumPadOff no longer take a track or a DrumConfig: both the channel
and the pitch come from what was recorded at note-on. Removes the wrong-channel
release on track switch and the stranded note when a module changes mid-hold.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Release points

Adds the four transitions that must cut live notes.

**Files:**
- Modify: `src/midi/router.ts:268-281`, `src/seq/router.ts:198-207`, `src/browser/handler.ts:55-71`, `src/mixer/track-mutes.ts:40-45`
- Test: `browser-test/logic.mjs`

**Interfaces:**
- Consumes: `releaseAllLive()`, `releaseLiveOnTrack(track)` from Task 2.
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

Append to `browser-test/logic.mjs`:

```js
/* ── release points ──────────────────────────────────────────────────────── */

_log('\nTest: mute releases only that track\'s live notes');

{
  const L = await import('../dist/esm/keyboard/held-notes.js');
  const { noteOn } = await import('../dist/esm/keyboard/handler.js');
  const { toggleMute } = await import('../dist/esm/mixer/track-mutes.js');
  const { seqState } = await import('../dist/esm/seq/state.js');

  let sentMidi = [];
  const origSendMidi = globalThis.shadow_send_midi_to_dsp;
  globalThis.shadow_send_midi_to_dsp = (msg) => { sentMidi.push([...msg]); };
  const offs = () => sentMidi.filter(m => (m[0] & 0xF0) === 0x80);

  L.drainAll();
  seqState.muted = [false, false, false, false];
  noteOn(68, 68, 0, 100);
  noteOn(69, 68, 1, 100);
  sentMidi = [];
  toggleMute(0);
  eq('mute releases the muted track', offs().filter(m => (m[0] & 0x0F) === 0).length, 1);
  eq('mute leaves other tracks sounding', L.soundingCount(), 1);
  eq('survivor is track 1', L.soundingTrack(69), 1);

  // Unmuting must not emit anything — there is nothing to release.
  sentMidi = [];
  toggleMute(0);
  eq('unmute emits no note-off', offs().length, 0);

  L.drainAll();
  seqState.muted = [false, false, false, false];
  globalThis.shadow_send_midi_to_dsp = origSendMidi;
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/dake/git/cld/movy && npm run build:browser && node browser-test/logic.mjs
```

Expected: FAIL — `mute releases the muted track` gets 0, not 1.

- [ ] **Step 3: Write the implementation**

In `src/mixer/track-mutes.ts`, add the import:

```ts
import { releaseLiveOnTrack } from '../keyboard/release.js';
```

and replace `setEngineMute` (lines 40-45) with:

```ts
/* The mirror flips optimistically so the track button dims this tick. Muting
 * also cuts any live pad note currently held on that track — mute means silence
 * now, not at pad release. Notes pressed *after* the mute still sound: playing
 * over a silenced track stays possible (see the module comment above), this only
 * stops a note that was already ringing from outliving the mute. */
function setEngineMute(track: number, want: boolean): void {
    if (seqState.muted[track] === want) return;
    seqState.muted[track] = want;
    if (want) releaseLiveOnTrack(track);
    seqCmd('mute ' + track + ' ' + (want ? 1 : 0));
}
```

In `src/midi/router.ts`, in the track-button press branch:

- Inside the `momentaryDown(d1, () => { ... })` restore closure (currently lines 268-275), add as the first statement:
  ```ts
                releaseAllLive();   // the peeked track's notes must not survive the revert
  ```
- Immediately before `appState.activeSlot = track;` (line 281), add:
  ```ts
            // Cut on switch: no live note outlives the track it was played on.
            releaseAllLive();
  ```

In `src/seq/router.ts`, in the `CC_NOTE_SESSION` down branch, add `releaseAllLive();` immediately before `seqState.sessionMode = true;`, and add the import `import { releaseAllLive } from '../keyboard/release.js';` at the top:

```ts
        if (d2 > 0) {
            sessionPrev = seqState.sessionMode;
            momentaryDown(d1, () => { seqState.sessionMode = sessionPrev; });
            // Clip Params is Track-view only: leaving for Session closes it.
            if (clipPageActive()) appState.currentView = closeClipPage();
            // Session mode swallows pad note-offs (the pad branch above returns
            // true for 0x80 too), so a pad held across the switch would strand.
            releaseAllLive();
            seqState.sessionMode = true;
        }
```

In `src/browser/handler.ts`, add the import `import { releaseAllLive } from '../keyboard/release.js';` and, in `loadSelectedModule()`, add before the `shadow_set_param(... ':module', value)` line:

```ts
    // The outgoing module is about to be torn down; its notes must be released
    // while it is still there to receive the off.
    releaseAllLive();
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/dake/git/cld/movy && npm run build:browser && node browser-test/logic.mjs && node browser-test/app-loop.mjs && node browser-test/screenshot.mjs && node browser-test/perf.mjs
```

Expected: PASS, 0 failures in each.

- [ ] **Step 5: Commit**

```bash
git add src/midi/router.ts src/seq/router.ts src/browser/handler.ts src/mixer/track-mutes.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
Release live notes on track switch, Session entry, module load and mute

Four transitions that could strand a physically-held pad note. Session mode
swallows pad note-offs outright; a module load tears down the DSP that owes
the off; mute now silences immediately instead of at pad release.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Teardown release (`onUnload`)

Fixes "close movy while it plays its sequence".

**Files:**
- Create: `src/app/unload.ts`
- Modify: `src/app/globals.ts`
- Test: `browser-test/logic.mjs`

**Interfaces:**
- Consumes: `releaseAllLive()`, `emitNoteOff(track, pitch)` from Task 2; `seqState.activeNotes` (`Uint8Array(512)`, index `track * 128 + pitch`, `1` = sounding) from `src/seq/state.ts`.
- Produces: `onUnload(): void`, registered on `globalThis`.

- [ ] **Step 1: Write the failing test**

Append to `browser-test/logic.mjs`:

```js
/* ── teardown release ────────────────────────────────────────────────────── */

_log('\nTest: onUnload releases live notes and sequencer gates');

{
  const L = await import('../dist/esm/keyboard/held-notes.js');
  const { noteOn }   = await import('../dist/esm/keyboard/handler.js');
  const { onUnload } = await import('../dist/esm/app/unload.js');
  const { seqState } = await import('../dist/esm/seq/state.js');

  let sentMidi = [];
  const origSendMidi = globalThis.shadow_send_midi_to_dsp;
  globalThis.shadow_send_midi_to_dsp = (msg) => { sentMidi.push([...msg]); };
  const offs = () => sentMidi.filter(m => (m[0] & 0xF0) === 0x80);

  L.drainAll();
  seqState.activeNotes.fill(0);
  seqState.activeNotes[0 * 128 + 60] = 1;   // sequencer gate: track 0, pitch 60
  seqState.activeNotes[2 * 128 + 67] = 1;   // sequencer gate: track 2, pitch 67
  noteOn(68, 68, 1, 100);                   // live pad note on track 1
  sentMidi = [];

  onUnload();

  eq('releases three notes', offs().length, 3);
  eq('sequencer gate t0 p60', offs().some(m => (m[0] & 0x0F) === 0 && m[1] === 60), true);
  eq('sequencer gate t2 p67', offs().some(m => (m[0] & 0x0F) === 2 && m[1] === 67), true);
  eq('live pad note t1',      offs().some(m => (m[0] & 0x0F) === 1 && m[1] === 60), true);
  eq('ledger emptied', L.soundingCount(), 0);

  seqState.activeNotes.fill(0);
  L.drainAll();
  globalThis.shadow_send_midi_to_dsp = origSendMidi;
}
```

Note: the live pad note on track 1 also lands on pitch 60 (chromatic root 48, pad 68 → 60), so the two track-0/track-1 assertions are distinguished by channel, which is exactly the property under test.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/dake/git/cld/movy && npm run build:browser && node browser-test/logic.mjs
```

Expected: FAIL — `Cannot find module '../dist/esm/app/unload.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/app/unload.ts`:

```ts
import { releaseAllLive, emitNoteOff } from '../keyboard/release.js';
import { seqState } from '../seq/state.js';
import { mlog } from '../log.js';

/* Called by the host on every teardown path — Close Movy, Shift+Back instant
 * exit, and parked-module eviction — immediately before the overtake DSP is
 * unloaded (schwung's invokeModuleOnUnload). Everything sounding has to be
 * released here: once the DSP is gone the sequencer can no longer close its own
 * gates, so its notes would ring in the chain indefinitely.
 *
 * The engine need not still be responsive: seqState.activeNotes mirrors its open
 * gates from the `act=` status field, so the UI can close them on its own. That
 * mirror is a poll snapshot, so a gate opened since the last poll is missed;
 * the host's CC 123 sweep fires right after this call and covers the residue.
 * We do not depend on that sweep for anything we can account for ourselves. */
export function onUnload(): void {
    releaseAllLive();
    let gates = 0;
    for (let t = 0; t < 4; t++) {
        const base = t * 128;
        for (let p = 0; p < 128; p++) {
            if (seqState.activeNotes[base + p] === 1) {
                emitNoteOff(t, p);
                gates++;
            }
        }
    }
    mlog('unload: released ' + gates + ' sequencer note(s)');
}
```

Replace `src/app/globals.ts`:

```ts
import { init } from './init.js';
import { tick } from './tick.js';
import { onMidiMessageInternal } from '../midi/router.js';
import { onResume } from './resume.js';
import { onUnload } from './unload.js';

Object.assign(globalThis, { init, tick, onMidiMessageInternal, onResume, onUnload });
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/dake/git/cld/movy && npm run build:browser && node browser-test/logic.mjs && node browser-test/app-loop.mjs
```

Expected: PASS, 0 failures.

- [ ] **Step 5: Verify the host actually picks the hook up**

The host harvests `globalThis.onUnload` when the module loads (`schwung/src/shadow/shadow_ui.js:3400`) and deletes it afterwards (`:3407`), so it must be assigned by the time `ui.js` finishes evaluating. Confirm it is in the bundle:

```bash
cd /Users/dake/git/cld/movy && grep -n "onUnload" ui.js
```

Expected: the built `ui.js` contains both the `function onUnload` definition and `onUnload` inside the `Object.assign(globalThis, {...})` call.

- [ ] **Step 6: Commit**

```bash
git add src/app/unload.ts src/app/globals.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
Release sounding notes on teardown via onUnload

Closing movy mid-sequence left every open engine gate ringing: the DSP is
unloaded before anything closes them. onUnload drains the live ledger and
closes the engine's gates from the UI's activeNotes mirror, so it works
without the engine still being responsive.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Immediate gate flush on engine mute

**Files:**
- Modify: `engine/crates/seq-core/src/engine.rs` (add method near `flush_gates`, ~line 536; add test in the `tests` module), `engine/crates/seq-core/src/command.rs:84-90`

**Interfaces:**
- Consumes: nothing from earlier tasks (independent of the TypeScript work).
- Produces: `pub fn flush_track_gates(&mut self, track: usize, out: &mut Vec<OutEvent>)` on `Engine`.

Cargo is not on `PATH`; use the toolchain directly.

- [ ] **Step 1: Write the failing test**

Add to the `tests` module in `engine/crates/seq-core/src/engine.rs`, next to `muted_track_is_silent_but_advances`:

```rust
    #[test]
    fn mute_flushes_that_tracks_gates() {
        let mut e = engine();
        e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
        e.tracks[1].active_mut().toggle_step(0, &[(64, 100)]);
        e.play();
        let ev = run_ticks(&mut e, 2); // note-ons fired, gates still open
        // Precondition: both tracks are actually playing, or the "untouched"
        // assertion below would pass vacuously.
        assert!(ev.contains(&OutEvent::NoteOn { track: 0, pitch: 60, vel: 100 })
                || ev.iter().any(|x| matches!(x, OutEvent::NoteOn { track: 0, .. })),
                "track 0 must be sounding");
        assert!(ev.iter().any(|x| matches!(x, OutEvent::NoteOn { track: 1, .. })),
                "track 1 must be sounding");

        let mut out = Vec::new();
        apply_batch(&mut e, "mute 0 1", &mut out);
        assert!(out.contains(&OutEvent::NoteOff { track: 0, pitch: 60 }),
                "muting flushes that track's open gate immediately");
        assert!(!out.iter().any(|x| matches!(x, OutEvent::NoteOff { track: 1, .. })),
                "other tracks' gates are untouched");

        // The flushed gate is gone, so it must not emit a second off later.
        let after = run_ticks(&mut e, 48);
        assert!(!after.iter().any(|x| matches!(x, OutEvent::NoteOff { track: 0, pitch: 60 })),
                "flushed gate does not fire a duplicate note-off");
    }

    #[test]
    fn unmute_emits_nothing() {
        let mut e = engine();
        e.tracks[0].active_mut().toggle_step(0, &[(60, 100)]);
        e.play();
        let _ = run_ticks(&mut e, 2);
        let mut out = Vec::new();
        apply_batch(&mut e, "mute 0 1", &mut out);
        out.clear();
        apply_batch(&mut e, "mute 0 0", &mut out);
        assert!(!out.iter().any(|x| matches!(x, OutEvent::NoteOff { .. })),
                "unmuting releases nothing");
    }
```

If `OutEvent::NoteOn` has no `vel` field or a different field set, the first `assert!` line's `ev.contains(...)` half will not compile — in that case delete that half and keep only the `matches!` half, which is what the assertion actually needs.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/dake/git/cld/movy/engine && PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" cargo test mute_flushes
```

Expected: FAIL — `no method named 'flush_track_gates'` is not yet the error; the test compiles but fails on `muting flushes that track's open gate immediately`, because `"mute"` only flips the flag today.

- [ ] **Step 3: Write the implementation**

In `engine/crates/seq-core/src/engine.rs`, add immediately after `flush_gates`:

```rust
    /// Release every note still sounding on one track, leaving other tracks
    /// alone. Mute uses this so silencing a track takes effect now rather than
    /// whenever the current gate happens to expire.
    pub fn flush_track_gates(&mut self, track: usize, out: &mut Vec<OutEvent>) {
        let mut gi = 0;
        while gi < self.gates.len() {
            if self.gates[gi].track as usize == track {
                let g = self.gates.swap_remove(gi);
                out.push(OutEvent::NoteOff {
                    track: g.track,
                    pitch: g.pitch,
                });
                continue; // re-examine the element swapped into this slot
            }
            gi += 1;
        }
    }
```

In `engine/crates/seq-core/src/command.rs`, replace the `"mute"` arm:

```rust
        "mute" => {
            if let (Some(t), Some(m)) = (next(), next()) {
                if (t as usize) < NUM_TRACKS {
                    let muting = m != 0;
                    engine.tracks[t as usize].muted = muting;
                    // Mute is immediate: gate countdown runs even for muted
                    // tracks (step_tick decrements before the !muted guard), so
                    // without this the note keeps ringing until it expires.
                    if muting {
                        engine.flush_track_gates(t as usize, out);
                    }
                }
            }
        }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/dake/git/cld/movy/engine && PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" cargo test
```

Expected: PASS. `muted_track_is_silent_but_advances` must still pass — it mutes before `play()`, so no gates exist and nothing changes.

- [ ] **Step 5: Commit**

```bash
git add engine/crates/seq-core/src/engine.rs engine/crates/seq-core/src/command.rs
git commit -m "$(cat <<'EOF'
Flush a track's gates when it is muted

Gate countdown runs for muted tracks, so a note muted mid-gate kept ringing
until it expired. Mute now releases that track's sounding notes at once;
unmute emits nothing.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Note-conservation assertion, docs, and full verification

The conservation check is what catches leak paths not enumerated in the design.

**Files:**
- Modify: `browser-test/app-loop.mjs`, `MANUAL.md`
- Test: all suites

**Interfaces:**
- Consumes: everything above.
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

In `browser-test/app-loop.mjs`, wrap the existing scenario driver so every note-on is matched. Add near the top of the file, after the harness imports:

```js
/* Note conservation: every note-on movy sends must be answered by a note-off on
 * the SAME channel by the end of a scenario. This is the assertion that catches
 * leak paths nobody enumerated — it does not care which transition stranded the
 * note, only that one did. */
function makeNoteLedgerProbe() {
  const open = new Map();   // `${ch}:${pitch}` → count
  const orig = globalThis.shadow_send_midi_to_dsp;
  globalThis.shadow_send_midi_to_dsp = (msg) => {
    const [status, d1, d2] = msg;
    const kind = status & 0xF0, ch = status & 0x0F, key = `${ch}:${d1}`;
    if (kind === 0x90 && d2 > 0) open.set(key, (open.get(key) ?? 0) + 1);
    else if (kind === 0x80 || (kind === 0x90 && d2 === 0)) {
      const n = (open.get(key) ?? 0) - 1;
      if (n > 0) open.set(key, n); else open.delete(key);
    }
    if (typeof orig === 'function') orig(msg);
  };
  return {
    stranded: () => [...open.keys()],
    restore:  () => { globalThis.shadow_send_midi_to_dsp = orig; },
  };
}
```

Then, in the existing MIDI/pad scenario section of `app-loop.mjs`, add a scenario that reproduces the reported bug and asserts conservation. Place it after the existing pad-play scenario, using whatever the file's own `eq`/`assert` helper is named:

```js
/* Hold a pad, switch tracks, release: the note must not outlive the switch. */
{
  const probe = makeNoteLedgerProbe();

  onMidiMessageInternal([0x90, 68, 100]);        // pad down on the active track
  onMidiMessageInternal([0xB0, TRACK_CC_BASE + 1, 127]); // switch to track 2
  onMidiMessageInternal([0xB0, TRACK_CC_BASE + 1, 0]);
  onMidiMessageInternal([0x80, 68, 0]);          // pad up, now on a different track

  eq('no note stranded by a track switch', probe.stranded().join(','), '');
  probe.restore();
}
```

`TRACK_CC_BASE` must be the constant `app-loop.mjs` already uses for track buttons; if the file spells it differently (e.g. an inline CC number), use that spelling instead. Read the file's existing track-button scenario and match it exactly.

- [ ] **Step 2: Run test to verify it passes**

```bash
cd /Users/dake/git/cld/movy && npm run build:browser && node browser-test/app-loop.mjs
```

Expected: PASS. (Tasks 2-3 already fixed this path, so this test guards the fix rather than driving it. If it fails, the release point from Task 3 is not wired into the real router path — fix that before continuing.)

To confirm the assertion has teeth, temporarily comment out the `releaseAllLive();` added before `appState.activeSlot = track;` in `src/midi/router.ts`, rebuild, and re-run: the test must FAIL with a stranded note. Restore the line and rebuild.

- [ ] **Step 3: Update the manual**

In `MANUAL.md`, add to the section covering tracks and mute (match the file's existing heading style and voice) a short note:

```markdown
**Held notes stop when the context changes.** A note played on a pad is
released when you switch tracks, enter Session mode, load a different module in
the slot, or mute that track — it never keeps ringing on a track you have left.
Playing pads over a muted track still works; muting only stops notes that were
already sounding. Closing Movy releases everything, including whatever the
sequencer was playing.
```

No screenshot assets are needed: this changes note behavior, not screen rendering.

- [ ] **Step 4: Run the full local suite**

```bash
cd /Users/dake/git/cld/movy && npm run build:browser \
  && node browser-test/logic.mjs \
  && node browser-test/app-loop.mjs \
  && node browser-test/screenshot.mjs \
  && node browser-test/perf.mjs \
  && (cd engine && PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" cargo test)
```

Expected: 0 failures in every suite. Screenshot baselines should not change; if `screenshot.mjs` reports diffs, investigate rather than blindly running `--update` — nothing here should alter the framebuffer.

- [ ] **Step 5: Run device tests**

```bash
cd /Users/dake/git/cld/movy && ssh -o ConnectTimeout=3 ableton@move.local echo ok 2>/dev/null \
  && ./scripts/test.sh && ./scripts/test-seq.sh \
  || echo "DEVICE OFFLINE — SKIPPING DEVICE TESTS"
```

`test-seq.sh` builds and deploys `dsp.so`, which Task 5 changed, so it must run. If the device is offline, report that to the user IN CAPS.

- [ ] **Step 6: Verify the teardown path on device**

With movy deployed and a sequence playing, close it and check the log for the unload line:

```bash
ssh ableton@move.local 'grep -n "unload: released" /tmp/movy.log | tail -5'
```

Expected: a line reporting the number of sequencer notes released. A count of 0 while a sequence was audibly playing means `activeNotes` was not populated — investigate before claiming the fix works. (Confirm the log path against `src/log.ts` / `scripts/test.sh`; use whatever path those use.)

- [ ] **Step 7: Commit and push**

```bash
git add browser-test/app-loop.mjs MANUAL.md
git commit -m "$(cat <<'EOF'
Add note-conservation assertion and document release behavior

Every note-on must be answered by a note-off on the same channel by the end of
a scenario — the assertion that catches leak paths the design did not enumerate.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
git push
```

---

## Self-Review

**Spec coverage:**

| Design requirement | Task |
|---|---|
| Ledger with track ownership | 1 |
| Single `emitNoteOff` exit point | 2 |
| `noteOff` loses its `track` parameter | 2 |
| `drumPadOff` reads recorded pitch, not recomputed | 2 |
| `seqNotePadReleased` uses owner track, not `watchTrack` | 2 |
| `keyboardState.held` consumers move to `isSounding` | 2 |
| Release on track switch (+ momentary revert) | 3 |
| Release on Session mode entry | 3 |
| Release on module load | 3 |
| Release on mute / solo's implicit mutes | 3 |
| Leave modal + root change rewired to drain-based | 2 (`setRoot`), 3 (router:332 in Task 2) |
| `onUnload` releases live notes + engine gates | 4 |
| Engine `flush_track_gates` on mute | 5 |
| No startup sweep | 2 (init drains without emitting) |
| Note-conservation test | 6 |
| Docs | 6 |

**Type consistency:** `LiveNote { padNote, track, pitch }` is used identically in Tasks 1-4. `drainAll()`/`drainTrack()` return `LiveNote[]` throughout. `emitNoteOff(track, pitch)` has the same argument order in `release.ts`, `handler.ts`, `drum-handler.ts`, and `unload.ts`.

**Known soft spot:** Task 6 Step 1 depends on `app-loop.mjs`'s existing track-button constant and assertion-helper names, which must be read from the file rather than assumed.
