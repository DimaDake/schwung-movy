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
        /* `movy-sets` and `move-library`, not `sets` and `Sets`: the device is
         * case-sensitive but the mac these tests run on is not, so the two
         * names collide into one directory and every Set reads as alive. */
        fs::create_dir_all(root.join("movy-sets")).unwrap();
        fs::create_dir_all(root.join("move-library")).unwrap();
        Fixture {
            store: SetStore::new(root.join("movy-sets").to_str().unwrap()),
            paths: GcPaths {
                move_sets: root.join("move-library"),
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
        fs::write(f.root.join("movy-sets").join("name-index.json"), "{}").unwrap();
        assert!(collect(&f.store, &f.paths, "").is_empty());
        assert!(f.root.join("movy-sets").join("name-index.json").exists());
    }
}
