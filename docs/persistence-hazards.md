# Persistence hazards

What we learned on 2026-09-11 while migrating the device tests. Two bugs are
fixed, two are open and pinned by tests. Everything here was measured, not
reasoned about — where a claim is *not* established, it says so.

---

## 1. The shape of the problem

Movy's engine has no filesystem. The UI ferries every byte of a Set into it
through `host_module_set_param_blocking('state', …)`, which lands in the
**`overtake_dsp` param SHM — a single slot**.

`CLAUDE.md` already recorded the consequence: writes into that slot are
*"routinely lost"*. Four producers share it (the shim, shadow_ui, the chain
forwarder, the test daemon), plus the remote-UI WebSocket on port 7700.

Everything below follows from that one fact: **a write into this slot is not
reliable, and a read of it competes with everyone else's writes.**

### The observer effect

Reading the slot while movy is restoring a Set does not merely slow the restore
down — it **starves** it. The restore's own writes are lost, not delayed.

Measured: an automation registry that came back EMPTY on roughly half of
reopens, from a blob that demonstrably held both lanes (`au=2` on disk). The
same sequence with no param traffic in the window: clean every time.

This is why `test-device/device.ts`'s `open()` waits for movy's `seq: set ready`
log line **over SSH** instead of polling a param. A probe-driven readiness gate
was tried first and made it worse, because the gate is itself param traffic.

**Rule for anything that observes movy: do not touch the param SHM while a Set
is being restored.** Out-of-band signals (the log, `STATE`, `WAIT_FRAME`) are
free; param reads are not.

---

## 2. FIXED — a dropped restore used to cost the whole Set

`set-load.ts:pushState` discarded the boolean that
`host_module_set_param_blocking` returns. A Set that never reached the engine
therefore looked exactly like one that had.

The next autosave then read the engine's **blank but valid** state and wrote it
over the real Set, at a **higher generation** — so the blank won every later
restore too.

Reproduced in a host test, no device needed: a Set holding an automation lane
and a clip became `"movy1\n"`.

**Fix.** `pushState` now retries (one loss says nothing about the next attempt —
the same reasoning the device fixture uses for module loads) and reports the
outcome. `restore-gate.ts` carries that one fact to `set-save`, which refuses to
overwrite a Set it knows the engine never took.

**The fix's own risk was the opposite loss.** A gate that wrongly blocks saving
is a session that dies in RAM. So the closed gate is narrow and tested from that
side too:

- a landed restore saves as usual;
- a blocked save stays **pending**, not forgotten;
- the gate **reopens** as soon as a restore lands, and the pending save runs;
- a host with no blocking API still saves — *unknown must never mean blocked*.

The gate is the **first** thing `saveSet` does, above the UI-blob write as well:
`serializeUiState()` calls `readChainDoc()`, an engine GET, so the movy chains in
`ui-state.json` come from the same engine and are lost the same way.

Covered by `browser-test/logic/set-restore-loss.mjs`.

---

## 3. OPEN — an unreadable chain set blanks the chains

`chain-persist.ts` states the rule itself:

> *"A malformed answer is not an empty set. Reading it as one would hand the
> autosave a set with no chains and delete the user's work."*

The line beneath that comment returns `[]` for **both** a failed read and a
genuinely empty chain set. So an unreadable read blanks the chains in
`ui-state.json`.

**The obvious guard is wrong.** Making `serializeUiState()` refuse when the read
is unknown was tried and reverted: it also fires whenever an engine simply does
not answer the `chains` key, which blocks the UI write outright — it broke the
`mute-solo` suite immediately. *"Unknown blocks forever"* is the same class of
loss the guard is meant to prevent.

A correct guard has to be narrower. Candidate shapes, none validated:

- refuse only when a **previous** read on this Set returned chains (we know it
  has some, so `[]` now is suspicious);
- keep the last successfully-read chains and re-serialize those on an unknown
  read — never blocks, but can resurrect a chain the user removed;
- distinguish "the engine does not implement `chains`" from "the engine failed
  to answer", which `decodeBulk` currently collapses into one `null`.

Pinned as a KNOWN GAP assertion in `set-restore-loss.mjs` — it encodes the bug,
not the desired behaviour, so the gate stays green. **Flip it when fixing; do
not delete it.**

---

## 4. OPEN — a save that runs before the chains have loaded

Distinct from §3, and the cause of what we actually saw on device:
`ui-state.json` collapsing from **5141 bytes to 217**, holding `"chains":[]`.

Here the read **succeeds** and truthfully reports no chains. `restoreChains`
only QUEUES the module loads and the engine releases one per audio callback, at
78–276 ms each, so a full Set's instruments arrive over seconds. The autosave
simply runs before they land and records the truth of that moment.

`set-settle.ts` exists to wait exactly this out before declaring the session
playable — but **the save is not gated on it**. That is the likely fix, and it is
session sequencing rather than a serializer guard, so it is a larger change than
it looks.

Not pinned by a test yet. An earlier reading of this as the same bug as §3 was
wrong.

---

## 5. What already protects you

Worth knowing before adding more guards — these work, and are now covered so
they cannot regress:

| guard | where | what it catches |
| --- | --- | --- |
| a `null` read of `state` is never written | `set-save.ts` | an engine we could not read at all |
| `engineGeneration() !== loadedGen` | `set-session.ts` | saving into a *different* engine instance after a reload |
| legacy canonical with real content beats any shadow | `persist-store.ts` | a downgrade-then-return, which generation ordering would silently undo |
| version history rides each successful save | `version-capture.ts` | makes a bad overwrite recoverable — 32 versions per Set |

The last one matters for triage: even when a Set is blanked, the user's music is
usually still in the version ladder. But note that **before** the §2 fix, a blank
save rode into that history too, so repeated blanks would erode the ladder
itself.

---

## 6. The restore precedence rule

Reading order in `persist-store.ts:readBestState`, which surprises people:

1. If the **canonical** file is *legacy* (no `gen` line) **and** has real
   content, it wins outright — whatever generation the shadows carry. This is
   deliberate: such a file was written by a build predating the envelope, and
   ordering it by generation would restore a pre-downgrade Set over the user's
   later work.
2. Otherwise the highest generation among canonical, `seq-state.1.json` and
   `seq-state.2.json` wins.

Consequence for tests: the device fixture writes a **legacy** blob, so it wins —
until movy saves once, after which the canonical is wrapped and the shadows
compete normally.

---

## 7. Not established

Stated plainly so nobody inherits a stronger claim than the evidence supports:

- **We have not measured how often this happens in normal use.** Every
  reproduction here used the test daemon as the competing producer. Whether
  ordinary schwung activity or an open remote-UI wins the same race is unknown.
- The §3 and §4 fixes are described as *candidates*. Neither has been built.
- §4 has no test.
