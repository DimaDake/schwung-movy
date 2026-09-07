# Send-bus co-location: make a send never cost more than an insert

**Status: measured, not yet built.** The measurement is in §1 and it is the
reason to build this.

`2026-09-05-send-fx-and-mix-page-design.md` §3 prices sends honestly and the
answer is uncomfortable: they only win at **N>=4** tracks, and at **N=1** they
are *"strictly worse"*. A send does 1/N the work but does it at the worst
possible moment — after every chain has rendered, alone on the audio thread,
with the other two lanes idle. So the cheapest way to use a heavy effect on one
or two tracks is currently to NOT use a send, which is not a thing a user can be
expected to know.

The goal is a property, not a percentage: **reaching for a send must never cost
more than inserting the same effect.** Then the CPU-cheapest set is also the
obvious one to build.

---

## 1. What was measured, 2026-09-07

`./scripts/measure-send-colocation.sh move.local [fx]` — twelve chains from the
benchmark fleet, all holding four-note chords, one heavy FX placed two ways on
track 0: on send bus 0, and as an insert in `ch0:fx1`.

**The insert arm IS the proposed optimisation.** Co-locating a bus with its only
feeder produces exactly the work an insert already produces: synth, then FX, in
order, on one lane. So the payoff could be measured on shipped code, before
writing any of it.

Three arms, send/insert/send', because loaded modules and settled tails survive
between arms and the two send arms are the error bar.

| FX | bus cost | send wall | insert wall | saving |
|---|---:|---:|---:|---:|
| tape-echo2 | 362.6 us | 1515.8 us | 1242.1 us | **273.7 us — 9.4% of a 2902 us frame** |
| junologue-chorus | 13.1 us | 1113.8 us | 1097.8 us | 16.0 us — inside the noise |

The heavy run's two send arms differed by **2.3 us**. The saving clears its own
error bar by a factor of a hundred.

**The result is stronger than the arithmetic predicted.** The paper figure was
`B*(1 - 1/L)` = 241 us. The measurement is 274 us, and chain 0 in the insert arm
read **460.9 us** against 41.5 us in the send arm — the insert does ~57 us MORE
total work than the bus did, and the block still finishes 274 us earlier. Doing
more work in the right place beats doing less work at the wrong time.

**The light run is the other half of the answer.** A 13 us chorus has nothing to
win and nothing to lose: send and insert cost the same. So this change matters at
the heavy end and is inert at the cheap end, which is what makes "always reach
for a send" safe advice rather than a different trap.

### What was NOT measured

N>=2 feeders. The insert trick only models N=1 — two feeders would need two
copies of the FX, which is not what co-location produces. §5's decision rule is
therefore arithmetic the planner evaluates per block, not a number claimed here.

---

## 2. The rule

**A bus may render on a lane, provided every track feeding it renders earlier on
that same lane.**

A lane is one thread running one task list in order. When the bus's turn comes,
its feeders have finished and their audio is already summed into its buffer — the
same input, at the same point in musical time, as the serial phase delivers
today. **Sample-exact, and nothing is delayed.** A chorus, a short slap delay or
a parallel blend on a send behaves exactly as it does now.

This is the whole reason the rule is stated as *co-location* rather than as a
dependency graph with wakeups: ordering inside one lane is free and needs no
synchronisation at all.

### Why the trigger fits the problem

| feeders | co-locating | sends today |
|---|---|---|
| 1–3 | easy — a small group fits on one lane | **lose to inserts** |
| 4+ | the group crowds a lane and stops paying | already win |

The cases where co-location is cheap are exactly the cases where sends currently
lose. Neither half needs the other to work, and no configuration ends up worse
than it is today.

---

## 3. What changes, in order of the block

1. **Plan** (`render_plan.rs`) — a co-located bus joins its feeders' group, so
   LPT packs `feeders + bus` as one unit and balances everything else around it.
2. **Fan out** (`chain_slots::render_parallel`) — the lane's task list becomes
   `[...feeders, bus, ...whatever else]`. The bus task is `Pre::Keep`, exactly
   as the send phase already builds it.
3. **Tap in-lane** — a feeder chain's task gains an optional list of taps
   (bus pointer + the left/right send gains). The lane runs `mix_into_gains`
   into the bus buffer straight after rendering the chain, instead of the audio
   thread doing it after the join.
4. **Join, then unchanged** — peaks, the digest fold, `mix_into` to the output,
   `idle.observe`, and `SendBuses::finish` summing buses into `out` in bus order
   all stay exactly where they are. That is what keeps the output deterministic
   and the equivalence oracle meaningful.

Buses that were not co-located run in today's send phase, with today's
`worth_fanning_out` threshold, untouched.

### `should_process` moves earlier for a co-located bus

`take_plan` runs after the chain loop because it needs `dirty`. A co-located bus
needs the decision before the fan-out, and can have it exactly: `dirty` today
means "some feeder rendered with a non-zero send gain", and both halves are
known at plan time. This is not an approximation — it is the same predicate read
one phase earlier.

A bus whose feeders are all asleep still runs on its lane, so a reverb tail
keeps ringing under `chidle` exactly as it does now.

### `in_peak` is computed by the lane

