# Engine-owned persistence — design

**Status:** approved design, not yet planned or built.
**Date:** 2026-09-11
**Supersedes the evaluation in:** `docs/engine-owned-persistence.md` (2026-08-29),
which recommended this and stopped short of designing it.
**Fixes:** `docs/persistence-hazards.md` §2, §3, §4, and the dead-set gap in
`plans/set-state-clearing.md`.

---

## 1. Why

Movy is cut in half by a host boundary. The UI (TypeScript, in schwung's
QuickJS) writes the Set files; the data lives in the engine (`dsp.so`, Rust).
Every save and every restore therefore ferries the whole Set across the one
channel schwung offers — a single `overtake_dsp` param slot with four producers,
where `CLAUDE.md` already records that writes are *"routinely lost"*.

Every hazard in `docs/persistence-hazards.md` is that boundary:

| hazard | today | after |
| --- | --- | --- |
| §2 a dropped restore cost the whole Set | fixed by a gate that must be maintained | no push exists to drop |
| §3 an unreadable chain read blanks the chains | OPEN, pinned as a KNOWN GAP | no read exists to fail |
| §4 a save runs before the chains have loaded | OPEN, untested | the writer already holds `desired` |
| §1 observer effect starves a restore | unavoidable | reduced: movy stops adding traffic |

The engine is also the better-equipped half, which is the part that makes this
cheap rather than heroic:

- **It has a real filesystem.** `chain_copy.rs:60-61` already does
  write-temp → `fs::rename`. Rust `std::fs` has `rename`, `sync_all`,
  `remove_file` and `read_dir`. `host_write_file` is `fopen("w")+fwrite+fclose`:
  no rename, no fsync, no unlink, and no directory listing anywhere in the JS
  host API. The whole `gen`/`end`/adler32 envelope plus two rotating shadows in
  `persist-store.ts` exists to simulate atomicity the engine has for free.
- **It already owns the data.** `chain_host.rs:186` dlopens movy's private
  chain-host copy, so the chains, their preset blobs, the sends and the mixer
  are engine-side. `ChainSlots::desired` is authority, not a mirror.
- **The set identity is a file.** `/data/UserData/schwung/active_set.txt`
  (`set-context.ts`) — readable by either half.

## 2. Principle

**The UI is the librarian; the engine is the archive.**

The UI decides *which* Set is open. All of `set-session.ts` (342 lines of
rename-vs-switch, `__pending-<index>-<seq>`, inheritance) stays exactly where it
is: it encodes schwung's semantics, it is tested, and it is not about bytes.

The engine owns *the bytes*, and stops asking anyone for them.

This split is deliberate and is the reason the change is affordable. Moving
identity into the engine as well (it could read `active_set.txt` itself) would
drag that policy into Rust along with its tests. Rejected for this step; the
command surface in §3 is shaped so it stays possible later.

## 3. The wire: commands, not state

A new engine param key, `set`. Values are short, idempotent commands:

| command | meaning |
| --- | --- |
| `open <uuid> [seed=<srcUuid>]` | open this Set — the engine reads its own files and restores the sequencer and the chains |
| `rename <from> <to>` | the work in hand moves to a new id — Move finally materialised the Set |
| `blank <uuid>` | discard and start clean — the one recovery `set-fail.ts` offers |
| `flush` | write now, and report when durable |

`open` carries `resolveState()`'s precedence into the engine unchanged: **own
state → the seed → blank**, decided in one place rather than across a read and a
write. There is no separate "new" command; a Set with no state of its own opens
blank, which is what a switch into an unseen Set means.

`seed=` is how **copy-on-inherit** survives the move. Move's Copy/Paste creates
"X Copy" with no movy state, and `set-inherit.ts` seeds it from the best-matching
family member. That decision is name policy — a regex over `name-index.json`,
filtered by which candidates still have a state file and a live Move Set — so it
stays in TypeScript. Only the byte copy moves: the UI names the source, the
engine copies the files and opens the result at `gen 1`.

`host_module_get_param('set')` answers with status:

```
uuid=<id> phase=opening|ready|failed gen=<n> chains=<n> dirty=<0|1> [reason=<text>]
```

**This is the whole safety argument.** A lost *command* is harmless and
idempotent on retry: the engine simply has not opened the Set yet, and an engine
that has not opened a Set cannot overwrite one. A lost *payload* — today's
shape — destroyed data. The UI compares the status `uuid` against the Set it
believes is open and re-sends; that comparison replaces `restore-gate.ts`
entirely, and it is the same push-by-comparison pattern `syncWatch` already uses
in `engine.ts`.

