# Persistence hazards

What we learned on 2026-09-11 while migrating the device tests. Two bugs are
fixed, two are open and pinned by tests. Everything here was measured, not
reasoned about — where a claim is *not* established, it says so.

---

## 0. What closed them, and what did not

Three of the four sections below describe a wire, not a bug in a serializer:
state crossing the `overtake_dsp` param slot in one direction or the other.
**`engpersist` removes that wire** — the engine reads and writes its own files
and the UI sends commands. §2, §3 and §4 are closed where that flag is on, and
the assertions that pinned them are flipped rather than deleted, with the old
arm kept because the old path still ships.

Design: `docs/superpowers/specs/2026-09-11-engine-owned-persistence-design.md`.
Plan: `plans/2026-09-12-engine-owned-persistence.md`.

**§1 is NOT closed.** The slot is shared with the shim, shadow_ui, the chain
forwarder and the remote-UI socket; movy can stop being a contributor and
nothing more. The rule below still stands for anything that observes movy.

Everything from §1 on is the record of how these were found. It stays.

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

---

## 8. FIXED — the sends were never in the chain set at all

Found 2026-09-15, after the migration, and appended rather than renumbered so
the §3 references in `chain-mirror.ts` and `set-state.mjs` keep pointing where
they point. It is here because it is the one hazard in this file that is **not**
a wire: no amount of param-slot care would have found it, and `engpersist`
inherited it intact.

The chain set is the one document that carries a Set's chains — the engine
answers with it, `captureChains`/`captureSends` read it, the mirror parses it,
`restoreChains` writes it. It was built by walking the engine's own list of
tracks: **sixteen slots**, sized for `MOVY_CHAINS`, while the send buses live at
16–18. A send was loaded through a path that never touched that list.

So the document had no send in it, at any moment, ever:

| producer | result |
| --- | --- |
| `chains` param GET → `readChainDoc()` | no `16\|fx1\|…` triple |
| the engine's `chains.json` (`engpersist` on) | same |
| `captureSends()` / `parseMirror()` | `[]` |

`serializeUiState` wrote `"sends":[]` into every Set file movy has ever
produced. The reverse direction was broken at the same line — `set_chain_set`
routed every record through a load that returns immediately at `slot >= 16` — so
a send named in a Set file was dropped silently.

**This is not a regression.** `git log -S desired` finds exactly two commits:
the one that created the list at sixteen, and an unrelated test commit. Send
persistence landed the same day sends did, written against document slots the
engine never emitted.

**Fixed in the list itself**: it is now sized to the shared render slot space, a
send load goes through the same bookkeeping a track's does, and a restored send's
preset blob is routed to the bus rather than to a track that does not exist.
Pinned by `chain_slots.rs`'s `a_send_bus_is_part_of_the_set_the_engine_reports`
and `applying_a_set_queues_the_sends_it_names` (both red before the fix), plus a
send record in the cross-language golden document on both sides.

**Nothing to migrate.** Every reader of the old format is correct; it simply
never carried a send. Rename, duplicate and version history ferry
`ui-state.json` verbatim, so the `[]` travelled intact — a Set saved before this
fix has no send in it in any copy, and the send must be re-added by hand once.

### 8a. Its second half — the module came back and its knobs did not

Found 2026-09-16 by opening a Set that a build with §8 fixed had just written.
The send was in the document now, the module loaded — and it was at the module's
shipped defaults.

Getting a bus INTO the document was only half of it. The engine writes
`chains.json` by asking each record for its preset, and it asked through
`ChainSlots::get_param` — which is `.get`-based over `slots`, the **sixteen**
chain instances. A bus's slot indexes past the end of that array and answers
`None`, so `chain_state::serialize` fell through to `unwrap_or_default()` for
every send it wrote. A Set file written by the fixed engine records its sends
with an **empty fourth field**:

```
17 → fx1 → mverb → ""        ← the patch, gone
```

The mirror then carried the absence faithfully (`chain-mirror.ts:53`), so
`ui-state.json` lost it too, and on open `restore`'s `if !c[3].is_empty()` guard
skipped `set_send_state` — the module loaded through the load the document
queued and `fx1:state` was never set.

**The read is the bug, not the write.** `snd0:state` → `set_send_state` →
`attach_state` → the load that applies it were all correct, and the UI path was
too: `captureSends` reads `snd0:state` through `send_get_param`
(`chain_slots.rs:423`), which reaches the live instance. Only the engine's own
serializer was blind — and only with `engpersist` on, which is the shipped
default, so every Set movy has written since that flag landed has a send in it
with no patch.

**What hid it**: `mix_csv` and `lfo_state` call the same `get_param` and are
*right* to — a bus has no mixer triple and no LFOs, so `""` is the truth for
those fields, and the paragraph in `plans/2026-09-15-send-persist-not-saved.md`
that noticed this ("`.get`-based, so a send's mix and LFO fields serialize as
`""` by construction") stopped one field short of the one a bus actually has.
Two callers telling the truth about empty fields made the third, which was
losing data, look like the same pattern.

**Fixed** at the read: a bus's preset is read through `send_get_param(bus,
"state")` — the accessor that already existed for the UI's half — selected by
`bus_of_slot`, so the bus branch and the track branch are named rather than
inferred. Pinned by `chain_slots.rs`'s `a_live_sends_preset_reaches_the_file`,
which asserts the blob is in the file **and** that reopening hands it back to
the queued load; it reads `""` with the fix reverted.
