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
use crate::set_store::{atomic_write, ensure_dir, SetStore};
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
    idx.v.retain(|r| version_dir(store, uuid, r.n).join("seq-state.json").is_file());
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
    /* Both levels: `v/` is created on the way to `v/<n>/`, and a root-only `v/`
     * would keep the other half out of every version under it. */
    if ensure_dir(&store.set_dir(uuid).join("v")).is_err() || ensure_dir(&dir).is_err() {
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
     * names — harmless, and pruned later — where the other order leaves the
     * menu offering a version whose files do not exist.
     *
     * Asserted by failing the index write, because ORDER is not observable
     * from the outside once both writes have happened: comparing the two
     * mtimes passed against an implementation that wrote the index first, and
     * a test that cannot fail is not a test. Here the index cannot be written
     * at all, so what is on disk afterwards says which write went first. */
    #[test]
    fn a_crash_before_the_index_costs_the_entry_not_the_files() {
        let s = tmp("order");
        fs::create_dir_all(s.set_dir("S1").join("versions.json")).unwrap();
        assert!(!write_version(&s, "S1", &cap(Why::Open, GOOD, 1, Some(CHAINS), None)));
        assert!(version_dir(&s, "S1", 1).join("seq-state.json").is_file(),
                "the version's files must already be on disk");
        assert_eq!(read_index(&s, "S1").v.len(), 0, "and nothing may name them");
    }

    /* The consequence that matters, and the one a clock cannot blur: a version
     * whose files did not land must leave NO index entry, because the menu
     * would otherwise offer it. */
    #[test]
    fn a_capture_that_cannot_write_is_not_recorded() {
        let s = tmp("failed");
        write_version(&s, "S1", &cap(Why::Open, GOOD, 1, None, None));
        /* A directory where the next version's state file must go: the write
         * fails the way a full or read-only flash would fail it. */
        fs::create_dir_all(version_dir(&s, "S1", 2).join("seq-state.json")).unwrap();
        assert!(!write_version(&s, "S1", &cap(Why::Auto, GOOD, 2, None, None)));
        assert_eq!(read_index(&s, "S1").v.len(), 1, "the index must not name it");
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
    fn version_files_stay_writable_by_the_other_half() {
        use std::os::unix::fs::PermissionsExt;
        let s = tmp("modes");
        write_version(&s, "S1", &cap(Why::Open, GOOD, 1, Some(CHAINS), Some(UI)));
        for p in [version_dir(&s, "S1", 1).join("seq-state.json"),
                  version_dir(&s, "S1", 1).join("chains.json")] {
            assert_eq!(fs::metadata(&p).unwrap().permissions().mode() & 0o777, 0o666, "{p:?}");
        }
        for d in [s.set_dir("S1").join("v"), version_dir(&s, "S1", 1)] {
            assert_eq!(fs::metadata(&d).unwrap().permissions().mode() & 0o777, 0o777, "{d:?}");
        }
    }

    #[test]
    fn wire_rows_names_every_field_the_menu_shows() {
        let s = tmp("wire");
        write_version(&s, "S1", &cap(Why::PreWipe, GOOD, 5, Some(CHAINS), Some(UI)));
        assert_eq!(wire_rows(&read_index(&s, "S1")), format!("1 5 {NOW} pre-wipe 1 1 1"));
    }
}
