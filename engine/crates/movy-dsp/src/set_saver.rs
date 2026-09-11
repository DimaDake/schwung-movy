//! The saver thread: every byte of a Set's files moves through here.
//!
//! **Nothing in this module's I/O runs on the audio thread.** `set_param`,
//! `get_param` and `render_block` all do, and a cold `dlopen` already holds
//! that thread for 78-276 ms — schwung has been moving file work off it for
//! exactly this reason (`shadow_set_pages.c:411`), and davebox writing its
//! state file inline from `set_param` is the shape we are deliberately not
//! copying.
//!
//! The lock discipline that makes the audio side safe: **the mutex is never
//! held across file I/O.** The worker reads or writes first and locks only to
//! publish a few fields, so an audio-thread `status()` waits microseconds at
//! worst.
//!
//! What crosses the wire is a COMMAND, never a payload. A lost command is
//! harmless and idempotent on retry — an engine that has not opened a Set
//! cannot overwrite one — where the `state` push this replaces destroyed data
//! when it was lost (docs/persistence-hazards.md §2).

use crate::set_envelope::BLANK_STATE;
use crate::set_store::SetStore;
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};

pub enum Job {
    Open { uuid: String, seed: Option<String> },
    Rename { from: String, to: String },
    Blank { uuid: String },
    Save { uuid: String, payload: String, gen: u32, chains: String },
    Flush,
}

enum Msg {
    Work(Job),
    /// Test-only rendezvous: the worker answers once every earlier job is done.
    Sync(Sender<()>),
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Phase {
    Opening,
    Ready,
    Failed,
}

impl Phase {
    fn as_str(self) -> &'static str {
        match self {
            Phase::Opening => "opening",
            Phase::Ready => "ready",
            Phase::Failed => "failed",
        }
    }
}

struct Shared {
    uuid: String,
    phase: Phase,
    gen: u32,
    reason: String,
    /// Outstanding saves. The UI's `flush` waits for this to reach zero.
    dirty: u32,
    /// Bytes for the audio thread to apply: (payload, chains, gen).
    loaded: Option<(String, String, u32)>,
}

pub struct Saver {
    tx: Sender<Msg>,
    shared: Arc<Mutex<Shared>>,
}

/// Total by construction: this runs on the audio thread, and a malformed
/// command must be ignored rather than panic inside someone else's callback.
pub fn parse_cmd(val: &str) -> Option<Job> {
    let mut it = val.split_whitespace();
    match it.next()? {
        "open" => {
            let uuid = it.next()?.to_string();
            let seed = it.next().and_then(|t| t.strip_prefix("seed=")).map(|s| s.to_string());
            Some(Job::Open { uuid, seed })
        }
        "rename" => {
            let from = it.next()?.to_string();
            let to = it.next()?.to_string();
            Some(Job::Rename { from, to })
        }
        "blank" => Some(Job::Blank { uuid: it.next()?.to_string() }),
        "flush" => Some(Job::Flush),
        _ => None,
    }
}

fn do_open(store: &SetStore, shared: &Arc<Mutex<Shared>>, uuid: &str, seed: Option<&str>) {
    /* A seed is a FALLBACK, never a preference: a Set that owns state keeps it.
     * Reversed, opening a copy would overwrite the copy's own work with its
     * source's. */
    if !store.has_state(uuid) {
        if let Some(src) = seed {
            store.seed(uuid, src);
        }
    }

    let had_files = store.has_state(uuid);
    let best = store.read_best(uuid);
    let mut sh = shared.lock().unwrap();
    sh.uuid = uuid.to_string();
    match best {
        Some(p) => {
            sh.gen = p.gen;
            sh.phase = Phase::Ready;
            sh.reason.clear();
            sh.loaded = Some((p.payload, store.read_chains(uuid).unwrap_or_default(), p.gen));
        }
        /* Files that exist but do not parse are NOT an empty Set. Reading them
         * as one is how a Set gets blanked; the UI's recovery is scoped to a
         * set-level failure precisely so it can offer that choice instead of
         * making it. */
        None if had_files => {
            sh.phase = Phase::Failed;
            sh.reason = "unreadable".to_string();
            sh.loaded = None;
        }
        None => {
            sh.gen = 0;
            sh.phase = Phase::Ready;
            sh.reason.clear();
            sh.loaded = None;
        }
    }
}

