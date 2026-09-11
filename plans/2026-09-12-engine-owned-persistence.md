# Engine-Owned Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move ownership of a Set's files from the TypeScript UI into the Rust engine, so no Set state crosses the lossy param slot in either direction.

**Architecture:** The UI stays the librarian — it decides *which* Set is open and keeps every line of `set-session.ts` policy. The engine becomes the archive: it reads and writes `seq-state.json` and a new `chains.json` itself, atomically (temp → fsync → rename), on a dedicated saver thread. The wire carries short idempotent commands (`open`/`rename`/`blank`/`flush`) instead of payloads, because a lost command is harmless on retry while a lost payload destroyed data.

**Tech Stack:** Rust (`engine/crates/movy-dsp`, no external dependencies), TypeScript (`movy/src`), node-based host suites (`browser-test/logic`), `cargo test`, device suites under `test-device/`.

**Spec:** `docs/superpowers/specs/2026-09-11-engine-owned-persistence-design.md` — read it first; this plan argues from it.

## Global Constraints

- **`movy-dsp` has zero external dependencies.** Do not add any — not `serde`, not `serde_json`, not a tempfile crate. This is why `chains.json` uses the flat length-prefixed format rather than JSON.
- **No file I/O on the audio thread.** `set_param`, `get_param` and `render_block` all run there. Every open, read, write, rename and fsync belongs to the saver thread.
- **`ENGINE_VERSION` gets exactly one bump per build** (`engine/crates/movy-dsp/src/lib.rs:120`, currently `0.73.0` → `0.74.0` for this plan).
- **A redeployed `dsp.so` is not the running one** until Move restarts — the shim dlopens by path. `scripts/deploy.sh` restarts on an md5 change; a manual copy does not.
- **Flag `engpersist` ships `def: 0`.** No `FLAGS_REV` bump in this plan — that belongs to the release that flips the default.
- **The on-disk format does not change.** `seq-state.json` stays byte-identical to what `persist-store.ts` writes today: `movy1\n`, `gen N\n`, payload, `end N <len> <adler32>\n`.
- **Blank Sets write nothing.** No directory, no file, until the Set has content. `setHasState` and `findInheritCandidates` read existence directly and a file that means "visited" would resurrect the deleted-Set bug (`set-session.ts:228`).
- **Prove every new test has teeth:** remove the fix, watch it fail, put it back. A test that passes both ways is not a test.

## Scope

Rollout steps 1-4 of spec §12: the storage module, the saver thread and wire, `chains.json`, and the TypeScript side behind the flag including the compatibility mirror.

**Out of scope, and deliberately a second plan:** step 5 (version history and dead-Set collection into the engine). Those are additive — they move code that works today and is not implicated in any of the four hazards — and this plan already produces working, shippable software without them. Write that plan once this one is on device.

---

### Task 1: The envelope, in Rust

The on-disk envelope is currently implemented only in `persist-blob.ts`. Port it first, pure and I/O-free, because everything else depends on reading it correctly and this is the only part that can be tested with no filesystem at all.

**Files:**
- Create: `engine/crates/movy-dsp/src/set_envelope.rs`
- Modify: `engine/crates/movy-dsp/src/lib.rs` (add `mod set_envelope;` beside the other module declarations)
- Test: inline `#[cfg(test)] mod tests` in `set_envelope.rs`, per this crate's convention (see `chain_copy.rs:67`)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `pub struct Parsed { pub payload: String, pub gen: u32, pub legacy: bool }`
  - `pub fn adler32(s: &str) -> u32`
  - `pub fn wrap(payload: &str, gen: u32) -> String`
  - `pub fn parse(raw: &str) -> Option<Parsed>`
  - `pub const TAG: &str = "movy1";`
  - `pub const BLANK_STATE: &str = "movy1\n";`

- [ ] **Step 1: Write the failing tests**

Create `engine/crates/movy-dsp/src/set_envelope.rs` containing ONLY the test module below plus the type/function signatures with `unimplemented!()` bodies, so the file compiles and the tests fail on behaviour rather than on a missing symbol.

```rust
#[cfg(test)]
mod tests {
    use super::*;

    /* The exact bytes persist-blob.ts produces. If this test's expectation ever
     * has to change, the format changed, and every movy on every device that
     * has not been updated can no longer read the user's Sets. */
    #[test]
    fn wraps_the_documented_shape() {
        let payload = "movy1\nbpm 12000\n";
        let w = wrap(payload, 42);
        assert!(w.starts_with("movy1\ngen 42\n"), "got {w:?}");
        assert!(w.ends_with(&format!("end 42 {} {}\n", payload.len(), adler32(payload))),
                "got {w:?}");
    }

    #[test]
    fn round_trips() {
        let payload = "movy1\nbpm 12000\ncl 0 0 16 0 0:24:60:100\n";
        let p = parse(&wrap(payload, 7)).expect("parses");
        assert_eq!(p.payload, payload);
        assert_eq!(p.gen, 7);
        assert!(!p.legacy);
    }

    /* A file with no `gen` line predates the envelope. It must parse, as
     * generation 0, and be MARKED legacy — the precedence rule in set_store
     * turns on that flag. */
    #[test]
    fn legacy_file_parses_as_gen_zero() {
        let p = parse("movy1\nbpm 12000\n").expect("parses");
        assert_eq!(p.gen, 0);
        assert!(p.legacy);
        assert_eq!(p.payload, "movy1\nbpm 12000\n");
    }

    /* The whole reason the marker is at the top and the checksum at the bottom:
     * without the split, a truncation deep in the payload is indistinguishable
     * from a pre-envelope file, and a torn write loads as a PARTIAL set. */
    #[test]
    fn torn_write_is_rejected_not_read_as_legacy() {
        let full = wrap("movy1\nbpm 12000\ncl 0 0 16 0 0:24:60:100\n", 9);
        let torn = &full[..full.len() - 12];
        assert!(parse(torn).is_none(), "a torn envelope must not parse");
    }

    #[test]
    fn checksum_mismatch_is_rejected() {
        let w = wrap("movy1\nbpm 12000\n", 3).replace("bpm 12000", "bpm 13000");
        assert!(parse(&w).is_none());
    }

    #[test]
    fn wrong_tag_is_rejected() {
        assert!(parse("notmovy\ngen 1\n").is_none());
        assert!(parse("").is_none());
    }

    /* Ported from persist-blob.ts: the payload is ASCII, and the low byte of
     * each char is the byte value. A fixed vector pins the port. */
    #[test]
    fn adler32_matches_the_typescript() {
        assert_eq!(adler32(""), 1);
        assert_eq!(adler32("movy1\n"), 0x086e0207);
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd movy/engine && ~/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo test -p movy-dsp set_envelope
```

