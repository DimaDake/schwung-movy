//! One Set's files, owned by the engine.
//!
//! `host_write_file` is fopen("w")+fwrite+fclose — no rename, no fsync, no
//! unlink — which is why `persist-store.ts` had to build crash-safety out of
//! redundancy: two rotating shadows and a read-back-and-compare whose own
//! comment concedes "that is not fsync — it cannot prove the bytes reached
//! flash". Rust has the real primitives, so the canonical file arrives by
//! rename and the shadows stop being written.
//!
//! They are still READ. A device carries Sets written by every movy it has
//! ever run, and the precedence between those copies is load-bearing — see
//! `legacy_canonical_with_content_beats_a_higher_shadow`.

use crate::set_envelope::{parse, wrap, Parsed, BLANK_STATE};
use std::fs;
use std::io::Write;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

/* The engine runs as root, inside Move's audio process; movy's UI runs as
 * `ableton`, in the manager process. So anything the engine creates with
 * default permissions locks the other half out of its own Set directory — and
 * the UI still writes `ui-state.json` beside these files, still writes the Set
 * itself whenever `engpersist` goes back off, and the device fixture writes it
 * too. Measured: `ableton` could not overwrite a root-owned `seq-state.json`,
 * which is what aborted nine device suites at `test_set_begin`.
 *
 * Group- and world-writable is the price of two processes owning one
 * directory. Nothing here is a secret, and the alternative is a Set only one
 * half of movy can save. */
const DIR_MODE: u32 = 0o777;
const FILE_MODE: u32 = 0o666;

/// `mkdir -p`, left writable by both halves.
pub(crate) fn ensure_dir(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|e| format!("mkdir {path:?}: {e}"))?;
    let _ = fs::set_permissions(path, fs::Permissions::from_mode(DIR_MODE));
    Ok(())
}

pub struct SetStore {
    pub root: PathBuf,
}

/// Content worth a file. A Set the user merely visited must leave no trace:
/// `setHasState` and `findInheritCandidates` both read existence directly, so
/// a file meaning "visited" would make every switch look like a rename.
pub fn is_blank(payload: &str, chains: &str) -> bool {
    payload.len() <= BLANK_STATE.len() && chains.trim() == "0"
}

