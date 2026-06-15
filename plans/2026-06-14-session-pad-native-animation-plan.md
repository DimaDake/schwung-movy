# Native Session-Mode Pad LED Animation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the session clip grid identically on all four tracks (grey empty-selected slots everywhere), and replace the manual JS blink with Move's native LED animation (smooth pulse) for playing, selected, and queued clips.

**Architecture:** Part A is pure logic — drop the `watchTrack` special case in `sessionPaintGrid` so every track shows its own selected slot. Part B emits Move's native LED animation by sending the LED note-on on a Push-2-style animation **channel** (`Pulse4th`=0x09 etc.) via the `move_midi_internal_send` global, replacing the per-tick `pulseOn()` toggle. A device **spike** between the parts confirms whether the hardware pulses base↔anim (two-color) or anim↔black (single-color).

**Tech Stack:** TypeScript (`src/seq/`), esbuild bundle, Node browser tests (`browser-test/*.mjs` importing `dist/esm/`), Rust engine (unchanged here), Ableton Move device.

Design spec: `movy/plans/2026-06-14-session-pad-native-animation-design.md`.

---

## File structure

| File | Responsibility | Part |
|------|----------------|------|
| `src/seq/session.ts` | Clip-grid mapping + per-cell LED state. Drop `watchTrack` gate (A); `sessionCellColor` returns `{base, anim, channel}` and `sessionPaintGrid` drives the anim setter (B). | A, B |
| `src/seq/colors.ts` | Add animation-channel constants. | B |
| `src/seq/led-cache.ts` | Add `cachedSetAnimLED` with base-handshake + native emit. | B |
| `src/seq/leds.ts` | Pass `cachedSetAnimLED` into `sessionPaintGrid`. | B |
| `src/types/schwung.d.ts` | Declare `move_midi_internal_send`. | B |
| `browser-test/logic.mjs` | Truth-table tests for the grid. | A, B |
| `browser-test/perf.mjs` | Keep the session-frame send budget assertions valid. | B |

Test commands (run from `movy/`):
```bash
npm run build:browser && node browser-test/logic.mjs      # logic — 0 failures
node browser-test/screenshot.mjs                          # unaffected — 0 failures, no baseline update
node browser-test/perf.mjs                                # send-budget assertions
```

---

## PART A — Remove the active-track special case (logic only, no hardware)

### Task 1: Grey empty-selected slot on every track

**Files:**
- Modify: `src/seq/session.ts:130`
- Test: `browser-test/logic.mjs` (the `seq session LEDs:` block, ~line 1179)

- [ ] **Step 1: Write the failing test**

In `browser-test/logic.mjs`, inside the existing `seq session LEDs:` block, add `C_DARKGREY` to the colors import line (it currently imports `C_WHITE, C_BLACK, trackColor`):

```js
    const { C_WHITE, C_BLACK, C_DARKGREY, trackColor } = await import('../dist/esm/seq/colors.js');
```

Then append these assertions just before the block's closing `resetSeqState(); resetSession();`:

```js
    // Every track shows its own selected slot — not just the watched track.
    // All four tracks default selected=0 and are empty here, so slot 0 of each
    // (notes 92,80,... ,68) must light grey, regardless of watchTrack.
    resetSeqState(); resetSession();
    seqState.watchTrack = 0;            // focus track 0
    const sel = {};
    sessionPaintGrid((note, color) => { sel[note] = color; }, 68);
    eq('track0 selected-empty grey', sel[92], C_DARKGREY); // top row slot 0
    eq('track1 selected-empty grey', sel[84], C_DARKGREY); // row 1 slot 0
    eq('track2 selected-empty grey', sel[76], C_DARKGREY); // row 2 slot 0
    eq('track3 selected-empty grey', sel[68], C_DARKGREY); // bottom row slot 0
```

