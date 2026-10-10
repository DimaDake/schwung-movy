//! Copying every Set movy kept under a Move uuid into movy's own library.
//!
//! COPY, NEVER MOVE. The legacy `sets/<uuid>/` stays exactly where it is — a
//! downgrade reads it, and the user did not ask for anything to be cleaned up.
//! Run at every startup in library mode; the `imported` list is what makes the
//! second run a single directory listing.

use crate::set_library::{clean_name, Entry, Library};
use crate::set_store::{ensure_dir, SetStore};
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

/// `SET_PAGES_TOTAL` in schwung's `shadow_set_pages.h` (same as set_gc.rs).
const SET_PAGES_TOTAL: u32 = 8;

pub struct ImportSrc {
    /// movy's legacy `modules/tools/movy/sets/`.
    pub legacy: PathBuf,
    /// Move's `UserLibrary/Sets/`, where `<uuid>/<Set name>/` gives the name.
    pub move_sets: PathBuf,
    /// schwung's parked set pages, where a Set lives while its page is not.
    pub pages: Vec<PathBuf>,
}

/// Not a Set: a pad Move never committed, or no answer at all. Its content is
/// still the user's, so it comes across under a name that says what it was.
fn provisional(uuid: &str) -> bool {
    uuid == "_default" || uuid.starts_with("__")
}

/// UTC calendar date of an epoch-ms timestamp (Howard Hinnant's
/// civil_from_days). The device has no reliable zone, and a date in a name is
/// a label, not a record.
pub fn date_of(ms: u64) -> String {
    let z = (ms / 86_400_000) as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{y:04}-{m:02}-{d:02}")
}

/// The one subfolder Move keeps a Set's `Song.abl` in IS the Set's name.
fn only_subdir(dir: &Path) -> Option<String> {
    let mut names = fs::read_dir(dir).ok()?
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .filter_map(|e| e.file_name().into_string().ok());
    let first = names.next()?;
    if names.next().is_some() { None } else { Some(first) }
}

fn move_name(src: &ImportSrc, uuid: &str) -> Option<String> {
    if let Some(n) = only_subdir(&src.move_sets.join(uuid)) { return Some(n); }
    for root in &src.pages {
        for page in 0..SET_PAGES_TOTAL {
            if let Some(n) = only_subdir(&root.join(format!("page_{page}")).join(uuid)) { return Some(n); }
        }
    }
    let raw = fs::read_to_string(src.legacy.join("name-index.json")).ok()?;
    let j = crate::mini_json::parse(&raw)?;
    j.as_obj().iter().find(|(_, v)| v.as_str() == Some(uuid)).map(|(k, _)| k.clone())
}

