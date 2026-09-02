# CPU meter page — design

**Status:** approved 2026-09-02.
**Gesture:** `Shift + Step 12`. **View:** `VIEW_CPU`, a fourth sibling in the
`param-page.ts` layer (Set Params / Clip Params / Settings / CPU).

## What it is

One screen: a **capacity bar** for the whole chain render, and **sixteen
columns**, one per track, showing what that track's chain costs per audio block.
No drill-down page, no per-FX-slot breakdown, no Schwung change.

## Why it costs nothing to build

The measurement is already running. `chain_cost.rs`'s `CostMeter` brackets every
chain's render on the audio thread, every block, permanently on — two vDSO clock
reads per chain, ~0.02% of the frame. `plan_ns()` is already a 1/16 exponential
mean per chain that deliberately survives `report()`, which is exactly the signal
a meter wants.

Transport is already there too: `status` is polled once every
`STATUS_POLL_TICKS = 8` (~24 Hz) through a single `get_param`, and
`SHADOW_PARAM_VALUE_LEN` is 65536. The numbers ride that poll. **No new IPC.**

## The one real performance risk

Movy's UI thread competes with the render lanes for Move's four cores, so a
meter that repaints freely would inflate the number it is displaying. The page
therefore repaints only when a **drawn pixel** would change — a `cpuSig()`
compare, the same device `mainSig()` / `clipSig()` already use — which caps it at
the 24 Hz poll and usually well below.

## 100% is one audio block, measured as wall time

`chain_slots.rs:708-716` brackets **both** render paths with the same
`add_wall`:

```rust
let t0 = self.cost.start();
let active = if self.parallel_ready() { self.render_parallel(frames) }
             else                     { self.render_serial(frames) };
if active > 0 { self.cost.add_wall(t0.elapsed().as_nanos() as u64); }
```

So one definition covers both settings of **CPU Optimize**:

- **on** — wall is the critical path across the render lanes
- **off** — wall is the serial sum

Either way it means *how much of the block movy consumed before it could
return*, which is the thing that causes a dropout. The capacity bar needs no
mode awareness, and flipping the flag visibly moves it — which is the point of
the flag.

The denominator is computed, never hardcoded: `MOVE_FRAMES_PER_BLOCK` (128)
divided by `host::sample_rate()` — 2902 µs at 44.1 kHz.

**Honest scope, for the MANUAL:** this is movy's chain render only. Move's own
engine takes roughly another 240 µs of the same block, and tracks on the Schwung
host render outside it entirely. 100% means "movy ate the whole block", not "the
device is at its limit".

## Staying representative with CPU Optimize on and off

Three things genuinely differ. None of them needs a special case in the
renderer — each falls out of the data:

| | Optimize on | Optimize off |
| --- | --- | --- |
| Chain render calls | 2 (`render_block` in external-FX mode, then `process_fx`) | 1 (`render_block` does the FX itself) |
| Silent chains | skipped — `Work::none()` | always render |
| Per-chain cost | ~27% higher under 3-lane contention (D1) | baseline |

`IdleGate::plan` returns `Work { synth: true, fx: false }` whenever
`!level.splits()`, so with the flag off the synth stage *is* the whole chain:
synth µs equals total µs and the FX segment is zero. The bar draws solid with no
branch. The same is true, correctly, for a chain whose module does not
`supports_split()`.

The header carries the mode — `CPU` or `CPU OPT OFF` — so a missing FX texture is
explained rather than mysterious. The contention inflation goes in the MANUAL, or
someone will file it as a bug.

## Bug found in the path this builds on

`render_parallel` folds the pool's per-chain cost in for every loaded chain:

```rust
for c in 0..MOVY_CHAINS {
    if self.slots[c].is_some() {
        self.cost.add_ns(c, pool.cost_ns(c));
```

`RenderPool`'s `cost_ns` is never cleared between rounds, and a deep-asleep
chain builds no `Task` at all (`if w.none() { continue; }`). So every block, a
sleeping chain re-adds **the cost it had while awake**: its mean never decays,
and the planner goes on budgeting a lane for a chain that is rendering nothing.
The serial path has the mirror-image problem — it `continue`s past the chain and
the mean freezes instead.

Fixed here because the meter cannot show a sleeping chain at zero while the
number says otherwise: a block a chain did no work in folds in **0**, so the mean
decays and recovers. This changes `plan_ns()` (better partitions for sets with
sleeping chains) and `report()` (device benchmarks measure loaded, playing sets
where nothing sleeps, so no impact there).

## Screen

128 × 64, 1-bit. Rows 60-63 are cleared every tick by the Loop Overview strip,
so `VIEW_CPU` joins the strip's exclusion list — it owns the whole screen.

```
y0..6    header      left 'CPU' | 'CPU OPT OFF'          right '<n>%'
y7       peak notch  3 px, above the capacity bar
y8..13   capacity    outlined, filled to wall/block, notch at the worst block
y17..56  plot        16 columns, x = i*8, width 7 (1 px gutter)
y58..62  labels      '1' '5' '9' '13' at 5x3, and '1MS' right-aligned
```

**Fixed full scale: 1000 µs per column.** Fixed, not auto-ranged, so a column is
comparable across sessions *and* across the CPU Optimize flag. It is round, and
it puts every chain the fleet has measured on scale — helm, the heaviest, sits
just under. **No mid-reference gridline:** a horizontal line across all columns
reads as a limit, and there is no per-track limit. The only ceiling on the page
is the capacity bar.

Per column, bottom-up:

- **baseline** — 1 px at `BOT`, always, so an unused column still exists
- **synth** — solid, height `synth_us / 1000 * HGT`
- **FX** — 50% checkerboard above it, height `(total - synth) / 1000 * HGT`
- **off scale** (`total > 1000 µs`) — a detached cap: 1 px solid at `TOP` with a
  1 px gap under it, which reads over solid and checkered alike
- **peak hold** — a dotted 1 px line at the worst block. Held for as long as the
  page is open; reset when it opens
- **asleep** (loaded, silent, Optimize on) — a 3 px dash just above the baseline,
  which is what distinguishes "costing nothing right now" from "empty"
- **not measurable** (`trackKind(i) === 'host'`) — a dotted vertical the height of
  the plot. It says *not ours to measure*, where blank would say *free*

The capacity percentage is not clamped in the text — an overrun reads `137%` —
though the bar itself fills to the end.

## Data path

Three fields appended to `status`, always emitted (no arming state to desync):

| Field | Shape | Meaning |
| --- | --- | --- |
| `chcost` | 16 × `<total>/<synth>/<peak>` comma-separated | µs per block, per chain. Total and synth are the 1/16 means; peak is the worst single block since the last reset |
| `chwall` | `<mean>/<peak>/<block>` | µs. Whole chain render, and the block period |
| `chmask` | `<loaded_hex>/<asleep_hex>` | 4 hex digits each, bit *i* = chain *i* |

~250 bytes at 24 Hz. The UI stores the three as **raw strings** and parses them
only when the page repaints, so a closed page costs three string assignments per
poll.

One new engine command, **`cpurst`**, issued when the page opens: clears the
meter's held peaks. It must not be `report()`, whose window a device benchmark
closes whenever it likes.

## Not in scope

Per-FX-slot cost (needs an upstream `chain_host.c` change), a drill-down page,
lane visualisation, history graph, LEDs mirroring load. Each is a separate,
later decision.