`open` on the Set already open is a no-op, so a duplicate costs nothing.

## 4. Threading

The engine autosaves on its own dirty flag. No UI-side save trigger, no
UI-side dirty mirror.

**No file I/O on the audio thread.** `set_param` is serviced there, and a cold
`dlopen` already holds that thread for 78-276 ms. A dedicated saver thread owns
every open, write, rename, fsync and sweep; `set_param` only enqueues. The
render pool (`render_pool.rs`) and `midi_out.rs:312` are the precedent that
threads are fine here.

`flush` is the one synchronous point: the UI waits for `dirty=0` before a Set
switch and at teardown. It is bounded by a timeout and, on expiry, reported —
never silently assumed.

This also removes a live mine. Today `host_module_get_param('state')` **clears
the engine's dirty flag as a side effect of the read** (`set-save.ts`), so a
write we fail to complete is an edit nothing will ever ask for again. With no
read, there is no side effect to reason about.

## 5. Files

Paths do not change. Co-location under schwung's `set_state/` is explicitly out
of scope — see §11.

| file | owner | note |
| --- | --- | --- |
| `sets/<uuid>/seq-state.json` | **engine** | same format, byte-for-byte |
| `sets/<uuid>/chains.json` | **engine** | NEW — the `chains` and `sends` arrays that live inside `ui-state.json` today |
| `sets/<uuid>/ui-state.json` | UI | its own half — `root`/`rootPc`/`scale`/`mode`/`layout`/`oct`/`mutes`/`defaultQuant`/`flags`/`migv` — plus a `chains`/`sends` **mirror**, §6.1 |
| `sets/<uuid>/v/<n>/` | **engine** | version history, 32 per Set |
| `sets/<uuid>/versions.json` | **engine** | the ladder index |
| `name-index.json` | UI | name→uuid, for the rename policy |

`serializeUiState()` loses its `readChainDoc()` call — the engine GET that
`set-save.ts` warns about — and with it the whole reason a UI write could cost
the chains.

**`name-index.json` stops being safety-critical.** The GC no longer walks it
(§7); it remains only as the rename policy's lookup, which is what it was always
meant to be.

**Reading an older Set:** when `chains.json` is absent, the engine reads the
`chains`/`sends` fields out of `ui-state.json`. One branch, no rewrite-on-read,
and it stays indefinitely — old Sets are not migrated, they are simply read.

### The engine must not materialise an empty Set

**Rule: no directory and no file until the Set has something worth saving.** A
blank payload (`movy1\n` and no chains) writes nothing.

This is load-bearing, not tidiness. Two TypeScript decisions read the disk
directly and must keep working:

- `setHasState(uuid)` — one half of the rename-vs-switch question in
  `set-session.ts`;
- `findInheritCandidates()` — which Sets may seed a copy.

