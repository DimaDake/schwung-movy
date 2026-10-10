//! movy's own library of Sets: the index, its order, and the file moves.
//!
//! Standalone movy has no Move to say which Set is open, so the Sets are
//! movy's: `<root>/Sets/<id>/` holds exactly the files a Move-bound Set always
//! had, and `<root>/library.json` names them. Everything here runs on the saver
//! thread, the one thread that already moves every byte of a Set — which is
//! what stops a duplicate or a delete racing an autosave of the same Set.
//!
//! NAME POLICY IS THE UI'S (dates, suffixes, "Copy"), as it already is for
//! copy-on-inherit. The engine stores what it is sent, cleaned to one line.

use crate::mini_json::{esc, parse, J};
use crate::set_store::{atomic_write, ensure_dir, SetStore};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

pub const NAME_MAX: usize = 48;

#[derive(Clone, Debug, PartialEq)]
pub struct Entry {
    pub id: String,
    pub name: String,
    pub created: u64,
    pub parent: Option<String>,
    pub legacy: Option<String>,
    pub clips: u32,
}

#[derive(Default, Debug)]
pub struct Library {
    pub current: String,
    /// Legacy uuids ever imported. Outlives a delete on purpose: deleting an
    /// imported Set must not bring it back at the next startup.
    pub imported: Vec<String>,
    pub sets: Vec<Entry>,
}

impl Library {
    pub fn find(&self, id: &str) -> Option<&Entry> {
        self.sets.iter().find(|e| e.id == id)
    }
    fn find_mut(&mut self, id: &str) -> Option<&mut Entry> {
        self.sets.iter_mut().find(|e| e.id == id)
    }
}

/// One line, bounded, never empty. Tabs and newlines would break the wire's
/// row format, which is tab-separated and newline-terminated.
pub fn clean_name(s: &str) -> String {
    let one: String = s.chars().map(|c| if c.is_control() { ' ' } else { c }).collect();
    let t: String = one.trim().chars().take(NAME_MAX).collect();
    let t = t.trim_end().to_string();
    if t.is_empty() { "Untitled".to_string() } else { t }
}

fn entry_from(j: &J) -> Option<Entry> {
    let s = |k: &str| j.get(k).and_then(|v| v.as_str()).map(|v| v.to_string());
    Some(Entry {
        id: s("id").filter(|i| !i.is_empty())?,
        name: clean_name(&s("name").unwrap_or_default()),
        created: j.get("created").and_then(|v| v.as_u64()).unwrap_or(0),
        parent: s("parent"),
        legacy: s("legacy"),
        clips: j.get("clips").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
    })
}

/// Missing reads as an empty library. Unparseable is set ASIDE as `.bad`, not
/// overwritten: the next save would otherwise destroy the only record of which
/// folder is which Set, and the folders themselves are still all there.
pub fn load(path: &Path) -> Library {
    let Ok(raw) = fs::read_to_string(path) else { return Library::default() };
    let Some(j) = parse(&raw) else {
        crate::host::log(&format!("library: {path:?} unreadable, kept as .bad"));
        let _ = fs::rename(path, path.with_extension("json.bad"));
        return Library::default();
    };
    Library {
        current: j.get("current").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        imported: j.get("imported").map_or(&[][..], |v| v.as_arr()).iter()
            .filter_map(|v| v.as_str().map(|s| s.to_string())).collect(),
        sets: j.get("sets").map_or(&[][..], |v| v.as_arr()).iter().filter_map(entry_from).collect(),
    }
}

pub fn serialize(lib: &Library) -> String {
    let mut s = format!("{{\"v\":1,\"current\":{},\"imported\":[", esc(&lib.current));
    s.push_str(&lib.imported.iter().map(|u| esc(u)).collect::<Vec<_>>().join(","));
    s.push_str("],\"sets\":[");
    for (i, e) in lib.sets.iter().enumerate() {
        if i > 0 { s.push(','); }
        s.push_str(&format!("{{\"id\":{},\"name\":{},\"created\":{},\"clips\":{}",
                            esc(&e.id), esc(&e.name), e.created, e.clips));
        if let Some(p) = &e.parent { s.push_str(&format!(",\"parent\":{}", esc(p))); }
        if let Some(l) = &e.legacy { s.push_str(&format!(",\"legacy\":{}", esc(l))); }
        s.push('}');
    }
    s.push_str("]}\n");
    s
}