`SendBuses::accumulate` currently sets `dirty` and `in_peak` while it sums. With
the sum in-lane, `in_peak` is taken by the bus task from the buffer it was
handed — the last moment before the FX overwrites it — and folded back after the
join, the way `cost_ns` already is. `dirty` comes from the plan.

---

## 4. The race, and the replan trigger

**Only the lane owning a bus may write that bus's buffer.** The feeder set is
therefore part of the plan, and the chain plan only refreshes every
`REPLAN_BLOCKS` (1024 blocks, ~3 s).

So: bus 0 is co-located with tracks 3 and 5. A user raises track 9's send. Track
9 is on another lane and would sum into that buffer while its FX is running —
two threads, one buffer, garbage audio.

**Fix: a send gain crossing zero marks the plan dirty.** Both write points are
already funnelled through `ChainSlots` — `set_mix` and `apply_mix_lane`
(`chain_slots.rs:865-895`) — so this is a comparison at two call sites.

Only a **crossing** matters. A send ridden from 0.3 to 0.4 by an automation lane
does not change who feeds what, and must not replan every block.

The alternative — honour the stale plan and drop the new feeder's tap — is
rejected outright: it is a send knob that does nothing for three seconds, which
is a worse bug than the one being fixed.

---

## 5. The decision rule

Per bus, per plan, in the shape `worth_fanning_out` already establishes:

```
co-locate bus B  iff  cost(feeders) + cost(B)  <  makespan(plan without B)
```

If the group would become the new critical path, the bus is left in the send
phase — where it costs what it costs today. The rule is therefore a **ratchet**:
it can only lower the makespan, never raise it.

Costs bootstrap the same way the send phase's do: before a bus has rendered its
cost is zero, so the first blocks run the old path, measure, and only then
co-locate. There is no arm in which an unmeasured set commits on a guess.

Zero feeders is not a special case — an unfed bus has no group to join, and the
existing early-outs already keep it free.

---

## 6. Gating

**A flag: `chcolo`, default on.** The parallel-send work deliberately shipped
without one, because `chparallel 0` was a clean control arm for a fixture whose
chain phase was 36 us of noise. That does not hold here: this change is measured
on a twelve-chain set where `chparallel 0` moves ~1500 us of chain work as well,
so it cannot isolate co-location. Without `chcolo` the device measurement has no
control arm and every number it prints is unfalsifiable.

`chcolo` is a NEW key, so stored prefs carry no value for it and everyone gets
the default — the `FLAGS_REV` hazard in
[[project_movy-chtracks-and-parallel-default]] applies to *changing* an existing
default, not to adding a key. Verify this in `flags.ts` during chunk 1 rather
than assuming it.

---

## 7. Tests

Local first — the partition and the decision rule are pure logic and belong in
`render_plan.rs`'s own suite, beside `worth_fanning_out`'s.

| test | what fails if it is wrong |
|---|---|
| a bus lands on a lane AFTER every feeder | the FX processes a partial sum — silent, and audible only as a quiet send |
| a bus with a feeder on another lane is NOT co-located | the data race in §4 |
| the group is rejected when it would exceed the makespan | the ratchet in §5 breaks and this can make a set slower |
| zero-crossing on a send gain marks the plan dirty; 0.3→0.4 does not | the race, and a replan every block |
| an unmeasured bus (cost 0) is not co-located | committing on a guess |
| a co-located bus still runs with every feeder asleep | reverb tails cut off under `chidle` |

**The oracle already exists.** `chain_digest` compares renders arm-to-arm and
this change must be bit-identical — that is its whole claim. A digest run with
`chcolo 0` against `chcolo 1` is the correctness gate, and per
[[project_movy-render-equivalence-oracle]] it needs 3 arms and a lane-0 guard,
or a co-located plan that quietly fell back prints a tautological PASS.

**Prove the teeth**: remove the ordering constraint from the planner and the
first test must fail.

Device: re-run `measure-send-colocation.sh` with the change in, and the send arm
should now land on the insert arm's wall. That is the deliverable stated as a
number — 1515.8 us should become ~1242 us.

---

## 8. Chunks

1. **Planner + decision rule.** Pure logic, unit-tested, plan computed and
   asserted but not yet acted on. `chcolo` added and confirmed to reach a
   device with stored prefs.
2. **In-lane taps + the bus task.** The `Task` tap list, `Pre::Keep` for a
   co-located bus, `in_peak` folded back after the join. Digest gate here.
3. **The replan trigger.** §4.
4. **Measure and document.** Device run, `MANUAL.md` only if the user-visible
   advice changes (it should: "put shared effects on a send" stops carrying a
   track-count caveat).

---

## 9. Open

- **N>=2 feeders is unmeasured** (§1). The rule handles it by arithmetic; the
  first device run after chunk 2 should feed a bus from two tracks and confirm
  the planner co-locates it and the wall drops.
- **Does an inserted FX really cost ~57 us more than the same FX on a bus?**
  That was the incidental finding in §1 (460.9 vs 41.5 + 362.6) and nothing here
  depends on it, but it is unexplained and worth a look — it may be the chain's
  own FX-split bookkeeping, in which case it is a second small saving.
