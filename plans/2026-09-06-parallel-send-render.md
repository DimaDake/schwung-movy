# Parallel send-bus rendering

Built 2026-09-06, on top of the costs measured the same day in
`2026-09-06-send-cost-measurement.md`. That document recommended *skipping*
this and adding sends 3 and 4 instead; the ask here was the other half —
optimise for heavy send FX, which is exactly the case where its own §3 table
says fanning out pays (207 µs, 7% of the frame, for two heavy reverbs).

**Status: shipped and measured on device.** Two heavy reverbs: **630 µs serial
→ 424 µs parallel, 206 µs saved, 7.1% of the frame** — the paper prediction in
§3 of the cost doc was 207 µs. Harness: `scripts/measure-parallel-sends.sh`.

---

## 1. What it does

The send phase used to be serial by construction and serial in fact. It is
still serial *by construction* — a bus is a sum of tracks, so it cannot start
until every chain has rendered — but the buses no longer wait on each other.
They are partitioned onto the existing render pool's lanes, run together, and
summed into the output afterwards in bus order.

Nothing new was built to do it. The chain phase's pool, planner and pin policy
all carry the send phase too; the phases differ in three things and nothing else:

| | chain phase | send phase |
|---|---|---|
| input | the synth renders it | already in the buffer (`Pre::Keep`) |
| partition refresh | every `REPLAN_BLOCKS` (~3 s) | every block |
| fans out when | always | only when it beats the wake |

## 2. `Pre::Keep` — the one real hazard

`Task.render: Option<fn>` meant "run the synth, or zero the buffer". Both
readings are right for a chain: a sleeping synth owes its FX silence to decay
into, not last block's audio. Both are **wrong for a bus**, whose buffer already
holds the sum every track fed it. A lane that zeroed it would hand the reverb
128 frames of nothing, every block, and the only symptom would be a send that
never sounds.

So the field is now an enum with three cases rather than an `Option` with two,
and the two "no synth ran" cases are named apart. `a_keep_task_gives_its_fx_the_buffer_it_was_handed`
covers both a lane-0 and a helper-lane bus; restoring the zero-fill fails it.

## 3. The threshold — why this cannot regress