Expected: FAIL — the `unimplemented!()` bodies panic.

If `adler32_matches_the_typescript` is the only failure once the rest pass, do NOT adjust the implementation to match the constant: recompute the expected value with the TypeScript itself and fix the constant, because `persist-blob.ts` is the definition.

```bash
cd movy && node -e "
const a=(s)=>{let a=1,b=0;for(let i=0;i<s.length;i++){a=(a+(s.charCodeAt(i)&0xff))%65521;b=(b+a)%65521;}return((b<<16)|a)>>>0;};
console.log('0x'+a('movy1\n').toString(16).padStart(8,'0'));"
```

- [ ] **Step 3: Implement**

```rust
//! The on-disk envelope around the engine's own state serialization.
//!
//! A direct port of `src/seq/persist-blob.ts`, and it must stay one: a Set
//! written by either half has to be readable by the other, on a device whose
//! movy may be older than its Sets.
//!
//!   movy1                       <- unchanged, so old builds still load us
//!   gen 42                      <- generation, at the TOP so truncation keeps it
//!   …engine payload…
//!   end 42 1850 2a1f3c04        <- generation, payload length, adler32
//!
//! `gen` and `end` are unknown verbs to seq_core::persist::load, which ignores
//! them. Splitting the marker from the checksum is what makes a truncation deep
//! in the payload distinguishable from a pre-envelope file.

pub const TAG: &str = "movy1";
pub const BLANK_STATE: &str = "movy1\n";

pub struct Parsed {
    pub payload: String,
    pub gen: u32,
    /// No envelope: written by a build that predates it. Generations cannot
    /// order it against enveloped copies, so the reader needs to know.
    pub legacy: bool,
}

/// Adler-32 over the low byte of each char, matching the TypeScript exactly.
pub fn adler32(s: &str) -> u32 {
    let (mut a, mut b) = (1u32, 0u32);
    for ch in s.chars() {
        a = (a + (ch as u32 & 0xff)) % 65521;
        b = (b + a) % 65521;
    }
    (b << 16) | a
}

pub fn wrap(payload: &str, gen: u32) -> String {
    let owned;
    let p: &str = if payload.ends_with('\n') {
        payload
    } else {
        owned = format!("{payload}\n");
        &owned
    };
    let rest = match p.find('\n') {
        Some(i) => &p[i + 1..],
        None => "",
    };
    format!("{TAG}\ngen {gen}\n{rest}end {gen} {} {}\n", p.len(), adler32(p))
}

pub fn parse(raw: &str) -> Option<Parsed> {
    let lines: Vec<&str> = raw.split('\n').collect();
    if lines.first()?.trim() != TAG {
        return None;
    }

    // No generation marker → written before the envelope existed. Trust it:
    // that is the only shape every currently-installed build produces.
    let second = lines.get(1).copied().unwrap_or("");
    if !second.starts_with("gen ") {
        return Some(Parsed { payload: raw.to_string(), gen: 0, legacy: true });
    }

    let gen: u32 = second[4..].trim().parse().ok()?;

    let mut last = lines.len() - 1;
    while last > 0 && lines[last].is_empty() {
        last -= 1;
    }
    let tr: Vec<&str> = lines[last].split(' ').collect();
    if tr.len() != 4 || tr[0] != "end" || tr[1].parse::<u32>().ok()? != gen {
        return None;
    }

    let body = lines[2..last].join("\n");
    let payload = format!("{TAG}\n{body}{}", if last > 2 { "\n" } else { "" });
    if payload.len() != tr[2].parse::<usize>().ok()? || adler32(&payload) != tr[3].parse().ok()? {
        return None;
    }
    Some(Parsed { payload, gen, legacy: false })
}
```

Add to `engine/crates/movy-dsp/src/lib.rs`, beside the existing `mod` lines:

```rust
mod set_envelope;
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd movy/engine && ~/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo test -p movy-dsp set_envelope
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Prove the teeth**

Change `wrap` to emit `gen {gen}` at the BOTTOM instead of the top (the shape the envelope deliberately rejects) and re-run: `torn_write_is_rejected_not_read_as_legacy` and `wraps_the_documented_shape` must both fail. Revert.

- [ ] **Step 6: Commit**

```bash
git add engine/crates/movy-dsp/src/set_envelope.rs engine/crates/movy-dsp/src/lib.rs
git commit -m "engine: port the state envelope to Rust"
```

---

### Task 2: The store — atomic writes and the precedence rule

**Files:**
- Create: `engine/crates/movy-dsp/src/set_store.rs`
- Modify: `engine/crates/movy-dsp/src/lib.rs` (`mod set_store;`)
- Test: inline `#[cfg(test)] mod tests` in `set_store.rs`

**Interfaces:**
- Consumes: `set_envelope::{Parsed, wrap, parse, BLANK_STATE}`.
- Produces:
  - `pub struct SetStore { root: std::path::PathBuf }`
  - `pub fn new(root: &str) -> SetStore`
  - `pub fn has_state(&self, uuid: &str) -> bool`
  - `pub fn read_best(&self, uuid: &str) -> Option<Parsed>`
  - `pub fn read_chains(&self, uuid: &str) -> Option<String>`
  - `pub fn write(&self, uuid: &str, payload: &str, gen: u32, chains: &str) -> Result<(), String>`
  - `pub fn seed(&self, dst: &str, src: &str) -> bool`
  - `pub fn is_blank(payload: &str, chains: &str) -> bool`

- [ ] **Step 1: Write the failing tests**

