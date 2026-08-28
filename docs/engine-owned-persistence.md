# Engine-owned persistence: what it would buy, and what it would cost

**Status:** evaluation only. Nothing here has been built, and this document does
not approve anything.
**Date:** 2026-08-29
**Question it answers:** the chain set moved into the engine today. Is that the
same thing as the "align movy's saving with davebox and schwung" path agreed on
2026-08-27, and — separately — are there reasons to go further that hold up on
their own, without appealing to alignment?

Short answers: **no, it is a different axis**, and **yes, two of the four
benefits are worth having on their own merits.**

---

## 0. Where the three tools actually stand

| | serialises state | reads/writes the file | prunes dead sets | keyed by |
|---|---|---|---|---|
| **davebox** | DSP (C) | **DSP** (`seq8_save_state` / `seq8_load_state`) | **DSP** (`prune_orphan_states`, `opendir`+`unlink`) | uuid pushed as `state_load=<uuid>` |
| **schwung** | JS | JS (UI thread), C for seeding | nothing collects | uuid, `set_state/<uuid>/` |
| **movy** | **engine** (`seq-core/persist.rs`) | **JS** (`persist-store.ts`) | JS, index-driven (`set-gc.ts`) | uuid, `modules/tools/movy/sets/<uuid>/` |

Movy's engine parses and serialises the sequencer blob (`movy-dsp/src/lib.rs:308`
and `:371`) but has never been told a set uuid and touches no state file. Its
only file I/O anywhere is the isolation stamp in `chain_copy.rs:48,63`.

davebox's DSP takes five global keys — `debug_log`, `save`,
`prune_orphan_states`, `state_path`, `state_load`
(`schwung-davebox/dsp/setparam/sp_globals_state.c`) — and does the rest itself.
That is the shape "engine-owned persistence" means throughout this document.

---

## 1. Today's change is not the alignment work

`60adf95` (the chain set as one acknowledged document) and `e1a315b` (the
`settling` phase) moved **authority over what the chain set is** into the
engine: `ChainSlots::desired` (`chain_slots.rs:78`) holds what was *requested*,
not what has finished loading, so a partial set stopped being representable.

The alignment path agreed on 2026-08-27 was about **storage**:

| Alignment item | Status |
|---|---|
| Move movy's files from `modules/tools/movy/sets/<uuid>/` (`set-context.ts:6`) into schwung's `set_state/<uuid>/`, where davebox writes `seq8-state.json` | not started |
| Move collection into the engine, as davebox does, because JS cannot delete under `set_state/` at all | not started |
| Expose the set uuid to the engine, davebox's `state_load=<uuid>` | not started |
| Stop the `__pending-N-M` churn by making the Set real | **shipped** (`780d850`…`33fc3ed`) |

**The gap in one line:** the alignment path is about *which directory, which id,
who may delete*. Today's change is about *how state crosses the UI↔engine wire
and who holds the truth*. They meet at one point only: the truncation bug parked
in `plans/set-state-clearing.md` under "Found while verifying — NOT fixed here"
(pad 17 rewritten from 7 chains to 3, 36 KB → 13 KB) is the bug `desired` makes
unrepresentable.

---

## 2. Benefits that hold up without the alignment argument

### 2.1 Real atomic saves — the strongest one

`host_write_file` is `fopen("w") + fwrite + fclose`: **no rename, no fsync, no
unlink** (`js_host_common.c`). That single missing primitive is the reason
movy's persistence looks the way it does. `persist-store.ts:1-16` says so
outright: the two rotating shadow slots, the `gen N` envelope and the `end N
<len> <adler32>` trailer exist to build crash-safety out of *redundancy*,
because atomicity was not on the menu. `safeWrite` reads every write straight
back and compares — and its own comment concedes "that is not fsync — it cannot
prove the bytes reached flash".

Rust `std::fs` has `rename`, and `File::sync_all`. An engine that owns the file
can do write-temp → fsync → rename, which is the real fix rather than the
substitute. The envelope and the shadows can stay as belt-and-braces, but they
would stop being the only line of defence.

This benefit is available **at the current paths**. It requires nothing about
`set_state/` and nothing from schwung.

### 2.2 A sweep that can actually see the directory

The module JS API has **no directory listing**. Movy's GC therefore walks
`name-index.json` (`set-gc.ts:9`), which is keyed by set *name*, so a set whose
index entry was overwritten is invisible to it. This is not theoretical — the
2026-08-27 device verification collected 4 dead directories and **a fifth
survived because it was not in the index** (`plans/set-state-clearing.md`,
"Device verification"). One dead set was holding 1474 bytes of sequence and
16 KB of UI state.

`opendir` in the engine sees all of them. Also available at the current paths.

Whatever prunes must keep davebox's aliveness test rather than a bare
`stat(Sets/<uuid>)`: schwung's set pages physically `rename()` whole Set folders
into `set_pages/page_<n>/`, so from any other page every Set on every other page
reads as deleted. `seq8_set_uuid_alive` carries a warning to that effect, and
movy's `setUuidAlive` (`set-gc.ts:35`) already implements it.

### 2.3 Fewer blocking writes racing a `dlopen`

The direct continuation of today's bug. Every param write is serviced on the
audio thread — the same one a cold `dlopen` holds for 78-276 ms. Today's fix
removed ~16 writes per set load and replaced them with one. An engine that reads
its own file removes the state pushes too: the UI would send a uuid, not a
payload. Fewer entries in that queue means less to race, a shorter drain, and a
shorter `settling` splash — which is the thing `e1a315b` had to introduce a
phase for.