A fan-out costs ~25 µs of scheduler wake whatever it is fanning out (§6 below;
the chain work's standalone figure was 21 µs). Two cases in the measured range
lose against that:

- **one bus running.** It overlaps with nothing, so the makespan *is* the
  serial cost and the wake is pure loss. This is the common case: two sends
  loaded, one being fed.
- **a heavy bus beside a nearly-free one.** The phase is busy — 354 µs + 10 µs
  — but only 10 µs of it can be hidden.

`render_plan::worth_fanning_out(serial, makespan)` decides, and the send phase
plans every block so the answer follows what is actually running rather than
what was running three seconds ago. Below the margin the whole phase collapses
onto lane 0, which *is* the serial path: same calls, same order, no wake.

Two consequences worth stating plainly:

- **The costs bootstrap.** Before a bus has rendered its cost is zero, so the
  first blocks run serial, measure, and only then fan out. There is no arm in
  which an unmeasured set fans out on a guess.
- **A marginal pair does fan out.** midiverb + freeverb is 93 µs serial against
  a 48 µs makespan: 20 µs net, which the cost doc calls noise. The rule allows
  it because the arithmetic allows it. Tightening the constant until that case
  fell the other way would be fitting the rule to an opinion, so it is not
  tightened — see `a_marginal_pair_is_decided_by_the_arithmetic_and_not_by_taste`.

## 4. Two buses, one module

The cost doc never raised this and it is the change's only *correctness* risk.
Two buses holding one module through one file share its whole `.data` — exactly
the hazard `chain_pin` exists to contain for chains, and until now the pin
policy could not see a send at all: it was sized `MOVY_CHAINS`, so the send
loads that already ride the shared load queue at slot `MOVY_CHAINS + bus` were
dropped by its bounds check.

The index space is now `RENDER_SLOTS = MOVY_CHAINS + SEND_BUSES` throughout —
pin keys, the pool's per-slot costs, and `midi_out`'s parked-MIDI queues (a send
FX that emits from `process_fx` needs the same single-producer parking a chain
gets, and gets a second drain after the send join). `send_index(bus)` is the one
formula; four things read it.

A chain and a send sharing a module costs nothing: the phases never overlap in
time, and the send planner is handed only the send slice of the keys. Both
directions are pinned by tests — including the slice offset, which is the kind
of mistake that silently splits a pinned pair.

## 5. Gating

**No new flag.** It rides `chparallel`, which is already on by default and
already stored in `prefs.json`. A new flag would need the `FLAGS_REV` dance to
reach anyone with stored prefs (`project_movy-chtracks-and-parallel-default`),
and `chparallel 0` is already the control arm — with one synth playing at 36 µs
of chain render, an A/B of that flag on the send fixture is an A/B of the send
phase.

`chlanes 1` remains a second falsifier: one lane, so the makespan always equals
the serial cost and the phase can never fan out.

## 6. Reading it back

A parallel send phase sounds exactly like a serial one and reports identical
per-bus costs — that is the point of it. So `sndlog` now ends with
`par=<0|1> plan=<lane0>|<lane1>`: the arm, and the partition it ran. Both,
because a fanned-out phase whose buses all landed on lane 0 is a serial phase
wearing the flag. Without this every number the harness prints would be
unfalsifiable.

## 7. Measured, 2026-09-06

`./scripts/measure-parallel-sends.sh` — dragonfly-hall on bus 0, tape-echo2 on
bus 1, one synth held on track 0, three arms:

| arm | wall | `par=` | plan |
|---|---:|---|---|
| serial | 631.9 µs | 0 | `1\|0\|` |
| parallel | 423.5 µs | 1 | `1\|0\|` |
| serial′ | 628.2 µs | 0 | `1\|0\|` |

**206.5 µs saved, 7.1% of the frame**, against a 3.7 µs drift between the two
serial arms. The prediction was 207 µs. The partition is the expected one: the
heavier bus (tape-echo2, 353.7 µs) on lane 0 and dragonfly-hall (231.7 µs) on
lane 1.

### The send-path rendezvous is 25 µs

The one number the cost doc could not supply — it carried 21 µs over from the
chain work, with no send-phase rendezvous yet built. It falls out of the same
run without extra instrumentation, because the callback's other costs cancel:

```
serial   = C + A + B            C = chain render + the rest of the callback
parallel = C + max(A, B) + F
F        = min(A, B) - (serial - parallel) = 231.7 - 206.5 = 25.2 µs
```

`render_plan::FANOUT_NS` now holds 25 µs rather than the carried-over 21. It
moves the threshold the conservative way, and the harness prints the derivation
on every run, so a future change to the pool that makes the wake more expensive
shows up as an arithmetic disagreement rather than as a quiet loss.

## 8. What is still open

- **Send-phase equivalence is argued, not oracled.** `chain_digest` compares
  chain renders across arms; it does not reach the buses. The argument that
  parallel and serial produce the same samples is structural — the buses are
  disjoint allocations, each FX is a pure function of its own buffer, and
  `finish` sums them in bus order after the join, never in the order the lanes
  completed — plus flush-to-zero being set per helper thread, without which the
  two paths would compute different denormals. That is a good argument and it is
  not a measurement. Extending the digest to fold the bus buffers is the way to
  make it one.
- **Sends 3 and 4.** Not built. The partition is written over `SEND_BUSES` with
  no assumption of two, so the phase itself needs no work — the remaining cost
  is the mix value, the `MixField` variants and the MIX page, as
  `2026-09-06-send-cost-measurement.md` §5 describes. §4 of that document is
  the argument for doing it: four heavy sends serial is ~1170 µs, and fanned
  out ~380 µs.
