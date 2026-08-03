# Capture — design

Retroactive note capture for movy, modelled on Move's own Capture (manual §14.3
and §17 "Capture"). Notes only; automation capture is explicitly out of scope.

## The behaviour Move describes

> Since tracks are automatically armed in Note Mode, you can capture notes or
> automation without needing to activate recording beforehand. […] When
> capturing notes, it is assumed that the first played note aligns with the
> start of the clip, and that all notes are meant to be included in the loop.
>
> If you capture notes into a new clip while the transport isn't running, Move
> will detect the tempo, generate three BPM estimates, and apply one to the
> entire Set. […] Note that tempo estimates are not generated when capturing
> notes during playback or overdubbing.
>
> If you play the pads […] but decide you don't want the notes […] to be
> captured, hold Shift and press the Capture button to clear the input. You can
> also clear the input by starting and then stopping transport, or by pressing a
> track button. […] the Capture button pad LED will be unlit once the input has
> been cleared.

Movy matches that, with one movy-specific addition: when the tempo is *not*
movy's to set, capture fits the take to the tempo that already exists instead of
refusing.

## Licensing

`schwung-davebox` shipped capture first, under **PolyForm Noncommercial 1.0.0**
(*Required Notice: Copyright (c) 2026 Josh Gaines*). Movy is **MIT**. PolyForm's
"Changes and New Works" clause licenses derivatives under its own terms, so a
port of davebox's capture code could not be distributed under movy's licence.

Therefore: **no davebox code is copied.** The tempo estimator here is written
from scratch, with its own scoring terms and weights, tuned against this repo's
own tests. What is shared is approach, not expression — onset-versus-grid tempo
induction is a published technique, and the user-visible behaviour comes from
Move's manual. Movy credits davebox as prior art in `CHANGELOG.md`; the credit
must not imply code reuse. If a verbatim port is ever wanted, the route is an
explicit MIT grant from the author, not a copy.

## Behaviour

The buffer is always filling: every live pad note reaches the engine already
(`non` / `nof` → `live_note_on/off`) and is pushed to a capture ring unless that
track is armed and recording, or a count-in is running — that input belongs to
the take being recorded.

The ring clears on: transport start, transport stop, track select, Shift +
Capture, a successful commit, and a **new-take gap** — 2 bars of silence at the
current tempo, clamped to 2–8 s. It is transient and never serialized.

Capture commits into the **active track's active clip**:

| Transport | Target clip | Result | Tempo | Overlay |
| --- | --- | --- | --- | --- |
| Playing | empty | First take: notes laid from the first played note, unwrapped; clip grown to whole bars covering the span | untouched | none (toast) |
| Playing | has notes | Overdub at the position each note was heard; length untouched | untouched | none (toast) |
| Stopped | empty, movy owns tempo | New clip at the chosen tempo, bar-rounded, armed, transport starts | **you pick** | selector |
| Stopped | has notes, or external clock | Take fitted to the existing tempo, minimal stretch | fixed | explanation |

"Movy owns the tempo" means no external clock is live (`ext_running`). When Move
is clocking us, our tempo is not ours to set.

### Fitting to a tempo we can't change

The estimator runs regardless. In the fixed case, the candidate **closest to the
existing tempo** is chosen and the take is written on that candidate's grid while
the transport stays at the existing tempo. The take therefore plays back stretched
by `existing / candidate`, and because the candidate set includes the half- and
double-time partners, that ratio is always the smallest available: a take played
at 58 BPM against a 120 BPM set fits through the 116 candidate (3.4% stretch),
not by doubling its length.

This unifies the engine: one `write_take(track, clip, grid_bpm, …)` for every
stopped path. The cases differ only in whether the transport tempo follows
`grid_bpm`, and whether the clip's length may change.

### Tempo estimation

Onsets are the note-on frame stamps of the frozen take, relative to the first.
Fewer than 3 onsets → no estimate; the current tempo is used and no selector
opens.

For each integer BPM in 40–250:

- `fit` — mean absolute distance from each onset to the nearest 1/16, measured
  in **beats** so fast tempos aren't flattered by their shorter grid.
- `bar_err` — how far the take's span sits from a whole number of 4/4 bars.
- `octave` — `|ln(bpm / 120)|`, a mild pull toward a comfortable tempo. Evenly
  spaced onsets fit a whole family of tempos exactly (120 quarters == 90 dotted
  eighths == 160 triplets); without this the winner among them is arbitrary.

`score = fit + 0.02 · bar_err + 0.02 · octave` — grid fit dominates, the other
two only break ties. Weights are tuned by the tests in `capture.rs`, not lifted
from anywhere.