Create `set_store.rs` with signatures stubbed `unimplemented!()` plus:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmp(name: &str) -> SetStore {
        let d = std::env::temp_dir().join(format!("movy-set-store-{name}"));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        SetStore::new(d.to_str().unwrap())
    }

    const GOOD: &str = "movy1\nbpm 12000\ncl 0 0 16 0 0:24:60:100\n";

    #[test]
    fn writes_and_reads_back() {
        let s = tmp("rw");
        s.write("u1", GOOD, 1, "0\n").unwrap();
        let got = s.read_best("u1").expect("reads");
        assert_eq!(got.payload, GOOD);
        assert_eq!(got.gen, 1);
    }

    /* The reason the engine owns this at all: the canonical file is never
     * observed half-written, because it arrives by rename. */
    #[test]
    fn never_leaves_a_partial_canonical() {
        let s = tmp("atomic");
        s.write("u1", GOOD, 1, "0\n").unwrap();
        s.write("u1", "movy1\nbpm 14000\n", 2, "0\n").unwrap();
        let raw = fs::read_to_string(s.state_path("u1")).unwrap();
        assert!(parse(&raw).is_some(), "canonical must always parse");
        assert!(fs::read_dir(s.set_dir("u1")).unwrap()
                .filter_map(|e| e.ok())
                .all(|e| !e.file_name().to_string_lossy().contains(".tmp")),
                "no temp file may survive a completed write");
    }

    /* THE rule from persist-store.ts, and the one that surprises people: a
     * legacy canonical with real content was written by a build predating the
     * envelope, so it is necessarily NEWER than any shadow however high that
     * shadow's generation — the user downgraded, worked, and came back. */
    #[test]
    fn legacy_canonical_with_content_beats_a_higher_shadow() {
        let s = tmp("legacy");
        fs::create_dir_all(s.set_dir("u1")).unwrap();
        fs::write(s.state_path("u1"), GOOD).unwrap();
        fs::write(s.shadow_path("u1", 1), wrap("movy1\nbpm 99000\n", 99)).unwrap();
        let got = s.read_best("u1").expect("reads");
        assert_eq!(got.payload, GOOD, "the legacy canonical must win");
    }

    /* The other reading of the same bytes: a canonical torn down past its `gen`
     * line also parses as legacy, but only as the bare tag. That must fall
     * through to the shadows rather than blank the Set. */
    #[test]
    fn bare_tag_canonical_falls_through_to_shadows() {
        let s = tmp("baretag");
        fs::create_dir_all(s.set_dir("u1")).unwrap();
        fs::write(s.state_path("u1"), BLANK_STATE).unwrap();
        fs::write(s.shadow_path("u1", 1), wrap(GOOD, 5)).unwrap();
        assert_eq!(s.read_best("u1").expect("reads").payload, GOOD);
    }

    #[test]
    fn torn_canonical_recovers_from_the_newest_shadow() {
        let s = tmp("recover");
        fs::create_dir_all(s.set_dir("u1")).unwrap();
        fs::write(s.state_path("u1"), "movy1\ngen 9\ntruncated").unwrap();
        fs::write(s.shadow_path("u1", 1), wrap("movy1\nbpm 11000\n", 3)).unwrap();
        fs::write(s.shadow_path("u1", 2), wrap(GOOD, 4)).unwrap();
        assert_eq!(s.read_best("u1").expect("reads").gen, 4);
    }

    /* Spec §5: a Set the user merely visited must leave NO trace, or every
     * switch reads as a Set-with-state and the deleted-Set bug returns. */
    #[test]
    fn a_blank_set_writes_nothing() {
        let s = tmp("blank");
        s.write("u1", BLANK_STATE, 1, "0\n").unwrap();
        assert!(!s.set_dir("u1").exists(), "no directory for an empty Set");
        assert!(!s.has_state("u1"));
    }

    /* …but chains alone are content: a user who built a chain and played no
     * notes has state worth keeping. */
    #[test]
    fn chains_alone_count_as_state() {
        let s = tmp("chainsonly");
        s.write("u1", BLANK_STATE, 1, "5\n1\n0\n5\nsynth\n10\nnoisemaker\n4\nblob\n15\n1.0000,0.0000,0").unwrap();
        assert!(s.has_state("u1"));
        assert!(s.read_chains("u1").is_some());
    }

    #[test]
    fn seed_copies_state_and_chains() {
        let s = tmp("seed");
        s.write("src", GOOD, 4, "0\n").unwrap();
        assert!(s.seed("dst", "src"));
        assert_eq!(s.read_best("dst").expect("reads").payload, GOOD);
        assert_eq!(s.read_best("dst").expect("reads").gen, 1, "a seed lands at gen 1");
    }

    #[test]
    fn seed_from_a_missing_source_does_nothing() {
        let s = tmp("seedmiss");
        assert!(!s.seed("dst", "nope"));
        assert!(!s.set_dir("dst").exists());
    }
}
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd movy/engine && ~/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo test -p movy-dsp set_store
```

Expected: FAIL on `unimplemented!()`.

- [ ] **Step 3: Implement**

```rust
//! One Set's files, owned by the engine.
//!
//! `host_write_file` is fopen("w")+fwrite+fclose — no rename, no fsync, no
//! unlink — which is the whole reason `persist-store.ts` built crash-safety out
//! of redundancy: two rotating shadows and a read-back-and-compare that its own
//! comment concedes "is not fsync". Rust has the real primitives, so the
//! canonical file arrives by rename and the shadows stop being written.
//!
//! They are still READ. A device carries Sets written by every movy it has ever
//! run, and the precedence rule between them is load-bearing — see
//! `legacy_canonical_with_content_beats_a_higher_shadow`.

use crate::set_envelope::{parse, wrap, Parsed, BLANK_STATE};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

pub struct SetStore {
    root: PathBuf,
}

/// Content worth a file. A Set the user merely visited must leave no trace.
pub fn is_blank(payload: &str, chains: &str) -> bool {
    payload.len() <= BLANK_STATE.len() && chains.trim() == "0"
}

/// Write-temp → fsync → rename. The rename is atomic on the device's
/// filesystem, so a reader never sees a partial canonical file.
fn atomic_write(path: &Path, content: &str) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    {
        let mut f = fs::File::create(&tmp).map_err(|e| format!("create {tmp:?}: {e}"))?;
        f.write_all(content.as_bytes()).map_err(|e| format!("write {tmp:?}: {e}"))?;
        f.sync_all().map_err(|e| format!("fsync {tmp:?}: {e}"))?;
    }
    fs::rename(&tmp, path).map_err(|e| format!("rename {tmp:?} -> {path:?}: {e}"))
}

impl SetStore {
    pub fn new(root: &str) -> Self {
        SetStore { root: PathBuf::from(root) }
    }

    pub fn set_dir(&self, uuid: &str) -> PathBuf {
        self.root.join(if uuid.is_empty() { "_default" } else { uuid })
    }
    pub fn state_path(&self, uuid: &str) -> PathBuf {
        self.set_dir(uuid).join("seq-state.json")
    }
    pub fn shadow_path(&self, uuid: &str, slot: u8) -> PathBuf {
        self.set_dir(uuid).join(format!("seq-state.{slot}.json"))
    }
    pub fn chains_path(&self, uuid: &str) -> PathBuf {
        self.set_dir(uuid).join("chains.json")
    }

    /// Does this Set own state? Existence only — the UI asks the same question
    /// of the same paths, and both must agree without either parsing anything.
    pub fn has_state(&self, uuid: &str) -> bool {
        self.state_path(uuid).exists() || self.chains_path(uuid).exists()
    }