/// Display order with nesting depth: roots newest first, each followed by its
/// duplicates (newest first, recursively). A Set whose parent is gone is a
/// root; a cycle — which nothing writes, but a hand-edited index could hold —
/// is broken by visiting each Set once.
pub fn ordered(lib: &Library) -> Vec<(usize, u32)> {
    let ids: HashSet<&str> = lib.sets.iter().map(|e| e.id.as_str()).collect();
    let newest_first = |v: &mut Vec<usize>| {
        v.sort_by(|&a, &b| lib.sets[b].created.cmp(&lib.sets[a].created)
            .then_with(|| lib.sets[b].id.cmp(&lib.sets[a].id)));
    };
    let mut roots: Vec<usize> = (0..lib.sets.len())
        .filter(|&i| lib.sets[i].parent.as_deref().map_or(true, |p| !ids.contains(p) || p == lib.sets[i].id))
        .collect();
    newest_first(&mut roots);
    let mut out = Vec::with_capacity(lib.sets.len());
    let mut seen = vec![false; lib.sets.len()];
    fn walk(lib: &Library, i: usize, depth: u32, seen: &mut Vec<bool>, out: &mut Vec<(usize, u32)>,
            sort: &dyn Fn(&mut Vec<usize>)) {
        if seen[i] { return; }
        seen[i] = true;
        out.push((i, depth));
        let mut kids: Vec<usize> = (0..lib.sets.len())
            .filter(|&k| k != i && lib.sets[k].parent.as_deref() == Some(lib.sets[i].id.as_str()))
            .collect();
        sort(&mut kids);
        for k in kids { walk(lib, k, depth + 1, seen, out, sort); }
    }
    for r in roots { walk(lib, r, 0, &mut seen, &mut out, &newest_first); }
    /* Anything a cycle kept unreachable still has to be listed. */
    for i in 0..lib.sets.len() {
        if !seen[i] { walk(lib, i, 0, &mut seen, &mut out, &newest_first); }
    }
    out
}

/// The answer to `get_param("lib")`: a header line, then one row per Set in
/// display order, `id \t clips \t depth \t name`.
pub fn wire(lib: &Library, rev: u32, made: &str, err: &str) -> String {
    let dash = |s: &str| if s.is_empty() { "-".to_string() } else { s.to_string() };
    let mut s = format!("rev={rev} cur={} made={} err={}\n", dash(&lib.current), dash(made), dash(err));
    for (i, depth) in ordered(lib) {
        let e = &lib.sets[i];
        s.push_str(&format!("{}\t{}\t{}\t{}\n", e.id, e.clips, depth, e.name));
    }
    s
}

fn base36(mut n: u64) -> String {
    const D: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut v = Vec::new();
    loop {
        v.push(D[(n % 36) as usize]);
        n /= 36;
        if n == 0 { break; }
    }
    v.reverse();
    String::from_utf8(v).unwrap_or_default()
}

/// Where a library lives and what it does to files. `root` is the Movy folder;
/// the Sets are under `root/Sets`, which is also the saver's `SetStore` root.
pub struct LibFiles {
    pub root: PathBuf,
}

impl LibFiles {
    pub fn index(&self) -> PathBuf { self.root.join("library.json") }
    pub fn sets(&self) -> PathBuf { self.root.join("Sets") }
    fn trash(&self) -> PathBuf { self.root.join("Trash") }

    pub fn save(&self, lib: &Library) -> Result<(), String> {
        ensure_dir(&self.root)?;
        atomic_write(&self.index(), &serialize(lib))
    }

    /// A fresh id: the creation time in base 36, bumped past anything already
    /// named or already on disk (a folder an index lost is still somebody's).
    fn new_id(&self, lib: &Library, now: u64) -> String {
        let mut t = now;
        loop {
            let id = format!("m{}", base36(t));
            if lib.find(&id).is_none() && !self.sets().join(&id).exists() { return id; }
            t += 1;
        }
    }

    /// An entry and nothing else: a blank Set writes no files, the same rule
    /// `SetStore::write` keeps, so a Set made and never played leaves no folder.
    pub fn create(&self, lib: &mut Library, name: &str, now: u64) -> String {
        let id = self.new_id(lib, now);
        lib.sets.push(Entry { id: id.clone(), name: clean_name(name), created: now,
                              parent: None, legacy: None, clips: 0 });
        id
    }

