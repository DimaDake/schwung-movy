# Session mixer — hold Session for 16 track faders

Status: in progress (2026-10-18). Mock approved after 7 rounds (minimal, no ticks).

## What the user gets

- Only from **latched** Session view: hold the Session button (≥ 300 ms, no
  step/pad gesture while held) → the **Mixer** opens. Release → back to Session.
  A quick tap still toggles Session → Note as today.
- Two pages, switched with the **jog wheel** like every Schwung page. Both pages
  draw all 16 tracks; the page bar in the header says which 8 the knobs drive
  (1-8, 9-16).
- Each track: a 7 px strip on an 8 px pitch (1 px gap). Stereo post-fader peak
  meter, L = 3 columns, R = 4, no gap between them. Fader = a 1 px line across
  the strip, XOR-inverted where it crosses the meter. No ticks.
- Track number under each strip (5×3 font; 10-16 draw the tens "1" as a 1 px
  stem). Holding a knob inverts that track's number in a box the strip's width,
  from the meter floor to the screen bottom; the value shows in the header
  toast — Schwung's own held-knob strip, so its padding is a parameter page's.

## Architecture (reuse, no new page machinery)

1. **Virtual component `mixer`** (`src/mixer/mixer-contract.ts`), the SP-53 seam
   Set/Clip Params use. 16 float cells `t1..t16` (fader POSITION 0..1, the MIX
   page's units and rate, `rawPerDetent: 1`), written through
   `applyMixFieldAbs(track, 'gain', …)` — the MIX page's writer, so undo,
   persistence and automation base are unchanged.
2. **Two levels**, each with 8 knobs and one `type: "canvas", as_page: true,
   page_first: true` param — Schwung's custom page: the host keeps the header,
   bank bar, held toast, jog and knob mapping; movy draws only the body.
   `createVirtualSource` grows an options bag (hierarchy, extra params,
   `canvasOnly`, `drawCanvasPage`).
3. **Grid pages hidden by navigation.** The planner always emits each level's
   knob grid next to a canvas page (measured: B = canvas, grid, canvas, grid).
   movy owns the jog order (`schwung-page-seat.ts`, plan 2026-09-30 D5), so a
   source declaring `canvasOnly` drops non-canvas pages from the order and the
   bank bar count. Upstream follow-up: a planner flag (`replaces_grid`) so the
   grid is never planned; file as a Schwung PR.
4. **Drawer** `src/renderer/mixer-view.ts`, pure: band + meter bytes + touched
   slot → pixels. The io's `drawCanvasPage` is the source's when it has one.
5. **Meters from the engine.** `chain_slots.rs` already folds each chain's
   block peak; it now folds L/R separately, post-fader
   (`TrackMix::channel_gains`), with a per-block decay (~20 dB/s) so the UI
   needs no smoothing. `status` gains `mtr=` (16 × gain/L/R dB bytes, hex),
   emitted unconditionally like `chcost` (status must stay a pure read). The
   UI parses it into `seqState.mixMeter`; drawing costs no IPC at all.
   ENGINE_VERSION bump.
6. **View** `VIEW_MIXER`, opened/closed by `seq/mixer-page.ts`; tick and router
   branches mirror VIEW_MAIN_PARAMS. Input for the page lives in
   `seq/mixer-input.ts` so `router.ts` gains only call sites.
7. **Gesture** in `router-buttons.ts`: Session press while latched arms the
   hold; the app tick opens the mixer once 300 ms pass with no gesture; the
   release closes it and stays in Session (no tap toggle).

## Tests

- Rust: L/R post-fader peak, decay, mute = 0, `mtr` encoding.
- logic: hold opens only from latched Session; tap still toggles; release
  returns to Session; step/pad gesture while held cancels; knob turn writes the
  track's gain; page 2 knob k writes track 9+k; seat hides grid pages
  (pageCount 2); status parse.
- screenshot: `mixer_p1`, `mixer_p2`, `mixer_held` (+ XOR crossing, silent
  track).
- perf: mixer frame fill_rect count / render time.

## Gates

Engine render path changes → device tier required (audio thread), plus vdev
tier and `npm test`. Docs: MANUAL.md section + controls table, README bullet.