    pub fn read_best(&self, uuid: &str) -> Option<Parsed> {
        let canon = fs::read_to_string(self.state_path(uuid)).ok().and_then(|s| parse(&s));

        if let Some(c) = &canon {
            if c.legacy && c.payload.len() > BLANK_STATE.len() {
                return canon;
            }
        }

        let mut best = canon;
        for slot in [1u8, 2] {
            let c = fs::read_to_string(self.shadow_path(uuid, slot)).ok().and_then(|s| parse(&s));
            if let Some(c) = c {
                if best.as_ref().map_or(true, |b| c.gen > b.gen) {
                    best = Some(c);
                }
            }
        }
        best
    }

    pub fn read_chains(&self, uuid: &str) -> Option<String> {
        fs::read_to_string(self.chains_path(uuid)).ok()
    }

    pub fn write(&self, uuid: &str, payload: &str, gen: u32, chains: &str) -> Result<(), String> {
        if is_blank(payload, chains) {
            return Ok(());
        }
        let dir = self.set_dir(uuid);
        fs::create_dir_all(&dir).map_err(|e| format!("mkdir {dir:?}: {e}"))?;
        atomic_write(&self.state_path(uuid), &wrap(payload, gen))?;
        atomic_write(&self.chains_path(uuid), chains)
    }

    /// Copy-on-inherit: the UI names the source (name policy stays in
    /// `set-inherit.ts`), the engine moves the bytes. A seed lands at gen 1 so
    /// the copy owns its own sequence from here on.
    pub fn seed(&self, dst: &str, src: &str) -> bool {
        let Some(state) = self.read_best(src) else { return false };
        let chains = self.read_chains(src).unwrap_or_else(|| "0\n".to_string());
        self.write(dst, &state.payload, 1, &chains).is_ok()
    }
}
```

Add `mod set_store;` to `lib.rs`.

- [ ] **Step 4: Run to verify they pass**

```bash
cd movy/engine && ~/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo test -p movy-dsp set_store
```

Expected: PASS, 9 tests.

- [ ] **Step 5: Prove the teeth**

Delete the `if c.legacy && …` early return from `read_best` and re-run: `legacy_canonical_with_content_beats_a_higher_shadow` must fail. Replace `atomic_write`'s rename with a direct `fs::write` to `path` and re-run: `never_leaves_a_partial_canonical`'s temp-file assertion must still pass (it writes no temp) but the guard is now vacuous — so ALSO confirm by adding a deliberate `fs::write(path.with_extension("tmp"), "x")` before the write, watching the test fail, and removing it. Revert everything.

- [ ] **Step 6: Commit**

```bash
git add engine/crates/movy-dsp/src/set_store.rs engine/crates/movy-dsp/src/lib.rs
git commit -m "engine: atomic Set storage with the precedence rule"
```

---

### Task 3: The engine serializes its own chains

Today a chain's module ids cross as `chain_doc`, while its preset blobs, LFO state and mixer triple cross on schwung's bulk channel — 100 ms, no retry, serviced on the thread a cold `dlopen` holds for up to 428 ms. `chain-payload.ts` records what that cost: every payload write timing out, every module at shipped defaults, and the next capture writing those defaults into the Set file. The far end of that channel is this engine. It can read its own modules with no IPC at all.

**Files:**
- Create: `engine/crates/movy-dsp/src/chain_state.rs`
- Modify: `engine/crates/movy-dsp/src/lib.rs` (`mod chain_state;`)
- Test: inline `#[cfg(test)] mod tests` in `chain_state.rs`

**Interfaces:**
- Consumes: `chain_doc::{Entry, decode}`, `chain_slots::ChainSlots` (`chain_set()`, `set_chain_set(doc)`, `get_param(slot, key)`, `set_state(slot, component, state)`, `mix_csv(slot)`, `set_mix(slot, TrackMix)`), and `parse_mix` from `lib.rs` — which is private today and must be widened to `pub(crate)` so this module can call it. The mix CSV is `gain,pan,muted[,send…]` with 4-decimal floats (`chain_slots.rs:887`); the "gain.pan.muted" in `lib.rs:392`'s comment is loose prose, not the format.
- Produces:
  - `pub fn serialize(slots: &mut crate::chain_slots::ChainSlots) -> String`
  - `pub fn restore(slots: &mut crate::chain_slots::ChainSlots, doc: &str) -> bool`

**Format.** One flat length-prefixed document, `<count>\n` then `<count>` items of `<byte-len>\n<bytes>`, exactly as `chain_doc` and `bulk.ts` already speak it. Items come in fives: `slot`, `component`, `module`, `state`, `extra`, where `extra` is the mixer CSV on a chain's first component and empty otherwise. `slot` is `s<N>` for a send bus and a plain integer for a chain. This is the same codec `decodeBulk` reads in TypeScript, which is what makes the mirror in Task 6 free.

- [ ] **Step 1: Write the failing tests**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::chain_doc;

    /* A hand-built document stands in for a live ChainSlots: these tests pin
     * the FORMAT, which is the half TypeScript has to agree with. The
     * round-trip against real slots is a device concern (test-seq.sh). */
    fn doc(items: &[&str]) -> String {
        let mut out = format!("{}\n", items.len());
        for it in items {
            out.push_str(&format!("{}\n{}", it.len(), it));
        }
        out
    }

    #[test]
    fn an_empty_set_is_the_count_zero_document() {
        assert_eq!(parse_items("0\n"), Some(vec![]));
    }

    #[test]
    fn reads_back_what_it_writes() {
        let d = doc(&["0", "synth", "noisemaker", "preset-blob", "1.0000,0.0000,0"]);
        let items = parse_items(&d).expect("parses");
        assert_eq!(items.len(), 5);
        assert_eq!(items[2], "noisemaker");
        assert_eq!(items[4], "1.0000,0.0000,0");
    }

    /* A preset blob is arbitrary bytes. The length prefix is the whole reason
     * this format was chosen over JSON: no escaping, nothing to get wrong. */
    #[test]
    fn a_blob_containing_newlines_and_quotes_survives() {
        let nasty = "a\nb\"c\\d\ne";
        let d = doc(&["0", "synth", "m", nasty, ""]);
        assert_eq!(parse_items(&d).expect("parses")[3], nasty);
    }

    /* chain_doc's rule, restated because it is the §3 hazard in another file:
     * a malformed document is NOT an empty set. Reading it as one would hand
     * the save a set with no chains and delete the user's work. */
    #[test]
    fn a_truncated_document_is_none_not_empty() {
        assert!(parse_items("5\n4\nsynth").is_none());
        assert!(parse_items("notanumber\n").is_none());
    }

    #[test]
    fn an_item_count_that_is_not_a_multiple_of_five_is_rejected() {
        assert!(parse_items(&doc(&["0", "synth", "m"])).is_none());
    }
}
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd movy/engine && ~/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo test -p movy-dsp chain_state
```

Expected: FAIL — `parse_items` does not exist.

- [ ] **Step 3: Implement**

```rust
//! The whole chain set as one document the engine can write by itself.
//!
//! `chain_doc` carries slot/component/module — what a LOAD needs. This carries
//! what a SAVE needs as well: the module's preset blob, the mixer triple, and
//! the sends. Those travel on schwung's bulk channel today, which waits 100 ms
//! without retrying while the audio thread is held by a cold dlopen; when they
//! time out the modules come up at shipped defaults and the next capture writes
//! those defaults over the user's patch (`src/track/chain-payload.ts`).
//!
//! The far end of that channel is this engine, so none of it needs to move at
//! all. Same flat length-prefixed codec as `chain_doc` and `src/track/bulk.ts`:
//! no escaping, so a preset blob containing anything survives.