Sizes are modest (a set's sequence is ~1-2 KB), so this is a robustness argument
rather than a throughput one. The class of failure it removes is the one that
cost 11 chains → 8 → 5.

### 2.4 One directory per set — weaker than it looks

The tidiness argument does not carry itself. The interesting version would be
that schwung already copies a Set's state when it detects a duplicate — so
co-locating would make "duplicate a Set, keep your patterns" free.

**Checked, and it is not free.** `detectCopySource` (`shadow_ui.js:7066`) fires
only when the set *name* contains "copy" or "duplicate", and the copy that
follows (`shadow_ui.js:19543`) reads **specific filenames** — `slot_N.json`,
`master_fx_N.json`, `shadow_chain_config.json` — not the directory. The C twin
(`shadow_set_pages.c:119`, `seed_empty_set_state`) is split the same way. Movy's
files would sit next to them and be ignored.

So this benefit is real but **conditional on an upstream change** (copy the
directory, not a filename list). Worth asking for; not worth budgeting as
already-won. The same goes for "schwung deletes `set_state/<uuid>/` centrally" —
that is an open question in `schwung-per-set-tool-state.md`, not a commitment.

---

## 3. Costs and risks

### 3.1 Param writes land on the audio thread

Davebox's `save` key calls `seq8_save_state` inline, which means it writes its
state file **on the audio thread**. Schwung has been moving the other way:
`shadow_handle_set_loaded` carries the comment

> *"This runs on the audio thread during the periodic set poll. Heavy file I/O
> (config save/load, copy detection, mkdir) has been removed and is handled by
> the UI thread."* — `shadow_set_pages.c:411`

An engine-side save in movy must therefore **not** do file I/O inline in
`set_param`. Movy already runs worker threads for the render pool, so a saver
thread is available — but this needs designing, not copying from davebox.

### 3.2 Co-location is a one-way door until the pruner exists

`host_remove_dir` is permitted only under `MODULES_DIR` (plus update-staging,
update-backup and tmp) — `js_host_common.c:456-464`. There is no
`host_remove_file` at all. The moment movy's files move to `set_state/`, JS can
no longer delete them, by any route.

Hence the ordering already recorded in `docs/pending-sets.md`: **move the paths →
migrate the old tree on load → then move collection into the engine.** Reversed,
collection silently stops working and nobody is told.

### 3.3 It does not fix the engine-generation guard

`seq/engine.ts` re-`dlopen`s `dsp.so` after 16 lost status polls, and the reload
comes up **empty**; `persist.ts` autosaves only when `engineGeneration()` matches
`restoredGen`. An engine that owned its own file could still autosave that
emptiness over good data. The guard moves into the engine; it does not disappear.
Any design must carry it across explicitly.

### 3.4 A format that two readers share

`seq-state.json` is currently written by JS and read by JS; the engine only ever
sees the blob's *contents*. Once the engine writes it, the envelope
(`gen`/`end`/adler32, deliberately unknown verbs that `persist::load` ignores)
has a second implementer, and the compatibility rule from
`plans/2026-07-31-save-durability.md` — *a legacy envelope-free canonical file
with real content outranks any shadow* — has to hold in both. Two implementations
of a recovery rule is how recovery rules rot.

### 3.5 Someone else's aliveness test on your files

If schwung ever does own deletion of `set_state/<uuid>/`, movy's work is deleted
by schwung's judgement of what is alive. That is the benefit and the risk in the
same sentence. davebox's asymmetry is the right default and should be demanded
of whatever does it: *keeping a stale state file costs a few KB, deleting a live
one destroys work, so anything unverifiable counts as ALIVE.*

---

## 4. What would be gained by doing nothing further

Worth stating so the comparison is fair. Today's shape already gives movy:

- one acknowledged, retryable document per direction for the chain set;
- `desired`-not-`loaded`, so a mid-drain save cannot under-report;
- a `settling` phase that holds the splash until the modules are in;
- a GC that works for every set in `name-index.json`, with the page-aware test.

The remaining bugs this document is about are: a torn write on power loss, a
dead set that was never named, and the audio-thread race on whatever writes are
left.

---

## 5. If only one thing is done

**§2.1 (atomic writes) and §2.2 (a real directory sweep), at the current paths.**
Both are engine work, neither needs schwung to change, neither needs the files to
move, and each fixes a failure that has been observed rather than imagined.

Co-location (§2.4) is mostly alignment plus a prerequisite for the upstream wins,
and it is the step that costs JS-side deletion in the interim. It should follow
the pruner, not lead it.

---

## 6. Open questions for upstream

Carried from `docs/schwung-per-set-tool-state.md`, narrowed to what this
document depends on:

1. Will schwung's duplicate-set path copy the **directory** rather than a
   filename list? Without that, §2.4 buys nothing but tidiness.
2. Will schwung own deletion of `set_state/<uuid>/`? If yes, movy needs no
   pruner of its own once co-located — but see §3.5.
3. Is there a sanctioned way for a module to do file I/O off the audio thread,
   or is a module-owned worker thread the expected answer?

---

## Sources read

movy at `e1a315b`; `plans/2026-08-29-chain-set-document.md`,
`plans/set-state-clearing.md`, `plans/2026-07-31-save-durability.md`,
`docs/pending-sets.md`, `docs/schwung-per-set-tool-state.md`,
`docs/superpowers/specs/2026-08-18-set-lifecycle-design.md`.
schwung-davebox `dsp/setparam/sp_globals_state.c`.
schwung at local checkout `8c87ef3e` (2026-08-28) — `git pull` is not available
in that clone (detached HEAD, no local `origin/main` ref), so the tree is one day
old rather than freshly pulled; `src/host/js_host_common.c`,
`src/host/shadow_set_pages.c`, `src/shadow/shadow_ui.js`.
