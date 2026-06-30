# Envelope UI — design

**Date:** 2026-06-30
**Status:** Approved, ready for implementation plan

## Goal

Replace the four round ADSR knobs (Attack / Decay / Sustain / Release) on a
parameter page with a single, visually expressive **envelope graphic** spanning
one knob line. The four parameter names stay in their normal label positions and
behave exactly like regular knobs: invert-on-touch, value-instead-of-name while
touched, and a header toast. Activation happens two ways:

1. **Auto-detection** from parameter names when a page contains a complete
   `attack / decay / sustain / release` set (under various namings).
2. **Explicit declaration** in a custom module layout JSON (for non-standard
   naming, e.g. Plaits).

## Definitions

### Envelope group
A set of **4 params on one page** recognized as roles **A, D, S, R**. Recognition
yields, per param, a `(role, qualifier)` pair:

- **role** — matched from the key (and/or label), **longest token first**:
  - attack: `attack | atk | att | a`
  - decay: `decay | dcy | dec | d`
  - sustain: `sustain | sus | sst | s`
  - release: `release | rel | rls | r`
- **qualifier** — the remainder after stripping the role token and separators
  (`f_attack` → `f`, `filter attack` → `filter`, `attack` → `""`). Normalized
  (lowercased, separators collapsed).

Params sharing a qualifier and covering **all four roles** form one group, named
by the qualifier (`f`/`filter` → "Filter", `""`/`amp` → "Amp", else the bank
name or qualifier text).

**Guards:**
- A group activates **only if all 4 roles are present**. A partial set
  (e.g. wurl's attack+decay) stays as normal knobs.
- **Single-letter** role matching (`a`/`d`/`s`/`r`) fires **only** when all four
  bare single letters appear together as a complete set on the page — otherwise
  it is too false-positive-prone and is ignored.
- A page yields **0, 1, or 2** groups (OB-Xd → 2: Amp + Filter).

### Grounding (real synths)
- **Moog** — one ADSR (`attack/decay/sustain/release`, plain names) sharing a
  page with `cutoff/resonance/contour/glide` → one envelope line + one knob line.
- **OB-Xd** — two ADSRs: **Amp** (`attack/decay/sustain/release`) on root,
  **Filter** (`f_attack/f_decay/f_sustain/f_release`) on its own level. Grouping
  keys off role keyword + qualifier prefix.
- **wurl / plaits** — only attack+decay (no S/R) → correctly stay knobs.

## Declaration path (custom layout JSON)

`KnobSlot` gains an optional role tag:

```json
{ "key": "attack", "short": "ATK", "full": "Attack", "type": "float", "env": "a" }
```

A page with four `env`-tagged slots (`a`/`d`/`s`/`r`) renders as an envelope
regardless of names. **Auto-detection and JSON tags feed the same grouping
function** — the detector synthesizes these tags at load, so there is a single
downstream code path.

## Layout

- Each group occupies **one knob line** (≈128px wide × ~15px tall).
- Remaining (non-envelope) params fill the **other line** as normal knobs.
- If a group's 4 params are scattered across both rows, they are **rearranged**
  onto one line in **A-D-S-R column order**.
- Line index follows **original param order**: the group whose params appear
  first goes on the top line. Two groups → both lines are envelopes.

## The graphic

Drawn across the **full width** of the line. The **4 label cells stay exactly
where they are** (cols 0-3 = A, D, S, R), so touch → invert → value → toast and
the automation dot reuse the existing `drawLabelCell` untouched. Only the four
knob *widgets* are replaced by the single envelope.

```
        ●peak                                      ● = bold 2x2 vertex dot
       /:\                                         : = dotted vertical
      / :  ●━━━━━━━━━●gate-off
     /  :  : sustain :\
 ●__/___:__:_________:_●____
 start  A> D>        S^ R>   baseline
```

**Per-param vertex movement (decided):**
- **Attack** → **peak** vertex moves **right** as A↑ (longer rise).
- **Decay** → **sustain-start** vertex moves **right** as D↑.
- **Sustain** → the **plateau** moves **up** as S↑ (a level, not a time).
- **Release** → the **end** vertex moves **right** as R↑.

**Geometry rules:**
- Baseline near the bottom of the line; peak at the top. ~14px usable height.
- Gate-off is a **fixed reference x** (≈¾ width) so release is always visible.
- **Bold 2×2 dots** at the four junction vertices (peak, sustain-start,
  gate-off, release-end).
- **Dotted verticals** drop from the **two plateau corners** (sustain-start and
  gate-off) to the baseline — highlighting the timing, without cluttering 15px.
- Vertices are **clamped** so segments never cross or overflow the line.

## ViewModel & rendering

- `buildViewModel` runs the grouping step, rearranges rows as needed, and adds
  `envelopeLines: (EnvelopeVM | null)[]` (length 2). Each `EnvelopeVM` carries
  `{ a, d, s, r: ParamVM }` — the **same ParamVMs already in `rows[line]`
  cols 0-3** (normalizedValue per role drives the geometry).
- `drawKnobParams`: per line, if `envelopeLines[line]` is set → draw the
  envelope graphic + the four label cells; else draw the normal knob row.
- **No change** to touch / toast / automation logic — the envelope changes only
  the widget drawing, not the label/value path.

## Apply across schwung layouts where needed

Auto-detection is movy-side and name-based, so **OB-Xd (amp + filter) and Moog
(single) light up with no schwung-repo edits**. Audit step: review every movy
config + obxd/moog; full-ADSR pages get the envelope automatically; add explicit
`env` tags only where naming would defeat the detector. wurl/plaits stay knobs
(no S/R). **No reference repos are modified** (auto-detection is runtime).

## Tests

- **logic.mjs** — detection cases: OB-Xd amp+filter grouping; Moog single;
  partial set → no envelope; synonym / short / single-letter / `f_`-prefix
  matching; scattered-row rearrange to A-D-S-R order.
- **screenshot.mjs** — new baselines: one-envelope page, two-envelope page, a
  touched ADSR cell (value shown), envelope + knobs mix.
- **perf.mjs** — assert the envelope's `fill_rect` count stays bounded.
- Device `test.sh` when `move.local` is reachable.

## Decisions flagged & approved

- (a) Per-param vertex directions as above.
- (b) Dotted verticals only at the two plateau corners (not every vertex).
- (c) Rely on runtime auto-detection rather than authoring new per-synth movy
  configs for OB-Xd / Moog.