use crate::chain_slots::ChainSlots;

const FIELDS: usize = 5;

fn put(out: &mut String, s: &str) {
    out.push_str(&format!("{}\n{}", s.len(), s));
}

/// Split a document into its flat item list. `None` — never an empty list —
/// when the payload is malformed: a truncated document read as "no chains"
/// would clear the set.
pub fn parse_items(doc: &str) -> Option<Vec<String>> {
    let s = doc.as_bytes();
    let nl = s.iter().position(|&c| c == b'\n')?;
    let count: usize = std::str::from_utf8(&s[..nl]).ok()?.parse().ok()?;
    if count % FIELDS != 0 {
        return None;
    }
    let mut p = nl + 1;
    let mut out = Vec::with_capacity(count);
    for _ in 0..count {
        let start = p;
        let nl = s[start..].iter().position(|&c| c == b'\n')? + start;
        let len: usize = std::str::from_utf8(&s[start..nl]).ok()?.parse().ok()?;
        let from = nl + 1;
        let to = from.checked_add(len)?;
        if to > s.len() {
            return None;
        }
        out.push(String::from_utf8_lossy(&s[from..to]).into_owned());
        p = to;
    }
    Some(out)
}

/// Everything about the chains and sends, in one document.
pub fn serialize(slots: &mut ChainSlots) -> String {
    let entries = crate::chain_doc::decode(&slots.chain_set()).unwrap_or_default();
    let mut items: Vec<String> = Vec::new();
    let mut seen_slot: Option<usize> = None;
    for e in entries {
        let state = slots
            .get_param(e.slot, &format!("{}:state", e.component))
            .unwrap_or_default();
        // The mixer triple belongs to the CHAIN, so it rides its first
        // component rather than being repeated on every one.
        let extra = if seen_slot == Some(e.slot) {
            String::new()
        } else {
            seen_slot = Some(e.slot);
            slots.mix_csv(e.slot).unwrap_or_default()
        };
        items.push(e.slot.to_string());
        items.push(e.component.clone());
        items.push(e.module.clone());
        items.push(state);
        items.push(extra);
    }
    let mut out = format!("{}\n", items.len());
    for it in &items {
        put(&mut out, it);
    }
    out
}

/// Apply a document read from disk. `false` when it is malformed — the caller
/// must leave the live set alone rather than clearing it.
pub fn restore(slots: &mut ChainSlots, doc: &str) -> bool {
    let Some(items) = parse_items(doc) else { return false };
    let mut load_doc: Vec<String> = Vec::new();
    for c in items.chunks(FIELDS) {
        load_doc.push(c[0].clone());
        load_doc.push(c[1].clone());
        load_doc.push(c[2].clone());
    }
    let mut ld = format!("{}\n", load_doc.len());
    for it in &load_doc {
        put(&mut ld, it);
    }
    if !slots.set_chain_set(&ld) {
        return false;
    }
    // States and mixes are applied after the loads are REQUESTED: ChainSlots
    // holds `desired`, so a state written now is attached to the queued load
    // rather than racing it.
    for c in items.chunks(FIELDS) {
        let Ok(slot) = c[0].parse::<usize>() else { continue };
        if !c[3].is_empty() {
            slots.set_state(slot, &c[1], &c[3]);
        }
        if !c[4].is_empty() {
            if let Some(mix) = crate::parse_mix(&c[4]) {
                slots.set_mix(slot, mix);
            }
        }
    }
    true
}
```

Add `mod chain_state;` to `lib.rs`.

- [ ] **Step 4: Run to verify they pass**

```bash
cd movy/engine && ~/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo test -p movy-dsp chain_state
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Prove the teeth**

Change `parse_items` to return `Some(vec![])` instead of `None` on a short read (the §3 shape). `a_truncated_document_is_none_not_empty` must fail. Revert.

- [ ] **Step 6: Commit**

```bash
git add engine/crates/movy-dsp/src/chain_state.rs engine/crates/movy-dsp/src/lib.rs
git commit -m "engine: serialize the whole chain set, preset blobs included"
```

---

### Task 4: The saver thread and the `set` command key

**Files:**
- Create: `engine/crates/movy-dsp/src/set_saver.rs`
- Modify: `engine/crates/movy-dsp/src/lib.rs` — `mod set_saver;`, the `set_param` match (beside `"chains"` at :356 and `"state"` at :362), the `get_param` match (beside `"status"` at :432), and `ENGINE_VERSION` at :120 (`0.73.0` → `0.74.0`)
- Test: inline `#[cfg(test)] mod tests` in `set_saver.rs`

**Interfaces:**
- Consumes: `set_store::SetStore`, `chain_state::{serialize, restore}`, `seq_core::persist::{serialize, load}`.
- Produces:
  - `pub enum Job { Open { uuid: String, seed: Option<String> }, Rename { from: String, to: String }, Blank { uuid: String }, Save { uuid: String, payload: String, gen: u32, chains: String }, Flush }`
  - `pub struct Saver` with `pub fn new(root: &str) -> Saver`, `pub fn submit(&self, job: Job)`, `pub fn status(&self) -> String`, `pub fn take_loaded(&self) -> Option<(String, String, u32)>`
  - The `set` param key: `open <uuid> [seed=<src>]`, `rename <from> <to>`, `blank <uuid>`, `flush`.
  - The `setsdir <path>` param key.
  - Status line: `uuid=<id> phase=opening|ready|failed gen=<n> chains=<n> dirty=<0|1> [reason=<text>]`

