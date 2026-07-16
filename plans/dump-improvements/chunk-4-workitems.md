# Chunk 4 — work-item breakdown

Chunk 4 (A2 2-stage envelopes + A3 module-LFO viz + C5 detector misses) is
large and spans the model, two renderers, the VM, and docs. It is split into
five ordered work items so each lands as its own reviewable commit with its own
tests. **Full requirements live in [chunk-4-env-lfo-viz.md](chunk-4-env-lfo-viz.md)**
— this file is the execution checklist; do not restate the spec, follow it.

Workflow per item: TDD (logic test / screenshot scene fails first), keep the
model↔renderer boundary, 200-line file limit, `npm test` green, commit + push.
The envelope item (4.2) and the LFO track (4.3→4.4) both wire into
`src/model/viewmodel.ts`; run them in order to avoid churn. 4.5 closes out.

| # | title | scope (§) | primary files | depends |
|---|---|---|---|---|
| 4.1 | detector misses | C5 | `src/model/envelope.ts` | — |
| 4.2 | partial envelopes (model + render) | A2 | `src/model/envelope.ts`, `src/renderer/envelope.ts`, `src/model/viewmodel.ts`, `src/types/viewmodel.ts` | 4.1 |
| 4.3 | module-LFO viz detection | A3 model | `src/model/lfo-viz.ts`, `src/types/param.ts`, `src/types/viewmodel.ts` | 4.2 |
| 4.4 | LFO shape + deform renderer | A3 render | `src/renderer/lfo-wave.ts` | 4.3 |
| 4.5 | docs + regression refresh + device | — | `MANUAL.md`, `browser-test/dump-expect.json` | 4.1–4.4 |

> **Note (2026-07-16):** the original 4.2 (model) / 4.3 (renderer) split was
> merged — envelope detection, layout, VM plumbing and drawing are coupled
> through `planPageLayout → viewmodel → drawEnvelope` (a partial group's cell
> rearrangement changes the visible layout on its own), so they must land
> together to keep every commit green. LFO items renumbered 4.3/4.4, docs 4.5.

---

## 4.1 — C5 detector misses (`roleOf`)

Teach `roleOf`/`words` in `src/model/envelope.ts` the forms the dump shows:
- suffix noise words `ms` / `time` ignored when extracting role/qualifier
  (`v_attack`, `attack_ms`, `decay_ms`);
- `env1 a` / `env2 d` style — qualifier token (`envN`/`env`) + a bare letter
  becomes {role, qualifier=`envN`};
- `amp` / `vca` qualifiers map to the **Amp** group name (`qualName`).

Tests (`browser-test/logic.mjs`, mocks in `mock-synth.mjs`): `attack_ms`
extracts role `a` (ignores `ms`); `env1 a`-style grouping; amp/vca qualifier →
"Amp". No renderer change. Some modules may newly reach a full 4-role group —
that's expected; 4.6 refreshes the snapshot.

## 4.2 — A2 partial envelopes (model + render)

**Model.** Extend `detectEnvelopes` to emit partial groups **AD, AR, ASR, ADS**
(any qualifier group with ≥2 roles where one is `a`; keep the bare-letter-only
guard requiring all four). `EnvGroup` carries the present stages in order.
Extend `planPageLayout` to place 2-role groups in 2 adjacent cells / 3-role
groups in 3 cells on one row (reuse the 4-role rearrange path), leftovers
filling the rest of the line.

**Render.** Extend `EnvelopeVM` + `src/renderer/envelope.ts` to draw 2-vertex
(attack up, decay/release down) and 3-vertex (A + decay/plateau + release)
shapes spanning only the group's cells; the remaining cells on that line keep
their knobs. Sustain stays a level, not a time. **4-stage drawing must stay
pixel-identical** — existing envelope baselines are the regression gate.

Tests: AD detects (2 cells), AR (qualifier), ASR (3 cells), ADS; existing
4-role tests stay green; `surge` "Amp Envelope" DECAY-twice resolves to
sensible groups (decide from `sound_generator--surge.json`), with a test.
Screenshot scenes for a 2-stage and a 3-stage page; `screenshot.mjs --update`;
existing envelope scenes unchanged; `perf.mjs` green; `dump-replay.mjs --update`
for pages that newly gain/rearrange envelope lines.

## 4.3 — A3 module-LFO viz detection (model)

Extend `detectLfoViz` (`src/model/lfo-viz.ts`, split a helper if >200 lines) to
infer **module** LFO clusters by name; explicit `lfo:` config tags keep
priority. Add `'rate' | 'depth' | 'deform'` to the `KnobSlot.lfo` union
(`src/types/param.ts`, both copies). `LfoVizVM` gains only `deform?: number`
(−1..1) — no `cycles`, no `depth`. Implement qualifier grouping, the role
vocabulary checks (shape/rate/depth/phase/deform/polarity/retrigger), and the
span rule (shape + adjacent same-row: prefer rate, else phase, else depth;
multi-group per page). Off-span members keep knobs and feed the drawing live.

Tests: chordism-like (shape+rate span, saw-down→id 6); fizzik-like page → two
groups, correct spans, `target` knob untouched; osirus `Poly|Mono` does NOT set
polarity; rate/depth affect span only (assert VM carries no cycles/depth);
unmapped shape value → generic glyph, viz not dropped; explicit `lfo:` tags
still win (track-LFO page VM unchanged).

## 4.4 — A3 LFO shape mapping + deform renderer

Extend `shapeSample` in `src/renderer/lfo-wave.ts` with ids 6–10 (saw down,
noise, envelope glyph, staircase glyph, generic squiggle) — all deterministic
for screenshot stability. Apply the `deform` skew to the drawn specimen; keep
rate/depth out of the drawing (fixed 2 cycles / full amplitude). Add screenshot
scenes for a module-LFO viz page; update baselines; verify the track-LFO page
stays pixel-identical (fixed-size specimen by construction).

## 4.5 — docs + regression refresh + device verify

`movy/MANUAL.md`: extend the envelope section (2/3-stage) and the LFO viz
mention; doc assets via `node scripts/make-doc-assets.mjs <baseline>`. README
only if judged headline-worthy (likely not). Run
`node browser-test/dump-replay.mjs --update` for pages that newly gain
envelope/LFO groups and commit the refreshed `dump-expect.json`. Full
`cd movy && npm test` green. Device e2e per `movy/CLAUDE.md` when reachable
(report DEVICE VERIFICATION BLOCKED in CAPS if the MIDI-inject wedge bites).