Candidates are the distinct local minima of that curve (ratios within 1.05 count
as the same tempo, best score wins). The list handed to the UI is **exactly
three**: the best, plus its half- and double-time partners when they land in
range, backfilled from the next-best minima when they don't, sorted ascending.
Three is Move's own count, and it is what the big font affords on a 128 px
screen.

## The overlay

Full screen, movy's own chrome, shown only for a **stopped** capture. Captures
while playing report through the normal toast.

Values use the big Nokia font already used for TEMPO on the Set page — digits
advance 9 px (8 for `1`) plus a 1 px gap, so a three-digit tempo is 28 px and
three of them fit with 10 px gutters. The selected value sits in a solid white
box with its digits knocked out, the same inversion `drawHeader` uses.

Selector variant:

```
 CAPTURE               4 BARS      inverted header; bars track the tempo
    85      ███120███      170     big font; selection inverted in a solid box
 JOG PICKS TEMPO                   small font
```

Explanation variant:

```
 CAPTURE              EXT SYNC     or CLIP HAS NOTES
    117   →     ███120███
 FITTED TO SET · STRETCHED 3%
```

**Jog turn** moves the selection and applies it immediately: the engine re-derives
the frozen take at that BPM, the set tempo follows, and Move's Link tempo follows
through the existing debounced `scheduleTempoOverride()`. Playback keeps rolling
so each candidate can be heard. In the explanation variant the jog does nothing.

**Any button, pad, or knob touch dismisses**, and that press is **consumed** —
movy has no undo, and a step button that both dismissed the overlay and wrote a
note into the clip just captured would be a bad trade. There is no timeout. This
mirrors `leave-modal`, which already swallows all input while it is up.

While the overlay is open the engine holds the frozen take and suppresses new
capture pushes; closing it releases the take.

## Engine ↔ UI

New commands: `cap <track>` (commit), `capclr <track>`, `capsel <idx>`
(re-derive at a candidate), `capdone` (close, release the take).

The per-tick `status` poll gains **one** field, `cap=<pending>.<gen>`, where
`gen` increments on any commit or selector change. When `gen` moves, the UI does
a single `get_param("capinfo")` read for the details (mode, candidates, index,
detected BPM, fixed-reason, bars, stretch). The hot path stays one poll per tick.

New files, each inside the 200-line limit:

| File | Responsibility |
| --- | --- |
| `engine/crates/seq-core/src/capture.rs` | ring, frozen take, estimator — pure, host-tested |
| `src/seq/capture.ts` | overlay state, input, engine calls |
| `src/seq/capture-vm.ts` | `capinfo` → view model |
| `src/renderer/capture-overlay.ts` | pure draw, both variants |

Edits: `engine.rs` (push hooks, commit, clear points), `command.rs` (four verbs),
`movy-dsp/lib.rs` (`capinfo` get_param), `src/seq/router.ts` (CC 52),
`src/seq/buttons.ts` (LED), `src/seq/state.ts` (mirror), `src/midi/router.ts`
(dismiss intercept), `src/app/tick.ts` (draw dispatch). `ENGINE_VERSION` bumps on
both sides.

## Timing accuracy

Pad notes reach the engine batched once per UI tick (63–205 Hz), so frame stamps
carry up to one tick — 5–16 ms — of jitter. That is under 4% of a 1/16 at 120 BPM,
it is the same sampling interval live recording already has, and Shift + Step 16
quantizes. Recorded here so nobody chases it later.

## Testing

`cargo test` in `seq-core` carries the weight:

- ring: push while idle, no push while armed/counting-in, overflow drops oldest,
  gap reset, pending count per track
- clear points: play, stop, track select, explicit clear, after commit
- playing commit: overdub lands at the heard position; empty clip grows to whole
  bars; length untouched when the clip has notes
- stopped commit: applies the chosen tempo, arms the clip, starts the transport
- fixed mode: picks the candidate closest to the existing tempo, leaves the
  tempo alone, stretch ratio is the minimal one
- estimator: a synthesized 100 BPM take returns 100 as the best candidate, with
  50 and 200 as its partners; a two-note take returns nothing

`logic.mjs` covers the LED state and the overlay view model; `screenshot.mjs`
gets one baseline per variant; `perf.mjs` budget is unchanged (push is O(1), the
commit is off the render path). `test-seq.sh` gains a capture leg driven by
engine commands (`non`/`nof` → `cap`, then read `status`).

Every new test must be shown to fail with the fix removed.

## Docs

`MANUAL.md` §5 and the Controls reference tables; drop **No capture** from
§7 Limitations vs Move; a README feature bullet; `CHANGELOG.md` entry including
the davebox prior-art credit.