- [ ] **Step 1: Write the failing tests**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> String {
        let d = std::env::temp_dir().join(format!("movy-saver-{name}"));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d.to_str().unwrap().to_string()
    }

    /* Commands are parsed on the audio thread and executed on the saver
     * thread, so parsing must be total: an unknown or malformed command is
     * ignored, never a panic in someone else's audio callback. */
    #[test]
    fn parses_every_command() {
        assert!(matches!(parse_cmd("open abc"), Some(Job::Open { .. })));
        assert!(matches!(parse_cmd("open abc seed=def"), Some(Job::Open { seed: Some(_), .. })));
        assert!(matches!(parse_cmd("rename a b"), Some(Job::Rename { .. })));
        assert!(matches!(parse_cmd("blank a"), Some(Job::Blank { .. })));
        assert!(matches!(parse_cmd("flush"), Some(Job::Flush)));
        assert!(parse_cmd("open").is_none());
        assert!(parse_cmd("nonsense a b c").is_none());
        assert!(parse_cmd("").is_none());
    }

    #[test]
    fn open_of_an_unknown_set_reports_ready_with_no_state() {
        let s = Saver::new(&tmp("unknown"));
        s.submit(Job::Open { uuid: "u1".into(), seed: None });
        s.drain_for_test();
        assert!(s.status().contains("uuid=u1"));
        assert!(s.status().contains("phase=ready"));
        assert!(s.take_loaded().is_none(), "no state means nothing to apply");
    }

    #[test]
    fn a_saved_set_comes_back_on_open() {
        let root = tmp("roundtrip");
        let s = Saver::new(&root);
        s.submit(Job::Save {
            uuid: "u1".into(),
            payload: "movy1\nbpm 12000\n".into(),
            gen: 1,
            chains: "0\n".into(),
        });
        s.submit(Job::Flush);
        s.drain_for_test();

        let s2 = Saver::new(&root);
        s2.submit(Job::Open { uuid: "u1".into(), seed: None });
        s2.drain_for_test();
        let (payload, _chains, gen) = s2.take_loaded().expect("loaded");
        assert_eq!(payload, "movy1\nbpm 12000\n");
        assert_eq!(gen, 1);
    }

    /* The escape hatch's own safety: an open that fails must SAY so, because
     * the UI's only recovery (blank the Set) is scoped to a set-level failure
     * and must never fire for an engine-level one. */
    #[test]
    fn an_unreadable_set_reports_failed_with_a_reason() {
        let root = tmp("failed");
        let s = Saver::new(&root);
        std::fs::create_dir_all(format!("{root}/u1")).unwrap();
        std::fs::write(format!("{root}/u1/seq-state.json"), "movy1\ngen 4\ntorn").unwrap();
        s.submit(Job::Open { uuid: "u1".into(), seed: None });
        s.drain_for_test();
        let st = s.status();
        assert!(st.contains("phase=failed"), "got {st}");
        assert!(st.contains("reason="), "got {st}");
    }

    #[test]
    fn dirty_clears_once_the_save_has_landed() {
        let s = Saver::new(&tmp("dirty"));
        s.submit(Job::Save {
            uuid: "u1".into(),
            payload: "movy1\nbpm 12000\n".into(),
            gen: 1,
            chains: "0\n".into(),
        });
        assert!(s.status().contains("dirty=1"));
        s.drain_for_test();
        assert!(s.status().contains("dirty=0"));
    }
}
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd movy/engine && ~/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo test -p movy-dsp set_saver
```

Expected: FAIL — nothing is implemented.

- [ ] **Step 3: Implement the saver**

Write `set_saver.rs` with:

- `Job` as in the Interfaces block.
- `Saver` holding `tx: std::sync::mpsc::Sender<Job>`, a `std::sync::Arc<std::sync::Mutex<State>>` for the status and the loaded-state handoff, and the `JoinHandle`.
- `Saver::new(root)` spawns one `std::thread` that owns a `SetStore` and loops on `rx.recv()`. `render_pool.rs` is the precedent for thread ownership in this crate; `midi_out.rs:312` for a detached one.
- `submit` marks `dirty=1` for a `Save` and sends. It must never block: `Sender::send` on an unbounded channel does not.
- `drain_for_test()` — `#[cfg(test)]` only — submits a sentinel and blocks until the worker acknowledges, so tests are deterministic without sleeping.
- `parse_cmd(&str) -> Option<Job>` — total, no panics.
- `status()` formats the line in the Interfaces block from the shared state.
- `take_loaded()` returns and clears `(payload, chains, gen)` for the audio thread to apply.

- [ ] **Step 4: Wire it into `lib.rs`**

In `Instance`, add `saver: Option<set_saver::Saver>`.

In `set_param`, beside the existing `"chains"` and `"state"` arms:

```rust
/* Where the Set files live. The UI owns the path (set-context.ts) and the
 * engine is told it, rather than hardcoding: the host tests run against a
 * tmpdir, and a hardcoded path is untestable anywhere but the device. */
"setsdir" => {
    self.saver = Some(set_saver::Saver::new(val));
}
/* Commands, not payloads. A lost command is harmless and idempotent on
 * retry — an engine that has not opened a Set cannot overwrite one —
 * where the `state` write this replaces destroyed data when it was lost.
 * Parsed here (audio thread), executed on the saver thread. */
"set" => {
    if let (Some(s), Some(job)) = (&self.saver, set_saver::parse_cmd(val)) {
        s.submit(job);
    }
}
```

In `get_param`, beside `"status"`:

```rust
"set" => Some(self.saver.as_ref().map_or_else(
    || "phase=failed reason=no-setsdir".to_string(),
    |s| s.status(),
)),
```

In the per-block service path that already calls `self.chains.service_loads()`, apply a landed open and take an autosave snapshot. Both are cheap and neither touches the filesystem:

```rust
/* The saver hands back bytes; APPLYING them is engine work and belongs on
 * this thread. seq_core::persist::load resets before applying, so a failed
 * open leaves the previous Set rather than a half-applied one. */
if let Some(s) = &self.saver {
    if let Some((payload, chains, _gen)) = s.take_loaded() {
        if seq_core::persist::load(&mut self.engine, &payload) {
            self.engine.dirty = false;
        }
        if !chain_state::restore(&mut self.chains, &chains) {
            host::log("set: malformed chains.json ignored");
        }
    }
    /* The engine's own dirty flag decides when to save — no UI trigger, and
     * no read that clears the flag as a side effect. */
    if self.engpersist && self.engine.dirty && self.save_due() {
        s.submit(set_saver::Job::Save {
            uuid: self.set_uuid.clone(),
            payload: seq_core::persist::serialize(&self.engine),
            gen: self.set_gen + 1,
            chains: chain_state::serialize(&mut self.chains),
        });
        self.set_gen += 1;
        self.engine.dirty = false;
    }
}
```