/// Write-temp → fsync → rename. The rename is atomic, so a reader never sees a
/// partial canonical file — the thing the two shadows existed to survive.
pub(crate) fn atomic_write(path: &Path, content: &str) -> Result<(), String> {
    let tmp = path.with_extension("writing");
    {
        let mut f = fs::File::create(&tmp).map_err(|e| format!("create {tmp:?}: {e}"))?;
        /* Set on the temp file, so the mode arrives with the rename rather than
         * in a window after it. */
        let _ = f.set_permissions(fs::Permissions::from_mode(FILE_MODE));
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
    /// of the same paths through `host_file_exists`, and the two must agree
    /// without either of them parsing anything.
    pub fn has_state(&self, uuid: &str) -> bool {
        self.state_path(uuid).exists() || self.chains_path(uuid).exists()
    }

    pub fn read_best(&self, uuid: &str) -> Option<Parsed> {
        let canon = fs::read_to_string(self.state_path(uuid)).ok().and_then(|s| parse(&s));

        /* A canonical with no envelope was written by a build predating it, and
         * such a build never touches the shadows — so with real content it is
         * necessarily NEWER than any shadow, however high that shadow's
         * generation. Ordering it by generation would silently restore the
         * pre-downgrade Set over the user's later work.
         *
         * "Real content" is the guard against the other reading of the same
         * bytes: a canonical torn down past its `gen` line also parses as
         * legacy, but only as the bare tag, and must fall through instead. */
        if let Some(c) = &canon {
            if c.legacy && c.payload.len() > BLANK_STATE.len() {
                return canon;
            }
        }

        let mut best = canon;
        for slot in [1u8, 2] {
            if let Some(c) = fs::read_to_string(self.shadow_path(uuid, slot)).ok().and_then(|s| parse(&s)) {
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
        ensure_dir(&self.set_dir(uuid))?;
        /* Neither half is rewritten with bytes it already holds. One save
         * carries both, and the chains settle a beat after the sequence does —
         * so without this, a Set that had only finished loading its modules
         * rewrote its sequence too, at a new generation, on every open. A
         * device run caught it: the bytes `test-versions.sh` adopted were not
         * the bytes still on disk a moment later. */
        if fs::read_to_string(self.state_path(uuid)).ok().and_then(|s| parse(&s))
            .map_or(true, |p| p.payload != payload)
        {
            atomic_write(&self.state_path(uuid), &wrap(payload, gen))?;
        }
        if self.read_chains(uuid).as_deref() != Some(chains) {
            atomic_write(&self.chains_path(uuid), chains)?;
        }
        Ok(())
    }

    /// Give up this Set's state without giving up its history. `remove_dir_all`
    /// on the whole directory would take `v/` with it — deleting the record at
    /// the one moment the user is destroying the thing it records.
    pub fn blank_files(&self, uuid: &str) {
        for p in [self.state_path(uuid), self.chains_path(uuid),
                  self.shadow_path(uuid, 1), self.shadow_path(uuid, 2)] {
            let _ = fs::remove_file(p);
        }
    }

    /// Copy-on-inherit: Move's Copy/Paste makes "X Copy" with no movy state of
    /// its own. The UI names the source — that is name policy, and it stays in
    /// `set-inherit.ts` — and the engine moves the bytes. A seed lands at
    /// generation 1 so the copy owns its own sequence from here on.
    pub fn seed(&self, dst: &str, src: &str) -> bool {
        let Some(state) = self.read_best(src) else { return false };
        let chains = self.read_chains(src).unwrap_or_else(|| "0\n".to_string());
        self.write(dst, &state.payload, 1, &chains).is_ok()
    }
}

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
    const CHAINS: &str = "5\n1\n0\n5\nsynth\n10\nnoisemaker\n4\nblob\n15\n1.0000,0.0000,0";

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
        /* Named files only. An earlier version of this assertion looked for
         * the substring "tmp" while the implementation wrote "seq-state.writing"
         * — it matched nothing and passed against a deliberately broken write. */
        let mut left: Vec<String> = fs::read_dir(s.set_dir("u1")).unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        left.sort();
        assert_eq!(left, vec!["chains.json".to_string(), "seq-state.json".to_string()],
                   "a completed write leaves exactly the two files it promises");
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
        s.write("u1", BLANK_STATE, 1, CHAINS).unwrap();
        assert!(s.has_state("u1"));
        assert_eq!(s.read_chains("u1").as_deref(), Some(CHAINS));
    }

    /* Two processes own one Set directory: the engine writes as root from
     * Move's audio process, the UI as `ableton` from the manager's. A device
     * sweep proved what default permissions cost — nine suites could not
     * write the fixture over the engine's files. */
    #[test]
    fn what_the_engine_writes_stays_writable_by_the_other_half() {
        use std::os::unix::fs::PermissionsExt;
        let s = tmp("modes");
        s.write("u1", GOOD, 1, CHAINS).unwrap();
        for p in [s.state_path("u1"), s.chains_path("u1")] {
            let mode = fs::metadata(&p).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o666, "{p:?} is {mode:o}");
        }
        let mode = fs::metadata(s.set_dir("u1")).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o777, "the directory is {mode:o}");
    }

    /* A save that changes only the chains must leave the sequence file alone.
     * The generation on disk is the proof: bumping it for a Set whose notes
     * did not move is churn, and it is what a device run caught. */
    #[test]
    fn an_unchanged_half_is_not_rewritten() {
        let s = tmp("unchanged");
        s.write("u1", GOOD, 1, "0\n").unwrap();
        s.write("u1", GOOD, 2, CHAINS).unwrap();
        let raw = fs::read_to_string(s.state_path("u1")).unwrap();
        assert!(raw.contains("gen 1"), "the sequence file must be untouched: {raw:?}");
        assert_eq!(s.read_chains("u1").as_deref(), Some(CHAINS), "the chains did change");

        /* …and the other way round: a real edit still lands. */
        s.write("u1", "movy1\nbpm 14000\n", 3, CHAINS).unwrap();
        assert_eq!(s.read_best("u1").unwrap().gen, 3);
    }

    #[test]
    fn seed_copies_state_and_chains() {
        let s = tmp("seed");
        s.write("src", GOOD, 4, CHAINS).unwrap();
        assert!(s.seed("dst", "src"));
        let got = s.read_best("dst").expect("reads");
        assert_eq!(got.payload, GOOD);
        assert_eq!(got.gen, 1, "a seed lands at gen 1");
        assert_eq!(s.read_chains("dst").as_deref(), Some(CHAINS));
    }

    #[test]
    fn seed_from_a_missing_source_does_nothing() {
        let s = tmp("seedmiss");
        assert!(!s.seed("dst", "nope"));
        assert!(!s.set_dir("dst").exists());
    }
}
