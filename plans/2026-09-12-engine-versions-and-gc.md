# Engine-Owned Versions and GC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Set version history and the dead-Set sweep out of TypeScript into the Rust engine, behind the `engpersist` flag, so the engine owns every file under `sets/<uuid>/`.

**Architecture:** The engine already owns `seq-state.json` and `chains.json` on a saver thread (`set_saver.rs`). This step gives the same thread the version ladder (`versions.json` + `v/<n>/`) and a `read_dir`-based sweep. Four of the six capture moments — `open`, `adopted`, `auto`, `pre-wipe` — stop crossing the wire entirely, because the jobs that overwrite state are the jobs that capture. Only `keep exit`, `restore <n>` and `gc …` are commands. The UI reads the menu through a new `versions` GET instead of the file, and a restore comes back through `vui`.

**Tech Stack:** Rust (`engine/crates/movy-dsp`, zero external dependencies), TypeScript (`movy/src`), node host suites (`browser-test/logic/*.mjs`), `cargo test`, device scripts under `scripts/`.

**Spec:** `docs/superpowers/specs/2026-09-11-engine-owned-persistence-design.md` — §7 is this step, and its four bullets under "Decided when the step was planned" are the decisions this plan implements. Read §5 (files), §6 (format) and §12 (rollout) too.

**Predecessor:** `plans/2026-09-12-engine-owned-persistence.md` (steps 1-4, DONE). Its Tasks 1-4 built `set_envelope.rs`, `set_store.rs`, `chain_state.rs` and `set_saver.rs` — this plan extends those files rather than introducing a new subsystem.

## Global Constraints

- **`movy-dsp` has zero external dependencies.** No `serde`, no `serde_json`, no tempfile crate. `versions.json` is parsed and written by hand — see Task 1.
- **`versions.json` keeps its current JSON shape and key order** (`{"next":N,"v":[{"n":..,"gen":..,"ms":..,"why":"..","clips":..,"ui":..,"ch":..}]}`). Both halves must read each other's file, because the flag is an escape hatch in both directions.
- **No I/O on the audio thread.** `set_param`, `get_param` and `render_block` all run there. Every GET added here returns a string the saver thread has already published under the mutex; nothing added here opens a file from `get_param`.
- **The mutex is never held across file I/O.** Read or write first, lock only to publish.
- **Anything unverifiable counts as ALIVE.** Keeping a stale state directory costs a few KB; deleting a live one destroys work.
- **`ENGINE_VERSION` gets exactly one bump for this whole plan** — `0.74.0` → `0.75.0`, in Task 7, in **both** `engine/crates/movy-dsp/src/lib.rs` and `src/seq/constants.ts`. No other task touches it.
- **Nothing in TypeScript is deleted.** Both paths live side by side under `engpersist` until §12 step 6. Every existing host-suite assertion for the flag-off path must still pass unchanged.
- **Rust toolchain:** `cargo` is not on `PATH`. Use `~/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo`, run from `movy/engine`.
- Comments explain WHY, never WHAT. Match the density of the file you are editing.
- Prove every new test has teeth: remove the fix, watch it fail, put it back.

## File Structure

**Created:**

| file | responsibility |
| --- | --- |
| `engine/crates/movy-dsp/src/version_index.rs` | the `VersionRec`/`Why` types, `versions.json` parse + serialize, `count_clips`. No I/O. |
| `engine/crates/movy-dsp/src/version_retain.rs` | the 4-bucket ladder: which `n` to drop. Pure. |
| `engine/crates/movy-dsp/src/version_store.rs` | version directories: read, write-in-order, self-heal, prune. |
| `engine/crates/movy-dsp/src/set_gc.rs` | the sweep: `read_dir`, page-aware aliveness, removal. |
| `src/seq/version-wire.ts` | the menu's rows — from the engine when `engpersist` is on, from `version-store.ts` when it is off. Caches; the page must not poll per frame. |

**Modified:**

| file | change |
| --- | --- |
| `engine/crates/movy-dsp/src/set_store.rs` | `atomic_write` becomes `pub(crate)`; `blank_files()` removes the state files without the history. |
| `engine/crates/movy-dsp/src/set_saver.rs` | new jobs (`Keep`, `Restore`, `Gc`), captures inside `Open`/`Save`/`Blank`, published `versions`/`vui`/`gc` fields. |
| `engine/crates/movy-dsp/src/lib.rs` | `mod` lines, `parse_cmd` call site, three new GET keys, `ENGINE_VERSION`. |
| `src/seq/version-index.ts` | `VersionRec` gains `ch: boolean`. |
| `src/seq/version-store.ts` | writes `ch: false` (the old path keeps chains inside the ui blob). |
| `src/seq/versions-page.ts`, `src/seq/versions-page-vm.ts` | read rows through `version-wire.ts`; SEQ ONLY becomes `!ui && !ch`. |
| `src/seq/version-restore.ts` | engine branch: send the command, finish on a later tick. |
| `src/seq/set-session.ts` | skip the TS captures under the flag; send `keep exit`; send `gc`; drive the restore/gc ticks. |
| `src/seq/set-fail.ts` | send `blank` under the flag instead of writing a blank blob. |
| `src/seq/set-gc.ts` | engine branch + the name-index prune from the engine's collected list. |
| `browser-test/mock-engine.mjs` | model the version store and the sweep the way it models the saver. |
| `browser-test/logic/versions.mjs`, `browser-test/logic/set-session.mjs` | new blocks for the engine path. |

---

### Task 1: The version index in Rust

`versions.json` is the one file in this step that is real JSON, and the crate has no JSON library. The shape is narrow — a flat array of objects whose values are integers, booleans and one enum word — so a scanner over `{`…`}` is enough, and being tolerant is not a shortcut: the TypeScript reader already drops records it cannot use, and the two must agree about which bytes mean "no versions".

**Files:**
- Create: `engine/crates/movy-dsp/src/version_index.rs`
- Modify: `engine/crates/movy-dsp/src/lib.rs` (add `mod version_index;` beside the other `mod` lines near line 28)

**Interfaces:**
- Produces:
  - `pub enum Why { Open, Auto, Exit, PreWipe, PreRestore, Adopted }` with `fn as_str(self) -> &'static str` and `fn from_str(s: &str) -> Option<Why>`
  - `pub struct VersionRec { pub n: u32, pub gen: u32, pub ms: u64, pub why: Why, pub clips: u32, pub ui: bool, pub ch: bool }`
  - `pub struct Index { pub next: u32, pub v: Vec<VersionRec> }`
  - `pub fn parse(raw: Option<&str>) -> Index`
  - `pub fn serialize(idx: &Index) -> String`
  - `pub fn count_clips(payload: &str) -> u32`

- [ ] **Step 1: Write the failing tests**

