# Dump-improvements implementation plan (2026-07-15)

Implements everything in `docs/module-dump/IMPROVEMENTS.md` **except the
dexed operator pages** (B2/dexed — explicitly out of scope for now).

The work is split into 8 chunks. Each chunk file in this directory contains
a **self-contained prompt** to hand to a fresh Opus session working in
`/Users/dake/git/cld` — the prompt carries all context the agent needs; it
does not assume this README was read. Chunks own disjoint files wherever
possible so they can run in parallel.

| chunk | scope (IMPROVEMENTS.md §) | primary files owned |
|---|---|---|
| [1](chunk-1-hierarchy-fixes.md) | C1 preset dup, B1 chain_params fallback, C4 guessed ranges | `src/model/hierarchy.ts` |
| [2](chunk-2-shortname-dedup.md) | C2 short-name collisions | `src/renderer/shorten.ts` |
| [3](chunk-3-filter-viz.md) | A1 filter cutoff+reso graphic | new `src/model/filter-viz.ts`, `src/renderer/filter-curve.ts` |
| [4](chunk-4-env-lfo-viz.md) | A2 2-stage envelopes, A3 module-LFO viz, C5 detector misses | `src/model/envelope.ts`, `src/model/lfo-viz.ts` |
| [5](chunk-5-preset-overlay.md) | C3 preset browser overlay | `src/renderer/overlay.ts`, overlay flow in `src/model/index.ts` |
| [6](chunk-6-quick-configs.md) | B3 chordism, B4 sfz, B5 quick configs (303, chiptune, mrdrums, hush1) | new `src/modules/*.json`, `src/modules/loader.ts` |
| [7](chunk-7-per-unit-configs.md) | B2 minus dexed: signal, forge, krautdrums rhythm bank, weird-dreams master bank (stretch: euclidrum/eucalypso lanes) | new `src/modules/*.json`, `src/modules/loader.ts` |
| [8](chunk-8-dump-replay-harness.md) | D dump-driven regression harness | new `browser-test/dump-replay.mjs` |

## Launch order

Chunks merge straight to `main` (project convention). To keep merges
trivial, launch in waves; **every agent must `git pull` before starting**
and rebase before pushing.

- **Wave 1 (parallel):** 1, 2, 5, 6, 8 — disjoint primary files.
- **Wave 2:** 4, then 3 — both wire into `src/model/viewmodel.ts` and
  `src/renderer/label.ts` (`drawKnobRow`), so run them sequentially
  (4 first: it only extends existing detectors; 3 adds a new viz channel).
  7 after 6 (both edit `src/modules/loader.ts`).

Chunk 8 encodes layout expectations from the checked-in dump; running it in
wave 1 gives later chunks a regression net, and later chunks are told to
update its expectations when they intentionally change layouts.

## Shared context every prompt repeats

- Dump data: `movy/docs/module-dump/` (`SUMMARY.md`, `IMPROVEMENTS.md`,
  `device-dump.json`, `modules/<category>--<id>.json`).
- Workflow: local suites (`npm test`) must pass; device e2e
  (`./scripts/test.sh`) when reachable; commit + push.
- Device caveat at plan time: the Move's MIDI-inject channel was wedged
  after the dump run (zero-byte MIDI flood; needs user restart). If device
  checks fail with no CC delivery, report DEVICE VERIFICATION BLOCKED in
  CAPS rather than chasing it.
