# SP-39 — a page change on a drum track is slower than movy's was

## The reproduction

On a drum track, a pad press switches the page to that voice's page. Under
`page` (device flag `prefs.flags.schwunggrid = 2`) the switch is reported as
noticeably slower than under `off` (flag `0`), where movy draws the page itself.
The gesture is the most-used one on a drum track, so the complaint is about a
gesture, not a frame rate.

**The rack this is measured on.** `cw78` — one of the four modules whose
`movy_config.json` declares `pad` on its banks (6w6 / 8w8 / 9w9 / cw78), so it is
the shape SP-14 translates into a hierarchy with a `note` per bank and therefore
the shape that has voices at all. Loaded on a movy chain with
`node scripts/engine-param.mjs set ch0:synth:module cw78 move.local`.
`mrdrums` (the device fixture's drum module on track 1) is NOT a rack under this
definition — its hierarchy declares no `child_note_base`, so `voicesOf` returns
zero voices and a pad press follows no page at all. Measured, not assumed:
`schwung-body ok track=0 ck=synth pages=18 at=0` on the preflight, and
`drumPad note=71 pad=4` → `... at=4` on the gesture.

Left-half pads only (`drumPadOfPhys` returns -1 for `col >= DRUM_COLS`), so the
press is note 71 (pad 4, "Hi Hat") and the alternating press is note 68 (pad 1).
Both change the page, so every press in a section is a real page change.

## What is measured, and why that instrument

`perf_phase` / `perf_ipc` (`src/app/perf-probe.ts`), which the entry names. One
`perf_ipc` and one `perf_phase` line per 120-tick window; every figure is a mean
over the window in ms, at `Date.now()`'s 1 ms granularity.

The pad press is handled in `onMidiMessageInternal`, which the host runs BEFORE
`tick`, so a synchronous cost at the press is NOT inside any existing phase — it
lands in the gap the `perf_ipc` line reports as `period_ms` / `peak_period`. A
cost paid over the following ticks (the "arriving page fills one cell a tick"
shape) WOULD land in `ctlpoll` (Schwung's controller tick) or `knoblevels`
(movy reading the eight cells back), which is what that split exists to
separate.

One phase is therefore added, `padpage`, around the two adjacent page-follow
calls in `src/midi/router.ts` — movy's own `selectBankForPad` and Schwung's
`focusVoice`. Both arms carry the same build, so both arms measure the same
code region; only the device flag differs. Without it a `page`-only cost would
be visible only as a `peak_period` spike against a noisy 12-32 ms baseline.

## Measurement, before any fix

`scripts/measure-pad-page-latency.sh off|page`, sections `idle` and `press`:

- `idle` — the floor (nothing injected).
- `press` — 12 alternating presses, 250 ms apart, so several land in each
  120-tick window.

Both arms, same module, same build, device flag the only difference.

## The three suspects, and what the numbers said

**Suspect 1, and the measurement names it.** cw78 on track 0, both arms, same
build, the flag the only difference. Window medians:

| section | arm | calls/tick | ipc_ms | tick_ms | period_ms | peak_period | `mget ch0:*` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| idle | off | 0.6 | 1.2 | 1.7 | 4.8 | 14 | — |
| press | off | 0.6 | 1.4 | 1.8 | 5.0 | 13 | — |
| idle | page | 1.3 | 3.3 | 3.2 | 6.0 | 14 | n=0.4 ms=0.9 |
| press | page | **1.7** | **4.0** | **3.65** | **6.55** | **20.5** | **n=0.55 ms=1.2** |

Under `off` the same gesture costs **nothing** (every figure within 0.2 ms and
`peak_period` actually falls). Under `page` it costs +0.4 calls/tick, +0.7 ms of
IPC, +0.45 ms of tick, and **the worst frame in the window goes 14 → 20.5 ms**.

`mget` is `host_module_get_param` — a SINGLE-key read, one blocking round trip,
~2.3 ms on this chain (`ms` ÷ `n`). `bget` is `shadow_get_params`, the bulk
channel. The rise is **+0.3 single reads per tick = +36 a window ≈ +83 ms**,
which is the whole of the `ipc_ms` rise — and it is concentrated in the reads
for cells that were not on screen before the press.

**Suspect 2 is real but small, and the instrument says so.** `padpage` — the
synchronous half, `selectBankForPad` + `focusVoice` + the controller's
`goToPage` — cleared the six-phase cutoff in **one** window at 0.2 ms/tick, i.e.
~24 ms accumulated, which is one page's worth of reads at ~2.3 ms each. So the
press blocks for ~20 ms once, and then the window stays expensive for the rest
of its ticks.

**Suspect 3 is not in the numbers.** Under `off` the gesture is free and under
`page` it is not, and "no frame until something moves" is a property of both.

**The mechanism, read after the measurement named it.** `goToPage` calls
`warmCurrentPage()` synchronously (`page_controller.mjs:3213`), which asks for
every key of the arriving page it does not already hold — up to eight, one
`getParam` at a time, stopping at the first failure. Those asks land in movy's
`io.getParam` → `schwung-page-cache.get`, and **a key the cache has never seen
is never prefetched**: `batchKeys()` iterates `entries`, and a key enters
`entries` only by being asked for. So the first read of every cell of a new page
is a live single round trip, and `warmCurrentPage` pays all eight at the press.

## The fix

`schwung-page-cache.ts` gains `warm(keys)`: one `port.getMany()` — ONE bulk
round trip — for a set of keys the cache has not read yet, seeded at the current
epoch so the controller's asks are hits. `focusVoice` reaches the page through a
new `jump(i)` helper (`schwung-page-input.ts`) which hands the target page's keys
over **before** `ctl.goToPage(i)`, because that is the one moment movy knows
which page is arriving and has not yet asked for it. The keys are qualified the
same way `io.getParam` qualifies what the controller asks for, or the warm covers
keys the reads never look up.

Not a change to Schwung's behaviour: it still asks one key at a time, and `warm`
is the cache's own half of the same contract (SP-26), so this is movy's file and
not an upstream PR.

## Files

- `src/midi/router.ts` — the `padpage` phase (instrumentation only).
- `scripts/measure-pad-page-latency.sh` — the A/B harness.
- `src/renderer/schwung-page-batch.ts` — new; the batch policy (`fill`, and
  `warm`), split out of the cache so both files stay under the 200-line cap.
- `src/renderer/schwung-page-cache.ts` — the epoch, and `warm`.
- `src/renderer/schwung-page-input.ts` — `focusVoice` warms its target page.
- `src/renderer/schwung-page.ts` — the wiring.

The cache came out at 143 lines and the batch file at 122, so the write-log
drain stayed where it was: the split happened because `warm` gave the batch
policy a second caller, not to reach a line count.

## Tests, and their teeth

- `browser-test/logic/schwung-page-press.mjs` — new; the round trips a pad press
  costs, counted with the harness's own counter across a `focusVoice` onto a
  page the session has never read. That is the check the entry names.
- `browser-test/logic/harness.mjs` — `countTripKinds`, the same counter returning
  bulk and single separately. The split is the point: `warm` does not shrink the
  total by accident, it moves the page off the single-key channel, and a total
  alone cannot tell the difference between that and a page that got cheaper for
  another reason. `countTrips` is now a two-line wrapper over it, so the existing
  callers are unchanged.

The test lives in its own module because `schwung-page.mjs` is at the
browser-test line ceiling (631 with this block in it, 552 without).

Teeth, measured: with the `warm` call replaced by `void keys`, the jump is
**0 bulk / 9 single** and both new assertions are red (`expected 1, got 0` and
`expected 1, got 9`); restored, it is **1 bulk / 1 single** and green.

## What is NOT covered

- The nine reads are what the fix removes; the ONE single that remains is
  `focusVoice`'s own contract lookup (`ui_pages`, rung 2, unserved and therefore
  uncached — a null is never cached), and the test asserts it is 1 rather than 0
  so a second one appearing is visible.
- The mock serves a value for every cell of every page. A module that answers
  `""` for one of them is the same shape (an empty string is a real answer and is
  cached); a module that answers `null` stops Schwung's walk at that key, which
  is what the mock deliberately does not do.
- The `padpage` phase in `src/midi/router.ts` is instrumentation and stays: it is
  what told suspect 2 apart from suspect 1, and it is how this is re-measured.

## Closure evidence, as measured

`scripts/measure-pad-page-latency.sh`, `MODULE=cw78 TRACK=0`, both arms, same
build, the flag the only difference (ms/tick averaged over the probe's 120-tick
window):

| section | arm | calls/tick | ipc_ms | tick_ms | period_ms | peak_period | `padpage` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| idle | off | 0.6 | 1.0–1.4 | 1.6–1.8 | 4.7–5.0 | 16 | — |
| press | off | 0.6–0.7 | 1.2–1.5 | 1.5–2.0 | 4.8–5.1 | 15 | — |
| idle | page | 1.3–1.4 | 3.0–3.5 | 3.1–3.4 | 6.0–6.3 | 23 | — |
| press | page | 1.3–1.7 | 3.1–3.9 | 3.1–3.8 | 6.0–6.8 | 27 | **0.1–0.2** |

The fix is in the `page` arm's press window: `padpage` — the synchronous half,
`selectBankForPad` + `focusVoice` + `goToPage` — is 0.1–0.2 ms/tick there and
does not exist under `off`. The remaining page-vs-off gap (worst period 6.8 vs
5.1, 1.7 vs 0.7 calls/tick) is present at IDLE too and is the delegated
renderer's standing cost, not the gesture: 6.3 vs 5.0 ms.

- The minijv re-run (`MODULE=minijv SECTIONS="idle knob"`, 70 pages — the
  default five sections come back INVALID on a 70-page component because a
  10-detent jog walks the CHAIN, not off a small component): the animating window
  costs **`render = 0.2 ms/tick` in one window**, worst period 5.7–6.1 → 6.4. So
  SP-38's cost does not scale with page count.
- The module count is **70, not 72** — read back as
  `schwung-body ok track=0 ck=synth pages=70` and confirmed by
  `docs/module-dump/params-exposure-audit.md:106`; the ledger's and
  `measure-grid-cost.sh`'s 72 is stale and was corrected.
- `npm test` 0 failures, `page-mode.mjs` still `3 of 3`, device tier with the
  flag at `off` and restored to `2` afterwards.