Add an `"engpersist"` arm to `set_param` setting `self.engpersist = val != "0"`, defaulting `false`. Bump `ENGINE_VERSION` to `0.74.0`.

- [ ] **Step 5: Run the whole crate's tests**

```bash
cd movy/engine && ~/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo test
```

Expected: PASS, including every pre-existing test.

- [ ] **Step 6: Prove the teeth**

With `engpersist` left at its default `false`, confirm `dirty_clears_once_the_save_has_landed` still passes (it drives the saver directly) but that no Save is submitted from the block path — add a temporary counter, run `cargo test`, confirm zero, remove it. This is the assertion that the flag actually gates the new path; without it the flag is decorative and both halves write.

- [ ] **Step 7: Commit**

```bash
git add engine/crates/movy-dsp/src/set_saver.rs engine/crates/movy-dsp/src/lib.rs
git commit -m "engine: saver thread and the set command key"
```

---

### Task 5: TypeScript sends commands instead of state

**Files:**
- Modify: `src/seq/flags-def.ts` (add the `engpersist` entry to `FLAGS`)
- Modify: `src/seq/set-load.ts` (`pushState` → command path)
- Modify: `src/seq/set-save.ts` (skip the state write when the flag is on)
- Modify: `src/seq/set-session.ts` (send `setsdir` once the engine is ready)
- Test: `browser-test/logic/set-restore-loss.mjs` (new cases), run by `browser-test/logic.mjs`

**Interfaces:**
- Consumes: the `set` and `setsdir` param keys and the status line from Task 4.
- Produces: `export function openSet(id: string, seed: string | null): void` and `export function setStatusUuid(): string | null` in `set-load.ts`.

- [ ] **Step 1: Add the flag**

In `src/seq/flags-def.ts`, append to `FLAGS`:

```ts
{
    key: 'engpersist', name: 'Engine Saves',
    hint: 'The engine owns the set file. OFF is the old path.',
    // WHO WRITES THE SET FILES.
    //
    // Off, the UI ferries the whole Set through the overtake_dsp param slot
    // and writes it — the shape every hazard in docs/persistence-hazards.md
    // is about. On, the engine reads and writes its own files and the wire
    // carries only commands.
    //
    // A runtime switch, so "on, then off again" is an ordinary afternoon: the
    // chains mirror in ui-state.json (set-save.ts) is what makes going back
    // free. Default 0 until the device run; flipping it later needs a
    // FLAGS_REV bump or a stored 0 beats the new default forever.
    min: 0, max: 1, def: 0,
},
```

- [ ] **Step 2: Write the failing test**

Append to `browser-test/logic/set-restore-loss.mjs`:

```js
/* With the engine owning the files, a lost command costs nothing: the engine
 * simply has not opened the Set, so there is no way for it to overwrite one.
 * This is the whole safety argument for commands-instead-of-payloads, and it
 * is the assertion that would have caught §2 before it shipped. */
export async function testLostOpenCommandDestroysNothing() {
    installMockFs();
    installMockEngine({ engpersist: 1 });
    writeStateBlob('u1', GOOD, 1);

    await withDroppedSetCommand(async () => {
        openSet('u1', null);
        await tickUntilIdle();
        saveSet('u1', 1, true);
    });

    eq(readBestState('u1').payload, GOOD, 'a dropped open must not cost the Set');
    ok(setStatusUuid() !== 'u1', 'and the UI must know the Set is not open');
    uninstallMockEngine();
    uninstallMockFs();
}
```

Add `withDroppedSetCommand` beside the existing `withDroppedStateWrite`, dropping writes whose key is `set` rather than `state`.

- [ ] **Step 3: Run to verify it fails**

```bash
cd movy && node browser-test/logic.mjs
```

Expected: FAIL — `openSet` is not exported.

- [ ] **Step 4: Implement the command path**

In `src/seq/set-load.ts`, keep `pushState` for the flag-off path and add:

```ts
/* The Set the engine says it has open, or null when it has not answered.
 * `null` means UNKNOWN and must never be read as "not this Set": the caller
 * retries, and retrying an open is free. */
export function setStatusUuid(): string | null {
    if (typeof host_module_get_param !== 'function') return null;
    const s = host_module_get_param('set');
    if (s === null) return null;
    const m = s.match(/(?:^| )uuid=(\S*)/);
    return m ? m[1] : null;
}

/* Commands, not payloads. The engine reads its own files, so nothing about the
 * Set crosses the slot — and a command that is lost is re-sent by the status
 * comparison in set-session, which is the same push-by-comparison `syncWatch`
 * already uses for the watched track. */
export function openSet(id: string, seed: string | null): void {
    if (typeof host_module_set_param_blocking !== 'function') return;
    host_module_set_param_blocking('set', 'open ' + id + (seed ? ' seed=' + seed : ''), 200);
    requestLabelSync();
}
```

In `loadSet`, branch on `flagValue('engpersist')`: when on, call `openSet(id, findInheritCandidates(name, loadNameIndex())[0]?.uuid ?? null)` and return without reading or pushing any state; when off, take today's path unchanged.

In `set-save.ts`, when the flag is on, skip the `host_module_get_param('state')` read and the `writeStateBlob` call entirely — the engine is saving — and keep writing the UI blob (Task 6 supplies its chains).

In `set-session.ts`, push `setsdir` with `SETS_DIR` once per engine generation, beside the existing per-generation setup, so a re-`dlopen`ed engine is told again.

- [ ] **Step 5: Run to verify it passes**

```bash
cd movy && node browser-test/logic.mjs
```

Expected: PASS, and every pre-existing case in the file still passes.

- [ ] **Step 6: Prove the teeth**

Make `openSet` fall back to `pushState` when the command write returns false. `testLostOpenCommandDestroysNothing` must fail (the fallback re-introduces the payload). Revert.

- [ ] **Step 7: Commit**

```bash
git add src/seq/flags-def.ts src/seq/set-load.ts src/seq/set-save.ts src/seq/set-session.ts browser-test/logic/set-restore-loss.mjs
git commit -m "movy: send set commands instead of state, behind engpersist"
```

---

### Task 6: The compatibility mirror

`engpersist` is only an escape hatch if going back is free. A build with the flag off looks for the chains inside `ui-state.json`; if nothing puts them there, flipping back costs the user their chains.

**Files:**
- Modify: `src/seq/ui-state.ts` (`serializeUiState`)
- Modify: `src/seq/flags.ts` (the 1 → 0 transition)
- Create: `src/track/chain-mirror.ts`
- Test: `browser-test/logic/set-state.mjs`

