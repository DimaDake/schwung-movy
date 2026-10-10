//! The `set lib …` commands, run on the saver thread.
//!
//! The library comes alive on the first `lib` command, never before: a saver
//! rooted in Move's legacy `sets/` must not grow a `library.json` beside it,
//! and only the UI knows which mode it is in. From then on an `open` records
//! the last-open Set and a save refreshes the cached clip count.

use crate::set_import::{import, ImportSrc};
use crate::set_library::{load, wire, LibFiles, Library};
use crate::set_store::SetStore;
use std::path::{Path, PathBuf};

pub enum LibCmd {
    Import(ImportSrc),
    List,
    New(String),
    Dup(String, String),
    Rename(String, String),
    Del(String),
}

/// `rest` follows `lib `. A name runs to the end of the line, so it keeps its
/// own spaces; everything else is whitespace-separated.
pub fn parse(rest: &str) -> Option<LibCmd> {
    let rest = rest.trim_start();
    let (verb, tail) = rest.split_once(char::is_whitespace).unwrap_or((rest, ""));
    let tail = tail.trim_start();
    let word_and_rest = |t: &str| -> Option<(String, String)> {
        let (w, r) = t.split_once(char::is_whitespace)?;
        let r = r.trim();
        if w.is_empty() || r.is_empty() { None } else { Some((w.to_string(), r.to_string())) }
    };
    match verb {
        "import" => {
            let mut src = ImportSrc { legacy: PathBuf::new(), move_sets: PathBuf::new(), pages: Vec::new() };
            for tok in tail.split_whitespace() {
                if let Some(v) = tok.strip_prefix("legacy=") { src.legacy = v.into(); }
                else if let Some(v) = tok.strip_prefix("move=") { src.move_sets = v.into(); }
                else if let Some(v) = tok.strip_prefix("pages=") {
                    src.pages = v.split(',').filter(|s| !s.is_empty()).map(PathBuf::from).collect();
                }
            }
            Some(LibCmd::Import(src))
        }
        "list" => Some(LibCmd::List),
        "new" if !tail.trim().is_empty() => Some(LibCmd::New(tail.trim().to_string())),
        "dup" => word_and_rest(tail).map(|(a, b)| LibCmd::Dup(a, b)),
        "rename" => word_and_rest(tail).map(|(a, b)| LibCmd::Rename(a, b)),
        "del" => tail.split_whitespace().next().map(|id| LibCmd::Del(id.to_string())),
        _ => None,
    }
}

pub struct LibState {
    files: LibFiles,
    lib: Library,
    rev: u32,
    /// The last Set `new`/`dup` made. STICKY, so it survives the publishes an
    /// autosave or an open make in between: the UI waits for it to CHANGE
    /// (ids are unique), not for the very next answer to carry it.
    made: String,
}

impl LibState {
    /// The library sits beside the Sets folder the saver is rooted in.
    pub fn open(sets_root: &Path) -> LibState {
        let files = LibFiles { root: sets_root.parent().unwrap_or(sets_root).to_path_buf() };
        let lib = load(&files.index());
        LibState { files, lib, rev: 0, made: String::new() }
    }

    fn publish(&mut self, err: &str) -> String {
        self.rev = self.rev.wrapping_add(1).max(1);
        wire(&self.lib, self.rev, &self.made, err)
    }

    fn persist(&mut self) -> &'static str {
        match self.files.save(&self.lib) {
            Ok(()) => "",
            Err(e) => { crate::host::log(&format!("library: index not saved: {e}")); "save" }
        }
    }

    /// Run one command; the answer is the new `lib` wire.
    pub fn run(&mut self, store: &SetStore, cmd: LibCmd, open: &str, now: u64) -> String {
        let (made, err) = match cmd {
            LibCmd::List => {
                self.lib = load(&self.files.index());
                (String::new(), "")
            }
            LibCmd::Import(src) => {
                let n = import(&mut self.lib, &store.root, &src);
                /* No last-open Set yet (a first start, or it was deleted
                 * elsewhere): the top of the list is the one to reopen. */
                if self.lib.find(&self.lib.current).is_none() {
                    self.lib.current = crate::set_library::ordered(&self.lib).first()
                        .map(|&(i, _)| self.lib.sets[i].id.clone()).unwrap_or_default();
                }
                let err = if n > 0 || !self.files.index().exists() { self.persist() } else { "" };
                (String::new(), err)
            }
            LibCmd::New(name) => {
                let id = self.files.create(&mut self.lib, &name, now);
                (id, self.persist())
            }
            LibCmd::Dup(src, name) => match self.files.dup(&mut self.lib, store, &src, &name, now) {
                Some(id) => (id, self.persist()),
                None => (String::new(), "missing"),
            },
            LibCmd::Rename(id, name) => {
                if self.files.rename(&mut self.lib, &id, &name) { (String::new(), self.persist()) }
                else { (String::new(), "missing") }
            }
            LibCmd::Del(id) => match self.files.delete(&mut self.lib, &id, open, now) {
                Ok(()) => (String::new(), self.persist()),
                Err(e) => (String::new(), e),
            },
        };
        if !made.is_empty() { self.made = made; }
        self.publish(err)
    }

    /// The Set the saver just opened is the one to reopen next launch.
    pub fn on_open(&mut self, id: &str) -> Option<String> {
        if self.lib.current == id || self.lib.find(id).is_none() { return None; }
        self.lib.current = id.to_string();
        let err = self.persist();
        Some(self.publish(err))
    }

    pub fn on_save(&mut self, id: &str, payload: &str) -> Option<String> {
        if !self.files.note_clips(&mut self.lib, id, payload) { return None; }
        let err = self.persist();
        Some(self.publish(err))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_every_verb_and_keeps_name_spaces() {
        assert!(matches!(parse("list"), Some(LibCmd::List)));
        assert!(matches!(parse("new 2026-10-10_01"), Some(LibCmd::New(n)) if n == "2026-10-10_01"));
        assert!(matches!(parse("rename m1 My  Set  2"), Some(LibCmd::Rename(i, n)) if i == "m1" && n == "My  Set  2"));
        assert!(matches!(parse("dup m1 A Copy"), Some(LibCmd::Dup(i, n)) if i == "m1" && n == "A Copy"));
        assert!(matches!(parse("del m1"), Some(LibCmd::Del(i)) if i == "m1"));
        match parse("import legacy=/a move=/b pages=/c,/d") {
            Some(LibCmd::Import(s)) => {
                assert_eq!(s.legacy, PathBuf::from("/a"));
                assert_eq!(s.pages.len(), 2);
            }
            _ => panic!("import"),
        }
        for bad in ["", "new", "new   ", "rename m1", "dup", "del", "bogus x"] {
            assert!(parse(bad).is_none(), "{bad:?}");
        }
    }
}