    /// The source's CURRENT files, never its history: the copy is a new Set
    /// whose versions start at its own first open. `seed` already knows which
    /// of a Set's copies is current and lands the bytes at generation 1.
    pub fn dup(&self, lib: &mut Library, store: &SetStore, src: &str, name: &str, now: u64) -> Option<String> {
        let clips = lib.find(src)?.clips;
        let id = self.new_id(lib, now);
        store.seed(&id, src);
        let ui = store.set_dir(src).join("ui-state.json");
        if ui.exists() {
            if ensure_dir(&store.set_dir(&id)).is_ok() {
                if let Ok(bytes) = fs::read_to_string(&ui) {
                    let _ = atomic_write(&store.set_dir(&id).join("ui-state.json"), &bytes);
                }
            }
        }
        lib.sets.push(Entry { id: id.clone(), name: clean_name(name), created: now,
                              parent: Some(src.to_string()), legacy: None, clips });
        Some(id)
    }

    pub fn rename(&self, lib: &mut Library, id: &str, name: &str) -> bool {
        let Some(e) = lib.find_mut(id) else { return false };
        e.name = clean_name(name);
        true
    }

    /// Soft: the folder moves to `Trash/` (a rename — instant, and recoverable
    /// by hand). The open Set is refused, whatever the UI believes: the saver
    /// would otherwise write the next autosave straight back into a new folder.
    pub fn delete(&self, lib: &mut Library, id: &str, open: &str, now: u64) -> Result<(), &'static str> {
        if id == open { return Err("busy"); }
        if lib.find(id).is_none() { return Err("missing"); }
        let dir = self.sets().join(id);
        if dir.exists() {
            ensure_dir(&self.trash()).map_err(|_| "trash")?;
            fs::rename(&dir, self.trash().join(format!("{id}-{now}"))).map_err(|_| "trash")?;
        }
        lib.sets.retain(|e| e.id != id);
        if lib.current == id { lib.current.clear(); }
        Ok(())
    }

    /// Cache the clip count the list shows. True only when it changed, so the
    /// index is rewritten by a save that changed it and by no other.
    pub fn note_clips(&self, lib: &mut Library, id: &str, payload: &str) -> bool {
        let n = crate::version_index::count_clips(payload);
        match lib.find_mut(id) {
            Some(e) if e.clips != n => { e.clips = n; true }
            _ => false,
        }
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub fn tmp(name: &str) -> LibFiles {
        let d = std::env::temp_dir().join(format!("movy-lib-{name}"));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        LibFiles { root: d }
    }

    fn e(id: &str, created: u64, parent: Option<&str>) -> Entry {
        Entry { id: id.into(), name: id.into(), created, parent: parent.map(|p| p.into()),
                legacy: None, clips: 0 }
    }

    fn order(lib: &Library) -> Vec<(String, u32)> {
        ordered(lib).into_iter().map(|(i, d)| (lib.sets[i].id.clone(), d)).collect()
    }

    #[test]
    fn roots_newest_first_and_duplicates_follow_their_source() {
        let lib = Library { sets: vec![
            e("old", 1, None), e("new", 9, None), e("old-c1", 5, Some("old")),
            e("old-c2", 7, Some("old")), e("old-c1-c", 8, Some("old-c1")), e("orphan", 3, Some("gone")),
        ], ..Default::default() };
        assert_eq!(order(&lib), vec![
            ("new".into(), 0), ("orphan".into(), 0), ("old".into(), 0),
            ("old-c2".into(), 1), ("old-c1".into(), 1), ("old-c1-c".into(), 2),
        ]);
    }

    #[test]
    fn a_cycle_still_lists_every_set_once() {
        let lib = Library { sets: vec![e("a", 1, Some("b")), e("b", 2, Some("a"))], ..Default::default() };
        let o = order(&lib);
        assert_eq!(o.len(), 2);
    }

    #[test]
    fn names_are_one_bounded_line() {
        assert_eq!(clean_name("  a\tb\nc  "), "a b c");
        assert_eq!(clean_name(""), "Untitled");
        assert_eq!(clean_name(&"x".repeat(100)).chars().count(), NAME_MAX);
    }

    #[test]
    fn index_round_trips_and_corrupt_is_kept_aside() {
        let f = tmp("roundtrip");
        let mut lib = Library::default();
        let id = f.create(&mut lib, "My \"Set\", one", 1_760_000_000_000);
        lib.current = id.clone();
        lib.imported.push("u-1".into());
        f.save(&lib).unwrap();
        let back = load(&f.index());
        assert_eq!(back.current, id);
        assert_eq!(back.imported, vec!["u-1".to_string()]);
        assert_eq!(back.sets[0].name, "My \"Set\", one");

        fs::write(f.index(), "{ not json").unwrap();
        assert!(load(&f.index()).sets.is_empty());
        assert!(f.root.join("library.json.bad").exists(), "the bad index is kept");
    }

    #[test]
    fn create_writes_no_set_files() {
        let f = tmp("create");
        let mut lib = Library::default();
        let a = f.create(&mut lib, "x", 100);
        let b = f.create(&mut lib, "y", 100);
        assert_ne!(a, b, "same millisecond still gets two ids");
        assert!(!f.sets().join(&a).exists());
    }

    #[test]
    fn dup_copies_current_files_but_not_history() {
        let f = tmp("dup");
        let store = SetStore::new(f.sets().to_str().unwrap());
        let mut lib = Library::default();
        let src = f.create(&mut lib, "src", 1);
        store.write(&src, "movy1\ncl 0 0 16 0 x\n", 5, "1\n").unwrap();
        fs::write(store.set_dir(&src).join("ui-state.json"), "{\"ui\":1}").unwrap();
        fs::write(store.set_dir(&src).join("versions.json"), "{}").unwrap();
        lib.find_mut(&src).unwrap().clips = 1;

        let c = f.dup(&mut lib, &store, &src, "src Copy", 2).unwrap();
        assert_eq!(store.read_best(&c).unwrap().payload, "movy1\ncl 0 0 16 0 x\n");
        assert_eq!(store.read_chains(&c).as_deref(), Some("1\n"));
        assert!(store.set_dir(&c).join("ui-state.json").exists());
        assert!(!store.set_dir(&c).join("versions.json").exists(), "history stays with the source");
        let ce = lib.find(&c).unwrap();
        assert_eq!((ce.parent.as_deref(), ce.clips), (Some(src.as_str()), 1));
        assert!(f.dup(&mut lib, &store, "nope", "x", 3).is_none());
    }

    #[test]
    fn delete_moves_to_trash_and_refuses_the_open_set() {
        let f = tmp("del");
        let store = SetStore::new(f.sets().to_str().unwrap());
        let mut lib = Library::default();
        let a = f.create(&mut lib, "a", 1);
        let b = f.create(&mut lib, "b", 2);
        store.write(&a, "movy1\ncl 0 0 16 0 x\n", 1, "0\n").unwrap();
        lib.current = a.clone();
        assert_eq!(f.delete(&mut lib, &a, &a, 9), Err("busy"));
        assert_eq!(f.delete(&mut lib, "zz", &b, 9), Err("missing"));
        f.delete(&mut lib, &a, &b, 9).unwrap();
        assert!(!f.sets().join(&a).exists());
        assert!(f.root.join("Trash").join(format!("{a}-9")).join("seq-state.json").exists());
        assert!(lib.find(&a).is_none());
        assert_eq!(lib.current, "", "a deleted current is no longer current");
        f.delete(&mut lib, &b, "", 9).unwrap();   // a Set with no folder deletes too
        assert!(lib.sets.is_empty());
    }

    #[test]
    fn clip_cache_reports_only_a_change() {
        let f = tmp("clips");
        let mut lib = Library::default();
        let a = f.create(&mut lib, "a", 1);
        assert!(f.note_clips(&mut lib, &a, "movy1\ncl 0 0 16 0 x\n"));
        assert!(!f.note_clips(&mut lib, &a, "movy1\ncl 0 0 16 0 y\n"));
    }

    #[test]
    fn wire_rows_are_in_display_order() {
        let mut lib = Library { sets: vec![e("a", 1, None), e("b", 2, None)], ..Default::default() };
        lib.current = "a".into();
        lib.sets[0].name = "Alpha one".into();
        assert_eq!(wire(&lib, 3, "b", ""), "rev=3 cur=a made=b err=-\nb\t0\t0\tb\na\t0\t0\tAlpha one\n");
    }
}