/// When the Set began: its oldest kept version, else the state file's mtime.
fn created_of(dir: &Path) -> u64 {
    let vms = fs::read_to_string(dir.join("versions.json")).ok()
        .map(|raw| crate::version_index::parse(Some(&raw)).v.iter().map(|r| r.ms).filter(|&m| m > 0).min())
        .flatten();
    if let Some(m) = vms { return m; }
    ["seq-state.json", "seq-state.1.json", "seq-state.2.json", "chains.json"].iter()
        .filter_map(|f| fs::metadata(dir.join(f)).ok()?.modified().ok())
        .filter_map(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .min()
        .unwrap_or(0)
}

/// `cp -r`, leaving every file writable by both halves of movy — the engine
/// writes as root in overtake, movy-host as ableton (set_store.rs).
fn copy_tree(from: &Path, to: &Path) -> std::io::Result<()> {
    ensure_dir(to).map_err(std::io::Error::other)?;
    for e in fs::read_dir(from)? {
        let e = e?;
        let dst = to.join(e.file_name());
        if e.file_type()?.is_dir() {
            copy_tree(&e.path(), &dst)?;
        } else {
            fs::copy(e.path(), &dst)?;
            let _ = fs::set_permissions(&dst, fs::Permissions::from_mode(0o666));
        }
    }
    Ok(())
}

/// Import everything not yet imported. Returns how many Sets came across.
/// The caller saves the index.
pub fn import(lib: &mut Library, sets_dir: &Path, src: &ImportSrc) -> u32 {
    let Ok(rd) = fs::read_dir(&src.legacy) else { return 0 };
    let mut uuids: Vec<String> = rd.filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .filter_map(|e| e.file_name().into_string().ok())
        .filter(|u| !u.starts_with('.') && !lib.imported.iter().any(|i| i == u))
        .collect();
    uuids.sort();   // a stable order makes a partial run resume predictably
    let legacy = SetStore::new(src.legacy.to_str().unwrap_or(""));
    let mut n = 0;
    for uuid in uuids {
        /* Content worth a Set: anything movy ever saved. A visited-and-empty
         * folder (only a ui blob, or nothing) is not one. */
        if legacy.read_best(&uuid).is_none() && !legacy.chains_path(&uuid).exists() { continue; }
        let dir = legacy.set_dir(&uuid);
        let created = created_of(&dir);
        let (id, name) = if provisional(&uuid) {
            let safe: String = uuid.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '-' }).collect();
            (format!("r{safe}"), format!("Recovered {}", date_of(created)))
        } else {
            (uuid.clone(), move_name(src, &uuid).unwrap_or_else(|| format!("Imported {}", date_of(created))))
        };
        /* Into a temporary name first: a folder under its final id means a
         * finished copy. A crash before the rename leaves only `.importing`,
         * which the next run replaces. */
        let tmp = sets_dir.join(format!("{id}.importing"));
        let dst = sets_dir.join(&id);
        let _ = fs::remove_dir_all(&tmp);
        if copy_tree(&dir, &tmp).is_err() {
            let _ = fs::remove_dir_all(&tmp);
            crate::host::log(&format!("library: import of {uuid} failed; retried next start"));
            continue;
        }
        let _ = fs::remove_dir_all(&dst);
        if fs::rename(&tmp, &dst).is_err() { continue; }
        let clips = legacy.read_best(&uuid)
            .map_or(0, |p| crate::version_index::count_clips(&p.payload));
        if lib.find(&id).is_none() {
            lib.sets.push(Entry { id, name: clean_name(&name), created, parent: None,
                                  legacy: Some(uuid.clone()), clips });
        }
        lib.imported.push(uuid);
        n += 1;
    }
    n
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::set_library::tests::tmp;

    struct Fx { lib_root: PathBuf, src: ImportSrc }

    fn fx(name: &str) -> Fx {
        let f = tmp(&format!("import-{name}"));
        let base = f.root.clone();
        let src = ImportSrc { legacy: base.join("legacy"), move_sets: base.join("MoveSets"),
                              pages: vec![base.join("set_pages")] };
        fs::create_dir_all(&src.legacy).unwrap();
        Fx { lib_root: base.join("Movy"), src }
    }

    fn legacy_set(f: &Fx, uuid: &str, payload: &str) {
        SetStore::new(f.src.legacy.to_str().unwrap()).write(uuid, payload, 3, "0\n").unwrap();
    }

    fn snapshot(dir: &Path) -> Vec<(PathBuf, Vec<u8>)> {
        let mut out = Vec::new();
        fn walk(d: &Path, out: &mut Vec<(PathBuf, Vec<u8>)>) {
            for e in fs::read_dir(d).unwrap().flatten() {
                if e.file_type().unwrap().is_dir() { walk(&e.path(), out); }
                else { out.push((e.path(), fs::read(e.path()).unwrap())); }
            }
        }
        walk(dir, &mut out);
        out.sort();
        out
    }

    const SEQ: &str = "movy1\ncl 0 0 16 0 x\ncl 1 0 16 0 y\n";

    #[test]
    fn imports_once_names_from_move_and_leaves_the_source_alone() {
        let f = fx("once");
        legacy_set(&f, "u-1", SEQ);
        fs::create_dir_all(f.src.move_sets.join("u-1").join("My Song")).unwrap();
        let before = snapshot(&f.src.legacy);
        let sets = f.lib_root.join("Sets");
        let mut lib = Library::default();
        assert_eq!(import(&mut lib, &sets, &f.src), 1);
        assert_eq!(lib.sets[0].name, "My Song");
        assert_eq!(lib.sets[0].clips, 2);
        assert_eq!(lib.sets[0].legacy.as_deref(), Some("u-1"));
        assert_eq!(SetStore::new(sets.to_str().unwrap()).read_best("u-1").unwrap().payload, SEQ);
        assert_eq!(snapshot(&f.src.legacy), before, "legacy bytes untouched");
        assert_eq!(import(&mut lib, &sets, &f.src), 0, "second run imports nothing");

        /* Deleted, then restarted: it must not come back. */
        lib.sets.clear();
        assert_eq!(import(&mut lib, &sets, &f.src), 0);
    }

    #[test]
    fn name_falls_back_through_pages_index_and_date() {
        let f = fx("names");
        for u in ["u-p", "u-i", "u-d"] { legacy_set(&f, u, SEQ); }
        fs::create_dir_all(f.src.pages[0].join("page_3").join("u-p").join("Parked")).unwrap();
        fs::write(f.src.legacy.join("name-index.json"), r#"{"Indexed \"one\"":"u-i"}"#).unwrap();
        fs::write(f.src.legacy.join("u-d").join("versions.json"),
                  r#"{"next":3,"v":[{"n":1,"gen":1,"ms":1760054400000,"why":"open","clips":1,"ui":false,"ch":false},{"n":2,"gen":2,"ms":1760140800000,"why":"auto","clips":1,"ui":false,"ch":false}]}"#).unwrap();
        let mut lib = Library::default();
        import(&mut lib, &f.lib_root.join("Sets"), &f.src);
        let name = |id: &str| lib.find(id).unwrap().name.clone();
        assert_eq!(name("u-p"), "Parked");
        assert_eq!(name("u-i"), "Indexed \"one\"");
        assert_eq!(name("u-d"), "Imported 2025-10-10");
        assert_eq!(lib.find("u-d").unwrap().created, 1_760_054_400_000, "oldest version");
        assert!(f.lib_root.join("Sets").join("u-d").join("versions.json").exists(), "history comes along");
    }

    #[test]
    fn placeholders_are_recovered_and_blank_sets_skipped() {
        let f = fx("recover");
        legacy_set(&f, "_default", SEQ);
        legacy_set(&f, "__pending-9-2", SEQ);
        fs::create_dir_all(f.src.legacy.join("u-empty")).unwrap();
        fs::write(f.src.legacy.join("u-empty").join("ui-state.json"), "{}").unwrap();
        let mut lib = Library::default();
        assert_eq!(import(&mut lib, &f.lib_root.join("Sets"), &f.src), 2);
        assert!(lib.find("r_default").is_none());
        let ids: Vec<&str> = lib.sets.iter().map(|e| e.id.as_str()).collect();
        assert!(ids.contains(&"r-default") && ids.contains(&"r--pending-9-2"), "{ids:?}");
        assert!(lib.sets.iter().all(|e| e.name.starts_with("Recovered ")));
        assert!(!lib.imported.contains(&"u-empty".to_string()), "a blank Set is not imported");
    }

    #[test]
    fn dates_are_civil_utc() {
        assert_eq!(date_of(0), "1970-01-01");
        assert_eq!(date_of(1_709_164_800_000), "2024-02-29");
    }
}
