# A third send bus

Built 2026-09-06, on top of the two shipped in
`2026-09-05-send-fx-and-mix-page-design.md` and the parallel send phase in
`2026-09-06-parallel-send-render.md`.

`2026-09-06-send-cost-measurement.md` §5 recommended adding sends 3 and 4. This
is send 3. Send 4 is still unbuilt, and nothing here assumes there will not be
one.

---

## 1. What actually changed

`SEND_BUSES` went from 2 to 3, in the engine and in the UI, and almost
everything followed the constant: the render slot space (`RENDER_SLOTS`), the
pin policy's index space, the `midi_out` queues, the lane planner, and the
document-slot codec were all already written over it.

The parts that were **not** written over it are the interesting ones, because
each was a place where a widening could have half-landed:

| Site | Was | Now |
|---|---|---|
| `TrackMix::send` | `[f32; 2]` | `[f32; SEND_BUSES]` |
| `MixField` | `Send1`, `Send2` | `Send(usize)` |
| `parse_mix` | 3 or 5 fields | a complete send block, any shipped width |
| `mix_csv` | always 5 fields | the shortest width carrying the truth |
| `isSendComponent` | `=== 'snd0' \|\| === 'snd1'` | derived from `SEND_BUSES` |
| `FIELD_AT` | four dense entries | holes, and the sends on line 2 |
| `MASTER_FX_SLOTS` | two SEND entries | three |

Sizing `TrackMix::send` by the constant is what turned the widening from a
search into a compile error: every hand-written tap in the tests failed to
build, which is exactly the set of places that would otherwise have kept
addressing two buses in silence.

`isSendComponent` had the same shape of hazard on the UI side, but quieter. It
listed the two keys, so `snd2` would have rendered on the master page and
browsed for a module like any slot — and then `componentPort` would have routed
its edits to a **shadow slot** instead of movy's engine. A send that loads a
module and then does nothing at all.

## 2. The MIX page layout

VOL · PAN on line 1; SND1 · SND2 · SND3 together on line 2, under encoders 5-7.

The sends are a group and read as one. Splitting them across the rows — VOL PAN
SND1 SND2 on the first, SND3 alone on the second — puts SND1 beside PAN and
invites reading the first two sends as belonging to the fader, with the third
looking like an afterthought.

`FIELD_AT` therefore has holes, and the holes are load-bearing: knobs 3 and 4
have no field, and every caller checks for `undefined` rather than trusting the
index. A knob with no field must not open an undo group, must not write the
mixer, and must not claim an automation lane.

The cells are placed by `FIELD_AT.indexOf(sendField(bus))` rather than at a
written-out index, so the page and the knob routing cannot disagree about which
encoder a send sits under.

## 3. The width rule, and why the engine writes the SHORT form

The mix value is one string — `gain,pan,muted` plus a block of send levels — and
a value the engine cannot parse is refused **whole**. That refusal is the right
call (a mix applied with a field silently dropped leaves a track at a level
nobody chose) but it has a consequence in the other direction: a set written by
this build must not become unreadable to a build with two sends. The track would
come back unmuted, at unity, with its sends gone.

So the rule is:

- **Read** any *complete* block: 0 sends (the pre-sends legacy form), 2 (every
  set written before this change), or `SEND_BUSES`. A partial block is a
  truncation — never a shape movy wrote, since the block has only ever grown as
  a unit — and is refused. So is a block *wider* than this build has buses:
  those levels have nowhere to land.
- **Write** the shortest of those widths that carries the truth, never narrower
  than two. A set stays readable by a two-send build right up until somebody
  actually turns send 3 up.

Both halves live in `engine/…/lib.rs::parse_mix` and `chain_slots.rs::mix_csv`,
and are mirrored in `src/mixer/mix-io.ts`. The engine's `mix_csv` is the one
that matters for the set file — that string is what `chain-persist` captures —
while the UI's `packMixValue` is what a knob turn writes.

The TypeScript side used to have **two** parsers of this value, in `mix-io.ts`
and `mix-persist.ts`. Rather than teach the new width rule to both, the second
was deleted: `mix-persist` now calls `isMixValue` (the strict half) and
`parseMixValue` (the lenient half) from the one codec. They could have disagreed
about whether a value was worth saving, and nothing would have caught it.

## 4. What was measured