**Interfaces:**
- Consumes: `chains.json` in the format Task 3 writes; `decodeBulk` from `src/track/bulk.ts`.
- Produces: `export function mirrorFromFile(uuid: string): { chains: ChainTrackState[]; sends: SendState[] } | null` in `src/track/chain-mirror.ts`.

- [ ] **Step 1: Write the failing test**

Append to `browser-test/logic/set-state.mjs`:

```js
/* The flag is an escape hatch only if going back is free. */
export async function testMirrorLetsTheFlagGoBack() {
    installMockFs();
    installMockEngine({ engpersist: 1 });

    writeChainsFile('u1', ['0', 'synth', 'noisemaker', 'blob-A', '1.0000,0.0000,0']);
    saveSet('u1', 1, true);

    const ui = JSON.parse(readUiBlob('u1'));
    eq(ui.chains[0].comp[0].m, 'noisemaker', 'the mirror carries the module');
    eq(ui.chains[0].comp[0].s, 'blob-A', 'and the preset blob');
}

/* An unreadable chains.json must never write [] — that is §3 in a new hat. */
export async function testUnreadableChainsLeavesTheMirrorAlone() {
    installMockFs();
    installMockEngine({ engpersist: 1 });

    writeChainsFile('u1', ['0', 'synth', 'noisemaker', 'blob-A', '1.0000,0.0000,0']);
    saveSet('u1', 1, true);
    corruptChainsFile('u1');
    saveSet('u1', 2, true);

    const ui = JSON.parse(readUiBlob('u1'));
    eq(ui.chains[0].comp[0].m, 'noisemaker', 'the previous mirror must survive');
}
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd movy && node browser-test/logic.mjs
```

Expected: FAIL — `writeChainsFile` and the mirror do not exist.

- [ ] **Step 3: Implement**

`src/track/chain-mirror.ts` reads `chains.json` with `host_read_file`, decodes it with the existing `decodeBulk`, walks the five-field records and rebuilds the same `ChainTrackState[]` / `SendState[]` shapes `captureChains`/`captureSends` produce today. On a null read or a null decode it returns `null` — never `[]`.

In `serializeUiState`, when `engpersist` is on, replace `captureChains(chainDoc)` / `captureSends(chainDoc)` with the mirror's values, and when the mirror is `null` reuse the values already on disk (`readUiBlob` → parse → keep `chains`/`sends`). Remove the `readChainDoc()` call from that path entirely — it is the engine GET the spec exists to delete.

In `src/seq/flags.ts`, when `engpersist` transitions 1 → 0, send `set flush`, wait for `dirty=0` or a bounded number of ticks, then force a UI-blob write so the mirror is current before the old path reads it.

- [ ] **Step 4: Run to verify they pass**

```bash
cd movy && node browser-test/logic.mjs
```

Expected: PASS.

- [ ] **Step 5: Prove the teeth**

Make `mirrorFromFile` return `{ chains: [], sends: [] }` instead of `null` on a failed read. `testUnreadableChainsLeavesTheMirrorAlone` must fail. Revert.

- [ ] **Step 6: Commit**

```bash
git add src/track/chain-mirror.ts src/seq/ui-state.ts src/seq/flags.ts browser-test/logic/set-state.mjs
git commit -m "movy: mirror the engine's chains into ui-state.json"
```

---

### Task 7: Flip the known gap, and the gate

**Files:**
- Modify: `browser-test/logic/set-restore-loss.mjs` (the §3 KNOWN GAP assertion)
- Modify: `docs/persistence-hazards.md`, `CHANGELOG.md`, `MANUAL.md`
- Test: the full local gate

- [ ] **Step 1: Flip the KNOWN GAP assertion**

`set-restore-loss.mjs` pins §3 as a KNOWN GAP — an assertion that encodes the bug rather than the desired behaviour, with the instruction *"Flip it when fixing; do not delete it."* With `engpersist` on there is no chain read to fail, so the assertion becomes the real one: an unreadable chain set must leave the chains alone. Flip it, keeping the flag-off case asserting the old behaviour.

- [ ] **Step 2: Run the full local gate**

```bash
cd movy && npm test
cd movy/engine && ~/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo test
```

Expected: 0 failures. If UI rendering changed at all (it should not have): `node browser-test/screenshot.mjs --update` first.

- [ ] **Step 3: Update the docs**

- `docs/persistence-hazards.md`: §2/§3/§4 gain a line naming the flag that closes them and pointing at the spec. Do not delete the sections — they are the record of how the bugs were found.
- `CHANGELOG.md`: the flag, what it changes, and the downgrade note — a Set saved with the flag ON keeps its chains in `chains.json`, and the mirror is what an older build reads.
- `MANUAL.md`: the Global Params row, one sentence.

- [ ] **Step 4: Deploy and run the device suites**

```bash
cd movy && ./scripts/deploy.sh && ./scripts/test-seq.sh
```

`test-seq.sh` builds and deploys `dsp.so`, which this plan changes, so it is the required suite. Device tests are FLAKY: run each once, read the output for a regression in what changed, and report anything else to the user rather than chasing it. **If `move.local` is unreachable, say so IN CAPS** — device verification was skipped and the flag must not be flipped on without it.

- [ ] **Step 5: Commit and push**

```bash
git add browser-test/logic/set-restore-loss.mjs docs/persistence-hazards.md CHANGELOG.md MANUAL.md
git commit -m "movy: close the §3 gap behind engpersist, and document it"
git push
```

---

## Self-Review

**Spec coverage.** §2 principle → Tasks 5-6 keep the policy in TS. §3 wire → Tasks 4-5. §4 threading → Task 4. §5 files → Tasks 2-3, including the blank-Set rule (Task 2 test) and `seed=` for copy-on-inherit (Task 2 + Task 5). §6 format → Task 1. §6.1 mirror → Task 6. §7 versions and GC → **deliberately deferred to a second plan**, stated under Scope. §8 deletions → happen across Tasks 5-6; the old path is removed only in the release that flips the default, which is why nothing here deletes `persist-store.ts`. §9 errors → Task 4's `failed`/`reason` test and Task 5's unknown-status rule. §10 testing → Tasks 1-7. §12 rollout steps 1-4 → Tasks 1-7.

**Known gaps in this plan, stated rather than hidden:**

- Task 4 Step 3 describes `Saver`'s internals in prose rather than in full code. It is the one place where the exact shape depends on decisions best made against the compiler (channel type, where the `Arc<Mutex<…>>` boundary falls). The interface it must satisfy is fully specified, and its tests are written, so the contract is pinned even though the body is not.
- Task 3's tests pin the FORMAT, not a round-trip against a live `ChainSlots`. Constructing real slots needs a loaded chain host, which is a device concern — `test-seq.sh` in Task 7 Step 4 is where the round-trip is actually exercised.
