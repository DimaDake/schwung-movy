# Module isolation: can each chain get its own copy of a module's statics?

Sequel to `2026-08-22-chain-balance-measurement.md`, which closed the last
*performance* question (twelve chains divide; 2.91× at three workers against a
3.11× ceiling) and handed the design over to correctness. This is the first
correctness item, and it is the one that decides how much of the rest there is.

**The question.** Two chains holding the same module share one `dlopen`
mapping, and therefore that module's whole `.data`/`.bss` (schwung review §6).
Serial render makes that safe by construction. Under two workers it is a data
race in code movy does not own, spread across 78 module repos. So: can a chain
be given a *private* copy of a module, and if so, is it cheap enough?

**Answer: yes, it works, it needs no schwung change, and only 6 modules
actually need it — but the copy cannot happen on the load path.**

---

## 1. The premise was never observed. Now it is.

`chain_host.c:438` loads every synth with `dlopen(dsp_path, RTLD_NOW |
RTLD_LOCAL)`. `RTLD_LOCAL` controls symbol *visibility*, not mapping identity,
and glibc dedups by `(st_dev, st_ino)` — so the sharing was expected but had
never been looked at on this device. `scripts/measure-module-isolation.sh`
counts it in `/proc/<pid>/maps` instead of arguing from the man page.

Two chains, both `plaits`:

```
7f80b20000-7f80b21000 rw-p 00040000 b3:04 2376184  .../plaits/dsp.so
```

**One** writable segment, one inode, 4 KB. Both chains' `render_block` write
through that page. Confirmed.

> Read it as `ableton` and `/proc/<pid>/maps` comes back **empty**, not
> permission-denied — indistinguishable from "the module is not mapped", which
> is how this first reported zero. MoveOriginal runs as root; the script now
> requires a root ssh and says so.

## 2. A byte copy separates them. A symlink does not.

The dedup key is the inode, so a symlink or hard link resolves straight back to
the original. Only a real copy gets its own mapping. Loading chain 1 from a
copied `plaits-iso1/dsp.so`:

```
7f7c870000-7f7c871000 rw-p 00040000 b3:04 2376283  .../plaits-iso1/dsp.so
7f80b20000-7f80b21000 rw-p 00040000 b3:04 2376184  .../plaits/dsp.so
```

Two segments, two inodes, two addresses. **Separate statics, on hardware.**

**This needs nothing from schwung.** The chain host resolves a synth as
`<module_dir>/../sound_generators/<name>` (`chain_host.c:392`) and audio FX as
`<module_dir>/../audio_fx/<name>/<name>.so` (`:259`) — and `module_dir` is
whatever movy passes to `create_instance`. Today all twelve chains are handed
one string (`chain_slots.rs:175`). Handing each chain its own tree is the whole
mechanism, and it is the same trick `chain_copy.rs` already uses one level up to
give movy its own `g_host`.

Two properties that make it cheap:

- **Every fleet module is a single self-contained `dsp.so`** — a device-wide
  `find` for a sibling `.so` returns nothing. So there is no `$ORIGIN`
  dependency that would itself need copying and would silently re-share.
- **Only `dsp.so` needs copying.** Everything else in a module directory is
  read with `fopen`, which does not care about inodes, so `module.json`,
  presets, ROMs, wavetables and soundfonts can be symlinked. The assets are
  the bulk of the bytes; the copy is only the code.

## 3. The copy costs 20–90 dropped frames, so it cannot sit on the load path

Measured on device, cold (page cache dropped) and warm:

| module | size | cold | warm |
| --- | ---: | ---: | ---: |
| surge | 9445 KB | 260 ms | 74 ms |
| sfz | 6992 KB | 196 ms | 55 ms |
| helm | 5062 KB | 81 ms | 44 ms |

A frame is 2902 µs. The load path *is* the audio thread (`load_queue` releases
one blocking `dlopen` per callback), so a copy there is a 20–90 frame dropout —
not a click, an audible hole. **It has to be a warmed cache**, populated before
the module is needed and refreshed on source change, exactly as
`chain_copy.rs` does. That is a one-time cost per (module, chain) pair, not a
per-load cost.

Disk and memory are non-issues: every installed sound generator's `dsp.so`
totals **41 MB** against **26.9 GB** free, and a duplicate `plaits` mapping is
**324 KB** resident against 1849 MB of RAM.

## 4. The fleet audit: 6 modules, not 78

`scripts/audit-render-globals.py` now runs over **93 checked-out repos** with
**zero blind spots**:

```
render_block resolved, TOUCHES shared statics :   7
render_block resolved, clean                  :  71
mentions render_block, NOT resolved (blind)   :   0
no render_block at all                        :  15
```

Of the 7, `forge-move`'s `SINE_TABLE` is written once at init and read-only
afterwards — the "shared wavetables are fine if read-only" case. That leaves
**6 modules with live mutable state reachable from `render_block`**:

| module | shared state | why it bites |
| --- | --- | --- |
| krautdrums | `rng_state` (xorshift) | mutated every block; two instances tear it |
| airwindows | `g_current_plugin` | a process-wide *current instance*, touched from render |
| virus | `g_user_banks`, `g_rom_bank_count`, `g_vlog` | plus `fopen`/`free` in the path |
| sfz | `log_ring` + `log_drain_thread` | atomics, but the `_started` gate is a plain int |
| StreamRTSP | `g_log_path` | plus `fopen` |
| chordism | `SAMPLE_RATE` | benign in practice (one rate), still wrong |

`airwindows` is an audio FX pack, so it is the likeliest of these to appear more
than once in one set — and the FX path shares the same `module_dir` resolution,
so the same fix covers it.

**Three audit defects were found and fixed getting to that table**, each of
which had made the earlier "2 of 11" figure look better than it was:

1. **`const\b` does not exclude `constexpr`** — the `\b` fails against the `e`,
   so every C++ compile-time constant was reported as shared mutable state.
   That was 3 of 8 hits (plaits' `kGainTable`, virus' `VIRUS_MAX_*`) — enough
   noise to discredit the list.
2. **`roots` globbed two name patterns.** The fleet is named by ~six unrelated
   conventions (`schwung-*`, `move-anything-*`, `move-everything-*`, `*-move`,
   bare names), so 28 of 93 repos — drums and FX included — were never audited
   while the script reported a fleet verdict.
3. **Silence was ambiguous.** A repo printing nothing was either clean or
   invisible, and the script could not tell them apart. plaits was genuinely
   invisible (it names `render_block` only in a comment, in a positional
   initializer); helm, obxd, surge and dx7 were clean. Both looked identical.
   Resolution now falls back to the v2 signature, and the summary reports the
   three outcomes separately.

## 5. The free alternative, and why it is not enough

Same-module chains only race if they render *concurrently*. Pinning them to one
worker keeps them serial — no copies, no disk, no audit. It costs makespan, and
`scripts/analyze-isolation-cost.mjs` prices it on the measured per-chain costs:

| set | free x | pinned x | loss | pinned fits 2000 µs? |
| --- | ---: | ---: | ---: | --- |
| measured (8 modules, 4 dup) | 2.92 | 2.72 | 6.7% | yes |
| 6 distinct × 12 chains | 2.85 | 2.31 | 18.9% | yes |
| **4 distinct × 12 chains** | **2.96** | **2.15** | **27.6%** | **NO** |
| 2 distinct × 12 chains | 2.97 | 1.54 | 48.2% | NO |
| 1 module × 12 chains | 2.98 | 1.00 | 66.5% | NO |

On a varied set pinning is nearly free. It collapses exactly where real sets
live: **four distinct instruments across twelve tracks is an ordinary set**, and
it is the first row that pinning pushes back out of budget. Pinning cannot beat
1.00× on a set of one module, and twelve drum tracks is a set people build.

So pinning is not a substitute. It is worth keeping as a *fallback* — it costs
nothing when the copy cache is cold or absent.

## 6. What this does NOT settle

- **Nothing has been implemented.** Per-chain `module_dir` is designed and its
  mechanism proven; `chain_slots.rs` still passes one shared string.
- **Where the warm happens.** A copy must not be on the audio thread, and movy
  has no non-audio thread of its own. The UI (`shadow_ui`, SCHED_OTHER) knows
  the set's modules but has no file-copy host call. Schwung's residual 2.6 is
  building an off-thread loader (review §8) which is the natural home — but
  that is upstream, and upstream stays off-limits pending an in-situ
  measurement.
- **Isolation does not fix the other hazards.** §2's `chain_get_clock_status`
  lives in the *chain host* copy, shared across movy's twelve chains, so it
  needs the same trick one level up (12 chain-host copies) or an atomic gate.
  §3 (per-worker FPCR), §4 (the SPSC MIDI rings in schwung's shim, reached
  through a vtable pointer no copy changes), §7 (`mapped_memory` as live DMA)
  and §9 (allocator contention) are all untouched by this.
- **The audit is static.** It resolves calls by name within one translation
  unit; it cannot see through function pointers or C++ virtual dispatch, which
  is how `airwindows` dispatches into CLAP plugins. 71 "clean" means 71 with no
  *statically reachable* mutable statics.

## 7. Recommendation

Isolation is the right mechanism and it is cheaper than feared: 6 modules need
it, the fix needs no schwung change, and disk and RAM are irrelevant at this
scale. The one hard constraint is that the copy is a *cache to be warmed*, never
a load-path operation.

Order of work from here, unchanged in priority by this result:

1. **§3, FPCR per worker.** One line, and the bit-identical serial-vs-parallel
   oracle is meaningless until it lands.
2. **§2, `chain_get_clock_status`.** File I/O behind a non-atomic gate, on the
   render path, in movy's own private chain-host copy — movy's race to hit.
3. **Per-chain `module_dir`,** with the warm-cache question answered first.

Upstream stays off-limits until there is an in-situ measurement inside the real
`render_block`.