Device, `scripts/measure-parallel-sends.sh`, three arms A/B/A′ against a 2902 µs
audio block. The harness now takes any number of FX and derives the rendezvous
as `(Σcost − max) − saved`, which reduces to the two-bus form it had before.

| loadout | serial | parallel | saved | of frame |
|---|---:|---:|---:|---:|
| dragonfly-hall + tape-echo2 | 626.8 µs | 420.6 µs | 206.3 µs | 7.1% |
| + mverb | 715.6 µs | 426.2 µs | 289.5 µs | 10.0% |
| + a second dragonfly-hall | 846.6 µs | 423.3 µs | 423.4 µs | 14.6% |

Serial arms drifted 2.8–3.9 µs between them, which is the error bar; every
saving clears it by two orders of magnitude.

Two things worth reading off that table:

- **The two-bus case did not regress.** 206.3 µs here against the 204.1 µs
  recorded before the widening — the third bus is empty, and an empty bus is
  never accumulated into, processed, or cleared.
- **The parallel column barely moves.** 420 → 426 → 423 µs while the serial
  column climbs by 220 µs. Each new bus lands on its own lane, so the phase
  costs about the slowest bus regardless of how many there are — which is the
  whole reason the third send is affordable.

The rendezvous derived to 25.0 µs on the three-bus run, landing exactly on
`render_plan::FANOUT_NS`. That constant was set from the two-bus run; a
different bus count reproducing it is an independent confirmation rather than a
restatement.

`plan=` in the three-heavy run read `1|2|0` — two `dragonfly-hall` instances on
**separate lanes**. That is correct today (the module is not blacklisted and
`chpin` is off by default) and the audio was fine, but it is the case
`chain_pin` exists for: a send module that races itself across instances needs
blacklisting, exactly as a chain module does. The containment is in place and
tested; nothing has been found that needs it yet.

## 5. Tests

Local, all green (209 movy-dsp + 291 seq-core cargo, 154 screenshots, 8 node
suites):

- `three_heavy_buses_each_get_a_lane` — asserts the **makespan**, not just the
  lane assignment. With `DEFAULT_LANES` at 2 the planner still returns a valid
  partition, and every "each bus got a lane" check would pass while the phase
  ran 584 µs instead of 354. Mutation-tested against exactly that.
- `every_per_bus_array_is_as_wide_as_the_bus_count` — the guard that was
  missing. The planning tests set `send_work` themselves, so none of them would
  notice a field left at the old width, and the failure is not always loud: a
  short cost slice would price the new bus at zero forever and the planner would
  keep stacking it onto whichever lane looked idle. Mutation-tested by narrowing
  `plan_ns`.
- `a_two_send_mix_from_an_older_build_still_restores`,
  `a_full_width_mix_carries_every_send`, `a_partial_send_block_is_refused_whole`,
  `a_mix_wider_than_this_build_is_refused` — the four corners of §3.
- `mixer.mjs` asserts the whole layout as one string (`VOL PAN - - SND1 SND2
  SND3 -`) and the pack widths. The automation-decoration assertions now address
  cells **by field** rather than by row and column, because positionally they
  would have silently started testing PAN.

Device (`scripts/test-sends.sh`, extended): a six-field mix with only the last
send raised must feed bus 2 and **nowhere else**. Bus 0 still holds a module
with its send at zero, so it is a live control rather than an empty slot that
could not have lit up anyway. An off-by-one in the parse or the tap would feed
bus 0 or 1, and every existing "a send carries audio" check would still pass
while the third knob drove the wrong reverb.

Read back: `2:in=10721,out=19225,blocks=1689` with bus 0 and 1 at zero.

`scripts/test-cpu.sh` also passed.

## 6. Still open

- **Send 4.** Nothing here blocks it; `SEND_BUSES` is the only number. What it
  costs is priced in `2026-09-06-send-cost-measurement.md` §4. The MIX page has
  the room (knob 8 is free on line 2), and the automation pool starts to get
  tight: VOL + PAN + four sends is 6 of a track's 8 lanes.
- **The send phase has no equivalence oracle.** `chain_digest` compares chain
  renders and does not reach the buses. The argument that serial and parallel
  produce identical audio is structural — disjoint buffers, pure per-bus FX,
  `finish` summing in bus order after the join — and it is a good argument, but
  it is not a measurement. Carried over unchanged from
  `2026-09-06-parallel-send-render.md` §8; a third bus does not weaken it, but it
  does mean there is now more of it unoracled.
