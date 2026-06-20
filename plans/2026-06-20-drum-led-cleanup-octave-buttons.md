# Plan: Drum LED cleanup + octave button behavior

## Goal

1. Clear leaked synth-pad colors when switching to a drum track
2. Disable octave +/− on drum tracks (silent no-op, buttons stay dark)
3. On normal tracks: flash +/− white on press, off on release

## Files to change

- `src/app/state.ts` — add `trackIsDrum(slot)` helper
- `src/app/tick.ts` — use helper; force full drum repaint on entry; darken octave buttons
- `src/midi/router.ts` — handle release; use helper; send button LEDs
- `browser-test/app-loop.mjs` — capture `setButtonLED`; 3 new test blocks

## Implementation steps (TDD order)

### Step 1 — Tests RED (app-loop.mjs)

Add to `browser-test/app-loop.mjs`:

**Test A — leak fix:** After drum re-entry, non-grid pads are Black.
- Seed `ledByPad[72] = 99` (fake stale color)
- Set `appState.drumActive = false; drumCache.fill(0)` to force re-entry
- `advance(1)`
- Assert `ledByPad[72] === Black` (0 on device = Black)

**Test B — drum octave disabled:** MoveUp on drum track doesn't shift root and button stays dark.
- Press MoveUp (`sendMidi([0xB0, 55, 127])`)
- Assert `rootNote` unchanged
- Assert `buttonLeds[55]` is 0 or undefined

**Test C — normal octave flash:** MoveUp on melodic track flashes button.
- Switch to `test8` synth (no drum config)
- Record `rootBefore = keyboardState.rootNote`
- Press MoveUp (`sendMidi([0xB0, 55, 127])`)
- Assert `rootNote === rootBefore + 12`
- Assert `buttonLeds[55] === WHITE_BRIGHT` (value from colors)
- Release MoveUp (`sendMidi([0xB0, 55, 0])`)
- Assert `buttonLeds[55] === 0`

### Step 2 — `src/app/state.ts`: add helper

```ts
export function trackIsDrum(slot: number): boolean {
    return (appState.trackModels[slot]?.[1]?.getViewModel()?.drumPadCount ?? 0) > 0;
}
```

### Step 3 — `src/app/tick.ts`: fix leak + darken buttons on drum entry

In the drum-active transition block (`drumNow && !appState.drumActive`):
1. `drumCache.fill(0xFF)` — sentinel forces repaint of all 32 pads including Black ones
2. `setButtonLED(MoveUp, Black, true); setButtonLED(MoveDown, Black, true)` — kill octave LEDs

Replace existing `isDrum` derivation to use `trackIsDrum(appState.activeSlot)`.

### Step 4 — `src/midi/router.ts`: octave button LED logic

Replace current `d2 > 0` guard with full press/release handling:

```ts
if (d1 === MoveUp || d1 === MoveDown) {
    if (trackIsDrum(appState.activeSlot)) return; // disabled on drum tracks
    if (d2 > 0) {
        changeRoot(d1 === MoveUp ? 12 : -12, appState.activeSlot, PAD_MIN, PAD_MAX);
        setButtonLED(d1, WHITE_BRIGHT, true);
    } else {
        setButtonLED(d1, Black, true);
    }
    appState.dirty = true;
    return;
}
```

Import `trackIsDrum` from `../app/state.js`. Import `WHITE_BRIGHT` from `../seq/colors.js`.

### Step 5 — Run tests GREEN, then full suite

```bash
cd movy && npm run build:browser && node browser-test/app-loop.mjs
npm test
```

### Step 6 — Device test

```bash
ssh -o ConnectTimeout=3 ableton@move.local echo ok 2>/dev/null && ./scripts/test.sh \
  || echo "DEVICE OFFLINE — SKIPPING DEVICE TESTS"
```

### Step 7 — Commit

```bash
git add src/app/state.ts src/app/tick.ts src/midi/router.ts browser-test/app-loop.mjs
git commit -m "..."
git push
```
