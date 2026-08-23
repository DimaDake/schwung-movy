# Per-chain module isolation: give every duplicate its own `dsp.so`

Implements decision **DECIDED 2026-08-23** in
`2026-08-23-parallel-render-prototype.md` §5, using the mechanism proven in
`2026-08-22-module-isolation.md` §2. This is item 3 of that plan's §8 list and
the last thing standing between twelve tracks of one module and more than
1.00×.

**Two rules, no allow-list:**

| the set contains | do |
| --- | --- |
| a duplicated module — any module, any component | the second and later instances get a private `dsp.so` copy |
| a duplicate whose copy is absent or failed | pin it to one lane (today's behaviour) |

---

## 1. The mechanism, restated as paths

`dlopen` dedups by `(st_dev, st_ino)`, so only a byte copy separates two
instances' `.data`/`.bss`. Symlinks and hard links resolve to the same inode and
do **not** work. The chain host resolves everything relative to the `module_dir`
movy hands `create_instance`, textually:

| what | path | source |
| --- | --- | --- |
| synth | `<module_dir>/../sound_generators/<name>/dsp.so` | `chain_host.c:392,431` |
| audio FX | `<module_dir>/../audio_fx/<name>/<name>.so` | `chain_host.c:260` |
| MIDI FX | `<module_dir>/../midi_fx/<name>/dsp.so` | `chain_midi.c:240` |
| patches | `<module_dir>/../../patches` | `chain_patch.c:80` |

So **two** levels of parent are live, and the private tree has to mirror both:

```
/data/UserData/schwung/.movy-iso/c<N>/
    patches                        -> symlink to schwung's (opendir/fopen: inode-agnostic)
    modules/chain/                 REAL dir — this is the module_dir we pass
    modules/sound_generators/<m>   symlink (shared) | REAL dir (isolated)
    modules/audio_fx/<m>           symlink (shared) | REAL dir (isolated)
    modules/midi_fx/<m>            symlink (shared) | REAL dir (isolated)
```

`modules/chain` must be a real directory: `..` is resolved by the kernel
*after* following a symlink, so a symlinked `chain` would resolve straight back
to schwung's own parent and the whole tree would be inert — sharing every
mapping while reporting itself isolated.

An **isolated** entry is a real directory holding a *copied* `dsp.so` (or
`<name>.so`) plus a symlink to every other child of the source module dir. Only
the code is copied: `sfz` is 603 MB of soundfonts against a 7 MB `dsp.so`, and
`fopen` does not care about inodes.

Root is dot-prefixed (`.movy-iso`) and outside `modules/`, so schwung's module
scanners — which skip `d_name[0] == '.'` — cannot mistake the mirror for
installed modules.

## 2. Who gets a copy

Invariant: **at most one chain per (kind, module) uses the shared original.**
At load time, chain `N` loading module `M`:

- another loaded chain already holds `M` *non-isolated* → `N` copies
- otherwise → `N` symlinks (shared, byte-identical to today's behaviour)

This is order-independent and needs no notion of "first": the incumbent keeps
the original, every newcomer isolates. It also means the common case — twelve
different instruments — copies **nothing** and pays no dropout.

The copy costs 44–74 ms warm / 81–260 ms cold, on the audio thread, at load,
where a blocking `dlopen` already hiccups. `chain_copy.rs`'s size+mtime sidecar
pattern makes it **once ever** per (chain, module) pair, not once per load.

## 3. Pinning becomes the fallback, and it keys on the right thing

The planner pins by *synth* module id today, which cannot express "these two
chains share an FX". Since isolation now covers FX and MIDI FX too, the pin key
is computed by `chain_slots` instead: a chain whose every component is either
isolated or the sole user of its module gets a **free** key (its own group);
anything else is grouped by the module it actually shares. `pin_duplicates`
(`chpin`) still gates the whole thing.

## 4. Work

1. **`module_iso.rs`** — the tree. `prepare_chain` (mkdirs, patches symlink,
   mirror all three subdirs, token-guarded against new installs) and
   `ensure(chain, kind, name, isolate)`. Host-testable against real tmpdirs,
   real symlinks and real copies.
2. **`chain_slots.rs`** — per-chain `module_dir`, per-component module tracking,
   the "who is non-isolated" decision, pin keys. Falls back to the shared
   `module_dir` for any chain whose tree could not be prepared.
3. **`render_plan.rs`** — group by pin key rather than by synth module.
4. **`chiso <0|1>`** — runtime off switch, so a device arm can A/B isolation on
   one held set exactly as `chparallel`/`chlanes`/`chpin` do. Reported in
   `chrenderlog` because a set with no duplicate plans identically either way.
5. **Device measurement** — twelve chains of ONE module, `chparallel 1`, and it
   must exceed 1.00×. That number is the whole point of this change and it is
   the one thing no local test can produce.

## 5. What it did — and the module that cannot be isolated

**Built and device-verified.** `module_iso.rs` (trees), `chain_iso.rs` (policy),
per-chain `module_dir` in `chain_slots.rs`, pin keys in `render_plan.rs`,
`chiso <0|1>`. 125 movy-dsp tests, all local suites green.

**The mechanism works.** Twelve chains of one module, `chiso 1`, three lanes:

```
iso=1 copies=11   plan=8,9,7,3|0,4,10,5|6,1,11,2      spread over three lanes
iso=0 copies=11   plan=0,1,2,3,4,5,6,7,8,9,10,11||    one lane, as before
```

That is the whole point of the change, stated as a plan rather than as a
speedup: the set that returned exactly 1.00× now divides.

**The speedup itself is NOT yet measured.** The dexed run printed 1.74× (arm D
off vs on) and it is not quotable — its own gates say so: `sounding=0/12`,
because twelve dexed chains decay to silence under a held chord, and the
`chlanes 1` control read 1.37× rather than ~1.00×, which is the script saying it
measured something other than lanes. The re-run on a sustaining module (obxd)
was cut off when the device left the network. **Outstanding: one sweep on a
sounding twelve-of-one-module set.** Arm D is the right comparison to quote from
it, and it is a clean one: both arms are physically isolated and differ only in
the plan, so it prices the scheduling and nothing else.

### helm takes MoveOriginal down inside the second dlopen

**A second independent mapping of a module is not universally safe.** Two `helm`
chains, isolated, kill MoveOriginal *inside the chain host's `dlopen` of the
copy*. Established with the controls, in this order:

| arm | result |
| --- | --- |
| helm ×2, isolated, copy made in the same load | dies |
| helm ×2, isolated, copy already on disk (`ensure` a no-op) | **dies** — so it is not the copy |
| helm ×2, **sharing** one mapping via symlink (pre-change behaviour) | **survives**, 86 ms |
| dexed, obxd, surge (9 MB), forge, weird-dreams, plaits, noisemaker ×2, isolated | all survive |

So it is not the copy (35 ms), not the write, not size, and not pre-existing —
it is helm specifically, and only when mapped twice. `PT_TLS` is 48 bytes and
surge has one too, so static-TLS exhaustion is not it either. The cause is
unknown and did not need to be known.

> A first "control" reported that *shared* helm ×2 also dies, which would have
> made this pre-existing. It was contaminated: `chiso 0` with a copy already on
> disk still loaded the copy. That is now fixed — `chiso 0` reverts the entry to
> a symlink and re-keys the planner — and the control was re-run from a clean
> tree. Same family as every other silent-measurement failure in this work:
> the wrong answer was clean, plausible, and would have exonerated the change.

### The response: a canary, not an audit

The design's whole argument is that a static audit cannot be trusted to say
which modules are safe. That argument survives — it just now cuts both ways, so
the answer is still not an audit. Before an isolated module is handed to the
chain host, a marker is written; after the load returns, it is cleared. **A
module whose load never returns is never isolated again** — it is pinned, which
is exactly the fallback that already existed. The cost is one crash per module,
ever, and the marker records the source's size+mtime so an updated module is
retried rather than condemned forever.

Verified end to end on device: attempt 1 crashes and leaves
`.movy-iso/.unsafe/sound_generators-helm`; attempt 2 logs `helm cannot be
isolated — pinning`, survives, and plans `0,1||`.

**Isolation is therefore OFF by default (`chiso 1` opts in), like
`chparallel`.** Serial render has no race for it to fix, so the default user
pays nothing and risks nothing; and it has to be set *before* the chains load,
because the copy happens where the chain host dlopens.

## 6. Teeth

Each guard gets removed and the failure watched:

- symlinked entry instead of a copy → the isolation test must fail (same inode)
- `chain` mirrored as a symlink → the resolved parent must come back wrong
- pin key not recomputed after a load → the planner keeps a stale group
- copy failure → the chain must still load, shared and pinned, never silent
- the canary never firing → the condemned module is isolated again

All five removed, all five watched to fail (`isolation_copies_only_the_so...`,
`the_chain_dir_is_real_so_dotdot_stays_inside_the_mirror`,
`isolated_duplicates_spread_across_lanes`, `a_failed_copy_falls_back_to_a_pin`,
`a_module_that_crashed_the_last_isolated_load_is_never_isolated_again`).