(Note layout: `padToCell` maps note 68 = bottom row = track 3; rows are 8 apart, so slot-0 notes are 92/84/76/68 for tracks 0/1/2/3.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL — `track1 selected-empty grey` (and 2,3) report `0` (C_BLACK) because the current `&& track === seqState.watchTrack` clause suppresses non-watched tracks.

- [ ] **Step 3: Drop the watchTrack gate**

In `src/seq/session.ts`, change the `isSel` computation in `sessionPaintGrid` (currently around line 128–130):

```ts
        const st = seqState.session[track];
        const exists = (st.exist & (1 << slot)) !== 0;
        const isSel = st.selected === slot;
        const isPlaying = st.playing === slot;
```

Also delete the now-stale comment above it ("Only the focused track shows its selection highlight, so column 0 doesn't light white on every track.") since the new behavior intentionally lights every track's selected slot.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: PASS — all four `selected-empty grey` assertions pass; the pre-existing session-LED assertions (`playing+selected clip pulses white`, etc.) still pass.

- [ ] **Step 5: Run screenshot + perf (sanity — unaffected by Part A)**

Run: `node browser-test/screenshot.mjs && node browser-test/perf.mjs`
Expected: 0 failures in both (grid is LED-only; Part A doesn't change send counts materially).

- [ ] **Step 6: Commit**

```bash
git add src/seq/session.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
fix(seq): show selected clip slot on every session track

Drop the watchTrack gate so each track renders its own selected slot
(empty -> grey) instead of only the focused track.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## PART B — Native LED animation

### Task 2: Device spike — confirm the pulse model (MANUAL, gates Task 4)

**No code committed.** This decides which mapping Task 4 uses.

- [ ] **Step 1: Check device reachability**

Run: `ssh -o ConnectTimeout=3 ableton@move.local echo ok 2>/dev/null && echo ONLINE || echo OFFLINE`

If OFFLINE: **report "DEVICE OFFLINE — SPIKE SKIPPED" to the user in CAPS** and pause Part B. Tasks 3 and 5 (cache + typings) are model-agnostic and may proceed; Task 4 (the mapping) must wait for the spike.

- [ ] **Step 2: Probe the animation channels on hardware**

With movy open in Session mode on the device, inject native LED note-ons on animation channels over assorted base colors and watch the pads. Use the test harness pattern (`scripts/test.sh` injects MIDI; or a throwaway snippet via `shadow_send`/`move_midi_internal_send`). Send, for a few pads:
  1. base color on channel 0: `[0x09, 0x90, note, trackColorIdx]`
  2. then white on Pulse4th: `[0x09, 0x90 | 0x09, note, 120]`

Observe each pad. Answer:
  - Does it pulse **base↔white** (two-color model) or **white↔black** (single-color)?
  - Does `Pulse8th` (`| 0x08`) visibly pulse faster than `Pulse4th`?

- [ ] **Step 3: Record the result**

Append a short "Spike result (YYYY-MM-DD): two-color confirmed | single-color (white↔black fallback); rates OK?" note to the design doc `movy/plans/2026-06-14-session-pad-native-animation-design.md` and commit it:

```bash
git add movy/plans/2026-06-14-session-pad-native-animation-design.md
git commit -m "docs(seq): record session-pad LED animation spike result"
```

---

### Task 3: Animation-channel constants

**Files:**
- Modify: `src/seq/colors.ts`
- Test: `browser-test/logic.mjs`

- [ ] **Step 1: Write the failing test**

Add a new block to `browser-test/logic.mjs` (after the `seq session LEDs:` block):

```js
/* ── seq LED animation channel constants ─────────────────────────────────── */
{
    _log('\nseq anim constants:');
    const { ANIM_NONE, ANIM_PULSE, ANIM_PULSE_FAST, ANIM_PULSE_SLOW }
        = await import('../dist/esm/seq/colors.js');
    eq('NoAnimation channel', ANIM_NONE, 0x00);
    eq('Pulse4th channel', ANIM_PULSE, 0x09);
    eq('Pulse8th channel', ANIM_PULSE_FAST, 0x08);
    eq('Pulse2th channel', ANIM_PULSE_SLOW, 0x0A);
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL — `ANIM_NONE` etc. are `undefined`.

- [ ] **Step 3: Add the constants**

Append to `src/seq/colors.ts`:

```ts
/* Native Move LED animation channels (Push-2 model: the note-on's MIDI channel
 * selects the hardware animation — schwung/src/shared/constants.mjs:633). The
 * channel is OR-ed into the 0x90 status byte. The firmware does the smooth
 * gradient; we no longer toggle colors in JS. */
export const ANIM_NONE = 0x00;       // solid, no animation
export const ANIM_PULSE_FAST = 0x08; // Pulse8th — queued-to-launch (urgent)
export const ANIM_PULSE = 0x09;      // Pulse4th — playing clip
export const ANIM_PULSE_SLOW = 0x0A; // Pulse2th — selected clip (focus marker)
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/seq/colors.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
feat(seq): add native LED animation channel constants

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `cachedSetAnimLED` with base handshake

**Files:**
- Modify: `src/seq/led-cache.ts`
- Test: `browser-test/logic.mjs`

The cache must (a) dedupe like `cachedSetLED`, (b) emit native animation via `move_midi_internal_send`, (c) guarantee the channel-0 base is established before an animation message — sending base this tick and the animation next tick when the base changed (the one-tick handshake). State per note: the last base color and the last `(channel,color)` animation (or none).

- [ ] **Step 1: Write the failing test**

Add a new block to `browser-test/logic.mjs`:

```js
/* ── seq cachedSetAnimLED: native animation + base handshake ──────────────── */
{
    _log('\nseq anim LED cache:');
    const { cachedSetAnimLED, ledFrameReset, seqLedsInvalidate }
        = await import('../dist/esm/seq/led-cache.js');
    const { ANIM_NONE, ANIM_PULSE } = await import('../dist/esm/seq/colors.js');

    const sent = [];
    globalThis.move_midi_internal_send = (arr) => { sent.push(arr.slice()); };
    const tick = (fn) => { ledFrameReset(); fn(); };

    seqLedsInvalidate();              // clear cache state

    // Solid color: one note-on on channel 0.
    tick(() => cachedSetAnimLED(70, 22, 22, ANIM_NONE));
    eq('solid emits one msg', sent.length, 1);
    eq('solid status ch0', sent[0][1], 0x90);
    eq('solid note', sent[0][2], 70);
    eq('solid color', sent[0][3], 22);

    // Re-sending the same solid state sends nothing.
    sent.length = 0;
    tick(() => cachedSetAnimLED(70, 22, 22, ANIM_NONE));
    eq('unchanged solid sends nothing', sent.length, 0);

    // Animate a note whose base is already established (base 22 == last solid):
    // emits exactly one message, on the Pulse channel, with the anim color.
    sent.length = 0;
    tick(() => cachedSetAnimLED(70, 22, 120, ANIM_PULSE));
    eq('anim w/ established base = one msg', sent.length, 1);
    eq('anim status = 0x90 | channel', sent[0][1], 0x90 | ANIM_PULSE);
    eq('anim color is the target', sent[0][3], 120);

    // Re-sending the same animation sends nothing.
    sent.length = 0;
    tick(() => cachedSetAnimLED(70, 22, 120, ANIM_PULSE));
    eq('unchanged anim sends nothing', sent.length, 0);

    // Handshake: a note whose base differs from last sent emits the base (ch0)
    // this tick, then the animation on the NEXT tick.
    seqLedsInvalidate(); sent.length = 0;
    tick(() => cachedSetAnimLED(71, 7, 120, ANIM_PULSE));   // base 7 never sent
    eq('handshake tick1 = base on ch0', sent.length, 1);
    eq('handshake tick1 status ch0', sent[0][1], 0x90);
    eq('handshake tick1 color = base', sent[0][3], 7);
    sent.length = 0;
    tick(() => cachedSetAnimLED(71, 7, 120, ANIM_PULSE));   // same request next tick
    eq('handshake tick2 = anim', sent.length, 1);
    eq('handshake tick2 status = pulse', sent[0][1], 0x90 | ANIM_PULSE);
    eq('handshake tick2 color = anim', sent[0][3], 120);
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL — `cachedSetAnimLED` is not exported.

- [ ] **Step 3: Implement `cachedSetAnimLED`**

In `src/seq/led-cache.ts`, add per-note animation state, emit helper, the function, and extend `seqLedsInvalidate` to clear the new state. Insert after the existing `cachedSetButtonLED` (before `seqLedsInvalidate`):

```ts
/* Native-animation pad state: the last base color sent on channel 0, and the
 * last animation (channel + color) sent, per note. `anim === ANIM_NONE` means
 * the pad is currently solid. See colors.ts ANIM_* and the design doc. */
interface AnimState { base: number; anim: number; animColor: number; }
const lastAnimLed = new Map<number, AnimState>();

function emitLed(note: number, color: number, channel: number): void {
    // move_midi_internal_send is a shadow_ui global; absent in browser tests of
    // the device build and in DSP-less installs. Fall back to channel-0 setLED.
    if (typeof move_midi_internal_send === 'function') {
        move_midi_internal_send([0x09, 0x90 | channel, note, color]);
    } else {
        setLED(note, color, true);
    }
}

/* Paint a pad with an optional native animation. `base` is the channel-0 color
 * the hardware pulses FROM; `animColor`/`channel` is the animation target (use
 * channel ANIM_NONE for a solid `base`). When the base changes we send it first
 * (this tick) and defer the animation to the next tick — the overtake LED queue
 * keeps only one (channel,color) per note per tick, so base + anim cannot share
 * a tick. */
export function cachedSetAnimLED(note: number, base: number, animColor: number, channel: number): void {
    const prev = lastAnimLed.get(note);
    if (channel === ANIM_NONE) {
        if (prev && prev.base === base && prev.anim === ANIM_NONE) return;
        if (sentThisFrame >= FRAME_BUDGET) return;
        emitLed(note, base, ANIM_NONE);
        lastAnimLed.set(note, { base, anim: ANIM_NONE, animColor: base });
        sentThisFrame++;
        return;
    }
    // Animated: ensure the base is established first (handshake).
    if (!prev || prev.base !== base) {
        if (sentThisFrame >= FRAME_BUDGET) return;
        emitLed(note, base, ANIM_NONE);
        lastAnimLed.set(note, { base, anim: ANIM_NONE, animColor: base });
        sentThisFrame++;
        return; // animation goes out next tick
    }
    if (prev.anim === channel && prev.animColor === animColor) return;
    if (sentThisFrame >= FRAME_BUDGET) return;
    emitLed(note, animColor, channel);
    lastAnimLed.set(note, { base, anim: channel, animColor });
    sentThisFrame++;
}
```

Add the import at the top of `led-cache.ts`:

```ts
import { ANIM_NONE } from './colors.js';
```

Extend `seqLedsInvalidate` to also clear the new map:

```ts
export function seqLedsInvalidate(): void { lastNoteLed.clear(); lastButtonLed.clear(); lastAnimLed.clear(); }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: PASS — all `seq anim LED cache:` assertions pass.

- [ ] **Step 5: Commit**

```bash
git add src/seq/led-cache.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
feat(seq): cachedSetAnimLED — native pad animation with base handshake

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Declare `move_midi_internal_send`

**Files:**
- Modify: `src/types/schwung.d.ts`

- [ ] **Step 1: Add the ambient declaration**

In `src/types/schwung.d.ts`, after the `decodeDelta` declaration (line 22), add:

```ts
/* Native LED / surface MIDI: [cin, status, data1, data2]. A shadow_ui global
 * available to overtake modules; used to drive Push-2-style LED animation
 * channels. Absent in browser tests (guard with typeof). */
declare function move_midi_internal_send(data: number[]): void;
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/types/schwung.d.ts
git commit -m "$(cat <<'EOF'
types(seq): declare move_midi_internal_send global

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Wire `sessionCellColor`/`sessionPaintGrid` to native animation

**Files:**
- Modify: `src/seq/session.ts`, `src/seq/leds.ts`
- Test: `browser-test/logic.mjs` (rewrite the `seq session LEDs:` assertions)

**Mapping (Task 2 spike result):** the code below uses the **two-color** mapping
(base = track/grey/black, anim target = white). If the spike found **single-color
(white↔black)**, change only the two animated branches' `base` to `C_BLACK`
(everything else identical) — the cache and rates are unchanged.

- [ ] **Step 1: Write the failing test**

Replace the body of the existing `seq session LEDs:` block in `browser-test/logic.mjs` (keep the block + its imports; add `C_DARKGREY`, `ANIM_NONE`, `ANIM_PULSE`, `ANIM_PULSE_FAST`, `ANIM_PULSE_SLOW`) with assertions against the new 4-arg callback `(note, base, anim, channel)`:

```js
    const { C_WHITE, C_BLACK, C_DARKGREY, trackColor } = await import('../dist/esm/seq/colors.js');
    const { ANIM_NONE, ANIM_PULSE, ANIM_PULSE_FAST, ANIM_PULSE_SLOW }
        = await import('../dist/esm/seq/colors.js');

    resetSeqState(); resetSession();
    seqState.watchTrack = 0;
    // track0: slot0 exists+playing; slot1 exists (stopped); slot2 queued;
    // slot3 exists+selected (focus). track3: empty.
    sessionFromStr('0F.0.2.3,00.-.-.0,00.-.-.0,00.-.-.0');

    const cells = {};
    sessionPaintGrid((note, base, anim, channel) => { cells[note] = { base, anim, channel }; }, 68);

    // note 92=slot0, 93=slot1, 94=slot2, 95=slot3 on the top row (track 0).
    eq('playing pulses (Pulse4th) to white', cells[92].channel, ANIM_PULSE);
    eq('playing anim target white', cells[92].anim, C_WHITE);
    eq('playing base = track color', cells[92].base, trackColor(0));

    eq('stopped clip is solid', cells[93].channel, ANIM_NONE);
    eq('stopped clip = track color', cells[93].base, trackColor(0));

    eq('queued pulses fast (Pulse8th)', cells[94].channel, ANIM_PULSE_FAST);
    eq('queued anim target white', cells[94].anim, C_WHITE);

    eq('selected clip pulses slow (Pulse2th)', cells[95].channel, ANIM_PULSE_SLOW);
    eq('selected clip base = track color', cells[95].base, trackColor(0));

    // track3 slot0 (note 68): empty + selected(0) → solid grey.
    eq('empty selected grey solid', cells[68].channel, ANIM_NONE);
    eq('empty selected grey color', cells[68].base, C_DARKGREY);
    // track3 slot1 (note 69): empty, not selected → solid black.
    eq('empty unselected black', cells[69].base, C_BLACK);
    eq('empty unselected solid', cells[69].channel, ANIM_NONE);

    resetSeqState(); resetSession();
```

Note: this replaces the earlier Part A assertions in this same block (the grey-on-every-track behavior is still covered here via `cells[68]`). Keep the separate `track1/track2 selected-empty grey` assertions from Task 1 only if they still compile against the 4-arg callback; otherwise fold them into this block using the 4-arg form (`sessionPaintGrid((note, base) => ...)`).

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: FAIL — callback receives `undefined` for `anim`/`channel`; `sessionCellColor` still returns a number.

- [ ] **Step 3: Rewrite `sessionCellColor` and `sessionPaintGrid`**

In `src/seq/session.ts`:

1. Update the colors import to include the animation constants and `C_DARKGREY`/`C_WHITE`/`C_BLACK` (already imported) — final import line:

```ts
import { C_BLACK, C_DARKGREY, C_WHITE, trackColor, ANIM_NONE, ANIM_PULSE, ANIM_PULSE_FAST, ANIM_PULSE_SLOW } from './colors.js';
```

2. Delete `pulseOn()` (the `Math.floor(seqState.engineTick / 24) % 2` helper) entirely — the hardware owns the blink now.

3. Replace `CellCtx`/`sessionCellColor` with a `{base, anim, channel}` result. `blink` is gone:

```ts
export interface CellCtx {
    exists: boolean; isSel: boolean; isPlaying: boolean; isQueued: boolean;
    track: number;
}
export interface CellLed { base: number; anim: number; channel: number; }

/* Native animation: base is the solid/channel-0 color; (anim,channel) is the
 * pulse target. Priority: queued > playing > selected > content > empty.
 * Two-color mapping (pulse base->white); for the white<->black fallback set the
 * two animated `base` values to C_BLACK (see plan Task 6 header). */
export function sessionCellColor(c: CellCtx): CellLed {
    const tc = trackColor(c.track);
    if (c.isQueued)             return { base: c.exists ? tc : C_BLACK, anim: C_WHITE, channel: ANIM_PULSE_FAST };
    if (c.isPlaying)            return { base: tc,      anim: C_WHITE,   channel: ANIM_PULSE };
    if (c.isSel && c.exists)    return { base: tc,      anim: C_WHITE,   channel: ANIM_PULSE_SLOW };
    if (c.isSel)                return { base: C_DARKGREY, anim: C_DARKGREY, channel: ANIM_NONE };
    if (c.exists)               return { base: tc,      anim: tc,        channel: ANIM_NONE };
    return { base: C_BLACK, anim: C_BLACK, channel: ANIM_NONE };
}
```

4. Update `sessionPaintGrid` to the 4-arg setter and drop the `blink` local:

```ts
export function sessionPaintGrid(
    setLed: (note: number, base: number, anim: number, channel: number) => void,
    padMin: number,
): void {
    for (let idx = 0; idx < ROWS * COLS; idx++) {
        const rowFromBottom = Math.floor(idx / COLS);
        const slot = idx % COLS;
        const track = ROWS - 1 - rowFromBottom;
        const st = seqState.session[track];
        const exists = (st.exist & (1 << slot)) !== 0;
        const isSel = st.selected === slot;
        const isPlaying = st.playing === slot;
        const isQueued = st.queued === slot;
        const led = sessionCellColor({ exists, isSel, isPlaying, isQueued, track });
        setLed(padMin + idx, led.base, led.anim, led.channel);
    }
}
```

In `src/seq/leds.ts`:

5. Change the import on line 11 to pull in `cachedSetAnimLED`:

```ts
import { cachedSetLED, cachedSetButtonLED, cachedSetAnimLED, ledFrameReset, seqLedsInvalidate } from './led-cache.js';
```

6. In `seqLedsTick`, the session branch (line 150) calls `sessionPaintGrid` — change the setter argument:

```ts
        sessionPaintGrid(cachedSetAnimLED, PAD_MIN);
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: PASS — all `seq session LEDs:` assertions pass.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/seq/session.ts src/seq/leds.ts browser-test/logic.mjs
git commit -m "$(cat <<'EOF'
feat(seq): native pulse animation for session clip grid

Playing -> Pulse4th, queued -> Pulse8th, selected -> Pulse2th (all
base->white). Removes the manual JS pulseOn() toggle.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Update the perf test for the animation cache

**Files:**
- Modify: `browser-test/perf.mjs` (the session-mode send-budget block, ~line 199)

The session block mocks `setLED`. The grid now emits via `move_midi_internal_send`, so that mock must count both. Animated cells need the one-tick handshake, so a cold session frame drains over a couple extra ticks but each tick stays ≤ `FRAME_BUDGET`, and steady state still sends nothing.

- [ ] **Step 1: Update the mock to count native sends**

In `browser-test/perf.mjs`, in the block that sets `globalThis.setLED = () => { ledCount++; };` (line ~184), add:

```js
    globalThis.move_midi_internal_send = () => { ledCount++; };
```

- [ ] **Step 2: Adjust the drain expectation**

The cold-frame cap assertion (`session cold-frame LED sends per tick`, ≤50) stays valid (`FRAME_BUDGET` is 40). For the "fully drained" assertion, increase the warm-up loop so the handshake completes — change the drain loop from 4 to 6 ticks:

```js
    for (let i = 0; i < 6; i++) seqLedsTick();   // finish cold frame + handshake
    ledCount = 0;
    seqLedsTick();
    check('session LEDs fully drained (steady 0)', ledCount, 0);
```

- [ ] **Step 3: Run perf**

Run: `npm run build:browser && node browser-test/perf.mjs`
Expected: PASS — `session cold-frame LED sends per tick` ≤ 50 and `session LEDs fully drained (steady 0)` == 0. If steady-state is non-zero, the cache is re-emitting; debug `cachedSetAnimLED` dedupe before proceeding.

- [ ] **Step 4: Commit**

```bash
git add browser-test/perf.mjs
git commit -m "$(cat <<'EOF'
test(perf): count native LED sends for session animation cache

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Full local + device verification

- [ ] **Step 1: Run the full local suite**

Run:
```bash
npm run build:browser
node browser-test/logic.mjs        # 0 failures
node browser-test/screenshot.mjs   # 0 failures (no baseline change expected)
node browser-test/perf.mjs         # 0 failures
npm run typecheck                  # 0 errors
```
Expected: all green. (No `engine/` change → skip `cargo test`.)

- [ ] **Step 2: Device test (if reachable)**

Run:
```bash
ssh -o ConnectTimeout=3 ableton@move.local echo ok 2>/dev/null \
  && ./scripts/test-seq.sh \
  || echo "DEVICE OFFLINE — SKIPPING DEVICE TESTS"
```
Expected: `test-seq.sh` PASS. If offline, **report DEVICE OFFLINE in CAPS** to the user.

- [ ] **Step 3: Manual on-device check (if reachable)**

Open movy → Session. Confirm: every track's selected empty slot is grey; clips with content are solid track color; the playing clip pulses smoothly track↔white; a clip queued to launch pulses faster; all four tracks behave identically. If any cell flashes via stepped JS (not a smooth gradient), the animation channel isn't reaching hardware — recheck `emitLed`/`move_midi_internal_send`.

- [ ] **Step 4: Push**

```bash
git push
```

---

## Self-review notes

- **Spec coverage:** grey-empty-on-all-tracks (Task 1, Task 6 `cells[68]`); native pulse for playing/queued/selected (Task 6); smooth gradient = native channel (Tasks 3–4, 6); no active-track special case (Task 1, no `watchTrack` in `sessionCellColor`/`sessionPaintGrid`); spike-gated mapping + fallback (Task 2 + Task 6 header).
- **Type consistency:** `cachedSetAnimLED(note, base, animColor, channel)` is defined in Task 4 and consumed in Task 6 via `sessionPaintGrid(cachedSetAnimLED, …)` whose setter signature `(note, base, anim, channel)` matches. `sessionCellColor` returns `CellLed {base, anim, channel}` (Task 6) consumed in the same task. `ANIM_*` constants defined in Task 3 used in Tasks 4 and 6.
- **No placeholders:** every code/test step shows full content; the two-color/fallback choice is fully specified in both forms.
- **Test-only globals:** Task 4 and Task 7 set `globalThis.move_midi_internal_send`; `emitLed` guards with `typeof`, so production and tests both work.