Create `engine/crates/movy-dsp/src/version_index.rs` with only the test module and the type declarations it names, then fill the bodies in step 3. Write these tests first, verbatim:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    /* The bytes TypeScript actually writes (version-store.ts → JSON.stringify
     * of the record literal). Pinned as a golden because the flag is an escape
     * hatch in BOTH directions: an engine that cannot read what the old path
     * wrote turns a flag flip into an empty history. */
    const TS_INDEX: &str = r#"{"next":4,"v":[{"n":3,"gen":9,"ms":1788892154000,"why":"open","clips":6,"ui":true},{"n":1,"gen":4,"ms":0,"why":"adopted","clips":2,"ui":false}]}"#;

    #[test]
    fn reads_what_typescript_wrote() {
        let idx = parse(Some(TS_INDEX));
        assert_eq!(idx.v.len(), 2);
        assert_eq!(idx.v[0].n, 3, "newest first");
        assert_eq!(idx.v[0].gen, 9);
        assert_eq!(idx.v[0].ms, 1788892154000);
        assert_eq!(idx.v[0].why, Why::Open);
        assert_eq!(idx.v[0].clips, 6);
        assert!(idx.v[0].ui);
        /* A record written before this step has no `ch` field at all, and the
         * chains it carries live inside its ui blob. Absent must read as false
         * or the restore would look for a file that was never written. */
        assert!(!idx.v[0].ch);
        assert_eq!(idx.v[1].why, Why::Adopted);
        assert_eq!(idx.next, 4);
    }

    #[test]
    fn an_unreadable_index_is_no_versions_never_a_licence_to_delete() {
        assert_eq!(parse(None).v.len(), 0);
        assert_eq!(parse(Some("{{{")).v.len(), 0);
        assert_eq!(parse(None).next, 1, "numbering still starts at 1");
    }

    /* A version whose generation cannot be read cannot be ordered, and an
     * unordered entry in a restore menu is worse than an absent one. */
    #[test]
    fn unusable_records_are_dropped_not_defaulted() {
        assert_eq!(parse(Some(r#"{"next":2,"v":[{"gen":1,"ms":0,"why":"open"}]}"#)).v.len(), 0);
        assert_eq!(parse(Some(r#"{"next":2,"v":[{"n":1,"gen":1,"ms":0,"why":"nope"}]}"#)).v.len(), 0);
    }

    /* `next` must outrank every n on disk. A truncated write that lost the
     * counter would otherwise hand the next capture a directory that already
     * exists — the one corruption self-heal cannot undo, because the old
     * version's files are gone by the time anyone notices. */
    #[test]
    fn next_is_repaired_past_the_highest_n() {
        let raw = r#"{"next":1,"v":[{"n":9,"gen":1,"ms":0,"why":"open","clips":0,"ui":false,"ch":false}]}"#;
        assert_eq!(parse(Some(raw)).next, 10);
    }

    #[test]
    fn round_trips_through_serialize() {
        let idx = parse(Some(TS_INDEX));
        let again = parse(Some(&serialize(&idx)));
        assert_eq!(again.v.len(), 2);
        assert_eq!(again.v[0].n, 3);
        assert_eq!(again.next, 4);
    }

    /* Key order matches the TypeScript record literal so a diff of two devices'
     * files is about content, not about who wrote it. */
    #[test]
    fn serializes_in_the_typescript_key_order() {
        let idx = Index { next: 2, v: vec![VersionRec {
            n: 1, gen: 5, ms: 7, why: Why::PreWipe, clips: 2, ui: true, ch: true,
        }] };
        assert_eq!(serialize(&idx),
            r#"{"next":2,"v":[{"n":1,"gen":5,"ms":7,"why":"pre-wipe","clips":2,"ui":true,"ch":true}]}"#);
    }

    #[test]
    fn counts_clips() {
        assert_eq!(count_clips("movy1\ncl 0 0 16 0 x\ncp 0\ncl 1 0 16 0 y\n"), 2);
        assert_eq!(count_clips("movy1\n"), 0);
    }

    /* Ordering is by generation, and n breaks the tie — the same comparator
     * version-index.ts sorts with, because the menu's order IS the feature. */
    #[test]
    fn orders_by_generation_then_n() {
        let raw = r#"{"next":9,"v":[
            {"n":1,"gen":4,"ms":0,"why":"open","clips":0,"ui":false,"ch":false},
            {"n":8,"gen":4,"ms":0,"why":"auto","clips":0,"ui":false,"ch":false},
            {"n":2,"gen":7,"ms":0,"why":"exit","clips":0,"ui":false,"ch":false}]}"#;
        let v = parse(Some(raw)).v;
        assert_eq!((v[0].n, v[1].n, v[2].n), (2, 8, 1));
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `~/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo test -p movy-dsp version_index` from `movy/engine`
Expected: compile error — `parse`, `serialize`, `count_clips` not found.

- [ ] **Step 3: Write the implementation**

```rust
//! The version index — `sets/<uuid>/versions.json`.
//!
//! Real JSON, hand-parsed, because the crate carries no dependencies and this
//! file is the one thing both halves of the flag must read. The shape is flat
//! by construction (integers, booleans and one enum word, no nesting), which is
//! what makes a scan over `{`…`}` sufficient rather than merely convenient.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Why {
    Open,
    Auto,
    Exit,
    PreWipe,
    PreRestore,
    Adopted,
}

impl Why {
    pub fn as_str(self) -> &'static str {
        match self {
            Why::Open => "open",
            Why::Auto => "auto",
            Why::Exit => "exit",
            Why::PreWipe => "pre-wipe",
            Why::PreRestore => "pre-restore",
            Why::Adopted => "adopted",
        }
    }

    pub fn from_str(s: &str) -> Option<Why> {
        Some(match s {
            "open" => Why::Open,
            "auto" => Why::Auto,
            "exit" => Why::Exit,
            "pre-wipe" => Why::PreWipe,
            "pre-restore" => Why::PreRestore,
            "adopted" => Why::Adopted,
            _ => return None,
        })
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct VersionRec {
    /// Directory under `v/`, never reused.
    pub n: u32,
    /// Envelope generation — THE ORDERING KEY.
    pub gen: u32,
    /// Capture time, or 0 when unknown. Display and bucketing only.
    pub ms: u64,
    pub why: Why,
    /// How a user tells a real version from a blank one.
    pub clips: u32,
    pub ui: bool,
    /// Whether `v/<n>/chains.json` exists. Absent in records written before the
    /// engine owned the chains, where the chains rode inside the ui blob.
    pub ch: bool,
}

pub struct Index {
    pub next: u32,
    pub v: Vec<VersionRec>,
}

/// The raw text of `"key":` inside one flat object, or None. Values here never
/// contain a comma, a brace or an escape, which is what keeps this honest.
fn field<'a>(obj: &'a str, key: &str) -> Option<&'a str> {
    let pat = format!("\"{key}\":");
    let start = obj.find(&pat)? + pat.len();
    let rest = &obj[start..];
    let end = rest.find([',', '}']).unwrap_or(rest.len());
    Some(rest[..end].trim().trim_matches('"'))
}

fn num<T: std::str::FromStr>(obj: &str, key: &str) -> Option<T> {
    field(obj, key)?.parse::<T>().ok()
}

fn flag(obj: &str, key: &str) -> bool {
    field(obj, key) == Some("true")
}

fn record(obj: &str) -> Option<VersionRec> {
    Some(VersionRec {
        n: num(obj, "n")?,
        gen: num(obj, "gen")?,
        ms: num(obj, "ms")?,
        why: Why::from_str(field(obj, "why")?)?,
        clips: num(obj, "clips").unwrap_or(0),
        ui: flag(obj, "ui"),
        ch: flag(obj, "ch"),
    })
}

/// Parse, dropping anything unusable. An unreadable index reads as NO VERSIONS
/// — never as permission to delete, the same rule the sweep applies to an
/// unreadable `Sets/`.
pub fn parse(raw: Option<&str>) -> Index {
    let Some(raw) = raw else {
        return Index { next: 1, v: Vec::new() };
    };
    let mut v: Vec<VersionRec> = Vec::new();
    if let Some(arr) = raw.find("\"v\":").map(|i| &raw[i + 4..]) {
        let mut rest = arr;
        while let Some(open) = rest.find('{') {
            let Some(close) = rest[open..].find('}') else { break };
            if let Some(r) = record(&rest[open..open + close]) {
                v.push(r);
            }
            rest = &rest[open + close + 1..];
        }
    }
    v.sort_by(|a, b| b.gen.cmp(&a.gen).then(b.n.cmp(&a.n)));
    let mut next = num::<u32>(raw, "next").filter(|n| *n >= 1).unwrap_or(1);
    for r in &v {
        if r.n >= next {
            next = r.n + 1;
        }
    }
    Index { next, v }
}

pub fn serialize(idx: &Index) -> String {
    let mut s = format!("{{\"next\":{},\"v\":[", idx.next);
    for (i, r) in idx.v.iter().enumerate() {
        if i > 0 {
            s.push(',');
        }
        s.push_str(&format!(
            "{{\"n\":{},\"gen\":{},\"ms\":{},\"why\":\"{}\",\"clips\":{},\"ui\":{},\"ch\":{}}}",
            r.n, r.gen, r.ms, r.why.as_str(), r.clips, r.ui, r.ch
        ));
    }
    s.push_str("]}");
    s
}

/// Clips in a payload. The one number the menu shows that says whether a
/// version is worth restoring.
pub fn count_clips(payload: &str) -> u32 {
    payload.lines().filter(|l| l.starts_with("cl ")).count() as u32
}
```

Add to `lib.rs`, in the `mod` block (alphabetical, beside `mod set_store;`):

```rust
mod version_index;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `~/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo test -p movy-dsp version_index`
Expected: 8 passed.

- [ ] **Step 5: Prove the golden has teeth**

Change `field()` to stop trimming quotes (`rest[..end].trim()`), re-run: `reads_what_typescript_wrote` must fail on `why`. Put it back.

- [ ] **Step 6: Commit**

```bash
git add engine/crates/movy-dsp/src/version_index.rs engine/crates/movy-dsp/src/lib.rs
git commit -m "$(cat <<'EOF'
engine: read and write the version index

Hand-parsed, because the crate has no JSON library and this file is the
one both halves of the flag must read — an engine that cannot read what
the old path wrote turns a flag flip into an empty history.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: The retention ladder in Rust

A pure port of `version-retain.ts`. The spread it produces IS the feature, and a spread only observable by filling a device with a month of edits is a spread nobody checks — so the tests come across with the code.

**Files:**
- Create: `engine/crates/movy-dsp/src/version_retain.rs`
- Modify: `engine/crates/movy-dsp/src/lib.rs` (`mod version_retain;`)

**Interfaces:**
- Consumes: `version_index::{VersionRec, Why}` (Task 1)
- Produces: `pub const MAX_VERSIONS: usize = 32;` and `pub fn version_to_drop(list: &[VersionRec], now: u64) -> Option<u32>`

- [ ] **Step 1: Write the failing tests**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::version_index::Why;

    const NOW: u64 = 1788892154000;
    const HOUR: u64 = 3600_000;

    fn rec(n: u32, ms: u64, why: Why) -> VersionRec {
        VersionRec { n, gen: n, ms, why, clips: 1, ui: false, ch: false }
    }

    /// `count` versions, newest first, spaced `step` apart.
    fn ladder(count: u32, step: u64) -> Vec<VersionRec> {
        (0..count).map(|i| rec(count - i, NOW - u64::from(i) * step, Why::Auto)).collect()
    }

    #[test]
    fn a_list_within_the_cap_drops_nothing() {
        assert_eq!(version_to_drop(&ladder(32, 60_000), NOW), None);
    }

    #[test]
    fn over_the_cap_something_goes() {
        assert!(version_to_drop(&ladder(33, 60_000), NOW).is_some());
    }

    /* The three newest are never dropped, whatever the ladder says: the
     * session you are IN is the one you are most likely to want back. */
    #[test]
    fn the_three_newest_are_protected() {
        let list = ladder(40, 60_000);
        let n = version_to_drop(&list, NOW).expect("drops one");
        assert!(![list[0].n, list[1].n, list[2].n].contains(&n));
    }

    /* A pre-wipe capture is the only copy of what the user asked to destroy.
     * For a week it outranks the ladder. */
    #[test]
    fn a_recent_pre_wipe_survives_a_full_list() {
        let mut list = ladder(40, 60_000);
        list[20] = rec(list[20].n, NOW - HOUR, Why::PreWipe);
        let keep = list[20].n;
        for _ in 0..8 {
            let Some(n) = version_to_drop(&list, NOW) else { break };
            assert_ne!(n, keep, "the pre-wipe must not be thinned");
            list.retain(|r| r.n != n);
        }
    }

    /* Thinning happens where the list is DENSEST, and never at a bucket's
     * ends: they anchor the span the bucket exists to cover. */
    #[test]
    fn thins_the_densest_interior_first() {
        let mut list = ladder(33, HOUR / 2);
        /* Two captures a second apart, deep in the first bucket. */
        list[5].ms = list[4].ms - 1000;
        let n = version_to_drop(&list, NOW).expect("drops one");
        assert_eq!(n, list[5].n);
    }

    /* A missing, zero or future timestamp cannot be aged, so it lands in the
     * oldest bucket and is ranked by generation like everything else.
     * Ordering never touches the clock; only membership does. */
    #[test]
    fn clockless_rows_still_thin() {
        let list: Vec<VersionRec> = (0..40).map(|i| rec(40 - i, 0, Why::Adopted)).collect();
        assert!(version_to_drop(&list, NOW).is_some());
    }

    #[test]
    fn future_timestamps_still_thin() {
        let list: Vec<VersionRec> =
            (0..40).map(|i| rec(40 - i, NOW + HOUR, Why::Auto)).collect();
        assert!(version_to_drop(&list, NOW).is_some());
    }

    /* A capture is never refused for want of room: if every over-cap bucket is
     * entirely protected, the oldest unprotected row anywhere goes. */
    #[test]
    fn a_fully_protected_bucket_falls_back_to_the_oldest() {
        let mut list = ladder(40, 60_000);
        for r in list.iter_mut().take(12) {
            r.why = Why::PreWipe;
            r.ms = NOW;
        }
        let n = version_to_drop(&list, NOW).expect("drops one");
        assert_eq!(n, list[list.len() - 1].n);
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `~/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo test -p movy-dsp version_retain`
Expected: compile error — `version_to_drop` not found.

- [ ] **Step 3: Write the implementation**

```rust
//! Which version to drop when a Set is at its limit.
//!
//! Pure — versions and `now` in, one `n` out. A port of `version-retain.ts`,
//! kept shape-for-shape: the spread it produces IS the feature, and the shape
//! is logarithmic on purpose. A rule that simply thinned wherever the gaps were
//! smallest converges on an EVEN spread, which after a month means one version
//! a day and nothing fine-grained from the session you are actually in. Buckets
//! fix the shape; the gap rule then chooses within a bucket.

use crate::version_index::{VersionRec, Why};

pub const MAX_VERSIONS: usize = 32;

const HOUR: u64 = 3600_000;
/// Upper age bound of each bucket; the last is unbounded.
const BUCKET_MS: [u64; 4] = [HOUR, 24 * HOUR, 7 * 24 * HOUR, u64::MAX];
const BUCKET_CAP: [usize; 4] = [8, 8, 8, 8];

/// Never dropped, whatever the ladder says.
const KEEP_NEWEST: usize = 3;
const PRE_WIPE_PROTECT_MS: u64 = 7 * 24 * HOUR;

fn bucket_of(r: &VersionRec, now: u64) -> usize {
    if r.ms == 0 || r.ms > now {
        return BUCKET_MS.len() - 1;
    }
    let age = now - r.ms;
    for (i, bound) in BUCKET_MS.iter().enumerate() {
        if age <= *bound {
            return i;
        }
    }
    BUCKET_MS.len() - 1
}

fn is_protected(r: &VersionRec, rank: usize, now: u64) -> bool {
    if rank < KEEP_NEWEST {
        return true;
    }
    r.why == Why::PreWipe && r.ms > 0 && now >= r.ms && now - r.ms <= PRE_WIPE_PROTECT_MS
}

fn rank_of(list: &[VersionRec], n: u32) -> usize {
    list.iter().position(|r| r.n == n).unwrap_or(usize::MAX)
}

/// The `n` to remove, or None when the list fits.
///
/// `list` is newest first (generation descending), as the index keeps it.
pub fn version_to_drop(list: &[VersionRec], now: u64) -> Option<u32> {
    if list.len() <= MAX_VERSIONS {
        return None;
    }

    /* Because the caps sum to MAX_VERSIONS, being over the total always means
     * some bucket is over its own cap — there is no separate global rule. */
    let mut buckets: [Vec<&VersionRec>; 4] = Default::default();
    for r in list {
        buckets[bucket_of(r, now)].push(r);
    }

    for (b, rows) in buckets.iter().enumerate() {
        if rows.len() <= BUCKET_CAP[b] {
            continue;
        }
        if let Some(n) = pick_within(rows, list, now) {
            return Some(n);
        }
    }
    /* Every over-cap bucket is entirely protected — fall back to the oldest
     * unprotected version anywhere, so a capture is never refused for room. */
    list.iter().enumerate().rev()
        .find(|(i, r)| !is_protected(r, *i, now))
        .map(|(_, r)| r.n)
}

/// Thin where it is densest: the interior version whose two neighbours are
/// closest together. The bucket's ends anchor its span and are left alone.
fn pick_within(rows: &[&VersionRec], list: &[VersionRec], now: u64) -> Option<u32> {
    let mut best: Option<u32> = None;
    let mut best_gap = i64::MAX;
    for i in 1..rows.len().saturating_sub(1) {
        let r = rows[i];
        if is_protected(r, rank_of(list, r.n), now) {
            continue;
        }
        /* Clockless rows have no gap to measure; rank them by generation
         * instead, treating the oldest as the densest. Negated so a lower
         * generation compares as a smaller gap. */
        let gap = if rows[i - 1].ms > 0 && rows[i + 1].ms > 0 {
            rows[i - 1].ms as i64 - rows[i + 1].ms as i64
        } else {
            -(r.gen as i64)
        };
        if gap < best_gap {
            best_gap = gap;
            best = Some(r.n);
        }
    }
    if best.is_some() {
        return best;
    }
    /* No interior candidate survived the protections — take the bucket's
     * oldest unprotected row instead. */
    rows.iter().rev()
        .find(|r| !is_protected(r, rank_of(list, r.n), now))
        .map(|r| r.n)
}
```

Add `mod version_retain;` to `lib.rs`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `~/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo test -p movy-dsp version_retain`
Expected: 8 passed.

- [ ] **Step 5: Prove the protections have teeth**

Change `KEEP_NEWEST` to 0 and re-run: `the_three_newest_are_protected` must fail. Change `is_protected`'s pre-wipe arm to `false` and re-run: `a_recent_pre_wipe_survives_a_full_list` must fail. Restore both.

- [ ] **Step 6: Commit**

```bash
git add engine/crates/movy-dsp/src/version_retain.rs engine/crates/movy-dsp/src/lib.rs
git commit -m "$(cat <<'EOF'
engine: the retention ladder, ported shape-for-shape

The spread IS the feature, so the tests come across with the code —
a spread you can only observe by filling a device with a month of
edits is a spread nobody will ever check.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: The version store — three files per version

A version was two files. With the flag on, chains live in `chains.json`, so a version without one restores an old sequence under today's chains — the loss the chain document's missing LFO field would have been. `v/<n>/` gains a third file and the index a `ch` flag.

The write ORDER is the durability rule: the version's files land first, the index entry second. A crash between them leaves a directory nothing names — harmless, and collected by the next prune — where the other order leaves the menu offering a version whose files do not exist.

**Files:**
- Create: `engine/crates/movy-dsp/src/version_store.rs`
- Modify: `engine/crates/movy-dsp/src/set_store.rs` (make `atomic_write` `pub(crate)`)
- Modify: `engine/crates/movy-dsp/src/lib.rs` (`mod version_store;`)

**Interfaces:**
- Consumes: `set_store::{SetStore, atomic_write}`, `set_envelope::{wrap, parse, Parsed}`, `version_index::*`, `version_retain::version_to_drop`
- Produces:
  - `pub fn version_dir(store: &SetStore, uuid: &str, n: u32) -> PathBuf`
  - `pub fn read_index(store: &SetStore, uuid: &str) -> Index`
  - `pub fn read_state(store: &SetStore, uuid: &str, n: u32) -> Option<Parsed>`
  - `pub fn read_chains(store: &SetStore, uuid: &str, n: u32) -> Option<String>`
  - `pub fn read_ui(store: &SetStore, uuid: &str, n: u32) -> Option<String>`
  - `pub struct Capture<'a> { pub why: Why, pub payload: &'a str, pub gen: u32, pub chains: Option<&'a str>, pub ui: Option<&'a str>, pub now: u64 }`
  - `pub fn write_version(store: &SetStore, uuid: &str, c: &Capture) -> bool`
  - `pub fn wire_rows(idx: &Index) -> String`

- [ ] **Step 1: Write the failing tests**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    const GOOD: &str = "movy1\ncl 0 0 16 0 0:24:60:100\n";
    const CHAINS: &str = "5\n1\n0\n5\nsynth\n10\nnoisemaker\n4\nblob\n15\n1.0000,0.0000,0";
    const UI: &str = r#"{"root":48}"#;
    const NOW: u64 = 1788892154000;

    fn tmp(name: &str) -> SetStore {
        let d = std::env::temp_dir().join(format!("movy-version-store-{name}"));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        SetStore::new(d.to_str().unwrap())
    }

    fn cap<'a>(why: Why, payload: &'a str, gen: u32, chains: Option<&'a str>, ui: Option<&'a str>) -> Capture<'a> {
        Capture { why, payload, gen, chains, ui, now: NOW }
    }

    #[test]
    fn writes_and_reads_a_version_back() {
        let s = tmp("rw");
        assert!(write_version(&s, "S1", &cap(Why::Open, GOOD, 5, Some(CHAINS), Some(UI))));
        let idx = read_index(&s, "S1");
        assert_eq!(idx.v.len(), 1);
        assert_eq!(idx.v[0].n, 1, "numbered from 1");
        assert_eq!(idx.v[0].gen, 5);
        assert_eq!(idx.v[0].clips, 1, "counted its clips");
        assert!(idx.v[0].ui);
        assert!(idx.v[0].ch);
        assert_eq!(idx.next, 2);
        assert_eq!(read_state(&s, "S1", 1).unwrap().payload, GOOD);
        assert_eq!(read_chains(&s, "S1", 1).as_deref(), Some(CHAINS));
        assert_eq!(read_ui(&s, "S1", 1).as_deref(), Some(UI));
    }

    /* THE reason a version is three files now: with the flag on the chains
     * are their own file, so a version that kept only the sequence would
     * restore an old take under today's instruments. */
    #[test]
    fn a_version_keeps_the_chains_that_were_live_with_it() {
        let s = tmp("chains");
        write_version(&s, "S1", &cap(Why::Open, GOOD, 1, Some(CHAINS), None));
        write_version(&s, "S1", &cap(Why::Auto, GOOD, 2, Some("0\n"), None));
        assert_eq!(read_chains(&s, "S1", 1).as_deref(), Some(CHAINS),
                   "version 1 must still hold the chain set it was captured with");
    }

    /* A version with no ui half is legitimate — an adopted OLDER sequence has
     * no ui state of its own age — and it must not claim one. */
    #[test]
    fn a_version_can_have_no_ui_half() {
        let s = tmp("noui");
        write_version(&s, "S1", &cap(Why::Adopted, "movy1\n", 1, None, None));
        let idx = read_index(&s, "S1");
        assert!(!idx.v[0].ui);
        assert!(!idx.v[0].ch);
        assert!(read_ui(&s, "S1", 1).is_none());
    }

    /* Files before index: a crash between them leaves a directory nothing
     * names — harmless — where the other order leaves the menu offering a
     * version whose files do not exist. */
    #[test]
    fn the_index_entry_lands_after_the_files() {
        let s = tmp("order");
        write_version(&s, "S1", &cap(Why::Open, GOOD, 1, Some(CHAINS), Some(UI)));
        let idx_at = fs::metadata(s.set_dir("S1").join("versions.json")).unwrap().modified().unwrap();
        let file_at = fs::metadata(version_dir(&s, "S1", 1).join("seq-state.json")).unwrap().modified().unwrap();
        assert!(idx_at >= file_at, "the index must not predate the files it names");
    }

    /* An index naming a version whose files are gone must not offer it, and
     * the repair is written back — self-healing on READ, because that is the
     * only moment the discrepancy can be noticed. */
    #[test]
    fn a_dangling_entry_is_dropped_on_read() {
        let s = tmp("dangle");
        write_version(&s, "S1", &cap(Why::Open, GOOD, 1, None, None));
        write_version(&s, "S1", &cap(Why::Auto, GOOD, 2, None, None));
        fs::remove_dir_all(version_dir(&s, "S1", 2)).unwrap();
        assert_eq!(read_index(&s, "S1").v.len(), 1);
        let raw = fs::read_to_string(s.set_dir("S1").join("versions.json")).unwrap();
        assert!(!raw.contains("\"n\":2"), "the repair must be written back");
    }

    #[test]
    fn the_store_keeps_a_set_within_its_cap() {
        let s = tmp("cap");
        for i in 0..40u32 {
            write_version(&s, "S1", &Capture {
                why: Why::Auto, payload: GOOD, gen: i + 1,
                chains: None, ui: None, now: NOW + u64::from(i) * 60_000,
            });
        }
        let idx = read_index(&s, "S1");
        assert!(idx.v.len() <= 32, "got {}", idx.v.len());
        /* Pruned means GONE, not merely unlisted: the point of the cap is the
         * bytes it stops a device from accumulating. */
        let dirs = fs::read_dir(s.set_dir("S1").join("v")).unwrap().count();
        assert_eq!(dirs, idx.v.len());
    }

    #[test]
    fn wire_rows_names_every_field_the_menu_shows() {
        let s = tmp("wire");
        write_version(&s, "S1", &cap(Why::PreWipe, GOOD, 5, Some(CHAINS), Some(UI)));
        assert_eq!(wire_rows(&read_index(&s, "S1")), format!("1 5 {NOW} pre-wipe 1 1 1"));
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `~/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo test -p movy-dsp version_store`
Expected: compile error — `write_version` not found.

- [ ] **Step 3: Write the implementation**

First, in `set_store.rs`, widen the writer (one word):

```rust
pub(crate) fn atomic_write(path: &Path, content: &str) -> Result<(), String> {
```

Then create `version_store.rs`:

```rust
//! A Set's kept versions: `versions.json` and the directories under `v/`.
//!
//! One directory per version, three files in it. The third is new: with
//! `engpersist` on the chains are their own file, so a version that kept only
//! the sequence would restore an old take under today's instruments.
//!
//! The write ORDER is the durability rule and the only subtle thing here. The
//! version's files land first and the index entry second: a crash between them
//! leaves a directory nothing names — harmless, and pruned later — where the
//! other order leaves the menu offering a version whose files do not exist.

use crate::set_envelope::{parse, wrap, Parsed};
use crate::set_store::{atomic_write, SetStore};
use crate::version_index::{count_clips, serialize, Index, VersionRec, Why};
use crate::version_retain::version_to_drop;
use std::fs;
use std::path::PathBuf;

pub fn version_dir(store: &SetStore, uuid: &str, n: u32) -> PathBuf {
    store.set_dir(uuid).join("v").join(n.to_string())
}

fn index_path(store: &SetStore, uuid: &str) -> PathBuf {
    store.set_dir(uuid).join("versions.json")
}

pub struct Capture<'a> {
    pub why: Why,
    pub payload: &'a str,
    pub gen: u32,
    pub chains: Option<&'a str>,
    pub ui: Option<&'a str>,
    pub now: u64,
}

/// The index, with entries whose files are gone dropped and the repair written
/// back. Self-healing on READ: that is the only moment the discrepancy can be
/// noticed at all.
pub fn read_index(store: &SetStore, uuid: &str) -> Index {
    let raw = fs::read_to_string(index_path(store, uuid)).ok();
    let mut idx = crate::version_index::parse(raw.as_deref());
    let before = idx.v.len();
    idx.v.retain(|r| version_dir(store, uuid, r.n).join("seq-state.json").exists());
    if idx.v.len() != before {
        let _ = atomic_write(&index_path(store, uuid), &serialize(&idx));
    }
    idx
}

pub fn read_state(store: &SetStore, uuid: &str, n: u32) -> Option<Parsed> {
    let raw = fs::read_to_string(version_dir(store, uuid, n).join("seq-state.json")).ok()?;
    parse(&raw)
}

pub fn read_chains(store: &SetStore, uuid: &str, n: u32) -> Option<String> {
    fs::read_to_string(version_dir(store, uuid, n).join("chains.json")).ok()
}

pub fn read_ui(store: &SetStore, uuid: &str, n: u32) -> Option<String> {
    fs::read_to_string(version_dir(store, uuid, n).join("ui-state.json")).ok()
}

/// Keep a capture as a new version.
///
/// Returns false when nothing durable was written — the caller logs and carries
/// on, because a capture that fails must never fail the save it rode in on.
pub fn write_version(store: &SetStore, uuid: &str, c: &Capture) -> bool {
    let mut idx = read_index(store, uuid);
    let n = idx.next;
    let dir = version_dir(store, uuid, n);
    if fs::create_dir_all(&dir).is_err() {
        return false;
    }
    if atomic_write(&dir.join("seq-state.json"), &wrap(c.payload, c.gen)).is_err() {
        crate::host::log(&format!("versions: capture failed for {uuid} ({})", c.why.as_str()));
        return false;
    }
    let ch = matches!(c.chains, Some(s) if !s.is_empty())
        && atomic_write(&dir.join("chains.json"), c.chains.unwrap()).is_ok();
    let ui = matches!(c.ui, Some(s) if !s.is_empty())
        && atomic_write(&dir.join("ui-state.json"), c.ui.unwrap()).is_ok();

    idx.next = n + 1;
    idx.v.push(VersionRec {
        n, gen: c.gen, ms: c.now, why: c.why,
        clips: count_clips(c.payload), ui, ch,
    });
    idx.v.sort_by(|a, b| b.gen.cmp(&a.gen).then(b.n.cmp(&a.n)));
    if atomic_write(&index_path(store, uuid), &serialize(&idx)).is_err() {
        crate::host::log(&format!("versions: index write failed for {uuid}"));
        return false;
    }
    prune(store, uuid, c.now);
    true
}

/// Drop versions until the Set is within its limit. One at a time, because the
/// ladder re-evaluates after every removal — which bucket a version sits in
/// depends on the ones around it.
fn prune(store: &SetStore, uuid: &str, now: u64) {
    for _ in 0..8 {
        let mut idx = read_index(store, uuid);
        let Some(n) = version_to_drop(&idx.v, now) else { return };
        let _ = fs::remove_dir_all(version_dir(store, uuid, n));
        idx.v.retain(|r| r.n != n);
        if atomic_write(&index_path(store, uuid), &serialize(&idx)).is_err() {
            return;
        }
    }
}

/// The menu, one line per version: `n gen ms why clips ui ch`. Published by the
/// saver thread and served from a cached string, because `get_param` runs on
/// the audio thread and must not read a file.
pub fn wire_rows(idx: &Index) -> String {
    idx.v.iter()
        .map(|r| format!("{} {} {} {} {} {} {}",
            r.n, r.gen, r.ms, r.why.as_str(), r.clips,
            u8::from(r.ui), u8::from(r.ch)))
        .collect::<Vec<_>>()
        .join("\n")
}
```

Add `mod version_store;` to `lib.rs`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `~/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo test -p movy-dsp version_store`
Expected: 7 passed.

- [ ] **Step 5: Prove the ordering and cap assertions have teeth**

Move the `atomic_write` of the index above the `seq-state.json` write and re-run: `the_index_entry_lands_after_the_files` must fail. Remove the `prune()` call: `the_store_keeps_a_set_within_its_cap` must fail. Restore both.

- [ ] **Step 6: Commit**

```bash
git add engine/crates/movy-dsp/src/version_store.rs engine/crates/movy-dsp/src/set_store.rs engine/crates/movy-dsp/src/lib.rs
git commit -m "$(cat <<'EOF'
engine: a version is three files now

chains.json joins the sequence and the ui blob under v/<n>/. With the
flag on the chains are their own file, so a version that kept only the
sequence would restore an old take under today's instruments.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: The four captures that never reach the wire

`open`, `adopted`, `auto` and `pre-wipe` happen inside jobs the engine already runs. `exit` becomes the one capture command.

This task also fixes a hazard the port creates: `Job::Blank` currently does `remove_dir_all(set_dir)`, which would take `v/` and `versions.json` with it — deleting the history at the exact moment the pre-wipe capture exists to preserve it.

**Files:**
- Modify: `engine/crates/movy-dsp/src/set_saver.rs`
- Modify: `engine/crates/movy-dsp/src/set_store.rs` (add `blank_files`)

**Interfaces:**
- Consumes: `version_store::{Capture, read_index, write_version, wire_rows}`, `version_index::Why`
- Produces:
  - `Job::Keep { uuid: String, why: Why }` added to the existing `pub enum Job`
  - `SetStore::blank_files(&self, uuid: &str)` — removes the state files, keeps the history
  - `Saver::versions(&self) -> String` — the published wire rows
  - `parse_cmd` gains `keep <why>` and takes the current uuid: `pub fn parse_cmd(val: &str, cur: &str) -> Option<Job>`

- [ ] **Step 1: Write the failing tests**

Add to `set_saver.rs`'s test module:

```rust
    use crate::version_index::Why;

    fn versions_of(root: &str, uuid: &str) -> Vec<crate::version_index::VersionRec> {
        crate::version_store::read_index(&SetStore::new(root), uuid).v
    }

    /* The capture that makes a Set coming up blank a menu entry rather than a
     * loss: a snapshot of what was on disk BEFORE movy can write anything. */
    #[test]
    fn opening_a_set_keeps_what_was_on_disk() {
        let root = tmp("openkeep");
        let s = Saver::new(&root);
        s.submit(Job::Save { uuid: "u1".into(), payload: "movy1\ncl 0 0 16 0 x\n".into(), gen: 1, chains: "0\n".into() });
        s.submit(Job::Open { uuid: "u1".into(), seed: None });
        s.drain_for_test();
        let v = versions_of(&root, "u1");
        assert_eq!(v.len(), 1);
        assert_eq!(v[0].why, Why::Open);
    }

    /* A Set with nothing on disk has nothing to keep. A version per visited
     * pad is how a history becomes noise. */
    #[test]
    fn opening_an_empty_set_keeps_nothing() {
        let root = tmp("openempty");
        let s = Saver::new(&root);
        s.submit(Job::Open { uuid: "u1".into(), seed: None });
        s.drain_for_test();
        assert_eq!(versions_of(&root, "u1").len(), 0);
    }

    /* What earlier builds left behind is adopted once, oldest first, and
     * COPIED: the shadows are live rotation slots, so adopting by reference
     * would mean the history evaporates on the very next autosave. */
    #[test]
    fn an_older_set_adopts_its_rotation_once() {
        let root = tmp("adopt");
        let store = SetStore::new(&root);
        std::fs::create_dir_all(store.set_dir("old")).unwrap();
        std::fs::write(store.state_path("old"), crate::set_envelope::wrap("movy1\ncl 0 0 16 0 a\n", 4)).unwrap();
        std::fs::write(store.shadow_path("old", 1), crate::set_envelope::wrap("movy1\ncl 0 0 16 0 b\n", 3)).unwrap();

        let s = Saver::new(&root);
        s.submit(Job::Open { uuid: "old".into(), seed: None });
        s.drain_for_test();
        let v = versions_of(&root, "old");
        let adopted: Vec<_> = v.iter().filter(|r| r.why == Why::Adopted).collect();
        assert_eq!(adopted.len(), 2, "both distinct copies");
        assert!(adopted.iter().any(|r| r.gen == 3), "the shadow was adopted at its own generation");

        let s2 = Saver::new(&root);
        s2.submit(Job::Open { uuid: "old".into(), seed: None });
        s2.drain_for_test();
        let again = versions_of(&root, "old");
        assert_eq!(again.iter().filter(|r| r.why == Why::Adopted).count(), 2,
                   "adoption is a no-op after the first open");
    }

    /* The autosave runs every few seconds forever. Without a floor the history
     * is just the rotation with extra steps. */
    #[test]
    fn the_autosave_capture_is_rate_limited() {
        let root = tmp("auto");
        let s = Saver::new(&root);
        for i in 1..=5u32 {
            s.submit(Job::Save {
                uuid: "u1".into(),
                payload: format!("movy1\ncl 0 0 16 0 {i}\n"),
                gen: i, chains: "0\n".into(),
            });
        }
        s.drain_for_test();
        assert_eq!(versions_of(&root, "u1").iter().filter(|r| r.why == Why::Auto).count(), 1,
                   "five saves inside the window are one version");
    }

    /* The capture the whole history exists for — and the trap the port
     * creates: Blank used to take the Set's whole directory, which would
     * delete the history at the one moment it matters. */
    #[test]
    fn blanking_keeps_the_history_it_just_captured() {
        let root = tmp("blank");
        let s = Saver::new(&root);
        s.submit(Job::Save { uuid: "u1".into(), payload: "movy1\ncl 0 0 16 0 x\n".into(), gen: 1, chains: "0\n".into() });
        s.submit(Job::Blank { uuid: "u1".into() });
        s.drain_for_test();

        let store = SetStore::new(&root);
        assert!(!store.has_state("u1"), "the state files must be gone");
        let v = versions_of(&root, "u1");
        assert!(v.iter().any(|r| r.why == Why::PreWipe),
                "the pre-wipe capture must survive the wipe: {v:?}");
        assert_eq!(crate::version_store::read_state(&store, "u1", v[0].n).unwrap().payload,
                   "movy1\ncl 0 0 16 0 x\n");
    }

    /* A teardown or a Set switch is the last chance this Set has to record
     * where it got to. It is the one capture that is a command. */
    #[test]
    fn keep_exit_captures_the_current_state() {
        let root = tmp("keepexit");
        let s = Saver::new(&root);
        s.submit(Job::Save { uuid: "u1".into(), payload: "movy1\ncl 0 0 16 0 x\n".into(), gen: 2, chains: "0\n".into() });
        s.submit(Job::Keep { uuid: "u1".into(), why: Why::Exit });
        s.drain_for_test();
        assert!(versions_of(&root, "u1").iter().any(|r| r.why == Why::Exit));
    }

    #[test]
    fn the_wire_rows_are_published_without_a_file_read() {
        let root = tmp("pub");
        let s = Saver::new(&root);
        s.submit(Job::Save { uuid: "u1".into(), payload: "movy1\ncl 0 0 16 0 x\n".into(), gen: 1, chains: "0\n".into() });
        s.submit(Job::Keep { uuid: "u1".into(), why: Why::Exit });
        s.drain_for_test();
        let rows = s.versions();
        assert_eq!(rows.lines().count(), 1, "got {rows:?}");
        assert!(rows.contains(" exit "), "got {rows:?}");
    }

    #[test]
    fn parses_the_keep_command() {
        assert!(matches!(parse_cmd("keep exit", "u1"), Some(Job::Keep { why: Why::Exit, .. })));
        assert!(parse_cmd("keep nonsense", "u1").is_none());
        assert!(parse_cmd("keep", "u1").is_none());
    }
```

Update the existing `parses_every_command` test to pass the current uuid: `parse_cmd("open abc", "")` etc.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `~/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo test -p movy-dsp set_saver`
Expected: compile errors — `Job::Keep`, `Saver::versions`, the two-argument `parse_cmd`.

- [ ] **Step 3: Write the implementation**

In `set_store.rs`, beside `write`:

```rust
    /// Give up this Set's state without giving up its history. `remove_dir_all`
    /// on the whole directory would take `v/` with it — deleting the record at
    /// the one moment the user is destroying the thing it records.
    pub fn blank_files(&self, uuid: &str) {
        for p in [self.state_path(uuid), self.chains_path(uuid),
                  self.shadow_path(uuid, 1), self.shadow_path(uuid, 2)] {
            let _ = fs::remove_file(p);
        }
    }
```

In `set_saver.rs`:

```rust
use crate::version_index::Why;
use crate::version_store::{read_index, wire_rows, write_version, Capture};
use std::time::{SystemTime, UNIX_EPOCH};

/// ~10 minutes. The autosave runs every few seconds forever, so `auto` needs a
/// floor or the history is just the rotation with extra steps.
const VERSION_MIN_MS: u64 = 600_000;

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}
```

Add to `pub enum Job`:

```rust
    /// The one capture that is a command: a teardown or a Set switch, where the
    /// UI knows a boundary has been reached and the engine does not.
    Keep { uuid: String, why: Why },
```

Add to `struct Shared`:

```rust
    /// The menu, already formatted. `get_param` runs on the audio thread, so
    /// what it serves must already be a string.
    versions: String,
```

(Initialise it to `String::new()` in `Saver::new`.)

A helper the jobs share, above `worker`:

```rust
/// Keep a version, and republish the menu. `ui` comes from the Set's own file:
/// that half is the UI's to write (spec §5) and the engine's only to copy.
fn capture(store: &SetStore, shared: &Arc<Mutex<Shared>>, uuid: &str, why: Why,
           payload: &str, gen: u32, chains: Option<&str>) {
    let ui = std::fs::read_to_string(store.set_dir(uuid).join("ui-state.json")).ok();
    let c = Capture { why, payload, gen, chains, ui: ui.as_deref(), now: now_ms() };
    if !write_version(store, uuid, &c) {
        /* Logged and dropped. The Set's CURRENT state outranks its history, so
         * a capture never fails the save it rode in on. */
        crate::host::log(&format!("versions: {} capture dropped for {uuid}", why.as_str()));
    }
    publish_versions(store, shared, uuid);
}

fn publish_versions(store: &SetStore, shared: &Arc<Mutex<Shared>>, uuid: &str) {
    let rows = wire_rows(&read_index(store, uuid));
    shared.lock().unwrap().versions = rows;
}

/// Seed a Set's history from what earlier builds left in the rotation.
///
/// A no-op once the Set has an index — this runs on every open. Adoption
/// COPIES: the shadows are live rotation slots, so adopting them by reference
/// would mean the history evaporates on the very next autosave.
fn adopt_existing(store: &SetStore, shared: &Arc<Mutex<Shared>>, uuid: &str) {
    if !read_index(store, uuid).v.is_empty() {
        return;
    }
    let mut found: Vec<(String, u32)> = Vec::new();
    for path in [store.state_path(uuid), store.shadow_path(uuid, 1), store.shadow_path(uuid, 2)] {
        let Some(p) = std::fs::read_to_string(path).ok().and_then(|s| crate::set_envelope::parse(&s)) else { continue };
        if found.iter().any(|(payload, _)| *payload == p.payload) {
            continue;
        }
        found.push((p.payload, p.gen));
    }
    if found.is_empty() {
        return;
    }
    found.sort_by_key(|(_, gen)| *gen);   // oldest gets the lowest n
    let chains = store.read_chains(uuid);
    for (i, (payload, gen)) in found.iter().enumerate() {
        /* Only the NEWEST adopted version gets today's chains and ui blob.
         * There is exactly one of each on disk — they were never rotated — so
         * giving an older sequence today's instruments would be a quiet lie.
         * An older adopted version restores the sequence alone, which the menu
         * shows as SEQ ONLY. */
        let newest = i == found.len() - 1;
        let ui = if newest {
            std::fs::read_to_string(store.set_dir(uuid).join("ui-state.json")).ok()
        } else {
            None
        };
        write_version(store, uuid, &Capture {
            why: Why::Adopted, payload, gen: *gen,
            chains: if newest { chains.as_deref() } else { None },
            ui: ui.as_deref(), now: 0,
        });
    }
    publish_versions(store, shared, uuid);
}
```

Wire the jobs. In `do_open`, after the seed branch and before anything else writes:

```rust
    /* Before movy can write anything to this Set: adopt whatever earlier builds
     * left behind, then snapshot what is actually on disk. This one capture is
     * what makes a Set that comes up blank a menu entry rather than a loss. */
    adopt_existing(store, shared, uuid);
    if let Some(p) = store.read_best(uuid) {
        capture(store, shared, uuid, Why::Open, &p.payload, p.gen, store.read_chains(uuid).as_deref());
    } else {
        publish_versions(store, shared, uuid);
    }
```

(`do_open` needs the `shared` it already takes; no signature change.)

In `worker`, give the loop the auto-capture clock before `while let`:

```rust
    /* The `auto` cadence, owned by the thread that captures. It starts at the
     * open capture: without that it is still 0 when the first autosave lands
     * ~8 s later, and a session opened and played into records its second
     * version within seconds of its first — the rotation's job, not history's. */
    let mut last_auto_ms = 0u64;
```

In the `Job::Open` arm, after `do_open`: `last_auto_ms = now_ms();`

In the `Job::Save` arm, inside `Ok(())` (after `sh.gen = gen;` and **after the lock is dropped** — take the values first, then capture outside the `MutexGuard` scope):

```rust
                /* Rides the save that just landed, so the history costs no
                 * extra read — and is rate-limited here, because this arm runs
                 * every few seconds for as long as movy is open. */
                if saved && (last_auto_ms == 0 || now_ms() - last_auto_ms >= VERSION_MIN_MS) {
                    capture(&store, &shared, &uuid, Why::Auto, &payload, gen, Some(&chains));
                    /* Set even when the capture was dropped: the interval is
                     * about how often we ASK, not how often we succeed. */
                    last_auto_ms = now_ms();
                }
```

Restructure that arm so the `Shared` lock is released before this runs (`let saved = { let mut sh = ...; ...; res.is_ok() };`).

Replace the `Job::Blank` arm's removal:

```rust
            Msg::Work(Job::Blank { uuid }) => {
                /* Unconditional, and before the files go: what is about to be
                 * overwritten may be the only copy, and "it looked the same as
                 * the last version" is not a reason to find out afterwards. */
                if let Some(p) = store.read_best(&uuid) {
                    capture(&store, &shared, &uuid, Why::PreWipe, &p.payload, p.gen,
                            store.read_chains(&uuid).as_deref());
                }
                /* The deliberate exception to "a blank Set writes nothing": the
                 * state files must GO, or reopening restores exactly what the
                 * user asked to be rid of. The history is NOT state — it is the
                 * record of what was destroyed, and it stays. */
                store.blank_files(&uuid);
                let mut sh = shared.lock().unwrap();
                sh.gen = 0;
                sh.phase = Phase::Ready;
                sh.reason.clear();
                sh.loaded = Some((BLANK_STATE.to_string(), "0\n".to_string(), 0));
            }
```

New arm:

```rust
            Msg::Work(Job::Keep { uuid, why }) => {
                if let Some(p) = store.read_best(&uuid) {
                    capture(&store, &shared, &uuid, why, &p.payload, p.gen,
                            store.read_chains(&uuid).as_deref());
                }
            }
```

`parse_cmd` gains the uuid argument and the verb:

```rust
pub fn parse_cmd(val: &str, cur: &str) -> Option<Job> {
    let mut it = val.split_whitespace();
    match it.next()? {
        // …existing arms unchanged…
        /* The Set is the one the engine already has open: a capture command
         * that named a different Set would be a command to capture a Set
         * nobody is editing. */
        "keep" => Some(Job::Keep { uuid: cur.to_string(), why: Why::from_str(it.next()?)? }),
        _ => None,
    }
}
```

And the accessor on `Saver`:

```rust
    pub fn versions(&self) -> String {
        self.shared.lock().unwrap().versions.clone()
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `~/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo test -p movy-dsp`
Expected: the whole crate passes, including the eight new saver tests.

- [ ] **Step 5: Prove the blank fix has teeth**

Put `let _ = std::fs::remove_dir_all(store.set_dir(&uuid));` back in the `Blank` arm in place of `blank_files`, re-run: `blanking_keeps_the_history_it_just_captured` must fail. Restore. Then set `VERSION_MIN_MS` to 0: `the_autosave_capture_is_rate_limited` must fail. Restore.

- [ ] **Step 6: Commit**

```bash
git add engine/crates/movy-dsp/src/set_saver.rs engine/crates/movy-dsp/src/set_store.rs
git commit -m "$(cat <<'EOF'
engine: capture where the overwriting happens

open, adopted, auto and pre-wipe never reach the wire — the jobs that
overwrite a Set are the jobs that capture it. Blanking now removes the
state files only: remove_dir_all would have taken the history at the one
moment the pre-wipe capture exists to preserve it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Restore in the engine

A restore replaces live work, so it is the one path that must outrank everything on disk — including the pre-restore capture it takes on the way. The ui half goes back over the wire rather than to the file: `ui-state.json` is the UI's (spec §5), and the UI applies the bytes down the path an ordinary load already uses.

**Files:**
- Modify: `engine/crates/movy-dsp/src/set_saver.rs`

**Interfaces:**
- Produces:
  - `Job::Restore { uuid: String, n: u32 }`
  - `Saver::vui(&self) -> String` — `pending` | `none` | `failed` | the ui bytes. Take-once: a read that returns bytes or a verdict resets it to `none`.
  - `parse_cmd` gains `restore <n>`

- [ ] **Step 1: Write the failing tests**

```rust
    /* A restore must win an ordinary read afterwards — including against the
     * pre-restore capture just taken. A hand-copy that does NOT bump the
     * generation loses to a newer blank in a shadow; that is what a device
     * showed, and why MANUAL.md tells anyone recovering by hand to overwrite
     * every copy. */
    #[test]
    fn a_restore_outranks_everything_on_disk() {
        let root = tmp("restore");
        let s = Saver::new(&root);
        s.submit(Job::Save { uuid: "u1".into(), payload: "movy1\ncl 0 0 16 0 old\n".into(), gen: 1, chains: "0\n".into() });
        s.submit(Job::Keep { uuid: "u1".into(), why: Why::Exit });
        s.submit(Job::Save { uuid: "u1".into(), payload: "movy1\n".into(), gen: 9, chains: "0\n".into() });
        s.drain_for_test();
        let n = versions_of(&root, "u1")[0].n;

        s.submit(Job::Restore { uuid: "u1".into(), n });
        s.drain_for_test();

        let store = SetStore::new(&root);
        let best = store.read_best("u1").expect("reads");
        assert_eq!(best.payload, "movy1\ncl 0 0 16 0 old\n");
        assert!(best.gen > 9, "the restore must outrank the newest generation: {}", best.gen);
    }

    /* A mis-press must not cost the live take: the restore is itself undoable. */
    #[test]
    fn a_restore_keeps_what_it_replaced() {
        let root = tmp("prerestore");
        let s = Saver::new(&root);
        s.submit(Job::Save { uuid: "u1".into(), payload: "movy1\ncl 0 0 16 0 a\n".into(), gen: 1, chains: "0\n".into() });
        s.submit(Job::Keep { uuid: "u1".into(), why: Why::Exit });
        s.submit(Job::Save { uuid: "u1".into(), payload: "movy1\ncl 0 0 16 0 live\n".into(), gen: 5, chains: "0\n".into() });
        s.drain_for_test();
        let n = versions_of(&root, "u1").iter().find(|r| r.why == Why::Exit).unwrap().n;

        s.submit(Job::Restore { uuid: "u1".into(), n });
        s.drain_for_test();
        let pre = versions_of(&root, "u1").into_iter().find(|r| r.why == Why::PreRestore);
        let pre = pre.expect("the live take was kept");
        assert_eq!(crate::version_store::read_state(&SetStore::new(&root), "u1", pre.n).unwrap().payload,
                   "movy1\ncl 0 0 16 0 live\n");
    }

    /* The restored bytes reach the audio thread the same way an open's do. */
    #[test]
    fn a_restore_publishes_what_the_engine_must_apply() {
        let root = tmp("restoreapply");
        let s = Saver::new(&root);
        s.submit(Job::Save { uuid: "u1".into(), payload: "movy1\ncl 0 0 16 0 a\n".into(), gen: 1, chains: "7\n".into() });
        s.submit(Job::Keep { uuid: "u1".into(), why: Why::Exit });
        s.submit(Job::Save { uuid: "u1".into(), payload: "movy1\n".into(), gen: 4, chains: "0\n".into() });
        s.drain_for_test();
        let n = versions_of(&root, "u1")[0].n;
        let _ = s.take_loaded();

        s.submit(Job::Restore { uuid: "u1".into(), n });
        s.drain_for_test();
        let (payload, chains, _gen) = s.take_loaded().expect("the restore must publish its bytes");
        assert_eq!(payload, "movy1\ncl 0 0 16 0 a\n");
        assert_eq!(chains, "7\n", "and the chains that were live with it");
    }

    /* An adopted OLDER sequence has no ui half, and overwriting the keyboard
     * and chains with nothing would be worse than the wipe this feature exists
     * to undo. `none` is the whole answer. */
    #[test]
    fn a_version_with_no_ui_half_answers_none() {
        let root = tmp("noui");
        let s = Saver::new(&root);
        s.submit(Job::Save { uuid: "u1".into(), payload: "movy1\ncl 0 0 16 0 a\n".into(), gen: 1, chains: "0\n".into() });
        s.submit(Job::Keep { uuid: "u1".into(), why: Why::Exit });
        s.drain_for_test();
        let n = versions_of(&root, "u1")[0].n;
        s.submit(Job::Restore { uuid: "u1".into(), n });
        s.drain_for_test();
        assert_eq!(s.vui(), "none");
    }

    #[test]
    fn a_restore_of_a_version_that_is_gone_says_so() {
        let root = tmp("restoremiss");
        let s = Saver::new(&root);
        s.submit(Job::Restore { uuid: "u1".into(), n: 7 });
        s.drain_for_test();
        assert_eq!(s.vui(), "failed");
        /* Taken once: a stale verdict must not be read as a second failure. */
        assert_eq!(s.vui(), "none");
    }

    #[test]
    fn parses_the_restore_command() {
        assert!(matches!(parse_cmd("restore 4", "u1"), Some(Job::Restore { n: 4, .. })));
        assert!(parse_cmd("restore", "u1").is_none());
        assert!(parse_cmd("restore x", "u1").is_none());
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `~/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo test -p movy-dsp set_saver`
Expected: compile error — `Job::Restore`, `Saver::vui`.

- [ ] **Step 3: Write the implementation**

Add to `Job`:

```rust
    /// Put a kept version back. The UI names `n` from the menu it was served.
    Restore { uuid: String, n: u32 },
```

Add to `Shared`:

```rust
    /// The restored version's ui half, waiting for the UI: `pending` while the
    /// job is queued, `none` when the version has no ui half or the answer has
    /// already been taken, `failed` when the restore did not happen, otherwise
    /// the bytes. The UI owns `ui-state.json` (spec §5), so the engine hands
    /// the bytes back rather than writing that file.
    vui: String,
```

Initialise to `"none".to_string()`. In `submit`, before the send:

```rust
        if matches!(job, Job::Restore { .. }) {
            self.shared.lock().unwrap().vui = "pending".to_string();
        }
```

The arm:

```rust
            Msg::Work(Job::Restore { uuid, n }) => {
                let src = crate::version_store::read_state(&store, &uuid, n);
                let Some(src) = src else {
                    crate::host::log(&format!("versions: cannot restore {n} of {uuid}"));
                    shared.lock().unwrap().vui = "failed".to_string();
                    continue;
                };
                /* Before anything is overwritten: a mis-press must not cost the
                 * live take, so a restore is itself undoable. */
                let cur = store.read_best(&uuid);
                if let Some(c) = &cur {
                    capture(&store, &shared, &uuid, Why::PreRestore, &c.payload, c.gen,
                            store.read_chains(&uuid).as_deref());
                }
                /* Above every copy AND every version, so nothing on disk can
                 * outrank the restore — including the capture just taken. */
                let mut top = cur.map_or(0, |c| c.gen);
                for r in &read_index(&store, &uuid).v {
                    if r.gen > top {
                        top = r.gen;
                    }
                }
                let gen = top + 1;
                /* The version's own chains, not today's: restoring the sequence
                 * under the instruments that replaced it is the loss `ch`
                 * exists to prevent. A version that carries none leaves the
                 * chains alone, which the menu shows as SEQ ONLY. */
                let chains = crate::version_store::read_chains(&store, &uuid, n)
                    .or_else(|| store.read_chains(&uuid))
                    .unwrap_or_else(|| "0\n".to_string());
                let ui = crate::version_store::read_ui(&store, &uuid, n);
                match store.write(&uuid, &src.payload, gen, &chains) {
                    Ok(()) => {
                        crate::host::log(&format!("versions: restored {n} of {uuid} at gen {gen}"));
                        let mut sh = shared.lock().unwrap();
                        sh.gen = gen;
                        sh.loaded = Some((src.payload, chains, gen));
                        sh.vui = ui.unwrap_or_else(|| "none".to_string());
                    }
                    Err(e) => {
                        crate::host::log(&format!("versions: restore of {n} did not reach disk: {e}"));
                        shared.lock().unwrap().vui = "failed".to_string();
                    }
                }
                publish_versions(&store, &shared, &uuid);
            }
```

The accessor — take-once, so a verdict is never read twice:

```rust
    pub fn vui(&self) -> String {
        let mut sh = self.shared.lock().unwrap();
        if sh.vui == "pending" {
            return sh.vui.clone();
        }
        std::mem::replace(&mut sh.vui, "none".to_string())
    }
```

`parse_cmd`:

```rust
        "restore" => Some(Job::Restore { uuid: cur.to_string(), n: it.next()?.parse().ok()? }),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `~/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo test -p movy-dsp set_saver`
Expected: all pass.

- [ ] **Step 5: Prove the generation rule has teeth**

Change `let gen = top + 1;` to `let gen = src.gen;` and re-run: `a_restore_outranks_everything_on_disk` must fail. Restore it.

- [ ] **Step 6: Commit**

```bash
git add engine/crates/movy-dsp/src/set_saver.rs
git commit -m "$(cat <<'EOF'
engine: restore a version, chains included

The restored generation sits above every copy AND every version, so
nothing on disk can outrank it — including the pre-restore capture the
restore takes on its way in. The ui half goes back over the wire: that
file is the UI's.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: The sweep

`set-gc.ts` walks `name-index.json` because the JS host cannot list a directory — so a Set whose index entry was overwritten is invisible to it. The 2026-08-27 device run collected 4 dead directories and a fifth survived, holding 1474 bytes of sequence. `read_dir` sees all of them.

The aliveness test is ported, not redesigned, including its warning: schwung's set pages physically `rename()` whole Set folders into `set_pages/page_<n>/`, so from any other page every Set on every other page reads as deleted.

**Files:**
- Create: `engine/crates/movy-dsp/src/set_gc.rs`
- Modify: `engine/crates/movy-dsp/src/set_saver.rs` (the `Gc` job and its published result)
- Modify: `engine/crates/movy-dsp/src/lib.rs` (`mod set_gc;`)

**Interfaces:**
- Produces:
  - `pub struct GcPaths { pub move_sets: PathBuf, pub page_roots: Vec<PathBuf> }`, with `pub fn from_cmd(sets: &str, pages: &str) -> GcPaths`
  - `pub fn uuid_alive(p: &GcPaths, uuid: &str) -> bool`
  - `pub fn collect(store: &SetStore, p: &GcPaths, keep: &str) -> Vec<String>`
  - `Job::Gc { keep: String, paths: GcPaths }`
  - `Saver::gc(&self) -> String` — `idle` | `pending` | `collected=<n>[ <uuid>…]`, take-once
  - `parse_cmd` gains `gc keep=<uuid> sets=<path> pages=<a>,<b>`

- [ ] **Step 1: Write the failing tests**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    struct Fixture {
        root: std::path::PathBuf,
        store: SetStore,
        paths: GcPaths,
    }

    fn fixture(name: &str) -> Fixture {
        let root = std::env::temp_dir().join(format!("movy-set-gc-{name}"));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("sets")).unwrap();
        fs::create_dir_all(root.join("Sets")).unwrap();
        Fixture {
            store: SetStore::new(root.join("sets").to_str().unwrap()),
            paths: GcPaths {
                move_sets: root.join("Sets"),
                page_roots: vec![root.join("set_pages")],
            },
            root,
        }
    }

    /// State movy holds for `uuid`, whether or not Move still has the Set.
    fn movy_state(f: &Fixture, uuid: &str) {
        f.store.write(uuid, "movy1\ncl 0 0 16 0 x\n", 1, "0\n").unwrap();
    }

    fn move_set(f: &Fixture, uuid: &str) {
        fs::create_dir_all(f.paths.move_sets.join(uuid)).unwrap();
    }

    #[test]
    fn collects_state_for_a_set_move_no_longer_has() {
        let f = fixture("dead");
        movy_state(&f, "live");
        move_set(&f, "live");
        movy_state(&f, "dead");
        assert_eq!(collect(&f.store, &f.paths, ""), vec!["dead".to_string()]);
        assert!(!f.store.set_dir("dead").exists());
        assert!(f.store.set_dir("live").exists());
    }

    /* The whole reason this moved: the JS sweep could only see uuids the name
     * index still named. read_dir sees the directory itself. */
    #[test]
    fn sees_a_set_no_index_ever_named() {
        let f = fixture("unnamed");
        movy_state(&f, "orphan-nobody-indexed");
        assert_eq!(collect(&f.store, &f.paths, ""), vec!["orphan-nobody-indexed".to_string()]);
    }

    /* schwung's set pages physically rename whole Set folders into
     * set_pages/page_<n>/, so from any other page every Set on every other page
     * reads as deleted. Never reduce this to a bare stat of Sets/. */
    #[test]
    fn a_set_stashed_on_another_page_is_alive() {
        let f = fixture("page");
        movy_state(&f, "onpage3");
        fs::create_dir_all(f.paths.page_roots[0].join("page_3").join("onpage3")).unwrap();
        assert!(collect(&f.store, &f.paths, "").is_empty());
        assert!(f.store.set_dir("onpage3").exists());
    }

    /* An unreadable Sets directory answers "no Set exists" for every uuid, and
     * acting on that answer deletes all of them. Nothing is collected unless
     * Move's own directory is there to be asked. */
    #[test]
    fn an_unreadable_sets_directory_collects_nothing() {
        let f = fixture("noSets");
        movy_state(&f, "dead");
        fs::remove_dir_all(&f.paths.move_sets).unwrap();
        assert!(collect(&f.store, &f.paths, "").is_empty());
        assert!(f.store.set_dir("dead").exists());
    }

    /* The live Set is never collected, whatever Move's directory says — the
     * user is playing it. */
    #[test]
    fn the_open_set_is_never_collected() {
        let f = fixture("keep");
        movy_state(&f, "open-right-now");
        assert!(collect(&f.store, &f.paths, "open-right-now").is_empty());
    }

    /* A provisional id names a PAD, not a Set: Move has no directory for it and
     * never will, so "missing from Sets/" says nothing about it. */
    #[test]
    fn provisional_ids_and_default_are_left_alone() {
        let f = fixture("pending");
        movy_state(&f, "__pending-2-7");
        movy_state(&f, "_default");
        assert!(collect(&f.store, &f.paths, "").is_empty());
    }

    /* The index lives beside the Set directories and is the UI's file. */
    #[test]
    fn the_name_index_is_not_a_set() {
        let f = fixture("index");
        fs::write(f.root.join("sets").join("name-index.json"), "{}").unwrap();
        assert!(collect(&f.store, &f.paths, "").is_empty());
        assert!(f.root.join("sets").join("name-index.json").exists());
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `~/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo test -p movy-dsp set_gc`
Expected: compile error — `collect` not found.

- [ ] **Step 3: Write the implementation**

```rust
//! Collecting state for Sets that no longer exist.
//!
//! Deleting a Set in Move takes `UserLibrary/Sets/<uuid>` with it but leaves
//! movy's `sets/<uuid>/` behind, unreachable and permanent. The JS sweep this
//! replaces walked `name-index.json` because the host cannot list a directory,
//! so a Set whose index entry was overwritten was invisible to it — on the
//! 2026-08-27 device run, 4 dead directories were collected and a fifth
//! survived holding 1474 bytes of sequence. `read_dir` sees all of them.
//!
//! davebox's asymmetry is the governing rule: keeping a stale state file costs
//! a few KB; deleting a live one destroys work. **Anything unverifiable counts
//! as ALIVE.**

use crate::set_store::SetStore;
use std::fs;
use std::path::PathBuf;

/// `SET_PAGES_TOTAL` in schwung's `shadow_set_pages.h`.
const SET_PAGES_TOTAL: u32 = 8;

pub struct GcPaths {
    /// Move's own `UserLibrary/Sets`.
    pub move_sets: PathBuf,
    /// Where schwung parks the Sets of a page you are not on. The UI names
    /// these — paths are its knowledge, the same way `setsdir` is.
    pub page_roots: Vec<PathBuf>,
}

impl GcPaths {
    pub fn from_cmd(sets: &str, pages: &str) -> GcPaths {
        GcPaths {
            move_sets: PathBuf::from(sets),
            page_roots: pages.split(',').filter(|s| !s.is_empty()).map(PathBuf::from).collect(),
        }
    }
}

/// Does Move still have this Set — on ANY set page, not just the current one?
pub fn uuid_alive(p: &GcPaths, uuid: &str) -> bool {
    if p.move_sets.join(uuid).exists() {
        return true;
    }
    for root in &p.page_roots {
        if !root.exists() {
            continue;
        }
        for page in 0..SET_PAGES_TOTAL {
            if root.join(format!("page_{page}")).join(uuid).exists() {
                return true;
            }
        }
    }
    false
}

/// A uuid the sweep must not judge: a pad Move has not committed, or no answer
/// at all. Neither is a Set, so "missing from Sets/" says nothing about it.
fn provisional(uuid: &str) -> bool {
    uuid == "_default" || uuid.starts_with("__pending")
}

/// Remove state for every Set directory whose Move Set is gone. `keep` is the
/// live Set, never collected whatever the directory says.
pub fn collect(store: &SetStore, p: &GcPaths, keep: &str) -> Vec<String> {
    /* The guard that makes this safe: an unreadable Sets directory answers "no
     * Set exists" for every uuid, and acting on that answer would delete all of
     * them. */
    if !p.move_sets.exists() {
        return Vec::new();
    }
    let Ok(entries) = fs::read_dir(&store.root) else { return Vec::new() };
    let mut removed = Vec::new();
    for e in entries.flatten() {
        if !e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            continue;
        }
        let uuid = e.file_name().to_string_lossy().into_owned();
        if uuid == keep || provisional(&uuid) || uuid_alive(p, &uuid) {
            continue;
        }
        if fs::remove_dir_all(e.path()).is_ok() {
            removed.push(uuid);
        }
    }
    if !removed.is_empty() {
        crate::host::log(&format!("seq: collected {} deleted set(s)", removed.len()));
    }
    removed
}
```

In `set_saver.rs`, the job and its published answer. Add to `Job`:

```rust
    /// The once-per-session sweep. Runs here because it is file work, and pure
    /// hygiene: it must never delay an instrument becoming playable.
    Gc { keep: String, paths: crate::set_gc::GcPaths },
```

Add to `Shared`: `gc: String,` initialised to `"idle".to_string()`. In `submit`, before the send:

```rust
        if matches!(job, Job::Gc { .. }) {
            self.shared.lock().unwrap().gc = "pending".to_string();
        }
```

The arm:

```rust
            Msg::Work(Job::Gc { keep, paths }) => {
                let removed = crate::set_gc::collect(&store, &paths, &keep);
                /* The uuids, not just a count: the UI drops those names from
                 * `name-index.json`, which is the only thing that file is for
                 * now that the sweep no longer walks it. */
                let mut line = format!("collected={}", removed.len());
                for uuid in &removed {
                    line.push(' ');
                    line.push_str(uuid);
                }
                shared.lock().unwrap().gc = line;
            }
```

The accessor — `pending` is not consumed, a verdict is:

```rust
    pub fn gc(&self) -> String {
        let mut sh = self.shared.lock().unwrap();
        if sh.gc == "pending" {
            return sh.gc.clone();
        }
        std::mem::replace(&mut sh.gc, "idle".to_string())
    }
```

`parse_cmd`:

```rust
        /* `keep=` is the Set the UI has open; `sets=` and `pages=` are Move's
         * own directories, which are the UI's knowledge — the engine learns
         * every path it touches rather than hardcoding one (see `setsdir`). */
        "gc" => {
            let (mut keep, mut sets, mut pages) = (String::new(), String::new(), String::new());
            for tok in it {
                if let Some(v) = tok.strip_prefix("keep=") { keep = v.to_string(); }
                else if let Some(v) = tok.strip_prefix("sets=") { sets = v.to_string(); }
                else if let Some(v) = tok.strip_prefix("pages=") { pages = v.to_string(); }
            }
            if sets.is_empty() { return None; }
            Some(Job::Gc { keep, paths: crate::set_gc::GcPaths::from_cmd(&sets, &pages) })
        }
```

Add `mod set_gc;` to `lib.rs`.

And one saver test, added to `set_saver.rs`'s tests:

```rust
    #[test]
    fn the_sweep_reports_what_it_collected() {
        let root = tmp("gc");
        let sets = format!("{root}/Sets");
        std::fs::create_dir_all(&sets).unwrap();
        let s = Saver::new(&root);
        s.submit(Job::Save { uuid: "dead".into(), payload: "movy1\ncl 0 0 16 0 x\n".into(), gen: 1, chains: "0\n".into() });
        s.drain_for_test();
        assert_eq!(s.gc(), "idle");

        s.submit(Job::Gc { keep: "live".into(), paths: crate::set_gc::GcPaths::from_cmd(&sets, "") });
        s.drain_for_test();
        assert_eq!(s.gc(), "collected=1 dead");
        assert_eq!(s.gc(), "idle", "a verdict is read once");
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `~/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo test -p movy-dsp`
Expected: all pass.

- [ ] **Step 5: Prove the safety guards have teeth**

Remove the `!p.move_sets.exists()` guard and re-run: `an_unreadable_sets_directory_collects_nothing` must fail. Make `uuid_alive` return `p.move_sets.join(uuid).exists()` only: `a_set_stashed_on_another_page_is_alive` must fail. Restore both.

- [ ] **Step 6: Commit**

```bash
git add engine/crates/movy-dsp/src/set_gc.rs engine/crates/movy-dsp/src/set_saver.rs engine/crates/movy-dsp/src/lib.rs
git commit -m "$(cat <<'EOF'
engine: a sweep that can see the directory

read_dir finds the dead Set no name index ever named — the fifth
directory the 2026-08-27 device run could not reach. The page-aware
aliveness test is ported verbatim, warning included.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: The wire

Three GETs, three commands, one version bump. Everything served here is a string the saver thread published — `get_param` runs on the audio thread and opens no file.

**Files:**
- Modify: `engine/crates/movy-dsp/src/lib.rs`
- Modify: `src/seq/constants.ts` (ENGINE_VERSION)

**Interfaces:**
- Consumes: `Saver::{versions, vui, gc}`, `set_saver::parse_cmd(val, cur)`
- Produces: GET keys `versions`, `vui`, `gc`; SET commands `keep <why>`, `restore <n>`, `gc keep= sets= pages=`

- [ ] **Step 1: Write the failing tests**

Add to `lib.rs`'s test module, beside `engpersist_off_means_the_engine_never_saves`. They use the file's own `Instance::new()` + `saver_tmp(name)` helpers, and assert only what is race-free: the saver thread's answers are checked in Tasks 4-6, so nothing here waits on a job.

```rust
    /* Without a saver there is nothing to ask, and the UI must be able to tell
     * that apart from an empty history: `versions` is empty either way, but a
     * restore that cannot be asked for is `failed`, never `none`. */
    #[test]
    fn the_new_keys_answer_before_setsdir_arrives() {
        let mut inst = Instance::new();
        assert_eq!(inst.get_param("versions").as_deref(), Some(""));
        assert_eq!(inst.get_param("vui").as_deref(), Some("failed"));
        assert_eq!(inst.get_param("gc").as_deref(), Some("idle"));
    }

    #[test]
    fn a_set_with_no_history_has_an_empty_menu() {
        let mut inst = Instance::new();
        inst.set_param("setsdir", &saver_tmp("menu"));
        assert_eq!(inst.get_param("versions").as_deref(), Some(""));
        assert_eq!(inst.get_param("vui").as_deref(), Some("none"));
        assert_eq!(inst.get_param("gc").as_deref(), Some("idle"));
    }

    /* The command reached the saver: `submit` marks the answer pending before
     * the send, so anything other than `none` means it was parsed, bound to the
     * open Set and queued. Which verdict it settles on is the saver's own test. */
    #[test]
    fn a_restore_command_reaches_the_saver() {
        let mut inst = Instance::new();
        inst.set_param("setsdir", &saver_tmp("restorecmd"));
        inst.set_param("set", "open u1");
        inst.set_param("set", "restore 7");
        assert_ne!(inst.get_param("vui").as_deref(), Some("none"));
    }

    /* Commands are parsed on the audio thread, so a malformed one must be
     * ignored rather than panic inside someone else's callback. */
    #[test]
    fn a_malformed_new_command_is_ignored() {
        let mut inst = Instance::new();
        inst.set_param("setsdir", &saver_tmp("bogus"));
        inst.set_param("set", "restore");
        inst.set_param("set", "restore x");
        inst.set_param("set", "keep");
        inst.set_param("set", "keep nonsense");
        inst.set_param("set", "gc keep=u1");          // no sets= — not a sweep
        inst.set_param("set", "");
        assert!(inst.get_param("set").is_some(), "the saver must still answer");
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `~/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo test -p movy-dsp --lib`
Expected: the four new tests fail — `versions`, `vui` and `gc` return `None`.

- [ ] **Step 3: Write the implementation**

In `set_param`, the `"set"` arm: pass the current uuid so `keep`/`restore` bind to the open Set.

```rust
            "set" => {
                if let Some(job) = set_saver::parse_cmd(val, &self.set_uuid) {
```

In `get_param`, beside the existing `"set"` arm:

```rust
            /* The menu, already formatted by the saver thread. Reading the file
             * here would be file I/O on the audio thread — the one thing this
             * module's own doc comment forbids. */
            "versions" => Some(self.saver.as_ref().map_or_else(String::new, |s| s.versions())),
            /* The restored version's ui half. `failed` with no saver, because
             * "no engine to ask" must not read as "this version has no ui". */
            "vui" => Some(self.saver.as_ref().map_or_else(|| "failed".to_string(), |s| s.vui())),
            "gc" => Some(self.saver.as_ref().map_or_else(|| "idle".to_string(), |s| s.gc())),
```

Bump the version in both files (the only bump in this plan):

```rust
const ENGINE_VERSION: &str = "0.75.0";
```

```ts
export const ENGINE_VERSION = '0.75.0';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `~/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo test -p movy-dsp`
Expected: the whole crate passes.

- [ ] **Step 5: Check the audio-thread rule by reading**

Grep the three new GET arms and confirm none of them calls `fs::`:
`grep -n "\"versions\"\|\"vui\"\|\"gc\"" -A 2 engine/crates/movy-dsp/src/lib.rs`
Expected: each arm is a `saver` accessor and nothing else.

- [ ] **Step 6: Commit**

```bash
git add engine/crates/movy-dsp/src/lib.rs src/seq/constants.ts
git commit -m "$(cat <<'EOF'
engine: the versions, vui and gc keys — ENGINE 0.75.0

Every one of them serves a string the saver thread already published:
get_param runs on the audio thread and must open no file.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: The menu comes off the wire

`buildVersionsPageVM` runs **every frame** while the BACKUPS page is open (`src/app/tick.ts:689`). An engine GET blocks 3-5 ms, so reading the menu per frame would cost more than the page is worth — movy's tick period IS its MIDI sampling interval. The rows are fetched when the page opens and after anything that changes them, and cached in between.

**Files:**
- Create: `src/seq/version-wire.ts`
- Modify: `src/seq/version-index.ts`, `src/seq/version-store.ts`, `src/seq/versions-page.ts`, `src/seq/versions-page-vm.ts`
- Modify: `browser-test/mock-engine.mjs`
- Test: `browser-test/logic/versions.mjs`

**Interfaces:**
- Consumes: `flagValue('engpersist')`, `readVersionIndex` (the flag-off path)
- Produces:
  - `parseVersionRows(raw: string | null): VersionRec[]`
  - `refreshVersionRows(): void`
  - `versionRows(uuid: string): VersionRec[]`
  - `resetVersionWire(): void`
  - `VersionRec` gains `ch: boolean`

- [ ] **Step 1: Write the failing tests**

Add a block to `browser-test/logic/versions.mjs`:

```js
{
    _log('\nthe menu off the wire:');
    const { installMockFs, uninstallMockFs, installMockEngine, uninstallMockEngine }
        = await import('./harness.mjs');
    const { parseVersionRows, refreshVersionRows, versionRows, resetVersionWire }
        = await import('../../dist/esm/seq/version-wire.js');
    const { buildVersionsPageVM } = await import('../../dist/esm/seq/versions-page-vm.js');
    const { setFlag } = await import('../../dist/esm/seq/flags.js');

    const rows = parseVersionRows('3 9 1788892154000 open 6 1 1\n1 4 0 adopted 2 0 0');
    eq('parses both rows', rows.length, 2);
    eq('newest first as the engine sends it', rows[0].n, 3);
    eq('carries why', rows[1].why, 'adopted');
    eq('carries the chains flag', rows[0].ch, true);
    eq('a version with neither half', rows[1].ui || rows[1].ch, false);
    /* An engine that has not answered is NO VERSIONS, never a crash — the same
     * rule the file reader applies to an unreadable index. */
    eq('no answer is empty', parseVersionRows(null).length, 0);
    eq('an empty answer is empty', parseVersionRows('').length, 0);
    eq('a malformed row is dropped', parseVersionRows('x y z\n1 4 0 open 2 0 0').length, 1);

    /* Mock fs as well as mock engine: `setFlag` writes the value to prefs.json,
     * and a flag that cannot be stored is a flag the next read does not see. */
    installMockFs({});
    const engine = installMockEngine();
    setFlag('engpersist', 1);
    engine.versions = '2 7 0 exit 3 1 1';
    refreshVersionRows();
    eq('the rows came from the engine', versionRows('S1')[0].n, 2);

    /* The page repaints every frame. A menu that asked the engine per frame
     * would cost 3-5 ms of the tick that samples MIDI. */
    const before = engine.getParamCalls;
    for (let i = 0; i < 10; i++) buildVersionsPageVM(Date.now(), 'S1');
    eq('ten frames cost no engine reads', engine.getParamCalls, before);

    /* SEQ ONLY means neither half came with it. A version that carries chains
     * alone still restores instruments, so it is not seq-only. */
    engine.versions = '5 9 0 adopted 1 0 0';
    refreshVersionRows();
    eq('neither half reads as SEQ ONLY', buildVersionsPageVM(Date.now(), 'S1').rows[0].seqOnly, true);
    engine.versions = '5 9 0 adopted 1 0 1';
    refreshVersionRows();
    eq('chains alone is not SEQ ONLY', buildVersionsPageVM(Date.now(), 'S1').rows[0].seqOnly, false);

    setFlag('engpersist', 0);
    resetVersionWire();
    uninstallMockEngine();
    uninstallMockFs();
}
```

In `browser-test/mock-engine.mjs`, add `versions: ''`, `vui: 'none'`, `gc: 'idle'` to the engine object and its `reset()`, and serve them in `getParam`:

```js
        /* The version menu, the restored ui half and the sweep's verdict — all
         * three are strings the real engine's saver thread has already
         * published, so the mock serves them the same way: a field a test sets,
         * never something computed from what the UI just wrote. */
        if (key === 'versions') return engine.versions;
        if (key === 'vui') {
            const v = engine.vui;
            if (v !== 'pending') engine.vui = 'none';
            return v;
        }
        if (key === 'gc') {
            const v = engine.gc;
            if (v !== 'pending') engine.gc = 'idle';
            return v;
        }
```

- [ ] **Step 2: Run the suite to verify it fails**

Run: `npm run build:browser && node browser-test/logic.mjs 2>&1 | grep -A 20 "the menu off the wire"`
Expected: the import of `version-wire.js` fails.

- [ ] **Step 3: Write the implementation**

`src/seq/version-index.ts` — one field on the record and its parser:

```ts
    ui: boolean;    // whether v/<n>/ui-state.json exists
    /* Whether v/<n>/chains.json exists. Absent in every version written before
     * the engine owned the chains, where they rode inside the ui blob — which
     * is why a missing field must read as false rather than as unknown. */
    ch: boolean;
```

In `parseVersionIndex`'s `map`, add `ch: r.ch === true,`.

`src/seq/version-store.ts` — the old path never writes a chains file:

```ts
    idx.v.unshift({ n, gen, ms: now, why, clips: countClips(payload), ui: hasUi, ch: false });
```

Create `src/seq/version-wire.ts`:

```ts
/* The BACKUPS menu's rows, from whichever half owns them.
 *
 * With `engpersist` on the index is the engine's file and never read here; the
 * rows arrive as text on a GET. They are CACHED because the page's viewmodel is
 * rebuilt every frame (app/tick.ts) and an engine GET blocks 3-5 ms — movy's
 * tick period is its MIDI sampling interval, so a per-frame read would be felt
 * under the fingers. Refreshed when the page opens and after anything that
 * changes the history. */

import { flagValue } from './flags.js';
import { readVersionIndex } from './version-store.js';
import type { VersionRec, VersionWhy } from './version-index.js';

const WHYS: VersionWhy[] = ['open', 'auto', 'exit', 'pre-wipe', 'pre-restore', 'adopted'];

let rows: VersionRec[] = [];

/** `n gen ms why clips ui ch`, one version per line, newest first. */
export function parseVersionRows(raw: string | null): VersionRec[] {
    if (!raw) return [];
    const out: VersionRec[] = [];
    for (const line of raw.split('\n')) {
        const t = line.split(' ');
        if (t.length < 7) continue;
        const n = +t[0], gen = +t[1], ms = +t[2], clips = +t[4];
        /* A row we cannot read is dropped rather than defaulted, exactly as the
         * file parser drops a record: an entry whose generation is unknown
         * cannot be ordered, and an unordered entry in a restore menu is worse
         * than an absent one. */
        if (!isFinite(n) || !isFinite(gen) || !isFinite(ms)) continue;
        if (WHYS.indexOf(t[3] as VersionWhy) < 0) continue;
        out.push({
            n, gen, ms, why: t[3] as VersionWhy,
            clips: isFinite(clips) ? clips : 0,
            ui: t[5] === '1', ch: t[6] === '1',
        });
    }
    return out;
}

export function refreshVersionRows(): void {
    if (typeof host_module_get_param !== 'function') return;
    rows = parseVersionRows(host_module_get_param('versions'));
}

export function resetVersionWire(): void {
    rows = [];
}

/** The menu's rows. The file is read only while the old path owns it. */
export function versionRows(uuid: string): VersionRec[] {
    return flagValue('engpersist') ? rows : readVersionIndex(uuid).v;
}
```

`src/seq/versions-page.ts` — three call sites move from `readVersionIndex(uuid).v` to `versionRows(uuid)`, and the page refreshes on open:

```ts
import { refreshVersionRows, versionRows } from './version-wire.js';

export function openVersionsPage(): void {
    resetVersionsPage();
    /* Once, here: the page's viewmodel is rebuilt every frame and must not buy
     * an engine read per repaint. */
    refreshVersionRows();
    openParamPage(VIEW_VERSIONS);
}
```

`src/seq/versions-page-vm.ts`:

```ts
    const rows = versionRows(uuid).map((r) => ({
        age: agoLabel(r.ms, now),
        why: WHY_LABEL[r.why],
        clips: r.clips === 1 ? '1 CLIP' : r.clips + ' CLIPS',
        /* Neither half: the sequence comes back and everything else stays as
         * it is. A version carrying chains alone still restores instruments. */
        seqOnly: !r.ui && !r.ch,
    }));
```

- [ ] **Step 4: Run the suite to verify it passes**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: 0 failures, including every existing `versions.mjs` assertion for the flag-off path.

- [ ] **Step 5: Prove the per-frame assertion has teeth**

Make `buildVersionsPageVM` call `refreshVersionRows()` itself and re-run: `ten frames cost no engine reads` must fail. Remove it again.

- [ ] **Step 6: Commit**

```bash
git add src/seq/version-wire.ts src/seq/version-index.ts src/seq/version-store.ts src/seq/versions-page.ts src/seq/versions-page-vm.ts browser-test/mock-engine.mjs browser-test/logic/versions.mjs
git commit -m "$(cat <<'EOF'
movy: the BACKUPS menu comes off the wire

Cached, because the page's viewmodel is rebuilt every frame and an
engine GET blocks 3-5 ms — movy's tick period is its MIDI sampling
interval.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: The UI stops capturing

With the flag on, the TypeScript captures must not run: two implementations writing the same ladder would interleave version numbers and each would prune the other's entries. `exit`, the restore and the sweep become commands; `pre-wipe` becomes the `blank` command the engine has been waiting for since step 4.

The restore cannot be awaited — there is no sleep in this host, and the saver is a separate thread — so it completes on a later tick, the way settling does.

**Files:**
- Modify: `src/seq/version-restore.ts`, `src/seq/set-session.ts`, `src/seq/set-fail.ts`, `src/seq/set-gc.ts`, `src/seq/versions-page.ts`
- Test: `browser-test/logic/versions.mjs`, `browser-test/logic/set-session.mjs`

**Interfaces:**
- Consumes: `refreshVersionRows` (Task 8), the `vui`/`gc` GETs (Task 7)
- Produces:
  - `restoreTick(): boolean` — true on the tick a restore completed; the caller re-enters the load
  - `restorePending(): boolean` — a restore is in flight, so the page must not read "not done yet" as "refused"
  - `gcTick(): void` — reads the sweep's verdict once and prunes the name index
  - `collectDeadSets(keep)` gains the engine branch

- [ ] **Step 1: Write the failing tests**

Add to `browser-test/logic/versions.mjs`:

```js
{
    _log('\nengine-owned capture and restore:');
    const { installMockFs, uninstallMockFs, installMockEngine, uninstallMockEngine }
        = await import('./harness.mjs');
    const { setFlag } = await import('../../dist/esm/seq/flags.js');
    const { restoreVersion, restoreTick, restorePending }
        = await import('../../dist/esm/seq/version-restore.js');
    const { collectDeadSets } = await import('../../dist/esm/seq/set-gc.js');
    const { readVersionIndex } = await import('../../dist/esm/seq/version-store.js');
    const { loadNameIndex } = await import('../../dist/esm/seq/set-context.js');
    const { readUiBlob } = await import('../../dist/esm/seq/persist-store.js');
    const SETS = '/data/UserData/schwung/modules/tools/movy/sets';

    const fs = installMockFs({ [`${SETS}/name-index.json`]: '{"ALIVE":"A1","DEAD":"D1"}' });
    const engine = installMockEngine();
    setFlag('engpersist', 1);

    /* Two ladders writing the same directory would interleave version numbers
     * and prune each other's entries. With the flag on the UI keeps none. */
    engine.vui = 'pending';
    eq('a restore does not finish on the press', restoreVersion('S1', 3), false);
    ok('and the page can tell that apart from a refusal', restorePending());
    ok('the command went out', engine.setCmds.indexOf('restore 3') >= 0);
    eq('and no version file was written', fs.writes.filter((p) => p.includes('/v/')).length, 0);
    eq('the UI wrote no index either', readVersionIndex('S1').v.length, 0);

    eq('a pending restore is not done', restoreTick(), false);
    engine.vui = '{"root":48}';
    eq('the answer completes it', restoreTick(), true);
    eq('and the ui half landed in the UI\'s own file', readUiBlob('S1'), '{"root":48}');

    /* An adopted older sequence has no ui half; overwriting the chains with
     * nothing would be worse than the wipe the feature exists to undo. */
    const beforeUi = readUiBlob('S1');
    restoreVersion('S1', 4);
    engine.vui = 'none';
    eq('a version with no ui half still completes', restoreTick(), true);
    eq('and left the ui blob alone', readUiBlob('S1'), beforeUi);

    /* A restore that never lands must not re-enter the load forever. */
    restoreVersion('S1', 5);
    engine.vui = 'pending';
    let spun = 0;
    while (restoreTick() === false && spun < 200) spun++;
    ok('a restore that never answers gives up', spun < 200);

    /* The sweep: the engine names what it collected and the UI drops those
     * names. The aliveness test is gone from TypeScript entirely. */
    engine.gc = 'pending';
    collectDeadSets('A1');
    ok('the sweep was asked for', engine.setCmds.some((c) => c.startsWith('gc ')));
    ok('with Move\'s own directory named', engine.setCmds.some((c) => c.includes('sets=/data/UserData/UserLibrary/Sets')));
    eq('nothing is dropped while it is pending', Object.keys(loadNameIndex()).length, 2);
    engine.gc = 'collected=1 D1';
    const { gcTick } = await import('../../dist/esm/seq/set-gc.js');
    gcTick();
    const idx = loadNameIndex();
    eq('the collected name is gone', 'DEAD' in idx, false);
    eq('the live one stays', idx.ALIVE, 'A1');

    setFlag('engpersist', 0);
    uninstallMockEngine();
    uninstallMockFs();
}
```

Add to `browser-test/logic/set-session.mjs`, inside its existing engine-owned block (follow the file's own fixture helpers):

```js
    /* The boundary captures are commands now. A forced flush is a teardown or
     * a Set switch — the last chance this Set has to record where it got to. */
    eq('E1 a forced flush asks the engine to keep a version',
        engine.setCmds.filter((c) => c === 'keep exit').length, 1);
    /* And the UI writes no history of its own while the engine owns it. */
    eq('E2 no version file crossed the UI', fs.writes.filter((p) => p.includes('/v/')).length, 0);
    /* Start-from-scratch is the engine's blank, which captures before it
     * removes — the UI writing a blank blob would leave the engine's own files
     * untouched and the Set would come back on the next open. */
    sessionStartFromScratch();
    ok('E3 blanking is a command', engine.setCmds.some((c) => c.startsWith('blank ')));
```

- [ ] **Step 2: Run the suites to verify they fail**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: `restoreTick` / `gcTick` are not exported; the new assertions fail.

- [ ] **Step 3: Write the implementation**

`src/seq/version-restore.ts` — the engine branch and the tick that finishes it:

```ts
import { flagValue } from './flags.js';
import { refreshVersionRows } from './version-wire.js';

/* A restore cannot be awaited: the saver is another thread and this host has no
 * sleep. So the press sends the command and a later tick collects the answer —
 * the same shape settling uses for module loads. */
let pending: { uuid: string; tries: number } | null = null;

/* ~2.5 s at the tick rate this runs at. A restore is a handful of file
 * operations; a bound this loose only ever fires when something is wrong, and
 * firing is what stops the page waiting forever. */
const RESTORE_TRIES = 60;

function restoreViaEngine(uuid: string, n: number): boolean {
    if (typeof host_module_set_param_blocking !== 'function') return false;
    host_module_set_param_blocking('set', 'restore ' + n, 200);
    pending = { uuid, tries: 0 };
    return false;   // nothing to reload yet — restoreTick says when
}

/** True on the tick a restore completed: the caller re-enters the load. */
export function restoreTick(): boolean {
    if (!pending) return false;
    const v = typeof host_module_get_param === 'function'
        ? host_module_get_param('vui') : null;
    if (v === null || v === 'pending') {
        if (++pending.tries < RESTORE_TRIES) return false;
        mlog('versions: restore never answered — giving up');
        pending = null;
        return false;
    }
    const { uuid } = pending;
    pending = null;
    refreshVersionRows();
    if (v === 'failed') {
        mlog('versions: the engine refused the restore');
        return false;
    }
    /* The version's ui half, written to the UI's own file: that half is ours
     * (spec §5), and the reload below applies it the way an ordinary load
     * would. `none` means the version carried none — an adopted older sequence
     * — and the chains stay as they are. */
    if (v !== 'none' && v.length > 0) writeUiBlob(uuid, v);
    return true;
}

export function resetVersionRestore(): void {
    pending = null;
}

/** Is a restore in flight? `restoreVersion` answers false on the press with the
 *  flag on, and without this the page reads that as a refusal and says so. */
export function restorePending(): boolean {
    return pending !== null;
}

export function restoreVersion(uuid: string, n: number, now: number = Date.now()): boolean {
    if (flagValue('engpersist')) return restoreViaEngine(uuid, n);
    // …the existing body, unchanged…
}
```

`src/seq/versions-page.ts` — a press that started a restore has not failed:

```ts
    versionsPageState.confirming = false;
    if (restoreVersion(uuid, rec.n)) return true;
    /* With the engine owning the files the restore finishes on a later tick, so
     * "not done yet" is not a refusal — and a log line saying it was would send
     * the next reader hunting a failure that did not happen. */
    if (!restorePending()) mlog('versions: restore refused for ' + rec.n);
    return false;
```

`src/seq/set-fail.ts` — the blank becomes a command:

```ts
export function sessionStartFromScratch(): void {
    mlog('seq: starting ' + (currentSetUuid() || 'this set') + ' from scratch on request');
    const id = currentSetUuid() || '_default';
    /* Engine-owned: it captures the pre-wipe version and removes the state
     * files itself. Writing a blank blob from here would leave the engine's own
     * files untouched, and the Set the user asked to be rid of would come
     * straight back on the next open. */
    if (flagValue('engpersist')) {
        if (typeof host_module_set_param_blocking === 'function')
            host_module_set_param_blocking('set', 'blank ' + id, 200);
        bumpGen();
        clearFailure();
        return;
    }
    const stored = readBestState(id);
    if (stored) captureVersion(id, 'pre-wipe', stored.payload, stored.gen);
    writeStateBlob(id, BLANK_STATE, currentGen() + 1);
    bumpGen();
    clearFailure();
}
```

`src/seq/set-gc.ts` — the engine branch plus the verdict reader:

```ts
import { flagValue } from './flags.js';

/* Where schwung parks the Sets belonging to a set page you are not on. The
 * engine tests the same paths; they are named here because paths are the UI's
 * knowledge, the way `setsdir` is. */
const PAGE_ROOTS = [ /* unchanged */ ];

let sweeping = false;

export function collectDeadSets(keep: string): number {
    if (flagValue('engpersist')) {
        if (typeof host_module_set_param_blocking === 'function') {
            host_module_set_param_blocking('set',
                'gc keep=' + keep + ' sets=' + MOVE_SETS_DIR + ' pages=' + PAGE_ROOTS.join(','), 200);
            sweeping = true;
        }
        return 0;
    }
    // …the existing body, unchanged…
}

/** Read the sweep's verdict once, and drop the names it collected.
 *
 *  `name-index.json` is the UI's file and all that is left of it is the rename
 *  policy's lookup — the sweep no longer walks it, so the only thing it needs
 *  from the engine is which names are now dead. */
export function gcTick(): void {
    if (!sweeping || typeof host_module_get_param !== 'function') return;
    const v = host_module_get_param('gc');
    if (v === null || v === 'pending') return;
    sweeping = false;
    const parts = v.split(' ');
    if (parts.length < 2) return;
    const idx = loadNameIndex();
    let changed = false;
    for (const uuid of parts.slice(1)) {
        for (const name in idx) if (idx[name] === uuid) { delete idx[name]; changed = true; }
    }
    if (changed) saveNameIndex(idx);
    mlog('seq: engine ' + parts[0].replace('=', ' ') + ' deleted set(s)');
}

export function resetSetGc(): void {
    sweeping = false;
}
```

`src/seq/set-session.ts` — skip the TS captures, send the boundary command, drive the two ticks:

In `enterLoading`:

```ts
    /* Engine-owned: the Open job adopts and captures before it reads, where the
     * engine already knows what it is about to overwrite. Running both would
     * interleave two ladders in one directory. */
    if (!flagValue('engpersist')) {
        adoptExistingVersions(id);
        if (stored) captureVersion(id, 'open', stored.payload, stored.gen);
    }
```

In `sessionFlush`:

```ts
    if (force && r.ok) {
        if (flagValue('engpersist')) {
            /* The one capture that is a command: the engine cannot see a
             * teardown or a Set switch, and this is the last chance this Set
             * has to record where it got to. */
            if (typeof host_module_set_param_blocking === 'function')
                host_module_set_param_blocking('set', 'keep exit', 200);
        } else {
            captureVersion(setId, 'exit', savedPayload(), gen);
        }
    }
```

In `sessionTick`, immediately after the `engineReady()` guard and before the poll:

```ts
    /* Both answers arrive on a later tick than the command that asked for them
     * — a saver thread cannot be awaited from here. */
    if (restoreTick()) { reloadCurrentSet(); return; }
    gcTick();
```

And in `resetSetSession`, beside `resetVersionCapture()`: `resetVersionRestore(); resetSetGc();`

- [ ] **Step 4: Run the suites to verify they pass**

Run: `npm run build:browser && node browser-test/logic.mjs`
Expected: 0 failures. Every pre-existing `set-session.mjs` and `versions.mjs` assertion must pass untouched — if a rename-vs-switch assertion needs editing, the boundary was drawn wrong.

- [ ] **Step 5: Prove the two-ladder guard has teeth**

Remove the `if (!flagValue('engpersist'))` around the `enterLoading` captures and re-run: `E2 no version file crossed the UI` must fail. Restore it.

- [ ] **Step 6: Commit**

```bash
git add src/seq/version-restore.ts src/seq/versions-page.ts src/seq/set-session.ts src/seq/set-fail.ts src/seq/set-gc.ts browser-test/logic/versions.mjs browser-test/logic/set-session.mjs
git commit -m "$(cat <<'EOF'
movy: the UI stops keeping its own history

With the flag on, exit, the restore, the sweep and the wipe are
commands. A restore finishes on a later tick because the saver is
another thread and this host has no sleep.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Verify, on the device and off it

**Files:**
- Modify: `CHANGELOG.md`, `docs/superpowers/specs/2026-09-11-engine-owned-persistence-design.md` (§12 step 5), `plans/2026-09-12-engine-versions-and-gc.md` (status)

- [ ] **Step 1: The whole local gate**

```bash
cd movy && npm test
(cd engine && ~/.rustup/toolchains/stable-aarch64-apple-darwin/bin/cargo test)
```

Expected: 0 failures in all nine local suites; the whole `movy-dsp` crate green. If `screenshot.mjs` reports a diff, look at it before updating — the BACKUPS page's rows are unchanged by design, so a diff means the SEQ ONLY rule moved something it should not have. Only if the change is intended: `node browser-test/screenshot.mjs --update`.

- [ ] **Step 2: Deploy and run the device suites with the flag OFF**

```bash
ssh -o ConnectTimeout=3 ableton@move.local echo ok 2>/dev/null \
  && ./scripts/deploy.sh && ./scripts/test-versions.sh && ./scripts/test-seq.sh \
  || echo "DEVICE OFFLINE — SKIPPING DEVICE TESTS"
```

This is the regression arm: the default is still 0, so the old path must behave exactly as it did. `deploy.sh` restarts the stack on an md5 change — a redeployed `dsp.so` is not the one running until it does. **If the device is unreachable, report DEVICE OFFLINE to the user in CAPS.**

- [ ] **Step 3: Run the version suite with the flag ON — the arm that tests this plan**

A stored flag beats a changed default, so the value goes in `prefs.json` with movy closed, and the engine re-reads it on boot:

```bash
ssh ableton@move.local "grep -o 'engpersist[^,]*' /data/UserData/schwung/modules/tools/movy/prefs.json"
# set it to 1 with movy CLOSED, then:
./scripts/test-versions.sh
```

Expected: `versions.json` created, an `"why":"adopted"` entry, `v/` populated, and the restore gesture bringing the deleted clip back — the same assertions, now satisfied by the engine. Device suites are FLAKY: run each once, read the output for a regression in what this plan changed, and report anything else to the user rather than chasing it.

- [ ] **Step 4: Check what the engine left behind**

```bash
ssh ableton@move.local "ls -la /data/UserData/schwung/modules/tools/movy/sets/*/v/*/ | head -20"
```

Expected: `seq-state.json`, and for versions captured with the flag on, `chains.json` beside it. A `v/<n>/` holding only a sequence is a version captured by the old path — correct, and what the menu shows as SEQ ONLY.

- [ ] **Step 5: Set the flag back to 0 and confirm the history survives the flip**

Turn `engpersist` off in Settings, reopen the BACKUPS page, and confirm the same versions are listed. Both halves read the same `versions.json`; a list that changed means the format drifted, which is Task 1's golden failing in the field.

- [ ] **Step 6: Document and close**

Add to `CHANGELOG.md` under `[Unreleased] → Added`, inside the existing engine-owned persistence entry:

```markdown
  The version history and the dead-Set sweep moved with it: the engine keeps
  `versions.json` and `v/<n>/` itself (a version now carries its chains as well
  as its sequence and ui state), and the sweep uses `read_dir`, so a Set whose
  name-index entry was overwritten is no longer invisible to it.
```

In the spec, mark §12 step 5 done. In this plan's header, add `**Status: DONE**` with the commit range. Then:

```bash
git add CHANGELOG.md docs/superpowers/specs/2026-09-11-engine-owned-persistence-design.md plans/2026-09-12-engine-versions-and-gc.md
git commit -m "$(cat <<'EOF'
plan: versions and GC are the engine's now

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
git push
```

---

## Spec coverage

§7 GC → Task 6 (`read_dir`, the page-aware test, the ALIVE-when-unverifiable guard) and Task 9 (the name-index prune). §7 versions → Tasks 1-5. §7 "a version is three files" → Task 3, and the restore side in Task 5. §7 "the index crosses the wire" → Tasks 3 (`wire_rows`), 7 (the GET) and 8 (the cached reader). §7 "the engine hands back the ui bytes" → Task 5 (`vui`) and Task 9 (`restoreTick`). §7 "four captures never reach the wire" → Task 4. §5 file ownership → Tasks 4-5 never write `ui-state.json`. §9 errors → `failed` in Task 5, the unreadable-`Sets/` guard in Task 6, the give-up bound in Task 9. §10 testing → every task's test step, with a teeth step in Tasks 1-9. §12 step 5 → this plan; step 6 (default ON, delete the old path) is deliberately still the next one.

## What this plan does NOT do

- **It does not delete the TypeScript.** `version-capture.ts`, `version-store.ts`, `version-retain.ts` and the reading half of `set-gc.ts` all stay, reachable with the flag off. §12 step 6 removes them, in the release that flips the default.
- **It does not flip the default.** That needs a `FLAGS_REV` bump or a stored 0 beats the new default and it ships to nobody.
- **It does not move `rename`.** The UI still copies the bytes itself on a materialisation (`set-session.ts`), and `Job::Rename` stays unused. That is step-4 residue, not version history, and folding it in here would put an untested path in the middle of a plan about a different subsystem.
- **It does not change the on-disk layout.** `remove_dir_all` means one-directory-per-version is no longer load-bearing, but changing it would break the flag's symmetry for no user-visible gain.
- **It does not touch `MANUAL.md`.** `engpersist` is debug-only until the default flips; the manual describes BACKUPS as the user meets it, and nothing the user meets changes here.