Both become pure path questions under this design (`host_file_exists` on the
Set's `seq-state.json` or `chains.json`), which is what keeps format knowledge
out of TypeScript entirely — *provided the file's existence means what it says*.
If the engine wrote a file for every pad the user merely visited, every switch
would look like a Set with state, and the bug `set-session.ts` documents at
line 228 comes straight back: delete a Set in Move, and the Set Move creates in
its place inherits the deleted one's sequence, so the deleted Set appears to
return.

A Set with chains but no notes counts as having state — hence the test is *any*
of the two files, not `seq-state.json` alone.

## 6. Format

Unchanged on disk. The engine writes what `persist-store.ts` writes today.

- The `gen N` envelope and the `end N <len> <adler32>` trailer **stay**: the
  session's engine-generation guard and the version ladder both order by `gen`.
- The two rotating shadows (`seq-state.1.json`, `seq-state.2.json`) **stop being
  written**. They exist because atomicity was not on the menu; temp+fsync+rename
  is the real thing, and `safeWrite`'s read-back-and-compare — whose own comment
  concedes "that is not fsync" — goes with them.
- Both shadows are **still read**, and the precedence rule moves to Rust
  verbatim, including the one that surprises people: *a legacy canonical file
  (no `gen` line) with real content beats any shadow, whatever generation the
  shadows carry.* A downgrade-then-return would otherwise silently undo the
  user's later work.

The format therefore gets exactly one implementer. TypeScript stops reading and
writing Set files altogether; the one question the policy asks of the disk —
*does this Set already own state?* (`setHasState`) — is answered by
`host_file_exists`, which is knowledge about a path, not about a format. The
"two implementations of a recovery rule is how recovery rules rot" risk from
`docs/engine-owned-persistence.md` §3.4 does not materialise.

### 6.1 The compatibility mirror

`engpersist` is a runtime switch on the Global Params page, so "on, then off
again" is an ordinary afternoon during rollout, not only a downgrade. A build
running with the flag off looks for the chains inside `ui-state.json`. If
nothing put them there, flipping the flag back costs the user their chains —
which would make the flag useless as an escape hatch, which is the whole reason
it exists.

So `ui-state.json` keeps its `chains` and `sends` fields.

**One writer per file, still.** The engine does not write into `ui-state.json`;
the UI does, as it always has. What changes is where the UI gets the values:

| | before | after |
| --- | --- | --- |
| source of the chains | `readChainDoc()` — an engine GET over the param slot | `chains.json`, read from disk |
| authority | the only copy | a mirror; `chains.json` is the truth |

The dangerous read still disappears. `serializeUiState()` makes no engine call
at all, so §3 (a malformed answer read as an empty set) and §4 (a save that
races the module loads) stay fixed — the engine writes `chains.json` from
`desired`, and the UI copies bytes out of it without judging them.

**`chains.json` holds exactly `{"chains":[…],"sends":[…]}`** — the same two
arrays `ui-state.json` already carries, in the same shape. The mirror is then a
splice of two named fields, not a translation, and TypeScript needs no more
knowledge of their contents than it needs of a string it copies.

**A failed mirror costs nothing.** If `chains.json` is missing or unreadable,
the UI leaves the previous `chains` field in place and writes the rest. It is
not the authority, so a stale or absent mirror cannot lose work while the flag
is on.

**The flag going 1 → 0 is the one moment the mirror must be current.** On that
transition the UI re-reads `chains.json` and rewrites `ui-state.json`
immediately, rather than waiting for the next autosave — otherwise the last few
seconds of chain edits would be the price of flipping the switch.

The mirror lives as long as the flag does. Whether it survives the release that
deletes the old path (§12 step 6) is a separate decision to take then, with the
downgrade question in front of us rather than assumed.

## 7. Collection and versions

Both move to the engine, and both get simpler rather than merely relocated.

**GC.** `set-gc.ts` walks `name-index.json` because the JS host cannot list a
directory — so a Set whose index entry was overwritten is invisible to it. That
is not theoretical: the 2026-08-27 device run collected 4 dead directories and a
fifth survived, holding 1474 bytes of sequence. `read_dir` sees all of them.

The aliveness test carries over unchanged, including its warning: schwung's set
pages physically `rename()` whole Set folders into `set_pages/page_<n>/`, so
from any other page every Set on every other page reads as deleted. Movy's
`setUuidAlive` already implements the page-aware test; it is ported, not
redesigned. davebox's asymmetry is the governing rule and is restated here:
**keeping a stale state file costs a few KB; deleting a live one destroys work,
so anything unverifiable counts as ALIVE.**

The sweep stays once per session and runs on the saver thread.

**Versions.** `version-capture.ts` rides each successful save, rate-limited, on
a 4-bucket logarithmic ladder. It moves as-is. It gets `remove_dir_all`, which
is why one-directory-per-version (a shape forced by `host_remove_dir` being the
only removal JS has) is no longer load-bearing — but the layout does not change
in this step.

## 8. What is deleted in TypeScript

- `restore-gate.ts` — all 19 lines. It exists only to remember whether a push
  landed.
- `pushState` and its retry loop (`set-load.ts`).
- The writing half of `persist-store.ts`: `writeStateBlob`, `safeWrite`, the
  envelope, the shadow rotation.
- `version-capture.ts`, `set-gc.ts`.
- The wire half of `chain-persist.ts` — encode/decode of the chain document,
  `CHAIN_SET_KEY`, `SET_TIMEOUT_MS`. The capture shapes stay only as far as the
  UI still renders them.
- The dirty-mirror dance in `saveSet`: `lastGoodPayload`, `saveRetry`, the
  `force` path that exists because a 24 Hz status poll can be stale.
- `resolveState()` in `set-inherit.ts` — the read/copy/write half. The name
  policy above it (`stripCopySuffix`, `findInheritCandidates`) stays and now
  feeds `seed=`.

## 9. Errors

| failure | behaviour |
| --- | --- |
| engine cannot read a Set's files | `phase=failed reason=<text>`; the UI shows the existing `set-fail.ts` screen, whose one recovery (blank the Set) is already scoped to a set-level failure |
| engine cannot write | retried on the saver thread; `dirty=1` stays visible in status; logged |
| a command is lost | the UI sees a `uuid` mismatch in status and re-sends — idempotent |
| `flush` times out | reported to the UI and logged; never treated as durable |
| the engine is re-`dlopen`ed mid-session | it comes up empty, reopens from its own file, and reports a new `gen`. The engine-generation guard does not disappear — it moves into the engine and must be carried across explicitly (`docs/engine-owned-persistence.md` §3.3) |

## 10. Testing

Follow `CLAUDE.md`: match the test to the bug, cheapest level that reproduces
it, and prove every new test has teeth by removing the fix and watching it fail.

**Rust (`cargo test`), where the storage now lives:**

- atomic write: a torn temp never becomes the canonical file
- reader precedence: legacy-canonical-with-content beats a higher-gen shadow
- shadow fallback: a torn canonical recovers from `seq-state.1/2.json`
- an older Set with no `chains.json` restores chains from `ui-state.json`
- `open` precedence: own state → `seed=` → blank, and a seed lands at `gen 1`
- **a blank Set writes no file** — the §5 rule, and the one whose regression is
  silent: nothing breaks until a switch is misread as a rename
- version ladder: 32 entries, the 4-bucket shape, rotation
- GC selection: page-aware aliveness, and unverifiable ⇒ ALIVE

**Existing host suites:**

- `set-restore-loss.mjs` — the §3 KNOWN GAP assertion is **flipped, not
  deleted**, exactly as the file instructs.
- `set-session.mjs` — every policy assertion must pass unchanged; only the stub
  underneath `setHasState` changes (a file probe instead of a state read). If a
  rename-vs-switch assertion needs editing, the boundary was drawn wrong.
- `set-settling.mjs`, `set-state.mjs`, `versions.mjs` — updated to the new
  ownership.

**The mirror (§6.1), which the flag's value as an escape hatch rests on:**

- with `engpersist` on, `ui-state.json`'s `chains`/`sends` match `chains.json`
- an unreadable `chains.json` leaves the previous mirror intact — it never
  writes `[]`, which is the §3 failure wearing a new hat
- flipping the flag 1 → 0 rewrites the mirror before the old path reads it: the
  teeth are a chain edit made seconds before the flip, which must survive it

**Device:** `test-seq.sh` plus the Set fixture. A dsp.so change needs the
restart discipline in `movy/CLAUDE.md`, and device suites are a smoke check, not
the gate.

## 11. Out of scope

- **Co-location under `set_state/`.** It needs schwung (duplicate-set copy is a
  filename list, not a directory copy; central deletion is an open question) and
  it is a one-way door: `host_remove_dir` is permitted only under `MODULES_DIR`,
  so JS loses deletion the moment the files move. It must follow the
  engine-side pruner, never lead it (`docs/pending-sets.md`).
- **Moving set identity into the engine.** §2.
- **Standalone.** Measured at ~15% CPU (`docs/track-performance.md` §7) and
  priced at the whole mailbox protocol, Move's instruments/sampler/Link, and the
  TS UI's host. This design is a step toward it — an engine that owns its files
  and needs no JS intermediary is a standalone prerequisite — but it is not an
  argument for it.
- **Changing the on-disk format.** §6.

## 12. Rollout

Behind a flag, the way `chparallel` shipped. `engpersist` in
`src/seq/flags-def.ts`, `def: 0`, `release` off until the device run.

1. Rust: the storage module — atomic write, the precedence reader, the tests.
   Not wired to anything.
2. Rust: the saver thread, the `set` key, the status line.
3. `chains.json` in the engine (`chain_doc.rs` already holds the document).
4. TypeScript behind `engpersist`: stop pushing `state`, stop calling
   `readChainDoc()`, send commands, compare status — and write the mirror
   (§6.1), including the rewrite on the flag's 1 → 0 transition. The flag is
   only an escape hatch once that transition is tested.
5. Versions and GC into the engine.
6. Device verification → default ON (which needs a `FLAGS_REV` bump, or a
   stored 0 beats the new default and it ships to nobody) → delete the old path
   in the following release.

`ENGINE_VERSION` gets exactly one bump per build, and the store-update hazard
applies: a store update overwrites `dsp.so` at the same inode while the old one
is dlopened, so the gate can loop. `deploy.sh` hides it; a release must not.