fn worker(root: String, shared: Arc<Mutex<Shared>>, rx: std::sync::mpsc::Receiver<Msg>) {
    let store = SetStore::new(&root);
    while let Ok(msg) = rx.recv() {
        match msg {
            Msg::Sync(ack) => {
                let _ = ack.send(());
            }
            Msg::Work(Job::Open { uuid, seed }) => {
                do_open(&store, &shared, &uuid, seed.as_deref());
            }
            Msg::Work(Job::Rename { from, to }) => {
                /* The id changed but the Set did not, so the work in hand moves
                 * with it. Seeding is a no-op when the destination already owns
                 * state, which is the safe direction. */
                if !store.has_state(&to) {
                    store.seed(&to, &from);
                }
                let mut sh = shared.lock().unwrap();
                sh.uuid = to;
            }
            Msg::Work(Job::Blank { uuid }) => {
                /* The deliberate exception to "a blank Set writes nothing": the
                 * files must GO, or reopening restores exactly the state the
                 * user asked to be rid of. */
                let _ = std::fs::remove_dir_all(store.set_dir(&uuid));
                let mut sh = shared.lock().unwrap();
                sh.gen = 0;
                sh.phase = Phase::Ready;
                sh.reason.clear();
                sh.loaded = Some((BLANK_STATE.to_string(), "0\n".to_string(), 0));
            }
            Msg::Work(Job::Save { uuid, payload, gen, chains }) => {
                let res = store.write(&uuid, &payload, gen, &chains);
                let mut sh = shared.lock().unwrap();
                sh.dirty = sh.dirty.saturating_sub(1);
                match res {
                    Ok(()) => {
                        sh.gen = gen;
                        sh.reason.clear();
                    }
                    /* Left for the next save to retry. The engine keeps the
                     * bytes — unlike the old path, where reading `state` out of
                     * the engine cleared its dirty flag and a failed write was
                     * then lost for good. */
                    Err(e) => {
                        crate::host::log(&format!("set: save failed: {e}"));
                        sh.reason = "save-failed".to_string();
                    }
                }
            }
            Msg::Work(Job::Flush) => {}
        }
    }
}

impl Saver {
    pub fn new(root: &str) -> Self {
        let (tx, rx) = channel();
        let shared = Arc::new(Mutex::new(Shared {
            uuid: String::new(),
            phase: Phase::Opening,
            gen: 0,
            reason: String::new(),
            dirty: 0,
            loaded: None,
        }));
        let w = Arc::clone(&shared);
        let root = root.to_string();
        std::thread::spawn(move || worker(root, w, rx));
        Saver { tx, shared }
    }

    pub fn submit(&self, job: Job) {
        /* Counted BEFORE the send, so a status read between submit and the
         * worker picking it up still reports the Set as un-saved. */
        if matches!(job, Job::Save { .. }) {
            self.shared.lock().unwrap().dirty += 1;
        }
        let _ = self.tx.send(Msg::Work(job));
    }

    pub fn status(&self) -> String {
        let sh = self.shared.lock().unwrap();
        let mut s = format!(
            "uuid={} phase={} gen={} dirty={}",
            sh.uuid,
            sh.phase.as_str(),
            sh.gen,
            if sh.dirty > 0 { 1 } else { 0 }
        );
        if !sh.reason.is_empty() {
            s.push_str(&format!(" reason={}", sh.reason));
        }
        s
    }

    /// Bytes waiting to be applied, taken exactly once.
    pub fn take_loaded(&self) -> Option<(String, String, u32)> {
        self.shared.lock().unwrap().loaded.take()
    }

    #[cfg(test)]
    pub fn drain_for_test(&self) {
        let (ack, done) = channel();
        let _ = self.tx.send(Msg::Sync(ack));
        let _ = done.recv();
    }
}

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
        let st = s.status();
        assert!(st.contains("uuid=u1"), "got {st}");
        assert!(st.contains("phase=ready"), "got {st}");
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

    /* The UI's only recovery is to blank the Set, which is scoped to a
     * set-level failure — it cannot fix an engine that never started, and it
     * would destroy a Set that is perfectly fine. So an open that fails must
     * SAY it failed rather than looking like an empty Set. */
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
        assert!(s.status().contains("dirty=1"), "got {}", s.status());
        s.drain_for_test();
        assert!(s.status().contains("dirty=0"), "got {}", s.status());
    }

    /* A seed is how copy-on-inherit survives the move: the UI names the source
     * by name policy, the engine copies the bytes. */
    #[test]
    fn open_with_a_seed_inherits_when_the_set_has_nothing() {
        let root = tmp("seed");
        let s = Saver::new(&root);
        s.submit(Job::Save {
            uuid: "src".into(),
            payload: "movy1\nbpm 15000\n".into(),
            gen: 3,
            chains: "0\n".into(),
        });
        s.submit(Job::Open { uuid: "copy".into(), seed: Some("src".into()) });
        s.drain_for_test();
        let (payload, _c, gen) = s.take_loaded().expect("loaded");
        assert_eq!(payload, "movy1\nbpm 15000\n");
        assert_eq!(gen, 1, "an inherited Set starts its own generation sequence");
    }

    /* A Set that owns state must NOT be overwritten by a seed — the seed is a
     * fallback, never a preference. */
    #[test]
    fn a_seed_never_beats_the_sets_own_state() {
        let root = tmp("seedown");
        let s = Saver::new(&root);
        s.submit(Job::Save { uuid: "src".into(), payload: "movy1\nbpm 15000\n".into(), gen: 3, chains: "0\n".into() });
        s.submit(Job::Save { uuid: "own".into(), payload: "movy1\nbpm 90000\n".into(), gen: 2, chains: "0\n".into() });
        s.submit(Job::Open { uuid: "own".into(), seed: Some("src".into()) });
        s.drain_for_test();
        assert_eq!(s.take_loaded().expect("loaded").0, "movy1\nbpm 90000\n");
    }
}
